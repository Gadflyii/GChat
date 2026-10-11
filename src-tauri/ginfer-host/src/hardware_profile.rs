//! One shared Host owner for native, interruption-safe hardware installation.
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    sync::{watch, Notify},
};
use uuid::Uuid;

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HardwareProfileAction {
    Ensure,
    Refresh,
    Resume,
    Cancel,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HardwareProfileRequest {
    pub action: HardwareProfileAction,
    #[serde(default)]
    pub gpu_uuids: Option<Vec<String>>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HardwareProfileStatus {
    pub status: String,
    pub job_id: Option<Uuid>,
    pub pid: Option<u32>,
    pub reprofile: bool,
    pub started_unix_ms: Option<u64>,
    pub finished_unix_ms: Option<u64>,
    pub profile_path: PathBuf,
    pub checkpoint_available: bool,
    pub diagnostic_tail: String,
    pub error: Option<String>,
    pub available: bool,
    pub gpu_uuids: Vec<String>,
    pub engine_path: Option<PathBuf>,
    pub pending_gpu_groups: Vec<Vec<String>>,
    pub stale_groups: Vec<HardwareProfileStaleGroup>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HardwareProfileStaleGroup {
    pub gpu_uuids: Vec<String>,
    pub profile_path: PathBuf,
    pub expected_duration_ms: Option<u64>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Configuration {
    pub gpu_uuids: Vec<String>,
    pub engine: PathBuf,
    pub profile_path: PathBuf,
}
#[derive(Clone, Serialize, Deserialize)]
struct Record {
    view: HardwareProfileStatus,
    configuration: Option<Configuration>,
    output_path: Option<PathBuf>,
    pending: Vec<Configuration>,
    accepted_durations: std::collections::BTreeMap<String, u64>,
    native_completed: bool,
    measured_fresh: bool,
}
struct State {
    record: Record,
    cancel: Option<watch::Sender<bool>>,
    reap_error: Option<String>,
}
pub struct HardwareProfiles {
    directory: PathBuf,
    state: Mutex<State>,
    idle: Notify,
    revision: Arc<AtomicU64>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn checkpoint(path: &Path) -> PathBuf {
    let mut path = path.as_os_str().to_owned();
    path.push(".install-state.json");
    path.into()
}
fn completed_output(output: &Path) -> Result<Vec<u8>, String> {
    let bytes = std::fs::read(output)
        .map_err(|error| format!("Native profiling output is unavailable: {error}"))?;
    let profile: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Native profiling output is not JSON: {error}"))?;
    if profile
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        != Some(2)
    {
        return Err("Native profiling output requires schema_version 2".into());
    }
    Ok(bytes)
}
impl Configuration {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.gpu_uuids.len(), 1 | 2 | 4)
            || self
                .gpu_uuids
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != self.gpu_uuids.len()
        {
            return Err("Profiling requires an explicit TP1/2/4 GPU grant".into());
        }
        if !self.engine.is_absolute() || !self.engine.is_file() || !self.profile_path.is_absolute()
        {
            return Err(
                "hardware profiling requires an existing absolute CLI and absolute profile path"
                    .into(),
            );
        }
        Ok(())
    }
    pub fn store(&self, directory: &Path) -> Result<(), String> {
        self.validate()?;
        let path = directory
            .join("hardware-profile-config")
            .join(format!("{}.json", group_key(&self.gpu_uuids)));
        crate::service::write_private(&path, &serde_json::to_vec(self).map_err(|e| e.to_string())?)
    }
}
pub fn validate_gpu_group(
    gpus: &[String],
    architectures: &std::collections::BTreeMap<String, String>,
) -> Result<(), String> {
    if !matches!(gpus.len(), 1 | 2 | 4)
        || gpus.iter().collect::<std::collections::BTreeSet<_>>().len() != gpus.len()
    {
        return Err("Choose an explicit group of one, two, or four unique GPUs".into());
    }
    let architecture = architectures
        .get(&gpus[0])
        .ok_or("Selected GPU has no known compute architecture")?;
    for gpu in gpus {
        let selected = architectures
            .get(gpu)
            .ok_or("Selected GPU has no known compute architecture")?;
        if selected != architecture {
            return Err("A profiling GPU group must use one compute architecture".into());
        }
    }
    Ok(())
}
pub fn group_key(gpus: &[String]) -> String {
    use sha2::{Digest, Sha256};
    let mut membership = gpus.to_vec();
    membership.sort();
    hex::encode(Sha256::digest(
        serde_json::to_vec(&membership).expect("GPU UUID strings serialize"),
    ))
}
pub fn group_profile_path(directory: &Path, gpus: &[String]) -> PathBuf {
    directory
        .join("hardware-profiles")
        .join(format!("{}.json", group_key(gpus)))
}
impl HardwareProfiles {
    pub fn open(directory: PathBuf, revision: Arc<AtomicU64>) -> Result<Arc<Self>, String> {
        let mut record = match std::fs::read(directory.join("hardware-profile-job.json")) {
            Ok(bytes) => serde_json::from_slice::<Record>(&bytes)
                .map_err(|e| format!("invalid hardware profiling job: {e}"))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Record {
                configuration: None,
                output_path: None,
                pending: vec![],
                accepted_durations: Default::default(),
                native_completed: false,
                measured_fresh: false,
                view: HardwareProfileStatus {
                    status: "idle".into(),
                    job_id: None,
                    pid: None,
                    reprofile: false,
                    started_unix_ms: None,
                    finished_unix_ms: None,
                    profile_path: directory.join("hardware-profiles"),
                    checkpoint_available: false,
                    diagnostic_tail: String::new(),
                    error: None,
                    available: false,
                    gpu_uuids: vec![],
                    engine_path: None,
                    pending_gpu_groups: vec![],
                    stale_groups: vec![],
                },
            },
            Err(e) => return Err(e.to_string()),
        };
        if matches!(record.view.status.as_str(), "running" | "cancelling") {
            record.view.status = "interrupted".into();
            if !record.native_completed {
                record.view.finished_unix_ms = Some(now());
            }
            record.view.error = Some("Host stopped before profiling completed; resume retains native checkpoint validation".into());
            crate::service::write_private(
                &directory.join("hardware-profile-job.json"),
                &serde_json::to_vec(&record).map_err(|e| e.to_string())?,
            )?;
        }
        Ok(Arc::new(Self {
            directory,
            state: Mutex::new(State {
                record,
                cancel: None,
                reap_error: None,
            }),
            idle: Notify::new(),
            revision,
        }))
    }
    fn save(&self, record: &Record) -> Result<(), String> {
        crate::service::write_private(
            &self.directory.join("hardware-profile-job.json"),
            &serde_json::to_vec(record).map_err(|e| e.to_string())?,
        )
    }
    pub fn configuration(
        &self,
        fallback: Option<PathBuf>,
        gpus: &[String],
    ) -> Result<Configuration, String> {
        let expected_engine =
            fallback.ok_or("No native profiling CLI configured for this GPU group")?;
        let path = self
            .directory
            .join("hardware-profile-config")
            .join(format!("{}.json", group_key(gpus)));
        let mut configuration: Configuration = match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| format!("invalid hardware profiling configuration: {e}"))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Configuration {
                gpu_uuids: gpus.to_vec(),
                engine: expected_engine.clone(),
                profile_path: group_profile_path(&self.directory, gpus),
            },
            Err(error) => return Err(error.to_string()),
        };
        if expected_engine != configuration.engine {
            return Err("Profiling CLI does not match the selected Engine runtime".into());
        }
        if group_key(&configuration.gpu_uuids) != group_key(gpus) {
            return Err(
                "Hardware profiling configuration does not match the GPU membership".into(),
            );
        }
        configuration.gpu_uuids = gpus.to_vec();
        configuration.validate()?;
        Ok(configuration)
    }
    pub fn configured_groups(&self) -> Result<Vec<Vec<String>>, String> {
        let directory = self.directory.join("hardware-profile-config");
        let entries = match std::fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(error) => return Err(error.to_string()),
        };
        let mut groups = std::collections::BTreeMap::new();
        for entry in entries {
            let path = entry.map_err(|e| e.to_string())?.path();
            let config: Configuration =
                serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            config.validate()?;
            groups.insert(group_key(&config.gpu_uuids), config.gpu_uuids);
        }
        Ok(groups.into_values().collect())
    }
    pub(crate) fn mark_stale(&self, gpus: &[String], profile: &Path, diagnostic: &str) {
        let prefix = format!(
            "hardware profile does not match selected startup hardware: {}",
            profile.display()
        );
        if !diagnostic.lines().any(|line| {
            line.find(&prefix).is_some_and(|offset| {
                let suffix = &line[offset + prefix.len()..];
                suffix.is_empty() || suffix.starts_with("; ")
            })
        }) {
            return;
        }
        let mut state = self.state.lock().unwrap();
        let key = group_key(gpus);
        if state
            .record
            .view
            .stale_groups
            .iter()
            .any(|group| group_key(&group.gpu_uuids) == key)
        {
            return;
        }
        let expected_duration_ms = state.record.accepted_durations.get(&key).copied();
        state
            .record
            .view
            .stale_groups
            .push(HardwareProfileStaleGroup {
                gpu_uuids: gpus.to_vec(),
                profile_path: profile.to_path_buf(),
                expected_duration_ms,
            });
        let _ = self.save(&state.record);
        self.revision.fetch_add(1, Ordering::SeqCst);
    }
    fn publish_completed(
        &self,
        state: &mut State,
        configuration: &Configuration,
        output: &Path,
    ) -> Result<(), String> {
        let bytes = completed_output(output)?;
        // Native completion survives a publication failure; Resume only retries this write.
        state.record.native_completed = true;
        self.save(&state.record)?;
        crate::service::write_private(&configuration.profile_path, &bytes)?;
        let key = group_key(&configuration.gpu_uuids);
        let elapsed = state
            .record
            .view
            .finished_unix_ms
            .unwrap_or_else(now)
            .saturating_sub(state.record.view.started_unix_ms.unwrap_or_else(now));
        if state.record.measured_fresh {
            let accepted = state
                .record
                .accepted_durations
                .entry(key.clone())
                .or_default();
            *accepted = (*accepted).max(elapsed);
        }
        state
            .record
            .view
            .stale_groups
            .retain(|group| group_key(&group.gpu_uuids) != key);
        Ok(())
    }
    /// Every entry is a saved deployment, resolved against this Host's current runtime.
    pub(crate) fn ensure_groups(
        self: &Arc<Self>,
        configurations: Vec<Configuration>,
    ) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        if state.cancel.is_some()
            || matches!(
                state.record.view.status.as_str(),
                "interrupted" | "cancelled" | "failed"
            )
        {
            return Ok(());
        }
        let mut unique = std::collections::BTreeSet::new();
        let configurations: Vec<_> = configurations
            .into_iter()
            .filter(|config| unique.insert(group_key(&config.gpu_uuids)))
            .collect();
        let Some((first, pending)) = configurations.split_first() else {
            return Ok(());
        };
        state.record.pending = pending.to_vec();
        state.record.view.pending_gpu_groups = pending
            .iter()
            .map(|config| config.gpu_uuids.clone())
            .collect();
        self.launch_locked(&mut state, first.clone(), false, None)
    }
    pub(crate) fn is_stale(&self, gpus: &[String]) -> bool {
        let key = group_key(gpus);
        self.state
            .lock()
            .unwrap()
            .record
            .view
            .stale_groups
            .iter()
            .any(|group| group_key(&group.gpu_uuids) == key)
    }
    pub(crate) fn directory(&self) -> &Path {
        &self.directory
    }
    pub fn group(&self) -> Vec<String> {
        self.state.lock().unwrap().record.view.gpu_uuids.clone()
    }
    pub fn busy(&self) -> bool {
        self.state.lock().unwrap().cancel.is_some()
    }
    pub fn status(&self, fallback: Option<PathBuf>) -> HardwareProfileStatus {
        self.observation(fallback).0
    }
    pub(crate) fn observation(&self, fallback: Option<PathBuf>) -> (HardwareProfileStatus, u64) {
        let mut state = self.state.lock().unwrap();
        let configuration = if state.record.view.job_id.is_some() {
            state.record.configuration.clone()
        } else {
            self.configuration(fallback, &state.record.view.gpu_uuids)
                .ok()
        };
        let available = configuration.as_ref().is_some_and(|c| c.engine.is_file());
        let checkpoint_available = state
            .record
            .output_path
            .as_ref()
            .is_some_and(|path| checkpoint(path).is_file());
        if state.record.view.available != available
            || state.record.view.checkpoint_available != checkpoint_available
        {
            state.record.view.available = available;
            state.record.view.checkpoint_available = checkpoint_available;
            self.revision.fetch_add(1, Ordering::SeqCst);
        }
        (
            state.record.view.clone(),
            self.revision.load(Ordering::SeqCst),
        )
    }
    /// Called with HostProcesses locked, after excluding its live model children.
    pub fn start(
        self: &Arc<Self>,
        action: HardwareProfileAction,
        fallback: Option<PathBuf>,
        gpus: Vec<String>,
    ) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        if state.cancel.is_some() && group_key(&state.record.view.gpu_uuids) != group_key(&gpus) {
            return Err("The active profiler owns a different GPU group".into());
        }
        if matches!(
            action,
            HardwareProfileAction::Resume | HardwareProfileAction::Cancel
        ) && state.record.view.job_id.is_some()
            && group_key(&state.record.view.gpu_uuids) != group_key(&gpus)
        {
            return Err("Resume and cancel retain the original GPU group".into());
        }
        if let Some(cancel) = &state.cancel {
            if action == HardwareProfileAction::Refresh {
                return Err("Hardware profiling is already running".into());
            }
            if action == HardwareProfileAction::Cancel {
                cancel.send_replace(true);
                state.record.view.status = "cancelling".into();
                self.revision.fetch_add(1, Ordering::SeqCst);
                self.save(&state.record)?;
            }
            return Ok(());
        }
        if action == HardwareProfileAction::Cancel {
            return Ok(());
        }
        if action == HardwareProfileAction::Ensure
            && (matches!(
                state.record.view.status.as_str(),
                "interrupted" | "cancelled"
            ) || (state.record.view.status == "failed" && state.record.view.reprofile))
        {
            // Inventory refresh never silently supersedes an interrupted forced recipe.
            return Ok(());
        }
        if action == HardwareProfileAction::Resume
            && !matches!(
                state.record.view.status.as_str(),
                "interrupted" | "cancelled" | "failed"
            )
        {
            return Err("No interrupted hardware profiling job to resume".into());
        }
        let (configuration, reprofile) = if action == HardwareProfileAction::Resume {
            (
                state
                    .record
                    .configuration
                    .clone()
                    .ok_or("No interrupted hardware profiling job to resume")?,
                state.record.view.reprofile,
            )
        } else {
            (
                self.configuration(fallback.clone(), &gpus)?,
                action == HardwareProfileAction::Refresh,
            )
        };
        configuration.validate()?;
        if fallback.as_ref() != Some(&configuration.engine) {
            return Err("Profiling CLI does not match the selected Engine runtime".into());
        }
        configuration.store(&self.directory)?;
        if action == HardwareProfileAction::Resume && state.record.native_completed {
            let output = state
                .record
                .output_path
                .clone()
                .ok_or("Completed native job has no workspace")?;
            let publication = self.publish_completed(&mut state, &configuration, &output);
            state.record.view.status = if publication.is_ok() {
                "completed"
            } else {
                "failed"
            }
            .into();
            state.record.view.error = publication.as_ref().err().cloned();
            let advance = publication.is_ok() && !state.record.pending.is_empty();
            if advance {
                state.record.view.status = "running".into();
            }
            self.revision.fetch_add(1, Ordering::SeqCst);
            self.save(&state.record)?;
            publication?;
            if advance {
                let next = state.record.pending.remove(0);
                if let Err(error) = self.launch_locked(&mut state, next.clone(), false, None) {
                    if state.cancel.is_none() {
                        if state.record.configuration.as_ref() != Some(&next) {
                            state.record.pending.insert(0, next);
                        }
                        state.record.view.status = "failed".into();
                        state.record.view.error = Some(error.clone());
                        state.record.view.pending_gpu_groups = state
                            .record
                            .pending
                            .iter()
                            .map(|config| config.gpu_uuids.clone())
                            .collect();
                        self.save(&state.record)?;
                        self.revision.fetch_add(1, Ordering::SeqCst);
                    }
                    return Err(error);
                }
            }
            return Ok(());
        }
        let reused = if action == HardwareProfileAction::Resume {
            Some(
                state
                    .record
                    .output_path
                    .clone()
                    .ok_or("Interrupted job has no native workspace")?,
            )
        } else {
            None
        };
        if action != HardwareProfileAction::Resume {
            state.record.pending.clear();
        }
        self.launch_locked(&mut state, configuration, reprofile, reused)
    }
    fn launch_locked(
        self: &Arc<Self>,
        state: &mut State,
        configuration: Configuration,
        reprofile: bool,
        reused: Option<PathBuf>,
    ) -> Result<(), String> {
        let measured_fresh = reprofile && reused.is_none();
        let output_path = if let Some(output) = reused {
            output
        } else {
            let mut name = configuration
                .profile_path
                .file_name()
                .ok_or("profile path has no filename")?
                .to_owned();
            name.push(format!(".install-{}.json", Uuid::new_v4()));
            let output = configuration.profile_path.with_file_name(name);
            match std::fs::read(&configuration.profile_path) {
                Ok(bytes) => crate::service::write_private(&output, &bytes)?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
            output
        };
        let previous = state.record.clone();
        state.record = Record {
            pending: previous.pending.clone(),
            accepted_durations: previous.accepted_durations.clone(),
            native_completed: false,
            measured_fresh,
            configuration: Some(configuration.clone()),
            output_path: Some(output_path.clone()),
            view: HardwareProfileStatus {
                status: "running".into(),
                job_id: Some(Uuid::new_v4()),
                pid: None,
                reprofile,
                started_unix_ms: Some(now()),
                finished_unix_ms: None,
                profile_path: configuration.profile_path.clone(),
                checkpoint_available: checkpoint(&output_path).is_file(),
                diagnostic_tail: String::new(),
                error: None,
                available: true,
                gpu_uuids: configuration.gpu_uuids.clone(),
                engine_path: Some(configuration.engine.clone()),
                pending_gpu_groups: previous
                    .pending
                    .iter()
                    .map(|config| config.gpu_uuids.clone())
                    .collect(),
                stale_groups: previous.view.stale_groups.clone(),
            },
        };
        if let Err(error) = self.save(&state.record) {
            state.record = previous;
            return Err(error);
        }
        self.revision.fetch_add(1, Ordering::SeqCst);
        let mut command = Command::new(&configuration.engine);
        command.env("CUDA_VISIBLE_DEVICES", configuration.gpu_uuids.join(","));
        command
            .arg("profile-hardware")
            .arg("--hardware-profile")
            .arg(&output_path);
        if reprofile {
            command.arg("--reprofile");
        }
        if let Some(directory) = configuration.engine.parent() {
            let variable = if cfg!(windows) {
                "PATH"
            } else {
                "LD_LIBRARY_PATH"
            };
            let mut paths = vec![directory.to_path_buf()];
            #[cfg(not(windows))]
            paths.push(directory.join("../lib"));
            if let Some(existing) = std::env::var_os(variable) {
                paths.extend(std::env::split_paths(&existing));
            }
            let joined = match std::env::join_paths(paths) {
                Ok(joined) => joined,
                Err(error) => {
                    state.record.view.status = "failed".into();
                    state.record.view.error = Some(error.to_string());
                    state.record.view.finished_unix_ms = Some(now());
                    self.revision.fetch_add(1, Ordering::SeqCst);
                    self.save(&state.record)?;
                    return Err(error.to_string());
                }
            };
            command.env(variable, joined);
        }
        command
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        #[cfg(target_os = "linux")]
        bind_parent_death(&mut command);
        #[cfg(not(windows))]
        let spawned = command.spawn();
        #[cfg(windows)]
        let spawned =
            crate::hardware_profile_windows::spawn(command.as_std()).map_err(std::io::Error::other);
        let mut child = match spawned {
            Ok(child) => child,
            Err(error) => {
                state.record.view.status = "failed".into();
                state.record.view.error = Some(error.to_string());
                state.record.view.finished_unix_ms = Some(now());
                self.revision.fetch_add(1, Ordering::SeqCst);
                self.save(&state.record)?;
                return Err(error.to_string());
            }
        };
        state.record.view.pid = child.id();
        self.revision.fetch_add(1, Ordering::SeqCst);
        let (cancel, mut cancellation) = watch::channel(false);
        state.cancel = Some(cancel);
        state.reap_error = None;
        let preparation_error = self.save(&state.record).err();
        #[cfg(windows)]
        let preparation_error = preparation_error.or_else(|| child.resume().err());
        if preparation_error.is_some() {
            state.record.view.status = "cancelling".into();
            state.record.view.error = preparation_error.clone();
            state.cancel.as_ref().unwrap().send_replace(true);
            self.revision.fetch_add(1, Ordering::SeqCst);
        }
        let owner = self.clone();
        #[cfg(not(windows))]
        let stdout = child.stdout.take().expect("piped stdout");
        #[cfg(not(windows))]
        let stderr = child.stderr.take().expect("piped stderr");
        #[cfg(windows)]
        let stdout = child.take_stdout().expect("piped stdout");
        #[cfg(windows)]
        let stderr = child.take_stderr().expect("piped stderr");
        let readers = Readers(vec![
            read_tail(stdout, owner.clone()),
            read_tail(stderr, owner.clone()),
        ]);
        let request_error = preparation_error.clone();
        tokio::spawn(async move {
            let (result, cancelled) = loop {
                let observed = tokio::select! {
                result = child.wait() => (result, false),
                _ = cancellation.changed() => {
                    let _ = child.start_kill();
                    (child.wait().await, true)
                }
                };
                if observed.0.is_ok() {
                    let cancelled = observed.1 || *cancellation.borrow();
                    break (observed.0, cancelled);
                }
                // A failed wait is not proof of exit. Keep the owned child and reservation.
                {
                    let mut state = owner.state.lock().unwrap();
                    state.record.view.status = "cancelling".into();
                    state.record.view.error = Some(format!(
                        "Cannot reap native profiler: {}",
                        observed.0.as_ref().unwrap_err()
                    ));
                    state.reap_error = state.record.view.error.clone();
                    let _ = owner.save(&state.record);
                    owner.revision.fetch_add(1, Ordering::SeqCst);
                }
                owner.idle.notify_waiters();
                if cancellation.changed().await.is_err() {
                    return;
                }
                let _ = child.start_kill();
            };
            // Keep the reservation through reap and bounded output drain.
            readers.finish().await;
            let mut state = owner.state.lock().unwrap();
            state.record.view.finished_unix_ms = Some(now());
            state.reap_error = None;
            let cancelled =
                cancelled || state.cancel.as_ref().is_some_and(|cancel| *cancel.borrow());
            match result {
                Ok(exit) if cancelled => {
                    state.record.view.status = "cancelled".into();
                    state.record.view.error = None;
                    if exit.success() && completed_output(&output_path).is_ok() {
                        state.record.native_completed = true;
                    }
                }
                Ok(exit) if exit.success() => {
                    let publication =
                        owner.publish_completed(&mut state, &configuration, &output_path);
                    match publication {
                        Ok(()) => {
                            state.record.view.status = "completed".into();
                            state.record.view.error = None;
                        }
                        Err(error) => {
                            state.record.view.status = "failed".into();
                            state.record.view.error = Some(error);
                        }
                    }
                }
                Ok(exit) => {
                    state.record.view.status = "failed".into();
                    state.record.view.error =
                        Some(format!("Native hardware profiling exited {exit}"));
                }
                Err(error) => {
                    state.record.view.status = "failed".into();
                    state.record.view.error = Some(error.to_string());
                }
            }
            if let Some(error) = preparation_error {
                state.record.view.status = "failed".into();
                state.record.view.error = Some(error);
            }
            let advance =
                state.record.view.status == "completed" && !state.record.pending.is_empty();
            if advance {
                state.record.view.status = "running".into();
            }
            if let Err(error) = owner.save(&state.record) {
                state.record.view.error =
                    Some(format!("Could not persist profiling result: {error}"));
                state.record.view.status = "failed".into();
            }
            owner.revision.fetch_add(1, Ordering::SeqCst);
            if advance && state.record.view.status == "running" {
                let next = state.record.pending.remove(0);
                // The lock prevents model admission while replacing the reaped child's reservation.
                state.cancel = None;
                if let Err(error) = owner.launch_locked(&mut state, next.clone(), false, None) {
                    // A post-spawn error already has an owning kill/reap task and reservation.
                    if state.cancel.is_none() {
                        if state.record.configuration.as_ref() != Some(&next) {
                            state.record.pending.insert(0, next);
                        }
                        state.record.view.status = "failed".into();
                        state.record.view.error = Some(error);
                        state.record.view.pending_gpu_groups = state
                            .record
                            .pending
                            .iter()
                            .map(|config| config.gpu_uuids.clone())
                            .collect();
                        let _ = owner.save(&state.record);
                        owner.revision.fetch_add(1, Ordering::SeqCst);
                    }
                } else {
                    return;
                }
            } else {
                state.cancel = None;
            }
            drop(state);
            owner.idle.notify_waiters();
        });
        request_error.map_or(Ok(()), Err)
    }
    pub async fn shutdown(&self) -> Result<(), String> {
        loop {
            let idle = self.idle.notified();
            tokio::pin!(idle);
            idle.as_mut().enable();
            {
                let state = self.state.lock().unwrap();
                if let Some(cancel) = &state.cancel {
                    cancel.send_replace(true);
                } else {
                    return Ok(());
                }
                if let Some(error) = &state.reap_error {
                    return Err(error.clone());
                }
            }
            idle.await;
        }
    }
}
struct Readers(Vec<tokio::task::JoinHandle<()>>);
impl Readers {
    async fn finish(mut self) {
        for reader in &mut self.0 {
            if tokio::time::timeout(std::time::Duration::from_secs(1), &mut *reader)
                .await
                .is_err()
            {
                reader.abort();
                let _ = reader.await;
            }
        }
        self.0.clear();
    }
}
impl Drop for Readers {
    fn drop(&mut self) {
        for reader in &self.0 {
            reader.abort();
        }
    }
}
fn read_tail(
    reader: impl AsyncRead + Unpin + Send + 'static,
    owner: Arc<HardwareProfiles>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut reader = reader;
        let mut bytes = [0u8; 4096];
        while let Ok(count) = reader.read(&mut bytes).await {
            if count == 0 {
                break;
            }
            let mut state = owner.state.lock().unwrap();
            let tail = &mut state.record.view.diagnostic_tail;
            tail.push_str(&String::from_utf8_lossy(&bytes[..count]));
            if tail.len() > 16_384 {
                let mut cut = tail.len() - 16_384;
                while !tail.is_char_boundary(cut) {
                    cut += 1;
                }
                tail.drain(..cut);
            }
            owner.revision.fetch_add(1, Ordering::SeqCst);
        }
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::{
        engine_host::{EngineLaunch, LaunchOptions},
        service::{Gpu, Host},
    };
    use hyper::{Body, Request};
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    async fn fixture() -> (tempfile::TempDir, Arc<Host>, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let cli = directory.path().join("ginfer");
        let arguments = directory.path().join("arguments");
        std::fs::write(&cli, format!("#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\nprintf retained > \"$3.install-state.json\"\necho native-install-begun\nexec /bin/sleep 600\n", arguments.display())).unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o700)).unwrap();
        let serve = directory.path().join("ginfer-serve");
        std::fs::write(&serve, "").unwrap();
        let state = directory.path().join("host");
        let host = Host::open(
            state.clone(),
            "Profiling fixture".into(),
            serve,
            vec![],
            vec![],
            vec![
                Gpu {
                    uuid: "GPU-fixture".into(),
                    name: "Fixture".into(),
                    display_name: None,
                    memory_mib: 24_000,
                    compute_capability: Some("12.0".into()),
                },
                Gpu {
                    uuid: "GPU-second".into(),
                    name: "Fixture".into(),
                    display_name: None,
                    memory_mib: 24_000,
                    compute_capability: Some("12.0".into()),
                },
            ],
        )
        .await
        .unwrap();
        Configuration {
            gpu_uuids: vec!["GPU-fixture".into()],
            engine: cli,
            profile_path: directory.path().join("hardware.json"),
        }
        .store(&state)
        .unwrap();
        (directory, host, arguments)
    }
    async fn request(
        host: &Arc<Host>,
        action: HardwareProfileAction,
    ) -> Result<serde_json::Value, String> {
        let token = host.data.lock().await.pairing_admin_token.clone();
        let request = Request::builder()
            .method("POST")
            .uri("/host/v1/hardware-profile")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(
                serde_json::to_vec(&HardwareProfileRequest {
                    action,
                    gpu_uuids: Some(vec!["GPU-fixture".into()]),
                })
                .unwrap(),
            ))
            .unwrap();
        let response = host.clone().route(request).await.unwrap();
        let status = response.status();
        let value: serde_json::Value = serde_json::from_slice(
            &hyper::body::to_bytes(response.into_body())
                .await
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if status.is_success() {
            Ok(value)
        } else {
            Err(format!(
                "Host returned {status}: {}",
                value["error"].as_str().unwrap_or("missing error message")
            ))
        }
    }
    async fn begun(arguments: &Path) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while !arguments.is_file() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
    }
    #[tokio::test]
    async fn hardware_profile_owned_job_cancel_resume_preserves_forced_recipe_and_exclusion() {
        let (directory, host, arguments) = fixture().await;
        std::fs::write(
            directory.path().join("hardware.json"),
            b"previous accepted profile",
        )
        .unwrap();
        let first = request(&host, HardwareProfileAction::Refresh)
            .await
            .unwrap();
        begun(&arguments).await;
        let repeated = request(&host, HardwareProfileAction::Ensure).await.unwrap();
        let launch = EngineLaunch {
            benchmark_profile: None,
            instance_id: Uuid::new_v4(),
            artifact: arguments.clone(),
            artifact_dependencies: vec![],
            artifact_set: false,
            model_id: "fixture".into(),
            gpu_uuids: vec!["GPU-fixture".into()],
            tp: 1,
            port: 32123,
            max_context: 32,
            concurrency: 1,
            options: LaunchOptions::default(),
        };
        let blocked = host
            .processes
            .lock()
            .await
            .validate_launch(&launch, false)
            .unwrap_err();
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        request(&host, HardwareProfileAction::Cancel).await.unwrap();
        job.shutdown().await.unwrap();
        let cancelled = host.snapshot().await;
        let bytes = std::fs::read(&arguments).unwrap();
        let record: Record = serde_json::from_slice(
            &std::fs::read(directory.path().join("host/hardware-profile-job.json")).unwrap(),
        )
        .unwrap();
        let retained = std::fs::read(checkpoint(record.output_path.as_ref().unwrap())).unwrap();
        std::fs::remove_file(&arguments).unwrap();
        let resumed = request(&host, HardwareProfileAction::Resume).await.unwrap();
        begun(&arguments).await;
        job.shutdown().await.unwrap();
        assert_eq!(first["job_id"], repeated["job_id"]);
        assert!(blocked.contains("Hardware profiling"));
        assert_eq!(cancelled["hardware_profile"]["status"], "cancelled");
        assert!(cancelled["hardware_profile"]["checkpoint_available"]
            .as_bool()
            .unwrap());
        assert!(String::from_utf8(bytes).unwrap().contains("--reprofile"));
        assert_eq!(retained, b"retained");
        assert_eq!(
            std::fs::read(directory.path().join("hardware.json")).unwrap(),
            b"previous accepted profile"
        );
        assert!(resumed["reprofile"].as_bool().unwrap());
        assert_ne!(resumed["job_id"], first["job_id"]);
        assert!(host
            .processes
            .lock()
            .await
            .validate_launch(&launch, false)
            .is_ok());
    }
    #[tokio::test]
    async fn hardware_profile_exit_zero_requires_v2_before_publishing_accepted_file() {
        let (directory, host, _) = fixture().await;
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let accepted = directory.path().join("hardware.json");
        let cli = directory.path().join("ginfer");
        std::fs::write(&accepted, br#"{"schema_version":2,"accepted":"prior"}"#).unwrap();
        for version in [1, 2] {
            std::fs::write(&cli, format!("#!/bin/sh\nprintf '%s' '{{\"schema_version\":{version},\"accepted\":\"new\"}}' > \"$3\"\n")).unwrap();
            request(&host, HardwareProfileAction::Refresh)
                .await
                .unwrap();
            let completed = tokio::time::timeout(Duration::from_secs(2), async {
                while job.busy() {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
            .await;
            job.shutdown().await.unwrap();
            let view = job.status(None);
            let output: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&accepted).unwrap()).unwrap();
            assert!(completed.is_ok());
            if version == 1 {
                assert_eq!(view.status, "failed");
                assert!(view.error.unwrap().contains("schema_version 2"));
                assert_eq!(output["accepted"], "prior");
            } else {
                assert_eq!(view.status, "completed");
                assert_eq!(output["accepted"], "new");
            }
        }
    }
    #[tokio::test]
    async fn hardware_profile_resume_retries_publication_without_restarting_native_refresh() {
        let (directory, host, arguments) = fixture().await;
        let cli = directory.path().join("ginfer");
        let calls = directory.path().join("calls");
        let release = directory.path().join("release");
        std::fs::write(&cli, format!("#!/bin/sh\nprintf invoked >> '{}'\nprintf begun > '{}'\nwhile [ ! -f '{}' ]; do /bin/sleep 0.01; done\nprintf '%s' '{{\"schema_version\":2,\"accepted\":\"new\"}}' > \"$3\"\n", calls.display(),arguments.display(),release.display())).unwrap();
        let accepted = directory.path().join("hardware.json");
        let prior = br#"{"schema_version":2,"accepted":"prior"}"#;
        std::fs::write(&accepted, prior).unwrap();
        request(&host, HardwareProfileAction::Refresh)
            .await
            .unwrap();
        begun(&arguments).await;
        std::fs::remove_file(&accepted).unwrap();
        std::fs::create_dir(&accepted).unwrap();
        std::fs::write(&release, b"release").unwrap();
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let settled = tokio::time::timeout(Duration::from_secs(2), async {
            while job.busy() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await;
        job.shutdown().await.unwrap();
        let failed = job.status(None);
        std::fs::remove_dir(&accepted).unwrap();
        std::fs::write(&accepted, prior).unwrap();
        let resumed = request(&host, HardwareProfileAction::Resume).await;
        job.shutdown().await.unwrap();
        assert!(settled.is_ok());
        assert_eq!(failed.status, "failed");
        assert_eq!(resumed.unwrap()["status"], "completed");
        assert_eq!(std::fs::read(calls).unwrap(), b"invoked");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&std::fs::read(accepted).unwrap()).unwrap()
                ["accepted"],
            "new"
        );
    }
    #[tokio::test]
    async fn hardware_profile_native_fingerprint_rejection_marks_only_launched_group_stale() {
        let (directory, host, _) = fixture().await;
        let profile = directory.path().join("hardware.json");
        std::fs::write(&profile, br#"{"schema_version":2}"#).unwrap();
        let serve = directory.path().join("ginfer-serve");
        std::fs::write(&serve,"#!/bin/sh\nprintf '%s\n' \"hardware profile does not match selected startup hardware: $2; selected GPU inventory changed; run ginfer profile-hardware --reprofile to update the installed profile\" >&2\nexit 1\n").unwrap();
        std::fs::set_permissions(&serve, std::fs::Permissions::from_mode(0o700)).unwrap();
        let launch = EngineLaunch {
            benchmark_profile: None,
            instance_id: Uuid::new_v4(),
            artifact: directory.path().join("ginfer"),
            artifact_dependencies: vec![],
            artifact_set: false,
            model_id: "fixture".into(),
            gpu_uuids: vec!["GPU-fixture".into()],
            tp: 1,
            port: 32123,
            max_context: 32,
            concurrency: 1,
            options: LaunchOptions::default(),
        };
        host.processes.lock().await.launch(launch.clone()).unwrap();
        let failed = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                host.refresh_processes().await.unwrap();
                if host.snapshot().await["instances"][0]["status"] == "failed" {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await;
        let snapshot = host.snapshot().await;
        host.processes.lock().await.shutdown().await.unwrap();
        let block = host.processes.lock().await.validate_launch(&launch, false);
        assert!(failed.is_ok());
        assert_eq!(
            snapshot["hardware_profile"]["stale_groups"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            snapshot["hardware_profile"]["stale_groups"][0]["gpu_uuids"],
            serde_json::json!(["GPU-fixture"])
        );
        assert_eq!(
            snapshot["hardware_profile"]["stale_groups"][0]["profile_path"],
            profile.to_string_lossy().as_ref()
        );
        assert!(block.unwrap_err().contains("Hardware changed"));
    }
    #[tokio::test]
    async fn hardware_profile_scan_queue_preserves_exact_saved_groups_and_reservation() {
        let (directory, host, _) = fixture().await;
        let cli = directory.path().join("ginfer");
        std::fs::write(&cli, format!("#!/bin/sh\nprintf '%s' \"$CUDA_VISIBLE_DEVICES\" > '{}/'\"$CUDA_VISIBLE_DEVICES\"'.begun'\nwhile [ ! -f \"$3.release\" ]; do /bin/sleep 0.01; done\nprintf '%s' '{{\"schema_version\":2}}' > \"$3\"\n", directory.path().display())).unwrap();
        Configuration {
            gpu_uuids: vec!["GPU-second".into()],
            engine: cli,
            profile_path: directory.path().join("second.json"),
        }
        .store(&directory.path().join("host"))
        .unwrap();
        let token = host.data.lock().await.pairing_admin_token.clone();
        let response = host
            .clone()
            .route(
                Request::builder()
                    .method("POST")
                    .uri("/host/v1/scan")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let first = job.status(None);
        let launch = EngineLaunch {
            benchmark_profile: None,
            instance_id: Uuid::new_v4(),
            artifact: directory.path().join("ginfer"),
            artifact_dependencies: vec![],
            artifact_set: false,
            model_id: "fixture".into(),
            gpu_uuids: vec!["GPU-fixture".into()],
            tp: 1,
            port: 32123,
            max_context: 32,
            concurrency: 1,
            options: LaunchOptions::default(),
        };
        let first_block = host.processes.lock().await.validate_launch(&launch, false);
        let first_output = job
            .state
            .lock()
            .unwrap()
            .record
            .output_path
            .clone()
            .unwrap();
        std::fs::write(format!("{}.release", first_output.display()), b"release").unwrap();
        let advanced = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let view = job.status(None);
                if view.gpu_uuids != first.gpu_uuids || !job.busy() {
                    break view;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await;
        let second_block = host.processes.lock().await.validate_launch(&launch, false);
        if let Ok(view) = &advanced {
            if view.gpu_uuids != first.gpu_uuids {
                let output = job
                    .state
                    .lock()
                    .unwrap()
                    .record
                    .output_path
                    .clone()
                    .unwrap();
                std::fs::write(format!("{}.release", output.display()), b"release").unwrap();
            }
        }
        let complete = tokio::time::timeout(Duration::from_secs(2), async {
            while job.busy() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await;
        job.shutdown().await.unwrap();
        let final_view = job.status(None);
        assert!(response.status().is_success());
        assert_eq!(first.pending_gpu_groups.len(), 1);
        assert!(first_block.unwrap_err().contains("Hardware profiling"));
        let second = advanced.unwrap();
        assert_eq!(second.status, "running");
        assert!(second.pending_gpu_groups.is_empty());
        assert!(second_block.unwrap_err().contains("Hardware profiling"));
        assert!(complete.is_ok());
        assert_eq!(final_view.status, "completed");
        assert!(final_view.pending_gpu_groups.is_empty());
        assert_eq!(
            std::fs::read(directory.path().join("GPU-fixture.begun")).unwrap(),
            b"GPU-fixture"
        );
        assert_eq!(
            std::fs::read(directory.path().join("GPU-second.begun")).unwrap(),
            b"GPU-second"
        );
        assert!(directory.path().join("hardware.json").is_file());
        assert!(directory.path().join("second.json").is_file());
    }
    #[tokio::test]
    async fn hardware_profile_interrupted_record_is_not_completed_or_automatically_restarted() {
        let (directory, host, arguments) = fixture().await;
        request(&host, HardwareProfileAction::Refresh)
            .await
            .unwrap();
        begun(&arguments).await;
        let state = directory.path().join("host/hardware-profile-job.json");
        let interrupted = std::fs::read(&state).unwrap();
        host.processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap()
            .shutdown()
            .await
            .unwrap();
        std::fs::write(&state, interrupted).unwrap();
        let recovered =
            HardwareProfiles::open(directory.path().join("host"), Arc::new(AtomicU64::new(1)))
                .unwrap();
        let view = recovered.status(None);
        assert_eq!(view.status, "interrupted");
        assert!(view.pid.is_some());
        assert!(!recovered.busy());
        assert!(view.reprofile);
        assert!(view.checkpoint_available);
    }
}

#[cfg(target_os = "linux")]
fn bind_parent_death(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    let parent = std::process::id();
    unsafe {
        command.as_std_mut().pre_exec(move || {
            extern "C" {
                fn prctl(option: std::ffi::c_int, ...) -> std::ffi::c_int;
                fn getppid() -> std::ffi::c_int;
            }
            if prctl(1, 9usize) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            if getppid() as u32 != parent {
                return Err(std::io::Error::other(
                    "profiling parent exited before lifetime binding",
                ));
            }
            Ok(())
        });
    }
}
