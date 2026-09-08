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
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{Mutex, Semaphore},
};
use uuid::Uuid;

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
}
pub struct ModelDownloads {
    root: PathBuf,
    state_path: PathBuf,
    jobs: Mutex<BTreeMap<Uuid, Download>>,
    serial: Arc<Semaphore>,
    local_layout: bool,
}
impl ModelDownloads {
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
            root,
            state_path,
            jobs: Mutex::new(jobs),
            serial: Arc::new(Semaphore::new(1)),
            local_layout,
        });
        Ok(manager)
    }
    pub fn root(&self) -> &std::path::Path {
        &self.root
    }
    fn save(&self, jobs: &BTreeMap<Uuid, Download>) -> Result<(), String> {
        write_private(
            &self.state_path,
            &serde_json::to_vec(jobs).map_err(|e| e.to_string())?,
        )
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
            let partial = self.root.join(format!("{id}.part"));
            match tokio::fs::remove_file(partial).await {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.to_string()),
            }
            let staging = self
                .state_path
                .parent()
                .ok_or("download state has no directory")?
                .join(format!(".model-install-{id}"));
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
    pub async fn remove_installed(&self, path: &std::path::Path) -> Result<(), String> {
        let mut jobs = self.jobs.lock().await;
        let id = jobs
            .values()
            .find(|job| {
                job.status == "installed"
                    && self.root.join(format!("{}.ginfer", job.release.sha256)) == path
            })
            .map(|j| j.id)
            .ok_or("only packages installed into managed storage can be removed")?;
        tokio::fs::remove_file(path)
            .await
            .map_err(|e| e.to_string())?;
        jobs.remove(&id);
        self.save(&jobs)
    }
    fn spawn(self: &Arc<Self>, id: Uuid) {
        let manager = self.clone();
        tokio::spawn(async move {
            let _permit = manager.serial.clone().acquire_owned().await.unwrap();
            if !manager
                .jobs
                .lock()
                .await
                .get(&id)
                .is_some_and(|job| job.status == "queued")
            {
                return;
            }
            let result = manager.transfer(id).await;
            if let Err(error) = result {
                let received = tokio::fs::metadata(manager.root.join(format!("{id}.part")))
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
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .https_only(true)
            .build()
            .map_err(|e| e.to_string())?;
        self.transfer_with_client(id, client).await
    }
    async fn transfer_with_client(&self, id: Uuid, client: reqwest::Client) -> Result<(), String> {
        let release = self
            .jobs
            .lock()
            .await
            .get(&id)
            .ok_or("unknown download")?
            .release
            .clone();
        let partial = self.root.join(format!("{id}.part"));
        let destination = if self.local_layout {
            self.root.join(&release.sha256).join("model.ginfer")
        } else {
            self.root.join(format!("{}.ginfer", release.sha256))
        };
        let staging = self
            .state_path
            .parent()
            .ok_or("download state has no directory")?
            .join(format!(".model-install-{id}"));
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
        let available = available_bytes(self.root.clone()).await?;
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
            let manifest = serde_json::json!({"model_path":format!("ginfer/models/{}/model.ginfer", release.sha256),
                "name":release.name,"size_bytes":release.bytes,"sha256":release.sha256,"identity":release.identity,
                "capabilities":release.capabilities,"embedding":false,"source":"local"});
            write_private(
                &staging.join("model.yml"),
                &serde_json::to_vec(&manifest).map_err(|e| e.to_string())?,
            )?;
            tokio::fs::rename(&partial, staging.join("model.ginfer"))
                .await
                .map_err(|e| e.to_string())?;
            tokio::fs::rename(&staging, self.root.join(&release.sha256))
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
    Ok(())
}

async fn available_bytes(path: PathBuf) -> Result<u64, String> {
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
    let output = tokio::process::Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", "$p=[IO.Path]::GetPathRoot($env:GCHAT_TRANSFER_ROOT); ([IO.DriveInfo]::new($p)).AvailableFreeSpace"]).env("GCHAT_TRANSFER_ROOT", path).output().await;
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
            &serde_json::json!({"identity":identity,"tp_size":1,"draft_tp":0,"objects":[{}]}),
        )
        .unwrap();
        let mut bytes = b"NINFER\0\x03".to_vec();
        bytes.extend_from_slice(&(directory.len() as u64).to_le_bytes());
        bytes.extend(directory);
        bytes.resize(4096, 0);
        let release = Release {
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
        };
        (release, bytes)
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
    #[tokio::test]
    async fn complete_partial_is_verified_published_and_removed_only_from_managed_storage() {
        let dir = tempfile::tempdir().unwrap();
        let manager =
            ModelDownloads::open(dir.path().join("models"), dir.path().join("jobs.json")).unwrap();
        let (release, bytes) = fixture();
        let id = insert(&manager, release.clone()).await;
        std::fs::write(manager.root.join(format!("{id}.part")), &bytes).unwrap();
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
        std::fs::write(manager.root.join(format!("{id}.part")), bytes).unwrap();
        assert!(manager.transfer(id).await.unwrap_err().contains("SHA256"));
        assert!(!manager
            .root
            .join(format!("{}.ginfer", release.sha256))
            .exists());
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
        std::fs::write(manager.root.join(format!("{id}.part")), &bytes[..128]).unwrap();
        manager
            .transfer_with_client(id, reqwest::Client::builder().no_proxy().build().unwrap())
            .await
            .unwrap();
        assert_eq!(manager.list().await[0].status, "installed");
        server.abort();
    }
}
