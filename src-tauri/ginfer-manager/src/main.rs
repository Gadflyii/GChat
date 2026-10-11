#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod vault;

use ginfer_host::{
    client::{Client, ClientError, CredentialStore, PairRequest},
    fleet::{AuthorityLocator, FleetUpdate},
    fleet_client::FleetClient,
};
use reqwest::Method;
use serde::{ser::SerializeMap, Deserialize, Serialize, Serializer};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tokio::sync::Mutex;
use uuid::Uuid;

struct ManagerState {
    client: Arc<Client>,
    fleet: FleetClient,
    view: Mutex<ManagerView>,
    initialized: Mutex<bool>,
    refresh: Mutex<()>,
    tray_ready: AtomicBool,
}

#[derive(Clone)]
struct ManagerView {
    snapshot: Arc<Value>,
    refresh_error: Option<String>,
}

impl ManagerView {
    fn new(snapshot: Value) -> Self {
        Self {
            snapshot: Arc::new(snapshot),
            refresh_error: None,
        }
    }
}

impl std::ops::Deref for ManagerView {
    type Target = Value;

    fn deref(&self) -> &Self::Target {
        &self.snapshot
    }
}

impl Serialize for ManagerView {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let Some(error) = &self.refresh_error else {
            return self.snapshot.serialize(serializer);
        };
        let object = self.snapshot.as_object().ok_or_else(|| {
            <S::Error as serde::ser::Error>::custom("Manager view must be an object")
        })?;
        let mut map = serializer.serialize_map(Some(
            object.len() + usize::from(!object.contains_key("refresh_error")),
        ))?;
        // Use the same key ordering as a Value object without copying its values.
        let mut keys = Map::new();
        for key in object.keys() {
            keys.insert(key.clone(), Value::Null);
        }
        keys.insert("refresh_error".into(), Value::Null);
        for key in keys.keys() {
            if key == "refresh_error" {
                map.serialize_entry(key, error)?;
            } else {
                map.serialize_entry(key, &object[key])?;
            }
        }
        map.end()
    }
}

#[derive(Serialize)]
struct ManagerResponse {
    result: Value,
    view: ManagerView,
}

fn project_hosts(
    registrations: Vec<Value>,
    snapshots: Vec<Result<Value, ClientError>>,
    previous: &Value,
) -> Vec<Value> {
    let mut previous_snapshots = None;
    let mut hosts = Vec::with_capacity(registrations.len());
    for (mut host, snapshot) in registrations.into_iter().zip(snapshots) {
        match snapshot {
            Ok(snapshot) => {
                host["online"] = true.into();
                host["offline"] = false.into();
                host["snapshot"] = snapshot;
                host["error"] = Value::Null;
            }
            Err(error) => {
                host["online"] = false.into();
                host["offline"] = error.is_offline().into();
                host["error"] = error.to_string().into();
                let previous_snapshots = previous_snapshots.get_or_insert_with(|| {
                    let previous_hosts = previous["hosts"].as_array();
                    let mut index = HashMap::with_capacity(previous_hosts.map_or(0, Vec::len));
                    for old in previous_hosts.into_iter().flatten() {
                        if let Some(id) = old["host_id"].as_str() {
                            // Preserve the first matching previous registration.
                            index.entry(id).or_insert(&old["snapshot"]);
                        }
                    }
                    index
                });
                host["snapshot"] = host["host_id"]
                    .as_str()
                    .and_then(|id| previous_snapshots.get(id))
                    .map(|snapshot| Value::clone(snapshot))
                    .unwrap_or(Value::Null);
            }
        }
        hosts.push(host);
    }
    hosts
}

fn local_share_request(view: &Value) -> Result<ManagerRequest, String> {
    let local = view["hosts"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|host| host["local"] == true && host["online"] == true)
        .ok_or("This computer is offline")?;
    let host_id = serde_json::from_value(local["host_id"].clone())
        .map_err(|error| error.to_string())?;
    Ok(ManagerRequest::Host {
        host_id,
        operation: HostOperation::Share,
        args: json!({"enabled":local["snapshot"]["lan_sharing"]["enabled"] != true}),
    })
}

fn refreshed_view(
    hosts: Vec<Value>,
    mut listed: Value,
    fleet: Value,
    client_name: Option<String>,
) -> ManagerView {
    let mut view = Map::new();
    view.insert("hosts".into(), Value::Array(hosts));
    view.insert("discovered".into(), listed["discovered"].take());
    view.insert("client_name".into(), client_name.map(Value::String).unwrap_or(Value::Null));
    view.insert("local_error".into(), listed["local_error"].take());
    view.insert("fleet".into(), fleet);
    ManagerView::new(Value::Object(view))
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum ManagerRequest {
    Pair {
        host_id: Option<Uuid>,
        base_url: Option<String>,
        client_name: Option<String>,
    },
    Discovery {
        enabled: bool,
    },
    Forget {
        host_id: Uuid,
    },
    SecureStorage,
    FleetConfigure {
        member_host_id: Uuid,
        authority: AuthorityLocator,
    },
    FleetUpdate {
        update: FleetUpdate,
    },
    Host {
        host_id: Uuid,
        operation: HostOperation,
        #[serde(default)]
        args: Value,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum HostOperation {
    Snapshot,
    Scan,
    Clients,
    Catalog,
    Storage,
    SetStorage,
    Download,
    DownloadAction,
    RemoveModel,
    LocalArtifact,
    Launch,
    ProfileLaunch,
    Instance,
    Share,
    Rename,
    Revoke,
}

impl ManagerState {
    async fn initialize(&self) -> Result<(), String> {
        let mut initialized = self.initialized.lock().await;
        if !*initialized {
            self.client.initialize_from_local_owner().await?;
            *initialized = true;
        }
        Ok(())
    }

    async fn refresh(&self) -> Result<ManagerView, String> {
        self.initialize().await?;
        let _refresh = self.refresh.lock().await;
        let mut listed = self.client.list().await?;
        let previous = self.view.lock().await.clone();
        let registrations = listed["registered"]
            .as_array_mut()
            .map(std::mem::take)
            .unwrap_or_default();
        let ids = registrations.iter().map(|host| {
            serde_json::from_value(host["host_id"].clone()).map_err(|error| error.to_string())
        }).collect::<Result<Vec<Uuid>, _>>()?;
        let snapshots = self.client.snapshots(&ids).await;
        let hosts = project_hosts(registrations, snapshots, &previous.snapshot);
        let fleet = match self.fleet.read().await {
            Ok(report) => serde_json::to_value(report).map_err(|error| error.to_string())?,
            Err(error) => json!({"connected":false,"snapshot":previous.snapshot["fleet"]["snapshot"],
                "authority":previous.snapshot["fleet"]["authority"],"error":error}),
        };
        let view = refreshed_view(
            hosts,
            listed,
            fleet,
            ginfer_host::local_host::computer_name().ok(),
        );
        *self.view.lock().await = view.clone();
        Ok(view)
    }

    async fn execute(&self, request: ManagerRequest) -> Result<Value, String> {
        self.initialize().await?;
        match request {
            ManagerRequest::Pair {
                host_id,
                base_url,
                client_name,
            } => {
                self.client
                    .pair(PairRequest {
                        host_id,
                        base_url,
                        client_name: match client_name {
                            Some(name) => name,
                            None => ginfer_host::local_host::computer_name()?,
                        },
                    })
                    .await
            }
            ManagerRequest::Discovery { enabled } => self.client.discovery(enabled).await,
            ManagerRequest::Forget { host_id } => self.client.forget(host_id).await,
            ManagerRequest::SecureStorage => {
                vault::NativeVault.ensure_ready().await?;
                Ok(json!({"ready":true}))
            }
            ManagerRequest::FleetConfigure {
                member_host_id,
                authority,
            } => {
                self.fleet.configure(member_host_id, authority).await?;
                Ok(json!({"ok":true}))
            }
            ManagerRequest::FleetUpdate { update } => {
                serde_json::to_value(self.fleet.update(update).await?)
                    .map_err(|error| error.to_string())
            }
            ManagerRequest::Host {
                host_id,
                operation,
                mut args,
            } => {
                // Keep inference and credentials outside the Manager UI.
                let (method, path) = match operation {
                    HostOperation::Snapshot => {
                        return self.client.snapshot(host_id).await.map_err(String::from)
                    }
                    HostOperation::Scan => (Method::POST, "/host/v1/scan".into()),
                    HostOperation::Clients => (Method::GET, "/host/v1/clients".into()),
                    HostOperation::Catalog => (Method::GET, "/host/v1/model-catalog".into()),
                    HostOperation::Storage => (Method::GET, "/host/v1/model-storage".into()),
                    HostOperation::SetStorage => (Method::POST, "/host/v1/model-storage".into()),
                    HostOperation::Download => (Method::POST, "/host/v1/downloads".into()),
                    HostOperation::DownloadAction => {
                        (Method::POST, "/host/v1/download-actions".into())
                    }
                    HostOperation::RemoveModel => (Method::POST, "/host/v1/remove-model".into()),
                    HostOperation::LocalArtifact => {
                        (Method::POST, "/host/v1/local-artifacts".into())
                    }
                    HostOperation::Launch => (Method::POST, "/host/v1/instances".into()),
                    HostOperation::ProfileLaunch => {
                        (Method::POST, "/host/v1/profile-launch".into())
                    }
                    HostOperation::Share => (Method::POST, "/host/v1/lan-sharing".into()),
                    HostOperation::Rename => (Method::POST, "/host/v1/name".into()),
                    HostOperation::Revoke => {
                        let id: Uuid = serde_json::from_value(args["client_id"].clone())
                            .map_err(|error| error.to_string())?;
                        (Method::DELETE, format!("/host/v1/clients/{id}"))
                    }
                    HostOperation::Instance => {
                        let id: Uuid = serde_json::from_value(args["instance_id"].clone())
                            .map_err(|error| error.to_string())?;
                        let action = args["operation"]
                            .as_str()
                            .ok_or("instance operation is required")?
                            .to_owned();
                        if !matches!(action.as_str(), "start" | "stop" | "reload") {
                            return Err("unknown instance operation".into());
                        }
                        if args.get("expected_session_id").is_none() {
                            return Err("Refresh this instance before changing its state".into());
                        }
                        let object = args
                            .as_object_mut()
                            .ok_or("instance arguments must be an object")?;
                        object.remove("instance_id");
                        object.remove("operation");
                        (Method::POST, format!("/host/v1/instances/{id}/{action}"))
                    }
                };
                let body = (method == Method::POST).then_some(&args);
                self.client
                    .request_json(host_id, method, &path, body)
                    .await
                    .map_err(String::from)
            }
        }
    }
}

#[cfg(test)]
#[path = "../../ginfer-host/tests/common/resource_measurement.rs"]
mod resource_measurement;

#[cfg(test)]
mod native_tests;

#[cfg(test)]
mod native_measurement;

fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

async fn publish(app: &tauri::AppHandle) -> Result<ManagerView, String> {
    let view = app.state::<ManagerState>().refresh().await?;
    if let Some(item) = app.try_state::<CheckMenuItem<tauri::Wry>>() {
        let local = view.snapshot["hosts"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|host| host["local"] == true);
        let _ = item.set_checked(
            local.is_some_and(|host| host["snapshot"]["lan_sharing"]["enabled"] == true),
        );
        let _ = item.set_enabled(local.is_some_and(|host| {
            host["online"] == true && host["snapshot"]["lan_sharing"]["managed"] == true
        }));
    }
    let _ = app.emit("manager-snapshot", &view);
    Ok(view)
}

#[tauri::command]
async fn manager_snapshot(app: tauri::AppHandle) -> Result<ManagerView, String> {
    publish(&app).await
}

#[tauri::command]
async fn manager_request(app: tauri::AppHandle, request: ManagerRequest) -> Result<ManagerResponse, String> {
    let result = app.state::<ManagerState>().execute(request).await?;
    // Keep tray state and visible controls on the same host-owned account.
    let view = match publish(&app).await {
        Ok(view) => view,
        Err(error) => {
            let mut view = app.state::<ManagerState>().view.lock().await.clone();
            view.refresh_error = Some(error);
            view
        }
    };
    Ok(ManagerResponse { result, view })
}

fn main() {
    let no_tray = std::env::args().any(|arg| arg == "--no-tray");
    let start_window = std::env::args().any(|arg| arg == "--window");
    let client = Arc::new(Client::new(None, Arc::new(vault::NativeVault)));
    let state = ManagerState {
        fleet: FleetClient::new(client.clone()),
        client,
        view: Mutex::new(ManagerView::new(json!({"hosts":[],"discovered":[],"fleet":null}))),
        initialized: Mutex::new(false),
        refresh: Mutex::new(()),
        tray_ready: AtomicBool::new(false),
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_window(app)))
        .manage(state)
        .invoke_handler(tauri::generate_handler![manager_snapshot, manager_request])
        .setup(move |app| {
            let handle = app.handle().clone();
            if !no_tray {
                let open = MenuItem::with_id(app, "open", "Open Server Manager", true, None::<&str>)?;
                let refresh = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
                let share = CheckMenuItem::with_id(app, "share", "Share this host", false, false, None::<&str>)?;
                let exit = MenuItem::with_id(app, "exit", "Exit Manager", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&open, &refresh, &share, &exit])?;
                let mut builder = TrayIconBuilder::with_id("manager").menu(&menu)
                    .tooltip("GInfer Server Manager").show_menu_on_left_click(true)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "open" => show_window(app),
                        "exit" => app.exit(0),
                        "refresh" | "share" => {
                            let share = event.id().as_ref() == "share";
                            let app = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let result = async {
                                    if share {
                                        let state = app.state::<ManagerState>();
                                        let request = {
                                            let view = state.view.lock().await;
                                            local_share_request(&view.snapshot)?
                                        };
                                        state.execute(request).await?;
                                    }
                                    publish(&app).await
                                }.await;
                                if let Err(error) = result { let _ = app.emit("manager-error", error); show_window(&app); }
                            });
                        }
                        _ => {}
                    });
                if let Some(icon) = app.default_window_icon() { builder = builder.icon(icon.clone()); }
                match builder.build(app) {
                    Ok(_) => { app.manage(share); app.state::<ManagerState>().tray_ready.store(true, Ordering::SeqCst); }
                    Err(error) => eprintln!("Manager tray unavailable; using the window: {error}"),
                }
            }
            let client = app.state::<ManagerState>().client.clone();
            tauri::async_runtime::spawn(async move {
                let initialization = handle.state::<ManagerState>().initialize().await;
                if let Err(error) = initialization { let _ = handle.emit("manager-error", error); show_window(&handle); }
                let _ = client.discovery(true).await;
                let mut initial = true;
                loop {
                    match publish(&handle).await {
                        Ok(view) => {
                            #[cfg(windows)]
                            if initial && !start_window && handle.state::<ManagerState>().tray_ready.load(Ordering::SeqCst)
                                && view.snapshot["hosts"].as_array().is_some_and(|hosts| !hosts.is_empty()) {
                                if let Some(window) = handle.get_webview_window("main") { let _ = window.hide(); }
                            }
                            let _ = (&view, start_window, initial);
                        }
                        Err(error) => { let _ = handle.emit("manager-error", error); }
                    }
                    initial = false;
                    tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(windows)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.app_handle().state::<ManagerState>().tray_ready.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            let _ = (window, event);
        })
        .run(tauri::generate_context!())
        .expect("GInfer Server Manager desktop runtime");
}
