//! Destination-owned, bounded transfers of immutable producer-final packages.
use crate::{
    engine_inventory::{inspect_artifact, ArtifactIdentity},
    service::write_private,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{atomic::{AtomicBool, Ordering}, Arc},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{Mutex, Semaphore},
};
use uuid::Uuid;

/// The same publication catalog used by GChat; unpublished entries are never downloads.
pub async fn published_releases() -> Result<Vec<Release>, String> {
    let url = std::env::var("GINFER_MODEL_CATALOG_URL").ok()
        .or_else(|| option_env!("VITE_MODEL_CATALOG_URL").map(str::to_owned));
    let Some(url) = url else { return Ok(Vec::new()); };
    let value: serde_json::Value = reqwest::Client::builder().https_only(true)
        .timeout(Duration::from_secs(30)).build().map_err(|e| e.to_string())?
        .get(url).send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    catalog_releases(&value)
}

fn catalog_releases(value: &serde_json::Value) -> Result<Vec<Release>, String> {
    let models = value["models"].as_array().ok_or("publication catalog requires models")?;
    let mut releases = BTreeMap::new();
    for model in models.iter().filter(|m| m["library_name"] == "ginfer") {
        for release in model["releases"].as_array().into_iter().flatten() {
            let release: Release = serde_json::from_value(release.clone()).map_err(|e| e.to_string())?;
            release.validate()?;
            releases.insert(release.sha256.clone(), release);
        }
    }
    Ok(releases.into_values().collect())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Release {
    pub name: String,
    pub identity: ArtifactIdentity,
    pub url: String,
    pub sha256: String,
    pub bytes: u64,
    pub tp: u32,
    pub qualified_sm: Vec<String>,
    pub min_vram_mib_per_gpu: u64,
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub launch_profiles: Vec<crate::launch_profiles::LaunchProfile>,
}
impl Release {
    pub fn compatible_group(&self, gpus: &[crate::service::Gpu]) -> Option<Vec<String>> {
        let mut groups = BTreeMap::<_, Vec<String>>::new();
        for gpu in gpus {
            if gpu.memory_mib >= self.min_vram_mib_per_gpu
                && gpu
                    .compute_capability
                    .as_ref()
                    .is_some_and(|sm| self.qualified_sm.contains(sm))
            {
                groups
                    .entry((&gpu.name, &gpu.compute_capability))
                    .or_default()
                    .push(gpu.uuid.clone());
            }
        }
        groups
            .into_values()
            .find(|group| group.len() >= self.tp as usize)
            .map(|mut group| {
                group.truncate(self.tp as usize);
                group
            })
    }
    pub fn validate(&self) -> Result<(), String> {
        let mut profile_ids = std::collections::BTreeSet::new();
        for profile in &self.launch_profiles {
            profile.validate()?;
            if profile.identity != self.identity || profile.artifact_sha256 != self.sha256
                || profile.artifact_bytes != self.bytes || profile.tp != self.tp
                || !self.qualified_sm.contains(&profile.compute_capability)
                || !profile_ids.insert(&profile.id) {
                return Err("launch profiles must uniquely identify this exact qualified release".into());
            }
        }
        let url = reqwest::Url::parse(&self.url).map_err(|e| e.to_string())?;
        let segments: Vec<_> = url.path().split('/').filter(|p| !p.is_empty()).collect();
        if url.scheme() != "https"
            || url.host_str() != Some("huggingface.co")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || segments.len() < 5
            || segments[2] != "resolve"
            || segments[3].len() != 40
            || !segments[3].bytes().all(|b| b.is_ascii_hexdigit())
            || !url.path().ends_with(".ginfer")
        {
            return Err(
                "release must reference a commit-pinned HTTPS Hugging Face .ginfer package".into(),
            );
        }
        if self.name.trim().is_empty()
            || self.name.len() > 160
            || self.bytes < 16
            || self.bytes > 9_007_199_254_740_991
            || self.sha256.len() != 64
            || !self
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || !matches!(self.tp, 1 | 2 | 4)
            || self.qualified_sm.is_empty()
            || self.min_vram_mib_per_gpu == 0
            || self.identity.model_id.is_empty()
            || self.identity.weights_id.is_empty()
            || !self.qualified_sm.iter().all(|sm| {
                sm.split_once('.').is_some_and(|(a, b)| {
                    !a.is_empty()
                        && !b.is_empty()
                        && a.bytes().chain(b.bytes()).all(|v| v.is_ascii_digit())
                })
            })
        {
            return Err(
                "release requires exact size, SHA256, TP and qualified per-GPU requirements".into(),
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Download {
    pub id: Uuid,
    pub release: Release,
    pub status: String,
    pub received: u64,
    pub bytes_per_second: u64,
    pub error: Option<String>,
    pub path: Option<PathBuf>,
    #[serde(default)]
    pub storage_root: PathBuf,
}
pub struct RemovedPackage {
    pub journal_error: Option<String>,
}

pub struct ModelDownloads {
    root: std::sync::RwLock<PathBuf>,
    state_path: PathBuf,
    jobs: Mutex<BTreeMap<Uuid, Download>>,
    pending_journal: AtomicBool,
    serial: Arc<Semaphore>,
    local_layout: bool,
}
impl ModelDownloads {
    pub async fn installed_profiles(&self) -> Result<Vec<crate::launch_profiles::LaunchProfile>, String> {
        let jobs = self.jobs.lock().await;
        let mut profiles = Vec::new();
        for job in jobs.values().filter(|job| job.status == "installed") {
            job.release.validate()?;
            profiles.extend(job.release.launch_profiles.iter().cloned());
        }
        Ok(profiles)
    }
    pub fn open(root: PathBuf, state_path: PathBuf) -> Result<Arc<Self>, String> {
        Self::open_layout(root, state_path, false)
    }
    pub fn open_local(root: PathBuf, state_path: PathBuf) -> Result<Arc<Self>, String> {
        Self::open_layout(root, state_path, true)
    }
    fn open_layout(
        root: PathBuf,
        state_path: PathBuf,
        local_layout: bool,
    ) -> Result<Arc<Self>, String> {
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        let mut jobs: BTreeMap<Uuid, Download> = match std::fs::read(&state_path) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|e| format!("download state: {e}"))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(e) => return Err(e.to_string()),
        };
        for job in jobs.values_mut() {
            if job.storage_root.as_os_str().is_empty() {
                job.storage_root = root.clone();
            }
            if matches!(
                job.status.as_str(),
                "queued" | "downloading" | "verifying" | "pausing"
            ) {
                job.status = "paused".into();
                job.error =
                    Some("Host restarted; resume to continue the verified download.".into());
            }
            job.bytes_per_second = 0;
        }
        let manager = Arc::new(Self {
            root: std::sync::RwLock::new(root),
            state_path,
            jobs: Mutex::new(jobs),
            pending_journal: AtomicBool::new(false),
            serial: Arc::new(Semaphore::new(1)),
            local_layout,
        });
        Ok(manager)
    }
    pub fn root(&self) -> PathBuf {
        self.root.read().unwrap().clone()
    }
    pub fn set_root(&self, root: PathBuf) {
        *self.root.write().unwrap() = root;
    }
    fn save(&self, jobs: &BTreeMap<Uuid, Download>) -> Result<(), String> {
        write_private(
            &self.state_path,
            &serde_json::to_vec(jobs).map_err(|e| e.to_string())?,
        )?;
        self.pending_journal.store(false, Ordering::SeqCst);
        Ok(())
    }
    pub(crate) async fn flush_pending(&self) -> Result<(), String> {
        if !self.pending_journal.load(Ordering::SeqCst) {
            return Ok(());
        }
        let jobs = self.jobs.lock().await;
        if self.pending_journal.load(Ordering::SeqCst) {
            self.save(&jobs)?;
        }
        Ok(())
    }
    pub async fn list(&self) -> Vec<Download> {
        self.jobs.lock().await.values().cloned().collect()
    }
    pub async fn enqueue(self: &Arc<Self>, release: Release) -> Result<Download, String> {
        release.validate()?;
        let mut jobs = self.jobs.lock().await;
        if let Some(job) = jobs
            .values()
            .find(|j| j.release.sha256 == release.sha256)
            .cloned()
        {
            if job.status != "installed" || job.path.as_ref().is_some_and(|p| p.exists()) {
                return Ok(job);
            }
            jobs.remove(&job.id);
        }
        let job = Download {
            id: Uuid::new_v4(),
            release,
            status: "queued".into(),
            received: 0,
            bytes_per_second: 0,
            error: None,
            path: None,
            storage_root: self.root(),
        };
        jobs.insert(job.id, job.clone());
        if let Err(e) = self.save(&jobs) {
            jobs.remove(&job.id);
            return Err(e);
        }
        drop(jobs);
        self.spawn(job.id);
        Ok(job)
    }
    pub async fn action(self: &Arc<Self>, id: Uuid, action: &str) -> Result<(), String> {
        let mut jobs = self.jobs.lock().await;
        if action == "discard" {
            let job = jobs.get(&id).ok_or("unknown download")?;
            if !matches!(job.status.as_str(), "paused" | "failed") {
                return Err("pause the download before removing incomplete files".into());
            }
            let partial = job.storage_root.join(format!("{id}.part"));
            match tokio::fs::remove_file(partial).await {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.to_string()),
            }
            let staging = job.storage_root.join(format!(".model-install-{id}"));
            if staging.exists() {
                for name in ["model.ginfer", "model.yml"] {
                    match tokio::fs::remove_file(staging.join(name)).await {
                        Ok(()) => (),
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                        Err(e) => return Err(e.to_string()),
                    }
                }
                tokio::fs::remove_dir(staging)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            jobs.remove(&id);
            return self.save(&jobs);
        }
        let job = jobs.get_mut(&id).ok_or("unknown download")?;
        match action {
            "pause" if job.status == "queued" => {
                job.status = "paused".into();
            }
            "pause" if job.status == "downloading" => job.status = "pausing".into(),
            "resume" if matches!(job.status.as_str(), "paused" | "failed") => {
                job.status = "queued".into();
                job.error = None;
            }
            _ => return Err("download action is not available in its current state".into()),
        }
        self.save(&jobs)?;
        drop(jobs);
        if action == "resume" {
            self.spawn(id);
        }
        Ok(())
    }
    pub async fn remove_installed(&self, path: &std::path::Path) -> Result<RemovedPackage, String> {
        let path = tokio::fs::canonicalize(path).await.map_err(|e| e.to_string())?;
        let mut jobs = self.jobs.lock().await;
        let id = jobs
            .values()
            .find(|job| {
                job.status == "installed"
                    && (if self.local_layout { job.storage_root.join(&job.release.sha256).join("model.ginfer") }
                        else { job.storage_root.join(format!("{}.ginfer", job.release.sha256)) }) == path
            })
            .map(|j| j.id)
            .ok_or("only packages installed into managed storage can be removed")?;
        let job = jobs.get(&id).ok_or("installed download disappeared")?;
        job.release.validate()?;
        if self.local_layout {
            tokio::fs::remove_dir_all(job.storage_root.join(&job.release.sha256)).await.map_err(|e| e.to_string())?;
        } else {
            tokio::fs::remove_file(&path).await.map_err(|e| e.to_string())?;
        }
        jobs.remove(&id);
        self.pending_journal.store(true, Ordering::SeqCst);
        Ok(RemovedPackage { journal_error: self.save(&jobs).err() })
    }
    fn spawn(self: &Arc<Self>, id: Uuid) {
        let manager = self.clone();
        tokio::spawn(async move {
            let _permit = manager.serial.clone().acquire_owned().await.unwrap();
            let result = manager.transfer(id).await;
            if let Err(error) = result {
                let root = manager.jobs.lock().await.get(&id).map(|job| job.storage_root.clone());
                let Some(root) = root else { return; };
                let received = tokio::fs::metadata(root.join(format!("{id}.part")))
                    .await
                    .map(|m| m.len())
                    .unwrap_or(0);
                let mut jobs = manager.jobs.lock().await;
                if let Some(job) = jobs.get_mut(&id) {
                    job.status = if job.status == "pausing" {
                        "paused"
                    } else {
                        "failed"
                    }
                    .into();
                    job.error = Some(error);
                    job.bytes_per_second = 0;
                    job.received = received;
                }
                if let Err(e) = manager.save(&jobs) {
                    eprintln!("cannot persist download failure: {e}");
                }
            }
        });
    }
    async fn update(
        &self,
        id: Uuid,
        received: u64,
        speed: u64,
        status: &str,
    ) -> Result<(), String> {
        let mut jobs = self.jobs.lock().await;
        let job = jobs.get_mut(&id).ok_or("unknown download")?;
        if job.status == "pausing" {
            return Err("Download paused; partial bytes are retained.".into());
        }
        job.received = received;
        job.bytes_per_second = speed;
        job.status = status.into();
        self.save(&jobs)
    }
    async fn transfer(&self, id: Uuid) -> Result<(), String> {
        self.transfer_with_client(id, None).await
    }
    async fn transfer_with_client(&self, id: Uuid, client: Option<reqwest::Client>) -> Result<(), String> {
        let job = {
            let mut jobs = self.jobs.lock().await;
            let job = jobs.get_mut(&id).ok_or("unknown download")?;
            if job.status != "queued" {
                return Ok(());
            }
            // Queued and downloading both recover as paused after restart.
            // Pause persists its state; the first update persists progress.
            job.status = "downloading".into();
            job.clone()
        };
        let client = match client {
            Some(client) => client,
            None => reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(30))
                .https_only(true)
                .build()
                .map_err(|e| e.to_string())?,
        };
        let release = job.release;
        let root = job.storage_root;
        let partial = root.join(format!("{id}.part"));
        let destination = if self.local_layout {
            root.join(&release.sha256).join("model.ginfer")
        } else {
            root.join(format!("{}.ginfer", release.sha256))
        };
        let staging = root.join(format!(".model-install-{id}"));
        if destination.is_file() {
            self.update(id, release.bytes, 0, "verifying").await?;
            verify_package(destination.clone(), &release).await?;
            return self.installed(id, destination).await;
        }
        if self.local_layout && !partial.exists() && staging.join("model.ginfer").exists() {
            tokio::fs::rename(staging.join("model.ginfer"), &partial)
                .await
                .map_err(|e| e.to_string())?;
        }
        let mut received = tokio::fs::metadata(&partial)
            .await
            .map(|m| m.len())
            .unwrap_or(0);
        if received > release.bytes {
            return Err("partial file exceeds release size; remove this incomplete download before retrying".into());
        }
        self.update(id, received, 0, "downloading").await?;
        let available = available_bytes(root.clone()).await?;
        if available < release.bytes - received + 64 * 1024 * 1024 {
            return Err("Not enough free disk space on the destination host.".into());
        }
        if received < release.bytes {
            let mut request = client
                .get(&release.url)
                .header("Accept-Encoding", "identity");
            if received > 0 {
                request = request.header("Range", format!("bytes={received}-"));
            }
            let response = tokio::time::timeout(Duration::from_secs(30), request.send())
                .await
                .map_err(|_| "download server did not respond; resume to retry")?
                .map_err(|e| e.to_string())?;
            if received > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                let expected = format!("bytes {received}-{}/{}", release.bytes - 1, release.bytes);
                if response
                    .headers()
                    .get("content-range")
                    .and_then(|v| v.to_str().ok())
                    != Some(expected.as_str())
                {
                    return Err("download server returned an inconsistent resume range".into());
                }
            } else if response.status() == reqwest::StatusCode::OK {
                received = 0;
            } else {
                return Err(format!("download server returned {}", response.status()));
            }
            let mut file = tokio::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .append(received > 0)
                .truncate(received == 0)
                .open(&partial)
                .await
                .map_err(|e| e.to_string())?;
            let initial = received;
            let started = Instant::now();
            let mut reported = Instant::now();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = tokio::time::timeout(Duration::from_secs(30), stream.next())
                .await
                .map_err(|_| "download stalled; resume to retry")?
            {
                let chunk = chunk.map_err(|e| e.to_string())?;
                if received + chunk.len() as u64 > release.bytes {
                    return Err("download exceeds declared release size".into());
                }
                file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                received += chunk.len() as u64;
                if reported.elapsed() >= Duration::from_secs(1) {
                    self.update(
                        id,
                        received,
                        ((received - initial) as f64 / started.elapsed().as_secs_f64()) as u64,
                        "downloading",
                    )
                    .await?;
                    reported = Instant::now();
                }
            }
            file.sync_all().await.map_err(|e| e.to_string())?;
        }
        if received != release.bytes {
            return Err("download ended before the declared size; resume to retry".into());
        }
        self.update(id, received, 0, "verifying").await?;
        verify_package(partial.clone(), &release).await?;
        if self.local_layout {
            tokio::fs::create_dir_all(&staging)
                .await
                .map_err(|e| e.to_string())?;
            let model_path = if self.state_path.parent().is_some_and(|p| root == p.join("models")) {
                format!("ginfer/models/{}/model.ginfer", release.sha256)
            } else { destination.to_string_lossy().into_owned() };
            let manifest = serde_json::json!({"model_path":model_path,
                "name":release.name,"size_bytes":release.bytes,"sha256":release.sha256,"identity":release.identity,
                "capabilities":release.capabilities,"embedding":false,"source":"local"});
            write_private(
                &staging.join("model.yml"),
                &serde_json::to_vec(&manifest).map_err(|e| e.to_string())?,
            )?;
            tokio::fs::rename(&partial, staging.join("model.ginfer"))
                .await
                .map_err(|e| e.to_string())?;
            tokio::fs::rename(&staging, root.join(&release.sha256))
                .await
                .map_err(|e| e.to_string())?;
        } else {
            tokio::fs::rename(&partial, &destination)
                .await
                .map_err(|e| e.to_string())?;
        }
        self.installed(id, destination).await
    }
    async fn installed(&self, id: Uuid, destination: PathBuf) -> Result<(), String> {
        let mut jobs = self.jobs.lock().await;
        let job = jobs.get_mut(&id).ok_or("unknown download")?;
        job.status = "installed".into();
        job.path = Some(destination);
        job.error = None;
        self.save(&jobs)
    }
}

async fn verify_package(path: PathBuf, release: &Release) -> Result<(), String> {
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| e.to_string())?;
    if file.metadata().await.map_err(|e| e.to_string())?.len() != release.bytes {
        return Err("package size differs from release".into());
    }
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let n = file.read(&mut buffer).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    drop(file);
    if hex::encode(hasher.finalize()) != release.sha256 {
        return Err("SHA256 mismatch; remove incomplete files and download again. Package was not installed.".into());
    }
    let metadata = tokio::task::spawn_blocking(move || inspect_artifact(&path))
        .await
        .map_err(|e| e.to_string())??;
    if metadata.identity != release.identity || metadata.tp_size != release.tp {
        return Err("package identity or TP differs from its release declaration".into());
    }
    if release.launch_profiles.iter().any(|profile| profile.draft_tp != metadata.draft_tp) {
        return Err("package draft TP differs from its qualified launch profiles".into());
    }
    Ok(())
}

pub async fn available_bytes(path: PathBuf) -> Result<u64, String> {
    #[cfg(windows)]
    let path = path
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_string();
    #[cfg(not(windows))]
    let output = tokio::process::Command::new("df")
        .args(["-B1", "--output=avail"])
        .arg(path)
        .output()
        .await;
    #[cfg(windows)]
    let output = tokio::process::Command::new("powershell.exe").creation_flags(0x08000000).args(["-NoProfile", "-NonInteractive", "-Command", "$p=[IO.Path]::GetPathRoot($env:GCHAT_TRANSFER_ROOT); ([IO.DriveInfo]::new($p)).AvailableFreeSpace"]).env("GCHAT_TRANSFER_ROOT", path).output().await;
    let output = output.map_err(|e| format!("cannot check destination disk space: {e}"))?;
    if !output.status.success() {
        return Err("cannot check destination disk space".into());
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .find_map(|line| line.trim().parse::<u64>().ok())
        .ok_or("unrecognized destination disk-space result".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Release, Vec<u8>) {
        let identity = ArtifactIdentity {
            model_id: "muse-glimmer-30b".into(),
            weights_id: "nvfp4".into(),
        };
        let directory = serde_json::to_vec(
            &serde_json::json!({"identity":identity,"tp_size":1,"draft_tp":0,"objects":[{"kind":"tensor","rank":"all","name":"fixture"}]}),
        )
        .unwrap();
        let mut bytes = b"NINFER\0\x03".to_vec();
        bytes.extend_from_slice(&(directory.len() as u64).to_le_bytes());
        bytes.extend(directory);
        bytes.resize(4096, 0);
        let mut release = Release {
            name: "Muse".into(),
            identity,
            url: format!(
                "https://huggingface.co/test/model/resolve/{}/model.ginfer",
                "a".repeat(40)
            ),
            sha256: hex::encode(Sha256::digest(&bytes)),
            bytes: bytes.len() as u64,
            tp: 1,
            qualified_sm: vec!["12.0".into()],
            min_vram_mib_per_gpu: 32768,
            capabilities: vec!["tools".into()],
            launch_profiles: vec![],
        };
        release.launch_profiles.push(serde_json::from_value(serde_json::json!({
            "id":"fixture-c1", "name":"Fixture C1", "identity":release.identity,
            "platform":std::env::consts::OS,
            "artifact_sha256":release.sha256, "artifact_bytes":release.bytes,
            "tp":1, "draft_tp":0, "gpu_name":"Fixture GPU", "compute_capability":"12.0",
            "vram_tier_gib":32, "min_memory_mib_per_gpu":32768, "max_context":4096,
            "concurrency":1, "options":{"spec":"none", "kv_arena_bytes":4096},
            "qualification":{"evidence":"synthetic test only", "engine_revision":"fixture",
                "tier":"full-context-tested", "free_bytes_per_gpu":1_u64 << 30, "full_context_requests":1}
        })).unwrap());
        (release, bytes)
    }
    #[test]
    fn release_profiles_reject_other_artifacts_and_duplicate_ids() {
        let (mut release, _) = fixture();
        release.validate().unwrap();
        release.launch_profiles[0].artifact_sha256 = "0".repeat(64);
        assert!(release.validate().is_err());
        release.launch_profiles[0].artifact_sha256 = release.sha256.clone();
        release.launch_profiles.push(release.launch_profiles[0].clone());
        assert!(release.validate().is_err());
    }

    async fn insert(manager: &ModelDownloads, release: Release) -> Uuid {
        let id = Uuid::new_v4();
        let mut jobs = manager.jobs.lock().await;
        jobs.insert(
            id,
            Download {
                id,
                release,
                status: "queued".into(),
                received: 0,
                bytes_per_second: 0,
                error: None,
                path: None,
                storage_root: manager.root(),
            },
        );
        manager.save(&jobs).unwrap();
        id
    }
    #[test]
    fn publication_requires_immutable_identity_and_integrity() {
        let (mut release, _) = fixture();
        release.validate().unwrap();
        release.url = release.url.replace(&"a".repeat(40), "main");
        assert!(release.validate().is_err());
        let (mut release, _) = fixture();
        release.bytes = u64::MAX;
        assert!(release.validate().is_err());
        let (mut release, _) = fixture();
        release.qualified_sm.clear();
        assert!(release.validate().is_err());
    }

    #[test]
    fn catalog_omits_unpublished_models_and_validates_published_packages() {
        let (release, _) = fixture();
        let catalog = serde_json::json!({"models":[
            {"library_name":"ginfer","releases":[release]},
            {"library_name":"ginfer","model_name":"not-published"}
        ]});
        assert_eq!(catalog_releases(&catalog).unwrap().len(), 1);
        let mut bad = catalog;
        bad["models"][0]["releases"][0]["sha256"] = serde_json::json!("invalid");
        assert!(catalog_releases(&bad).is_err());
    }

    #[tokio::test]
    async fn storage_change_preserves_existing_transfer_and_installed_package() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first");
        let second = dir.path().join("second");
        std::fs::create_dir(&second).unwrap();
        let state = dir.path().join("jobs.json");
        let manager = ModelDownloads::open(first.clone(), state.clone()).unwrap();
        let (release, bytes) = fixture();
        let id = insert(&manager, release.clone()).await;
        std::fs::write(first.join(format!("{id}.part")), bytes).unwrap();
        manager.set_root(second.clone());
        manager.transfer(id).await.unwrap();
        let installed = first.join(format!("{}.ginfer", release.sha256));
        assert!(installed.exists());
        assert!(!second.join(format!("{}.ginfer", release.sha256)).exists());
        let reopened = ModelDownloads::open(first, state).unwrap();
        reopened.set_root(second);
        assert_eq!(reopened.list().await[0].path.as_ref(), Some(&installed));
        reopened.remove_installed(&installed).await.unwrap();
        assert!(!installed.exists());
    }
    #[tokio::test]
    async fn complete_partial_is_verified_published_and_removed_only_from_managed_storage() {
        let dir = tempfile::tempdir().unwrap();
        let manager =
            ModelDownloads::open(dir.path().join("models"), dir.path().join("jobs.json")).unwrap();
        let (release, bytes) = fixture();
        let id = insert(&manager, release.clone()).await;
        std::fs::write(manager.root().join(format!("{id}.part")), &bytes).unwrap();
        manager.transfer(id).await.unwrap();
        let job = manager.list().await.pop().unwrap();
        assert_eq!(job.status, "installed");
        assert_eq!(std::fs::read(job.path.as_ref().unwrap()).unwrap(), bytes);
        let outside = dir.path().join("external.ginfer");
        std::fs::write(&outside, &bytes).unwrap();
        assert!(manager.remove_installed(&outside).await.is_err());
        assert!(outside.exists());
        manager
            .remove_installed(job.path.as_ref().unwrap())
            .await
            .unwrap();
        assert!(manager.list().await.is_empty());
    }
    #[tokio::test]
    async fn restart_pauses_work_and_discard_keeps_installed_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("models");
        let state = dir.path().join("jobs.json");
        let manager = ModelDownloads::open(root.clone(), state.clone()).unwrap();
        let (release, _) = fixture();
        let id = insert(&manager, release).await;
        std::fs::write(root.join(format!("{id}.part")), b"partial").unwrap();
        let installed = root.join("keep.ginfer");
        std::fs::write(&installed, b"existing").unwrap();
        drop(manager);
        let manager = ModelDownloads::open(root.clone(), state).unwrap();
        assert_eq!(manager.list().await[0].status, "paused");
        manager.action(id, "discard").await.unwrap();
        assert!(!root.join(format!("{id}.part")).exists());
        assert!(installed.exists());
    }
    #[tokio::test]
    async fn corrupted_partial_is_not_installed() {
        let dir = tempfile::tempdir().unwrap();
        let manager =
            ModelDownloads::open(dir.path().join("models"), dir.path().join("jobs.json")).unwrap();
        let (release, mut bytes) = fixture();
        let id = insert(&manager, release.clone()).await;
        bytes[4095] = 1;
        std::fs::write(manager.root().join(format!("{id}.part")), bytes).unwrap();
        assert!(manager.transfer(id).await.unwrap_err().contains("SHA256"));
        assert!(!manager
            .root()
            .join(format!("{}.ginfer", release.sha256))
            .exists());
    }

    #[tokio::test]
    async fn host_takes_over_desktop_journal_and_finishes_preserved_bytes_without_an_engine() {
        let directory = tempfile::tempdir().unwrap();
        let provider = directory.path().join("ginfer");
        let cache = provider.join("models");
        let journal = provider.join("model-downloads.json");
        let desktop = ModelDownloads::open_local(cache.clone(), journal).unwrap();
        let (release, bytes) = fixture();
        let id = insert(&desktop, release.clone()).await;
        std::fs::write(cache.join(format!("{id}.part")), &bytes).unwrap();
        drop(desktop);
        let host = crate::service::Host::open_with_model_storage(provider.join("host"), "Desktop".into(),
            provider.join("bin/missing-engine"), vec![], vec![], vec![], Some(provider.clone())).await.unwrap();
        let jobs = host.downloads.list().await;
        assert!(host.downloads.installed_profiles().await.unwrap().is_empty());
        assert_eq!(jobs[0].id, id);
        assert_eq!(jobs[0].status, "paused");
        assert_eq!(std::fs::read(cache.join(format!("{id}.part"))).unwrap(), bytes);
        host.downloads.action(id, "resume").await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if host.downloads.list().await[0].status == "installed" { break; }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        }).await.unwrap();
        let package = cache.join(&release.sha256);
        assert_eq!(std::fs::read(package.join("model.ginfer")).unwrap(), bytes);
        assert!(package.join("model.yml").is_file());
        assert_eq!(host.downloads.root(), cache.canonicalize().unwrap());
        host.scan().await.unwrap();
        assert_eq!(host.inventory.read().await.len(), 1);
        assert_eq!(host.launch_profiles.read().await[0].id, "fixture-c1");
        drop(host);
        let host = crate::service::Host::open_with_model_storage(provider.join("host"), "Desktop".into(),
            provider.join("bin/missing-engine"), vec![], vec![], vec![], Some(provider.clone())).await.unwrap();
        assert_eq!(host.launch_profiles.read().await[0].id, "fixture-c1");
        host.downloads.remove_installed(&package.join("model.ginfer")).await.unwrap();
        host.scan().await.unwrap();
        assert!(host.launch_profiles.read().await.is_empty());
    }

    #[tokio::test]
    async fn removed_managed_package_profiles_stay_removed_after_host_restart() {
        use crate::service::{Host, LaunchRequest};
        use hyper::{Body, Request, StatusCode};

        for fail_persistence in [false, true] {
            let directory = tempfile::tempdir().unwrap();
            let provider = directory.path().join("ginfer");
            let retained_models = directory.path().join("retained-models");
            std::fs::create_dir(&retained_models).unwrap();
            let (release, bytes) = fixture();
            std::fs::write(retained_models.join("keep.ginfer"), &bytes).unwrap();
            let state = provider.join("host");
            let engine = provider.join("bin/missing-engine");
            let host = Host::open_with_model_storage(state.clone(), "Test".into(), engine.clone(),
                vec![retained_models.clone()], vec![], vec![], Some(provider.clone())).await.unwrap();
            let download = insert(&host.downloads, release.clone()).await;
            std::fs::write(host.downloads.root().join(format!("{download}.part")), &bytes).unwrap();
            host.downloads.transfer(download).await.unwrap();
            host.scan().await.unwrap();
            let package = host.downloads.root().join(&release.sha256);
            let removed_path = package.join("model.ginfer");
            let models = host.inventory.read().await.clone();
            let removed_model = models.iter().find(|model| model.path == removed_path).unwrap().id;
            let retained_model = models.iter().find(|model| model.id != removed_model).unwrap().id;
            let removed_profile = Uuid::new_v4();
            let retained_profile = Uuid::new_v4();
            for (instance_id, model_id, gpu) in [
                (removed_profile, removed_model, "GPU-removed"),
                (retained_profile, retained_model, "GPU-retained"),
            ] {
                host.data.lock().await.profiles.insert(instance_id, LaunchRequest {
                    instance_id: Some(instance_id), qualified_profile_id: None, model_id,
                    gpu_uuids: vec![gpu.into()], max_context: 4096, concurrency: 1,
                    options: Default::default(),
                });
            }
            host.save().await.unwrap();
            let before = host.snapshot().await;
            let retained = before["instances"].as_array().unwrap().iter()
                .find(|instance| instance["instance_id"] == retained_profile.to_string()).unwrap().clone();
            let mappings = host.data.lock().await.models.clone();
            let durable_path = state.join("host.json");
            let saved = std::fs::read(&durable_path).unwrap();
            if fail_persistence {
                std::fs::remove_file(&durable_path).unwrap();
                std::fs::create_dir(&durable_path).unwrap();
            }
            let token = host.data.lock().await.pairing_admin_token.clone();
            let request = Request::post("/host/v1/remove-model")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(serde_json::json!({"model_id":removed_model}).to_string())).unwrap();
            let response = host.clone().route(request).await.unwrap();
            assert_eq!(response.status(), if fail_persistence { StatusCode::BAD_REQUEST } else { StatusCode::OK });
            if fail_persistence {
                std::fs::remove_dir(&durable_path).unwrap();
                std::fs::write(&durable_path, saved).unwrap();
                host.scan().await.unwrap();
            }
            assert!(!package.exists());
            assert!(host.downloads.list().await.is_empty());
            let after = host.snapshot().await;
            assert_eq!(after["instances"], serde_json::json!([retained.clone()]));
            assert_eq!(after["host_id"], before["host_id"]);
            assert_eq!(after["boot_id"], before["boot_id"]);
            drop(host);

            let reopened = Host::open_with_model_storage(state, "Ignored".into(), engine,
                vec![retained_models], vec![], vec![], Some(provider)).await.unwrap();
            let restored = reopened.snapshot().await;
            assert_eq!(restored["instances"], serde_json::json!([retained]));
            assert_eq!(restored["host_id"], before["host_id"]);
            assert_eq!(restored["models"].as_array().unwrap().len(), 1);
            assert_eq!(restored["models"][0]["id"], retained_model.to_string());
            assert_eq!(reopened.data.lock().await.models, mappings);
        }
    }

    #[tokio::test]
    async fn managed_payload_removal_cleans_profiles_after_download_journal_write_failure() {
        use crate::{
            engine_registry::{EngineRegistry, HostSnapshot, RegisteredHost},
            service::{Host, LaunchRequest},
        };
        use hyper::{Body, Request, StatusCode};

        let directory = tempfile::tempdir().unwrap();
        let provider = directory.path().join("ginfer");
        let retained_models = directory.path().join("retained-models");
        std::fs::create_dir(&retained_models).unwrap();
        let (release, bytes) = fixture();
        std::fs::write(retained_models.join("keep.ginfer"), &bytes).unwrap();
        let state = provider.join("host");
        let engine = provider.join("bin/missing-engine");
        let set_path = provider.join("deployment.json");
        let host = Host::open_with_model_storage(state.clone(), "Test".into(), engine.clone(),
            vec![retained_models.clone()], vec![set_path.clone()], vec![], Some(provider.clone())).await.unwrap();
        let download = insert(&host.downloads, release.clone()).await;
        std::fs::write(host.downloads.root().join(format!("{download}.part")), &bytes).unwrap();
        host.downloads.transfer(download).await.unwrap();
        let descriptor = serde_json::json!({"schema":"ginfer-artifact-set-v1",
            "identity":{"model_id":release.identity.model_id,"weights_id":release.identity.weights_id,"family_id":"a".repeat(64)},
            "canonical_reconstructed_target_sha256":"b".repeat(64),"canonical_reconstructed_draft_sha256":null,
            "artifacts":[{"tp":1,"draft_tp":0,"path":format!("models/{}/model.ginfer", release.sha256),
                "bytes":release.bytes,"sha256":release.sha256}]});
        std::fs::write(&set_path, descriptor.to_string()).unwrap();
        host.scan().await.unwrap();
        let package = host.downloads.root().join(&release.sha256);
        let models = host.inventory.read().await.clone();
        let raw = models.iter().find(|model| model.path == package.join("model.ginfer")).unwrap().id;
        let alias = models.iter().find(|model| model.artifact_set).unwrap().id;
        let retained_model = models.iter().find(|model| model.path == retained_models.join("keep.ginfer")).unwrap().id;
        let retained_profile = Uuid::new_v4();
        for (instance_id, model_id, gpu) in [
            (Uuid::new_v4(), raw, "GPU-raw"),
            (Uuid::new_v4(), alias, "GPU-alias"),
            (retained_profile, retained_model, "GPU-retained"),
        ] {
            host.data.lock().await.profiles.insert(instance_id, LaunchRequest {
                instance_id: Some(instance_id), qualified_profile_id: None, model_id,
                gpu_uuids: vec![gpu.into()], max_context: 4096, concurrency: 1,
                options: Default::default(),
            });
        }
        host.save().await.unwrap();
        let before = host.snapshot().await;
        let before_typed: HostSnapshot = serde_json::from_value(before.clone()).unwrap();
        let mut registry = EngineRegistry::default();
        registry.register_paired(RegisteredHost {
            host_id: before_typed.host_id,
            display_name: before_typed.display_name.clone(),
            credential_ref: "fixture-credential".into(),
            certificate_sha256: host.data.lock().await.certificate.fingerprint(),
        });
        let connection = registry.connect(before_typed.host_id).unwrap();
        registry.reconcile(connection, before_typed).unwrap();
        let retained = before["instances"].as_array().unwrap().iter()
            .find(|instance| instance["instance_id"] == retained_profile.to_string()).unwrap().clone();
        let mappings = host.data.lock().await.models.clone();
        let journal = provider.join("model-downloads.json");
        let saved_journal = std::fs::read(&journal).unwrap();
        std::fs::remove_file(&journal).unwrap();
        std::fs::create_dir(&journal).unwrap();
        let journal_error = std::fs::write(&journal, b"{}").unwrap_err().to_string();
        let token = host.data.lock().await.pairing_admin_token.clone();
        let request = Request::post("/host/v1/remove-model")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(serde_json::json!({"model_id":raw}).to_string())).unwrap();
        let response = host.clone().route(request).await.unwrap();
        let status = response.status();
        let body: serde_json::Value = serde_json::from_slice(
            &hyper::body::to_bytes(response.into_body()).await.unwrap()).unwrap();
        let package_removed = !package.exists();
        let jobs_after_failure = host.downloads.list().await;
        let after_failure = host.snapshot().await;
        let after_typed: HostSnapshot = serde_json::from_value(after_failure.clone()).unwrap();
        let reconciliation = registry.reconcile(connection, after_typed);
        let persisted_after_failure: serde_json::Value = serde_json::from_slice(
            &std::fs::read(state.join("host.json")).unwrap()).unwrap();
        std::fs::remove_dir(&journal).unwrap();
        std::fs::write(&journal, saved_journal).unwrap();
        let retry = host.scan().await;
        drop(host);
        let reopened = Host::open_with_model_storage(state, "Ignored".into(), engine,
            vec![retained_models], vec![set_path], vec![], Some(provider)).await.unwrap();
        let restored = reopened.snapshot().await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        reconciliation.unwrap();
        assert!(body["error"].as_str().unwrap().contains(&journal_error));
        assert!(package_removed);
        assert!(jobs_after_failure.is_empty());
        assert_eq!(after_failure["instances"], serde_json::json!([retained.clone()]));
        assert!(after_failure["revision"].as_u64().unwrap() > before["revision"].as_u64().unwrap());
        assert_eq!(persisted_after_failure["profiles"].as_object().unwrap().len(), 1);
        assert_eq!(persisted_after_failure["profiles"][retained_profile.to_string()], retained["profile"]);
        retry.unwrap();
        assert!(reopened.downloads.list().await.is_empty());
        assert_eq!(restored["instances"], serde_json::json!([retained]));
        assert_eq!(restored["models"].as_array().unwrap().len(), 1);
        assert_eq!(restored["models"][0]["id"], retained_model.to_string());
        assert_eq!(restored["host_id"], before["host_id"]);
        assert_eq!(after_failure["boot_id"], before["boot_id"]);
        assert_eq!(reopened.data.lock().await.models, mappings);
    }

    #[tokio::test]
    async fn managed_payload_removal_durably_removes_all_descriptor_aliases() {
        use crate::service::{Host, LaunchRequest};
        use hyper::{Body, Request, StatusCode};

        let directory = tempfile::tempdir().unwrap();
        let provider = directory.path().join("ginfer");
        let retained_models = directory.path().join("retained-models");
        std::fs::create_dir(&retained_models).unwrap();
        let (release, bytes) = fixture();
        std::fs::write(retained_models.join("keep.ginfer"), &bytes).unwrap();
        let state = provider.join("host");
        let engine = provider.join("bin/missing-engine");
        let set_path = provider.join("deployment.json");
        let unrelated_set = provider.join("unrelated-deployment.json");
        let host = Host::open_with_model_storage(state.clone(), "Test".into(), engine.clone(),
            vec![retained_models.clone()], vec![set_path.clone(), unrelated_set.clone()], vec![], Some(provider.clone())).await.unwrap();
        let download = insert(&host.downloads, release.clone()).await;
        std::fs::write(host.downloads.root().join(format!("{download}.part")), &bytes).unwrap();
        host.downloads.transfer(download).await.unwrap();
        let mut declared = vec![serde_json::json!({"tp":1,"draft_tp":0,
            "path":format!("models/{}/model.ginfer", release.sha256),"bytes":release.bytes,"sha256":release.sha256})];
        for tp in [2, 4] {
            let metadata = serde_json::json!({"identity":release.identity,"tp_size":tp,"draft_tp":0,
                "objects":[{"kind":"tensor","rank":"all","name":"fixture"}]}).to_string();
            let mut payload = b"NINFER\0\x03".to_vec();
            payload.extend((metadata.len() as u64).to_le_bytes());
            payload.extend(metadata.as_bytes());
            payload.resize(4096, 0);
            let name = format!("tp{tp}.ginfer");
            std::fs::write(provider.join(&name), &payload).unwrap();
            declared.push(serde_json::json!({"tp":tp,"draft_tp":0,"path":name,
                "bytes":payload.len(),"sha256":hex::encode(Sha256::digest(&payload))}));
        }
        let descriptor = serde_json::json!({"schema":"ginfer-artifact-set-v1",
            "identity":{"model_id":release.identity.model_id,"weights_id":release.identity.weights_id,"family_id":"a".repeat(64)},
            "canonical_reconstructed_target_sha256":"b".repeat(64),"canonical_reconstructed_draft_sha256":null,
            "artifacts":declared});
        std::fs::write(&set_path, descriptor.to_string()).unwrap();
        let unrelated_payload = provider.join("unrelated.ginfer");
        std::fs::write(&unrelated_payload, &bytes).unwrap();
        let mut unrelated_descriptor = descriptor.clone();
        unrelated_descriptor["artifacts"] = serde_json::json!([
            {"tp":1,"draft_tp":0,"path":"unrelated.ginfer","bytes":release.bytes,"sha256":release.sha256}
        ]);
        std::fs::write(&unrelated_set, unrelated_descriptor.to_string()).unwrap();
        host.scan().await.unwrap();
        let package = host.downloads.root().join(&release.sha256);
        let removed_path = package.join("model.ginfer");
        let models = host.inventory.read().await.clone();
        let removed_model = models.iter().find(|model| model.path == removed_path).unwrap().id;
        assert_eq!(models.len(), 6);
        let retained_model = models.iter().find(|model| model.path == retained_models.join("keep.ginfer")).unwrap().id;
        let dependent_models: Vec<_> = models.iter().filter(|model| model.path == set_path).map(|model| model.id).collect();
        let unrelated_model = models.iter().find(|model| model.path == unrelated_set).unwrap().id;
        assert_eq!(dependent_models.len(), 3);
        let removed_profile = Uuid::new_v4();
        let retained_profile = Uuid::new_v4();
        let mut profiles = vec![
            (removed_profile, removed_model, "GPU-removed"),
            (retained_profile, retained_model, "GPU-retained"),
            (Uuid::new_v4(), Uuid::new_v4(), "GPU-unavailable"),
            (Uuid::new_v4(), unrelated_model, "GPU-unrelated-set"),
        ];
        for (degree, model_id) in dependent_models.iter().enumerate() {
            profiles.push((Uuid::new_v4(), *model_id, match degree { 0 => "GPU-tp1", 1 => "GPU-tp2", _ => "GPU-tp4" }));
        }
        for (instance_id, model_id, gpu) in profiles {
            host.data.lock().await.profiles.insert(instance_id, LaunchRequest {
                instance_id: Some(instance_id), qualified_profile_id: None, model_id,
                gpu_uuids: vec![gpu.into()], max_context: 4096, concurrency: 1,
                options: Default::default(),
            });
        }
        host.save().await.unwrap();
        let before = host.snapshot().await;
        let retained: Vec<_> = before["instances"].as_array().unwrap().iter()
            .filter(|instance| {
                let model_id = instance["profile"]["model_id"].as_str().unwrap().parse::<Uuid>().unwrap();
                model_id != removed_model && !dependent_models.contains(&model_id)
            }).cloned().collect();
        assert_eq!(retained.len(), 3);
        let mappings = host.data.lock().await.models.clone();
        // Losing an unrelated member after scan must not block this removal
        // or prune that descriptor's saved profile.
        std::fs::remove_file(&unrelated_payload).unwrap();
        let token = host.data.lock().await.pairing_admin_token.clone();
        let request = Request::post("/host/v1/remove-model")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(serde_json::json!({"model_id":removed_model}).to_string())).unwrap();
        let response = host.clone().route(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(!package.exists());
        assert!(host.downloads.list().await.is_empty());
        let after = host.snapshot().await;
        assert_eq!(after["instances"], serde_json::json!(retained.clone()));
        assert_eq!(after["host_id"], before["host_id"]);
        assert_eq!(after["boot_id"], before["boot_id"]);
        drop(host);

        let reopened = Host::open_with_model_storage(state, "Ignored".into(), engine,
            vec![retained_models], vec![set_path, unrelated_set], vec![], Some(provider)).await.unwrap();
        let restored = reopened.snapshot().await;
        assert_eq!(restored["instances"], serde_json::json!(retained));
        assert_eq!(restored["host_id"], before["host_id"]);
        assert_eq!(restored["models"].as_array().unwrap().len(), 1);
        assert_eq!(restored["models"][0]["id"], retained_model.to_string());
        assert_eq!(reopened.data.lock().await.models, mappings);
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn managed_payload_removal_rejects_active_dependent_artifact_set() {
        active_dependent_artifact_set_removal(false).await;
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn managed_payload_removal_rejects_active_alias_after_invalidating_rescan() {
        active_dependent_artifact_set_removal(true).await;
    }

    #[cfg(unix)]
    async fn active_dependent_artifact_set_removal(invalidate_sibling: bool) {
        use crate::service::{Gpu, Host, LaunchRequest};
        use hyper::{Body, Request, StatusCode};
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let provider = directory.path().join("ginfer");
        let engine = provider.join("bin/fixture-engine");
        std::fs::create_dir_all(engine.parent().unwrap()).unwrap();
        std::fs::write(&engine, "#!/bin/sh\nexec sleep 60\n").unwrap();
        std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o700)).unwrap();
        let set_path = provider.join("deployment.json");
        let host = Host::open_with_model_storage(provider.join("host"), "Test".into(), engine,
            vec![], vec![set_path.clone()], vec![Gpu {
                uuid: "GPU-test".into(), name: "Test".into(), display_name: None,
                memory_mib: 32768, compute_capability: Some("12.0".into()),
            }], Some(provider.clone())).await.unwrap();
        let (release, bytes) = fixture();
        let download = insert(&host.downloads, release.clone()).await;
        std::fs::write(host.downloads.root().join(format!("{download}.part")), &bytes).unwrap();
        host.downloads.transfer(download).await.unwrap();
        let metadata = serde_json::json!({"identity":release.identity,"tp_size":2,"draft_tp":0,
            "objects":[{"kind":"tensor","rank":"all","name":"fixture"}]}).to_string();
        let mut sibling = b"NINFER\0\x03".to_vec();
        sibling.extend((metadata.len() as u64).to_le_bytes());
        sibling.extend(metadata.as_bytes());
        sibling.resize(4096, 0);
        let sibling_path = provider.join("tp2.ginfer");
        std::fs::write(&sibling_path, &sibling).unwrap();
        let descriptor = serde_json::json!({"schema":"ginfer-artifact-set-v1",
            "identity":{"model_id":release.identity.model_id,"weights_id":release.identity.weights_id,"family_id":"a".repeat(64)},
            "canonical_reconstructed_target_sha256":"b".repeat(64),"canonical_reconstructed_draft_sha256":null,
            "artifacts":[{"tp":1,"draft_tp":0,"path":format!("models/{}/model.ginfer", release.sha256),
                "bytes":release.bytes,"sha256":release.sha256},
                {"tp":2,"draft_tp":0,"path":"tp2.ginfer","bytes":sibling.len(),
                    "sha256":hex::encode(Sha256::digest(&sibling))}]});
        std::fs::write(&set_path, descriptor.to_string()).unwrap();
        host.scan().await.unwrap();
        let models = host.inventory.read().await.clone();
        let raw = models.iter().find(|model| !model.artifact_set).unwrap();
        let dependent = models.iter().find(|model| model.artifact_set && model.metadata.tp_size == 1).unwrap();
        host.launch(LaunchRequest {
            instance_id: None, qualified_profile_id: None, model_id: dependent.id,
            gpu_uuids: vec!["GPU-test".into()], max_context: 4096, concurrency: 1,
            options: Default::default(),
        }).await.unwrap();
        if invalidate_sibling {
            std::fs::remove_file(&sibling_path).unwrap();
            host.scan().await.unwrap();
        }
        let before = host.snapshot().await;
        let saved_profiles = std::fs::read(provider.join("host/host.json")).unwrap();
        let jobs = serde_json::to_value(host.downloads.list().await).unwrap();
        let token = host.data.lock().await.pairing_admin_token.clone();
        let request = Request::post("/host/v1/remove-model")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(serde_json::json!({"model_id":raw.id}).to_string())).unwrap();
        let response = host.clone().route(request).await;
        let after = host.snapshot().await;
        let after_saved_profiles = std::fs::read(provider.join("host/host.json")).unwrap();
        let after_jobs = serde_json::to_value(host.downloads.list().await).unwrap();
        host.processes.lock().await.shutdown().await.unwrap();
        assert_eq!(before["instances"][0]["status"], "starting");
        if invalidate_sibling {
            assert_eq!(before["models"].as_array().unwrap().len(), 1);
            assert_eq!(before["models"][0]["id"], raw.id.to_string());
        } else {
            assert_eq!(before["models"].as_array().unwrap().len(), 3);
        }
        assert_eq!(response.unwrap().status(), StatusCode::BAD_REQUEST);
        assert!(raw.path.exists());
        assert_eq!(after_jobs, jobs);
        assert_eq!(after_saved_profiles, saved_profiles);
        assert_eq!(after["instances"], before["instances"]);
        assert_eq!(after["host_id"], before["host_id"]);
        assert_eq!(after["boot_id"], before["boot_id"]);
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn managed_payload_removal_uses_launched_dependencies_after_descriptor_rewrite() {
        descriptor_rewrite_removal(false).await;
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn managed_payload_removal_preserves_stopped_alias_after_descriptor_rewrite() {
        descriptor_rewrite_removal(true).await;
    }

    #[cfg(unix)]
    async fn descriptor_rewrite_removal(stop_before_rewrite: bool) {
        use crate::service::{Gpu, Host, LaunchRequest};
        use hyper::{Body, Request, StatusCode};
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let provider = directory.path().join("ginfer");
        let engine = provider.join("bin/fixture-engine");
        std::fs::create_dir_all(engine.parent().unwrap()).unwrap();
        std::fs::write(&engine, "#!/bin/sh\nexec sleep 60\n").unwrap();
        std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o700)).unwrap();
        let set_path = provider.join("deployment.json");
        let host = Host::open_with_model_storage(provider.join("host"), "Test".into(), engine,
            vec![], vec![set_path.clone()], vec![Gpu {
                uuid: "GPU-test".into(), name: "Test".into(), display_name: None,
                memory_mib: 32768, compute_capability: Some("12.0".into()),
            }], Some(provider.clone())).await.unwrap();
        let (release_a, bytes_a) = fixture();
        let mut release_b = release_a.clone();
        let mut bytes_b = bytes_a.clone();
        bytes_b[4095] = 1;
        release_b.sha256 = hex::encode(Sha256::digest(&bytes_b));
        for profile in &mut release_b.launch_profiles {
            profile.id.push_str("-b");
            profile.artifact_sha256 = release_b.sha256.clone();
        }
        for (release, bytes) in [(&release_a, &bytes_a), (&release_b, &bytes_b)] {
            let id = insert(&host.downloads, release.clone()).await;
            std::fs::write(host.downloads.root().join(format!("{id}.part")), bytes).unwrap();
            host.downloads.transfer(id).await.unwrap();
        }
        let mut descriptor = serde_json::json!({"schema":"ginfer-artifact-set-v1",
            "identity":{"model_id":release_a.identity.model_id,"weights_id":release_a.identity.weights_id,"family_id":"a".repeat(64)},
            "canonical_reconstructed_target_sha256":"b".repeat(64),"canonical_reconstructed_draft_sha256":null,
            "artifacts":[{"tp":1,"draft_tp":0,"path":format!("models/{}/model.ginfer", release_a.sha256),
                "bytes":release_a.bytes,"sha256":release_a.sha256}]});
        std::fs::write(&set_path, descriptor.to_string()).unwrap();
        host.scan().await.unwrap();
        let package_a = host.downloads.root().join(&release_a.sha256);
        let package_b = host.downloads.root().join(&release_b.sha256);
        let models = host.inventory.read().await.clone();
        let raw_a = models.iter().find(|model| model.path == package_a.join("model.ginfer")).unwrap().id;
        let raw_b = models.iter().find(|model| model.path == package_b.join("model.ginfer")).unwrap().id;
        let alias = models.iter().find(|model| model.artifact_set).unwrap().id;
        let active = host.launch(LaunchRequest {
            instance_id: None, qualified_profile_id: None, model_id: alias,
            gpu_uuids: vec!["GPU-test".into()], max_context: 4096, concurrency: 1,
            options: Default::default(),
        }).await.unwrap();
        let token = host.data.lock().await.pairing_admin_token.clone();
        let stopped_before_rewrite = if stop_before_rewrite {
            let stop = Request::post(format!("/host/v1/instances/{active}/stop"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from("{}")).unwrap();
            Some(host.clone().route(stop).await)
        } else {
            None
        };
        descriptor["artifacts"][0]["path"] = serde_json::json!(format!("models/{}/model.ginfer", release_b.sha256));
        descriptor["artifacts"][0]["sha256"] = serde_json::json!(release_b.sha256);
        std::fs::write(&set_path, descriptor.to_string()).unwrap();
        host.scan().await.unwrap();
        if stop_before_rewrite {
            let before = host.snapshot().await;
            let remove = Request::post("/host/v1/remove-model")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(serde_json::json!({"model_id":raw_a}).to_string())).unwrap();
            let removed = host.clone().route(remove).await;
            let after = host.snapshot().await;
            let jobs = host.downloads.list().await;
            let persisted: serde_json::Value = serde_json::from_slice(
                &std::fs::read(provider.join("host/host.json")).unwrap()).unwrap();
            host.processes.lock().await.shutdown().await.unwrap();
            drop(host);
            let reopened = Host::open_with_model_storage(provider.join("host"), "Ignored".into(),
                provider.join("bin/fixture-engine"), vec![], vec![set_path], vec![], Some(provider)).await.unwrap();
            let restored = reopened.snapshot().await;

            assert_eq!(stopped_before_rewrite.unwrap().unwrap().status(), StatusCode::OK);
            assert_eq!(before["instances"][0]["status"], "stopped");
            assert_eq!(removed.unwrap().status(), StatusCode::OK);
            assert!(!package_a.exists());
            assert!(package_b.join("model.ginfer").exists());
            assert_eq!(jobs.len(), 1);
            assert_eq!(jobs[0].release.sha256, release_b.sha256);
            assert_eq!(after["instances"], before["instances"]);
            assert_eq!(persisted["profiles"].as_object().unwrap().len(), 1);
            assert_eq!(persisted["profiles"][active.to_string()], before["instances"][0]["profile"]);
            assert_eq!(restored["instances"].as_array().unwrap().len(), 1);
            assert_eq!(restored["instances"][0]["profile"], before["instances"][0]["profile"]);
            assert_eq!(restored["models"].as_array().unwrap().len(), 2);
            assert_eq!(restored["host_id"], before["host_id"]);
            return;
        }
        let stopped_raw = Uuid::new_v4();
        let stopped_alias = Uuid::new_v4();
        for (instance_id, model_id, gpu) in [
            (stopped_raw, raw_b, "GPU-stopped-raw"),
            (stopped_alias, alias, "GPU-stopped-alias"),
        ] {
            host.data.lock().await.profiles.insert(instance_id, LaunchRequest {
                instance_id: Some(instance_id), qualified_profile_id: None, model_id,
                gpu_uuids: vec![gpu.into()], max_context: 4096, concurrency: 1,
                options: Default::default(),
            });
        }
        host.save().await.unwrap();
        let before = host.snapshot().await;
        let active_before = before["instances"].as_array().unwrap().iter()
            .find(|instance| instance["instance_id"] == active.to_string()).unwrap().clone();
        let remove_request = |model_id| Request::post("/host/v1/remove-model")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(serde_json::json!({"model_id":model_id}).to_string())).unwrap();
        let protected_a = host.clone().route(remove_request(raw_a)).await;
        let after_a = host.snapshot().await;
        let a_survived = package_a.exists();
        let removed_b = host.clone().route(remove_request(raw_b)).await;
        let after_b = host.snapshot().await;
        let jobs_after_b = host.downloads.list().await;
        let persisted_after_b: serde_json::Value = serde_json::from_slice(
            &std::fs::read(provider.join("host/host.json")).unwrap()).unwrap();
        let stop = Request::post(format!("/host/v1/instances/{active}/stop"))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(serde_json::json!({"expected_session_id":active_before["session_id"]}).to_string())).unwrap();
        let stopped = host.clone().route(stop).await;
        let removed_a = host.clone().route(remove_request(raw_a)).await;
        let persisted_after_a: serde_json::Value = serde_json::from_slice(
            &std::fs::read(provider.join("host/host.json")).unwrap()).unwrap();
        host.processes.lock().await.shutdown().await.unwrap();

        assert_eq!(before["models"].as_array().unwrap().len(), 3);
        assert_eq!(active_before["status"], "starting");
        assert_eq!(protected_a.unwrap().status(), StatusCode::BAD_REQUEST);
        assert!(a_survived);
        assert_eq!(after_a["instances"], before["instances"]);
        assert_eq!(removed_b.unwrap().status(), StatusCode::OK);
        assert!(!package_b.exists());
        assert_eq!(jobs_after_b.len(), 1);
        assert_eq!(jobs_after_b[0].release.sha256, release_a.sha256);
        assert_eq!(after_b["instances"], serde_json::json!([active_before.clone()]));
        assert_eq!(persisted_after_b["profiles"].as_object().unwrap().len(), 1);
        assert_eq!(persisted_after_b["profiles"][active.to_string()], active_before["profile"]);
        assert_eq!(after_b["host_id"], before["host_id"]);
        assert_eq!(after_b["boot_id"], before["boot_id"]);
        assert_eq!(stopped.unwrap().status(), StatusCode::OK);
        assert_eq!(removed_a.unwrap().status(), StatusCode::OK);
        assert!(!package_a.exists());
        assert!(host.downloads.list().await.is_empty());
        assert!(persisted_after_a["profiles"].as_object().unwrap().is_empty());
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn managed_payload_removal_preserves_profile_restored_after_failed_launch() {
        use crate::service::{Gpu, Host, LaunchRequest};
        use hyper::{Body, Request, StatusCode};
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let provider = directory.path().join("ginfer");
        let engine = provider.join("bin/fixture-engine");
        std::fs::create_dir_all(engine.parent().unwrap()).unwrap();
        std::fs::write(&engine, "#!/bin/sh\nexec sleep 60\n").unwrap();
        std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o700)).unwrap();
        let host = Host::open_with_model_storage(provider.join("host"), "Test".into(), engine.clone(),
            vec![], vec![], vec![Gpu {
                uuid: "GPU-test".into(), name: "Test".into(), display_name: None,
                memory_mib: 32768, compute_capability: Some("12.0".into()),
            }], Some(provider.clone())).await.unwrap();
        let (release_a, bytes_a) = fixture();
        let mut release_b = release_a.clone();
        let mut bytes_b = bytes_a.clone();
        bytes_b[4095] = 1;
        release_b.sha256 = hex::encode(Sha256::digest(&bytes_b));
        for profile in &mut release_b.launch_profiles {
            profile.id.push_str("-b");
            profile.artifact_sha256 = release_b.sha256.clone();
        }
        for (release, bytes) in [(&release_a, &bytes_a), (&release_b, &bytes_b)] {
            let id = insert(&host.downloads, release.clone()).await;
            std::fs::write(host.downloads.root().join(format!("{id}.part")), bytes).unwrap();
            host.downloads.transfer(id).await.unwrap();
        }
        host.scan().await.unwrap();
        let package_a = host.downloads.root().join(&release_a.sha256);
        let package_b = host.downloads.root().join(&release_b.sha256);
        let models = host.inventory.read().await.clone();
        let raw_a = models.iter().find(|model| model.path == package_a.join("model.ginfer")).unwrap().id;
        let raw_b = models.iter().find(|model| model.path == package_b.join("model.ginfer")).unwrap().id;
        let mut profile = LaunchRequest {
            instance_id: None, qualified_profile_id: None, model_id: raw_b,
            gpu_uuids: vec!["GPU-test".into()], max_context: 4096, concurrency: 1,
            options: Default::default(),
        };
        let instance = host.launch(profile.clone()).await.unwrap();
        let token = host.data.lock().await.pairing_admin_token.clone();
        let stop = Request::post(format!("/host/v1/instances/{instance}/stop"))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from("{}")).unwrap();
        let stopped = host.clone().route(stop).await;
        let before = host.snapshot().await;
        let saved_path = provider.join("host/host.json");
        let saved = std::fs::read(&saved_path).unwrap();
        std::fs::remove_file(&saved_path).unwrap();
        std::fs::create_dir(&saved_path).unwrap();
        profile.instance_id = Some(instance);
        profile.model_id = raw_a;
        let failed_launch = host.launch(profile).await;
        let after_failed = host.snapshot().await;
        std::fs::remove_dir(&saved_path).unwrap();
        std::fs::write(&saved_path, saved).unwrap();
        let remove = Request::post("/host/v1/remove-model")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(serde_json::json!({"model_id":raw_a}).to_string())).unwrap();
        let removed = host.clone().route(remove).await;
        let after = host.snapshot().await;
        let jobs = host.downloads.list().await;
        host.processes.lock().await.shutdown().await.unwrap();
        drop(host);
        let reopened = Host::open_with_model_storage(provider.join("host"), "Ignored".into(), engine,
            vec![], vec![], vec![], Some(provider.clone())).await.unwrap();
        let restored = reopened.snapshot().await;

        assert_eq!(stopped.unwrap().status(), StatusCode::OK);
        assert!(failed_launch.unwrap_err().contains("could not persist launch profile"));
        assert_eq!(after_failed["instances"][0]["status"], "stopped");
        assert_eq!(after_failed["instances"][0]["configuration"]["artifact"], serde_json::json!(package_a.join("model.ginfer")));
        assert_ne!(after_failed["instances"][0]["session_id"], before["instances"][0]["session_id"]);
        assert_eq!(after_failed["instances"][0]["profile"], before["instances"][0]["profile"]);
        assert_eq!(removed.unwrap().status(), StatusCode::OK);
        assert!(!package_a.exists());
        assert!(package_b.join("model.ginfer").exists());
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].release.sha256, release_b.sha256);
        assert_eq!(after["instances"][0]["profile"], before["instances"][0]["profile"]);
        assert_eq!(restored["instances"].as_array().unwrap().len(), 1);
        assert_eq!(restored["instances"][0]["profile"], before["instances"][0]["profile"]);
        assert_eq!(restored["host_id"], before["host_id"]);
    }

    #[tokio::test]
    async fn local_install_publishes_manifest_and_identity_and_recovers_after_publication() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("ginfer/models");
        let manager =
            ModelDownloads::open_local(root.clone(), dir.path().join("ginfer/jobs.json")).unwrap();
        let (release, bytes) = fixture();
        let id = insert(&manager, release.clone()).await;
        std::fs::write(root.join(format!("{id}.part")), bytes).unwrap();
        manager.transfer(id).await.unwrap();
        let destination = root.join(&release.sha256);
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(destination.join("model.yml")).unwrap()).unwrap();
        assert_eq!(manifest["identity"]["model_id"], "muse-glimmer-30b");
        assert_eq!(manifest["capabilities"], serde_json::json!(["tools"]));
        assert_eq!(
            manifest["model_path"],
            format!("ginfer/models/{}/model.ginfer", release.sha256)
        );
        assert!(destination.join("model.ginfer").exists());
        manager.jobs.lock().await.get_mut(&id).unwrap().status = "queued".into();
        manager.transfer(id).await.unwrap();
        assert_eq!(manager.list().await[0].status, "installed");
        manager.remove_installed(&destination.join("model.ginfer")).await.unwrap();
        assert!(!destination.exists());
        assert!(manager.list().await.is_empty());
    }
    #[tokio::test]
    async fn resumes_with_exact_range_and_verifies_whole_result() {
        use hyper::{service::service_fn, Body, Response};
        let (mut release, bytes) = fixture();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        release.url = format!("http://{}/model.ginfer", listener.local_addr().unwrap());
        let body = bytes[128..].to_vec();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            hyper::server::conn::Http::new()
                .serve_connection(
                    stream,
                    service_fn(move |req: hyper::Request<Body>| {
                        assert_eq!(req.headers()["range"], "bytes=128-");
                        let body = body.clone();
                        async move {
                            Ok::<_, std::convert::Infallible>(
                                Response::builder()
                                    .status(206)
                                    .header("content-range", "bytes 128-4095/4096")
                                    .body(Body::from(body))
                                    .unwrap(),
                            )
                        }
                    }),
                )
                .await
                .unwrap();
        });
        let dir = tempfile::tempdir().unwrap();
        let manager =
            ModelDownloads::open(dir.path().join("models"), dir.path().join("jobs.json")).unwrap();
        let id = insert(&manager, release).await;
        std::fs::write(manager.root().join(format!("{id}.part")), &bytes[..128]).unwrap();
        manager
            .transfer_with_client(id, Some(reqwest::Client::builder().no_proxy().build().unwrap()))
            .await
            .unwrap();
        assert_eq!(manager.list().await[0].status, "installed");
        server.abort();
    }

    #[test]
    fn pause_before_and_after_admission_retains_complete_partial_and_resume_installs() {
        tokio::runtime::Builder::new_current_thread().enable_all().max_blocking_threads(1)
            .build().unwrap().block_on(async {
                for pause_before_admission in [true, false] {
                    let dir = tempfile::tempdir().unwrap();
                    let journal = dir.path().join("jobs.json");
                    let manager = ModelDownloads::open(dir.path().join("models"), journal.clone()).unwrap();
                    let (release, bytes) = fixture();
                    let destination = manager.root().join(format!("{}.ginfer", release.sha256));
                    let id = insert(&manager, release).await;
                    let partial = manager.root().join(format!("{id}.part"));
                    std::fs::write(&partial, &bytes).unwrap();
                    if pause_before_admission {
                        manager.action(id, "pause").await.unwrap();
                        manager.transfer(id).await.unwrap();
                    } else {
                        let (unblock, blocked) = std::sync::mpsc::channel();
                        let (started, ready) = tokio::sync::oneshot::channel();
                        let blocker = tokio::task::spawn_blocking(move || {
                            let _ = started.send(());
                            let _ = blocked.recv();
                        });
                        ready.await.unwrap();
                        manager.spawn(id);
                        // On this current-thread runtime, the uncontended
                        // worker holds the serial permit by its metadata await.
                        tokio::time::timeout(Duration::from_secs(5), async {
                            while manager.serial.available_permits() != 0 {
                                tokio::task::yield_now().await;
                            }
                        }).await.unwrap();
                        manager.action(id, "pause").await.unwrap();
                        unblock.send(()).unwrap();
                        blocker.await.unwrap();
                        // Acquisition completes only after the real worker's
                        // error finalization releases its serial ownership.
                        let finished = tokio::time::timeout(Duration::from_secs(5), manager.serial.acquire()).await.unwrap().unwrap();
                        drop(finished);
                    }
                    let paused = manager.list().await.remove(0);
                    assert_eq!(paused.status, "paused");
                    if pause_before_admission {
                        assert!(paused.error.is_none());
                    }
                    assert!(!destination.exists());
                    assert_eq!(std::fs::read(&partial).unwrap(), bytes);
                    let saved: BTreeMap<Uuid, Download> = serde_json::from_slice(&std::fs::read(&journal).unwrap()).unwrap();
                    assert_eq!(saved[&id].status, "paused");

                    manager.action(id, "resume").await.unwrap();
                    tokio::time::timeout(Duration::from_secs(5), async {
                        loop {
                            if manager.list().await[0].status == "installed" { break; }
                            tokio::time::sleep(Duration::from_millis(10)).await;
                        }
                    }).await.unwrap();
                    assert_eq!(std::fs::read(destination).unwrap(), bytes);
                    assert!(!partial.exists());
                    assert!(manager.list().await[0].error.is_none());
                }
            });
    }

    #[test]
    fn successful_pause_before_transfer_update_prevents_http_and_retains_partial() {
        use hyper::{service::service_fn, Body, Response};
        use std::{future::Future, sync::atomic::{AtomicUsize, Ordering}, task::Poll};

        tokio::runtime::Builder::new_current_thread().enable_all().max_blocking_threads(1)
            .build().unwrap().block_on(async {
                let (mut release, bytes) = fixture();
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                release.url = format!("http://{}/model.ginfer", listener.local_addr().unwrap());
                let requests = Arc::new(AtomicUsize::new(0));
                let observed = requests.clone();
                let body = bytes[128..].to_vec();
                let server = tokio::spawn(async move {
                    let (socket, _) = listener.accept().await.unwrap();
                    hyper::server::conn::Http::new().serve_connection(socket, service_fn(move |request: hyper::Request<Body>| {
                        observed.fetch_add(1, Ordering::SeqCst);
                        assert_eq!(request.headers()["range"], "bytes=128-");
                        let body = body.clone();
                        async move {
                            Ok::<_, std::convert::Infallible>(Response::builder().status(206)
                                .header("content-range", "bytes 128-4095/4096")
                                .body(Body::from(body)).unwrap())
                        }
                    })).await.unwrap();
                });
                let dir = tempfile::tempdir().unwrap();
                let journal = dir.path().join("jobs.json");
                let manager = ModelDownloads::open(dir.path().join("models"), journal.clone()).unwrap();
                let id = insert(&manager, release).await;
                let partial = manager.root().join(format!("{id}.part"));
                std::fs::write(&partial, &bytes[..128]).unwrap();
                let client = reqwest::Client::builder().no_proxy().build().unwrap();

                // Occupy the only blocking worker, then poll into the real
                // partial-file metadata await before applying Pause.
                let (unblock, blocked) = std::sync::mpsc::channel();
                let (started, ready) = tokio::sync::oneshot::channel();
                let blocker = tokio::task::spawn_blocking(move || {
                    let _ = started.send(());
                    let _ = blocked.recv();
                });
                ready.await.unwrap();
                let mut transfer = Box::pin(manager.transfer_with_client(id, Some(client)));
                futures_util::future::poll_fn(|cx| {
                    assert!(matches!(transfer.as_mut().poll(cx), Poll::Pending));
                    Poll::Ready(())
                }).await;
                manager.action(id, "pause").await.unwrap();
                unblock.send(()).unwrap();
                blocker.await.unwrap();
                let _ = tokio::time::timeout(Duration::from_secs(5), transfer).await.unwrap();
                server.abort();
                let _ = server.await;

                assert_eq!(requests.load(Ordering::SeqCst), 0, "a successful Pause must prevent HTTP admission");
                assert_eq!(std::fs::read(&partial).unwrap(), bytes[..128]);
                let job = manager.list().await.remove(0);
                assert!(matches!(job.status.as_str(), "paused" | "pausing"));
                assert!(job.error.is_none());
                let saved: BTreeMap<Uuid, Download> = serde_json::from_slice(&std::fs::read(journal).unwrap()).unwrap();
                assert!(matches!(saved[&id].status.as_str(), "paused" | "pausing"));
            });
    }
}
