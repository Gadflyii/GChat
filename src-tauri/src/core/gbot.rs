use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::sync::Mutex;

mod background;
mod cloud;
mod inference;
#[cfg(target_os = "linux")]
pub(crate) use background::credential_control;
pub use background::run_service_mode;
pub(crate) use background::Client;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ServiceTarget {
    #[default]
    Local,
    PairedHost {
        host_id: uuid::Uuid,
    },
}
fn service_target(root: &Path) -> Result<ServiceTarget, String> {
    match std::fs::read(root.join("gbot-service-target.json")) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|e| format!("Gbot service selection: {e}"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(ServiceTarget::Local),
        Err(e) => Err(e.to_string()),
    }
}
fn save_service_target(root: &Path, target: &ServiceTarget) -> Result<(), String> {
    ginfer_host::service::write_private(
        &root.join("gbot-service-target.json"),
        &serde_json::to_vec(target).map_err(|e| e.to_string())?,
    )
}
#[derive(Clone)]
enum ServiceClient {
    Local(background::Client),
    Remote {
        hosts: Arc<ginfer_host::client::Client>,
        host_id: uuid::Uuid,
    },
}
impl ServiceClient {
    async fn call(&self, path: &str, body: Value) -> Result<Value, String> {
        match self {
            Self::Local(client) => client.call(path, body).await,
            Self::Remote { hosts, host_id } => hosts.gbot_call(*host_id, path, body).await,
        }
    }
}
#[derive(Default)]
struct Connection {
    root: Option<PathBuf>,
    client: Option<ServiceClient>,
    local_client: Option<background::Client>,
    updates: Option<tauri::async_runtime::JoinHandle<()>>,
    views: BTreeMap<uuid::Uuid, RemoteView>,
    generation: u64,
    stopped: bool,
    local_stopped: bool,
}
struct RemoteView {
    client: ServiceClient,
    bridge: tokio::task::JoinHandle<()>,
    close: Value,
}
async fn close_views(views: BTreeMap<uuid::Uuid, RemoteView>) {
    let closes = views.into_values().map(|view| async move {
        view.bridge.abort();
        let _ = view.client.call("/v1/view/close", view.close).await;
    });
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        futures_util::future::join_all(closes),
    )
    .await;
}
impl Connection {
    fn detach(&mut self) -> BTreeMap<uuid::Uuid, RemoteView> {
        self.client = None;
        self.generation += 1;
        if let Some(updates) = self.updates.take() {
            updates.abort();
        }
        std::mem::take(&mut self.views)
    }
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
        self.connection.lock().await.local_stopped
    }
    async fn root<R: Runtime>(&self, app: &AppHandle<R>) -> Result<PathBuf, String> {
        crate::core::setup::wait_for_bundled_resources(app).await?;
        let root = crate::core::app::commands::get_jan_data_folder_path(app.clone());
        let mut connection = self.connection.lock().await;
        if connection.root.as_ref().is_some_and(|known| known != &root) {
            return Err("GChat data folder changed; restart GChat before Gbot operations".into());
        }
        connection.root = Some(root.clone());
        Ok(root)
    }
    /// Ordinary Chat connectors always belong to this computer's service.
    pub(crate) async fn local_client<R: Runtime>(
        &self,
        app: &AppHandle<R>,
    ) -> Result<background::Client, String> {
        let root = self.root(app).await?;
        let mut connection = self.connection.lock().await;
        if connection.local_stopped {
            return Err("Start the local Gbot service to use connected accounts".into());
        }
        if let Some(client) = &connection.local_client {
            return Ok(client.clone());
        }
        let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
        let client = background::ensure_running(&root, &resources).await?;
        connection.local_client = Some(client.clone());
        Ok(client)
    }
    async fn client<R: Runtime>(&self, app: &AppHandle<R>) -> Result<ServiceClient, String> {
        let root = self.root(app).await?;
        let target = service_target(&root)?;
        let mut connection = self.connection.lock().await;
        if connection.stopped {
            return Err("Gbot service disconnected. Connect to the service to continue.".into());
        }
        if let Some(client) = &connection.client {
            return Ok(client.clone());
        }
        let client = match target {
            ServiceTarget::Local => {
                if connection.local_stopped {
                    return Err("Start the local Gbot service to continue".into());
                }
                let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
                let client = background::ensure_running(&root, &resources).await?;
                connection.local_client = Some(client.clone());
                ServiceClient::Local(client)
            }
            ServiceTarget::PairedHost { host_id } => ServiceClient::Remote {
                hosts: crate::core::engine_hosts::shared_client().await?,
                host_id,
            },
        };
        connection.client = Some(client.clone());
        if let Some(updates) = connection.updates.take() {
            updates.abort();
        }
        let app = app.clone();
        let listener = client.clone();
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
                        break;
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
        let generation = self.connection.lock().await.generation;
        let client = self.client(app).await?;
        let mut result = client.call(path, body.clone()).await;
        if path == "/v1/view/open" {
            if let (ServiceClient::Remote { hosts, host_id }, Ok(ticket)) = (&client, &mut result) {
                let lease = serde_json::from_value::<uuid::Uuid>(ticket["lease_id"].clone())
                    .map_err(|_| "Invalid view lease")?;
                let close = ginfer_host::gbot_bootstrap::view_close_request(&body, lease);
                let endpoint = ticket["ws_url"].as_str().ok_or("View endpoint missing")?;
                match hosts.gbot_view_bridge(*host_id, endpoint).await {
                    Ok((url, bridge)) => {
                        ticket["ws_url"] = Value::String(url);
                        let mut connection = self.connection.lock().await;
                        if connection.generation != generation {
                            bridge.abort();
                            drop(connection);
                            let _ = client.call("/v1/view/close", close).await;
                            return Err("Gbot service changed while opening the desktop".into());
                        }
                        connection.views.insert(
                            lease,
                            RemoteView {
                                client: client.clone(),
                                bridge,
                                close,
                            },
                        );
                    }
                    Err(error) => {
                        let _ = client.call("/v1/view/close", close).await;
                        return Err(error);
                    }
                }
            }
        } else if path == "/v1/view/close" && result.is_ok() {
            if let Ok(lease) = serde_json::from_value::<uuid::Uuid>(body["lease_id"].clone()) {
                if let Some(view) = self.connection.lock().await.views.remove(&lease) {
                    view.bridge.abort();
                }
            }
        }
        // Never retry a mutation whose effect may have reached the service.
        if result.is_err() {
            let mut connection = self.connection.lock().await;
            if connection.generation == generation {
                connection.client = None;
            }
        }
        result
    }
    pub async fn disconnect(&self) {
        let (client, root, views) = {
            let mut connection = self.connection.lock().await;
            let views = connection.detach();
            (
                connection.local_client.take(),
                connection.root.clone(),
                views,
            )
        };
        close_views(views).await;
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
                    serde_json::json!({"client_id":self.connector_client_id}),
                ),
            )
            .await;
        }
    }
    async fn select<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        target: ServiceTarget,
    ) -> Result<(), String> {
        let root = self.root(app).await?;
        if let ServiceTarget::PairedHost { host_id } = &target {
            let hosts = crate::core::engine_hosts::shared_client().await?;
            hosts.gbot_grant(*host_id, "claim").await?;
            hosts.gbot_call(*host_id, "/v1/state", Value::Null).await?;
        }
        let mut connection = self.connection.lock().await;
        #[cfg(target_os = "linux")]
        {
            let bootstrap = ginfer_host::gbot_bootstrap::Bootstrap::capture(
                &root,
                &app.path().resource_dir().map_err(|e| e.to_string())?,
            )?;
            ginfer_host::gbot_login::reconcile(
                &bootstrap,
                ginfer_host::gbot_login::enabled(&root)? && target == ServiceTarget::Local,
            )?;
        }
        save_service_target(&root, &target)?;
        let views = connection.detach();
        connection.stopped = false;
        connection.local_stopped = false;
        drop(connection);
        close_views(views).await;
        let _ = app.emit("gbot-task-update", ());
        Ok(())
    }
    async fn quit<R: Runtime>(&self, app: &AppHandle<R>) -> Result<(), String> {
        let root = self.root(app).await?;
        let target = service_target(&root)?;
        let mut connection = self.connection.lock().await;
        if target == ServiceTarget::Local {
            let client = match &connection.local_client {
                Some(client) => client.clone(),
                None => background::connect(&root).await?,
            };
            client.call("/v1/service/shutdown", Value::Null).await?;
            connection.local_stopped = true;
            connection.local_client = None;
        }
        connection.stopped = true;
        let views = connection.detach();
        drop(connection);
        close_views(views).await;
        if target != ServiceTarget::Local {
            return Ok(());
        }
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
pub async fn gbot_service_target<R: Runtime>(app: AppHandle<R>) -> Result<ServiceTarget, String> {
    service_target(&crate::core::app::commands::get_jan_data_folder_path(app))
}
#[tauri::command]
pub async fn gbot_service_select<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, GbotState>,
    target: ServiceTarget,
) -> Result<(), String> {
    state.select(&app, target).await
}
#[tauri::command]
pub async fn gbot_service_set_enabled<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, GbotState>,
    enabled: bool,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let root = state.root(&app).await?;
        let _connection = state.connection.lock().await;
        let bootstrap = ginfer_host::gbot_bootstrap::Bootstrap::capture(
            &root,
            &app.path().resource_dir().map_err(|e| e.to_string())?,
        )?;
        ginfer_host::gbot_login::configure(
            &bootstrap,
            enabled,
            service_target(&root)? == ServiceTarget::Local,
        )
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, state, enabled);
        Ok(())
    }
}
#[tauri::command]
pub async fn gbot_service_grant(host_id: uuid::Uuid, action: String) -> Result<Value, String> {
    crate::core::engine_hosts::shared_client()
        .await?
        .gbot_grant(host_id, &action)
        .await
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
    {
        let mut connection = state.connection.lock().await;
        connection.stopped = false;
        connection.local_stopped = false;
    }
    state.client(&app).await.map(|_| ())
}
fn supported_route(path: &str) -> bool {
    path != "/v1/updates" && ginfer_host::gbot_control::supported_route(path)
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
    #[test]
    fn saved_service_target_survives_restart_without_silent_local_fallback() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(
            super::service_target(root.path()).unwrap(),
            super::ServiceTarget::Local
        );
        let remote = super::ServiceTarget::PairedHost {
            host_id: uuid::Uuid::new_v4(),
        };
        super::save_service_target(root.path(), &remote).unwrap();
        assert_eq!(super::service_target(root.path()).unwrap(), remote);
        std::fs::write(root.path().join("gbot-service-target.json"), "invalid").unwrap();
        assert!(super::service_target(root.path()).is_err());
    }

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
