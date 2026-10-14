//! Durable, idle-only native calibration for saved deployments.
use crate::{engine_host::EngineLaunch, hardware_profile::Configuration};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, VecDeque},
    ffi::OsString,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::UNIX_EPOCH,
};
use tokio::{
    process::Command,
    sync::{watch, Notify},
};
use uuid::Uuid;

#[derive(Clone)]
pub(crate) struct Recipe {
    pub launch: EngineLaunch,
    pub configuration: Configuration,
    pub key: String,
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use crate::engine_host::LaunchOptions;
    use std::os::unix::fs::PermissionsExt;

    fn fixture(script: &str) -> (tempfile::TempDir, Recipe, Arc<DraftWidths>) {
        let directory = tempfile::tempdir().unwrap();
        let cli = directory.path().join("ginfer");
        std::fs::write(&cli, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(directory.path().join("ginfer-serve"), "fixture").unwrap();
        let profile_path = directory.path().join("hardware.json");
        std::fs::write(
            &profile_path,
            r#"{"schema_version":2,"fingerprint":"fixture"}"#,
        )
        .unwrap();
        let artifact = directory.path().join("model.ginfer");
        std::fs::write(&artifact, "fixture").unwrap();
        let launch = EngineLaunch {
            instance_id: Uuid::new_v4(),
            artifact,
            artifact_dependencies: vec![],
            artifact_set: false,
            model_id: "fixture-dflash".into(),
            gpu_uuids: vec!["GPU-fixture".into()],
            tp: 1,
            port: 10001,
            max_context: 131072,
            concurrency: 4,
            benchmark_profile: None,
            options: LaunchOptions {
                kv_dtype: "int8".into(),
                no_cuda_graph: true,
                ..Default::default()
            },
        };
        let configuration = Configuration {
            gpu_uuids: launch.gpu_uuids.clone(),
            engine: cli,
            profile_path,
        };
        let recipe = Recipe::new(launch, configuration).unwrap();
        let jobs = DraftWidths::open(
            directory.path(),
            Arc::new(AtomicU64::new(1)),
            Arc::new(Notify::new()),
        )
        .unwrap();
        (directory, recipe, jobs)
    }

    #[test]
    fn draft_width_recipe_binds_exact_deployment_and_native_argv() {
        let (_directory, recipe, jobs) = fixture("exit 0");
        assert!(jobs.status().is_empty());
        let args = recipe.args();
        assert_eq!(args[0], recipe.launch.artifact.as_os_str());
        for (flag, value) in [
            ("--tp", "1"),
            ("--max-context", "131072"),
            ("--max-concurrency", "4"),
            ("--kv-dtype", "int8"),
            ("--draft-policy", "auto"),
        ] {
            assert!(args
                .windows(2)
                .any(|pair| pair[0] == flag && pair[1] == value));
        }
        for flag in [
            "--calibrate-draft-width",
            "--vision",
            "--no-cuda-graph",
            "--structured-outputs",
        ] {
            assert!(args.iter().any(|arg| arg == flag));
        }
        for field in 0..8 {
            let mut launch = recipe.launch.clone();
            match field {
                0 => launch.max_context /= 2,
                1 => launch.concurrency = 2,
                2 => {
                    launch.gpu_uuids.push("GPU-second".into());
                    launch.tp = 2;
                }
                3 => launch.options.kv_dtype = "nvfp4".into(),
                4 => launch.options.vision = false,
                5 => launch.options.no_cuda_graph = false,
                6 => launch.options.draft_policy = "adaptive".into(),
                _ => launch.options.structured_outputs = false,
            }
            let mut configuration = recipe.configuration.clone();
            configuration.gpu_uuids = launch.gpu_uuids.clone();
            assert_ne!(recipe.key, Recipe::new(launch, configuration).unwrap().key);
        }
        let mut wrong_group = recipe.configuration.clone();
        wrong_group.gpu_uuids = vec!["GPU-other".into()];
        assert!(Recipe::new(recipe.launch.clone(), wrong_group).is_err());
        std::fs::write(
            &recipe.configuration.profile_path,
            r#"{"schema_version":2,"fingerprint":"fixture","fixed_draft_width_calibrations":[{}]}"#,
        )
        .unwrap();
        assert_eq!(
            recipe.key,
            Recipe::new(recipe.launch.clone(), recipe.configuration.clone())
                .unwrap()
                .key
        );
        let mut descriptor = recipe.clone();
        descriptor.launch.artifact_set = true;
        let args = descriptor.args();
        assert_eq!(args[0], "--tp-artifact-set");
        assert_eq!(args[1], recipe.launch.artifact.as_os_str());
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "--tp-fallback" && pair[1] == "reject"));
    }

    #[tokio::test]
    async fn draft_width_completion_is_durable_and_not_repeated() {
        let (directory, recipe, jobs) = fixture("exit 0");
        jobs.reconcile(std::slice::from_ref(&recipe)).unwrap();
        jobs.start_next(std::slice::from_ref(&recipe)).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(3), jobs.activity.notified())
            .await
            .unwrap();
        assert_eq!(jobs.status()[0].status, "completed");
        let restored = DraftWidths::open(
            directory.path(),
            jobs.revision.clone(),
            jobs.activity.clone(),
        )
        .unwrap();
        restored.reconcile(std::slice::from_ref(&recipe)).unwrap();
        restored.start_next(&[recipe]).unwrap();
        assert!(!restored.busy());
    }

    #[tokio::test]
    async fn draft_width_cancel_reaps_before_launch_and_restart_requeues() {
        let (directory, recipe, jobs) = fixture("exec /bin/sleep 60");
        jobs.reconcile(std::slice::from_ref(&recipe)).unwrap();
        jobs.start_next(std::slice::from_ref(&recipe)).unwrap();
        let pid = jobs.status()[0].pid.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(3), jobs.cancel())
            .await
            .unwrap()
            .unwrap();
        assert!(!Path::new(&format!("/proc/{pid}")).exists());
        assert_eq!(jobs.status()[0].status, "queued");
        let mut interrupted = jobs.status()[0].clone();
        interrupted.status = "running".into();
        interrupted.pid = Some(pid);
        crate::service::write_private(
            &jobs.path,
            &serde_json::to_vec(&BTreeMap::from([(recipe.key.clone(), interrupted)])).unwrap(),
        )
        .unwrap();
        let restored = DraftWidths::open(
            directory.path(),
            jobs.revision.clone(),
            jobs.activity.clone(),
        )
        .unwrap();
        assert_eq!(restored.status()[0].status, "queued");
        assert!(restored.status()[0].pid.is_none());
        restored.reconcile(&[]).unwrap();
        assert!(restored.status().is_empty());
    }

    #[tokio::test]
    async fn draft_width_failure_is_visible_and_not_retried() {
        let (directory, recipe, jobs) = fixture("printf 'calibration rejected' >&2\nexit 3");
        jobs.reconcile(std::slice::from_ref(&recipe)).unwrap();
        jobs.start_next(std::slice::from_ref(&recipe)).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(3), jobs.activity.notified())
            .await
            .unwrap();
        assert_eq!(jobs.status()[0].status, "failed");
        assert!(jobs.status()[0]
            .error
            .as_ref()
            .unwrap()
            .contains("exit status: 3"));
        assert!(jobs.status()[0]
            .diagnostic_tail
            .contains("calibration rejected"));
        let restored = DraftWidths::open(
            directory.path(),
            jobs.revision.clone(),
            jobs.activity.clone(),
        )
        .unwrap();
        restored.reconcile(std::slice::from_ref(&recipe)).unwrap();
        restored.start_next(&[recipe]).unwrap();
        assert!(!restored.busy());
    }
}
fn file_identity(path: &Path) -> Result<serde_json::Value, String> {
    let metadata = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let modified = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!([
        path,
        metadata.len(),
        modified.as_secs(),
        modified.subsec_nanos()
    ]))
}
impl Recipe {
    pub fn new(mut launch: EngineLaunch, configuration: Configuration) -> Result<Self, String> {
        configuration.validate()?;
        if crate::hardware_profile::group_key(&configuration.gpu_uuids)
            != crate::hardware_profile::group_key(&launch.gpu_uuids)
        {
            return Err(
                "Draft calibration hardware profile must match the deployment GPU group".into(),
            );
        }
        let profile: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&configuration.profile_path).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if profile["schema_version"] != 2
            || profile["fingerprint"].as_str().is_none_or(str::is_empty)
        {
            return Err("Draft calibration requires a complete v2 hardware profile".into());
        }
        launch.instance_id = Uuid::nil();
        launch.port = 0;
        launch.benchmark_profile = None;
        let artifacts = std::iter::once(&launch.artifact)
            .chain(&launch.artifact_dependencies)
            .map(|path| file_identity(path))
            .collect::<Result<Vec<_>, _>>()?;
        let serve = configuration.engine.with_file_name(if cfg!(windows) {
            "ginfer-serve.exe"
        } else {
            "ginfer-serve"
        });
        let key = hex::encode(Sha256::digest(serde_json::to_vec(&serde_json::json!({
            "launch": launch, "artifacts": artifacts, "cli": file_identity(&configuration.engine)?,
            "serve": file_identity(&serve)?, "profile": configuration.profile_path,
            "hardware": profile["fingerprint"],
        })).map_err(|e| e.to_string())?));
        Ok(Self {
            launch,
            configuration,
            key,
        })
    }
    fn args(&self) -> Vec<OsString> {
        let launch = &self.launch;
        let mut args = Vec::new();
        if launch.artifact_set {
            args.extend([
                "--tp-artifact-set".into(),
                launch.artifact.as_os_str().to_owned(),
                "--tp-fallback".into(),
                "reject".into(),
            ]);
        } else {
            args.push(launch.artifact.as_os_str().to_owned());
        }
        args.extend([
            "--calibrate-draft-width".into(),
            "--hardware-profile".into(),
            self.configuration.profile_path.as_os_str().to_owned(),
            "--tp".into(),
            launch.tp.to_string().into(),
            "--max-context".into(),
            launch.max_context.to_string().into(),
            "--max-concurrency".into(),
            launch.concurrency.to_string().into(),
        ]);
        args.extend(launch.options.args().into_iter().map(OsString::from));
        args
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Status {
    pub key: String,
    pub model_id: String,
    pub gpu_uuids: Vec<String>,
    pub max_context: u32,
    pub concurrency: u32,
    pub status: String,
    pub pid: Option<u32>,
    pub error: Option<String>,
    pub diagnostic_tail: String,
}
#[derive(Default)]
struct State {
    records: BTreeMap<String, Status>,
    running: Option<(String, watch::Sender<bool>)>,
    reap_error: Option<String>,
}
pub(crate) struct DraftWidths {
    path: PathBuf,
    state: Mutex<State>,
    idle: Notify,
    activity: Arc<Notify>,
    revision: Arc<AtomicU64>,
}
impl DraftWidths {
    pub fn open(
        directory: &Path,
        revision: Arc<AtomicU64>,
        activity: Arc<Notify>,
    ) -> Result<Arc<Self>, String> {
        let path = directory.join("draft-width-jobs.json");
        let mut records: BTreeMap<String, Status> = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| format!("Invalid draft calibration queue: {e}"))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(e) => return Err(e.to_string()),
        };
        for record in records.values_mut() {
            if matches!(record.status.as_str(), "running" | "cancelling") {
                record.status = "queued".into();
                record.pid = None;
            }
        }
        Ok(Arc::new(Self {
            path,
            state: Mutex::new(State {
                records,
                ..Default::default()
            }),
            idle: Notify::new(),
            activity,
            revision,
        }))
    }
    fn save(&self, state: &State) -> Result<(), String> {
        crate::service::write_private(
            &self.path,
            &serde_json::to_vec(&state.records).map_err(|e| e.to_string())?,
        )
    }
    pub fn status(&self) -> Vec<Status> {
        self.state
            .lock()
            .unwrap()
            .records
            .values()
            .cloned()
            .collect()
    }
    pub fn busy(&self) -> bool {
        self.state.lock().unwrap().running.is_some()
    }
    pub fn reconcile(&self, recipes: &[Recipe]) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        if state.running.is_some() {
            return Ok(());
        }
        let before = serde_json::to_vec(&state.records).map_err(|e| e.to_string())?;
        state
            .records
            .retain(|key, _| recipes.iter().any(|recipe| &recipe.key == key));
        for recipe in recipes {
            state
                .records
                .entry(recipe.key.clone())
                .or_insert_with(|| Status {
                    key: recipe.key.clone(),
                    model_id: recipe.launch.model_id.clone(),
                    gpu_uuids: recipe.launch.gpu_uuids.clone(),
                    max_context: recipe.launch.max_context,
                    concurrency: recipe.launch.concurrency,
                    status: "queued".into(),
                    pid: None,
                    error: None,
                    diagnostic_tail: String::new(),
                });
        }
        if before != serde_json::to_vec(&state.records).map_err(|e| e.to_string())? {
            self.save(&state)?;
            self.revision.fetch_add(1, Ordering::SeqCst);
        }
        Ok(())
    }
    pub fn start_next(self: &Arc<Self>, recipes: &[Recipe]) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        if state.running.is_some() {
            return Ok(());
        }
        let Some(recipe) = recipes.iter().find(|recipe| {
            state
                .records
                .get(&recipe.key)
                .is_some_and(|record| record.status == "queued")
        }) else {
            return Ok(());
        };
        let mut command = Command::new(&recipe.configuration.engine);
        command
            .args(recipe.args())
            .env("CUDA_VISIBLE_DEVICES", recipe.launch.gpu_uuids.join(","))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        if let Some(directory) = recipe.configuration.engine.parent() {
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
        #[cfg(target_os = "linux")]
        crate::hardware_profile::bind_parent_death(&mut command);
        #[cfg(not(windows))]
        let spawned = command.spawn();
        #[cfg(windows)]
        let spawned =
            crate::hardware_profile_windows::spawn(command.as_std()).map_err(std::io::Error::other);
        let mut child = match spawned {
            Ok(child) => child,
            Err(error) => {
                let record = state.records.get_mut(&recipe.key).unwrap();
                record.status = "failed".into();
                record.error = Some(error.to_string());
                self.save(&state)?;
                self.revision.fetch_add(1, Ordering::SeqCst);
                return Err(error.to_string());
            }
        };
        let record = state.records.get_mut(&recipe.key).unwrap();
        record.status = "running".into();
        record.pid = child.id();
        record.error = None;
        record.diagnostic_tail.clear();
        let (cancel, mut cancellation) = watch::channel(false);
        state.running = Some((recipe.key.clone(), cancel));
        state.reap_error = None;
        let preparation_error = self.save(&state).err();
        #[cfg(windows)]
        let preparation_error = preparation_error.or_else(|| child.resume().err());
        if preparation_error.is_some() {
            state.running.as_ref().unwrap().1.send_replace(true);
            let _ = child.start_kill();
        }
        let owner = self.clone();
        let key = recipe.key.clone();
        let diagnostics = Arc::new(Mutex::new(VecDeque::new()));
        #[cfg(not(windows))]
        let stdout = child.stdout.take().expect("piped stdout");
        #[cfg(not(windows))]
        let stderr = child.stderr.take().expect("piped stderr");
        #[cfg(windows)]
        let stdout = child.take_stdout().expect("piped stdout");
        #[cfg(windows)]
        let stderr = child.take_stderr().expect("piped stderr");
        let mut readers = vec![
            crate::engine_host::capture_output(stdout, diagnostics.clone()),
            crate::engine_host::capture_output(stderr, diagnostics.clone()),
        ];
        self.revision.fetch_add(1, Ordering::SeqCst);
        tokio::spawn(async move {
            let outcome = loop {
                let result = if *cancellation.borrow() {
                    let _ = child.start_kill();
                    child.wait().await
                } else {
                    tokio::select! { result = child.wait() => result,
                    _ = cancellation.changed() => { let _ = child.start_kill(); child.wait().await } }
                };
                match result {
                    Ok(exit) => break exit,
                    Err(error) => {
                        {
                            let mut state = owner.state.lock().unwrap();
                            let error = format!("Cannot reap draft calibration: {error}");
                            state.reap_error = Some(error.clone());
                            let record = state.records.get_mut(&key).unwrap();
                            record.status = "cancelling".into();
                            record.error = Some(error);
                            let _ = owner.save(&state);
                            owner.revision.fetch_add(1, Ordering::SeqCst);
                        }
                        owner.idle.notify_waiters();
                        if cancellation.changed().await.is_err() {
                            return;
                        }
                    }
                }
            };
            for reader in &mut readers {
                if tokio::time::timeout(std::time::Duration::from_secs(1), &mut *reader)
                    .await
                    .is_err()
                {
                    reader.abort();
                }
            }
            let mut state = owner.state.lock().unwrap();
            let record = state.records.get_mut(&key).unwrap();
            record.pid = None;
            record.diagnostic_tail =
                String::from_utf8_lossy(diagnostics.lock().unwrap().make_contiguous()).into_owned();
            if let Some(error) = preparation_error {
                record.status = "failed".into();
                record.error = Some(error);
            } else if *cancellation.borrow() {
                record.status = "queued".into();
            } else if outcome.success() {
                record.status = "completed".into();
            } else {
                record.status = "failed".into();
                record.error = Some(format!("Draft calibration exited: {outcome}"));
            }
            if let Err(error) = owner.save(&state) {
                let record = state.records.get_mut(&key).unwrap();
                record.status = "failed".into();
                record.error = Some(error);
            }
            state.running = None;
            state.reap_error = None;
            owner.revision.fetch_add(1, Ordering::SeqCst);
            drop(state);
            owner.idle.notify_waiters();
            owner.activity.notify_one();
        });
        Ok(())
    }
    pub async fn cancel(&self) -> Result<(), String> {
        loop {
            let idle = self.idle.notified();
            tokio::pin!(idle);
            idle.as_mut().enable();
            {
                let state = self.state.lock().unwrap();
                let Some((_, cancel)) = &state.running else {
                    return Ok(());
                };
                cancel.send_replace(true);
                if let Some(error) = &state.reap_error {
                    return Err(error.clone());
                }
            }
            idle.await;
        }
    }
}
