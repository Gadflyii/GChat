//! One durable first-run workflow, driven by every installed client.
use crate::{
    hardware_profile::{ArtifactProfileIntent, HardwareProfileAction, HardwareProfileStatus},
    model_downloads::{Download, Release},
    service::{write_private, Gpu, Host, LaunchRequest},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, path::PathBuf, sync::atomic::Ordering};
use uuid::Uuid;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Progress {
    pub gpu_uuids: Vec<String>,
    pub storage_accepted: bool,
    pub requested_storage: Option<PathBuf>,
    pub storage_error: Option<String>,
    /// Fingerprint of reviewed disk evidence, selected GPUs/files and root.
    /// Refreshing unrelated GPU timings does not change the placement decision.
    pub reviewed_storage: Option<String>,
    pub releases: Vec<Release>,
    pub catalog_loaded: bool,
    pub catalog_error: Option<String>,
    /// None means the user has never chosen; Some([]) is an explicit clear.
    pub selected_release_ids: Option<Vec<String>>,
    pub download_error: Option<String>,
    pub download_ids: Vec<Uuid>,
    pub startup_profiles: Vec<Startup>,
    pub complete: bool,
}

impl Progress {
    fn selected_releases(&self) -> &[String] {
        self.selected_release_ids.as_deref().unwrap_or_default()
    }
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
    /// GInfer chose these settings because no tested settings exist for these
    /// cards; the startup check may shorten the context until it fits.
    #[serde(default)]
    pub automatic: bool,
}

/// For settings GInfer chose itself: the longest standard context below `current` that the
/// startup check says fits, when `current` does not fit.
fn automatic_shorter_context(quote: &Value, current: u32) -> Option<u32> {
    if quote["fit"]["fits"] != false {
        return None;
    }
    quote["fit"]["max_context"]
        .as_u64()
        .map(|n| n.min(u64::from(u32::MAX)) as u32)
        .and_then(crate::startup_fit::standard_context)
        .filter(|context| *context < current)
}

fn stage(progress: &Progress, profiled: bool, reviewed: bool, jobs: &[Download]) -> &'static str {
    if progress.complete {
        return "complete";
    }
    if progress.gpu_uuids.is_empty() {
        return "gpu";
    }
    if !progress.storage_accepted {
        return "storage";
    }
    if progress.download_ids.is_empty() && progress.selected_releases().is_empty() {
        return "models";
    }
    if progress.download_ids.is_empty() && progress.download_error.is_some() {
        return "models";
    }
    if progress.selected_releases().iter().any(|sha| {
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
    if !profiled {
        return "profiling";
    }
    if !reviewed {
        return "storage_review";
    }
    "startup"
}

fn storage_review_key(
    progress: &Progress,
    jobs: &[Download],
    profile: &Value,
    root: &std::path::Path,
) -> Option<String> {
    let selected: Option<Vec<_>> = progress.download_ids.iter().map(|id| {
        let job = jobs.iter().find(|job| job.id == *id && job.status == "installed")?;
        Some(json!({"id":id,"sha256":job.release.sha256,"bytes":job.release.bytes,"path":job.path.as_ref()?}))
    }).collect();
    let selected = selected.filter(|selected| !selected.is_empty())?;
    let storage_profile = json!({"schema_version":profile["schema_version"],"disks":profile["disks"]});
    let bytes = serde_json::to_vec(
        &json!({"gpus":progress.gpu_uuids,"profile":storage_profile,"root":root,"models":selected}),
    )
    .ok()?;
    Some(hex::encode(Sha256::digest(bytes)))
}

/// A selected download that no longer exists (deleted on Models) releases the
/// whole selection so Welcome returns to model choice instead of re-admitting it.
fn reconcile(progress: &mut Progress, jobs: &[Download]) -> bool {
    if progress.complete
        || !progress
            .download_ids
            .iter()
            .any(|id| !jobs.iter().any(|j| j.id == *id))
    {
        return false;
    }
    release_selection(progress);
    true
}

fn release_selection(progress: &mut Progress) {
    progress.reviewed_storage = None;
    progress.selected_release_ids = Some(Vec::new());
    progress.download_ids.clear();
    progress.download_error = None;
    progress.startup_profiles.clear();
}

fn needs_maintenance(progress: &Progress, jobs: &[Download]) -> bool {
    if progress.complete || progress.gpu_uuids.is_empty() {
        return false;
    }
    if !progress.catalog_loaded {
        return true;
    }
    if !progress.storage_accepted {
        return progress.requested_storage.is_some() && progress.storage_error.is_none();
    }
    // Download progress and terminal states do not notify the Host monitor.
    // Keep its timer until admitted work settles, then wait for an explicit action.
    if jobs.iter().any(|job| {
        progress.download_ids.contains(&job.id)
            && matches!(
                job.status.as_str(),
                "queued" | "downloading" | "verifying" | "pausing"
            )
    }) {
        return true;
    }
    if progress.download_error.is_none()
        && progress.selected_releases().iter().any(|sha| {
            !progress.download_ids.iter().any(|id| {
                jobs.iter()
                    .any(|job| job.id == *id && job.release.sha256 == *sha)
            })
        })
    {
        return true;
    }
    !progress.download_ids.is_empty()
        && progress.download_ids.iter().all(|id| {
            jobs.iter()
                .any(|job| job.id == *id && job.status == "installed")
        })
        && (progress.startup_profiles.len() != progress.download_ids.len()
            || progress
                .startup_profiles
                .iter()
                .any(|profile| profile.quote.is_none() && profile.error.is_none()))
}

fn selected_scope_needs_resume(
    status: &HardwareProfileStatus,
    gpus: &[String],
    intent: &ArtifactProfileIntent,
) -> bool {
    crate::hardware_profile::group_key(&status.gpu_uuids)
        == crate::hardware_profile::group_key(gpus)
        && status.selected_artifact.as_ref() == Some(intent)
        && matches!(
            status.status.as_str(),
            "failed" | "interrupted" | "cancelled"
        )
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
    free: u64,
) -> Vec<Value> {
    let capacity = selected
        .iter()
        .map(|id| gpus.iter().find(|g| &g.uuid == id).map(|g| g.memory_mib))
        .collect::<Option<Vec<_>>>()
        .and_then(|memory| memory.into_iter().min());
    let mut choices: Vec<_> = releases.iter().filter(|release| release.tp as usize == selected.len()
        && selected.iter().all(|id| gpus.iter().any(|g| &g.uuid == id
            && release.identity.supports_gpu(g.compute_capability.as_deref())))).map(|release| {
        let fits = capacity.is_some_and(|vram| vram >= release.min_vram_mib_per_gpu
                && release.bytes <= free);
        let reason = match capacity {
            None => "GInfer could not read your graphics memory. It will measure your hardware before this model can start.",
            Some(vram) if vram < release.min_vram_mib_per_gpu => "Needs more graphics memory than the selected card has.",
            _ if release.bytes > free => "Not enough free space in the selected folder.",
            _ => "Fits your graphics card and free disk space. GInfer still checks the download and measures your hardware before it can start.",
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
    async fn first_run_storage_reviewed(&self, progress: &Progress, jobs: &[Download]) -> bool {
        let Some(reviewed) = &progress.reviewed_storage else {
            return false;
        };
        let Some(profile) = self.first_run_profile(progress).await else {
            return false;
        };
        storage_review_key(progress, jobs, &profile, &self.downloads.root()).as_ref()
            == Some(reviewed)
    }

    async fn first_run_profile_busy(&self) -> bool {
        self.processes
            .lock()
            .await
            .hardware_profile
            .as_ref()
            .is_some_and(|job| job.busy())
    }

    async fn first_run_selected_ready(&self, progress: &Progress) -> bool {
        if progress.download_ids.is_empty()
            || progress.startup_profiles.len() != progress.download_ids.len()
            || progress.download_ids.iter().any(|id| {
                !progress
                    .startup_profiles
                    .iter()
                    .any(|profile| profile.download_id == *id)
            })
        {
            return false;
        }
        let Some(job) = self.processes.lock().await.hardware_profile.clone() else {
            return false;
        };
        if job.busy() {
            return false;
        }
        for profile in &progress.startup_profiles {
            let Ok(intent) = self.selected_profile_intent(&profile.request).await else {
                return false;
            };
            if !job.artifact_is_accepted(&progress.gpu_uuids, &intent) {
                return false;
            }
        }
        true
    }

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
        let mut progress = self.data.lock().await.first_run.clone();
        let jobs = self.downloads.list().await;
        reconcile(&mut progress, &jobs);
        let profile = self.first_run_profile(&progress).await;
        let selected: Vec<_> = jobs
            .iter()
            .filter(|j| progress.download_ids.contains(&j.id))
            .cloned()
            .collect();
        let root = self.downloads.root();
        let free = crate::model_downloads::available_bytes(root.clone())
            .await
            .ok();
        let models = recommendations(
            &progress.releases,
            &self.gpus,
            &progress.gpu_uuids,
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
        let selected_models: Vec<_> = selected.iter().filter(|job| job.status == "installed").map(|job| json!({
            "download_id":job.id,"name":job.release.name,"path":job.path,"bytes":job.release.bytes
        })).collect();
        let placements: Vec<_> = selected
            .iter()
            .filter(|job| job.status == "installed")
            .filter_map(|job| job.path.clone().map(|path| (path, job.release.bytes)))
            .collect();
        let profiled = self.first_run_selected_ready(&progress).await;
        let review_key = profile
            .as_ref()
            .filter(|_| profiled)
            .and_then(|profile| storage_review_key(&progress, &jobs, profile, &root));
        let mut storage = json!({"path":root,"available_bytes":free,"existing_models_preserved":true,
            "requested_path":progress.requested_storage,"accepted":progress.storage_accepted,
            "selected_models":selected_models,
            "review_key":review_key,
            "existing_downloads":jobs.iter().filter(|j|j.status=="installed" && j.storage_root!=root).collect::<Vec<_>>()});
        storage["required_bytes"] = json!(if placements.is_empty() {
            required
        } else {
            placements
                .iter()
                .try_fold(0_u64, |total, (_, bytes)| total.checked_add(*bytes))
                .ok_or("Selected package size overflow")?
        });
        if let Some(profile) = &profile {
            let recommendation = if placements.is_empty() {
                crate::model_storage::recommend_storage(profile, &root, required).await
            } else {
                crate::model_storage::recommend_storage_for_models(profile, &root, &placements)
                    .await
            };
            match recommendation {
                Ok(recommendation) => {
                    storage["required_bytes"] = json!(recommendation.required_bytes);
                    storage["recommended_path"] = json!(recommendation.recommended_path);
                    storage["candidates"] = json!(recommendation.candidates);
                }
                Err(error) => storage["error"] = error.into(),
            }
        }
        if let Some(error) = &progress.storage_error {
            storage["error"] = json!(error);
        } else if profiled && review_key.is_none() {
            storage["error"] = json!("Accepted hardware profile or installed model locations are unavailable; refresh profiling before reviewing storage");
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
            "quote":p.quote,"error":p.error,"instance_ids":p.instance_ids,"automatic":p.automatic,
            "qualification":"Engine startup estimate; full-context validation is separate"
        })).collect();
        let step = stage(
            &progress,
            profiled,
            self.first_run_storage_reviewed(&progress, &jobs).await,
            &jobs,
        );
        let error = progress
            .download_error
            .clone()
            .or(progress.catalog_error.clone())
            .or_else(|| {
                (step == "profiling")
                    .then(|| {
                        progress
                            .startup_profiles
                            .iter()
                            .find_map(|p| p.error.clone())
                    })
                    .flatten()
            })
            .map(crate::service::plain_disk_error);
        Ok(json!({"step":step,"gpu_uuids":progress.gpu_uuids,
            "hardware_profile":hardware.map(|h|json!(h)).unwrap_or_else(||json!({"status":"unavailable","error":"Hardware profiling is not configured"})),
            "storage":storage,"models":models,"selected_release_ids":progress.selected_release_ids,"catalog_loaded":progress.catalog_loaded,"error":error,
            "selected_downloads":selected,"startup_profiles":startup,
            "maintenance_error":self.first_run_maintenance_error.read().await.clone()}))
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
        if body["action"] == "models" && body.get("release_ids").is_none() {
            if progress.gpu_uuids.is_empty()
                || progress.complete
                || !progress.download_ids.is_empty()
            {
                return Err(
                    "Choose models after selecting GPUs and before admitting downloads".into(),
                );
            }
            // An omitted choice is a read, not a retry or permission to admit
            // the saved selection. Keep its errors and durable state intact.
            return self.first_run_status().await;
        }
        let jobs = self.downloads.list().await;
        if reconcile(&mut progress, &jobs) {
            self.store_first_run(progress.clone()).await?;
        }
        let profiled = self.first_run_selected_ready(&progress).await;
        let reviewed = self.first_run_storage_reviewed(&progress, &jobs).await;
        let step = stage(&progress, profiled, reviewed, &jobs);
        match body["action"].as_str().ok_or("first-run action required")? {
            "reselect" => {
                if step != "downloads" {
                    return Err("There is no download to replace at this step".into());
                }
                for job in &jobs {
                    if progress.download_ids.contains(&job.id) && job.status == "failed" {
                        self.downloads.action(job.id, "discard").await?;
                    }
                }
                release_selection(&mut progress);
            }
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
                // Selecting GPUs is durable intent, not permission to calibrate
                // every format before the selected artifact is installed.
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
                    || (!progress.download_ids.is_empty()
                        && step != "storage_review"
                        && !(step == "storage" && progress.requested_storage.is_some()))
                {
                    return Err(
                        "Choose storage before downloads or during measured storage review".into(),
                    );
                }
                let path = PathBuf::from(body["path"].as_str().ok_or("storage path required")?);
                if !path.is_absolute() {
                    return Err("Choose an absolute model storage path".into());
                }
                progress.requested_storage = Some(path);
                progress.reviewed_storage = None;
                for profile in &mut progress.startup_profiles {
                    profile.quote = None;
                    profile.error = None;
                }
                progress.storage_accepted = false;
                progress.storage_error = None;
                progress.download_error = None;
                self.store_first_run(progress.clone()).await?;
                self.apply_first_run_storage(&mut progress).await?;
            }
            "accept_storage" => {
                let _lifecycle = self.lifecycle.lock().await;
                if step != "storage_review" || !profiled {
                    return Err(
                        "Complete selected-artifact profiling before reviewing model locations"
                            .into(),
                    );
                }
                if !self.first_run_selected_ready(&progress).await {
                    return Err(
                        "Selected-artifact profiling changed; refresh the storage review".into(),
                    );
                }
                // Recheck the actual retained files, rather than requiring space
                // for another copy or requiring a measured rate to keep them.
                for id in &progress.download_ids {
                    let job = jobs
                        .iter()
                        .find(|job| job.id == *id && job.status == "installed")
                        .ok_or("A selected package is no longer installed")?;
                    let path = job.path.as_ref().ok_or("Installed package has no path")?;
                    let metadata = tokio::fs::metadata(path).await.map_err(|error| {
                        format!(
                            "Cannot keep installed package '{}': {error}",
                            path.display()
                        )
                    })?;
                    if !metadata.is_file() || metadata.len() != job.release.bytes {
                        return Err("A selected package changed; verify its managed download before continuing".into());
                    }
                }
                let profile = self.first_run_profile(&progress).await.ok_or("Accepted hardware profile is unavailable; refresh profiling before reviewing storage")?;
                let key = storage_review_key(&progress, &jobs, &profile, &self.downloads.root())
                    .ok_or("Selected model placement is unavailable")?;
                if body["review_key"].as_str() != Some(key.as_str()) {
                    return Err("Model locations or measurements changed; refresh the storage review before keeping these locations".into());
                }
                progress.reviewed_storage = Some(key);
                for profile in &mut progress.startup_profiles {
                    profile.quote = None;
                    profile.error = None;
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
                progress.selected_release_ids = Some(ids.into_iter().collect());
                progress.download_error = None;
                self.store_first_run(progress.clone()).await?;
                if !progress.selected_releases().is_empty()
                    && progress.storage_accepted
                    && !self.first_run_profile_busy().await
                {
                    self.admit_first_run_downloads(&mut progress).await?;
                }
            }
            "resume" => match step {
                "profiling" => {
                    let _lifecycle = self.lifecycle.lock().await;
                    self.stop_background_profile().await?;
                    if self.processes.lock().await.has_children() {
                        return Err(
                            "Stop active model instances before resuming selected profiling".into(),
                        );
                    }
                    self.draft_width.cancel().await?;
                    let (job, cli) = {
                        let processes = self.processes.lock().await;
                        (
                            processes
                                .hardware_profile
                                .clone()
                                .ok_or("Hardware profiling is not configured")?,
                            processes.profiling_cli(&progress.gpu_uuids),
                        )
                    };
                    let status = job.status(cli.clone());
                    let mut resumed = false;
                    for profile in &progress.startup_profiles {
                        let intent = self.selected_profile_intent(&profile.request).await?;
                        if selected_scope_needs_resume(&status, &progress.gpu_uuids, &intent) {
                            job.start_scoped(
                                HardwareProfileAction::Resume,
                                cli,
                                progress.gpu_uuids.clone(),
                                intent,
                            )?;
                            resumed = true;
                            break;
                        }
                    }
                    if !resumed
                        && matches!(
                            status.status.as_str(),
                            "failed" | "interrupted" | "cancelled"
                        )
                    {
                        return Err("Resolve the interrupted hardware profiling job in Hardware settings before selected-artifact profiling can continue".into());
                    }
                    for profile in &mut progress.startup_profiles {
                        profile.error = None;
                        profile.quote = None;
                    }
                }
                "downloads" => {
                    progress.download_error = None;
                    self.admit_first_run_downloads(&mut progress).await?;
                    let _lifecycle = self.lifecycle.lock().await;
                    if self.first_run_profile_busy().await {
                        return Err(
                            "Wait for active hardware profiling before resuming downloads".into(),
                        );
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
                _ => {
                    // Maintenance may recover between rendering Retry and
                    // receiving the action. Return its current status quietly.
                    if self.first_run_maintenance_error.read().await.is_none() {
                        return self.first_run_status().await;
                    }
                    let changed = match step {
                        "storage" => progress.storage_error.take().is_some(),
                        "models" => progress.download_error.take().is_some(),
                        _ => false,
                    };
                    if !changed {
                        // A maintenance failure can remain at any stage. Wake
                        // its retry without rewriting unchanged saved choices.
                        self.processes
                            .lock()
                            .await
                            .activity_notification()
                            .notify_one();
                        return self.first_run_status().await;
                    }
                }
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
                profile.automatic = false;
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
                let _lifecycle = self.lifecycle.lock().await;
                if !self.first_run_selected_ready(&progress).await {
                    return Err(
                        "Complete current selected-artifact profiling before setup can finish"
                            .into(),
                    );
                }
                if !self.first_run_storage_reviewed(&progress, &jobs).await {
                    return Err("Review current model locations before setup can finish".into());
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
        let mut progress = self.data.lock().await.first_run.clone();
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
        if progress.download_ids.contains(&id) {
            progress.reviewed_storage = None;
            for profile in &mut progress.startup_profiles {
                profile.quote = None;
                profile.error = None;
            }
            self.store_first_run(progress).await?;
        }
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
        self.processes
            .lock()
            .await
            .activity_notification()
            .notify_one();
        moved?;
        scanned?;
        self.first_run_status().await
    }

    pub async fn first_run_pending(&self) -> bool {
        let mut progress = self.data.lock().await.first_run.clone();
        let jobs = self.downloads.list().await;
        reconcile(&mut progress, &jobs);
        if progress.complete
            || !progress.catalog_loaded
            || stage(&progress, true, true, &jobs) != "startup"
            || progress.startup_profiles.len() != progress.download_ids.len()
            || progress.download_ids.iter().any(|id| {
                !progress
                    .startup_profiles
                    .iter()
                    .any(|profile| profile.download_id == *id)
            })
        {
            return needs_maintenance(&progress, &jobs);
        }
        // Retained quotes cannot authorize this process or a replacement runtime.
        // Follow maintenance's first-unaccepted-scope barrier so an interrupted
        // scope parks until Resume instead of polling or hiding later work.
        let (job, cli) = {
            let processes = self.processes.lock().await;
            (
                processes.hardware_profile.clone(),
                processes.profiling_cli(&progress.gpu_uuids),
            )
        };
        let Some(job) = job else {
            return needs_maintenance(&progress, &jobs);
        };
        if job.foreground_busy() {
            return true;
        }
        for profile in &progress.startup_profiles {
            let Ok(intent) = self.selected_profile_intent(&profile.request).await else {
                return profile.error.is_none();
            };
            if job.artifact_is_accepted(&progress.gpu_uuids, &intent) {
                continue;
            }
            return profile.error.is_none()
                && !selected_scope_needs_resume(&job.status(cli), &progress.gpu_uuids, &intent);
        }
        self.first_run_storage_reviewed(&progress, &jobs).await
            && progress
                .startup_profiles
                .iter()
                .any(|profile| profile.quote.is_none() && profile.error.is_none())
    }

    async fn apply_first_run_storage(&self, progress: &mut Progress) -> Result<(), String> {
        if progress.storage_accepted || progress.storage_error.is_some() {
            return Ok(());
        }
        let Some(path) = progress.requested_storage.clone() else {
            return Ok(());
        };
        let _lifecycle = self.lifecycle.lock().await;
        self.stop_background_profile().await?;
        if self.first_run_profile_busy().await {
            return Ok(());
        }
        // Validate storage before downloading the selected artifact, while
        // retaining the lifecycle fence against any active calibration.
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
        if !progress.storage_accepted || self.first_run_profile_busy().await {
            return Err(
                "Wait for active hardware profiling and validate storage before downloading models"
                    .into(),
            );
        }
        let jobs = self.downloads.list().await;
        let bytes = progress
            .selected_releases()
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
        for sha in progress.selected_releases().to_vec() {
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
        if !self.first_run_pending().await
            && self.first_run_maintenance_error.read().await.is_none()
        {
            return Ok(());
        }
        let _operation = self.first_run_operation.lock().await;
        let result = self.maintain_first_run().await;
        // Disk-full failures must remain visible even when saving host.json fails.
        // Keep this process-local and clear it only after maintenance succeeds.
        let mut previous = self.first_run_maintenance_error.write().await;
        let error = match &result {
            Err(error) => Some(crate::service::plain_disk_error(error.clone())),
            Ok(true) => None,
            Ok(false) => previous.clone(), // Waiting on active work is not a retry.
        };
        if *previous != error {
            *previous = error;
            self.revision.fetch_add(1, Ordering::SeqCst);
        }
        result.map(|_| ())
    }

    async fn maintain_first_run(&self) -> Result<bool, String> {
        let mut progress = self.data.lock().await.first_run.clone();
        let jobs = self.downloads.list().await;
        if reconcile(&mut progress, &jobs) {
            self.store_first_run(progress.clone()).await?;
        }
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
        {
            let _lifecycle = self.lifecycle.lock().await;
            self.stop_background_profile().await?;
            if self.first_run_profile_busy().await {
                return Ok(false);
            }
        }
        self.apply_first_run_storage(&mut progress).await?;
        if progress.storage_accepted
            && !progress.selected_releases().is_empty()
            && progress.download_error.is_none()
        {
            self.admit_first_run_downloads(&mut progress).await?;
        }
        let jobs = self.downloads.list().await;
        // This ignores profiling only to test that every selected download is
        // installed. Actual readiness below is exact artifact acceptance.
        if stage(&progress, true, true, &jobs) != "startup" {
            return Ok(progress.storage_error.is_none() && progress.download_error.is_none());
        }
        let _lifecycle = self.lifecycle.lock().await;
        self.stop_background_profile().await?;
        if self.first_run_profile_busy().await || self.processes.lock().await.has_children() {
            return Ok(false);
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
                automatic: published.is_none(),
            });
        }
        self.store_first_run(progress.clone()).await?;
        let (job, cli) = {
            let processes = self.processes.lock().await;
            (
                processes
                    .hardware_profile
                    .clone()
                    .ok_or("Hardware profiling is not configured")?,
                processes.profiling_cli(&progress.gpu_uuids),
            )
        };
        for index in 0..progress.startup_profiles.len() {
            let intent = match self
                .selected_profile_intent(&progress.startup_profiles[index].request)
                .await
            {
                Ok(intent) => intent,
                Err(error) => {
                    progress.startup_profiles[index].error = Some(error);
                    self.store_first_run(progress).await?;
                    return Ok(true);
                }
            };
            if job.artifact_is_accepted(&progress.gpu_uuids, &intent) {
                continue;
            }
            // Acceptance is deliberately process-local. Quotes retained across
            // restart cannot authorize completion before current-runtime Ensure.
            for profile in &mut progress.startup_profiles {
                profile.quote = None;
            }
            let status = job.status(cli.clone());
            if selected_scope_needs_resume(&status, &progress.gpu_uuids, &intent)
                || progress.startup_profiles[index].error.is_some()
            {
                self.store_first_run(progress).await?;
                return Ok(true);
            }
            if let Err(error) = job.start_scoped(
                HardwareProfileAction::Ensure,
                cli.clone(),
                progress.gpu_uuids.clone(),
                intent.clone(),
            ) {
                progress.startup_profiles[index].error = Some(error);
            } else if !job.busy() && !job.artifact_is_accepted(&progress.gpu_uuids, &intent) {
                progress.startup_profiles[index].error = Some("Resolve the interrupted hardware profiling job before selected-artifact profiling can continue".into());
            }
            self.store_first_run(progress).await?;
            return Ok(true);
        }
        // Calibration may have changed the saved disk measurements. Park here
        // for one explicit placement decision before obtaining startup quotes.
        if !self.first_run_storage_reviewed(&progress, &jobs).await {
            progress.reviewed_storage = None;
            for profile in &mut progress.startup_profiles {
                profile.quote = None;
            }
            return self.store_first_run(progress).await.map(|_| true);
        }
        for profile in &mut progress.startup_profiles {
            if profile.quote.is_some() || profile.error.is_some() {
                continue;
            }
            let mut quoted = self.quote_first_run(profile).await;
            // Without tested settings, the longest standard context that fits is chosen.
            let shorter = match &quoted {
                Ok(quote) if profile.automatic => automatic_shorter_context(quote, profile.request.max_context),
                _ => None,
            };
            if let Some(context) = shorter {
                profile.request.max_context = context;
                quoted = self.quote_first_run(profile).await;
            }
            match quoted {
                Ok(quote) if quote["fit"]["fits"] == false => {
                    profile.error = Some(quote["fit"]["message"].as_str()
                        .unwrap_or("These settings do not fit in the memory that is free.").to_owned());
                }
                Ok(quote) => {
                    profile.quote = Some(quote);
                }
                Err(error) => profile.error = Some(error),
            }
        }
        self.store_first_run(progress).await.map(|_| true)
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

    #[test]
    fn automatic_startup_settings_take_the_longest_standard_context_that_fits() {
        let fits = json!({"fit":{"fits":true,"max_context":null}});
        assert_eq!(automatic_shorter_context(&fits, 262144), None);
        let short = json!({"fit":{"fits":false,"max_context":169984}});
        assert_eq!(automatic_shorter_context(&short, 262144), Some(131072));
        // Nothing shorter fits, or no fitting length is known: the check reports the shortfall.
        assert_eq!(automatic_shorter_context(&json!({"fit":{"fits":false,"max_context":4096}}), 262144), None);
        assert_eq!(automatic_shorter_context(&json!({"fit":{"fits":false,"max_context":null}}), 262144), None);
        assert_eq!(automatic_shorter_context(&short, 131072), None);
    }

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
                    verification: None,
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
    async fn model_choice_stays_unset_until_explicitly_cleared_and_survives_host_restart() {
        let directory = tempfile::tempdir().unwrap();
        let (host, _) = installed_host(directory.path(), 0).await;
        host.store_first_run(Progress {
            gpu_uuids: vec![gpu().uuid],
            storage_accepted: true,
            catalog_loaded: true,
            ..Default::default()
        })
        .await
        .unwrap();
        host.first_run_maintenance().await.unwrap();
        assert!(host.first_run_status().await.unwrap()["selected_release_ids"].is_null());
        let saved = std::fs::read(directory.path().join("host.json")).unwrap();
        let read = host
            .first_run_action(json!({"action":"models"}))
            .await
            .unwrap();
        assert!(read["selected_release_ids"].is_null());
        assert_eq!(
            saved,
            std::fs::read(directory.path().join("host.json")).unwrap()
        );
        drop(host);
        let (host, _) = installed_host(directory.path(), 0).await;
        assert!(host.first_run_status().await.unwrap()["selected_release_ids"].is_null());
        let cleared = host
            .first_run_action(json!({"action":"models","release_ids":[]}))
            .await
            .unwrap();
        assert_eq!(cleared["selected_release_ids"], json!([]));
        drop(host);
        let (host, _) = installed_host(directory.path(), 0).await;
        host.first_run_maintenance().await.unwrap();
        let status = host.first_run_status().await.unwrap();
        assert_eq!(status["selected_release_ids"], json!([]));
        assert_eq!(status["selected_downloads"], json!([]));
        assert_eq!(status["step"], "models");
        assert!(!host.first_run_pending().await);
    }

    #[tokio::test]
    async fn maintenance_write_failure_is_visible_and_clears_after_retry() {
        let directory = tempfile::tempdir().unwrap();
        let (host, _) = installed_host(directory.path(), 0).await;
        let requested = directory.path().join("selected-models");
        host.store_first_run(Progress {
            gpu_uuids: vec![gpu().uuid],
            catalog_loaded: true,
            requested_storage: Some(requested.clone()),
            ..Default::default()
        })
        .await
        .unwrap();
        let saved = directory.path().join("host.json");
        let retained = directory.path().join("retained-host.json");
        std::fs::rename(&saved, &retained).unwrap();
        std::fs::create_dir(&saved).unwrap();
        let revision = host.revision.load(Ordering::SeqCst);
        let error = host.first_run_maintenance().await.unwrap_err();
        let status = host.first_run_status().await.unwrap();
        assert_eq!(
            status["maintenance_error"],
            crate::service::plain_disk_error(error)
        );
        assert_eq!(status["storage"]["requested_path"], json!(requested));
        assert!(host.revision.load(Ordering::SeqCst) > revision);
        assert!(
            serde_json::from_slice::<Value>(&std::fs::read(&retained).unwrap())
                .unwrap()
                .get("maintenance_error")
                .is_none()
        );

        std::fs::remove_dir(&saved).unwrap();
        std::fs::rename(&retained, &saved).unwrap();
        // Resume wakes maintenance using the existing action, preserving choices.
        host.first_run_action(json!({"action":"resume"}))
            .await
            .unwrap();
        host.first_run_maintenance().await.unwrap();
        let status = host.first_run_status().await.unwrap();
        assert!(status["maintenance_error"].is_null());
        assert_eq!(status["storage"]["accepted"], true);
        assert_eq!(status["storage"]["requested_path"], json!(requested));
    }

    #[tokio::test]
    async fn maintenance_retry_rechecks_the_saved_folder_after_a_storage_error() {
        let directory = tempfile::tempdir().unwrap();
        let (host, _) = installed_host(directory.path(), 0).await;
        let requested = directory.path().join("selected-models");
        std::fs::write(&requested, []).unwrap();
        host.store_first_run(Progress {
            gpu_uuids: vec![gpu().uuid],
            catalog_loaded: true,
            requested_storage: Some(requested.clone()),
            ..Default::default()
        })
        .await
        .unwrap();
        host.first_run_maintenance().await.unwrap_err();
        let status = host.first_run_status().await.unwrap();
        assert!(status["maintenance_error"].is_string());
        assert!(host.data.lock().await.first_run.storage_error.is_some());
        host.first_run_maintenance().await.unwrap();
        assert!(host.first_run_status().await.unwrap()["maintenance_error"].is_string());

        // Repair the fixture without changing the saved folder choice.
        std::fs::remove_file(&requested).unwrap();
        host.first_run_action(json!({"action":"resume"}))
            .await
            .unwrap();
        assert!(host.data.lock().await.first_run.storage_error.is_none());
        host.first_run_maintenance().await.unwrap();
        let status = host.first_run_status().await.unwrap();
        assert!(status["maintenance_error"].is_null());
        assert_eq!(status["storage"]["accepted"], true);
        assert_eq!(status["storage"]["requested_path"], json!(requested));
    }

    #[tokio::test]
    async fn maintenance_retry_accepts_gpu_and_complete_without_rewriting_progress() {
        for (step, progress) in [
            (
                "gpu",
                Progress {
                    catalog_loaded: true,
                    ..Default::default()
                },
            ),
            (
                "complete",
                Progress {
                    gpu_uuids: vec![gpu().uuid],
                    storage_accepted: true,
                    catalog_loaded: true,
                    complete: true,
                    ..Default::default()
                },
            ),
        ] {
            let directory = tempfile::tempdir().unwrap();
            let (host, _) = installed_host(directory.path(), 0).await;
            host.store_first_run(progress).await.unwrap();
            // A failure from an earlier maintenance pass remains visible even
            // after another client changes the first-run stage.
            *host.first_run_maintenance_error.write().await =
                Some("Previous state write failed".into());
            let saved = std::fs::read(directory.path().join("host.json")).unwrap();
            let revision = host.revision.load(Ordering::SeqCst);
            let activity = host.processes.lock().await.activity_notification();
            let notified = activity.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            assert!(matches!(
                futures_util::poll!(notified.as_mut()),
                std::task::Poll::Pending
            ));

            let status = host
                .first_run_action(json!({"action":"resume"}))
                .await
                .unwrap();
            assert_eq!(status["step"], step);
            assert_eq!(status["maintenance_error"], "Previous state write failed");
            assert_eq!(host.revision.load(Ordering::SeqCst), revision);
            assert_eq!(
                std::fs::read(directory.path().join("host.json")).unwrap(),
                saved
            );
            assert!(matches!(
                futures_util::poll!(notified.as_mut()),
                std::task::Poll::Ready(())
            ));

            host.first_run_maintenance().await.unwrap();
            assert!(host.first_run_status().await.unwrap()["maintenance_error"].is_null());
        }
    }

    #[tokio::test]
    async fn stale_maintenance_retry_returns_current_status_without_writing_or_waking() {
        for (step, gpu_selected, storage_accepted, complete) in [
            ("gpu", false, false, false),
            ("storage", true, false, false),
            ("models", true, true, false),
            ("complete", true, true, true),
        ] {
            let directory = tempfile::tempdir().unwrap();
            let (host, _) = installed_host(directory.path(), 0).await;
            host.store_first_run(Progress {
                gpu_uuids: if gpu_selected {
                    vec![gpu().uuid]
                } else {
                    vec![]
                },
                storage_accepted,
                catalog_loaded: true,
                releases: vec![package(0).0],
                complete,
                ..Default::default()
            })
            .await
            .unwrap();
            *host.first_run_maintenance_error.write().await =
                Some("Previous state write failed".into());
            assert!(host.first_run_status().await.unwrap()["maintenance_error"].is_string());
            // The monitor repairs the failure after Welcome rendered Retry.
            host.first_run_maintenance().await.unwrap();
            assert!(host.first_run_status().await.unwrap()["maintenance_error"].is_null());
            let revision = host.revision.load(Ordering::SeqCst);
            let activity = host.processes.lock().await.activity_notification();
            let notified = activity.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            assert!(matches!(
                futures_util::poll!(notified.as_mut()),
                std::task::Poll::Pending
            ));
            // A stale action must not require another successful disk write.
            let saved = directory.path().join("host.json");
            let retained = directory.path().join("retained-host.json");
            std::fs::rename(&saved, &retained).unwrap();
            std::fs::create_dir(&saved).unwrap();

            let status = host
                .first_run_action(json!({"action":"resume"}))
                .await
                .unwrap();
            assert_eq!(status["step"], step);
            assert!(status["maintenance_error"].is_null());
            assert_eq!(host.revision.load(Ordering::SeqCst), revision);
            assert!(matches!(
                futures_util::poll!(notified.as_mut()),
                std::task::Poll::Pending
            ));
        }
    }

    #[tokio::test]
    async fn waiting_for_first_run_input_does_not_enter_maintenance() {
        use std::{future::Future, task::Poll};

        let directory = tempfile::tempdir().unwrap();
        let (host, jobs) = installed_host(directory.path(), 1).await;
        let storage = Progress {
            gpu_uuids: vec![gpu().uuid],
            catalog_loaded: true,
            releases: vec![jobs[0].release.clone()],
            ..Default::default()
        };
        let mut models = storage.clone();
        models.storage_accepted = true;
        let mut storage_error = storage.clone();
        storage_error.requested_storage = Some(directory.path().join("rejected-storage"));
        storage_error.storage_error = Some("choose another folder".into());
        let mut download_error = models.clone();
        download_error.selected_release_ids = Some(vec![jobs[0].release.sha256.clone()]);
        download_error.download_error = Some("not enough free space".into());
        let mut catalog_error = models.clone();
        catalog_error.catalog_error = Some("catalog unavailable; refresh to retry".into());

        for (step, progress) in [
            ("storage choice", storage),
            ("model choice", models),
            ("storage correction", storage_error),
            ("download correction", download_error),
            ("catalog retry", catalog_error),
        ] {
            host.store_first_run(progress).await.unwrap();
            assert!(!host.first_run_pending().await, "{step}");
            // Waiting setup must return before entering the expensive profile
            // path, even when another first-run action holds its operation lock.
            let _operation = host.first_run_operation.lock().await;
            let mut maintenance = std::pin::pin!(host.first_run_maintenance());
            std::future::poll_fn(|cx| {
                assert!(
                    matches!(maintenance.as_mut().poll(cx), Poll::Ready(Ok(()))),
                    "maintenance entered while waiting for {step}"
                );
                Poll::Ready(())
            })
            .await;
        }
    }

    #[tokio::test]
    async fn blocked_first_scope_parks_later_unquoted_selections() {
        let directory = tempfile::tempdir().unwrap();
        let (host, jobs) = installed_host(directory.path(), 2).await;
        let inventory = host.inventory.read().await.clone();
        let mut progress = Progress {
            gpu_uuids: vec![gpu().uuid],
            storage_accepted: true,
            catalog_loaded: true,
            releases: jobs.iter().map(|job| job.release.clone()).collect(),
            download_ids: jobs.iter().map(|job| job.id).collect(),
            startup_profiles: jobs
                .iter()
                .map(|job| {
                    let model = inventory
                        .iter()
                        .find(|model| Some(&model.path) == job.path.as_ref())
                        .unwrap();
                    Startup {
                        download_id: job.id,
                        model_id: "fixture".into(),
                        request: LaunchRequest {
                            instance_id: None,
                            qualified_profile_id: None,
                            benchmark_profile: None,
                            model_id: model.id,
                            gpu_uuids: vec![gpu().uuid],
                            max_context: 4096,
                            concurrency: 1,
                            options: Default::default(),
                        },
                        instance_count: 1,
                        instance_ids: vec![],
                        quote: None,
                        error: None,
                        automatic: false,
                    }
                })
                .collect(),
            ..Default::default()
        };
        // A later unquoted draft cannot bypass the first profiling failure.
        progress.startup_profiles[0].error = Some("correct this selection".into());
        host.store_first_run(progress.clone()).await.unwrap();
        assert!(!host.first_run_pending().await);
        {
            let _operation = host.first_run_operation.lock().await;
            // Selected-artifact validation may yield for metadata I/O, but
            // parked maintenance must finish without this operation lock.
            tokio::time::timeout(Duration::from_secs(2), host.first_run_maintenance())
                .await
                .expect("parked maintenance waited for the operation lock")
                .unwrap();
        }
        progress.startup_profiles[0].error = None;
        host.store_first_run(progress).await.unwrap();
        assert!(host.first_run_pending().await);
        assert!(!host.processes.lock().await.has_children());
    }

    #[tokio::test]
    async fn admitted_downloads_keep_monitoring_until_work_settles() {
        let directory = tempfile::tempdir().unwrap();
        let (_, mut jobs) = installed_host(directory.path(), 2).await;
        let mut progress = Progress {
            gpu_uuids: vec![gpu().uuid],
            ..Default::default()
        };
        assert!(needs_maintenance(&progress, &jobs));
        progress.catalog_loaded = true;
        assert!(!needs_maintenance(&progress, &jobs));
        progress.requested_storage = Some(directory.path().join("chosen-storage"));
        assert!(needs_maintenance(&progress, &jobs));
        progress = Progress {
            gpu_uuids: vec![gpu().uuid],
            storage_accepted: true,
            catalog_loaded: true,
            selected_release_ids: Some(vec![jobs[0].release.sha256.clone()]),
            download_ids: vec![jobs[0].id],
            ..Default::default()
        };
        // Another download cannot keep this completed/paused selection ticking.
        jobs[1].status = "downloading".into();
        for status in ["queued", "downloading", "verifying", "pausing"] {
            jobs[0].status = status.into();
            assert!(needs_maintenance(&progress, &jobs), "{status}");
        }
        for status in ["paused", "failed"] {
            jobs[0].status = status.into();
            assert!(!needs_maintenance(&progress, &jobs), "{status}");
        }
        // An installed selection still needs its automatic startup quote.
        jobs[0].status = "installed".into();
        assert!(needs_maintenance(&progress, &jobs));
        progress.complete = true;
        assert!(!needs_maintenance(&progress, &jobs));
    }

    #[tokio::test]
    async fn verified_download_choices_precede_selected_profiling_and_survive_restart() {
        let directory = tempfile::tempdir().unwrap();
        let (host, jobs) = installed_host(directory.path(), 1).await;
        let profile_path =
            crate::hardware_profile::group_profile_path(directory.path(), &[gpu().uuid.clone()]);
        // Download intent does not depend on a prior all-formats profile.
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
        let selected_root = directory.path().join("chosen-before-selected-profiling");
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
        assert_eq!(saved["storage"]["accepted"], true);
        assert_eq!(saved["selected_downloads"][0]["id"], json!(jobs[0].id));
        assert!(!host.first_run_profile_busy().await);
        assert!(host
            .first_run_action(json!({"action":"models","release_ids":[]}))
            .await
            .unwrap_err()
            .contains("before admitting downloads"));
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
        assert!(restored.first_run_pending().await);
        let mut progress = restored.data.lock().await.first_run.clone();
        assert_eq!(progress.gpu_uuids, vec![gpu().uuid]);
        assert_eq!(progress.requested_storage, Some(selected_root.clone()));
        assert_eq!(
            progress.selected_release_ids,
            Some(vec![jobs[0].release.sha256.clone()])
        );
        assert!(progress.storage_accepted);
        assert_eq!(progress.download_ids, vec![jobs[0].id]);
        assert_eq!(
            restored.downloads.root(),
            selected_root.canonicalize().unwrap()
        );
        assert_eq!(
            restored.first_run_status().await.unwrap()["step"],
            "profiling"
        );
        assert!(!restored.first_run_profile_busy().await);
        assert_eq!(restored.downloads.list().await.len(), 1);
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
        assert!(!host.first_run_pending().await);

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
        assert!(!host.first_run_pending().await);
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
        assert!(host.first_run_pending().await);
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
                selected_release_ids: Some(vec![jobs[0].release.sha256.clone()]),
                download_ids: vec![jobs[0].id],
                ..Default::default()
            })
            .await
            .unwrap();
            assert!(!host.first_run_pending().await, "{status}");
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
            assert!(!host.first_run_pending().await, "{status}");
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
        let validation_result = {
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
            validation.await
        };
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
        let mut failed_choice = host.data.lock().await.first_run.clone();
        assert_eq!(
            failed_choice.selected_release_ids,
            Some(vec![jobs[0].release.sha256.clone()])
        );
        failed_choice.download_error = Some("Previous download admission failed".into());
        host.store_first_run(failed_choice).await.unwrap();
        let before_omitted = std::fs::read(directory.path().join("host.json")).unwrap();
        let omitted = host.first_run_action(json!({"action":"models"})).await;
        let after_omitted = std::fs::read(directory.path().join("host.json")).unwrap();
        let cleared = host
            .first_run_action(json!({"action":"models","release_ids":[]}))
            .await;
        job.shutdown().await.unwrap();
        assert!(busy);
        validation_result.unwrap();
        assert_eq!(storage.unwrap()["step"], "storage");
        assert_eq!(choices.unwrap()["step"], "storage");
        assert!(admission
            .unwrap_err()
            .contains("Wait for active hardware profiling"));
        assert!(progress.download_ids.is_empty());
        assert_eq!(final_root, original_root);
        assert!(!pending_root.exists());
        assert_eq!(current_jobs.len(), 1);
        let omitted = omitted.unwrap();
        assert_eq!(omitted["step"], "storage");
        assert_eq!(
            omitted["selected_release_ids"],
            json!([jobs[0].release.sha256])
        );
        assert_eq!(omitted["error"], "Previous download admission failed");
        assert_eq!(before_omitted, after_omitted);
        let cleared = cleared.unwrap();
        assert_eq!(cleared["selected_release_ids"], json!([]));
        assert_eq!(cleared["selected_downloads"], json!([]));
        assert!(host.data.lock().await.first_run.download_error.is_none());

        // When the current calibration ends, the queued folder can be checked
        // without admitting a model the user has removed from their choice.
        host.first_run_maintenance().await.unwrap();
        assert_eq!(host.first_run_status().await.unwrap()["step"], "models");
        assert!(host.data.lock().await.first_run.download_ids.is_empty());
        assert_eq!(host.downloads.list().await.len(), 1);
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
        let saved = restored.data.lock().await.first_run.clone();
        assert_eq!(saved.selected_release_ids, Some(vec![]));
        assert!(saved.download_ids.is_empty());
        assert!(saved.download_error.is_none());
        assert!(saved.storage_accepted);
        assert_eq!(saved.gpu_uuids, vec![gpu().uuid]);
        assert_eq!(
            saved.requested_storage,
            Some(pending_root.canonicalize().unwrap())
        );
        assert_eq!(restored.first_run_status().await.unwrap()["step"], "models");
        assert!(!restored.first_run_pending().await);
        assert_eq!(restored.downloads.list().await.len(), 1);
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
            selected_release_ids: Some(jobs.iter().map(|j| j.release.sha256.clone()).collect()),
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
        assert!(restored.first_run_pending().await);
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
            "profiling"
        );
        assert!(restored.first_run_pending().await);
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
        jobs[0].status = "paused".into();
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
        host.first_run_maintenance().await.unwrap();
        let pending = host.first_run_status().await.unwrap();
        assert_eq!(pending["step"], "downloads");
        assert_eq!(pending["startup_profiles"], json!([]));
        assert_eq!(pending["hardware_profile"]["status"], "idle");
        assert!(!directory.path().join("quote-args").exists());
        assert!(!directory.path().join("profile-args").exists());
        drop(host);
        jobs[0].status = "installed".into();
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
        let path = directory.path().join("ginfer-serve");
        std::fs::write(&path, &script).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
        let model_id = host.inventory.read().await[0].id;
        let mut options = jobs[0].release.launch_profiles[0].options.clone();
        options.kv_arena_bytes = None;
        let mut intent = host
            .selected_profile_intent(&LaunchRequest {
                instance_id: None,
                qualified_profile_id: None,
                benchmark_profile: None,
                model_id,
                gpu_uuids: vec![gpu().uuid],
                max_context: 65536,
                concurrency: 3,
                options,
            })
            .await
            .unwrap();
        assert_eq!(
            intent.package_sha256.as_deref(),
            Some(jobs[0].release.sha256.as_str())
        );
        // This separate profiling fixture accepts only the verified selected
        // artifact; unrelated all-format coverage remains explicitly deferred.
        // Native output resolves the omitted non-speculative draft width to 0.
        assert_eq!(intent.spec, "none");
        assert_eq!(intent.draft_tokens, None);
        let result = json!({"schema_version":2,"mode":"ensure","scope":"artifact",
            "hardware_profile":"__OUTPUT__","state":"loaded","complete":true,
            "base_complete":true,"all_formats_complete":false,"missing_rows":[],
            "artifact":{"path":intent.path,"directory_sha256":intent.directory_sha256,
                "tp":intent.tp,"draft_tp":intent.draft_tp,"spec":intent.spec,
                "draft_tokens":0}});
        let result = serde_json::to_string(&result).unwrap();
        let (prefix, suffix) = result.split_once("__OUTPUT__").unwrap();
        let shell_quote = |value: &str| format!("'{}'", value.replace('\'', "'\\''"));
        let native_profile = json!({"schema_version":2,"ram_bytes":128_u64 << 30,
            "gpus":[{"uuid":gpu().uuid,"vram_bytes":32_u64 << 30}],"disks":[]});
        let path = directory.path().join("ginfer");
        std::fs::write(&path, format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > {}\nprintf '%s' {} > \"$3\"\nprintf '%s%s%s\\n' {} \"$3\" {}\n",
            shell_quote(directory.path().join("profile-args").to_str().unwrap()),
            shell_quote(&native_profile.to_string()), shell_quote(prefix), shell_quote(suffix)
        )).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
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
        assert!(host.first_run_pending().await);
        host.first_run_maintenance().await.unwrap();
        let worker = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while worker.busy() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        assert!(worker.artifact_is_accepted(&[gpu().uuid], &intent));
        assert_eq!(worker.status(None).all_formats_complete, Some(false));
        let profile_args = std::fs::read_to_string(directory.path().join("profile-args")).unwrap();
        let profile_args: Vec<_> = profile_args.lines().collect();
        let tp = intent.tp.to_string();
        assert!(profile_args
            .windows(2)
            .any(|pair| pair == ["--model", intent.path.to_str().unwrap()]));
        assert!(profile_args
            .windows(2)
            .any(|pair| pair == ["--tp", tp.as_str()]));
        assert!(profile_args
            .windows(2)
            .any(|pair| pair == ["--spec", intent.spec.as_str()]));
        assert!(profile_args.contains(&"--json"));
        assert!(!profile_args.contains(&"--complete-remaining-formats"));
        host.first_run_maintenance().await.unwrap();
        let review = host.first_run_status().await.unwrap();
        assert_eq!(review["step"], "storage_review");
        assert_eq!(review["storage"]["required_bytes"], jobs[0].release.bytes);
        assert_eq!(
            review["storage"]["selected_models"][0]["path"],
            json!(intent.path)
        );
        assert!(review["startup_profiles"][0]["quote"].is_null());
        assert!(!directory.path().join("quote-args").exists());
        assert!(!host.first_run_pending().await); // Review waits for a user, not a polling job.
        // A completed selected-artifact Ensure leaves other formats deferred,
        // but waiting for placement review does not authorize idle profiling.
        let selected_job = worker.status(None).job_id;
        let selected_args = std::fs::read(directory.path().join("profile-args")).unwrap();
        assert!(!host.data.lock().await.first_run.complete);
        assert!(!worker.deferred_groups().is_empty());
        for _ in 0..2 {
            host.idle_maintenance().await.unwrap();
            assert!(!worker.busy());
            assert_eq!(worker.status(None).job_id, selected_job);
            assert!(worker.artifact_is_accepted(&[gpu().uuid], &intent));
            assert_eq!(
                std::fs::read(directory.path().join("profile-args")).unwrap(),
                selected_args
            );
            let waiting = host.first_run_status().await.unwrap();
            assert_eq!(waiting["step"], "storage_review");
            assert_eq!(waiting["storage"]["review_key"], review["storage"]["review_key"]);
            assert!(waiting["startup_profiles"][0]["quote"].is_null());
        }
        assert!(host
            .first_run_action(json!({"action":"complete"}))
            .await
            .is_err());
        assert!(host
            .first_run_action(json!({"action":"accept_storage","review_key":"stale"}))
            .await
            .is_err());
        // Choosing a future-download destination leaves the installed file in
        // place and requires an explicit review of the resulting placement.
        let destination = directory.path().join("chosen-models");
        let old_key = review["storage"]["review_key"].clone();
        let chosen = host
            .first_run_action(json!({"action":"storage","path":destination}))
            .await
            .unwrap();
        assert_eq!(chosen["step"], "storage_review");
        assert!(intent.path.is_file());
        assert!(!destination.join(intent.path.file_name().unwrap()).exists());
        assert!(host
            .first_run_action(json!({"action":"accept_storage","review_key":old_key}))
            .await
            .is_err());
        let accepted = host
            .first_run_action(
                json!({"action":"accept_storage","review_key":chosen["storage"]["review_key"]}),
            )
            .await
            .unwrap();
        assert_eq!(accepted["step"], "startup");
        host.first_run_maintenance().await.unwrap();
        let status = host.first_run_status().await.unwrap();
        assert!(status["startup_profiles"][0]["quote"].is_object(), "{}", status["startup_profiles"]);
        assert_eq!(status["startup_profiles"][0]["max_context"], 65536);
        assert_eq!(status["startup_profiles"][0]["concurrency"], 3);
        assert!(status["startup_profiles"][0]["kv_arena_bytes"].is_null());
        assert!(!host.first_run_pending().await);
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
        // Moving is a separate verified operation. It preserves the model
        // UUID but revokes both placement review and the old startup quote.
        let old_path = intent.path.clone();
        let old_key = host
            .data
            .lock()
            .await
            .first_run
            .reviewed_storage
            .clone()
            .unwrap();
        let moved = host
            .first_run_action(json!({"action":"move","download_id":jobs[0].id}))
            .await
            .unwrap();
        assert_eq!(moved["step"], "profiling");
        assert!(moved["startup_profiles"][0]["quote"].is_null());
        assert!(host.data.lock().await.first_run.reviewed_storage.is_none());
        assert!(!old_path.exists());
        let request = host.data.lock().await.first_run.startup_profiles[0]
            .request
            .clone();
        assert_eq!(request.model_id, model_id);
        intent = host.selected_profile_intent(&request).await.unwrap();
        assert!(intent.path.starts_with(&destination));
        assert!(intent.path.is_file());
        assert!(!worker.artifact_is_accepted(&[gpu().uuid], &intent));
        // Retarget this existing synthetic profiler to the moved real fixture;
        // its output must attest the new path before the Host can review it.
        let cli = directory.path().join("ginfer");
        let script = std::fs::read_to_string(&cli).unwrap();
        std::fs::write(
            &cli,
            script.replace(old_path.to_str().unwrap(), intent.path.to_str().unwrap()),
        )
        .unwrap();
        assert!(host.first_run_pending().await);
        host.first_run_maintenance().await.unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while worker.busy() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        assert!(worker.artifact_is_accepted(&[gpu().uuid], &intent));
        let review = host.first_run_status().await.unwrap();
        assert_eq!(review["step"], "storage_review");
        assert!(!host.first_run_pending().await);
        assert!(host
            .first_run_action(json!({"action":"accept_storage","review_key":old_key}))
            .await
            .is_err());
        host.first_run_action(
            json!({"action":"accept_storage","review_key":review["storage"]["review_key"]}),
        )
        .await
        .unwrap();
        host.first_run_maintenance().await.unwrap();
        assert!(host.first_run_status().await.unwrap()["startup_profiles"][0]["quote"].is_object());
        // Retained quotes must wake selected-artifact validation after restart
        // and either runtime reconfiguration path, then park once accepted.
        drop(host);
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
        for runtime in ["reopened", "executable", "runtimes"] {
            {
                let mut processes = host.processes.lock().await;
                match runtime {
                    "executable" => processes
                        .configure_executable(directory.path().join("ginfer-serve"))
                        .unwrap(),
                    "runtimes" => processes
                        .configure_runtimes(
                            std::collections::BTreeMap::from([(
                                "12.0".into(),
                                directory.path().join("ginfer-serve"),
                            )]),
                            std::collections::BTreeMap::from([(gpu().uuid, "12.0".into())]),
                        )
                        .unwrap(),
                    _ => {}
                }
            }
            let saved = host.data.lock().await.first_run.clone();
            assert!(saved.startup_profiles[0].quote.is_some(), "{runtime}");
            assert!(host.first_run_pending().await, "{runtime}");
            host.first_run_maintenance().await.unwrap();
            let worker = host
                .processes
                .lock()
                .await
                .hardware_profile
                .clone()
                .unwrap();
            tokio::time::timeout(Duration::from_secs(2), async {
                while worker.busy() {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .unwrap();
            assert!(
                worker.artifact_is_accepted(&[gpu().uuid], &intent),
                "{runtime}"
            );
            host.first_run_maintenance().await.unwrap();
            assert!(!host.first_run_pending().await, "{runtime}");
        }
        // Recover a real running scoped journal: interruption needs explicit
        // Resume even though its startup draft still has no quote or error.
        let cli = directory.path().join("ginfer");
        let valid_cli = std::fs::read(&cli).unwrap();
        let begun = directory.path().join("interrupted-profile-begun");
        std::fs::write(
            &cli,
            format!(
                "#!/bin/sh\nprintf ready > {}\nexec /bin/sleep 60\n",
                shell_quote(begun.to_str().unwrap())
            ),
        )
        .unwrap();
        let mut progress = host.data.lock().await.first_run.clone();
        progress.startup_profiles[0].quote = None;
        host.store_first_run(progress).await.unwrap();
        let worker = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        worker
            .start_scoped(
                HardwareProfileAction::Ensure,
                Some(cli.clone()),
                vec![gpu().uuid],
                intent.clone(),
            )
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while !begun.exists() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        let journal = directory.path().join("hardware-profile-job.json");
        let interrupted = std::fs::read(&journal).unwrap();
        worker.shutdown().await.unwrap();
        drop(worker);
        drop(host);
        std::fs::write(&journal, interrupted).unwrap();
        std::fs::write(&cli, valid_cli).unwrap();
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
        let worker = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        assert_eq!(worker.status(None).status, "interrupted");
        assert!(!worker.busy());
        {
            let data = host.data.lock().await;
            assert!(data.first_run.startup_profiles[0].quote.is_none());
            assert!(data.first_run.startup_profiles[0].error.is_none());
        }
        assert!(!host.first_run_pending().await);
        {
            let _operation = host.first_run_operation.lock().await;
            // Selected-artifact validation may yield for metadata I/O, but
            // parked maintenance must finish without this operation lock.
            tokio::time::timeout(Duration::from_secs(2), host.first_run_maintenance())
                .await
                .expect("parked maintenance waited for the operation lock")
                .unwrap();
        }
        host.first_run_action(json!({"action":"resume"}))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while worker.busy() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        assert!(worker.artifact_is_accepted(&[gpu().uuid], &intent));
        assert!(host.first_run_pending().await);
        host.first_run_maintenance().await.unwrap();
        assert!(!host.first_run_pending().await);
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
        assert!(host.first_run_pending().await);
        host.first_run_maintenance().await.unwrap();
        let status = host.first_run_status().await.unwrap();
        assert!(status["startup_profiles"][0]["error"]
            .as_str()
            .unwrap()
            .contains("cannot fit 2"));
        assert!(!host.first_run_pending().await);
        assert!(host
            .first_run_action(json!({"action":"complete"}))
            .await
            .is_err());
        host.first_run_action(
            json!({"action":"startup","download_id":jobs[0].id,"kv_arena_bytes":null}),
        )
        .await
        .unwrap();
        assert!(host.first_run_pending().await);
        host.first_run_maintenance().await.unwrap();
        assert!(!host.first_run_pending().await);
        assert_eq!(
            host.first_run_action(json!({"action":"complete"}))
                .await
                .unwrap()["step"],
            "complete"
        );
        assert!(!host.first_run_pending().await);
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
        let releases = [nvfp4, int, smol];
        let blackwell = recommendations(&releases, &[gpu()], &[gpu().uuid], u64::MAX);
        assert_eq!(blackwell.len(), 3);
        assert_eq!(blackwell[0]["release"]["identity"]["weights_id"], "nvfp4");
        let mut ampere = gpu();
        ampere.compute_capability = Some("8.6".into());
        let choices = recommendations(&releases, &[ampere], &[gpu().uuid], u64::MAX);
        assert_eq!(choices.len(), 2);
        assert!(choices
            .iter()
            .all(|r| r["release"]["identity"]["weights_id"] != "nvfp4"));
        assert!(recommendations(&releases, &[gpu()], &[gpu().uuid], 0)
            .iter()
            .all(|r| r["recommended"] == false));
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
        let mut selected_gpu = gpu();
        let choices = recommendations(
            &[mix.clone(), int.clone()],
            &[selected_gpu.clone()],
            &[gpu().uuid],
            u64::MAX,
        );
        assert_eq!(choices.len(), 2);
        assert_eq!(choices[0]["release_id"], int.sha256);
        assert_eq!(choices[0]["recommended"], true);
        assert_eq!(choices[1]["release_id"], mix.sha256);
        assert_eq!(choices[1]["recommended"], false);

        selected_gpu.memory_mib = 16 * 1024;
        let choices = recommendations(
            &[mix.clone(), int.clone(), qwen.clone()],
            &[selected_gpu],
            &[gpu().uuid],
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
            .contains("Needs more graphics memory than the selected card has."));
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
    fn deleted_selected_download_returns_to_model_choice() {
        let p0 = Progress {
            gpu_uuids: vec!["a".into()],
            storage_accepted: true,
            selected_release_ids: Some(vec!["sha".into()]),
            download_ids: vec![Uuid::new_v4()],
            download_error: Some("Not found".into()),
            ..Default::default()
        };
        assert_eq!(stage(&p0, true, false, &[]), "downloads");
        let mut p = p0.clone();
        assert!(reconcile(&mut p, &[]));
        assert_eq!(stage(&p, true, false, &[]), "models");
        assert_eq!(p.selected_release_ids, Some(vec![]));
        assert!(p.download_error.is_none());
        assert!(!reconcile(&mut p, &[]));
    }
    #[test]
    fn reviewed_storage_is_bound_to_profile_selection_paths_and_root() {
        let (release, _) = package(0);
        let id = Uuid::new_v4();
        let jobs = vec![Download {
            id,
            release,
            status: "installed".into(),
            received: 4096,
            bytes_per_second: 0,
            error: None,
            path: Some(PathBuf::from("/current/model.ginfer")),
            storage_root: PathBuf::from("/current"),
            verification: None,
        }];
        let mut progress = Progress {
            gpu_uuids: vec![gpu().uuid],
            storage_accepted: true,
            download_ids: vec![id],
            ..Default::default()
        };
        let profile = json!({"schema_version":2,"disks":[{"sequential_read":{"value":100}}]});
        let root = std::path::Path::new("/current");
        let key = storage_review_key(&progress, &jobs, &profile, root).unwrap();
        progress.reviewed_storage = Some(key.clone());
        let restored: Progress =
            serde_json::from_slice(&serde_json::to_vec(&progress).unwrap()).unwrap();
        assert_eq!(
            storage_review_key(&restored, &jobs, &profile, root),
            restored.reviewed_storage
        );
        assert_eq!(stage(&restored, true, false, &jobs), "storage_review");
        assert_eq!(stage(&restored, true, true, &jobs), "startup");
        let mut refreshed = profile.clone();
        for field in [
            "warnings",
            "gpus",
            "sources",
            "duplex_transfers",
            "gpu_expert_rates",
            "mapped_host_scatter_reads",
        ] {
            refreshed[field] = json!({"refreshed":true});
        }
        assert_eq!(
            storage_review_key(&restored, &jobs, &refreshed, root),
            restored.reviewed_storage
        );
        refreshed["disks"][0]["sequential_read"]["value"] = json!(200);
        assert_ne!(
            storage_review_key(&restored, &jobs, &refreshed, root),
            restored.reviewed_storage
        );
        assert_ne!(
            storage_review_key(
                &progress,
                &jobs,
                &json!({"schema_version":2,"disks":[]}),
                root
            ),
            Some(key.clone())
        );
        assert_ne!(
            storage_review_key(&progress, &jobs, &profile, std::path::Path::new("/chosen")),
            Some(key.clone())
        );
        let mut moved = jobs.clone();
        moved[0].path = Some(PathBuf::from("/chosen/model.ginfer"));
        assert_ne!(
            storage_review_key(&progress, &moved, &profile, root),
            Some(key)
        );
        progress.download_ids.push(Uuid::new_v4());
        assert!(storage_review_key(&progress, &jobs, &profile, root).is_none());
        release_selection(&mut progress);
        assert!(progress.reviewed_storage.is_none());
    }

    #[test]
    fn shared_progress_resumes_in_order() {
        let mut p = Progress::default();
        assert_eq!(stage(&p, false, false, &[]), "gpu");
        p.gpu_uuids = vec!["a".into()];
        assert_eq!(stage(&p, false, false, &[]), "storage");
        assert_eq!(stage(&p, true, false, &[]), "storage");
        p.storage_accepted = true;
        assert_eq!(stage(&p, true, false, &[]), "models");
        p.download_ids.push(Uuid::new_v4());
        assert_eq!(stage(&p, true, false, &[]), "downloads");
        let restored: Progress = serde_json::from_value(serde_json::to_value(&p).unwrap()).unwrap();
        assert_eq!(stage(&restored, true, false, &[]), "downloads");
    }
}
