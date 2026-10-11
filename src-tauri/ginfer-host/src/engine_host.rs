//! Host-owned inference processes. The service observes exits and readiness;
//! only processes spawned here can be stopped here.

use super::engine_registry::InstanceStatus;
use std::sync::{Arc, Mutex};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    path::PathBuf,
    time::Duration,
};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};
use uuid::Uuid;

pub fn validate_runtimes(runtimes: &BTreeMap<String, PathBuf>) -> Result<(), String> {
    for (architecture, path) in runtimes {
        if !matches!(architecture.as_str(), "8.0" | "8.6" | "8.9" | "12.0") {
            return Err(format!(
                "Unsupported runtime compute capability: {architecture}"
            ));
        }
        if !path.is_absolute() || !path.is_file() {
            return Err(format!(
                "Runtime for {architecture} must be an existing absolute executable path"
            ));
        }
    }
    Ok(())
}

const DIAGNOSTIC_TAIL_BYTES: usize = 16_384;
type Diagnostics = Arc<Mutex<VecDeque<u8>>>;

#[derive(Default)]
struct OutputReaders(Vec<Option<tokio::task::JoinHandle<()>>>);
impl Drop for OutputReaders {
    fn drop(&mut self) {
        for reader in self.0.iter().flatten() {
            reader.abort();
        }
    }
}

struct PendingExit {
    exit: std::process::ExitStatus,
    diagnostics: Diagnostics,
    readers: tokio::sync::Mutex<OutputReaders>,
}

pub(crate) struct ProcessObservations {
    pub readiness: Vec<StartupProbe>,
    pub exits: Vec<ExitDrain>,
}

pub(crate) struct ExitDrain {
    instance_id: Uuid,
    session_id: Uuid,
    pending: Arc<PendingExit>,
}

pub(crate) struct ExitObservation {
    instance_id: Uuid,
    session_id: Uuid,
    last_error: String,
}

impl ExitDrain {
    pub(crate) async fn observe(self) -> ExitObservation {
        let mut readers = self.pending.readers.lock().await;
        // Each reader retains its full sequential deadline outside the process lock.
        for slot in &mut readers.0 {
            if let Some(reader) = slot {
                if tokio::time::timeout(Duration::from_secs(1), &mut *reader).await.is_err() {
                    reader.abort();
                }
                *slot = None;
            }
        }
        let mut tail = self
            .pending
            .diagnostics
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let detail = String::from_utf8_lossy(tail.make_contiguous());
        ExitObservation {
            instance_id: self.instance_id,
            session_id: self.session_id,
            last_error: format!(
                "engine exited unexpectedly: {}\n{}",
                self.pending.exit,
                detail.trim()
            ),
        }
    }
}

fn capture_output(
    reader: impl AsyncRead + Unpin + Send + 'static,
    diagnostics: Diagnostics,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut reader = reader;
        let mut chunk = [0u8; 4096];
        while let Ok(count) = reader.read(&mut chunk).await {
            if count == 0 {
                break;
            }
            eprint!("{}", String::from_utf8_lossy(&chunk[..count]));
            let mut tail = diagnostics.lock().unwrap_or_else(|e| e.into_inner());
            let excess = (tail.len() + count).saturating_sub(DIAGNOSTIC_TAIL_BYTES);
            tail.drain(..excess);
            tail.extend(chunk[..count].iter().copied());
        }
    })
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct LaunchOptions {
    pub vision: bool,
    pub spec: String,
    pub draft_policy: String,
    pub draft_tokens: u32,
    pub draft_tp: u32,
    pub kv_dtype: String,
    pub kv_arena_bytes: Option<u64>,
    pub kv_arena_headroom_bytes: u64,
    pub host_kv_cache_bytes: u64,
    pub prefill_chunk: u32,
    pub no_cuda_graph: bool,
}
impl Default for LaunchOptions {
    fn default() -> Self {
        Self {
            vision: true,
            spec: "auto".into(),
            draft_policy: "auto".into(),
            draft_tokens: 0,
            draft_tp: 0,
            kv_dtype: "auto".into(),
            kv_arena_bytes: None,
            kv_arena_headroom_bytes: crate::launch_profiles::HEADROOM_BYTES,
            host_kv_cache_bytes: 0,
            prefill_chunk: 0,
            no_cuda_graph: false,
        }
    }
}
impl LaunchOptions {
    pub fn validate(&self, tp: u32) -> Result<(), String> {
        if !matches!(self.spec.as_str(), "auto" | "none" | "dflash" | "mtp") {
            return Err("spec must be auto, none, dflash, or mtp".into());
        }
        if !matches!(self.draft_policy.as_str(), "auto" | "fixed" | "adaptive") {
            return Err("draft policy must be auto, fixed, or adaptive".into());
        }
        if !matches!(self.kv_dtype.as_str(), "auto" | "bf16" | "int8" | "nvfp4") {
            return Err("unsupported KV dtype".into());
        }
        if !matches!(self.draft_tp, 0 | 1 | 2 | 4) || self.draft_tp > tp {
            return Err("draft TP must be auto or a subgroup of target TP".into());
        }
        if self.spec == "dflash" && self.draft_tokens > 15 {
            return Err("draft token count exceeds supported target maximum".into());
        }
        if self.spec == "mtp" && (self.draft_tokens == 0 || self.draft_tokens == u32::MAX) {
            return Err("MTP requires positive draft tokens with a represented K+1 width".into());
        }
        if self.draft_tokens != 0 && !matches!(self.spec.as_str(), "dflash" | "mtp") {
            return Err("explicit draft tokens require spec dflash or mtp".into());
        }
        if self.draft_policy == "adaptive"
            && (matches!(self.spec.as_str(), "none" | "mtp")
                || (self.spec == "dflash" && self.draft_tokens != 15))
        {
            return Err(
                "adaptive draft policy requires automatic DFlash or explicit DFlash width 15"
                    .into(),
            );
        }
        if self.prefill_chunk != 0 && !self.prefill_chunk.is_multiple_of(128) {
            return Err("prefill chunk must be a multiple of 128, or automatic".into());
        }
        if self.spec == "none" && self.draft_tp != 0 {
            return Err("draft settings require speculative decoding".into());
        }
        if self.kv_arena_bytes == Some(0) {
            return Err("KV arena must be positive or automatic".into());
        }
        Ok(())
    }
    /// Host admission cannot replace Engine payload and device validation.
    pub fn validate_target(
        &self,
        identity: &crate::engine_inventory::ArtifactIdentity,
        tp: u32,
        draft_tp: u32,
    ) -> Result<u32, String> {
        self.validate(tp)?;
        if self.draft_tp != 0 && self.draft_tp != draft_tp {
            return Err("draft TP must match the producer-final artifact".into());
        }
        let maximum = match identity.model_id.as_str() {
            "qwen3.8-flash-next" => {
                if !matches!(
                    identity.weights_id.as_str(),
                    "groupwise-int" | "smol-q2g64" | "nvfp4"
                ) {
                    return Err("Flash has no registered weights class for this artifact".into());
                }
                if draft_tp != 0 {
                    return Err(
                        "Flash MTP uses the target TP group, not a separate draft TP group".into(),
                    );
                }
                if self.spec == "dflash" || self.draft_policy == "adaptive" {
                    return Err("Flash supports MTP or none with auto or fixed draft policy".into());
                }
                262144
            }
            "qwen3.8-27b" | "muse-glimmer-30b" => {
                if self.spec == "mtp" {
                    return Err("MTP is supported only by the Flash target".into());
                }
                if self.spec == "dflash" && draft_tp == 0 {
                    return Err("artifact has no DFlash body".into());
                }
                if identity.model_id == "qwen3.8-27b" {
                    if self.draft_tokens > 7 {
                        return Err("Qwen 27B supports at most 7 draft tokens".into());
                    }
                    if self.draft_policy == "adaptive" {
                        return Err("Qwen 27B supports auto or fixed draft policy".into());
                    }
                    262144
                } else {
                    131072
                }
            }
            _ => return Err("model is not a registered host launch target".into()),
        };
        Ok(maximum)
    }
    fn args(&self) -> Vec<String> {
        let mut args = vec![
            "--spec".into(),
            self.spec.clone(),
            "--draft-policy".into(),
            self.draft_policy.clone(),
            "--kv-arena-headroom-bytes".into(),
            self.kv_arena_headroom_bytes.to_string(),
        ];
        if self.vision {
            args.push("--vision".into());
        }
        if self.kv_dtype != "auto" {
            args.extend(["--kv-dtype".into(), self.kv_dtype.clone()]);
        }
        for (name, value) in [
            ("--draft-tokens", self.draft_tokens as u64),
            ("--draft-tp", self.draft_tp as u64),
            ("--prefill-chunk", self.prefill_chunk as u64),
            ("--host-kv-cache-bytes", self.host_kv_cache_bytes),
        ] {
            if value > 0 {
                args.extend([name.into(), value.to_string()]);
            }
        }
        if let Some(bytes) = self.kv_arena_bytes {
            args.extend(["--kv-arena-bytes".into(), bytes.to_string()]);
        }
        if self.no_cuda_graph {
            args.push("--no-cuda-graph".into());
        }
        args
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EngineLaunch {
    pub instance_id: Uuid,
    pub artifact: PathBuf,
    #[serde(skip)]
    pub artifact_dependencies: Vec<PathBuf>,
    pub artifact_set: bool,
    pub model_id: String,
    /// Full physical UUIDs obtained from the host GPU inventory.
    pub gpu_uuids: Vec<String>,
    pub tp: u32,
    pub port: u16,
    pub max_context: u32,
    pub concurrency: u32,
    #[serde(flatten)]
    pub options: LaunchOptions,
}

pub struct ManagedInstance {
    pub instance_id: Uuid,
    pub session_id: Uuid,
    pub status: InstanceStatus,
    pub last_error: Option<String>,
    /// Confirmed engine metadata, unavailable until readiness validation passes.
    pub model_metadata: Option<serde_json::Value>,
    pub launch: EngineLaunch,
    pub(crate) profile_persisted: bool,
    child: Option<Child>,
    api_key: String,
    started: tokio::time::Instant,
    diagnostics: Diagnostics,
    output_readers: OutputReaders,
    pending_exit: Option<Arc<PendingExit>>,
    hardware_profile_path: Option<PathBuf>,
}

pub struct HostProcesses {
    executable: PathBuf,
    known_gpus: BTreeSet<String>,
    runtimes: BTreeMap<String, PathBuf>,
    gpu_architectures: BTreeMap<String, String>,
    instances: BTreeMap<Uuid, ManagedInstance>,
    client: reqwest::Client,
    startup_timeout: Duration,
    activity: Arc<tokio::sync::Notify>,
    pub(crate) hardware_profile: Option<Arc<crate::hardware_profile::HardwareProfiles>>,
}

pub(crate) struct StartupProbe {
    instance_id: Uuid,
    session_id: Uuid,
    model_id: String,
    port: u16,
    api_key: String,
    client: reqwest::Client,
}

pub(crate) struct ReadyObservation {
    instance_id: Uuid,
    session_id: Uuid,
    metadata: serde_json::Value,
}

impl StartupProbe {
    pub(crate) async fn observe(self) -> Option<ReadyObservation> {
        let base = format!("http://127.0.0.1:{}", self.port);
        let health = self.client.get(format!("{base}/health")).send().await.ok()?;
        if !health.status().is_success() {
            return None;
        }
        let response = self.client.get(format!("{base}/v1/models"))
            .bearer_auth(&self.api_key).send().await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        let models = response.json::<serde_json::Value>().await.ok()?;
        let metadata = models.get("data")?.as_array()?.iter().find(|model| {
            model.get("id").and_then(|id| id.as_str()) == Some(self.model_id.as_str())
        })?.clone();
        Some(ReadyObservation {
            instance_id: self.instance_id,
            session_id: self.session_id,
            metadata,
        })
    }
}

impl HostProcesses {
    pub fn new(
        executable: PathBuf,
        gpu_uuids: BTreeSet<String>,
        startup_timeout: Duration,
    ) -> Result<Self, String> {
        if !executable.is_absolute() {
            return Err("engine executable must be an absolute file path".into());
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(1))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            executable,
            known_gpus: gpu_uuids,
            runtimes: BTreeMap::new(),
            gpu_architectures: BTreeMap::new(),
            instances: BTreeMap::new(),
            client,
            startup_timeout,
            activity: Arc::new(tokio::sync::Notify::new()),
            hardware_profile: None,
        })
    }

    pub fn configure_runtimes(
        &mut self,
        runtimes: BTreeMap<String, PathBuf>,
        gpu_architectures: BTreeMap<String, String>,
    ) -> Result<(), String> {
        validate_runtimes(&runtimes)?;
        if self.hardware_profile.as_ref().is_some_and(|job| job.busy()) {
            return Err("Wait for hardware profiling before changing its runtimes".into());
        }
        if self
            .instances
            .values()
            .any(|instance| instance.child.is_some())
        {
            return Err("Stop active instances before changing runtime assignments".into());
        }
        self.runtimes = runtimes;
        self.gpu_architectures = gpu_architectures;
        Ok(())
    }

    fn executable_for(&self, gpus: &[String]) -> Result<&PathBuf, String> {
        if self.runtimes.is_empty() {
            return Ok(&self.executable);
        }
        let architecture = gpus
            .first()
            .and_then(|gpu| self.gpu_architectures.get(gpu))
            .ok_or("Selected GPU has no known compute capability")?;
        if gpus
            .iter()
            .any(|gpu| self.gpu_architectures.get(gpu) != Some(architecture))
        {
            return Err("A GPU group must use one compute architecture".into());
        }
        self.runtimes.get(architecture).ok_or_else(|| {
            format!("No engine runtime configured for compute capability {architecture}")
        })
    }

    pub(crate) fn profiling_cli(&self, gpus: &[String]) -> Option<PathBuf> {
        let architecture = gpus.first().and_then(|gpu| self.gpu_architectures.get(gpu))?;
        if gpus.iter().any(|gpu| self.gpu_architectures.get(gpu) != Some(architecture)) { return None; }
        let executable = self.executable_for(gpus).ok()?;
        let name = if cfg!(windows) {
            "ginfer-serve.exe"
        } else {
            "ginfer-serve"
        };
        if executable.file_name()? != name {
            return None;
        }
        let cli = executable.with_file_name(if cfg!(windows) {
            "ginfer.exe"
        } else {
            "ginfer"
        });
        cli.is_file().then_some(cli)
    }
    pub(crate) fn hardware_profile_action(
        &self,
        request: crate::hardware_profile::HardwareProfileRequest,
    ) -> Result<crate::hardware_profile::HardwareProfileStatus, String> {
        use crate::hardware_profile::HardwareProfileAction;
        let job = self
            .hardware_profile
            .as_ref()
            .ok_or("Hardware profiling is not configured")?;
        if request.action == HardwareProfileAction::Ensure && request.gpu_uuids.is_none() {
            self.ensure_hardware_if_idle(vec![])?;
            return Ok(job.status(None));
        }
        let gpus = request.gpu_uuids.unwrap_or_else(|| job.group());
        if gpus.is_empty() { return Ok(job.status(None)); }
        if request.action == HardwareProfileAction::Cancel {
            job.start(request.action,None,gpus)?;
            return Ok(job.status(None));
        }
        crate::hardware_profile::validate_gpu_group(&gpus, &self.gpu_architectures)?;
        if request.action != HardwareProfileAction::Cancel
            && !job.busy()
            && self
                .instances
                .values()
                .any(|instance| instance.child.is_some())
        {
            return Err("Stop active model instances before profiling hardware".into());
        }
        let cli = self.profiling_cli(&gpus);
        job.start(request.action, cli.clone(), gpus)?;
        Ok(job.status(cli))
    }
    pub(crate) fn ensure_hardware_if_idle(
        &self,
        saved_groups: Vec<Vec<String>>,
    ) -> Result<(), String> {
        use crate::hardware_profile::group_key;
        if self
            .instances
            .values()
            .any(|instance| instance.child.is_some())
        {
            return Ok(());
        }
        let job = self
            .hardware_profile
            .as_ref()
            .ok_or("Hardware profiling is not configured")?;
        let mut groups = std::collections::BTreeMap::new();
        for gpus in job.configured_groups()?.into_iter().chain(saved_groups) {
            groups.entry(group_key(&gpus)).or_insert(gpus);
        }
        let mut configurations = Vec::new();
        for gpus in groups.into_values() {
            crate::hardware_profile::validate_gpu_group(&gpus, &self.gpu_architectures)?;
            let config = job.configuration(self.profiling_cli(&gpus), &gpus)?;
            config.store(job.directory())?;
            configurations.push(config);
        }
        job.ensure_groups(configurations)
    }

    /// Local clients may select an installed engine without replacing live instances.
    pub fn configure_executable(&mut self, path: PathBuf) -> Result<(), String> {
        if !self.runtimes.is_empty() {
            return Err("This host uses per-architecture runtimes; update its runtime assignments and restart the host".into());
        }
        if !path.is_absolute() || !path.is_file() {
            return Err("engine executable must be an existing absolute file path".into());
        }
        if self.hardware_profile.as_ref().is_some_and(|job| job.busy()) {
            return Err("Wait for hardware profiling before changing its runtime".into());
        }
        if self.executable != path
            && self
                .instances
                .values()
                .any(|instance| instance.child.is_some())
        {
            return Err(
                "Stop the host's active instances before changing its engine executable".into(),
            );
        }
        self.executable = path;
        Ok(())
    }

    /// Engine startup owns payload binding and physical TP qualification.
    pub fn launch(&mut self, launch: EngineLaunch) -> Result<Uuid, String> {
        self.validate_launch(&launch, false)?;
        self.spawn(launch)
    }

    pub fn validate_launch(&self, launch: &EngineLaunch, replacing: bool) -> Result<(), String> {
        if self.hardware_profile.as_ref().is_some_and(|job| job.busy()) {
            return Err("Hardware profiling reserves this host; wait for completion or cancel it before loading a model".into());
        }
        if let Some(job) = &self.hardware_profile {
            if job.is_stale(&launch.gpu_uuids) { return Err("Hardware changed — re-profile this GPU group before loading a model".into()); }
            let profile =
                job.configuration(self.profiling_cli(&launch.gpu_uuids), &launch.gpu_uuids)?;
            if !profile.profile_path.is_file() {
                return Err(
                    "Install the hardware profile for this GPU group before loading a model".into(),
                );
            }
        }
        if !self.executable_for(&launch.gpu_uuids)?.is_file() {
            return Err("Install the configured engine executable before loading a model".into());
        }
        launch.options.validate(launch.tp)?;
        if self
            .instances
            .get(&launch.instance_id)
            .is_some_and(|i| i.child.is_some())
            && !replacing
        {
            return Err("instance already has a live process".into());
        }
        if !matches!(launch.tp, 1 | 2 | 4) || launch.gpu_uuids.len() != launch.tp as usize {
            return Err("TP degree must be 1, 2, or 4 with exactly that many GPUs".into());
        }
        let selected: BTreeSet<_> = launch.gpu_uuids.iter().cloned().collect();
        if selected.len() != launch.gpu_uuids.len() || !selected.is_subset(&self.known_gpus) {
            return Err("GPU selection contains duplicates or unknown GPUs".into());
        }
        if self
            .instances
            .values()
            .filter(|i| i.child.is_some() && !(replacing && i.instance_id == launch.instance_id))
            .any(|i| {
                i.launch.port == launch.port
                    || i.launch.gpu_uuids.iter().any(|g| selected.contains(g))
            })
        {
            return Err("selected GPU or port is reserved by another instance".into());
        }
        if launch.port == 0
            || !(1..=8).contains(&launch.concurrency)
            || launch.max_context == 0
            || launch.model_id.trim().is_empty()
        {
            return Err(
                "port, model identity, context, and concurrency must be explicitly configured"
                    .into(),
            );
        }
        if !launch.artifact.is_absolute() || !launch.artifact.is_file() {
            return Err("model artifact must be an existing absolute file path".into());
        }
        Ok(())
    }

    fn spawn(&mut self, launch: EngineLaunch) -> Result<Uuid, String> {
        let api_key = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let executable = self.executable_for(&launch.gpu_uuids)?;
        let mut command = Command::new(executable);
        let hardware_profile_path = self.hardware_profile.as_ref().map(|job| job.configuration(self.profiling_cli(&launch.gpu_uuids), &launch.gpu_uuids).map(|configuration| configuration.profile_path)).transpose()?;
        #[cfg(windows)]
        command.creation_flags(0x08000000); // Background serving has no console window.
        if let Some(directory) = executable.parent() {
            let variable = if cfg!(windows) {
                "PATH"
            } else {
                "LD_LIBRARY_PATH"
            };
            let mut paths = vec![directory.to_path_buf()];
            if let Some(existing) = std::env::var_os(variable) {
                paths.extend(std::env::split_paths(&existing));
            }
            command.env(
                variable,
                std::env::join_paths(paths).map_err(|e| e.to_string())?,
            );
        }
        if launch.artifact_set {
            command
                .arg("--tp-artifact-set")
                .arg(&launch.artifact)
                .args(["--tp-fallback", "reject"]);
        } else {
            command.arg(&launch.artifact);
        }
        if let Some(path) = &hardware_profile_path { command.arg("--hardware-profile").arg(path); }
        let mut child = command
            .args([
                "--exit-on-stdin-close",
                "--host",
                "127.0.0.1",
                "--port",
                &launch.port.to_string(),
                "--api-key",
                &api_key,
                "--model-id",
                &launch.model_id,
                "--tp",
                &launch.tp.to_string(),
                "--max-context",
                &launch.max_context.to_string(),
                "--max-concurrency",
                &launch.concurrency.to_string(),
            ])
            .env("CUDA_VISIBLE_DEVICES", launch.gpu_uuids.join(","))
            .args(launch.options.args())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("could not start engine: {e}"))?;
        let diagnostics = Arc::new(Mutex::new(VecDeque::with_capacity(DIAGNOSTIC_TAIL_BYTES)));
        let output_readers = OutputReaders(vec![
            Some(capture_output(
                child.stdout.take().expect("piped stdout"),
                diagnostics.clone(),
            )),
            Some(capture_output(
                child.stderr.take().expect("piped stderr"),
                diagnostics.clone(),
            )),
        ]);
        let session_id = Uuid::new_v4();
        self.instances.insert(
            launch.instance_id,
            ManagedInstance {
                instance_id: launch.instance_id,
                session_id,
                status: InstanceStatus::Starting,
                last_error: None,
                model_metadata: None,
                launch,
                profile_persisted: false,
                child: Some(child),
                api_key,
                started: tokio::time::Instant::now(),
                diagnostics,
                output_readers,
                pending_exit: None,
                hardware_profile_path,
            },
        );
        self.activity.notify_one();
        Ok(session_id)
    }

    pub fn activity_notification(&self) -> Arc<tokio::sync::Notify> {
        self.activity.clone()
    }

    pub fn needs_monitoring(&self) -> bool {
        self.instances
            .values()
            .any(|instance| instance.child.is_some() || instance.pending_exit.is_some())
    }

    pub fn instances(&self) -> impl Iterator<Item = &ManagedInstance> {
        self.instances.values()
    }

    pub(crate) fn mark_profile_persisted(&mut self, id: Uuid) {
        self.instances.get_mut(&id).expect("launched instance exists").profile_persisted = true;
    }

    pub fn reserved_gpus(&self, except: Option<Uuid>) -> BTreeSet<String> {
        self.instances
            .values()
            .filter(|i| i.child.is_some() && Some(i.instance_id) != except)
            .flat_map(|i| i.launch.gpu_uuids.iter().cloned())
            .collect()
    }

    pub fn endpoint(&self, id: Uuid) -> Result<(u16, String, String, Uuid), String> {
        let instance = self
            .instances
            .get(&id)
            .filter(|i| i.status == InstanceStatus::Ready)
            .ok_or("instance is not ready")?;
        Ok((
            instance.launch.port,
            instance.api_key.clone(),
            instance.launch.model_id.clone(),
            instance.session_id,
        ))
    }

    /// One stop failure must not prevent reaping the remaining owned children.
    pub async fn shutdown(&mut self) -> Result<(), String> {
        let ids: Vec<_> = self.instances.keys().copied().collect();
        let mut errors = Vec::new();
        for id in ids {
            if let Err(error) = self.stop(id).await {
                errors.push(format!("{id}: {error}"));
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }

    /// Callers drain active requests first unless the user selected force-stop.
    pub async fn stop(&mut self, id: Uuid) -> Result<(), String> {
        let instance = self.instances.get_mut(&id).ok_or("unknown instance")?;
        if let Some(child) = &mut instance.child {
            instance.status = InstanceStatus::Stopping;
            self.activity.notify_one();
            child
                .kill()
                .await
                .map_err(|e| format!("could not stop engine: {e}"))?;
            // kill awaits process exit; retain reservations if it fails.
            instance.child = None;
        }
        instance.model_metadata = None;
        // A reaped session retains its final diagnostic until its drain commits.
        instance.status = InstanceStatus::Stopped;
        self.activity.notify_one();
        Ok(())
    }

    pub(crate) async fn pending_readiness(&mut self) -> Result<ProcessObservations, String> {
        let mut observations = ProcessObservations {
            readiness: Vec::new(),
            exits: Vec::new(),
        };
        for instance in self.instances.values_mut() {
            if let Some(pending) = &instance.pending_exit {
                observations.exits.push(ExitDrain {
                    instance_id: instance.instance_id,
                    session_id: instance.session_id,
                    pending: pending.clone(),
                });
                continue;
            }
            let Some(child) = instance.child.as_mut() else {
                continue;
            };
            if let Some(exit) = child.try_wait().map_err(|e| e.to_string())? {
                instance.child = None;
                instance.status = InstanceStatus::Stopping;
                instance.model_metadata = None;
                let pending = Arc::new(PendingExit {
                    exit,
                    diagnostics: instance.diagnostics.clone(),
                    readers: tokio::sync::Mutex::new(std::mem::take(&mut instance.output_readers)),
                });
                observations.exits.push(ExitDrain {
                    instance_id: instance.instance_id,
                    session_id: instance.session_id,
                    pending: pending.clone(),
                });
                instance.pending_exit = Some(pending);
                self.activity.notify_one();
                continue;
            }
            if instance.status != InstanceStatus::Starting {
                continue;
            }
            if instance.started.elapsed() > self.startup_timeout {
                child.kill().await.map_err(|e| e.to_string())?;
                instance.child = None;
                instance.status = InstanceStatus::Failed;
                instance.last_error = Some("engine startup timed out".into());
                self.activity.notify_one();
                continue;
            }
            observations.readiness.push(StartupProbe {
                instance_id: instance.instance_id,
                session_id: instance.session_id,
                model_id: instance.launch.model_id.clone(),
                port: instance.launch.port,
                api_key: instance.api_key.clone(),
                client: self.client.clone(),
            });
        }
        Ok(observations)
    }

    pub(crate) fn confirm_exit(&mut self, observation: ExitObservation) {
        let Some(instance) = self.instances.get_mut(&observation.instance_id) else {
            return;
        };
        if instance.session_id != observation.session_id
            || !matches!(instance.status, InstanceStatus::Stopping | InstanceStatus::Stopped)
            || instance.child.is_some()
            || instance.pending_exit.is_none()
        {
            return;
        }
        if let (Some(job), Some(profile)) = (&self.hardware_profile, &instance.hardware_profile_path) {
            job.mark_stale(
                &instance.launch.gpu_uuids,
                profile,
                &observation.last_error,
            );
        }
        instance.last_error = Some(observation.last_error);
        if instance.status == InstanceStatus::Stopping {
            instance.status = InstanceStatus::Failed;
        }
        instance.pending_exit = None;
        self.activity.notify_one();
    }

    pub(crate) fn confirm_readiness(
        &mut self,
        observation: ReadyObservation,
    ) -> Result<(), String> {
        let Some(instance) = self.instances.get_mut(&observation.instance_id) else {
            return Ok(());
        };
        // A delayed response must not qualify a stopped or replacement session.
        if instance.session_id != observation.session_id
            || instance.status != InstanceStatus::Starting
        {
            return Ok(());
        }
        let Some(child) = instance.child.as_mut() else {
            return Ok(());
        };
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            instance.model_metadata = Some(observation.metadata);
            instance.status = InstanceStatus::Ready;
            self.activity.notify_one();
        }
        Ok(())
    }
}

#[cfg(all(test, unix))]
mod tests {
    #[test]
    fn dynamic_arena_launch_keeps_headroom_without_a_fixed_pool() {
        let options = super::LaunchOptions {
            kv_arena_bytes: None,
            kv_arena_headroom_bytes: 314572800,
            ..Default::default()
        };
        let args = options.args();
        assert!(!args.iter().any(|arg| arg == "--kv-arena-bytes"));
        assert!(args.windows(2).any(|pair| pair == ["--kv-arena-headroom-bytes", "314572800"]));
    }
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn fixture_launch(artifact: &std::path::Path, instance_id: Uuid) -> EngineLaunch {
        EngineLaunch {
            instance_id, artifact: artifact.to_owned(),
            artifact_dependencies: vec![artifact.to_owned()], artifact_set: false,
            model_id: "fixture".into(), gpu_uuids: vec!["GPU-fixture".into()],
            tp: 1, port: 40121, max_context: 4096, concurrency: 1,
            options: LaunchOptions::default(),
        }
    }

    #[tokio::test]
    async fn hardware_profile_spawn_keeps_artifact_selection_first() {
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("ginfer-serve");
        std::fs::write(
            &executable,
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$(dirname \"$0\")/spawn-argv\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(directory.path().join("ginfer"), b"fixture CLI").unwrap();
        let artifact = directory.path().join("fixture.ginfer");
        std::fs::write(&artifact, b"fixture artifact").unwrap();
        let gpus = vec!["GPU-fixture".to_owned()];
        let host_directory = directory.path().join("host");
        let profile = crate::hardware_profile::group_profile_path(&host_directory, &gpus);
        std::fs::create_dir_all(profile.parent().unwrap()).unwrap();
        std::fs::write(&profile, br#"{"schema_version":2}"#).unwrap();
        let mut processes = HostProcesses::new(
            executable.clone(),
            BTreeSet::from([gpus[0].clone()]),
            Duration::from_secs(10),
        )
        .unwrap();
        processes
            .configure_runtimes(
                BTreeMap::from([("12.0".to_owned(), executable)]),
                BTreeMap::from([(gpus[0].clone(), "12.0".to_owned())]),
            )
            .unwrap();
        processes.hardware_profile = Some(
            crate::hardware_profile::HardwareProfiles::open(
                host_directory,
                Arc::new(std::sync::atomic::AtomicU64::new(0)),
            )
            .unwrap(),
        );
        for artifact_set in [false, true] {
            let id = Uuid::new_v4();
            let mut launch = fixture_launch(&artifact, id);
            launch.artifact_set = artifact_set;
            processes.launch(launch).unwrap();
            let child = processes.instances.get_mut(&id).unwrap().child.as_mut().unwrap();
            let exit = tokio::time::timeout(Duration::from_secs(2), child.wait())
                .await
                .unwrap()
                .unwrap();
            processes.stop(id).await.unwrap();
            assert!(exit.success());
            let recorded = std::fs::read_to_string(directory.path().join("spawn-argv")).unwrap();
            let args: Vec<_> = recorded.lines().collect();
            let artifact = artifact.to_str().unwrap();
            let profile = profile.to_str().unwrap();
            let expected = if artifact_set {
                vec!["--tp-artifact-set", artifact, "--tp-fallback", "reject", "--hardware-profile", profile]
            } else {
                vec![artifact, "--hardware-profile", profile]
            };
            assert_eq!(&args[..expected.len()], expected.as_slice());
            assert_eq!(args.iter().filter(|arg| **arg == "--hardware-profile").count(), 1);
            assert_eq!(args[expected.len()], "--exit-on-stdin-close");
        }
    }

    #[tokio::test]
    #[ignore = "one noisy-child resource measurement"]
    async fn request_resource_measurement_noisy_child_tail() {
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("engine");
        std::fs::write(&executable, "#!/bin/sh\ncat \"$1\"\nexit 7\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let artifact = directory.path().join("fixture.ginfer");
        let mut payload: Vec<u8> = (0..65_536).map(|index| b'a' + (index % 26) as u8).collect();
        payload[65_400] = 0xff;
        payload.push(b'\n');
        std::fs::write(&artifact, &payload).unwrap();
        let expected = String::from_utf8_lossy(&payload[payload.len() - 16_384..]);
        let host = crate::service::Host::open(
            directory.path().join("host"),
            "fixture".into(),
            executable.clone(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
        )
        .await
        .unwrap();
        *host.processes.lock().await = HostProcesses::new(
            executable,
            BTreeSet::from(["GPU-fixture".into()]),
            Duration::from_secs(10),
        )
        .unwrap();
        let id = Uuid::new_v4();
        let measurement = crate::resource_measurement::Measurement::start();
        {
            let mut processes = host.processes.lock().await;
            processes.launch(fixture_launch(&artifact, id)).unwrap();
            processes.instances.get_mut(&id).unwrap().child.as_mut().unwrap().wait().await.unwrap();
        }
        host.refresh_processes().await.unwrap();
        measurement.finish("noisy_child_tail");
        let snapshot = host.snapshot().await;
        assert_eq!(snapshot["instances"][0]["status"], "failed");
        assert_eq!(snapshot["instances"][0]["last_error"],
            format!("engine exited unexpectedly: exit status: 7\n{}", expected.trim()));
        assert!(host.processes.lock().await.reserved_gpus(None).is_empty());
    }

    #[tokio::test]
    #[ignore = "one gated-reader action resource measurement"]
    async fn request_resource_measurement_exit_drain_action() {
        use std::{future::Future, task::Poll};
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("engine");
        std::fs::write(
            &executable,
            "#!/bin/sh\n(sleep 0.5; printf 'late diagnostic\\n') &\nexit 7\n",
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let artifact = directory.path().join("fixture.ginfer");
        std::fs::write(&artifact, b"fixture").unwrap();
        let host = crate::service::Host::open(
            directory.path().join("host"),
            "fixture".into(),
            executable.clone(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
        )
        .await
        .unwrap();
        *host.processes.lock().await = HostProcesses::new(
            executable,
            BTreeSet::from(["GPU-fixture".into()]),
            Duration::from_secs(10),
        )
        .unwrap();
        let id = Uuid::new_v4();
        {
            let mut processes = host.processes.lock().await;
            processes.launch(fixture_launch(&artifact, id)).unwrap();
            processes
                .instances
                .get_mut(&id)
                .unwrap()
                .child
                .as_mut()
                .unwrap()
                .wait()
                .await
                .unwrap();
        }
        let (entered, ready) = tokio::sync::oneshot::channel();
        let observer = host.clone();
        let refresh = tokio::spawn(async move {
            let mut refresh = Box::pin(observer.refresh_processes());
            std::future::poll_fn(|context| match refresh.as_mut().poll(context) {
                Poll::Pending => Poll::Ready(()),
                Poll::Ready(result) => panic!("fixture reader must still be held: {result:?}"),
            }).await;
            entered.send(()).unwrap();
            refresh.await
        });
        ready.await.unwrap();
        let measurement = crate::resource_measurement::Measurement::start();
        let snapshot = host.snapshot().await;
        measurement.finish("exit_drain_snapshot_action");
        assert_eq!(snapshot["instances"][0]["instance_id"], id.to_string());
        refresh.await.unwrap().unwrap();
        let final_snapshot = host.snapshot().await;
        assert_eq!(final_snapshot["instances"][0]["status"], "failed");
        assert_eq!(final_snapshot["instances"][0]["last_error"],
            "engine exited unexpectedly: exit status: 7\nlate diagnostic");
    }

    #[tokio::test]
    async fn request_resources_stopped_session_retains_pending_exit_diagnostic() {
        use std::{future::Future, task::Poll};
        use tokio::io::AsyncWriteExt;
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("engine");
        std::fs::write(&executable, "#!/bin/sh\nexec sleep 60\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let artifact = directory.path().join("fixture.ginfer");
        std::fs::write(&artifact, b"fixture").unwrap();
        let host = crate::service::Host::open(
            directory.path().join("host"),
            "fixture".into(),
            executable.clone(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
        )
        .await
        .unwrap();
        *host.processes.lock().await = HostProcesses::new(
            executable,
            BTreeSet::from(["GPU-fixture".into()]),
            Duration::from_secs(10),
        )
        .unwrap();
        let id = Uuid::new_v4();
        let (mut writer, reader) = tokio::io::duplex(4096);
        let (session, exit) = {
            let mut processes = host.processes.lock().await;
            let session = processes.launch(fixture_launch(&artifact, id)).unwrap();
            let instance = processes.instances.get_mut(&id).unwrap();
            instance.output_readers = OutputReaders(vec![Some(capture_output(
                reader,
                instance.diagnostics.clone(),
            ))]);
            let child = instance.child.as_mut().unwrap();
            child.kill().await.unwrap();
            (session, child.try_wait().unwrap().unwrap())
        };
        let mut refresh = Box::pin(host.refresh_processes());
        std::future::poll_fn(|context| match refresh.as_mut().poll(context) {
            Poll::Pending => Poll::Ready(()),
            Poll::Ready(result) => panic!("open reader must delay exit publication: {result:?}"),
        }).await;
        tokio::time::timeout(Duration::from_millis(500), async {
            host.processes.lock().await.stop(id).await.unwrap();
        }).await.unwrap();
        let snapshot = host.snapshot().await;
        assert_eq!(snapshot["instances"][0]["status"], "stopped");
        assert_eq!(snapshot["instances"][0]["session_id"], session.to_string());
        assert!(snapshot["instances"][0]["last_error"].is_null());
        drop(refresh);
        let mut retry = Box::pin(host.refresh_processes());
        std::future::poll_fn(|context| match retry.as_mut().poll(context) {
            Poll::Pending => Poll::Ready(()),
            Poll::Ready(result) => {
                panic!("Stop must retain the cancelled session drain: {result:?}")
            }
        })
        .await;
        writer
            .write_all(b"final diagnostic after Stop\n")
            .await
            .unwrap();
        writer.shutdown().await.unwrap();
        retry.await.unwrap();
        let snapshot = host.snapshot().await;
        assert_eq!(snapshot["instances"][0]["status"], "stopped");
        assert_eq!(snapshot["instances"][0]["session_id"], session.to_string());
        assert_eq!(snapshot["instances"][0]["last_error"],
            format!("engine exited unexpectedly: {exit}\nfinal diagnostic after Stop"));
    }

    #[tokio::test]
    async fn request_resources_exit_drain_survives_cancel_and_fences_relaunch() {
        use std::{future::Future, task::Poll};
        use tokio::io::AsyncWriteExt;
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("engine");
        std::fs::write(&executable, "#!/bin/sh\nexec sleep 60\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let artifact = directory.path().join("fixture.ginfer");
        std::fs::write(&artifact, b"fixture").unwrap();
        let host = crate::service::Host::open(
            directory.path().join("host"),
            "fixture".into(),
            executable.clone(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
        )
        .await
        .unwrap();
        *host.processes.lock().await = HostProcesses::new(
            executable,
            BTreeSet::from(["GPU-fixture".into()]),
            Duration::from_secs(10),
        )
        .unwrap();
        let id = Uuid::new_v4();
        let (mut writer, reader) = tokio::io::duplex(4096);
        let session = {
            let mut processes = host.processes.lock().await;
            let session = processes.launch(fixture_launch(&artifact, id)).unwrap();
            let instance = processes.instances.get_mut(&id).unwrap();
            instance.output_readers = OutputReaders(vec![Some(capture_output(
                reader,
                instance.diagnostics.clone(),
            ))]);
            instance.child.as_mut().unwrap().kill().await.unwrap();
            session
        };
        let mut first_refresh = Box::pin(host.refresh_processes());
        std::future::poll_fn(|context| match first_refresh.as_mut().poll(context) {
            Poll::Pending => Poll::Ready(()),
            Poll::Ready(result) => panic!("open reader must delay exit publication: {result:?}"),
        })
        .await;
        let snapshot = tokio::time::timeout(Duration::from_millis(500), host.snapshot())
            .await
            .unwrap();
        assert_eq!(snapshot["instances"][0]["status"], "stopping");
        assert!(snapshot["instances"][0]["last_error"].is_null());
        drop(first_refresh);
        let mut second_refresh = Box::pin(host.refresh_processes());
        std::future::poll_fn(|context| match second_refresh.as_mut().poll(context) {
            Poll::Pending => Poll::Ready(()),
            Poll::Ready(result) => {
                panic!("cancelled observation must retain the reader: {result:?}")
            }
        })
        .await;
        tokio::time::timeout(Duration::from_millis(500), async {
            let mut processes = host.processes.lock().await;
            processes.stop(id).await.unwrap();
            let next = processes.launch(fixture_launch(&artifact, id)).unwrap();
            assert_ne!(session, next);
        }).await.unwrap();
        writer.write_all(b"late diagnostic from previous session\n").await.unwrap();
        writer.shutdown().await.unwrap();
        second_refresh.await.unwrap();
        let snapshot = host.snapshot().await;
        assert_eq!(snapshot["instances"][0]["status"], "starting");
        assert!(snapshot["instances"][0]["last_error"].is_null());
        host.processes.lock().await.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn launches_each_gpu_with_its_declared_runtime_without_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let mut runtimes = BTreeMap::new();
        for architecture in ["8.0", "8.6"] {
            let executable = dir.path().join(format!("engine-{architecture}"));
            std::fs::write(
                &executable,
                format!("#!/bin/sh\necho {architecture}:$CUDA_VISIBLE_DEVICES\nexec sleep 60\n"),
            )
            .unwrap();
            std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
            runtimes.insert(architecture.into(), executable);
        }
        let mut host = HostProcesses::new(
            dir.path().join("unused-default"),
            BTreeSet::from(["GPU-80".into(), "GPU-86".into(), "GPU-89".into()]),
            Duration::from_secs(10),
        )
        .unwrap();
        host.configure_runtimes(
            runtimes,
            BTreeMap::from([
                ("GPU-80".into(), "8.0".into()),
                ("GPU-86".into(), "8.6".into()),
                ("GPU-89".into(), "8.9".into()),
            ]),
        )
        .unwrap();
        let artifact = dir.path().join("fixture.ginfer");
        std::fs::write(&artifact, b"fixture").unwrap();
        let launch = |gpu: &str, port| EngineLaunch {
            instance_id: Uuid::new_v4(),
            artifact: artifact.clone(),
            artifact_dependencies: vec![artifact.clone()],
            artifact_set: false,
            model_id: "fixture".into(),
            gpu_uuids: vec![gpu.into()],
            tp: 1,
            port,
            max_context: 4096,
            concurrency: 1,
            options: LaunchOptions::default(),
        };
        assert!(host
            .launch(launch("GPU-89", 40103))
            .unwrap_err()
            .contains("No engine runtime"));
        let mut mixed = launch("GPU-80", 40104);
        mixed.tp = 2;
        mixed.gpu_uuids.push("GPU-86".into());
        assert!(host
            .launch(mixed)
            .unwrap_err()
            .contains("one compute architecture"));
        for (gpu, sm, port) in [("GPU-80", "8.0", 40101), ("GPU-86", "8.6", 40102)] {
            let request = launch(gpu, port);
            let id = request.instance_id;
            host.launch(request).unwrap();
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    let output: Vec<_> = host.instances.get(&id).unwrap().diagnostics.lock().unwrap().iter().copied().collect();
                    if String::from_utf8_lossy(&output).contains(&format!("{sm}:{gpu}")) { break; }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            }).await.unwrap();
        }
        let ids: Vec<_> = host.instances.keys().copied().collect();
        for id in ids { host.stop(id).await.unwrap(); }
    }

    #[tokio::test]
    async fn owned_process_reserves_gpu_until_stopped_then_relaunches_with_new_session() {
        let dir = tempfile::tempdir().unwrap();
        let executable = dir.path().join("engine");
        // A controlled child that stays alive without creating descendants.
        std::fs::write(&executable, "#!/bin/sh\nexec sleep 60\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let artifact = dir.path().join("model.ginfer");
        std::fs::write(&artifact, b"test fixture").unwrap();
        let mut host = HostProcesses::new(
            executable.clone(),
            BTreeSet::from(["GPU-test".into()]),
            Duration::from_secs(10),
        )
        .unwrap();
        let id = Uuid::new_v4();
        let launch = |id| EngineLaunch {
            instance_id: id,
            artifact: artifact.clone(),
            artifact_dependencies: vec![artifact.clone()],
            artifact_set: false,
            model_id: "muse".into(),
            gpu_uuids: vec!["GPU-test".into()],
            tp: 1,
            port: 40111,
            max_context: 4096,
            concurrency: 1,
            options: LaunchOptions::default(),
        };
        let first = host.launch(launch(id)).unwrap();
        host.configure_executable(executable.clone()).unwrap();
        let replacement = dir.path().join("replacement-engine");
        std::fs::copy(&executable, &replacement).unwrap();
        assert!(host.configure_executable(replacement.clone()).is_err());
        assert_eq!(host.instances().next().unwrap().session_id, first);
        assert!(host.launch(launch(Uuid::new_v4())).is_err());
        host.stop(id).await.unwrap();
        assert!(host.configure_executable(dir.path().join("missing-engine")).is_err());
        host.configure_executable(replacement).unwrap();
        assert_eq!(
            host.instances().next().unwrap().status,
            InstanceStatus::Stopped
        );
        let second = host.launch(launch(id)).unwrap();
        assert_ne!(first, second);
        host.stop(id).await.unwrap();

        // A startup timeout must reap the owned child before the GPU is reused.
        host.startup_timeout = Duration::ZERO;
        host.launch(launch(id)).unwrap();
        host.pending_readiness().await.unwrap();
        let failed = host.instances().next().unwrap();
        assert_eq!(failed.status, InstanceStatus::Failed);
        assert_eq!(
            failed.last_error.as_deref(),
            Some("engine startup timed out")
        );
        assert!(failed.child.is_none());
        host.launch(launch(Uuid::new_v4())).unwrap();
        host.shutdown().await.unwrap();
        assert!(host.instances().all(|i| i.child.is_none()));
    }
}

#[cfg(test)]
mod launch_options_tests {
    use super::*;

    #[test]
    fn automatic_speculation_keeps_engine_defaults_and_omits_zero_drafts() {
        let options: LaunchOptions = serde_json::from_str("{}").unwrap();
        options.validate(1).unwrap();
        assert_eq!(options.spec, "auto");
        assert_eq!(options.draft_policy, "auto");
        let args = options.args();
        assert!(args.windows(2).any(|pair| pair == ["--spec", "auto"]));
        assert!(args.windows(2).any(|pair| pair == ["--draft-policy", "auto"]));
        assert!(!args.iter().any(|arg| arg == "--draft-tokens" || arg == "--draft-tp"));
    }

    #[test]
    fn mtp_width_and_policy_are_validated_and_forwarded_with_independent_vision() {
        for vision in [false, true] {
            for policy in ["auto", "fixed"] {
                let mut options = LaunchOptions {
                    vision, spec: "mtp".into(), draft_tokens: 16,
                    draft_policy: policy.into(), ..Default::default()
                };
                options.validate(4).unwrap();
                let args = options.args();
                assert!(args.windows(2).any(|pair| pair == ["--spec", "mtp"]));
                assert!(args.windows(2).any(|pair| pair == ["--draft-tokens", "16"]));
                assert!(args.windows(2).any(|pair| pair == ["--draft-policy", policy]));
                assert_eq!(args.iter().any(|arg| arg == "--vision"), vision);
                for invalid in [0, u32::MAX] {
                    options.draft_tokens = invalid;
                    assert!(options.validate(4).is_err());
                }
                options.draft_tokens = 16;
                options.draft_policy = "adaptive".into();
                assert!(options.validate(4).is_err());
            }
        }
        for json in [
            r#"{"spec":"mtp","draft_tokens":4294967296}"#,
            r#"{"spec":"mtp","draft_tokens":-1}"#,
        ] {
            assert!(serde_json::from_str::<LaunchOptions>(json).is_err());
        }
    }

    #[test]
    fn speculative_options_keep_dflash_limits_and_reject_incompatible_controls() {
        let mut options = LaunchOptions { spec: "dflash".into(), draft_tokens: 15, ..Default::default() };
        options.validate(1).unwrap();
        options.draft_policy = "adaptive".into();
        options.validate(1).unwrap();
        for width in [14, 16] {
            options.draft_tokens = width;
            assert!(options.validate(1).is_err());
        }
        for spec in ["auto", "none", "unknown"] {
            options.spec = spec.into();
            options.draft_tokens = 1;
            options.draft_policy = "auto".into();
            assert!(options.validate(1).is_err());
        }
        options.spec = "none".into();
        options.draft_tokens = 0;
        options.draft_policy = "adaptive".into();
        assert!(options.validate(1).is_err());
    }
}
