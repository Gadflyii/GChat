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
    views: BTreeMap<uuid::Uuid, ViewLease>,
    generation: u64,
    stopped: bool,
    local_stopped: bool,
}
struct ViewLease {
    client: ServiceClient,
    bridge: Option<tokio::task::JoinHandle<()>>,
    close: Value,
}
async fn close_views(views: BTreeMap<uuid::Uuid, ViewLease>) {
    let closes = views.into_values().map(|view| async move {
        if let Some(bridge) = view.bridge {
            bridge.abort();
        }
        let _ = view.client.call("/v1/view/close", view.close).await;
    });
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        futures_util::future::join_all(closes),
    )
    .await;
}
impl Connection {
    fn detach(&mut self) -> BTreeMap<uuid::Uuid, ViewLease> {
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
    view_operations: Mutex<()>,
    connector_client_id: uuid::Uuid,
}
impl Default for GbotState {
    fn default() -> Self {
        Self {
            connection: Mutex::new(Connection::default()),
            view_operations: Mutex::new(()),
            connector_client_id: uuid::Uuid::new_v4(),
        }
    }
}
impl GbotState {
    #[cfg(test)]
    pub(crate) fn stopped_for_test() -> Self {
        Self {
            connection: Mutex::new(Connection {
                stopped: true,
                local_stopped: true,
                ..Connection::default()
            }),
            ..Self::default()
        }
    }

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
        // Serialize explicit opens/closes, while disconnect and selection can still
        // detach an in-flight open and fence its returned ticket by generation.
        let _view_operation = if matches!(path, "/v1/view/open" | "/v1/view/close") {
            Some(self.view_operations.lock().await)
        } else {
            None
        };
        let generation = self.call_generation().await?;
        let client = self.client(app).await?;
        if path == "/v1/view/open" {
            self.retire_views(&body["identity"], generation, |client, close| async move {
                client.call("/v1/view/close", close).await
            })
            .await?;
        }
        let mut result = client.call(path, body.clone()).await;
        if path == "/v1/view/open" {
            if let Ok(ticket) = &mut result {
                let lease = serde_json::from_value::<uuid::Uuid>(ticket["lease_id"].clone())
                    .map_err(|_| "Invalid view lease")?;
                let close = ginfer_host::gbot_bootstrap::view_close_request(&body, lease);
                let bridge = match &client {
                    ServiceClient::Local(_) => Ok(None),
                    ServiceClient::Remote { hosts, host_id } => {
                        match ticket["ws_url"].as_str() {
                            Some(endpoint) => hosts.gbot_view_bridge(*host_id, endpoint).await.map(
                                |(url, bridge)| {
                                    ticket["ws_url"] = Value::String(url);
                                    Some(bridge)
                                },
                            ),
                            None => Err("View endpoint missing".into()),
                        }
                    }
                };
                let bridge = match bridge {
                    Ok(bridge) => bridge,
                    Err(error) => {
                        let _ = client.call("/v1/view/close", close).await;
                        return Err(error);
                    }
                };
                let view = ViewLease {
                    client: client.clone(),
                    bridge,
                    close,
                };
                if let Err(view) = self.track_view(lease, view, generation).await {
                    let mut views = BTreeMap::new();
                    views.insert(lease, view);
                    close_views(views).await;
                    return Err("Gbot service changed while opening the desktop".into());
                }
            }
        } else if path == "/v1/view/close" && result.is_ok() {
            if let Ok(lease) = serde_json::from_value::<uuid::Uuid>(body["lease_id"].clone()) {
                let mut connection = self.connection.lock().await;
                if connection.generation == generation
                    && connection
                        .views
                        .get(&lease)
                        .is_some_and(|view| view.close == body)
                {
                    if let Some(view) = connection.views.remove(&lease) {
                        if let Some(bridge) = view.bridge {
                            bridge.abort();
                        }
                    }
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
    async fn call_generation(&self) -> Result<u64, String> {
        let connection = self.connection.lock().await;
        if connection.stopped {
            return Err("Gbot service disconnected. Connect to the service to continue.".into());
        }
        Ok(connection.generation)
    }
    async fn track_view(
        &self,
        lease: uuid::Uuid,
        view: ViewLease,
        generation: u64,
    ) -> Result<(), ViewLease> {
        let mut connection = self.connection.lock().await;
        if connection.generation != generation {
            return Err(view);
        }
        connection.views.insert(lease, view);
        Ok(())
    }
    async fn retire_views<F, Fut>(
        &self,
        identity: &Value,
        generation: u64,
        close: F,
    ) -> Result<(), String>
    where
        F: Fn(ServiceClient, Value) -> Fut,
        Fut: std::future::Future<Output = Result<Value, String>>,
    {
        let prior = {
            let connection = self.connection.lock().await;
            if connection.generation != generation {
                return Err("Gbot service changed while opening the desktop".into());
            }
            connection
                .views
                .iter()
                .filter(|(_, view)| &view.close["identity"] == identity)
                .map(|(lease, view)| (*lease, view.client.clone(), view.close.clone()))
                .collect::<Vec<_>>()
        };
        for (lease, client, body) in prior {
            // Use the recorded owner's exact close request, never the new
            // renderer's owner, and retain a failed lease for an explicit retry.
            close(client, body).await.map_err(|error| {
                format!("Could not close the previous desktop view; reconnect and retry: {error}")
            })?;
            let mut connection = self.connection.lock().await;
            if connection.generation != generation {
                return Err("Gbot service changed while opening the desktop".into());
            }
            if let Some(view) = connection.views.remove(&lease) {
                if let Some(bridge) = view.bridge {
                    bridge.abort();
                }
            }
        }
        if self.connection.lock().await.generation != generation {
            return Err("Gbot service changed while opening the desktop".into());
        }
        Ok(())
    }
    pub async fn disconnect(&self) {
        let (client, root, views) = {
            let mut connection = self.connection.lock().await;
            connection.stopped = true;
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
    use super::{GbotState, ServiceClient, ViewLease};
    use serde_json::{json, Value};
    use std::sync::Arc;
    use uuid::Uuid;

    struct UnusedCredentials;
    impl ginfer_host::client::CredentialStore for UnusedCredentials {
        fn get(&self, _: Uuid) -> ginfer_host::client::CredentialFuture<'_, String> {
            Box::pin(async { Err("unexpected credential access".into()) })
        }
        fn set<'a>(&'a self, _: Uuid, _: &'a str) -> ginfer_host::client::CredentialFuture<'a, ()> {
            Box::pin(async { Err("unexpected credential write".into()) })
        }
        fn delete(&self, _: Uuid) -> ginfer_host::client::CredentialFuture<'_, ()> {
            Box::pin(async { Err("unexpected credential deletion".into()) })
        }
    }
    fn view_fixture(identity: Value, owner: Uuid, lease: Uuid) -> ViewLease {
        ViewLease {
            client: ServiceClient::Remote {
                hosts: Arc::new(ginfer_host::client::Client::new(
                    None,
                    Arc::new(UnusedCredentials),
                )),
                host_id: Uuid::new_v4(),
            },
            bridge: None,
            close: json!({"identity":identity,"owner":owner,"lease_id":lease}),
        }
    }

    #[tokio::test]
    async fn replacing_view_closes_recorded_owner_only_for_the_same_session() {
        let state = GbotState::default();
        let identity = json!({"workspace_id":Uuid::new_v4(),"session_id":Uuid::new_v4()});
        let other_session =
            json!({"workspace_id":identity["workspace_id"],"session_id":Uuid::new_v4()});
        let lease = Uuid::new_v4();
        let other = Uuid::new_v4();
        let recorded_owner = Uuid::new_v4();
        let mut view = view_fixture(identity.clone(), recorded_owner, lease);
        let expected_close = view.close.clone();
        let bridge = tokio::spawn(std::future::pending::<()>());
        let aborted = bridge.abort_handle();
        view.bridge = Some(bridge);
        assert!(state.track_view(lease, view, 0).await.is_ok());
        assert!(state
            .track_view(other, view_fixture(other_session, Uuid::new_v4(), other), 0)
            .await
            .is_ok());
        state
            .retire_views(&identity, 0, |_, body| {
                assert_eq!(body, expected_close);
                async { Ok(Value::Null) }
            })
            .await
            .unwrap();
        tokio::task::yield_now().await;
        assert!(aborted.is_finished());
        let connection = state.connection.lock().await;
        assert_eq!(connection.views.len(), 1);
        assert!(connection.views.contains_key(&other));
    }

    #[tokio::test]
    async fn failed_previous_view_close_blocks_replacement_and_preserves_exact_retry() {
        let state = GbotState::default();
        let identity = json!({"workspace_id":Uuid::new_v4(),"session_id":Uuid::new_v4()});
        let lease = Uuid::new_v4();
        let view = view_fixture(identity.clone(), Uuid::new_v4(), lease);
        let expected_close = view.close.clone();
        assert!(state.track_view(lease, view, 0).await.is_ok());
        let error = state
            .retire_views(&identity, 0, |_, body| {
                assert_eq!(body, expected_close);
                async { Err("close refused".into()) }
            })
            .await
            .unwrap_err();
        assert!(error.contains("close refused"));
        assert_eq!(
            state.connection.lock().await.views[&lease].close,
            expected_close
        );
        state
            .retire_views(&identity, 0, |_, body| {
                assert_eq!(body, expected_close);
                async { Ok(Value::Null) }
            })
            .await
            .unwrap();
        assert!(state.connection.lock().await.views.is_empty());
    }

    #[tokio::test]
    async fn detach_retires_unbridged_tickets_and_rejects_late_open_completion() {
        let state = GbotState::default();
        let identity = json!({"workspace_id":Uuid::new_v4(),"session_id":Uuid::new_v4()});
        let lease = Uuid::new_v4();
        let view = view_fixture(identity.clone(), Uuid::new_v4(), lease);
        let expected_close = view.close.clone();
        assert!(state.track_view(lease, view, 0).await.is_ok());
        let detached = state.connection.lock().await.detach();
        assert_eq!(detached[&lease].close, expected_close);
        assert!(detached[&lease].bridge.is_none());
        let late = Uuid::new_v4();
        let rejected = state
            .track_view(late, view_fixture(identity, Uuid::new_v4(), late), 0)
            .await;
        let rejected = match rejected {
            Err(view) => view,
            Ok(()) => panic!("late view must be returned for cleanup"),
        };
        assert_eq!(rejected.close["lease_id"], json!(late));
        let connection = state.connection.lock().await;
        assert_eq!(connection.generation, 1);
        assert!(connection.views.is_empty());
    }

    #[tokio::test]
    async fn disconnect_during_previous_close_cannot_admit_a_replacement() {
        let state = GbotState::default();
        let identity = json!({"workspace_id":Uuid::new_v4(),"session_id":Uuid::new_v4()});
        let lease = Uuid::new_v4();
        assert!(state
            .track_view(
                lease,
                view_fixture(identity.clone(), Uuid::new_v4(), lease),
                0
            )
            .await
            .is_ok());
        let error = state
            .retire_views(&identity, 0, |_, _| async {
                let detached = state.connection.lock().await.detach();
                assert_eq!(detached.len(), 1);
                Ok(Value::Null)
            })
            .await
            .unwrap_err();
        assert!(error.contains("service changed"));
        let connection = state.connection.lock().await;
        assert_eq!(connection.generation, 1);
        assert!(connection.views.is_empty());
    }

    #[tokio::test]
    async fn queued_view_open_is_rejected_after_native_disconnect() {
        let state = Arc::new(GbotState::default());
        let active_open = state.view_operations.lock().await;
        let queued_state = state.clone();
        let queued_open = tokio::spawn(async move {
            let _operation = queued_state.view_operations.lock().await;
            queued_state.call_generation().await
        });
        state.disconnect().await;
        drop(active_open);
        let error = queued_open.await.unwrap().unwrap_err();
        assert!(error.contains("disconnected"));
        assert!(state.connection.lock().await.views.is_empty());
    }

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
