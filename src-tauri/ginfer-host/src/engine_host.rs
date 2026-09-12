//! Host-owned inference processes. The service loop calls `refresh` to observe exits
//! and readiness; only processes spawned here can be stopped here.

use super::engine_registry::InstanceStatus;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    time::Duration,
};
use tokio::process::{Child, Command};
use uuid::Uuid;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncRead, AsyncReadExt};

type Diagnostics = Arc<Mutex<Vec<u8>>>;

fn capture_output(reader: impl AsyncRead + Unpin + Send + 'static, diagnostics: Diagnostics) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut reader = reader;
        let mut chunk = [0u8; 4096];
        while let Ok(count) = reader.read(&mut chunk).await {
            if count == 0 { break; }
            eprint!("{}", String::from_utf8_lossy(&chunk[..count]));
            let mut tail = diagnostics.lock().unwrap_or_else(|e| e.into_inner());
            tail.extend_from_slice(&chunk[..count]);
            let excess = tail.len().saturating_sub(16_384);
            tail.drain(..excess);
        }
    })
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct LaunchOptions {
    pub vision: bool,
    pub spec: String,
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
        if !matches!(self.spec.as_str(), "auto" | "none" | "dflash") {
            return Err("spec must be auto, none, or dflash".into());
        }
        if !matches!(self.kv_dtype.as_str(), "auto" | "bf16" | "int8" | "nvfp4") {
            return Err("unsupported KV dtype".into());
        }
        if !matches!(self.draft_tp, 0 | 1 | 2 | 4) || self.draft_tp > tp {
            return Err("draft TP must be auto or a subgroup of target TP".into());
        }
        if self.draft_tokens > 15 {
            return Err("draft token count exceeds supported target maximum".into());
        }
        if self.draft_tokens != 0 && self.spec != "dflash" {
            return Err("explicit draft tokens require spec dflash".into());
        }
        if self.prefill_chunk != 0 && self.prefill_chunk % 128 != 0 {
            return Err("prefill chunk must be a multiple of 128, or automatic".into());
        }
        if self.spec == "none" && (self.draft_tokens != 0 || self.draft_tp != 0) {
            return Err("draft settings require speculative decoding".into());
        }
        if self.kv_arena_bytes == Some(0) {
            return Err("KV arena must be positive or automatic".into());
        }
        Ok(())
    }
    fn args(&self) -> Vec<String> {
        let mut args = vec![
            "--spec".into(),
            self.spec.clone(),
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
    child: Option<Child>,
    api_key: String,
    started: tokio::time::Instant,
    diagnostics: Diagnostics,
    output_readers: Vec<tokio::task::JoinHandle<()>>,
}

pub struct HostProcesses {
    executable: PathBuf,
    known_gpus: BTreeSet<String>,
    instances: BTreeMap<Uuid, ManagedInstance>,
    client: reqwest::Client,
    startup_timeout: Duration,
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
            instances: BTreeMap::new(),
            client,
            startup_timeout,
        })
    }

    /// Local clients may select an installed engine without replacing live instances.
    pub fn configure_executable(&mut self, path: PathBuf) -> Result<(), String> {
        if !path.is_absolute() || !path.is_file() { return Err("engine executable must be an existing absolute file path".into()); }
        if self.executable != path && self.instances.values().any(|instance| instance.child.is_some()) {
            return Err("Stop the host's active instances before changing its engine executable".into());
        }
        self.executable = path;
        Ok(())
    }

    /// Invoked only with an inventory-resolved artifact and validated host settings.
    /// Engine startup performs artifact binding and physical TP qualification.
    pub fn launch(&mut self, launch: EngineLaunch) -> Result<Uuid, String> {
        self.validate_launch(&launch, false)?;
        self.spawn(launch)
    }

    pub fn validate_launch(&self, launch: &EngineLaunch, replacing: bool) -> Result<(), String> {
        if !self.executable.is_file() { return Err("Install the configured engine executable before loading a model".into()); }
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
        let mut command = Command::new(&self.executable);
        if let Some(directory) = self.executable.parent() {
            let variable = if cfg!(windows) { "PATH" } else { "LD_LIBRARY_PATH" };
            let mut paths = vec![directory.to_path_buf()];
            if let Some(existing) = std::env::var_os(variable) { paths.extend(std::env::split_paths(&existing)); }
            command.env(variable, std::env::join_paths(paths).map_err(|e| e.to_string())?);
        }
        if launch.artifact_set {
            command
                .arg("--tp-artifact-set")
                .arg(&launch.artifact)
                .args(["--tp-fallback", "reject"]);
        } else {
            command.arg(&launch.artifact);
        }
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
        let diagnostics = Arc::new(Mutex::new(Vec::new()));
        let output_readers = vec![
            capture_output(child.stdout.take().expect("piped stdout"), diagnostics.clone()),
            capture_output(child.stderr.take().expect("piped stderr"), diagnostics.clone()),
        ];
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
                child: Some(child),
                api_key,
                started: tokio::time::Instant::now(),
                diagnostics,
                output_readers,
            },
        );
        Ok(session_id)
    }

    pub fn instances(&self) -> impl Iterator<Item = &ManagedInstance> {
        self.instances.values()
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

    /// Service shutdown attempts every owned child even if one stop fails.
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

    /// Force-stop is explicit. A later HTTP drain handler must finish active
    /// requests before calling this unless the user selected force-stop.
    pub async fn stop(&mut self, id: Uuid) -> Result<(), String> {
        let instance = self.instances.get_mut(&id).ok_or("unknown instance")?;
        if let Some(child) = &mut instance.child {
            instance.status = InstanceStatus::Stopping;
            child
                .kill()
                .await
                .map_err(|e| format!("could not stop engine: {e}"))?;
            // kill awaits process exit; retain reservations if it fails.
            instance.child = None;
        }
        instance.model_metadata = None;
        instance.status = InstanceStatus::Stopped;
        Ok(())
    }

    pub async fn refresh(&mut self) -> Result<(), String> {
        for instance in self.instances.values_mut() {
            let Some(child) = instance.child.as_mut() else {
                continue;
            };
            if let Some(exit) = child.try_wait().map_err(|e| e.to_string())? {
                instance.child = None;
                instance.status = InstanceStatus::Failed;
                instance.model_metadata = None;
                for mut reader in instance.output_readers.drain(..) {
                    if tokio::time::timeout(Duration::from_secs(1), &mut reader).await.is_err() { reader.abort(); }
                }
                let tail = instance.diagnostics.lock().unwrap_or_else(|e| e.into_inner());
                let detail = String::from_utf8_lossy(&tail);
                instance.last_error = Some(format!("engine exited unexpectedly: {exit}\n{}", detail.trim()));
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
                continue;
            }
            let base = format!("http://127.0.0.1:{}", instance.launch.port);
            let Ok(health) = self.client.get(format!("{base}/health")).send().await else {
                continue;
            };
            if !health.status().is_success() {
                continue;
            }
            let Ok(response) = self
                .client
                .get(format!("{base}/v1/models"))
                .bearer_auth(&instance.api_key)
                .send()
                .await
            else {
                continue;
            };
            if !response.status().is_success() {
                continue;
            }
            let Ok(models) = response.json::<serde_json::Value>().await else {
                continue;
            };
            let metadata = models
                .get("data")
                .and_then(|d| d.as_array())
                .and_then(|models| {
                    models.iter().find(|m| {
                        m.get("id").and_then(|id| id.as_str())
                            == Some(instance.launch.model_id.as_str())
                    })
                });
            if let Some(metadata) = metadata {
                instance.model_metadata = Some(metadata.clone());
                instance.status = InstanceStatus::Ready;
            }
        }
        Ok(())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

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
        host.refresh().await.unwrap();
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
