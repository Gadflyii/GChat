//! One durable first-run workflow, driven by every installed client.
use crate::{
    hardware_profile::{HardwareProfileAction, HardwareProfileRequest},
    model_downloads::{Download, Release},
    service::{write_private, Gpu, Host, LaunchRequest},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeSet, path::PathBuf, sync::atomic::Ordering};
use uuid::Uuid;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Progress {
    pub gpu_uuids: Vec<String>,
    pub storage_accepted: bool,
    pub requested_storage: Option<PathBuf>,
    pub storage_error: Option<String>,
    pub releases: Vec<Release>,
    pub catalog_loaded: bool,
    pub catalog_error: Option<String>,
    pub selected_release_ids: Vec<String>,
    pub download_error: Option<String>,
    pub download_ids: Vec<Uuid>,
    pub startup_profiles: Vec<Startup>,
    pub complete: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Startup {
    pub download_id: Uuid,
    pub model_id: String,
    pub request: LaunchRequest,
    pub instance_count: u32,
    pub instance_ids: Vec<Uuid>,
    pub quote: Option<Value>,
    pub error: Option<String>,
}

fn stage(progress: &Progress, profiled: bool, jobs: &[Download]) -> &'static str {
    if progress.complete {
        return "complete";
    }
    if progress.gpu_uuids.is_empty() {
        return "gpu";
    }
    if !profiled {
        return "profiling";
    }
    if !progress.storage_accepted {
        return "storage";
    }
    if progress.download_ids.is_empty() && progress.selected_release_ids.is_empty() {
        return "models";
    }
    if progress.download_ids.is_empty() && progress.download_error.is_some() {
        return "models";
    }
    if progress.selected_release_ids.iter().any(|sha| {
        !progress
            .download_ids
            .iter()
            .any(|id| jobs.iter().any(|j| j.id == *id && j.release.sha256 == *sha))
    }) {
        return "downloads";
    }
    if progress
        .download_ids
        .iter()
        .any(|id| !jobs.iter().any(|j| j.id == *id && j.status == "installed"))
    {
        return "downloads";
    }
    "startup"
}

fn validate_group(gpus: &[Gpu], selected: &[String]) -> Result<(), String> {
    let unique: BTreeSet<_> = selected.iter().collect();
    let first = selected
        .first()
        .and_then(|id| gpus.iter().find(|g| &g.uuid == id));
    if !matches!(selected.len(), 1 | 2 | 4)
        || unique.len() != selected.len()
        || first.is_none()
        || selected.iter().any(|id| {
            !gpus.iter().any(|g| {
                &g.uuid == id
                    && Some((&g.name, &g.compute_capability))
                        == first.map(|f| (&f.name, &f.compute_capability))
                    && matches!(
                        g.compute_capability.as_deref(),
                        Some("8.0" | "8.6" | "8.9" | "12.0")
                    )
            })
        })
    {
        return Err("Choose 1, 2 or 4 matching supported NVIDIA GPUs".into());
    }
    Ok(())
}

fn measured_capacity(profile: &Value, selected: &[String]) -> Option<(u64, u64)> {
    let ram = profile["process_memory_headroom_bytes"]
        .as_u64()
        .or_else(|| profile["ram_bytes"].as_u64())?;
    let gpus = profile["gpus"].as_array()?;
    let memory = selected
        .iter()
        .map(|id| {
            gpus.iter()
                .find(|g| g["uuid"].as_str() == Some(id))
                .and_then(|g| g["vram_bytes"].as_u64())
        })
        .collect::<Option<Vec<_>>>()?;
    Some((*memory.iter().min()?, ram))
}

fn recommendations(
    releases: &[Release],
    gpus: &[Gpu],
    selected: &[String],
    profile: &Value,
    free: u64,
) -> Vec<Value> {
    let capacity = measured_capacity(profile, selected);
    let mut choices: Vec<_> = releases.iter().filter(|release| release.tp as usize == selected.len()
        && selected.iter().all(|id| gpus.iter().any(|g| &g.uuid == id
            && release.identity.supports_gpu(g.compute_capability.as_deref())))).map(|release| {
        let fits = capacity.is_some_and(|(vram, ram)|
            vram / (1024 * 1024) >= release.min_vram_mib_per_gpu
                && release.bytes <= ram.saturating_add(vram.saturating_mul(release.tp.into()))
                && release.bytes <= free);
        let reason = match capacity {
            None => "Hardware profiling must finish before checking memory and disk capacity",
            Some((vram, _)) if vram / (1024 * 1024) < release.min_vram_mib_per_gpu => "Below the published per-GPU VRAM requirement",
            _ if release.bytes > free => "Not enough live free space in the selected folder",
            _ if !fits => "Package exceeds saved usable RAM plus VRAM capacity",
            _ => "Fits saved RAM/VRAM and live disk capacity; startup still requires an Engine quote",
        };
        (release, fits, reason)
    }).collect();
    // Select one default download; every compatible published alternative remains visible.
    choices.sort_by_key(|(r, fits, _)| {
        (
            !fits,
            if r.identity.weights_id.contains("nvfp4") {
                0
            } else if r.identity.weights_id.contains("smol") {
                2
            } else {
                1
            },
            r.bytes,
        )
    });
    let default = choices.iter().position(|(_, fits, _)| *fits);
    choices.into_iter().enumerate().map(|(index, (release, _, reason))| json!({
        "release_id":release.sha256,"release":release,"recommended":Some(index)==default,"reason":reason
    })).collect()
}

impl Host {
    async fn first_run_profile(&self, progress: &Progress) -> Option<Value> {
        if progress.gpu_uuids.is_empty() {
            return None;
        }
        let path =
            crate::hardware_profile::group_profile_path(&self.directory, &progress.gpu_uuids);
        let bytes = tokio::fs::read(path).await.ok()?;
        let profile: Value = serde_json::from_slice(&bytes).ok()?;
        if profile["schema_version"] != 2
            || measured_capacity(&profile, &progress.gpu_uuids).is_none()
        {
            return None;
        }
        let processes = self.processes.lock().await;
        let job = processes.hardware_profile.as_ref()?;
        if job.busy()
            || job.status(None).stale_groups.iter().any(|group| {
                crate::hardware_profile::group_key(&group.gpu_uuids)
                    == crate::hardware_profile::group_key(&progress.gpu_uuids)
            })
        {
            return None;
        }
        Some(profile)
    }

    async fn store_first_run(&self, progress: Progress) -> Result<(), String> {
        let mut data = self.data.lock().await;
        let previous = std::mem::replace(&mut data.first_run, progress);
        if let Err(error) = write_private(
            &self.directory.join("host.json"),
            &serde_json::to_vec(&*data).map_err(|e| e.to_string())?,
        ) {
            data.first_run = previous;
            return Err(error);
        }
        self.revision.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    pub async fn first_run_status(&self) -> Result<Value, String> {
        let progress = self.data.lock().await.first_run.clone();
        let profile = self.first_run_profile(&progress).await;
        let jobs = self.downloads.list().await;
        let selected: Vec<_> = jobs
            .iter()
            .filter(|j| progress.download_ids.contains(&j.id))
            .cloned()
            .collect();
        let root = self.downloads.root();
        let free = if profile.is_some() {
            crate::model_downloads::available_bytes(root.clone())
                .await
                .ok()
        } else {
            None
        };
        let models = recommendations(
            &progress.releases,
            &self.gpus,
            &progress.gpu_uuids,
            profile.as_ref().unwrap_or(&Value::Null),
            free.unwrap_or(0),
        );
        let required = progress
            .releases
            .iter()
            .filter(|r| {
                r.tp as usize == progress.gpu_uuids.len()
                    && progress.gpu_uuids.iter().all(|id| {
                        self.gpus.iter().any(|g| {
                            &g.uuid == id
                                && r.identity.supports_gpu(g.compute_capability.as_deref())
                        })
                    })
            })
            .map(|r| r.bytes)
            .min()
            .unwrap_or(0);
        let mut storage = json!({"path":root,"available_bytes":free,"existing_models_preserved":true,
            "requested_path":progress.requested_storage,"accepted":progress.storage_accepted,
            "existing_downloads":jobs.iter().filter(|j|j.status=="installed" && j.storage_root!=root).collect::<Vec<_>>()});
        if let Some(profile) = &profile {
            match crate::model_storage::recommend_storage(profile, &root, required).await {
                Ok(recommendation) => {
                    storage["recommended_path"] = json!(recommendation.recommended_path);
                    storage["candidates"] = json!(recommendation.candidates);
                }
                Err(error) => storage["error"] = error.into(),
            }
        }
        if let Some(error) = &progress.storage_error {
            storage["error"] = json!(error);
        }
        let hardware = {
            let processes = self.processes.lock().await;
            processes
                .hardware_profile
                .as_ref()
                .map(|job| job.status(processes.profiling_cli(&progress.gpu_uuids)))
        };
        let startup: Vec<_> = progress.startup_profiles.iter().map(|p|json!({
            "download_id":p.download_id,"model_id":p.model_id,"gpu_uuids":p.request.gpu_uuids,
            "concurrency":p.request.concurrency,"max_context":p.request.max_context,
            "kv_arena_bytes":p.request.options.kv_arena_bytes,"instance_count":p.instance_count,
            "quote":p.quote,"error":p.error,"instance_ids":p.instance_ids,
            "qualification":"Engine startup estimate; full-context validation is separate"
        })).collect();
        Ok(
            json!({"step":stage(&progress,profile.is_some(),&jobs),"gpu_uuids":progress.gpu_uuids,
            "hardware_profile":hardware.map(|h|json!(h)).unwrap_or_else(||json!({"status":"unavailable","error":"Hardware profiling is not configured"})),
            "storage":storage,"models":models,"selected_release_ids":progress.selected_release_ids,"catalog_loaded":progress.catalog_loaded,"error":progress.download_error.or(progress.catalog_error),
            "selected_downloads":selected,"startup_profiles":startup}),
        )
    }

    pub async fn first_run_action(
        self: &std::sync::Arc<Self>,
        body: Value,
    ) -> Result<Value, String> {
        let host = self.clone();
        // Once accepted, setup transitions belong to the Host even if their
        // HTTP caller disconnects between durable writes and owned work.
        tokio::spawn(async move { host.run_first_run_action(body).await })
            .await
            .map_err(|e| format!("First-run operation failed: {e}"))?
    }

    async fn run_first_run_action(&self, body: Value) -> Result<Value, String> {
        // The detached transition retains admission even if its HTTP caller
        // disconnects, and a queued transition must honor an accepted Stop.
        let _admission = self.running_admission().await?;
        if body["action"] == "move" {
            let id =
                serde_json::from_value(body["download_id"].clone()).map_err(|e| e.to_string())?;
            return self.move_first_run_model(id).await;
        }
        let _operation = self.first_run_operation.lock().await;
        let mut progress = self.data.lock().await.first_run.clone();
        let jobs = self.downloads.list().await;
        let profiled = self.first_run_profile(&progress).await.is_some();
        let step = stage(&progress, profiled, &jobs);
        match body["action"].as_str().ok_or("first-run action required")? {
            "profile" => {
                if progress.complete {
                    return Err(
                        "First-run setup is already complete; use hardware settings to reprofile"
                            .into(),
                    );
                }
                let selected: Vec<String> =
                    serde_json::from_value(body["gpu_uuids"].clone()).map_err(|e| e.to_string())?;
                validate_group(&self.gpus, &selected)?;
                if progress.gpu_uuids != selected && !progress.download_ids.is_empty() {
                    return Err("Finish the current setup before changing its GPU group".into());
                }
                let _lifecycle = self.lifecycle.lock().await;
                self.draft_width.cancel().await?;
                self.processes
                    .lock()
                    .await
                    .hardware_profile_action(HardwareProfileRequest {
                        action: HardwareProfileAction::Ensure,
                        gpu_uuids: Some(selected.clone()),
                    })?;
                if progress.gpu_uuids != selected {
                    progress = Progress {
                        gpu_uuids: selected,
                        ..Default::default()
                    };
                }
            }
            "storage" => {
                if progress.gpu_uuids.is_empty()
                    || progress.complete
                    || !progress.download_ids.is_empty()
                {
                    return Err(
                        "Choose storage after selecting GPUs and before admitting downloads".into(),
                    );
                }
                let path = PathBuf::from(body["path"].as_str().ok_or("storage path required")?);
                if !path.is_absolute() {
                    return Err("Choose an absolute model storage path".into());
                }
                progress.requested_storage = Some(path);
                progress.storage_accepted = false;
                progress.storage_error = None;
                progress.download_error = None;
                self.store_first_run(progress.clone()).await?;
                if profiled {
                    self.apply_first_run_storage(&mut progress).await?;
                }
            }
            "refresh_catalog" => {
                if progress.gpu_uuids.is_empty()
                    || progress.complete
                    || !progress.download_ids.is_empty()
                {
                    return Err(
                        "Load published models after selecting GPUs and before admitting downloads"
                            .into(),
                    );
                }
                progress.releases = crate::model_downloads::published_releases().await?;
                progress.catalog_loaded = true;
                progress.catalog_error = None;
            }
            "models" => {
                if progress.gpu_uuids.is_empty()
                    || progress.complete
                    || !progress.download_ids.is_empty()
                {
                    return Err(
                        "Choose models after selecting GPUs and before admitting downloads".into(),
                    );
                }
                let ids: BTreeSet<String> = serde_json::from_value(body["release_ids"].clone())
                    .map_err(|e| e.to_string())?;
                if ids.is_empty() {
                    return Err("Choose at least one published model".into());
                }
                let selected: Vec<_> = progress
                    .releases
                    .iter()
                    .filter(|r| ids.contains(&r.sha256))
                    .cloned()
                    .collect();
                if selected.len() != ids.len() {
                    return Err(
                        "A selected release is no longer published; refresh the catalog".into(),
                    );
                }
                for release in &selected {
                    if release.tp as usize != progress.gpu_uuids.len()
                        || progress.gpu_uuids.iter().any(|id| {
                            !self.gpus.iter().any(|gpu| {
                                &gpu.uuid == id
                                    && release
                                        .identity
                                        .supports_gpu(gpu.compute_capability.as_deref())
                            })
                        })
                    {
                        return Err("Release does not support the selected GPU group; NVFP4 requires Blackwell".into());
                    }
                }
                // Save the entire choice before admitting jobs. Maintenance can
                // recover any interruption between individual journal writes.
                progress.selected_release_ids = ids.into_iter().collect();
                progress.download_error = None;
                self.store_first_run(progress.clone()).await?;
                if profiled && progress.storage_accepted {
                    self.admit_first_run_downloads(&mut progress).await?;
                }
            }
            "resume" => match step {
                "profiling" => {
                    let _lifecycle = self.lifecycle.lock().await;
                    self.draft_width.cancel().await?;
                    self.processes.lock().await.hardware_profile_action(
                        HardwareProfileRequest {
                            action: HardwareProfileAction::Resume,
                            gpu_uuids: Some(progress.gpu_uuids.clone()),
                        },
                    )?;
                }
                "downloads" => {
                    progress.download_error = None;
                    self.admit_first_run_downloads(&mut progress).await?;
                    let _lifecycle = self.lifecycle.lock().await;
                    if self.first_run_profile(&progress).await.is_none() {
                        return Err("Complete hardware profiling before resuming downloads".into());
                    }
                    for job in &jobs {
                        if progress.download_ids.contains(&job.id)
                            && matches!(job.status.as_str(), "failed" | "paused")
                        {
                            self.downloads.action(job.id, "resume").await?;
                        }
                    }
                }
                "startup" => {
                    for profile in &mut progress.startup_profiles {
                        profile.error = None;
                        profile.quote = None;
                    }
                }
                _ => return Err("No interrupted work to resume at this step".into()),
            },
            "startup" => {
                if step != "startup" {
                    return Err("Wait for selected models to finish downloading".into());
                }
                let id: Uuid = serde_json::from_value(body["download_id"].clone())
                    .map_err(|e| e.to_string())?;
                let profile = progress
                    .startup_profiles
                    .iter_mut()
                    .find(|p| p.download_id == id)
                    .ok_or("Startup quote is not prepared yet")?;
                let number = |key: &str, default: u32| -> Result<u32, String> {
                    body.get(key)
                        .map(|v| {
                            v.as_u64()
                                .and_then(|n| u32::try_from(n).ok())
                                .filter(|n| *n > 0)
                                .ok_or_else(|| format!("{key} must be a positive 32-bit integer"))
                        })
                        .unwrap_or(Ok(default))
                };
                profile.request.concurrency = number("concurrency", profile.request.concurrency)?;
                profile.request.max_context = number("max_context", profile.request.max_context)?;
                profile.instance_count = number("instance_count", profile.instance_count)?;
                if profile.instance_count > 16 {
                    return Err("At most 16 saved instances per package".into());
                }
                profile.request.options.kv_arena_bytes = body
                    .get("kv_arena_bytes")
                    .filter(|v| !v.is_null())
                    .map(|v| {
                        v.as_u64()
                            .filter(|n| *n > 0)
                            .ok_or("KV arena bytes must be positive")
                    })
                    .transpose()?;
                profile.request.qualified_profile_id = None;
                profile.quote = None;
                profile.error = None;
            }
            "complete" => {
                if step != "startup"
                    || progress.startup_profiles.len() != progress.download_ids.len()
                    || progress
                        .startup_profiles
                        .iter()
                        .any(|p| p.quote.is_none() || p.error.is_some())
                {
                    return Err("Every selected download needs a successful Engine startup quote before setup can finish".into());
                }
                let mut data = self.data.lock().await;
                let previous = data.profiles.clone();
                for profile in &mut progress.startup_profiles {
                    profile.instance_ids = (0..profile.instance_count)
                        .map(|_| Uuid::new_v4())
                        .collect();
                    for id in &profile.instance_ids {
                        let mut request = profile.request.clone();
                        request.instance_id = Some(*id);
                        data.profiles.insert(*id, request);
                    }
                }
                progress.complete = true;
                let old = std::mem::replace(&mut data.first_run, progress.clone());
                if let Err(error) = write_private(
                    &self.directory.join("host.json"),
                    &serde_json::to_vec(&*data).map_err(|e| e.to_string())?,
                ) {
                    data.profiles = previous;
                    data.first_run = old;
                    return Err(error);
                }
                self.revision.fetch_add(1, Ordering::SeqCst);
                drop(data);
                return self.first_run_status().await;
            }
            _ => return Err("Unknown first-run action".into()),
        }
        self.store_first_run(progress).await?;
        self.processes
            .lock()
            .await
            .activity_notification()
            .notify_one();
        self.first_run_status().await
    }

    async fn move_first_run_model(&self, id: Uuid) -> Result<Value, String> {
        let _operation = self.first_run_operation.lock().await;
        let progress = self.data.lock().await.first_run.clone();
        if self.first_run_profile(&progress).await.is_none() {
            return Err("Complete hardware profiling before moving installed models".into());
        }
        let _lifecycle = self.lifecycle.lock().await;
        if self.processes.lock().await.has_children() {
            return Err("Stop active model instances before moving an installed model".into());
        }
        self.draft_width.cancel().await?;
        self.scan().await?;
        let job = self
            .downloads
            .list()
            .await
            .into_iter()
            .find(|j| j.id == id)
            .filter(|j| j.status == "installed")
            .ok_or("Only installed managed packages can be moved")?;
        let source = job.path.as_ref().ok_or("Installed package has no path")?;
        let model = self
            .inventory
            .read()
            .await
            .iter()
            .find(|m| &m.path == source)
            .cloned()
            .ok_or("Installed package is missing from Host inventory")?;
        let destination = self.downloads.root().join(
            source
                .strip_prefix(&job.storage_root)
                .map_err(|_| "Installed package is outside its managed storage root")?,
        );
        let key = serde_json::to_string(&(&destination, false, model.metadata.tp_size))
            .map_err(|e| e.to_string())?;
        {
            let mut data = self.data.lock().await;
            if data.models.get(&key).is_some_and(|id| *id != model.id) {
                return Err(
                    "Move destination belongs to another registered model; choose another folder"
                        .into(),
                );
            }
            // Reserve the same inventory UUID before any source deletion. A
            // crash between the download-journal commit and rescan then keeps
            // every saved instance bound to the moved package after restart.
            let previous = data.models.insert(key.clone(), model.id);
            if let Err(error) = crate::model_downloads::write_move_journal(
                &self.directory.join("host.json"),
                &serde_json::to_vec(&*data).map_err(|e| e.to_string())?,
            ) {
                if let Some(previous) = previous {
                    data.models.insert(key, previous);
                } else {
                    data.models.remove(&key);
                }
                return Err(error);
            }
        }
        let moved = self
            .downloads
            .move_installed(id, self.downloads.root())
            .await;
        // Even a committed move whose source cleanup failed needs its current
        // journal path reflected in inventory before the error is displayed.
        let scanned = self.scan().await;
        moved?;
        scanned?;
        self.first_run_status().await
    }

    pub async fn first_run_pending(&self) -> bool {
        let data = self.data.lock().await;
        !data.first_run.complete && !data.first_run.gpu_uuids.is_empty()
    }

    async fn apply_first_run_storage(&self, progress: &mut Progress) -> Result<(), String> {
        if progress.storage_accepted || progress.storage_error.is_some() {
            return Ok(());
        }
        let Some(path) = progress.requested_storage.clone() else {
            return Ok(());
        };
        let _lifecycle = self.lifecycle.lock().await;
        if self.first_run_profile(progress).await.is_none() {
            return Ok(());
        }
        // Saving a path during calibration is metadata only. Filesystem/native
        // storage validation is deferred until its matching profile is usable.
        match self.set_model_storage_locked(path).await {
            Ok(root) => {
                progress.requested_storage = Some(root);
                progress.storage_accepted = true;
            }
            Err(error) => {
                progress.storage_error = Some(error.clone());
                self.store_first_run(progress.clone()).await?;
                return Err(error);
            }
        }
        self.store_first_run(progress.clone()).await
    }

    async fn admit_first_run_downloads(&self, progress: &mut Progress) -> Result<(), String> {
        // Profile starts share this lock. Recheck after any storage probe so
        // queued choices cannot admit heavy work while calibration is active.
        let _lifecycle = self.lifecycle.lock().await;
        if !progress.storage_accepted || self.first_run_profile(progress).await.is_none() {
            return Err(
                "Complete hardware profiling and validate storage before downloading models".into(),
            );
        }
        let jobs = self.downloads.list().await;
        let bytes = progress
            .selected_release_ids
            .iter()
            .try_fold(0u64, |bytes, sha| {
                if jobs.iter().any(|job| {
                    &job.release.sha256 == sha
                        && ((job.status == "installed"
                            && job.path.as_ref().is_some_and(|path| path.is_file()))
                            || (progress.download_ids.contains(&job.id)
                                && matches!(
                                    job.status.as_str(),
                                    "queued" | "downloading" | "verifying"
                                )))
                }) {
                    // Already admitted active work consumes this same reservation.
                    // Paused/failed jobs must pass a fresh capacity check on Resume.
                    return Ok(bytes);
                }
                let release = progress
                    .releases
                    .iter()
                    .find(|release| &release.sha256 == sha)
                    .ok_or("Selected release is missing from the saved catalog")?;
                bytes
                    .checked_add(release.bytes)
                    .ok_or("download size overflow")
            });
        let capacity = match bytes {
            Ok(bytes) => crate::model_downloads::available_bytes(self.downloads.root()).await
                .and_then(|free| if free >= bytes { Ok(()) } else {
                    Err("Selected downloads do not fit the live free space; choose another folder or fewer packages".into())
                }),
            Err(error) => Err(error.into()),
        };
        if let Err(error) = capacity {
            progress.download_error = Some(error.clone());
            self.store_first_run(progress.clone()).await?;
            return Err(error);
        }
        for sha in progress.selected_release_ids.clone() {
            let jobs = self.downloads.list().await;
            if progress
                .download_ids
                .iter()
                .any(|id| jobs.iter().any(|j| j.id == *id && j.release.sha256 == sha))
            {
                continue;
            }
            let release = progress
                .releases
                .iter()
                .find(|r| r.sha256 == sha)
                .cloned()
                .ok_or("Selected release is missing from the saved catalog")?;
            match self.downloads.enqueue(release).await {
                Ok(job) => {
                    progress.download_ids.push(job.id);
                    self.store_first_run(progress.clone()).await?;
                }
                Err(error) => {
                    progress.download_error = Some(error.clone());
                    self.store_first_run(progress.clone()).await?;
                    return Err(error);
                }
            }
        }
        Ok(())
    }

    pub async fn first_run_maintenance(&self) -> Result<(), String> {
        if !self.first_run_pending().await {
            return Ok(());
        }
        let _operation = self.first_run_operation.lock().await;
        let mut progress = self.data.lock().await.first_run.clone();
        let profiled = self.first_run_profile(&progress).await.is_some();
        // The published catalog is metadata; it can load while calibration
        // runs without starting package downloads or validating storage.
        if !progress.catalog_loaded {
            match crate::model_downloads::published_releases().await {
                Ok(releases) => {
                    progress.releases = releases;
                    progress.catalog_error = None;
                }
                Err(error) => progress.catalog_error = Some(error),
            }
            progress.catalog_loaded = true;
            self.store_first_run(progress.clone()).await?;
        }
        if !profiled {
            return Ok(());
        }
        self.apply_first_run_storage(&mut progress).await?;
        if progress.storage_accepted
            && !progress.selected_release_ids.is_empty()
            && progress.download_error.is_none()
        {
            self.admit_first_run_downloads(&mut progress).await?;
        }
        let jobs = self.downloads.list().await;
        if stage(&progress, profiled, &jobs) != "startup" {
            return Ok(());
        }
        if progress.startup_profiles.len() == progress.download_ids.len()
            && progress
                .startup_profiles
                .iter()
                .all(|p| p.quote.is_some() || p.error.is_some())
        {
            return Ok(());
        }
        let _lifecycle = self.lifecycle.lock().await;
        if self.processes.lock().await.has_children() {
            return Ok(());
        }
        self.draft_width.cancel().await?;
        for job in jobs
            .iter()
            .filter(|j| progress.download_ids.contains(&j.id))
        {
            if progress
                .startup_profiles
                .iter()
                .any(|p| p.download_id == job.id)
            {
                continue;
            }
            self.scan().await?;
            let inventory = self.inventory.read().await;
            let model = inventory
                .iter()
                .find(|m| job.path.as_ref() == Some(&m.path))
                .ok_or("Downloaded model is not in Host inventory; rescan storage")?;
            let published = job
                .release
                .launch_profiles
                .iter()
                .filter(|p| {
                    p.matches_model(model)
                        && p.gpu_groups(&self.gpus, &Default::default())
                            .iter()
                            .any(|g| g == &progress.gpu_uuids)
                })
                .max_by_key(|p| {
                    (
                        matches!(
                            p.qualification.tier,
                            crate::launch_profiles::QualificationTier::FullContextTested
                        ),
                        p.max_context,
                        p.concurrency,
                    )
                });
            let mut options = published.map(|p| p.options.clone()).unwrap_or_default();
            // Published arena bytes describe historical hardware. Keep the
            // recommendation automatic so actual starts quote the live runtime.
            options.kv_arena_bytes = None;
            let max_context = options.validate_target(
                &model.metadata.identity,
                model.metadata.tp_size,
                model.metadata.draft_tp,
            )?;
            progress.startup_profiles.push(Startup {
                download_id: job.id,
                model_id: format!(
                    "{}/{}",
                    model.metadata.identity.model_id, model.metadata.identity.weights_id
                ),
                request: LaunchRequest {
                    instance_id: None,
                    qualified_profile_id: None,
                    benchmark_profile: None,
                    model_id: model.id,
                    gpu_uuids: progress.gpu_uuids.clone(),
                    max_context: published.map(|p| p.max_context).unwrap_or(max_context),
                    concurrency: published.map(|p| p.concurrency).unwrap_or(1),
                    options,
                },
                instance_count: 1,
                instance_ids: vec![],
                quote: None,
                error: None,
            });
        }
        self.store_first_run(progress.clone()).await?;
        for profile in &mut progress.startup_profiles {
            if profile.quote.is_some() || profile.error.is_some() {
                continue;
            }
            match self.quote_first_run(profile).await {
                Ok(quote) => {
                    profile.quote = Some(quote);
                }
                Err(error) => profile.error = Some(error),
            }
        }
        self.store_first_run(progress).await
    }

    async fn quote_first_run(&self, profile: &Startup) -> Result<Value, String> {
        let launch = self.prepare_launch(&profile.request).await?;
        self.processes
            .lock()
            .await
            .validate_launch(&launch, false)?;
        let (value, _) = self.quote_prepared(&launch, profile.instance_count).await?;
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::time::Duration;

    fn gpu() -> Gpu {
        Gpu {
            uuid: "fixture-gpu".into(),
            name: "Fixture GPU".into(),
            display_name: None,
            memory_mib: 32768,
            compute_capability: Some("12.0".into()),
        }
    }

    fn package(marker: u8) -> (Release, Vec<u8>) {
        let identity = crate::engine_inventory::ArtifactIdentity {
            model_id: "muse-glimmer-30b".into(),
            weights_id: "nvfp4".into(),
        };
        let directory = serde_json::to_vec(&json!({"identity":identity,"tp_size":1,"draft_tp":0,
            "objects":[{"kind":"tensor","rank":"all","name":"fixture"}]}))
        .unwrap();
        let mut bytes = b"NINFER\0\x03".to_vec();
        bytes.extend_from_slice(&(directory.len() as u64).to_le_bytes());
        bytes.extend(directory);
        bytes.resize(4096, marker);
        (
            Release {
                name: format!("Fixture {marker}"),
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
            },
            bytes,
        )
    }

    async fn installed_host(
        directory: &std::path::Path,
        count: u8,
    ) -> (std::sync::Arc<Host>, Vec<Download>) {
        std::fs::create_dir_all(directory).unwrap();
        let mut jobs = std::collections::BTreeMap::new();
        let root = directory.join("managed-models");
        for marker in 0..count {
            let (release, bytes) = package(marker);
            let path = root.join(format!("{}.ginfer", release.sha256));
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, bytes).unwrap();
            let id = Uuid::new_v4();
            jobs.insert(
                id,
                Download {
                    id,
                    release,
                    status: "installed".into(),
                    received: 4096,
                    bytes_per_second: 0,
                    error: None,
                    path: Some(path),
                    storage_root: root.clone(),
                },
            );
        }
        std::fs::write(
            directory.join("model-downloads.json"),
            serde_json::to_vec(&jobs).unwrap(),
        )
        .unwrap();
        let host = Host::open(
            directory.to_owned(),
            "Fixture".into(),
            directory.join("ginfer-serve"),
            vec![],
            vec![],
            vec![gpu()],
        )
        .await
        .unwrap();
        let profile = crate::hardware_profile::group_profile_path(directory, &[gpu().uuid]);
        std::fs::create_dir_all(profile.parent().unwrap()).unwrap();
        std::fs::write(
            profile,
            serde_json::to_vec(&json!({"schema_version":2,"ram_bytes":128_u64<<30,
            "gpus":[{"uuid":gpu().uuid,"vram_bytes":32_u64<<30}],"disks":[]}))
            .unwrap(),
        )
        .unwrap();
        (host, jobs.into_values().collect())
    }

    #[tokio::test]
    async fn pending_profile_retains_choices_across_restart_without_storage_or_admission() {
        let directory = tempfile::tempdir().unwrap();
        let (host, jobs) = installed_host(directory.path(), 1).await;
        let profile_path =
            crate::hardware_profile::group_profile_path(directory.path(), &[gpu().uuid.clone()]);
        let accepted_profile = std::fs::read(&profile_path).unwrap();
        // A profile for another GPU cannot validate this group's saved choices.
        std::fs::write(
            &profile_path,
            serde_json::to_vec(&json!({
                "schema_version":2,"ram_bytes":128_u64<<30,
                "gpus":[{"uuid":"another-gpu","vram_bytes":32_u64<<30}]
            }))
            .unwrap(),
        )
        .unwrap();
        host.store_first_run(Progress {
            gpu_uuids: vec![gpu().uuid],
            catalog_loaded: true,
            releases: vec![jobs[0].release.clone()],
            ..Default::default()
        })
        .await
        .unwrap();
        let original_root = host.downloads.root();
        let selected_root = directory.path().join("chosen-after-calibration");
        host.first_run_action(json!({"action":"storage","path":selected_root}))
            .await
            .unwrap();
        let saved = host
            .first_run_action(json!({
                "action":"models","release_ids":[jobs[0].release.sha256]
            }))
            .await
            .unwrap();
        assert_eq!(saved["step"], "profiling");
        assert_eq!(saved["storage"]["requested_path"], json!(selected_root));
        assert_eq!(saved["storage"]["accepted"], false);
        assert!(saved["selected_downloads"].as_array().unwrap().is_empty());
        drop(host);
        let restored = Host::open(
            directory.path().to_owned(),
            "Fixture".into(),
            directory.path().join("ginfer-serve"),
            vec![],
            vec![],
            vec![gpu()],
        )
        .await
        .unwrap();
        restored.first_run_maintenance().await.unwrap();
        let mut progress = restored.data.lock().await.first_run.clone();
        assert_eq!(progress.requested_storage, Some(selected_root.clone()));
        assert_eq!(
            progress.selected_release_ids,
            vec![jobs[0].release.sha256.clone()]
        );
        assert!(!progress.storage_accepted);
        assert!(progress.download_ids.is_empty());
        assert_eq!(restored.downloads.root(), original_root);
        assert!(!selected_root.exists());
        assert_eq!(restored.downloads.list().await.len(), 1);

        std::fs::write(profile_path, accepted_profile).unwrap();
        restored
            .apply_first_run_storage(&mut progress)
            .await
            .unwrap();
        restored
            .admit_first_run_downloads(&mut progress)
            .await
            .unwrap();
        assert!(progress.storage_accepted);
        assert_eq!(
            restored.downloads.root(),
            selected_root.canonicalize().unwrap()
        );
        assert_eq!(progress.download_ids, vec![jobs[0].id]);
        assert_eq!(restored.downloads.list().await.len(), 1);
        assert!(jobs[0].path.as_ref().unwrap().is_file());
    }

    #[tokio::test]
    async fn deferred_storage_and_capacity_errors_require_an_explicit_corrected_choice() {
        let directory = tempfile::tempdir().unwrap();
        let (host, jobs) = installed_host(directory.path(), 1).await;
        let mut too_large = package(7).0;
        too_large.bytes = u64::MAX;
        host.store_first_run(Progress {
            gpu_uuids: vec![gpu().uuid],
            catalog_loaded: true,
            releases: vec![too_large.clone(), jobs[0].release.clone()],
            ..Default::default()
        })
        .await
        .unwrap();
        let original_root = host.downloads.root();
        let not_directory = directory.path().join("not-a-directory");
        std::fs::write(&not_directory, "retained file").unwrap();
        assert!(host
            .first_run_action(json!({
                "action":"storage","path":not_directory.join("models")
            }))
            .await
            .is_err());
        let failed = host.first_run_status().await.unwrap();
        assert_eq!(failed["step"], "storage");
        assert_eq!(failed["storage"]["accepted"], false);
        assert!(failed["storage"]["error"].as_str().is_some());
        assert_eq!(host.downloads.root(), original_root);

        host.first_run_action(json!({"action":"storage","path":original_root}))
            .await
            .unwrap();
        assert!(host
            .first_run_action(json!({
                "action":"models","release_ids":[too_large.sha256]
            }))
            .await
            .unwrap_err()
            .contains("free space"));
        host.first_run_maintenance().await.unwrap();
        let blocked = host.first_run_status().await.unwrap();
        assert_eq!(blocked["step"], "models");
        assert!(blocked["error"].as_str().unwrap().contains("free space"));
        assert!(blocked["selected_downloads"].as_array().unwrap().is_empty());
        assert_eq!(host.downloads.list().await.len(), 1);
        let recovered = host
            .first_run_action(json!({
                "action":"models","release_ids":[jobs[0].release.sha256]
            }))
            .await
            .unwrap();
        assert!(recovered["error"].is_null());
        assert_eq!(recovered["selected_downloads"][0]["id"], json!(jobs[0].id));
        assert_eq!(host.downloads.list().await.len(), 1);
    }

    #[tokio::test]
    async fn paused_and_failed_downloads_cannot_bypass_live_capacity_on_resume() {
        for status in ["paused", "failed"] {
            let directory = tempfile::tempdir().unwrap();
            let (host, mut jobs) = installed_host(directory.path(), 1).await;
            let original_root = host.downloads.root();
            drop(host);
            jobs[0].status = status.into();
            jobs[0].path = None;
            jobs[0].release.bytes = 9_007_199_254_740_991;
            let saved_jobs = std::collections::BTreeMap::from([(jobs[0].id, jobs[0].clone())]);
            std::fs::write(
                directory.path().join("model-downloads.json"),
                serde_json::to_vec(&saved_jobs).unwrap(),
            )
            .unwrap();
            let host = Host::open(
                directory.path().to_owned(),
                "Fixture".into(),
                directory.path().join("ginfer-serve"),
                vec![],
                vec![],
                vec![gpu()],
            )
            .await
            .unwrap();
            host.store_first_run(Progress {
                gpu_uuids: vec![gpu().uuid],
                requested_storage: Some(original_root.clone()),
                storage_accepted: true,
                catalog_loaded: true,
                releases: vec![jobs[0].release.clone()],
                selected_release_ids: vec![jobs[0].release.sha256.clone()],
                download_ids: vec![jobs[0].id],
                ..Default::default()
            })
            .await
            .unwrap();
            let error = host
                .first_run_action(json!({"action":"resume"}))
                .await
                .unwrap_err();
            assert!(error.contains("free space"), "{status}: {error}");
            let retained = host.downloads.list().await;
            assert_eq!(retained.len(), 1);
            assert_eq!(retained[0].id, jobs[0].id);
            assert_eq!(retained[0].status, status);
            assert_eq!(host.downloads.root(), original_root);
            assert!(host.first_run_status().await.unwrap()["error"]
                .as_str()
                .unwrap()
                .contains("free space"));
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn running_calibration_blocks_saved_profile_storage_and_download_admission() {
        use std::future::Future;
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let (host, jobs) = installed_host(directory.path(), 1).await;
        let cli = directory.path().join("profiling-cli");
        std::fs::write(&cli, "#!/bin/sh\nexec /bin/sleep 600\n").unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o700)).unwrap();
        host.store_first_run(Progress {
            gpu_uuids: vec![gpu().uuid],
            catalog_loaded: true,
            releases: vec![jobs[0].release.clone()],
            ..Default::default()
        })
        .await
        .unwrap();
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let original_root = host.downloads.root();
        let pending_root = directory.path().join("after-current-run");
        let mut waiting = host.data.lock().await.first_run.clone();
        waiting.requested_storage = Some(pending_root.clone());
        let lifecycle = host.lifecycle.lock().await;
        let validation = host.apply_first_run_storage(&mut waiting);
        tokio::pin!(validation);
        std::future::poll_fn(|context| {
            assert!(validation.as_mut().poll(context).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        // A profile start that owns lifecycle wins before any queued native
        // path validation; the waiting choice must recheck after the lock.
        job.start(HardwareProfileAction::Refresh, Some(cli), vec![gpu().uuid])
            .unwrap();
        drop(lifecycle);
        let validation_result = validation.await;
        let storage = host
            .first_run_action(json!({"action":"storage","path":pending_root}))
            .await;
        let choices = host
            .first_run_action(json!({
                "action":"models","release_ids":[jobs[0].release.sha256]
            }))
            .await;
        let mut progress = host.data.lock().await.first_run.clone();
        // Exercise the final admission guard even if a previous acceptance bit
        // was retained when a new calibration began.
        progress.storage_accepted = true;
        let admission = host.admit_first_run_downloads(&mut progress).await;
        let busy = job.busy();
        let final_root = host.downloads.root();
        let current_jobs = host.downloads.list().await;
        job.shutdown().await.unwrap();
        assert!(busy);
        validation_result.unwrap();
        assert_eq!(storage.unwrap()["step"], "profiling");
        assert_eq!(choices.unwrap()["step"], "profiling");
        assert!(admission
            .unwrap_err()
            .contains("Complete hardware profiling"));
        assert!(progress.download_ids.is_empty());
        assert_eq!(final_root, original_root);
        assert!(!pending_root.exists());
        assert_eq!(current_jobs.len(), 1);
    }

    #[tokio::test]
    async fn interrupted_multi_package_selection_recovers_all_jobs_without_duplicates() {
        let directory = tempfile::tempdir().unwrap();
        let (host, jobs) = installed_host(directory.path(), 2).await;
        let progress = Progress {
            gpu_uuids: vec![gpu().uuid],
            storage_accepted: true,
            catalog_loaded: true,
            releases: jobs.iter().map(|j| j.release.clone()).collect(),
            selected_release_ids: jobs.iter().map(|j| j.release.sha256.clone()).collect(),
            download_ids: vec![jobs[0].id],
            ..Default::default()
        };
        host.store_first_run(progress).await.unwrap();
        drop(host);
        let restored = Host::open(
            directory.path().to_owned(),
            "Fixture".into(),
            directory.path().join("ginfer-serve"),
            vec![],
            vec![],
            vec![gpu()],
        )
        .await
        .unwrap();
        assert_eq!(
            restored.first_run_status().await.unwrap()["step"],
            "downloads"
        );
        let mut progress = restored.data.lock().await.first_run.clone();
        restored
            .admit_first_run_downloads(&mut progress)
            .await
            .unwrap();
        restored
            .admit_first_run_downloads(&mut progress)
            .await
            .unwrap();
        assert_eq!(progress.download_ids.len(), 2);
        assert_eq!(restored.downloads.list().await.len(), 2);
        assert_eq!(
            restored.first_run_status().await.unwrap()["step"],
            "startup"
        );
        assert!(restored
            .first_run_action(json!({"action":"complete"}))
            .await
            .unwrap_err()
            .contains("successful Engine"));
    }

    #[tokio::test]
    async fn disconnected_move_preserves_saved_instance_identity_after_restart() {
        let directory = tempfile::tempdir().unwrap();
        let (host, jobs) = installed_host(directory.path(), 1).await;
        host.store_first_run(Progress {
            gpu_uuids: vec![gpu().uuid],
            catalog_loaded: true,
            ..Default::default()
        })
        .await
        .unwrap();
        host.scan().await.unwrap();
        let model_id = host.inventory.read().await[0].id;
        let instance_id = Uuid::new_v4();
        host.data.lock().await.profiles.insert(
            instance_id,
            LaunchRequest {
                instance_id: Some(instance_id),
                qualified_profile_id: None,
                benchmark_profile: None,
                model_id,
                gpu_uuids: vec![gpu().uuid],
                max_context: 4096,
                concurrency: 1,
                options: Default::default(),
            },
        );
        let target = directory.path().join("selected-models");
        host.set_model_storage(target.clone()).await.unwrap();
        let lifecycle = host.lifecycle.lock().await;
        let caller_host = host.clone();
        let download_id = jobs[0].id;
        let caller = tokio::spawn(async move {
            caller_host
                .first_run_action(json!({"action":"move", "download_id":download_id}))
                .await
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while host.first_run_operation.try_lock().is_ok() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        caller.abort();
        assert!(caller.await.unwrap_err().is_cancelled());
        drop(lifecycle);
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if host.first_run_operation.try_lock().is_ok() {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let moved = host.downloads.list().await.remove(0);
        assert_eq!(moved.storage_root, target);
        assert!(!jobs[0].path.as_ref().unwrap().exists());
        assert_eq!(host.inventory.read().await[0].id, model_id);
        drop(host);
        let restored = Host::open(
            directory.path().to_owned(),
            "Fixture".into(),
            directory.path().join("ginfer-serve"),
            vec![],
            vec![],
            vec![gpu()],
        )
        .await
        .unwrap();
        assert_eq!(
            restored.data.lock().await.profiles[&instance_id].model_id,
            model_id
        );
        assert_eq!(restored.inventory.read().await[0].id, model_id);
        assert_eq!(restored.inventory.read().await[0].path, moved.path.unwrap());
        assert!(!restored.processes.lock().await.has_children());
    }

    #[cfg(unix)]
    #[tokio::test]
    #[ignore = "requires the refreshed native two-disk profile and explicit storage root"]
    async fn native_two_disk_move_preserves_existing_models_and_saved_references() {
        use std::os::unix::fs::MetadataExt;
        let profile_path = std::path::PathBuf::from(
            std::env::var_os("GCHAT_NATIVE_STORAGE_PROFILE").expect("native profile required"),
        );
        let requested = std::path::PathBuf::from(
            std::env::var_os("GCHAT_NATIVE_STORAGE_ROOT").expect("native storage root required"),
        );
        let profile_bytes = std::fs::read(&profile_path).unwrap();
        let profile: Value = serde_json::from_slice(&profile_bytes).unwrap();
        let recommendation = crate::model_storage::recommend_storage(&profile, &requested, 4096)
            .await
            .unwrap();
        let mut ancestors = Vec::new();
        let mut devices = std::collections::BTreeSet::new();
        for candidate in recommendation.candidates.iter().filter(|c| c.eligible) {
            let mut ancestor = candidate.path.clone();
            while !ancestor.exists() {
                assert!(ancestor.pop());
            }
            if devices.insert(std::fs::metadata(&ancestor).unwrap().dev()) {
                ancestors.push(ancestor);
            }
        }
        assert!(
            ancestors.len() >= 2,
            "two measured live filesystems required"
        );
        let source_directory = tempfile::Builder::new()
            .prefix("gchat3-first-run-native-source-")
            .tempdir_in(&ancestors[0])
            .unwrap();
        let destination_directory = tempfile::Builder::new()
            .prefix("gchat3-first-run-native-destination-")
            .tempdir_in(&ancestors[1])
            .unwrap();
        let (host, jobs) = installed_host(source_directory.path(), 1).await;
        // This acceptance exercises storage and durable references with a tiny
        // valid container. The fixture GPU never starts or qualifies a model.
        std::fs::write(
            crate::hardware_profile::group_profile_path(source_directory.path(), &[gpu().uuid]),
            &profile_bytes,
        )
        .unwrap();
        host.store_first_run(Progress {
            gpu_uuids: vec![gpu().uuid],
            catalog_loaded: true,
            ..Default::default()
        })
        .await
        .unwrap();
        host.scan().await.unwrap();
        let model_id = host.inventory.read().await[0].id;
        let instance_id = Uuid::new_v4();
        host.data.lock().await.profiles.insert(
            instance_id,
            LaunchRequest {
                instance_id: Some(instance_id),
                qualified_profile_id: None,
                benchmark_profile: None,
                model_id,
                gpu_uuids: vec![gpu().uuid],
                max_context: 4096,
                concurrency: 1,
                options: Default::default(),
            },
        );
        let source = jobs[0].path.as_ref().unwrap();
        let original_bytes = std::fs::read(source).unwrap();
        let target = destination_directory.path().join("explicit-models");
        host.first_run_action(json!({"action":"storage","path":target}))
            .await
            .unwrap();
        assert_eq!(std::fs::read(source).unwrap(), original_bytes);
        assert_eq!(host.downloads.list().await[0].path.as_ref(), Some(source));
        assert_eq!(host.downloads.root(), target);
        host.first_run_action(json!({"action":"move","download_id":jobs[0].id}))
            .await
            .unwrap();
        let moved = host.downloads.list().await.remove(0);
        let destination = moved.path.as_ref().unwrap();
        assert_eq!(moved.storage_root, target);
        assert_eq!(std::fs::read(destination).unwrap(), original_bytes);
        assert!(!source.exists());
        assert_eq!(host.inventory.read().await[0].id, model_id);
        drop(host);
        let restored = Host::open(
            source_directory.path().to_owned(),
            "Fixture".into(),
            source_directory.path().join("ginfer-serve"),
            vec![],
            vec![],
            vec![gpu()],
        )
        .await
        .unwrap();
        assert_eq!(
            restored.data.lock().await.profiles[&instance_id].model_id,
            model_id
        );
        assert_eq!(restored.inventory.read().await[0].id, model_id);
        assert_eq!(&restored.inventory.read().await[0].path, destination);
        assert!(!restored.processes.lock().await.has_children());
        assert_eq!(std::fs::read(&profile_path).unwrap(), profile_bytes);
        println!(
            "{}",
            json!({"acceptance":"native-two-disk-managed-move","passed":true,
            "profile_sha256":hex::encode(Sha256::digest(&profile_bytes)),
            "source":source,"destination":destination,"source_device":std::fs::metadata(source_directory.path()).unwrap().dev(),
            "destination_device":std::fs::metadata(destination_directory.path()).unwrap().dev(),
            "model_id":model_id,"saved_instance_id":instance_id,"bytes":original_bytes.len(),
            "checks":["storage override preserves existing model","verified move crosses filesystems",
            "source removed after verified publication","model UUID and saved reference survive restart","instances remain stopped"],
            "limits":"tiny valid container; no model execution, bandwidth measurement, or qualification"})
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn engine_quotes_gate_completion_and_saved_instances_restart_stopped() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let (host, mut jobs) = installed_host(directory.path(), 1).await;
        // Seed the installed download's actual published recommendation, not
        // just the wizard's catalog. Its historical arena cannot fit this quote.
        let release = &mut jobs[0].release;
        release.launch_profiles.push(
            serde_json::from_value(json!({
                "id":"stale-first-run-arena", "name":"Synthetic published recommendation",
                "platform":std::env::consts::OS, "identity":release.identity,
                "artifact_sha256":release.sha256, "artifact_bytes":release.bytes,
                "tp":1, "draft_tp":0, "gpu_name":"Fixture GPU", "compute_capability":"12.0",
                "vram_tier_gib":32, "min_memory_mib_per_gpu":32768,
                "max_context":65536, "concurrency":3,
                "options":{"spec":"none", "kv_arena_bytes":1_u64 << 32},
                "qualification":{"tier":"full-context-tested", "evidence":"synthetic fixture only",
                    "engine_revision":"fixture", "free_bytes_per_gpu":1_u64 << 30,
                    "full_context_requests":3}
            }))
            .unwrap(),
        );
        release.launch_profiles[0].validate().unwrap();
        drop(host);
        let persisted_jobs: std::collections::BTreeMap<_, _> =
            jobs.iter().map(|job| (job.id, job.clone())).collect();
        std::fs::write(
            directory.path().join("model-downloads.json"),
            serde_json::to_vec(&persisted_jobs).unwrap(),
        )
        .unwrap();
        let host = Host::open(
            directory.path().to_owned(),
            "Fixture".into(),
            directory.path().join("ginfer-serve"),
            vec![],
            vec![],
            vec![gpu()],
        )
        .await
        .unwrap();
        let quote = json!({"schema":"ginfer-startup-quote-v1","model_id":"muse-glimmer-30b","weights_id":"nvfp4",
            "tensor_parallel_size":1,"ranks":[{"rank":0,"free_bytes":1048576,"weights_bytes":8192,
                "state_bytes":4096,"graph_allowance_bytes":4096,"minimum_kv_arena_bytes":4096,
                "kv_arena_alignment_bytes":4096,"headroom_bytes":4096,"startup_peak_bytes":20480}]});
        // This executable records the command and emits synthetic Engine facts;
        // it cannot load a model or access a GPU.
        let script = format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\ncat <<'QUOTE'\n{}\nQUOTE\n",
            directory.path().join("quote-args").display(),
            quote
        );
        for name in ["ginfer-serve", "ginfer"] {
            let path = directory.path().join(name);
            std::fs::write(&path, &script).unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        host.store_first_run(Progress {
            gpu_uuids: vec![gpu().uuid],
            storage_accepted: true,
            catalog_loaded: true,
            releases: vec![jobs[0].release.clone()],
            download_ids: vec![jobs[0].id],
            ..Default::default()
        })
        .await
        .unwrap();
        assert!(host
            .first_run_action(json!({"action":"complete"}))
            .await
            .is_err());
        host.first_run_maintenance().await.unwrap();
        let status = host.first_run_status().await.unwrap();
        assert!(status["startup_profiles"][0]["quote"].is_object());
        assert_eq!(status["startup_profiles"][0]["max_context"], 65536);
        assert_eq!(status["startup_profiles"][0]["concurrency"], 3);
        assert!(status["startup_profiles"][0]["kv_arena_bytes"].is_null());
        let args = std::fs::read_to_string(directory.path().join("quote-args")).unwrap();
        assert!(args.lines().any(|arg| arg == "--quote-only"));
        assert!(!args.lines().any(|arg| arg == "--kv-arena-bytes"));
        let args: Vec<_> = args.lines().collect();
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--max-context", "65536"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--max-concurrency", "3"]));
        assert!(!host.processes.lock().await.has_children());
        assert!(host
            .first_run_action(json!({"action":"startup","download_id":jobs[0].id,"concurrency":0}))
            .await
            .is_err());
        host.first_run_action(
            json!({"action":"startup","download_id":jobs[0].id,"concurrency":2,
            "max_context":4096,"instance_count":2,"kv_arena_bytes":1048576}),
        )
        .await
        .unwrap();
        host.first_run_maintenance().await.unwrap();
        let status = host.first_run_status().await.unwrap();
        assert!(status["startup_profiles"][0]["error"]
            .as_str()
            .unwrap()
            .contains("cannot fit 2"));
        assert!(host
            .first_run_action(json!({"action":"complete"}))
            .await
            .is_err());
        host.first_run_action(
            json!({"action":"startup","download_id":jobs[0].id,"kv_arena_bytes":null}),
        )
        .await
        .unwrap();
        host.first_run_maintenance().await.unwrap();
        assert_eq!(
            host.first_run_action(json!({"action":"complete"}))
                .await
                .unwrap()["step"],
            "complete"
        );
        let snapshot = host.snapshot().await;
        assert_eq!(snapshot["instances"].as_array().unwrap().len(), 2);
        assert!(snapshot["instances"]
            .as_array()
            .unwrap()
            .iter()
            .all(|i| i["status"] == "stopped"
                && i["profile"]["qualified_profile_id"].is_null()
                && i["profile"]["kv_arena_bytes"].is_null()));
        drop(host);
        let restored = Host::open(
            directory.path().to_owned(),
            "Fixture".into(),
            directory.path().join("ginfer-serve"),
            vec![],
            vec![],
            vec![gpu()],
        )
        .await
        .unwrap();
        assert_eq!(
            restored.first_run_status().await.unwrap()["step"],
            "complete"
        );
        assert!(restored.snapshot().await["instances"]
            .as_array()
            .unwrap()
            .iter()
            .all(|i| i["status"] == "stopped"));
    }

    #[test]
    fn capacity_recommendations_preserve_supported_integer_alternatives() {
        let (nvfp4, _) = package(0);
        let mut int = nvfp4.clone();
        int.identity.weights_id = "int4".into();
        int.sha256 = "b".repeat(64);
        let mut smol = int.clone();
        smol.identity.weights_id = "smol".into();
        smol.sha256 = "c".repeat(64);
        let profile =
            json!({"ram_bytes":128_u64<<30,"gpus":[{"uuid":gpu().uuid,"vram_bytes":32_u64<<30}]});
        let releases = [nvfp4, int, smol];
        let blackwell = recommendations(&releases, &[gpu()], &[gpu().uuid], &profile, u64::MAX);
        assert_eq!(blackwell.len(), 3);
        assert_eq!(blackwell[0]["release"]["identity"]["weights_id"], "nvfp4");
        let mut ampere = gpu();
        ampere.compute_capability = Some("8.6".into());
        let choices = recommendations(&releases, &[ampere], &[gpu().uuid], &profile, u64::MAX);
        assert_eq!(choices.len(), 2);
        assert!(choices
            .iter()
            .all(|r| r["release"]["identity"]["weights_id"] != "nvfp4"));
        assert!(
            recommendations(&releases, &[gpu()], &[gpu().uuid], &profile, 0)
                .iter()
                .all(|r| r["recommended"] == false)
        );
    }

    #[test]
    fn vision_recommendations_prefer_fitting_muse_int_or_qwen_and_keep_mix_visible() {
        let (mut int, _) = package(0);
        int.name = "Muse INT".into();
        int.identity.weights_id = "groupwise-int-dflash-q4".into();
        int.sha256 = "46b5d54ee64ccd278f2a1a4d2c6d5aa9fc9097e8db0c3d165179aee5f2cb5b66".into();
        int.bytes = 20_u64 << 30;
        int.min_vram_mib_per_gpu = 24 * 1024;
        let mut mix = int.clone();
        mix.name = "Muse 2-bit mix".into();
        mix.identity.weights_id = "smol-q2g64-mix-dflash-q4".into();
        mix.sha256 = "9d4ca1b204b993e3a5dd9e52c8eda0d804801dd4ded664dd37b81641fcb44a2c".into();
        mix.bytes = 8_u64 << 30;
        mix.min_vram_mib_per_gpu = 8 * 1024;
        let mut qwen = int.clone();
        qwen.name = "Qwen INT".into();
        qwen.identity.model_id = "qwen3.8-27b".into();
        qwen.identity.weights_id = "groupwise-int-dflash2-q4".into();
        qwen.sha256 = "bcf29abd1598f5666c641da7c59ac28bd999aa98a8d6ba533ae7aa579abd06a7".into();
        qwen.bytes = 15_u64 << 30;
        qwen.min_vram_mib_per_gpu = 16 * 1024;
        // Synthetic capacity thresholds exercise fit policy, not measured Engine requirements.
        let mut profile =
            json!({"ram_bytes":128_u64<<30,"gpus":[{"uuid":gpu().uuid,"vram_bytes":32_u64<<30}]});
        let choices = recommendations(
            &[mix.clone(), int.clone()],
            &[gpu()],
            &[gpu().uuid],
            &profile,
            u64::MAX,
        );
        assert_eq!(choices.len(), 2);
        assert_eq!(choices[0]["release_id"], int.sha256);
        assert_eq!(choices[0]["recommended"], true);
        assert_eq!(choices[1]["release_id"], mix.sha256);
        assert_eq!(choices[1]["recommended"], false);

        profile["gpus"][0]["vram_bytes"] = json!(16_u64 << 30);
        let choices = recommendations(
            &[mix.clone(), int.clone(), qwen.clone()],
            &[gpu()],
            &[gpu().uuid],
            &profile,
            u64::MAX,
        );
        assert_eq!(choices.len(), 3);
        assert_eq!(choices[0]["release_id"], qwen.sha256);
        assert_eq!(choices[0]["recommended"], true);
        assert_eq!(choices[1]["release_id"], mix.sha256);
        assert_eq!(choices[1]["recommended"], false);
        assert_eq!(choices[2]["release_id"], int.sha256);
        assert_eq!(choices[2]["recommended"], false);
        assert!(choices[2]["reason"]
            .as_str()
            .unwrap()
            .contains("Below the published per-GPU VRAM requirement"));
    }

    #[test]
    fn group_rejects_duplicates_and_mixed_families() {
        let gpu = |id: &str, sm: &str| Gpu {
            uuid: id.into(),
            name: "NVIDIA".into(),
            display_name: None,
            memory_mib: 32768,
            compute_capability: Some(sm.into()),
        };
        let gpus = vec![gpu("a", "8.6"), gpu("b", "12.0")];
        assert!(validate_group(&gpus, &["a".into()]).is_ok());
        assert!(validate_group(&gpus, &["a".into(), "a".into()]).is_err());
        assert!(validate_group(&gpus, &["a".into(), "b".into()]).is_err());
    }
    #[test]
    fn shared_progress_resumes_in_order() {
        let mut p = Progress::default();
        assert_eq!(stage(&p, false, &[]), "gpu");
        p.gpu_uuids = vec!["a".into()];
        assert_eq!(stage(&p, false, &[]), "profiling");
        assert_eq!(stage(&p, true, &[]), "storage");
        p.storage_accepted = true;
        assert_eq!(stage(&p, true, &[]), "models");
        p.download_ids.push(Uuid::new_v4());
        assert_eq!(stage(&p, true, &[]), "downloads");
        let restored: Progress = serde_json::from_value(serde_json::to_value(&p).unwrap()).unwrap();
        assert_eq!(stage(&restored, true, &[]), "downloads");
    }
}
