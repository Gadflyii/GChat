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
/// Constructed by Host launch preparation after artifact verification, never from
/// a browser-supplied profile request. The directory and package hashes differ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactProfileIntent {
    pub path: PathBuf,
    pub directory_sha256: String,
    pub package_sha256: Option<String>,
    pub tp: u32,
    /// Zero leaves draft placement to the native artifact resolver.
    pub draft_tp: u32,
    pub spec: String,
    pub draft_tokens: Option<u32>,
}
impl ArtifactProfileIntent {
    fn validate(&self, gpus: &[String]) -> Result<(), String> {
        let hash = |value: &str| value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit());
        if !self.path.is_absolute()
            || !self.path.is_file()
            || !hash(&self.directory_sha256)
            || self
                .package_sha256
                .as_deref()
                .is_some_and(|value| !hash(value))
            || !matches!(self.tp, 1 | 2 | 4)
            || self.tp as usize != gpus.len()
            || !matches!(self.draft_tp, 0 | 1 | 2 | 4)
            || self.draft_tp > self.tp
            || !matches!(self.spec.as_str(), "auto" | "none" | "dflash" | "mtp")
            || match self.spec.as_str() {
                "auto" | "none" => self.draft_tokens.unwrap_or(0) != 0,
                "dflash" => self
                    .draft_tokens
                    .is_some_and(|tokens| !(1..=15).contains(&tokens)),
                "mtp" => self.draft_tokens == Some(0),
                _ => true,
            }
        {
            return Err(
                "Selected profiling requires a verified artifact and matching launch intent".into(),
            );
        }
        Ok(())
    }
}
fn all_formats_scope() -> String {
    "all_formats".into()
}
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
enum ProfileScope {
    #[default]
    AllFormats,
    Artifact(ArtifactProfileIntent),
    CompleteRemainingFormats,
}
impl ProfileScope {
    fn name(&self) -> &str {
        match self {
            Self::AllFormats => "all_formats",
            Self::Artifact(_) => "artifact",
            Self::CompleteRemainingFormats => "complete_remaining_formats",
        }
    }
    fn artifact(&self) -> Option<ArtifactProfileIntent> {
        match self {
            Self::Artifact(intent) => Some(intent.clone()),
            _ => None,
        }
    }
}

/// Admit only the hardware-profile command shapes prepared by this module.
/// Kept outside the Windows process owner so its admission rule is testable on Linux.
#[cfg(any(windows, test))]
pub(crate) fn prepared_hardware_profile_args(args: &[&std::ffi::OsStr]) -> bool {
    use std::ffi::OsStr;

    let [operation, profile_flag, output, tail @ ..] = args else {
        return false;
    };
    if *operation != "profile-hardware"
        || *profile_flag != "--hardware-profile"
        || !Path::new(output).is_absolute()
    {
        return false;
    }
    let tail = tail
        .strip_prefix(&[OsStr::new("--reprofile")])
        .unwrap_or(tail);
    if tail.is_empty()
        || tail
            == [
                OsStr::new("--complete-remaining-formats"),
                OsStr::new("--json"),
            ]
    {
        return true;
    }
    let [model_flag, model, tp_flag, tp, spec_flag, spec, json, rest @ ..] = tail else {
        return false;
    };
    let tp = match tp.to_str() {
        Some("1") => 1,
        Some("2") => 2,
        Some("4") => 4,
        _ => return false,
    };
    if *model_flag != "--model"
        || !Path::new(model).is_absolute()
        || *tp_flag != "--tp"
        || *spec_flag != "--spec"
        || *json != "--json"
    {
        return false;
    }
    let rest = if let [flag, value, remaining @ ..] = rest {
        if *flag == "--draft-tp" {
            let draft_tp = match value.to_str() {
                Some("1") => 1,
                Some("2") => 2,
                Some("4") => 4,
                _ => return false,
            };
            if draft_tp > tp {
                return false;
            }
            remaining
        } else {
            rest
        }
    } else {
        rest
    };
    let tokens = match rest {
        [] => None,
        [flag, value] if *flag == "--draft-tokens" => {
            match value.to_str().and_then(|value| value.parse::<u32>().ok()) {
                Some(tokens) => Some(tokens),
                None => return false,
            }
        }
        _ => return false,
    };
    match spec.to_str() {
        Some("auto" | "none") => tokens.unwrap_or(0) == 0,
        Some("dflash") => tokens.is_none_or(|tokens| (1..=15).contains(&tokens)),
        Some("mtp") => tokens != Some(0),
        _ => false,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HardwareProfileStatus {
    pub status: String,
    pub job_id: Option<Uuid>,
    pub pid: Option<u32>,
    pub reprofile: bool,
    pub started_unix_ms: Option<u64>,
    pub finished_unix_ms: Option<u64>,
    #[serde(default)]
    pub phase: Option<String>,
    #[serde(default)]
    pub phase_detail: Option<String>,
    #[serde(default)]
    pub elapsed_ms: Option<u64>,
    #[serde(default)]
    pub expected_duration_ms: Option<u64>,
    #[serde(default)]
    pub remaining_ms: Option<u64>,
    #[serde(default)]
    pub duration_source: Option<String>,
    #[serde(default = "all_formats_scope")]
    pub scope: String,
    #[serde(default)]
    pub selected_artifact: Option<ArtifactProfileIntent>,
    #[serde(default)]
    pub scope_complete: Option<bool>,
    #[serde(default)]
    pub base_complete: Option<bool>,
    #[serde(default)]
    pub all_formats_complete: Option<bool>,
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
    #[serde(default)]
    measured_work: bool,
    #[serde(default)]
    duration_history_valid: bool,
    #[serde(default)]
    scope: ProfileScope,
    #[serde(default)]
    artifact_receipts: std::collections::BTreeMap<String, ArtifactReceipts>,
}
/// Durable work receipts support idle completion, never runtime admission.
#[derive(Clone, Serialize, Deserialize)]
struct ArtifactReceipts {
    gpu_uuids: Vec<String>,
    artifacts: Vec<ArtifactProfileIntent>,
    all_formats_complete: bool,
    // A failure or explicit Cancel requires an explicit retry. Foreground
    // preemption leaves this false so idle completion remains resumable.
    #[serde(default)]
    completion_failed: bool,
}
struct State {
    record: Record,
    cancel: Option<watch::Sender<bool>>,
    reap_error: Option<String>,
    // Process-local acceptance only: a new Host must native-revalidate its seeds.
    accepted_artifacts: std::collections::BTreeMap<String, Vec<ArtifactProfileIntent>>,
}
pub struct HardwareProfiles {
    directory: PathBuf,
    state: Mutex<State>,
    idle: Notify,
    revision: Arc<AtomicU64>,
    activity: Mutex<Option<Arc<Notify>>>,
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
#[derive(Default)]
struct NativeJson {
    bytes: Vec<u8>,
    complete: bool,
    error: Option<String>,
}
fn validate_native_result(
    scope: &ProfileScope,
    output: &Path,
    captured: &NativeJson,
) -> Result<Option<serde_json::Value>, String> {
    if *scope == ProfileScope::AllFormats {
        return Ok(None);
    }
    if let Some(error) = &captured.error {
        return Err(error.clone());
    }
    if !captured.complete {
        return Err("Native scoped profiling JSON was not completely received".into());
    }
    let value: serde_json::Value = serde_json::from_slice(&captured.bytes)
        .map_err(|error| format!("Native scoped profiling result is not JSON: {error}"))?;
    let expected_mode = if *scope == ProfileScope::CompleteRemainingFormats {
        "complete_remaining_formats"
    } else {
        "ensure"
    };
    let expected_scope = if matches!(scope, ProfileScope::Artifact(_)) {
        "artifact"
    } else {
        "all_formats"
    };
    if value["schema_version"].as_u64() != Some(2)
        || value["mode"].as_str() != Some(expected_mode)
        || value["scope"].as_str() != Some(expected_scope)
        || value["hardware_profile"].as_str().map(Path::new) != Some(output)
        || value["state"].as_str() != Some("loaded")
        || value["complete"].as_bool() != Some(true)
        || value["base_complete"].as_bool() != Some(true)
        || value["all_formats_complete"].as_bool().is_none()
        || value["missing_rows"]
            .as_array()
            .is_none_or(|rows| !rows.is_empty())
    {
        return Err("Native profiling did not admit the requested complete scope".into());
    }
    match scope {
        ProfileScope::Artifact(intent) => {
            let artifact = &value["artifact"];
            let draft_tp = artifact["draft_tp"].as_u64();
            let spec = artifact["spec"].as_str();
            let tokens = artifact["draft_tokens"].as_u64();
            if artifact["path"].as_str().map(Path::new) != Some(intent.path.as_path())
                || artifact["directory_sha256"].as_str() != Some(intent.directory_sha256.as_str())
                || artifact["tp"].as_u64() != Some(u64::from(intent.tp))
                || !draft_tp
                    .is_some_and(|tp| matches!(tp, 0 | 1 | 2 | 4) && tp <= u64::from(intent.tp))
                || (intent.draft_tp != 0 && draft_tp != Some(u64::from(intent.draft_tp)))
                || !spec.is_some_and(|spec| matches!(spec, "auto" | "none" | "dflash" | "mtp"))
                || (intent.spec != "auto" && spec != Some(intent.spec.as_str()))
                || match spec {
                    Some("auto" | "none") => tokens != Some(0),
                    Some("dflash") => !tokens.is_some_and(|tokens| (1..=15).contains(&tokens)),
                    Some("mtp") => !tokens.is_some_and(|tokens| tokens > 0),
                    _ => true,
                }
                || (intent.spec != "auto"
                    && intent
                        .draft_tokens
                        .is_some_and(|expected| tokens != Some(u64::from(expected))))
            {
                return Err(
                    "Native profiling artifact does not match the verified launch intent".into(),
                );
            }
        }
        ProfileScope::CompleteRemainingFormats => {
            if value["all_formats_complete"].as_bool() != Some(true) || !value["artifact"].is_null()
            {
                return Err("Native remaining-format completion is incomplete".into());
            }
        }
        ProfileScope::AllFormats => unreachable!(),
    }
    Ok(Some(value))
}
fn sample_elapsed(record: &mut Record) {
    record.view.elapsed_ms = record.view.started_unix_ms.map(|started| {
        record
            .view
            .finished_unix_ms
            .unwrap_or_else(now)
            .saturating_sub(started)
    });
    record.view.remaining_ms = if record.view.finished_unix_ms.is_none() {
        record
            .view
            .expected_duration_ms
            .zip(record.view.elapsed_ms)
            .and_then(|(expected, elapsed)| expected.checked_sub(elapsed).filter(|left| *left > 0))
    } else {
        None
    };
}
fn diagnostic_progress(record: &mut Record, line: &str) {
    let fields: std::collections::BTreeMap<_, _> = line
        .split_ascii_whitespace()
        .filter_map(|field| field.split_once('='))
        .collect();
    let format = fields.get("format").copied().filter(|value| {
        !value.is_empty()
            && value.len() <= 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
    });
    if line.starts_with("GPU expert install ") {
        if let Some(format) = format {
            if record.view.phase.as_deref() != Some("publishing") {
                record.view.phase = Some("gpu_experts".into());
                record.view.phase_detail = Some(format!("Measuring GPU expert grid for {format}"));
            }
        }
    } else if line.starts_with("CPU expert calibration ") {
        if let (Some(format), Some(node)) = (
            format,
            fields.get("node").and_then(|node| node.parse::<u32>().ok()),
        ) {
            let detail = match fields.get("phase").copied() {
                Some("core") => Some("core grid"),
                Some("node") => Some("NUMA grid"),
                _ if fields.contains_key("format_seconds") => Some("format"),
                _ => None,
            };
            let seconds = fields
                .get("phase_seconds")
                .or_else(|| fields.get("format_seconds"))
                .and_then(|value| value.parse::<f64>().ok())
                .filter(|seconds| seconds.is_finite() && *seconds >= 0.0);
            let rows = fields.get("rows").and_then(|rows| rows.parse::<u64>().ok());
            if let Some(detail) =
                detail.filter(|_| seconds.is_some() && rows.is_some_and(|rows| rows > 0))
            {
                record.measured_work = true;
                // These diagnostic lines are completion records, not phase starts.
                if record.view.phase.as_deref() != Some("publishing") {
                    record.view.phase = Some("cpu_experts".into());
                    record.view.phase_detail = Some(format!(
                        "Completed {detail} for {format} on NUMA node {node}"
                    ));
                }
            }
        }
    } else if line.starts_with("Hardware install resume: ") {
        record.measured_fresh = false;
        record.view.expected_duration_ms = None;
        record.view.remaining_ms = None;
        record.view.duration_source = None;
    } else if line.starts_with("Hardware profile: ") {
        record.view.phase = Some("publishing".into());
        record.view.phase_detail =
            Some("Native profile completed; publishing validated output".into());
    }
}
impl Configuration {
    fn validate_structure(&self) -> Result<(), String> {
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
        if !self.engine.is_absolute() || !self.profile_path.is_absolute() {
            return Err(
                "hardware profiling requires an existing absolute CLI and absolute profile path"
                    .into(),
            );
        }
        Ok(())
    }
    pub fn validate(&self) -> Result<(), String> {
        self.validate_structure()?;
        if !self.engine.is_file() {
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
                measured_work: false,
                duration_history_valid: true,
                scope: ProfileScope::AllFormats,
                artifact_receipts: Default::default(),
                view: HardwareProfileStatus {
                    status: "idle".into(),
                    job_id: None,
                    pid: None,
                    reprofile: false,
                    started_unix_ms: None,
                    finished_unix_ms: None,
                    phase: None,
                    phase_detail: None,
                    elapsed_ms: None,
                    expected_duration_ms: None,
                    remaining_ms: None,
                    duration_source: None,
                    scope: all_formats_scope(),
                    selected_artifact: None,
                    scope_complete: None,
                    base_complete: None,
                    all_formats_complete: None,
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
        // Older records included seeded Refresh/cache-hit durations; they cannot be
        // presented as measurements of a full cold installation.
        if !record.duration_history_valid {
            record.accepted_durations.clear();
            for group in &mut record.view.stale_groups {
                group.expected_duration_ms = None;
            }
            record.duration_history_valid = true;
            record.view.expected_duration_ms = None;
            record.view.remaining_ms = None;
            record.view.duration_source = None;
        }
        if matches!(record.view.status.as_str(), "running" | "cancelling") {
            if record.scope == ProfileScope::CompleteRemainingFormats {
                if let Some(receipt) = record.artifact_receipts.get_mut(&group_key(&record.view.gpu_uuids)) {
                    receipt.completion_failed = true;
                }
            }
            record.view.status = "interrupted".into();
            record.view.remaining_ms = None;
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
                accepted_artifacts: Default::default(),
            }),
            idle: Notify::new(),
            revision,
            activity: Mutex::new(None),
        }))
    }
    pub(crate) fn set_activity_notification(&self, activity: Arc<Notify>) {
        *self.activity.lock().unwrap() = Some(activity);
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
        // Package paths are not native fingerprint identity. Preserve the accepted
        // seed and let the selected runtime revalidate it before publication.
        configuration.engine = expected_engine;
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
            config.validate_structure()?;
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
        let removed = state.accepted_artifacts.remove(&key).is_some()
            | state.record.artifact_receipts.remove(&key).is_some();
        if state
            .record
            .view
            .stale_groups
            .iter()
            .any(|group| group_key(&group.gpu_uuids) == key)
        {
            if removed {
                let _ = self.save(&state.record);
                self.revision.fetch_add(1, Ordering::SeqCst);
            }
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
        // Retain completed output after a publication failure. Resume still
        // validates that private seed with the current native runtime.
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
        if state.record.measured_fresh && state.record.measured_work {
            state.record.accepted_durations.insert(key.clone(), elapsed);
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
        self.launch_locked(
            &mut state,
            first.clone(),
            false,
            None,
            ProfileScope::AllFormats,
        )
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
            state.record.configuration.clone().map(|mut configuration| {
                if let Some(engine) = &fallback {
                    configuration.engine = engine.clone();
                }
                configuration
            })
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
        self.start_with_scope(action, fallback, gpus, None)
    }
    /// The caller resolves this intent through verified Host launch preparation.
    pub fn start_scoped(
        self: &Arc<Self>,
        action: HardwareProfileAction,
        fallback: Option<PathBuf>,
        gpus: Vec<String>,
        intent: ArtifactProfileIntent,
    ) -> Result<(), String> {
        intent.validate(&gpus)?;
        self.start_with_scope(action, fallback, gpus, Some(ProfileScope::Artifact(intent)))
    }
    /// Explicit idle work, with its own private output/checkpoint and cancellation owner.
    pub fn start_remaining_formats(
        self: &Arc<Self>,
        fallback: Option<PathBuf>,
        gpus: Vec<String>,
    ) -> Result<(), String> {
        self.start_with_scope(
            HardwareProfileAction::Ensure,
            fallback,
            gpus,
            Some(ProfileScope::CompleteRemainingFormats),
        )
    }
    /// A configured path can contain a replacement runtime even when unchanged.
    /// Preserve durable native seeds and deferred work, but require fresh acceptance.
    pub fn invalidate_runtime_acceptance(&self) {
        self.state.lock().unwrap().accepted_artifacts.clear();
    }
    /// This is deliberately not restored from disk: each Host process revalidates
    /// selected artifacts with its current runtime before relying on acceptance.
    pub fn artifact_is_accepted(&self, gpus: &[String], intent: &ArtifactProfileIntent) -> bool {
        self.state
            .lock()
            .unwrap()
            .accepted_artifacts
            .get(&group_key(gpus))
            .is_some_and(|accepted| accepted.contains(intent))
    }
    /// Groups with exact artifact acceptance in this Host process only.
    pub fn accepted_gpu_groups(&self) -> Vec<Vec<String>> {
        let state = self.state.lock().unwrap();
        state
            .record
            .artifact_receipts
            .iter()
            .filter_map(|(key, receipt)| {
                state
                    .accepted_artifacts
                    .get(key)
                    .filter(|artifacts| !artifacts.is_empty())
                    .map(|_| receipt.gpu_uuids.clone())
            })
            .collect()
    }
    /// Persisted work to finish while idle. These receipts confer no serving
    /// admission, and native completion must revalidate their seed's freshness.
    /// Failed/interrupted completion requires explicit Resume or new selection.
    pub fn deferred_groups(&self) -> Vec<Vec<String>> {
        self.state
            .lock()
            .unwrap()
            .record
            .artifact_receipts
            .values()
            .filter(|receipt| {
                !receipt.artifacts.is_empty()
                    && !receipt.all_formats_complete
                    && !receipt.completion_failed
            })
            .map(|receipt| receipt.gpu_uuids.clone())
            .collect()
    }
    fn start_with_scope(
        self: &Arc<Self>,
        action: HardwareProfileAction,
        fallback: Option<PathBuf>,
        gpus: Vec<String>,
        requested_scope: Option<ProfileScope>,
    ) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        let scope = if matches!(
            action,
            HardwareProfileAction::Resume | HardwareProfileAction::Cancel
        ) {
            if requested_scope
                .as_ref()
                .is_some_and(|scope| scope != &state.record.scope)
            {
                return Err("Resume and cancel retain the original artifact scope".into());
            }
            state.record.scope.clone()
        } else {
            requested_scope.unwrap_or_default()
        };
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
        if action == HardwareProfileAction::Cancel {
            let key = group_key(&gpus);
            if scope == ProfileScope::CompleteRemainingFormats {
                state
                    .record
                    .artifact_receipts
                    .entry(key.clone())
                    .or_insert_with(|| ArtifactReceipts {
                        gpu_uuids: gpus.clone(),
                        artifacts: vec![],
                        all_formats_complete: false,
                        completion_failed: false,
                    });
            }
            if let Some(receipt) = state.record.artifact_receipts.get_mut(&key) {
                receipt.completion_failed = true;
            }
        }
        if let Some(cancel) = &state.cancel {
            if action != HardwareProfileAction::Cancel && scope != state.record.scope {
                return Err("The active profiler owns a different artifact scope".into());
            }
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
            self.save(&state.record)?;
            self.revision.fetch_add(1, Ordering::SeqCst);
            return Ok(());
        }
        if action == HardwareProfileAction::Ensure
            && scope == ProfileScope::CompleteRemainingFormats
            && state
                .record
                .artifact_receipts
                .get(&group_key(&gpus))
                .is_some_and(|receipt| receipt.completion_failed)
        {
            return Ok(());
        }
        if action == HardwareProfileAction::Ensure
            && state.record.scope == scope
            && group_key(&state.record.view.gpu_uuids) == group_key(&gpus)
            && (state.record.view.status == "interrupted"
                || (state.record.view.status == "cancelled"
                    && scope != ProfileScope::CompleteRemainingFormats)
                || (state.record.view.status == "failed"
                    && (state.record.view.reprofile
                        || scope == ProfileScope::CompleteRemainingFormats)))
        {
            // Inventory refresh must not silently retry interrupted or failed
            // background work. A foreground cancellation may resume while idle.
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
        let (mut configuration, reprofile) = if action == HardwareProfileAction::Resume {
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
        let expected_engine =
            fallback.ok_or("No native profiling CLI configured for this GPU group")?;
        configuration.engine = expected_engine;
        configuration.validate()?;
        configuration.store(&self.directory)?;
        // The binary can be replaced at the same path. Even publication-only
        // retries must let the current native runtime validate the saved seed.
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
        self.launch_locked(&mut state, configuration, reprofile, reused, scope)
    }
    fn launch_locked(
        self: &Arc<Self>,
        state: &mut State,
        configuration: Configuration,
        reprofile: bool,
        reused: Option<PathBuf>,
        scope: ProfileScope,
    ) -> Result<(), String> {
        // A seed can make even --reprofile a cache hit or a partial repair. Only
        // an unseeded invocation can supply comparable full-run history.
        let measured_fresh = scope == ProfileScope::AllFormats
            && reused.is_none()
            && !configuration.profile_path.exists();
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
        let expected_duration_ms = if measured_fresh {
            previous
                .accepted_durations
                .get(&group_key(&configuration.gpu_uuids))
                .copied()
        } else {
            None
        };
        state.record = Record {
            pending: previous.pending.clone(),
            accepted_durations: previous.accepted_durations.clone(),
            native_completed: false,
            measured_fresh,
            measured_work: false,
            duration_history_valid: true,
            scope: scope.clone(),
            artifact_receipts: previous.artifact_receipts.clone(),
            configuration: Some(configuration.clone()),
            output_path: Some(output_path.clone()),
            view: HardwareProfileStatus {
                status: "running".into(),
                job_id: Some(Uuid::new_v4()),
                pid: None,
                reprofile,
                started_unix_ms: Some(now()),
                finished_unix_ms: None,
                phase: Some("preparing".into()),
                phase_detail: None,
                elapsed_ms: Some(0),
                expected_duration_ms,
                remaining_ms: expected_duration_ms.filter(|expected| *expected > 0),
                duration_source: expected_duration_ms.map(|_| "measured_history".into()),
                scope: scope.name().into(),
                selected_artifact: scope.artifact(),
                scope_complete: None,
                base_complete: None,
                all_formats_complete: None,
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
        // Revalidation must not leave an earlier selected acceptance usable if
        // this invocation fails. Other already verified artifacts remain usable.
        if let ProfileScope::Artifact(intent) = &scope {
            if let Some(accepted) = state
                .accepted_artifacts
                .get_mut(&group_key(&configuration.gpu_uuids))
            {
                accepted.retain(|previous| previous != intent);
            }
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
        match &scope {
            ProfileScope::Artifact(intent) => {
                command
                    .arg("--model")
                    .arg(&intent.path)
                    .arg("--tp")
                    .arg(intent.tp.to_string())
                    .arg("--spec")
                    .arg(&intent.spec)
                    .arg("--json");
                if intent.draft_tp != 0 {
                    command.arg("--draft-tp").arg(intent.draft_tp.to_string());
                }
                if let Some(tokens) = intent.draft_tokens {
                    command.arg("--draft-tokens").arg(tokens.to_string());
                }
            }
            ProfileScope::CompleteRemainingFormats => {
                command.arg("--complete-remaining-formats").arg("--json");
            }
            ProfileScope::AllFormats => {}
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
                    sample_elapsed(&mut state.record);
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
                sample_elapsed(&mut state.record);
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
        let captured = Arc::new(Mutex::new(NativeJson::default()));
        let readers = Readers(vec![
            read_tail(stdout, owner.clone(), Some(captured.clone())),
            read_tail(stderr, owner.clone(), None),
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
            sample_elapsed(&mut state.record);
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
                        validate_native_result(&scope, &output_path, &captured.lock().unwrap())
                            .and_then(|result| {
                                owner.publish_completed(
                                    &mut state,
                                    &configuration,
                                    &output_path,
                                )?;
                                if let Some(result) = result {
                                    state.record.view.scope_complete = result["complete"].as_bool();
                                    state.record.view.base_complete =
                                        result["base_complete"].as_bool();
                                    state.record.view.all_formats_complete =
                                        result["all_formats_complete"].as_bool();
                                }
                                Ok(())
                            });
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
            let previous_receipts = state.record.artifact_receipts.clone();
            let key = group_key(&configuration.gpu_uuids);
            let all_formats_complete = state.record.view.all_formats_complete == Some(true);
            if state.record.view.status == "completed" {
                match &scope {
                    ProfileScope::Artifact(intent) => {
                        let receipt = state
                            .record
                            .artifact_receipts
                            .entry(key.clone())
                            .or_insert_with(|| ArtifactReceipts {
                                gpu_uuids: configuration.gpu_uuids.clone(),
                                artifacts: vec![],
                                all_formats_complete: false,
                                completion_failed: false,
                            });
                        if !receipt.artifacts.contains(intent) {
                            receipt.artifacts.push(intent.clone());
                        }
                        receipt.all_formats_complete = all_formats_complete;
                        receipt.completion_failed = false;
                    }
                    ProfileScope::AllFormats | ProfileScope::CompleteRemainingFormats => {
                        if let Some(receipt) = state.record.artifact_receipts.get_mut(&key) {
                            receipt.all_formats_complete = true;
                            receipt.completion_failed = false;
                        }
                    }
                }
            } else if state.record.view.status == "failed"
                && scope == ProfileScope::CompleteRemainingFormats
            {
                if let Some(receipt) = state.record.artifact_receipts.get_mut(&key) {
                    receipt.completion_failed = true;
                }
            }
            let advance =
                state.record.view.status == "completed" && !state.record.pending.is_empty();
            if advance {
                state.record.view.status = "running".into();
            }
            if let Err(error) = owner.save(&state.record) {
                state.record.artifact_receipts = previous_receipts;
                state.record.view.error =
                    Some(format!("Could not persist profiling result: {error}"));
                state.record.view.status = "failed".into();
            }
            owner.revision.fetch_add(1, Ordering::SeqCst);
            if advance && state.record.view.status == "running" {
                let next = state.record.pending.remove(0);
                // The lock prevents model admission while replacing the reaped child's reservation.
                state.cancel = None;
                if let Err(error) = owner.launch_locked(
                    &mut state,
                    next.clone(),
                    false,
                    None,
                    ProfileScope::AllFormats,
                ) {
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
            if state.record.view.status == "completed" {
                if let ProfileScope::Artifact(intent) = &scope {
                    let accepted = state
                        .accepted_artifacts
                        .entry(group_key(&configuration.gpu_uuids))
                        .or_default();
                    if !accepted.contains(intent) {
                        accepted.push(intent.clone());
                    }
                }
            }
            drop(state);
            owner.idle.notify_waiters();
            if let Some(activity) = &*owner.activity.lock().unwrap() {
                activity.notify_one();
            }
        });
        request_error.map_or(Ok(()), Err)
    }
    /// Cancel only the profiler started by this operation. A late route/drop
    /// must not cancel a newer job or discard work queued by another owner.
    pub(crate) fn cancel_job(&self, job_id: Uuid) -> bool {
        self.cancel_job_locked(&mut self.state.lock().unwrap(), job_id)
    }
    fn cancel_job_locked(&self, state: &mut State, job_id: Uuid) -> bool {
        if state.record.view.job_id != Some(job_id) {
            return false;
        }
        let Some(cancel) = &state.cancel else {
            return false;
        };
        cancel.send_replace(true);
        if state.record.view.status != "cancelling" {
            state.record.view.status = "cancelling".into();
            self.revision.fetch_add(1, Ordering::SeqCst);
            // Failure to persist the status must not prevent the live owner
            // from receiving cancellation and reaping its child.
            let _ = self.save(&state.record);
        }
        true
    }
    /// Explicit route cancellation waits for the matching child's existing
    /// termination/reap task, without waiting on an unrelated replacement job.
    pub(crate) async fn cancel_job_and_wait(&self, job_id: Uuid) -> Result<(), String> {
        loop {
            let idle = self.idle.notified();
            tokio::pin!(idle);
            idle.as_mut().enable();
            {
                let mut state = self.state.lock().unwrap();
                if !self.cancel_job_locked(&mut state, job_id) {
                    return Ok(());
                }
                if let Some(error) = &state.reap_error {
                    return Err(error.clone());
                }
            }
            idle.await;
        }
    }
    /// Reap idle completion before foreground work. The caller may hold the Host
    /// lifecycle lock, but must not hold this worker's state mutex. The worker
    /// has no Host dependency. A failed wait retains its admission reservation.
    pub async fn cancel_background_and_wait(&self) -> Result<(), String> {
        loop {
            let idle = self.idle.notified();
            tokio::pin!(idle);
            idle.as_mut().enable();
            {
                let mut state = self.state.lock().unwrap();
                if state.record.scope != ProfileScope::CompleteRemainingFormats
                    || state.cancel.is_none()
                {
                    return Ok(());
                }
                state.record.pending.clear();
                state.record.view.pending_gpu_groups.clear();
                state.cancel.as_ref().unwrap().send_replace(true);
                if let Some(error) = &state.reap_error {
                    return Err(error.clone());
                }
            }
            idle.await;
        }
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
    captured: Option<Arc<Mutex<NativeJson>>>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut reader = reader;
        let mut bytes = [0u8; 4096];
        let mut pending = Vec::new();
        loop {
            let count = match reader.read(&mut bytes).await {
                Ok(count) => count,
                Err(error) => {
                    if let Some(captured) = &captured {
                        captured.lock().unwrap().error =
                            Some(format!("Cannot read native profiling JSON: {error}"));
                    }
                    break;
                }
            };
            if count == 0 {
                if let Some(captured) = &captured {
                    captured.lock().unwrap().complete = true;
                }
                break;
            }
            if let Some(captured) = &captured {
                let mut captured = captured.lock().unwrap();
                if captured.bytes.len() + count <= 1_048_576 && captured.error.is_none() {
                    captured.bytes.extend_from_slice(&bytes[..count]);
                } else {
                    captured.error = Some("Native profiling JSON exceeds the 1 MiB limit".into());
                }
            }
            let mut state = owner.state.lock().unwrap();
            pending.extend_from_slice(&bytes[..count]);
            while let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
                diagnostic_progress(&mut state.record, &String::from_utf8_lossy(&pending[..end]));
                pending.drain(..=end);
            }
            if pending.len() > 16_384 {
                pending.clear();
            }
            sample_elapsed(&mut state.record);
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
        if !pending.is_empty() {
            let mut state = owner.state.lock().unwrap();
            diagnostic_progress(&mut state.record, &String::from_utf8_lossy(&pending));
            sample_elapsed(&mut state.record);
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

    #[test]
    fn windows_hardware_profile_args_accepts_prepared_scopes() {
        use std::ffi::OsStr;

        for reprofile in [false, true] {
            let mut base = vec![
                OsStr::new("profile-hardware"),
                OsStr::new("--hardware-profile"),
                OsStr::new("/private data/hardware.json"),
            ];
            if reprofile {
                base.push(OsStr::new("--reprofile"));
            }
            assert!(prepared_hardware_profile_args(&base));
            let mut completion = base.clone();
            completion.extend([
                OsStr::new("--complete-remaining-formats"),
                OsStr::new("--json"),
            ]);
            assert!(prepared_hardware_profile_args(&completion));
            for (spec, optional) in [
                ("auto", vec![]),
                ("none", vec!["--draft-tokens", "0"]),
                ("dflash", vec!["--draft-tp", "2", "--draft-tokens", "15"]),
                ("mtp", vec!["--draft-tokens", "3"]),
                ("mtp", vec!["--draft-tp", "4"]),
            ] {
                let mut artifact = base.clone();
                artifact.extend(
                    [
                        "--model",
                        "/model data/model.ginfer",
                        "--tp",
                        "4",
                        "--spec",
                        spec,
                        "--json",
                    ]
                    .into_iter()
                    .chain(optional)
                    .map(OsStr::new),
                );
                assert!(prepared_hardware_profile_args(&artifact), "{artifact:?}");
            }
        }
    }

    #[test]
    fn windows_hardware_profile_args_rejects_malformed_scopes() {
        use std::ffi::OsStr;

        let base = [
            "profile-hardware",
            "--hardware-profile",
            "/private/hardware.json",
        ];
        let artifact = [
            "--model",
            "/models/model.ginfer",
            "--tp",
            "1",
            "--spec",
            "mtp",
            "--json",
        ];
        for tail in [
            vec!["--reprofile", "--reprofile"],
            vec!["--complete-remaining-formats"],
            vec!["--complete-remaining-formats", "--json", "--unknown"],
            vec!["--json"],
            artifact[..6].to_vec(),
            [artifact.as_slice(), &["--unknown"]].concat(),
            [
                artifact.as_slice(),
                &["--complete-remaining-formats", "--json"],
            ]
            .concat(),
            [artifact.as_slice(), &["--draft-tp"]].concat(),
            [artifact.as_slice(), &["--draft-tp", "2"]].concat(),
            [artifact.as_slice(), &["--draft-tokens", "0"]].concat(),
            [artifact.as_slice(), &["--draft-tokens", "not-a-number"]].concat(),
            [
                artifact.as_slice(),
                &["--draft-tokens", "3", "--draft-tokens", "3"],
            ]
            .concat(),
        ] {
            let args: Vec<_> = base.iter().copied().chain(tail).map(OsStr::new).collect();
            assert!(!prepared_hardware_profile_args(&args), "{args:?}");
        }
        let valid: Vec<_> = base.into_iter().chain(artifact).map(OsStr::new).collect();
        for (index, value) in [
            (0, "not-profile-hardware"),
            (1, "--not-hardware-profile"),
            (2, "relative/hardware.json"),
            (4, "relative/model.ginfer"),
            (6, "3"),
            (8, "unknown"),
        ] {
            let mut invalid = valid.clone();
            invalid[index] = OsStr::new(value);
            assert!(!prepared_hardware_profile_args(&invalid), "{invalid:?}");
        }
    }

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
    async fn observed(
        job: &HardwareProfiles,
        predicate: impl Fn(&HardwareProfileStatus) -> bool,
    ) -> HardwareProfileStatus {
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let view = job.status(None);
                if predicate(&view) {
                    return view;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap()
    }
    fn selected_intent(directory: &Path) -> ArtifactProfileIntent {
        let path = directory.join("selected.ginfer");
        std::fs::write(&path, b"verified artifact fixture").unwrap();
        ArtifactProfileIntent {
            path,
            directory_sha256: "a".repeat(64),
            package_sha256: Some("b".repeat(64)),
            tp: 1,
            draft_tp: 0,
            spec: "mtp".into(),
            draft_tokens: Some(3),
        }
    }
    fn selected_result(intent: &ArtifactProfileIntent) -> serde_json::Value {
        serde_json::json!({
            "schema_version": 2,
            "mode": "ensure",
            "scope": "artifact",
            "hardware_profile": "__OUTPUT__",
            "state": "loaded",
            "complete": true,
            "base_complete": true,
            "all_formats_complete": false,
            "missing_rows": [],
            "artifact": {
                "path": intent.path,
                "directory_sha256": intent.directory_sha256,
                "tp": 1,
                "draft_tp": 0,
                "spec": "mtp",
                "draft_tokens": 3
            }
        })
    }
    fn scoped_cli(directory: &Path, arguments: &Path, result: &serde_json::Value) {
        let quote = |value: &str| format!("'{}'", value.replace('\'', "'\\''"));
        let result = serde_json::to_string(result).unwrap();
        let (prefix, suffix) = result.split_once("__OUTPUT__").unwrap();
        std::fs::write(directory.join("ginfer"), format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > {}\nprintf '%s' '{{\"schema_version\":2,\"accepted\":\"scoped\"}}' > \"$3\"\nprintf '%s%s%s\\n' {} \"$3\" {}\n",
            quote(arguments.to_str().unwrap()), quote(prefix), quote(suffix)
        )).unwrap();
    }
    #[test]
    fn hardware_profile_scoped_json_rejects_unqualified_or_mismatched_results() {
        let directory = tempfile::tempdir().unwrap();
        let intent = selected_intent(directory.path());
        let scope = ProfileScope::Artifact(intent.clone());
        let output = directory.path().join("output.json");
        let mut valid = selected_result(&intent);
        valid["hardware_profile"] = serde_json::json!(output);
        let captured = |value: &serde_json::Value| NativeJson {
            bytes: serde_json::to_vec(value).unwrap(),
            complete: true,
            error: None,
        };
        assert!(validate_native_result(&scope, &output, &captured(&valid)).is_ok());
        let mut default_intent = intent.clone();
        default_intent.draft_tokens = None;
        assert!(default_intent.validate(&["GPU-selected".into()]).is_ok());
        assert!(validate_native_result(
            &ProfileScope::Artifact(default_intent.clone()),
            &output,
            &captured(&valid)
        )
        .is_ok());
        default_intent.spec = "dflash".into();
        let mut default_result = valid.clone();
        default_result["artifact"]["spec"] = serde_json::json!("dflash");
        default_result["artifact"]["draft_tokens"] = serde_json::json!(4);
        assert!(default_intent.validate(&["GPU-selected".into()]).is_ok());
        assert!(validate_native_result(
            &ProfileScope::Artifact(default_intent),
            &output,
            &captured(&default_result)
        )
        .is_ok());
        let mut automatic_intent = intent.clone();
        automatic_intent.spec = "auto".into();
        automatic_intent.draft_tokens = Some(0);
        let automatic_scope = ProfileScope::Artifact(automatic_intent);
        // Dense targets retain auto; Flash may resolve the same request to MTP.
        assert!(validate_native_result(&automatic_scope, &output, &captured(&valid)).is_ok());
        let mut automatic_result = valid.clone();
        automatic_result["artifact"]["spec"] = serde_json::json!("auto");
        automatic_result["artifact"]["draft_tokens"] = serde_json::json!(0);
        assert!(
            validate_native_result(&automatic_scope, &output, &captured(&automatic_result)).is_ok()
        );
        for (field, value) in [
            ("complete", serde_json::json!(false)),
            ("base_complete", serde_json::json!(false)),
            ("scope", serde_json::json!("all_formats")),
            ("mode", serde_json::json!("check")),
            (
                "missing_rows",
                serde_json::json!(["selected format missing"]),
            ),
        ] {
            let mut rejected = valid.clone();
            rejected[field] = value;
            assert!(
                validate_native_result(&scope, &output, &captured(&rejected)).is_err(),
                "{field}"
            );
        }
        for (field, value) in [
            ("directory_sha256", serde_json::json!(intent.package_sha256)),
            (
                "path",
                serde_json::json!(directory.path().join("another.ginfer")),
            ),
            ("tp", serde_json::json!(2)),
            ("draft_tp", serde_json::json!(2)),
            ("spec", serde_json::json!("auto")),
            ("draft_tokens", serde_json::json!(4)),
        ] {
            let mut rejected = valid.clone();
            rejected["artifact"][field] = value;
            assert!(
                validate_native_result(&scope, &output, &captured(&rejected)).is_err(),
                "artifact.{field}"
            );
        }
        let mut incomplete = captured(&valid);
        incomplete.complete = false;
        assert!(validate_native_result(&scope, &output, &incomplete).is_err());
        incomplete.complete = true;
        incomplete.error = Some("bounded capture failed".into());
        assert_eq!(
            validate_native_result(&scope, &output, &incomplete).unwrap_err(),
            "bounded capture failed"
        );
    }
    #[tokio::test]
    async fn hardware_profile_selected_ensure_accepts_exact_scope_without_all_format_eta() {
        let (directory, host, arguments) = fixture().await;
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let intent = selected_intent(directory.path());
        scoped_cli(directory.path(), &arguments, &selected_result(&intent));
        let gpus = vec!["GPU-fixture".into()];
        job.start_scoped(
            HardwareProfileAction::Ensure,
            Some(directory.path().join("ginfer")),
            gpus.clone(),
            intent.clone(),
        )
        .unwrap();
        let done = observed(&job, |view| view.status == "completed").await;
        assert_eq!(done.scope, "artifact");
        assert_eq!(done.selected_artifact, Some(intent.clone()));
        assert_eq!(done.scope_complete, Some(true));
        assert_eq!(done.base_complete, Some(true));
        assert_eq!(done.all_formats_complete, Some(false));
        assert_eq!(done.expected_duration_ms, None);
        assert_eq!(done.duration_source, None);
        assert!(job.artifact_is_accepted(&gpus, &intent));
        assert_eq!(job.accepted_gpu_groups(), vec![gpus.clone()]);
        assert_eq!(job.deferred_groups(), vec![gpus.clone()]);
        let mut different = intent.clone();
        different.package_sha256 = Some("c".repeat(64));
        assert!(!job.artifact_is_accepted(&gpus, &different));
        let argv: Vec<String> = std::fs::read_to_string(&arguments)
            .unwrap()
            .lines()
            .map(str::to_owned)
            .collect();
        assert_eq!(&argv[..2], &["profile-hardware", "--hardware-profile"]);
        assert!(argv
            .windows(2)
            .any(|pair| pair == ["--model", intent.path.to_str().unwrap()]));
        assert!(argv.windows(2).any(|pair| pair == ["--spec", "mtp"]));
        assert!(argv.windows(2).any(|pair| pair == ["--draft-tokens", "3"]));
        assert!(argv.iter().any(|arg| arg == "--json"));
        assert!(!argv.iter().any(|arg| arg == "--draft-tp"));
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(
                &std::fs::read(&done.profile_path).unwrap()
            )
            .unwrap()["accepted"],
            "scoped"
        );
        let reopened =
            HardwareProfiles::open(directory.path().join("host"), Arc::new(AtomicU64::new(0)))
                .unwrap();
        assert!(!reopened.artifact_is_accepted(&gpus, &intent));
        assert!(reopened.accepted_gpu_groups().is_empty());
        assert_eq!(reopened.deferred_groups(), vec![gpus.clone()]);

        let mut rejected = selected_result(&intent);
        rejected["artifact"]["directory_sha256"] = serde_json::json!("c".repeat(64));
        scoped_cli(directory.path(), &arguments, &rejected);
        let canonical = std::fs::read(&done.profile_path).unwrap();
        job.start_scoped(
            HardwareProfileAction::Ensure,
            Some(directory.path().join("ginfer")),
            gpus.clone(),
            intent.clone(),
        )
        .unwrap();
        let failed = observed(&job, |view| view.status == "failed").await;
        assert!(failed.error.unwrap().contains("verified launch intent"));
        assert_eq!(std::fs::read(&done.profile_path).unwrap(), canonical);
        assert!(!job.artifact_is_accepted(&gpus, &intent));
    }
    #[tokio::test]
    async fn hardware_profile_runtime_configuration_requires_fresh_artifact_acceptance() {
        let (directory, host, arguments) = fixture().await;
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let intent = selected_intent(directory.path());
        let result = selected_result(&intent);
        scoped_cli(directory.path(), &arguments, &result);
        let replacement = directory.path().join("replacement");
        std::fs::create_dir(&replacement).unwrap();
        scoped_cli(&replacement, &arguments, &result);
        std::fs::set_permissions(
            replacement.join("ginfer"),
            std::fs::Permissions::from_mode(0o700),
        )
        .unwrap();
        std::fs::write(replacement.join("ginfer-serve"), "").unwrap();
        let gpus = vec!["GPU-fixture".to_owned()];
        let mut cli = directory.path().join("ginfer");
        let mut previous_job_id = None;
        for (per_architecture, serve) in [
            (false, directory.path().join("ginfer-serve")),
            (false, replacement.join("ginfer-serve")),
            (true, replacement.join("ginfer-serve")),
            (true, replacement.join("ginfer-serve")),
        ] {
            job.start_scoped(
                HardwareProfileAction::Ensure,
                Some(cli.clone()),
                gpus.clone(),
                intent.clone(),
            )
            .unwrap();
            let done = observed(&job, |view| view.status == "completed").await;
            assert_ne!(done.job_id, previous_job_id);
            previous_job_id = done.job_id;
            assert!(job.artifact_is_accepted(&gpus, &intent));
            let profile = std::fs::read(&done.profile_path).unwrap();
            let record_path = directory.path().join("host/hardware-profile-job.json");
            let record = std::fs::read(&record_path).unwrap();
            {
                let mut processes = host.processes.lock().await;
                assert!(processes
                    .configure_executable(directory.path().join("missing-runtime"))
                    .is_err());
                assert!(processes
                    .configure_runtimes(
                        std::collections::BTreeMap::from([(
                            "12.0".into(),
                            directory.path().join("missing-runtime"),
                        )]),
                        std::collections::BTreeMap::new(),
                    )
                    .is_err());
                assert!(job.artifact_is_accepted(&gpus, &intent));
                if per_architecture {
                    processes
                        .configure_runtimes(
                            std::collections::BTreeMap::from([("12.0".into(), serve.clone())]),
                            std::collections::BTreeMap::from([(
                                gpus[0].clone(),
                                "12.0".into(),
                            )]),
                        )
                        .unwrap();
                } else {
                    processes.configure_executable(serve.clone()).unwrap();
                }
            }
            assert!(!job.artifact_is_accepted(&gpus, &intent));
            assert!(job.accepted_gpu_groups().is_empty());
            assert_eq!(job.deferred_groups(), vec![gpus.clone()]);
            assert_eq!(std::fs::read(&done.profile_path).unwrap(), profile);
            assert_eq!(std::fs::read(&record_path).unwrap(), record);
            cli = serve.with_file_name("ginfer");
        }
        job.start_scoped(
            HardwareProfileAction::Ensure,
            Some(cli),
            gpus.clone(),
            intent.clone(),
        )
        .unwrap();
        let done = observed(&job, |view| view.status == "completed").await;
        assert_ne!(done.job_id, previous_job_id);
        assert!(job.artifact_is_accepted(&gpus, &intent));
    }
    #[tokio::test]
    async fn hardware_profile_background_completion_is_reaped_before_selected_ensure() {
        let (directory, host, arguments) = fixture().await;
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let gpus = vec!["GPU-fixture".into()];
        let cli = directory.path().join("ginfer");
        job.start_remaining_formats(Some(cli.clone()), gpus.clone())
            .unwrap();
        begun(&arguments).await;
        let running = job.status(None);
        assert_eq!(running.scope, "complete_remaining_formats");
        assert!(running.pid.is_some());
        let first_args = std::fs::read_to_string(&arguments).unwrap();
        assert!(first_args
            .lines()
            .any(|arg| arg == "--complete-remaining-formats"));
        assert!(!first_args.lines().any(|arg| arg == "--model"));
        let background_output = PathBuf::from(first_args.lines().nth(2).unwrap());
        observed(&job, |view| view.checkpoint_available).await;
        assert!(checkpoint(&background_output).is_file());
        let intent = selected_intent(directory.path());
        assert!(job
            .start_scoped(
                HardwareProfileAction::Ensure,
                Some(cli.clone()),
                gpus.clone(),
                intent.clone()
            )
            .unwrap_err()
            .contains("different artifact scope"));
        tokio::time::timeout(Duration::from_secs(2), job.cancel_background_and_wait())
            .await
            .unwrap()
            .unwrap();
        assert!(!job.busy());
        assert_eq!(job.status(None).status, "cancelled");
        assert!(checkpoint(&background_output).is_file());
        // Foreground work cancels/reaps idle completion, but does not make it
        // permanently unavailable to a later idle interval.
        job.start_remaining_formats(Some(cli.clone()), gpus.clone())
            .unwrap();
        let retried = job.status(None);
        assert_ne!(retried.job_id, running.job_id);
        assert!(job.busy());
        job.cancel_background_and_wait().await.unwrap();
        assert!(!job.busy());
        scoped_cli(directory.path(), &arguments, &selected_result(&intent));
        job.start_scoped(
            HardwareProfileAction::Ensure,
            Some(cli.clone()),
            gpus.clone(),
            intent.clone(),
        )
        .unwrap();
        let selected = observed(&job, |view| view.status == "completed").await;
        assert_ne!(running.job_id, selected.job_id);
        assert!(job.artifact_is_accepted(&gpus, &intent));
        assert_eq!(job.deferred_groups(), vec![gpus.clone()]);
        let selected_args = std::fs::read_to_string(&arguments).unwrap();
        assert_ne!(selected_args.lines().nth(2), background_output.to_str());

        let mut complete = selected_result(&intent);
        complete["mode"] = serde_json::json!("complete_remaining_formats");
        complete["scope"] = serde_json::json!("all_formats");
        complete["all_formats_complete"] = serde_json::json!(true);
        complete["artifact"] = serde_json::Value::Null;
        scoped_cli(directory.path(), &arguments, &complete);
        job.start_remaining_formats(Some(cli), gpus.clone())
            .unwrap();
        let done = observed(&job, |view| view.status == "completed").await;
        assert_ne!(selected.job_id, done.job_id);
        assert_eq!(done.scope, "complete_remaining_formats");
        assert_eq!(done.all_formats_complete, Some(true));
        assert_eq!(done.expected_duration_ms, None);
        assert!(job.artifact_is_accepted(&gpus, &intent));
        assert!(job.deferred_groups().is_empty());
        let record: Record = serde_json::from_slice(
            &std::fs::read(directory.path().join("host/hardware-profile-job.json")).unwrap(),
        )
        .unwrap();
        assert!(record.accepted_durations.is_empty());
    }
    #[tokio::test]
    async fn hardware_profile_explicit_cancel_parks_idle_completion_until_resume() {
        let (directory, host, arguments) = fixture().await;
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let gpus = vec!["GPU-fixture".into()];
        let cli = directory.path().join("ginfer");
        let blocking_cli = std::fs::read(&cli).unwrap();
        let intent = selected_intent(directory.path());
        scoped_cli(directory.path(), &arguments, &selected_result(&intent));
        job.start_scoped(
            HardwareProfileAction::Ensure,
            Some(cli.clone()),
            gpus.clone(),
            intent.clone(),
        )
        .unwrap();
        let selected = observed(&job, |view| view.status == "completed").await;
        let canonical = std::fs::read(&selected.profile_path).unwrap();
        host.data.lock().await.first_run.complete = true;
        assert!(!host.first_run_pending().await);
        std::fs::write(&cli, blocking_cli).unwrap();
        std::fs::remove_file(&arguments).unwrap();
        host.idle_maintenance().await.unwrap();
        begun(&arguments).await;
        let running = observed(&job, |view| view.checkpoint_available).await;
        assert_eq!(running.scope, "complete_remaining_formats");
        assert!(running.pid.is_some());
        let background_args = std::fs::read_to_string(&arguments).unwrap();
        let output = PathBuf::from(background_args.lines().nth(2).unwrap());
        let saved_checkpoint = std::fs::read(checkpoint(&output)).unwrap();

        let cancelled = request(&host, HardwareProfileAction::Cancel).await.unwrap();
        assert_eq!(cancelled["status"], "cancelled");
        assert_eq!(cancelled["job_id"], serde_json::json!(running.job_id));
        assert!(cancelled["finished_unix_ms"].is_number());
        assert!(!job.busy());
        #[cfg(target_os = "linux")]
        assert!(!Path::new("/proc")
            .join(running.pid.unwrap().to_string())
            .exists());
        assert!(job.artifact_is_accepted(&gpus, &intent));
        assert!(job.deferred_groups().is_empty());
        for _ in 0..2 {
            host.idle_maintenance().await.unwrap();
            assert!(!job.busy());
            assert_eq!(job.status(None).job_id, running.job_id);
        }
        assert_eq!(std::fs::read_to_string(&arguments).unwrap(), background_args);
        assert_eq!(std::fs::read(checkpoint(&output)).unwrap(), saved_checkpoint);
        assert_eq!(std::fs::read(&selected.profile_path).unwrap(), canonical);
        let reopened =
            HardwareProfiles::open(directory.path().join("host"), Arc::new(AtomicU64::new(0)))
                .unwrap();
        assert_eq!(reopened.status(None).status, "cancelled");
        assert!(reopened.deferred_groups().is_empty());
        assert!(!reopened.artifact_is_accepted(&gpus, &intent));
        reopened
            .start_remaining_formats(Some(cli.clone()), gpus.clone())
            .unwrap();
        assert!(!reopened.busy());
        assert_eq!(reopened.status(None).job_id, running.job_id);

        let mut complete = selected_result(&intent);
        complete["mode"] = serde_json::json!("complete_remaining_formats");
        complete["scope"] = serde_json::json!("all_formats");
        complete["all_formats_complete"] = serde_json::json!(true);
        complete["artifact"] = serde_json::Value::Null;
        scoped_cli(directory.path(), &arguments, &complete);
        request(&host, HardwareProfileAction::Resume).await.unwrap();
        let resumed = observed(&job, |view| view.status == "completed").await;
        assert_ne!(resumed.job_id, running.job_id);
        assert_eq!(resumed.all_formats_complete, Some(true));
        assert!(job.artifact_is_accepted(&gpus, &intent));
        assert!(job.deferred_groups().is_empty());
        let resumed_args = std::fs::read_to_string(&arguments).unwrap();
        assert_eq!(resumed_args.lines().nth(2), output.to_str());
        assert_eq!(std::fs::read(checkpoint(&output)).unwrap(), saved_checkpoint);
    }
    #[tokio::test]
    async fn hardware_profile_selected_ensure_retries_explicitly_cancelled_completion() {
        let (directory, host, arguments) = fixture().await;
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let gpus = vec!["GPU-fixture".into()];
        let cli = directory.path().join("ginfer");
        let blocking_cli = std::fs::read(&cli).unwrap();
        let intent = selected_intent(directory.path());
        scoped_cli(directory.path(), &arguments, &selected_result(&intent));
        job.start_scoped(
            HardwareProfileAction::Ensure,
            Some(cli.clone()),
            gpus.clone(),
            intent.clone(),
        )
        .unwrap();
        observed(&job, |view| view.status == "completed").await;
        std::fs::write(&cli, blocking_cli).unwrap();
        std::fs::remove_file(&arguments).unwrap();
        job.start_remaining_formats(Some(cli.clone()), gpus.clone())
            .unwrap();
        begun(&arguments).await;
        let background = job.status(None);
        request(&host, HardwareProfileAction::Cancel).await.unwrap();
        assert!(!job.busy());
        assert!(job.deferred_groups().is_empty());

        let mut next_intent = intent.clone();
        next_intent.draft_tokens = Some(4);
        let mut next_result = selected_result(&next_intent);
        next_result["artifact"]["draft_tokens"] = serde_json::json!(4);
        scoped_cli(directory.path(), &arguments, &next_result);
        job.start_scoped(
            HardwareProfileAction::Ensure,
            Some(cli),
            gpus.clone(),
            next_intent.clone(),
        )
        .unwrap();
        let selected = observed(&job, |view| view.status == "completed").await;
        assert_ne!(selected.job_id, background.job_id);
        assert_eq!(selected.scope, "artifact");
        assert_eq!(selected.selected_artifact, Some(next_intent.clone()));
        assert!(job.artifact_is_accepted(&gpus, &next_intent));
        assert_eq!(job.deferred_groups(), vec![gpus]);
    }
    #[tokio::test]
    async fn hardware_profile_failed_completion_requires_explicit_retry() {
        let (directory, host, arguments) = fixture().await;
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let gpus = vec!["GPU-fixture".into()];
        let cli = directory.path().join("ginfer");
        let intent = selected_intent(directory.path());
        scoped_cli(directory.path(), &arguments, &selected_result(&intent));
        job.start_scoped(
            HardwareProfileAction::Ensure,
            Some(cli.clone()),
            gpus.clone(),
            intent.clone(),
        )
        .unwrap();
        observed(&job, |view| view.status == "completed").await;
        assert_eq!(job.deferred_groups(), vec![gpus.clone()]);

        let mut complete = selected_result(&intent);
        complete["mode"] = serde_json::json!("complete_remaining_formats");
        complete["scope"] = serde_json::json!("all_formats");
        complete["artifact"] = serde_json::Value::Null;
        // A zero exit with incomplete signed JSON still fails closed.
        scoped_cli(directory.path(), &arguments, &complete);
        job.start_remaining_formats(Some(cli.clone()), gpus.clone())
            .unwrap();
        let failed = observed(&job, |view| view.status == "failed").await;
        assert!(job.deferred_groups().is_empty());
        job.start_remaining_formats(Some(cli.clone()), gpus.clone())
            .unwrap();
        assert_eq!(job.status(None).job_id, failed.job_id);
        assert!(!job.busy());
        let reopened =
            HardwareProfiles::open(directory.path().join("host"), Arc::new(AtomicU64::new(0)))
                .unwrap();
        assert!(reopened.deferred_groups().is_empty());
        assert!(!reopened.artifact_is_accepted(&gpus, &intent));

        complete["all_formats_complete"] = serde_json::json!(true);
        scoped_cli(directory.path(), &arguments, &complete);
        job.start(HardwareProfileAction::Resume, Some(cli), gpus.clone())
            .unwrap();
        let resumed = observed(&job, |view| view.status == "completed").await;
        assert_ne!(resumed.job_id, failed.job_id);
        assert_eq!(resumed.all_formats_complete, Some(true));
        assert!(job.deferred_groups().is_empty());
    }
    #[tokio::test]
    async fn hardware_profile_cold_ensure_reports_completed_phases_and_records_measured_history() {
        let (directory, host, _) = fixture().await;
        let cli = directory.path().join("ginfer");
        let core = directory.path().join("core");
        let finish = directory.path().join("finish");
        std::fs::write(&cli, format!("#!/bin/sh\nprintf '%s\\n' 'GPU expert install gpu=GPU-fixture format=q2g64 grid=T1..64'\nprintf '%s' 'CPU expert calibration node=0 format=q2g64 phase=co'\nwhile [ ! -f '{}' ]; do /bin/sleep 0.01; done\nprintf '%s\\n' 're rows=12 phase_seconds=0.125'\nwhile [ ! -f '{}' ]; do /bin/sleep 0.01; done\nprintf '%s' '{{\"schema_version\":2,\"accepted\":\"measured\"}}' > \"$3\"\nprintf '%s\\n' 'Hardware profile: completed'\n", core.display(), finish.display())).unwrap();
        request(&host, HardwareProfileAction::Ensure).await.unwrap();
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let gpu = observed(&job, |view| view.phase.as_deref() == Some("gpu_experts")).await;
        assert!(gpu
            .phase_detail
            .unwrap()
            .contains("Measuring GPU expert grid for q2g64"));
        assert_eq!(gpu.expected_duration_ms, None);
        assert_eq!(gpu.duration_source, None);
        let (before, revision) = job.observation(None);
        tokio::time::sleep(Duration::from_millis(10)).await;
        let (after, after_revision) = job.observation(None);
        assert_eq!(before, after);
        assert_eq!(revision, after_revision);
        std::fs::write(&core, b"release").unwrap();
        let cpu = observed(&job, |view| view.phase.as_deref() == Some("cpu_experts")).await;
        assert_eq!(
            cpu.phase_detail.as_deref(),
            Some("Completed core grid for q2g64 on NUMA node 0")
        );
        assert!(cpu.elapsed_ms.unwrap() >= 10);
        std::fs::write(&finish, b"release").unwrap();
        let done = observed(&job, |view| view.status == "completed").await;
        assert_eq!(done.remaining_ms, None);
        let record: Record = serde_json::from_slice(
            &std::fs::read(directory.path().join("host/hardware-profile-job.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            record
                .accepted_durations
                .get(&group_key(&["GPU-fixture".into()])),
            done.elapsed_ms.as_ref()
        );
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(
                &std::fs::read(directory.path().join("hardware.json")).unwrap()
            )
            .unwrap()["accepted"],
            "measured"
        );
    }
    #[tokio::test]
    async fn hardware_profile_seeded_runs_and_resume_do_not_replace_full_run_history() {
        let (directory, host, _) = fixture().await;
        let cli = directory.path().join("ginfer");
        let accepted = directory.path().join("hardware.json");
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let script = "#!/bin/sh\nprintf '%s\\n' 'CPU expert calibration node=0 format=q2g64 phase=node rows=4 phase_seconds=0.001'\nprintf '%s' '{\"schema_version\":2}' > \"$3\"\n";
        std::fs::write(&cli, script).unwrap();
        request(&host, HardwareProfileAction::Ensure).await.unwrap();
        observed(&job, |view| view.status == "completed").await;
        let history = job.state.lock().unwrap().record.accepted_durations.clone();
        assert_eq!(history.len(), 1);
        for action in [
            HardwareProfileAction::Ensure,
            HardwareProfileAction::Refresh,
        ] {
            let started = request(&host, action).await.unwrap();
            assert!(started["expected_duration_ms"].is_null());
            assert!(started["duration_source"].is_null());
            observed(&job, |view| view.status == "completed").await;
            assert_eq!(job.state.lock().unwrap().record.accepted_durations, history);
        }
        // A resumed private workspace is partial even when no canonical seed exists.
        std::fs::remove_file(&accepted).unwrap();
        std::fs::write(
            &cli,
            "#!/bin/sh\nprintf retained > \"$3.install-state.json\"\nexec /bin/sleep 600\n",
        )
        .unwrap();
        request(&host, HardwareProfileAction::Refresh)
            .await
            .unwrap();
        observed(&job, |view| view.checkpoint_available).await;
        job.shutdown().await.unwrap();
        std::fs::write(&cli, script).unwrap();
        let resumed = request(&host, HardwareProfileAction::Resume).await.unwrap();
        assert!(resumed["expected_duration_ms"].is_null());
        assert!(resumed["duration_source"].is_null());
        observed(&job, |view| view.status == "completed").await;
        assert_eq!(job.state.lock().unwrap().record.accepted_durations, history);
    }
    #[tokio::test]
    async fn hardware_profile_full_history_is_qualified_and_overrun_is_not_zero_remaining() {
        let (directory, host, _) = fixture().await;
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let cli = directory.path().join("ginfer");
        let accepted = directory.path().join("hardware.json");
        // Successful output without measured CPU diagnostics is not a full-run timing.
        std::fs::write(
            &cli,
            "#!/bin/sh\nprintf '%s' '{\"schema_version\":2}' > \"$3\"\n",
        )
        .unwrap();
        request(&host, HardwareProfileAction::Ensure).await.unwrap();
        observed(&job, |view| view.status == "completed").await;
        assert!(job
            .state
            .lock()
            .unwrap()
            .record
            .accepted_durations
            .is_empty());
        std::fs::remove_file(&accepted).unwrap();
        std::fs::write(&cli, "#!/bin/sh\n/bin/sleep 0.02\nprintf '%s\\n' 'CPU expert calibration node=0 format=q2g64 phase=core rows=4 phase_seconds=0.02'\nprintf '%s' '{\"schema_version\":2}' > \"$3\"\n").unwrap();
        request(&host, HardwareProfileAction::Ensure).await.unwrap();
        let measured = observed(&job, |view| view.status == "completed").await;
        let duration = measured.elapsed_ms.unwrap();
        assert!(duration >= 20);
        std::fs::remove_file(&accepted).unwrap();
        let sample = directory.path().join("sample");
        let release = directory.path().join("release");
        std::fs::write(&cli, format!("#!/bin/sh\nprintf '%s\\n' 'GPU expert install gpu=GPU-fixture format=q2g64 grid=T1..64'\nwhile [ ! -f '{}' ]; do /bin/sleep 0.01; done\nprintf '%s\\n' 'CPU expert calibration node=0 format=q2g64 phase=core rows=4 phase_seconds=0.02'\nwhile [ ! -f '{}' ]; do /bin/sleep 0.01; done\nprintf '%s' '{{\"schema_version\":2}}' > \"$3\"\n", sample.display(), release.display())).unwrap();
        request(&host, HardwareProfileAction::Refresh)
            .await
            .unwrap();
        let running = observed(&job, |view| view.phase.as_deref() == Some("gpu_experts")).await;
        assert_eq!(running.expected_duration_ms, Some(duration));
        assert_eq!(running.duration_source.as_deref(), Some("measured_history"));
        tokio::time::sleep(Duration::from_millis(duration + 10)).await;
        std::fs::write(&sample, b"sample").unwrap();
        let overdue = observed(&job, |view| view.phase.as_deref() == Some("cpu_experts")).await;
        assert!(overdue.elapsed_ms.unwrap() > duration);
        assert_eq!(overdue.status, "running");
        assert_eq!(overdue.remaining_ms, None);
        std::fs::write(&release, b"release").unwrap();
        let refreshed = observed(&job, |view| view.status == "completed").await;
        assert_eq!(
            job.state
                .lock()
                .unwrap()
                .record
                .accepted_durations
                .get(&group_key(&["GPU-fixture".into()]))
                .copied(),
            refreshed.elapsed_ms
        );
    }
    #[tokio::test]
    async fn hardware_profile_runtime_upgrade_revalidates_seed_and_resume_checkpoint() {
        for resume in [false, true] {
            let (directory, host, old_arguments) = fixture().await;
            let job = host
                .processes
                .lock()
                .await
                .hardware_profile
                .clone()
                .unwrap();
            let gpus = vec!["GPU-fixture".to_owned()];
            let old_cli = directory.path().join("ginfer");
            let accepted = directory.path().join("hardware.json");
            let prior = br#"{"schema_version":2,"accepted":"prior"}"#;
            std::fs::write(&accepted, prior).unwrap();
            let retained_output = if resume {
                request(&host, HardwareProfileAction::Refresh)
                    .await
                    .unwrap();
                begun(&old_arguments).await;
                job.shutdown().await.unwrap();
                Some(
                    job.state
                        .lock()
                        .unwrap()
                        .record
                        .output_path
                        .clone()
                        .unwrap(),
                )
            } else {
                None
            };
            std::fs::remove_file(&old_cli).unwrap();
            assert_eq!(job.configured_groups().unwrap(), vec![gpus.clone()]);
            let runtime = directory.path().join("updated-runtime");
            std::fs::create_dir(&runtime).unwrap();
            let current_cli = runtime.join("ginfer");
            let arguments = directory.path().join("updated-arguments");
            let release = directory.path().join("updated-release");
            let checkpoint_check = if resume {
                "[ \"$(/bin/cat \"$3.install-state.json\")\" = retained ] || exit 21\n"
            } else {
                ""
            };
            std::fs::write(&current_cli, format!("#!/bin/sh\n/bin/grep -Fq '\"accepted\":\"prior\"' \"$3\" || exit 20\n{checkpoint_check}printf '%s\\n' \"$@\" > '{}'\nwhile [ ! -f '{}' ]; do /bin/sleep 0.01; done\nprintf '%s' '{{\"schema_version\":2,\"accepted\":\"new-runtime\"}}' > \"$3\"\n", arguments.display(), release.display())).unwrap();
            std::fs::set_permissions(&current_cli, std::fs::Permissions::from_mode(0o700)).unwrap();
            let configuration = job.configuration(Some(current_cli.clone()), &gpus).unwrap();
            assert_eq!(configuration.profile_path, accepted);
            assert_eq!(configuration.engine, current_cli);
            job.start(
                if resume {
                    HardwareProfileAction::Resume
                } else {
                    HardwareProfileAction::Ensure
                },
                Some(current_cli.clone()),
                gpus,
            )
            .unwrap();
            begun(&arguments).await;
            let running = job.status(Some(current_cli.clone()));
            assert_eq!(running.engine_path.as_ref(), Some(&current_cli));
            assert!(running.available);
            assert_eq!(running.expected_duration_ms, None);
            assert_eq!(std::fs::read(&accepted).unwrap(), prior);
            let args = std::fs::read_to_string(&arguments).unwrap();
            let output = PathBuf::from(args.lines().nth(2).unwrap());
            assert_ne!(output, accepted);
            if let Some(retained) = retained_output {
                assert_eq!(output, retained);
                assert_eq!(std::fs::read(checkpoint(&output)).unwrap(), b"retained");
                assert!(args.lines().any(|argument| argument == "--reprofile"));
            }
            std::fs::write(&release, b"release").unwrap();
            observed(&job, |view| view.status == "completed").await;
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&std::fs::read(&accepted).unwrap())
                    .unwrap()["accepted"],
                "new-runtime"
            );
            let persisted = job
                .configuration(Some(current_cli.clone()), &["GPU-fixture".into()])
                .unwrap();
            assert_eq!(persisted.engine, current_cli);
            assert!(job
                .state
                .lock()
                .unwrap()
                .record
                .accepted_durations
                .is_empty());
        }
    }
    #[tokio::test]
    async fn hardware_profile_new_runtime_rejection_preserves_accepted_seed() {
        let (directory, host, _) = fixture().await;
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let accepted = directory.path().join("hardware.json");
        let prior = br#"{"schema_version":2,"accepted":"prior"}"#;
        std::fs::write(&accepted, prior).unwrap();
        std::fs::remove_file(directory.path().join("ginfer")).unwrap();
        let current_cli = directory.path().join("new-ginfer");
        std::fs::write(&current_cli, "#!/bin/sh\n/bin/grep -Fq '\"accepted\":\"prior\"' \"$3\" || exit 20\nprintf '%s\\n' 'native fingerprint rejected' >&2\nexit 9\n").unwrap();
        std::fs::set_permissions(&current_cli, std::fs::Permissions::from_mode(0o700)).unwrap();
        job.start(
            HardwareProfileAction::Ensure,
            Some(current_cli.clone()),
            vec!["GPU-fixture".into()],
        )
        .unwrap();
        let failed = observed(&job, |view| view.status == "failed").await;
        assert!(failed.error.unwrap().contains("exited"));
        assert!(failed
            .diagnostic_tail
            .contains("native fingerprint rejected"));
        assert_eq!(std::fs::read(accepted).unwrap(), prior);
        assert!(job
            .state
            .lock()
            .unwrap()
            .record
            .accepted_durations
            .is_empty());
    }
    #[test]
    fn hardware_profile_legacy_durations_are_not_full_run_history() {
        let directory = tempfile::tempdir().unwrap();
        let revision = Arc::new(AtomicU64::new(0));
        let job = HardwareProfiles::open(directory.path().to_owned(), revision.clone()).unwrap();
        let mut legacy = serde_json::to_value(&job.state.lock().unwrap().record).unwrap();
        let key = group_key(&["GPU-fixture".into()]);
        legacy["accepted_durations"][key.as_str()] = serde_json::json!(7);
        legacy
            .as_object_mut()
            .unwrap()
            .remove("duration_history_valid");
        legacy.as_object_mut().unwrap().remove("measured_work");
        for field in [
            "phase",
            "phase_detail",
            "elapsed_ms",
            "expected_duration_ms",
            "remaining_ms",
            "duration_source",
        ] {
            legacy["view"].as_object_mut().unwrap().remove(field);
        }
        std::fs::write(
            directory.path().join("hardware-profile-job.json"),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();
        let reopened = HardwareProfiles::open(directory.path().to_owned(), revision).unwrap();
        assert!(reopened
            .state
            .lock()
            .unwrap()
            .record
            .accepted_durations
            .is_empty());
        let view = reopened.status(None);
        assert_eq!(view.expected_duration_ms, None);
        assert_eq!(view.duration_source, None);
        assert_eq!(view.elapsed_ms, None);
    }
    #[tokio::test]
    async fn hardware_profile_route_cancellation_reaps_only_its_job_and_retains_pending_work() {
        let (directory, host, arguments) = fixture().await;
        request(&host, HardwareProfileAction::Refresh)
            .await
            .unwrap();
        begun(&arguments).await;
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let running = observed(&job, |view| view.checkpoint_available).await;
        let job_id = running.job_id.unwrap();
        let pending = Configuration {
            gpu_uuids: vec!["GPU-second".into()],
            engine: directory.path().join("ginfer"),
            profile_path: directory.path().join("second-hardware.json"),
        };
        {
            let mut state = job.state.lock().unwrap();
            state.record.pending.push(pending.clone());
            state.record.view.pending_gpu_groups = vec![pending.gpu_uuids.clone()];
        }
        let unrelated = Uuid::new_v4();
        assert!(!job.cancel_job(unrelated));
        job.cancel_job_and_wait(unrelated).await.unwrap();
        {
            let state = job.state.lock().unwrap();
            assert!(!*state.cancel.as_ref().unwrap().borrow());
            assert_eq!(state.record.view.status, "running");
        }
        assert!(job.cancel_job(job_id));
        tokio::time::timeout(Duration::from_secs(2), job.cancel_job_and_wait(job_id))
            .await
            .unwrap()
            .unwrap();
        assert!(!job.busy());
        let state = job.state.lock().unwrap();
        assert_eq!(state.record.view.status, "cancelled");
        assert!(state.record.pending == vec![pending.clone()]);
        assert_eq!(
            state.record.view.pending_gpu_groups,
            vec![pending.gpu_uuids]
        );
    }

    #[tokio::test]
    async fn hardware_profile_late_route_cancellation_does_not_cancel_a_resumed_job() {
        let (directory, host, arguments) = fixture().await;
        request(&host, HardwareProfileAction::Refresh)
            .await
            .unwrap();
        begun(&arguments).await;
        let job = host
            .processes
            .lock()
            .await
            .hardware_profile
            .clone()
            .unwrap();
        let first = observed(&job, |view| view.checkpoint_available).await;
        let first_id = first.job_id.unwrap();
        job.cancel_job_and_wait(first_id).await.unwrap();
        job.start(
            HardwareProfileAction::Resume,
            Some(directory.path().join("ginfer")),
            vec!["GPU-fixture".into()],
        )
        .unwrap();
        let resumed_id = job.status(None).job_id.unwrap();
        assert_ne!(first_id, resumed_id);
        assert!(!job.cancel_job(first_id));
        job.cancel_job_and_wait(first_id).await.unwrap();
        {
            let state = job.state.lock().unwrap();
            assert_eq!(state.record.view.job_id, Some(resumed_id));
            assert_eq!(state.record.view.status, "running");
            assert!(!*state.cancel.as_ref().unwrap().borrow());
        }
        tokio::time::timeout(Duration::from_secs(2), job.cancel_job_and_wait(resumed_id))
            .await
            .unwrap()
            .unwrap();
        assert!(!job.busy());
    }

    #[tokio::test]
    async fn hardware_profile_route_cancellation_propagates_only_its_reap_error() {
        let directory = tempfile::tempdir().unwrap();
        let job = HardwareProfiles::open(directory.path().to_owned(), Arc::new(AtomicU64::new(0)))
            .unwrap();
        let job_id = Uuid::new_v4();
        let (cancel, receiver) = watch::channel(false);
        {
            let mut state = job.state.lock().unwrap();
            state.record.view.job_id = Some(job_id);
            state.record.view.status = "running".into();
            state.cancel = Some(cancel);
            state.reap_error = Some("Cannot reap native profiler: fixture".into());
        }
        job.cancel_job_and_wait(Uuid::new_v4()).await.unwrap();
        assert!(!*receiver.borrow());
        assert_eq!(
            job.cancel_job_and_wait(job_id).await.unwrap_err(),
            "Cannot reap native profiler: fixture"
        );
        assert!(*receiver.borrow());
        assert!(job.busy());
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
    async fn hardware_profile_resume_revalidates_native_output_before_retrying_publication() {
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
        observed(&job, |view| view.status == "completed").await;
        job.shutdown().await.unwrap();
        assert!(settled.is_ok());
        assert_eq!(failed.status, "failed");
        assert!(resumed.is_ok());
        assert_eq!(std::fs::read(calls).unwrap(), b"invokedinvoked");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&std::fs::read(accepted).unwrap()).unwrap()
                ["accepted"],
            "new"
        );
    }
    #[tokio::test]
    async fn hardware_profile_publication_retry_revalidates_replaced_runtime_and_preserves_seed_on_rejection(
    ) {
        for same_path in [false, true] {
            let (directory, host, arguments) = fixture().await;
            let cli = directory.path().join("ginfer");
            let release = directory.path().join("release");
            let accepted = directory.path().join("hardware.json");
            let prior = br#"{"schema_version":2,"accepted":"prior"}"#;
            std::fs::write(&accepted, prior).unwrap();
            std::fs::write(&cli, format!("#!/bin/sh\nprintf begun > '{}'\nwhile [ ! -f '{}' ]; do /bin/sleep 0.01; done\nprintf '%s' '{{\"schema_version\":2,\"accepted\":\"old-runtime\"}}' > \"$3\"\n", arguments.display(), release.display())).unwrap();
            request(&host, HardwareProfileAction::Refresh)
                .await
                .unwrap();
            begun(&arguments).await;
            let job = host
                .processes
                .lock()
                .await
                .hardware_profile
                .clone()
                .unwrap();
            std::fs::remove_file(&accepted).unwrap();
            std::fs::create_dir(&accepted).unwrap();
            std::fs::write(&release, b"release").unwrap();
            observed(&job, |view| view.status == "failed").await;
            job.shutdown().await.unwrap();
            assert!(job.state.lock().unwrap().record.native_completed);
            std::fs::remove_dir(&accepted).unwrap();
            std::fs::write(&accepted, prior).unwrap();
            let current = if same_path {
                cli
            } else {
                std::fs::remove_file(&cli).unwrap();
                let updated = directory.path().join("updated-runtime");
                std::fs::create_dir(&updated).unwrap();
                updated.join("ginfer")
            };
            let checked = directory.path().join("current-validated");
            std::fs::write(&current, format!("#!/bin/sh\n/bin/grep -q old-runtime \"$3\" || exit 8\nprintf rejected > '{}'\nexit 9\n", checked.display())).unwrap();
            std::fs::set_permissions(&current, std::fs::Permissions::from_mode(0o700)).unwrap();
            job.start(
                HardwareProfileAction::Resume,
                Some(current.clone()),
                vec!["GPU-fixture".into()],
            )
            .unwrap();
            observed(&job, |view| view.status == "failed").await;
            job.shutdown().await.unwrap();
            assert_eq!(std::fs::read(&checked).unwrap(), b"rejected");
            assert_eq!(std::fs::read(&accepted).unwrap(), prior);
            assert!(!job.state.lock().unwrap().record.native_completed);
            std::fs::write(&current, format!("#!/bin/sh\n/bin/grep -q old-runtime \"$3\" || exit 8\nprintf checked > '{}'\nprintf '%s' '{{\"schema_version\":2,\"accepted\":\"current-runtime\"}}' > \"$3\"\n", checked.display())).unwrap();
            job.start(
                HardwareProfileAction::Resume,
                Some(current),
                vec!["GPU-fixture".into()],
            )
            .unwrap();
            observed(&job, |view| view.status == "completed").await;
            job.shutdown().await.unwrap();
            assert_eq!(std::fs::read(checked).unwrap(), b"checked");
            let published: serde_json::Value =
                serde_json::from_slice(&std::fs::read(accepted).unwrap()).unwrap();
            assert_eq!(published["accepted"], "current-runtime");
        }
    }
    #[tokio::test]
    async fn hardware_profile_native_fingerprint_rejection_marks_only_launched_group_stale() {
        let (directory, host, _) = fixture().await;
        let profile = directory.path().join("hardware.json");
        std::fs::write(&profile, br#"{"schema_version":2}"#).unwrap();
        let serve = directory.path().join("ginfer-serve");
        std::fs::write(&serve,"#!/bin/sh\nprintf '%s\n' \"hardware profile does not match selected startup hardware: $3; selected GPU inventory changed; run ginfer profile-hardware --reprofile to update the installed profile\" >&2\nexit 1\n").unwrap();
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
    async fn hardware_profile_scan_defers_until_explicit_ensure_queues_saved_groups() {
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
        assert!(response.status().is_success());
        let scanned = job.status(None);
        assert_eq!(scanned.status, "idle");
        assert!(!job.busy());
        assert!(scanned.pending_gpu_groups.is_empty());
        assert!(!directory.path().join("GPU-fixture.begun").exists());
        assert!(!directory.path().join("GPU-second.begun").exists());
        let response = host
            .clone()
            .route(
                Request::builder()
                    .method("POST")
                    .uri("/host/v1/hardware-profile")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::from(
                        serde_json::to_vec(&HardwareProfileRequest {
                            action: HardwareProfileAction::Ensure,
                            gpu_uuids: None,
                        })
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
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
pub(crate) fn bind_parent_death(command: &mut Command) {
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
