use std::{path::PathBuf, sync::Arc};

use gbot_service::{
    api::{Api, ApiClient},
    executor::{ExecutorProcesses, ProcessSpec},
    service::Service,
    vault::NativeVault,
};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime, State};
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
                match (
                    std::env::var_os("GBOT_CUA_PYTHON"),
                    std::env::var("GBOT_CONTEXT_PREPARER"),
                ) {
                    (Some(python), Ok(context)) => {
                        api = api
                            .with_executor(
                                root.join("tasks"),
                                ExecutorProcesses {
                                    python: ProcessSpec {
                                        program: python.into(),
                                        args: Vec::new(),
                                    },
                                    context: ProcessSpec {
                                        program: "node".into(),
                                        args: vec![context],
                                    },
                                },
                            )
                            .await
                            .map_err(|error| error.to_string())?;
                    }
                    (None, Err(_)) => {}
                    _ => {
                        return Err(
                            "Set both GBOT_CUA_PYTHON and GBOT_CONTEXT_PREPARER for bot tasks"
                                .into(),
                        )
                    }
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
