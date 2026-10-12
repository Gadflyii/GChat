use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use gbot_service::{
    api::{Api, ApiClient},
    executor::{ExecutorProcesses, ProcessSpec},
    service::Service,
    vault::NativeVault,
};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::sync::{oneshot, Mutex, OnceCell};

struct RunningService {
    client: ApiClient,
    stop: Mutex<Option<oneshot::Sender<()>>>,
    job: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

#[derive(Default)]
pub struct GbotState {
    service: OnceCell<RunningService>,
}

fn packaged_executor(resource_dir: &Path) -> Result<Option<ExecutorProcesses>, String> {
    // Only the accepted Ubuntu 24.04 x86-64 closure is packaged today.
    if !cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        return Ok(None);
    }
    let root = resource_dir.join("resources/gbot");
    let manifest = match std::fs::read(root.join("runtime.json")) {
        Ok(manifest) => manifest,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Read packaged Gbot runtime: {error}")),
    };
    let manifest: Value = serde_json::from_slice(&manifest)
        .map_err(|error| format!("Read packaged Gbot runtime manifest: {error}"))?;
    if manifest["schema"] != "gbot-cua-runtime-v1"
        || manifest["platform"] != "linux-x64"
        || manifest["python_version"] != "3.12.3"
        || manifest["sdk_revision"] != "0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc"
        || manifest["agent_revision"] != "896c68871da6f3a659c58f341781a977ada20459"
        || manifest["package_count"] != 61
    {
        return Err("Unsupported packaged Gbot runtime".into());
    }
    let python = root.join("python/bin/python");
    let bun = resource_dir.join("resources/bin/bun");
    let context = root.join("context-preparer.ts");
    for path in [
        python.clone(),
        root.join("python/bin/python3.12"),
        root.join("python/lib/python3.12/os.py"),
        root.join("python/lib/python3.12/dist-packages/cua_agent/loops/ginfer.py"),
        bun.clone(),
        context.clone(),
        root.join("smart-context.ts"),
    ] {
        if !path
            .metadata()
            .is_ok_and(|file| file.is_file() && file.len() > 0)
        {
            return Err(format!(
                "Missing packaged Gbot runtime file: {}",
                path.display()
            ));
        }
    }
    Ok(Some(ExecutorProcesses {
        python: ProcessSpec {
            program: python,
            args: Vec::new(),
        },
        context: ProcessSpec {
            program: bun,
            args: vec![context.to_string_lossy().into_owned()],
        },
    }))
}

fn executor_processes<R: Runtime>(app: &AppHandle<R>) -> Result<Option<ExecutorProcesses>, String> {
    match (
        std::env::var_os("GBOT_CUA_PYTHON"),
        std::env::var("GBOT_CONTEXT_PREPARER"),
    ) {
        (Some(python), Ok(context)) => Ok(Some(ExecutorProcesses {
            python: ProcessSpec {
                program: python.into(),
                args: Vec::new(),
            },
            context: ProcessSpec {
                program: "node".into(),
                args: vec![context],
            },
        })),
        (None, Err(_)) => {
            let packaged = app
                .path()
                .resource_dir()
                .map_err(|error| error.to_string())
                .and_then(|root| packaged_executor(&root));
            match packaged {
                Ok(processes) => Ok(processes),
                Err(error) => {
                    log::warn!("Gbot tasks unavailable: {error}");
                    Ok(None)
                }
            }
        }
        _ => Err("Set both GBOT_CUA_PYTHON and GBOT_CONTEXT_PREPARER for bot tasks".into()),
    }
}

impl GbotState {
    async fn client<R: Runtime>(
        &self,
        app: AppHandle<R>,
        root: PathBuf,
    ) -> Result<&ApiClient, String> {
        let running = self
            .service
            .get_or_try_init(|| async {
                let root = root.join("gbot");
                let service = Arc::new(
                    Service::open(root.join("state.json"))
                        .await
                        .map_err(|error| error.to_string())?,
                );
                let mut api = Api::bind(service, Arc::new(NativeVault), 0)
                    .await
                    .map_err(|error| error.to_string())?;
                if let Some(processes) = executor_processes(&app)? {
                    api = api
                        .with_executor(root.join("tasks"), processes)
                        .await
                        .map_err(|error| error.to_string())?;
                }
                let client = api.client();
                let mut updates = client.subscribe_tasks();
                let (stop, shutdown) = oneshot::channel();
                let job = tauri::async_runtime::spawn(async move {
                    let listener = async move {
                        if let Some(updates) = &mut updates {
                            while updates.changed().await.is_ok() {
                                let _ = app.emit("gbot-task-update", ());
                            }
                        } else {
                            std::future::pending::<()>().await;
                        }
                    };
                    let server = api.serve(async {
                        let _ = shutdown.await;
                    });
                    tokio::pin!(server, listener);
                    let result = tokio::select! {
                        result = &mut server => result,
                        () = &mut listener => server.await,
                    };
                    if let Err(error) = result {
                        log::error!("Gbot service stopped: {error}");
                    }
                });
                Ok::<_, String>(RunningService {
                    client,
                    stop: Mutex::new(Some(stop)),
                    job: Mutex::new(Some(job)),
                })
            })
            .await?;
        Ok(&running.client)
    }

    pub async fn shutdown(&self) {
        if let Some(service) = self.service.get() {
            if let Some(stop) = service.stop.lock().await.take() {
                let _ = stop.send(());
            }
            if let Some(job) = service.job.lock().await.take() {
                let _ = job.await;
            }
        }
    }
}

fn supported_route(path: &str) -> bool {
    matches!(
        path,
        "/v1/state"
            | "/v1/credentials/ssh"
            | "/v1/workspaces"
            | "/v1/assignments/save"
            | "/v1/assignments/get"
            | "/v1/connect"
            | "/v1/disconnect"
            | "/v1/tasks"
            | "/v1/tasks/start"
            | "/v1/tasks/resume"
            | "/v1/tasks/cancel"
            | "/v1/tasks/approvals"
            | "/v1/tasks/approval"
            | "/v1/control/take-over"
            | "/v1/control/hand-back"
    )
}

#[tauri::command]
pub async fn gbot_command<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, GbotState>,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    if !supported_route(&path) {
        return Err("Unsupported Gbot operation".into());
    }
    let root = crate::core::app::commands::get_jan_data_folder_path(app.clone());
    state
        .client(app, root)
        .await?
        .call(&path, body.unwrap_or(Value::Null))
        .await
}

#[cfg(all(test, target_os = "linux", target_arch = "x86_64"))]
mod tests {
    use super::packaged_executor;

    #[test]
    fn packaged_runtime_discovers_commands_and_rejects_incomplete_resources() {
        let directory = tempfile::tempdir().unwrap();
        let resource_dir = directory.path();
        assert!(packaged_executor(resource_dir).unwrap().is_none());
        let root = resource_dir.join("resources/gbot");
        for name in [
            "gbot/python/bin/python",
            "gbot/python/bin/python3.12",
            "gbot/python/lib/python3.12/os.py",
            "gbot/python/lib/python3.12/dist-packages/cua_agent/loops/ginfer.py",
            "gbot/context-preparer.ts",
            "gbot/smart-context.ts",
            "bin/bun",
        ] {
            let path = resource_dir.join("resources").join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "resource").unwrap();
        }
        std::fs::write(
            root.join("runtime.json"),
            serde_json::json!({
                "schema": "gbot-cua-runtime-v1", "platform": "linux-x64",
                "python_version": "3.12.3", "package_count": 61,
                "sdk_revision": "0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc",
                "agent_revision": "896c68871da6f3a659c58f341781a977ada20459"
            })
            .to_string(),
        )
        .unwrap();
        let processes = packaged_executor(resource_dir).unwrap().unwrap();
        assert_eq!(processes.python.program, root.join("python/bin/python"));
        assert_eq!(
            processes.context.program,
            resource_dir.join("resources/bin/bun")
        );
        assert_eq!(
            processes.context.args,
            vec![root
                .join("context-preparer.ts")
                .to_string_lossy()
                .into_owned()]
        );
        std::fs::remove_file(resource_dir.join("resources/bin/bun")).unwrap();
        assert!(packaged_executor(resource_dir).is_err());
    }
}
