use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::sync::Mutex;

mod background;
mod cloud;
mod inference;
#[cfg(target_os = "linux")]
pub(crate) use background::credential_control;
pub use background::run_service_mode;
pub(crate) use background::Client;

#[derive(Default)]
struct Connection {
    root: Option<PathBuf>,
    client: Option<background::Client>,
    updates: Option<tauri::async_runtime::JoinHandle<()>>,
    stopped: bool,
}

pub struct GbotState {
    connection: Mutex<Connection>,
    connector_client_id: uuid::Uuid,
}

impl Default for GbotState {
    fn default() -> Self {
        Self {
            connection: Mutex::new(Connection::default()),
            connector_client_id: uuid::Uuid::new_v4(),
        }
    }
}

impl GbotState {
    pub(crate) fn connector_client_id(&self) -> uuid::Uuid {
        self.connector_client_id
    }

    pub(crate) async fn is_stopped(&self) -> bool {
        self.connection.lock().await.stopped
    }

    pub(crate) async fn client<R: Runtime>(
        &self,
        app: &AppHandle<R>,
    ) -> Result<background::Client, String> {
        crate::core::setup::wait_for_bundled_resources(app).await?;
        let root = crate::core::app::commands::get_jan_data_folder_path(app.clone());
        let mut connection = self.connection.lock().await;
        if connection.stopped {
            return Err(
                "Gbot service was explicitly stopped. Start Gbot service to reconnect.".into(),
            );
        }
        if connection.root.as_ref().is_some_and(|known| known != &root) {
            return Err("GChat data folder changed; restart GChat before Gbot operations".into());
        }
        if let Some(client) = &connection.client {
            return Ok(client.clone());
        }
        let resources = app
            .path()
            .resource_dir()
            .map_err(|error| error.to_string())?;
        let client = background::ensure_running(&root, &resources).await?;
        connection.root = Some(root.clone());
        connection.client = Some(client.clone());
        if let Some(updates) = connection.updates.take() {
            updates.abort();
        }
        let app = app.clone();
        let mut listener = client.clone();
        connection.updates = Some(tauri::async_runtime::spawn(async move {
            let mut revision = serde_json::json!({"tasks":0,"setup":0});
            loop {
                match listener.call("/v1/updates", revision.clone()).await {
                    Ok(next) => {
                        if next["stopping"] == true {
                            break;
                        }
                        if next["tasks"] != revision["tasks"] {
                            let _ = app.emit("gbot-task-update", ());
                        }
                        if next["setup"] != revision["setup"] {
                            let _ = app.emit("gbot-setup-update", ());
                        }
                        revision = next;
                    }
                    Err(_) => {
                        let _ = app.emit("gbot-task-update", ());
                        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                        if let Ok(next) = background::connect(&root).await {
                            listener = next;
                        }
                    }
                }
            }
        }));
        Ok(client)
    }

    pub async fn call<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        path: &str,
        body: Value,
    ) -> Result<Value, String> {
        let client = self.client(app).await?;
        let result = client.call(path, body).await;
        // Never retry an operation whose effect may have reached the service.
        if result.is_err() {
            self.connection.lock().await.client = None;
        }
        result
    }

    /// Client exit cancels its ordinary connector effects, leaving bot tasks service-owned.
    pub async fn disconnect(&self) {
        let (client, root) = {
            let mut connection = self.connection.lock().await;
            if let Some(updates) = connection.updates.take() {
                updates.abort();
            }
            (connection.client.take(), connection.root.clone())
        };
        // An earlier request error may have invalidated the cached client while
        // another registered connector request is still running in the service.
        let client = match (client, root) {
            (Some(client), _) => Some(client),
            (None, Some(root)) => background::connect(&root).await.ok(),
            (None, None) => None,
        };
        if let Some(client) = client {
            let _ = tokio::time::timeout(
                std::time::Duration::from_secs(2),
                client.call(
                    "/v1/native/connectors/client_disconnected",
                    serde_json::json!({"client_id": self.connector_client_id}),
                ),
            )
            .await;
        }
    }

    async fn quit<R: Runtime>(&self, app: &AppHandle<R>) -> Result<(), String> {
        let root = crate::core::app::commands::get_jan_data_folder_path(app.clone());
        let mut connection = self.connection.lock().await;
        let client = match &connection.client {
            Some(client) => client.clone(),
            None => background::connect(&root).await?,
        };
        let _ = client.call("/v1/service/shutdown", Value::Null).await?;
        connection.stopped = true;
        connection.client = None;
        if let Some(updates) = connection.updates.take() {
            updates.abort();
        }
        // A stop is complete only after the process has drained tasks and released ownership.
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            if let Ok(owner) = ginfer_host::service_owner::ServiceOwner::acquire(&root.join("gbot"))
            {
                drop(owner);
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(
                    "Gbot is still stopping; wait before starting the service again".into(),
                );
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }
}

#[tauri::command]
pub async fn gbot_service_quit<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, GbotState>,
) -> Result<(), String> {
    state.quit(&app).await
}

#[tauri::command]
pub async fn gbot_service_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, GbotState>,
) -> Result<(), String> {
    state.connection.lock().await.stopped = false;
    state.client(&app).await.map(|_| ())
}

fn supported_route(path: &str) -> bool {
    matches!(
        path,
        "/v1/state"
            | "/v1/credentials/ssh"
            | "/v1/workspaces"
            | "/v1/workspaces/ssh"
            | "/v1/ssh/identity"
            | "/v1/workspaces/ssh/key"
            | "/v1/workspaces/ssh/check"
            | "/v1/workspaces/ssh/prepare"
            | "/v1/workspaces/ssh/tools"
            | "/v1/assignments/save"
            | "/v1/assignments/get"
            | "/v1/assignments/models"
            | "/v1/connectors/get"
            | "/v1/connectors/save"
            | "/v1/connect"
            | "/v1/disconnect"
            | "/v1/tasks"
            | "/v1/tasks/start"
            | "/v1/tasks/resume"
            | "/v1/tasks/cancel"
            | "/v1/tasks/approvals"
            | "/v1/tasks/approval"
            | "/v1/schedules"
            | "/v1/schedules/create"
            | "/v1/schedules/enabled"
            | "/v1/setup/kvm/preflight"
            | "/v1/setup/kvm/start"
            | "/v1/setup/kvm/status"
            | "/v1/setup/kvm/remove"
            | "/v1/setup/cloud/status"
            | "/v1/setup/cloud/catalog"
            | "/v1/setup/cloud/select"
            | "/v1/setup/cloud/confirm"
            | "/v1/setup/cloud/remove"
            | "/v1/setup/cloud/create"
            | "/v1/setup/cloud/check"
            | "/v1/setup/cloud/delete"
            | "/v1/setup/cloud/identity"
            | "/v1/setup/cloud/attach"
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
    state.call(&app, &path, body.unwrap_or(Value::Null)).await
}

#[cfg(all(test, target_os = "linux", target_arch = "x86_64"))]
mod tests {
    use super::{background::packaged_executor, supported_route};

    #[test]
    fn native_bridge_admits_transactional_setup_and_rejects_unknown_operations() {
        assert!(supported_route("/v1/workspaces/ssh"));
        assert!(supported_route("/v1/connectors/get"));
        assert!(supported_route("/v1/connectors/save"));
        assert!(!supported_route("/v1/workspaces/ssh/delete-all"));
        assert!(!supported_route("/v1/connectors/global-accounts"));
    }

    #[test]
    fn native_bridge_admits_guided_vm_setup_and_schedule_controls() {
        for path in [
            "/v1/setup/kvm/preflight",
            "/v1/setup/kvm/start",
            "/v1/setup/kvm/status",
            "/v1/setup/kvm/remove",
            "/v1/schedules",
            "/v1/schedules/create",
            "/v1/schedules/enabled",
        ] {
            assert!(supported_route(path), "{path}");
        }
        assert!(!supported_route("/v1/setup/kvm/exec"));
        assert!(!supported_route("/v1/schedules/dispatch"));
    }

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
