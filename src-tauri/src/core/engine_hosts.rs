//! GChat routing adapters over the shared native GInfer client.
mod credential_setup;
use ginfer_host::client::{Client, ClientState as Hosts, CredentialFuture, CredentialStore};
use serde_json::{json, Value};
use std::sync::{Arc, OnceLock};
use uuid::Uuid;
pub(crate) fn initialize_credentials() -> Result<&'static jan_utils::credential_store::Store, String>
{
    let locator = ginfer_host::local_host_registry::locator_path()?;
    jan_utils::credential_store::initialize(
        locator.parent().ok_or("Host registry root is missing")?,
    )
    .map_err(|e| e.to_string())
}
struct NativeVault;
impl CredentialStore for NativeVault {
    fn get(&self, id: Uuid) -> CredentialFuture<'_, String> {
        Box::pin(async move {
            tokio::task::spawn_blocking(move || {
                let bytes = initialize_credentials()?
                    .get(ginfer_host::client::VAULT_SERVICE, &id.to_string())
                    .map_err(|e| e.to_string())?
                    .ok_or("Pairing credential is missing")?;
                String::from_utf8(bytes.to_vec())
                    .map_err(|_| "Pairing credential is invalid".into())
            })
            .await
            .map_err(|e| e.to_string())?
        })
    }
    fn set<'a>(&'a self, id: Uuid, token: &'a str) -> CredentialFuture<'a, ()> {
        let token = jan_utils::credential_store::Zeroizing::new(token.to_owned());
        Box::pin(async move {
            tokio::task::spawn_blocking(move || {
                initialize_credentials()?
                    .put(
                        ginfer_host::client::VAULT_SERVICE,
                        &id.to_string(),
                        token.as_bytes(),
                    )
                    .map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| e.to_string())?
        })
    }
    fn delete(&self, id: Uuid) -> CredentialFuture<'_, ()> {
        Box::pin(async move {
            tokio::task::spawn_blocking(move || {
                initialize_credentials()?
                    .delete(ginfer_host::client::VAULT_SERVICE, &id.to_string())
                    .map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| e.to_string())?
        })
    }
    fn ensure_ready(&self) -> CredentialFuture<'_, ()> {
        Box::pin(credential_setup::require_ready())
    }
}
fn client_slot() -> &'static OnceLock<Arc<Client>> {
    static CLIENT: OnceLock<Arc<Client>> = OnceLock::new();
    &CLIENT
}
fn client() -> &'static Arc<Client> {
    client_slot().get_or_init(|| Arc::new(Client::new(None, Arc::new(NativeVault))))
}

// A bootstrap must read the selected root and attach under the same fence as a
// Settings move. Otherwise a waiter could restart the old root after cutover.
pub(crate) fn data_folder_access() -> &'static tokio::sync::RwLock<()> {
    static ACCESS: tokio::sync::RwLock<()> = tokio::sync::RwLock::const_new(());
    &ACCESS
}

pub async fn relocate_app_data_folder<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    destination: std::path::PathBuf,
) -> Result<(), String> {
    use crate::core::app::commands::{get_app_configurations, get_configuration_file_path};
    use tauri::Manager;
    crate::core::setup::wait_for_bundled_resources(app).await?;
    let _access = data_folder_access().write().await;
    let mut configuration = get_app_configurations(app.clone());
    let current = std::path::PathBuf::from(&configuration.data_folder);
    let configuration_file = get_configuration_file_path(app.clone());
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    relocate_data_folder_with(client(), &current, &destination, &resources, |selected| {
        configuration.data_folder = selected.to_string_lossy().into_owned();
        ginfer_host::service::write_private(&configuration_file,
            &serde_json::to_vec(&configuration).map_err(|e| e.to_string())?)
    }, |local| async move { local.ensure_running().await.map(|_| ()) }).await
}

fn validate_data_folder_move(current: &std::path::Path, destination: &std::path::Path)
    -> Result<(std::path::PathBuf, std::path::PathBuf), String>
{
    if !current.is_absolute() || !destination.is_absolute() || destination.parent().is_none() {
        return Err("App Data must use an absolute folder below a filesystem root".into());
    }
    std::fs::create_dir_all(current).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(destination).map_err(|e| format!("Cannot create the new App Data folder: {e}"))?;
    let current = current.canonicalize().map_err(|e| e.to_string())?;
    let destination = destination.canonicalize().map_err(|e| e.to_string())?;
    if current.starts_with(&destination) || destination.starts_with(&current) {
        return Err("Choose a separate App Data folder; the current folder and its parent or child folders cannot be used".into());
    }
    // A refused handoff can leave only the empty ownership-lock hierarchy. Keep
    // retries possible without deleting/replacing an inode another process uses.
    let mut directory = destination.clone();
    for (name, regular_file) in [("ginfer", false), ("host", false), ("host.lock", true)] {
        if !directory.try_exists().map_err(|e| e.to_string())? { break; }
        for entry in std::fs::read_dir(&directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if entry.file_name() != name || (regular_file && (!kind.is_file() || entry.metadata().map_err(|e| e.to_string())?.len() != 0))
                || (!regular_file && !kind.is_dir())
            {
                return Err("Choose an empty App Data folder so existing files or another Host are not overwritten".into());
            }
        }
        directory.push(name);
    }
    Ok((current, destination))
}

async fn relocate_data_folder_with<P, S, F>(
    client: &Client,
    current: &std::path::Path,
    destination: &std::path::Path,
    resources: &std::path::Path,
    mut persist: P,
    restart: S,
) -> Result<(), String>
where
    P: FnMut(&std::path::Path) -> Result<(), String>,
    S: Fn(ginfer_host::local_host::LocalHost) -> F,
    F: std::future::Future<Output = Result<(), String>>,
{
    // Startup registration hashes the exact saved path, not its
    // canonical spelling. Keep it until the reversible cutover is complete.
    let configured_current = current.to_path_buf();
    let (current, destination) = validate_data_folder_move(current, destination)?;
    let rollback_current = &configured_current;
    // The independent Gbot service also writes this tree. Do not copy its live
    // state or allow another starter to acquire the old root during the move.
    let gbot_directory = current.join("gbot");
    let _gbot_owner = ginfer_host::service_owner::ServiceOwner::acquire(&gbot_directory)
        .map_err(|error| format!("Quit the Gbot service before changing App Data, then try again. {error}"))?;
    let old_local = relocation_desktop_host(&current, resources)?;
    let guard = client.prepare_local_relocation(&old_local.directory, &destination.join("ginfer/host")).await?;
    let was_running = guard.had_running_host();
    // Host and Gbot ownership stay reserved. Copying host.lock would replace or
    // write through a reserved lock file, defeating the handoff fence.
    let prepared = (|| {
        crate::core::app::helpers::copy_dir_recursive(&current, &destination,
            &[".uvx", ".npx", "openclaw"],
            &[old_local.directory.join("host.lock"), gbot_directory.join("host.lock")])
            .map_err(|e| format!("Failed to copy App Data: {e}"))?;
        let updated = relocation_desktop_host(&destination, resources)?;
        Ok::<_, String>(updated)
    })();
    let updated = match prepared {
        Ok(updated) => updated,
        Err(error) => {
            drop(guard);
            if was_running {
                if let Err(recovery) = restart(old_local).await {
                    return Err(format!("{error}. App Data remains at {}; restarting its Host also failed: {recovery}", current.display()));
                }
            }
            return Err(error);
        }
    };
    let committed = crate::core::gbot::with_relocated_startup(
        &configured_current, &destination, resources, || {
            persist(&destination)?;
            if let Err(error) = guard.commit(updated.clone()) {
                if let Err(rollback) = persist(rollback_current) {
                    return Err(format!("Host root handoff failed: {error}. Restoring App Data configuration also failed: {rollback}; restart GChat after checking Settings"));
                }
                return Err(error);
            }
            Ok(())
        },
    );
    if let Err(error) = committed {
        if was_running {
            if let Err(recovery) = restart(old_local).await {
                return Err(format!("{error}. App Data remains at {}; restarting its Host also failed: {recovery}", current.display()));
            }
        }
        return Err(error);
    }
    if was_running {
        restart(updated).await.map_err(|error| format!("Data moved to {}; Host restart failed: {error}. Start the Host again from Manager", destination.display()))?;
    }
    Ok(())
}
#[cfg(any(windows, test))]
fn configured_stop_directory(configuration: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let saved: crate::core::app::models::AppConfiguration = serde_json::from_slice(
        &std::fs::read(configuration).map_err(|e| e.to_string())?,
    ).map_err(|e| e.to_string())?;
    let directory = std::path::PathBuf::from(saved.data_folder);
    if !directory.is_absolute() {
        return Err("Configured GChat data folder must be absolute for normal Host Stop".into());
    }
    Ok(directory.join("ginfer/host"))
}

/// Best-effort Windows desktop shutdown, using only an already selected owner.
/// Reading configuration here must not create a default folder or credentials.
#[cfg(windows)]
pub async fn stop_configured_local_host_if_idle<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    expected_host_id: Option<Uuid>,
) -> Result<bool, String> {
    let Some(client) = client_slot().get() else { return Ok(false); };
    let configuration = crate::core::app::commands::get_configuration_file_path(app.clone());
    let directory = configured_stop_directory(&configuration)?;
    client.stop_local_host_if_idle(&directory, expected_host_id).await
}
async fn state() -> Result<ginfer_host::client::ClientViewGuard<'static>, String> {
    client().view().await
}
pub async fn shared_client() -> Result<Arc<Client>, String> {
    client().initialize().await?;
    Ok(client().clone())
}
pub async fn initialize<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    crate::core::setup::wait_for_bundled_resources(app).await?;
    let _access = data_folder_access().read().await;
    let data_folder = crate::core::app::commands::get_jan_data_folder_path(app.clone());
    #[cfg(test)]
    let _ = client_slot().set(Arc::new(Client::new(
        Some(data_folder.join("ginfer/shared-hosts.json")),
        Arc::new(NativeVault),
    )));
    initialize_data_folder(&data_folder).await
}
async fn initialize_data_folder(data_folder: &std::path::Path) -> Result<(), String> {
    client().set_local_directory(data_folder.join("ginfer/host")).await?;
    client().initialize().await?;
    client()
        .import_legacy(&data_folder.join("ginfer/hosts.json"))
        .await
}
async fn secret(id: Uuid) -> Result<String, String> {
    client().secret(id).await
}
#[cfg(test)]
async fn delete_secret(id: Uuid) -> Result<(), String> {
    NativeVault.delete(id).await
}
pub async fn request(
    id: Uuid,
    method: reqwest::Method,
    path: &str,
    body: Option<&Value>,
) -> Result<reqwest::Response, String> {
    client()
        .request(id, method, path, body)
        .await
        .map_err(String::from)
}
async fn response_json(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let body = response.json::<Value>().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "host returned {status}: {}",
            body.get("error").unwrap_or(&body)
        ));
    }
    Ok(body)
}

fn installed_desktop_host(
    data_folder: &std::path::Path,
    _resource_directory: &std::path::Path,
) -> Result<ginfer_host::local_host::LocalHost, String> {
    let local = desktop_host_paths(data_folder, _resource_directory)?;
    #[cfg(target_os = "linux")]
    let local = { let mut local = local; local.engine_runtimes = ginfer_host::local_host::desktop_runtimes(&data_folder.join("ginfer"))?; local };
    Ok(local)
}

// Moving an unused installation is allowed before hardware/runtime setup. If a
// runtime set exists, retain its strict validation and rebuild paths at the new root.
fn relocation_desktop_host(data_folder: &std::path::Path, resources: &std::path::Path)
    -> Result<ginfer_host::local_host::LocalHost, String>
{
    let local = desktop_host_paths(data_folder, resources)?;
    #[cfg(target_os = "linux")]
    let local = { let mut local = local;
        if data_folder.join("ginfer/linux/runtime-set.json").try_exists().map_err(|e| e.to_string())? {
            local.engine_runtimes = ginfer_host::local_host::desktop_runtimes(&data_folder.join("ginfer"))?;
        }
        local
    };
    Ok(local)
}

fn desktop_host_paths(data_folder: &std::path::Path, _resource_directory: &std::path::Path)
    -> Result<ginfer_host::local_host::LocalHost, String>
{
    let provider = data_folder.join("ginfer");
    #[cfg(target_os = "linux")]
    let binary = provider.join("bin/ginfer-host");
    #[cfg(not(target_os = "linux"))]
    let binary = _resource_directory
        .join("resources/bin")
        .join(if cfg!(windows) {
            "ginfer-host.exe"
        } else {
            "ginfer-host"
        });
    #[cfg(target_os = "linux")]
    let engine = provider.join("linux/sm120a/bin/ginfer-serve");
    #[cfg(not(target_os = "linux"))]
    let engine = provider.join("bin").join(if cfg!(windows) {
        "ginfer-serve.exe"
    } else {
        "ginfer-serve"
    });
    Ok(ginfer_host::local_host::LocalHost {
        binary,
        engine,
        directory: provider.join("host"),
        desktop_provider: Some(provider),
        engine_runtimes: Default::default(),
        models: vec![],
        artifact_sets: vec![],
        name: ginfer_host::local_host::computer_name()?,
        nvidia_smi: "nvidia-smi".into(),
        listen: "127.0.0.1:7443".parse().unwrap(),
    })
}

#[cfg(feature = "hardware")]
fn require_local_cuda_gpu(gpus: &[tauri_plugin_hardware::GpuInfo]) -> Result<(), String> {
    if gpus
        .iter()
        .any(|gpu| matches!(gpu.vendor, tauri_plugin_hardware::Vendor::NVIDIA))
    {
        return Ok(());
    }
    Err("GInfer local inference requires an NVIDIA CUDA GPU. No NVIDIA GPU was detected on this computer. Use a paired GInfer host or another inference provider.".into())
}

#[cfg(feature = "hardware")]
async fn require_local_hardware() -> Result<(), String> {
    require_local_cuda_gpu(&tauri_plugin_hardware::get_system_info().await?.gpus)
}

async fn ensure_desktop_host<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<ginfer_host::launcher::LocalControl, String> {
    use tauri::Manager;
    crate::core::setup::wait_for_bundled_resources(app).await?;
    let _access = data_folder_access().read().await;
    #[cfg(feature = "hardware")]
    require_local_hardware().await?;
    let local = installed_desktop_host(
        &crate::core::app::commands::get_jan_data_folder_path(app.clone()),
        &app.path().resource_dir().map_err(|e| e.to_string())?,
    )?;
    client().initialize_from_owner(&ginfer_host::local_host_registry::Owner::Desktop(Box::new(local.clone()))).await?;
    local.ensure_shared_running().await
}

pub async fn prepare_installed_hardware_from_paths(
    data_folder: std::path::PathBuf,
    resource_directory: std::path::PathBuf,
    gpu_uuids: Option<Vec<String>>,
) -> Result<ginfer_host::hardware_profile::HardwareProfileStatus, String> {
    let _access = data_folder_access().read().await;
    prepare_installed_hardware_unlocked(data_folder, resource_directory, gpu_uuids).await
}

async fn prepare_installed_hardware_unlocked(
    data_folder: std::path::PathBuf,
    resource_directory: std::path::PathBuf,
    gpu_uuids: Option<Vec<String>>,
) -> Result<ginfer_host::hardware_profile::HardwareProfileStatus, String> {
    #[cfg(feature = "hardware")]
    require_local_hardware().await?;
    let local = installed_desktop_host(&data_folder, &resource_directory)?;
    client().initialize_from_owner(&ginfer_host::local_host_registry::Owner::Desktop(Box::new(local.clone()))).await?;
    local.ensure_shared_running().await?;
    initialize_data_folder(&data_folder).await?;
    let host_id = client()
        .local_host()
        .await?
        .ok_or("Local Host is unavailable")?;
    client()
        .hardware_profile(
            host_id,
            ginfer_host::hardware_profile::HardwareProfileRequest {
                action: ginfer_host::hardware_profile::HardwareProfileAction::Ensure,
                gpu_uuids,
            },
        )
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn engine_hosts_command<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    action: String,
    args: Value,
) -> Result<Value, String> {
    if action == "stop_host" {
        #[cfg(windows)]
        {
            let id = args.get("host_id").and_then(Value::as_str)
                .ok_or("host_id is required")?.parse::<Uuid>().map_err(|e| e.to_string())?;
            if !stop_configured_local_host_if_idle(&app, Some(id)).await? {
                return Err("No local desktop Host is selected; normal Stop was refused".into());
            }
            // Quit prevents normal UI polling from reattaching after Stop.
            app.exit(0);
            return Ok(json!({"stopping":true}));
        }
        #[cfg(not(windows))]
        return Err("Stop Host and Quit is only available for a Windows desktop-managed Host".into());
    }
    if action.starts_with("local_model_") {
        if action == "local_model_adopt" {
            let root = crate::core::app::commands::get_jan_data_folder_path(app.clone());
            let report = tokio::task::spawn_blocking(move || {
                crate::core::ginfer_models::adopt_root_ginfer_models_in(&root)
            })
            .await
            .map_err(|e| e.to_string())??;
            return serde_json::to_value(report).map_err(|e| e.to_string());
        }
        let control = ensure_desktop_host(&app).await?;
        return match action.as_str() {
            "local_model_downloads" => control.request("/host/v1/downloads", None).await,
            "local_model_download" => {
                control
                    .request(
                        "/host/v1/downloads",
                        Some(args.get("body").cloned().ok_or("release required")?),
                    )
                    .await
            }
            "local_model_download_action" => {
                control
                    .request(
                        "/host/v1/download-actions",
                        Some(json!({"id":argument_id(&args, "id")?,
                    "action":args["operation"].as_str().ok_or("operation required")?})),
                    )
                    .await
            }
            _ => Err("unknown local model operation".into()),
        };
    }
    // The prerequisite check must work before registry initialization or pairing.
    if action == "credential_status" {
        return Ok(credential_setup::status(
            args.get("check").and_then(Value::as_bool) == Some(true),
        )
        .await);
    }
    #[cfg(target_os = "linux")]
    if matches!(
        action.as_str(),
        "credential_create" | "credential_unlock" | "credential_lock"
    ) {
        let root = crate::core::app::commands::get_jan_data_folder_path(app.clone());
        return credential_setup::change(&root, &action, args).await;
    }
    if action == "credential_install" {
        return credential_setup::install(
            args.get("confirmed").and_then(Value::as_bool) == Some(true),
        )
        .await;
    }
    initialize(&app).await?;
    match action.as_str() {
        "benchmark_sessions" => {
            let state = state().await?;
            let mut sessions = Vec::new();
            for (host_id, snapshot) in &state.snapshots {
                for instance in snapshot
                    .get("instances")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let Some(instance_id) = instance
                        .get("instance_id")
                        .and_then(Value::as_str)
                        .and_then(|s| s.parse::<Uuid>().ok())
                    else {
                        continue;
                    };
                    let reference = ginfer_host::engine_registry::InstanceRef {
                        host_id: *host_id,
                        instance_id,
                    };
                    if state.registry.resolve(&reference).is_err() {
                        continue;
                    }
                    let info = benchmark_info(&state, &reference)?;
                    let mut value = serde_json::to_value(&info).map_err(|e| e.to_string())?;
                    value["is_embedding"] = false.into();
                    value["port"] = Value::Null;
                    value["kv_arena_bytes"] = "auto".into();
                    value["no_cuda_graph"] = (!info.cuda_graph).into();
                    value["display_name"] = format!(
                        "{} — {}",
                        info.model_id,
                        snapshot
                            .get("display_name")
                            .and_then(Value::as_str)
                            .unwrap_or("Host")
                    )
                    .into();
                    sessions.push(value);
                }
            }
            Ok(json!(sessions))
        }
        "benchmark" => {
            let alias = args
                .get("target_id")
                .and_then(Value::as_str)
                .ok_or("benchmark target is required")?;
            let reference = parse_alias(alias)?;
            let (info, host) = {
                let state = state().await?;
                (
                    benchmark_info(&state, &reference)?,
                    state
                        .saved
                        .get(&reference.host_id)
                        .cloned()
                        .ok_or("host registration missing")?,
                )
            };
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(
                "x-ginfer-session-id",
                info.session_id
                    .as_deref()
                    .ok_or("instance has no active session")?
                    .parse()
                    .map_err(|_| "invalid session header")?,
            );
            let target = tauri_plugin_ginfer::benchmark::BenchmarkTarget {
                info,
                base_url: format!(
                    "{}/host/v1/instances/{}/inference",
                    host.base_url, reference.instance_id
                ),
                api_key: secret(host.client_id).await?,
                client: ginfer_host::transport::pinned_client_with_headers(
                    &host.certificate_sha256,
                    headers,
                )?,
            };
            let request = serde_json::from_value(
                args.get("request")
                    .cloned()
                    .ok_or("benchmark request is required")?,
            )
            .map_err(|e| e.to_string())?;
            tauri_plugin_ginfer::benchmark::validate_request(&request, &target)?;
            let hardware = response_json(
                self::request(
                    reference.host_id,
                    reqwest::Method::GET,
                    &format!(
                        "/host/v1/instances/{}/benchmark-hardware",
                        reference.instance_id
                    ),
                    None,
                )
                .await?,
            )
            .await?;
            if hardware["session_id"].as_str() != target.info.session_id.as_deref() {
                return Err("engine session changed while capturing benchmark hardware".into());
            }
            let mut result =
                tauri_plugin_ginfer::benchmark::run_benchmark_target(app, request, target).await?;
            result.hardware = Some(hardware["hardware"].clone());
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "list" => client().list().await,
        "pair" => {
            let mut args = args;
            args["client_name"] =
                format!("GChat on {}", ginfer_host::local_host::computer_name()?).into();
            client().command(&action, args).await
        }
        _ => client().command(&action, args).await,
    }
}

fn argument_id(args: &Value, field: &str) -> Result<Uuid, String> {
    args.get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{field} is required"))?
        .parse::<Uuid>()
        .map_err(|e| e.to_string())
}

pub fn parse_alias(alias: &str) -> Result<ginfer_host::engine_registry::InstanceRef, String> {
    let fields: Vec<_> = alias.split('/').collect();
    if fields.len() != 3 || fields[0] != "ginfer" {
        return Err("invalid engine instance alias".into());
    }
    Ok(ginfer_host::engine_registry::InstanceRef {
        host_id: fields[1].parse::<Uuid>().map_err(|e| e.to_string())?,
        instance_id: fields[2].parse::<Uuid>().map_err(|e| e.to_string())?,
    })
}

pub fn model_detail_alias(path: &str) -> Result<Option<String>, String> {
    let Some(segment) = path.strip_prefix("/models/") else {
        return Ok(None);
    };
    let mut decoded = Vec::new();
    let bytes = segment.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let pair = bytes
                .get(index + 1..index + 3)
                .ok_or("invalid model URL escape")?;
            let text = std::str::from_utf8(pair).map_err(|_| "invalid model URL escape")?;
            decoded.push(u8::from_str_radix(text, 16).map_err(|_| "invalid model URL escape")?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    let alias = String::from_utf8(decoded).map_err(|_| "invalid model URL encoding")?;
    if !alias.starts_with("ginfer/") {
        return Ok(None);
    }
    parse_alias(&alias)?;
    Ok(Some(alias))
}

fn benchmark_info(
    state: &Hosts,
    reference: &ginfer_host::engine_registry::InstanceRef,
) -> Result<tauri_plugin_ginfer::benchmark::BenchmarkSession, String> {
    let resolved = state.registry.resolve(reference)?;
    let snapshot = state
        .snapshots
        .get(&reference.host_id)
        .ok_or("host snapshot missing")?;
    let instance = snapshot
        .get("instances")
        .and_then(Value::as_array)
        .and_then(|instances| {
            instances.iter().find(|i| {
                i.get("instance_id").and_then(Value::as_str)
                    == Some(reference.instance_id.to_string().as_str())
            })
        })
        .ok_or("instance snapshot missing")?;
    benchmark_session_from_instance(
        instance,
        &resolved.upstream_model_id,
        format!(
            "{} — {}",
            resolved.upstream_model_id,
            snapshot
                .get("display_name")
                .and_then(Value::as_str)
                .unwrap_or("Host")
        ),
        reference.model_alias(),
        resolved.session_id.map(|s| s.to_string()),
    )
}

fn benchmark_session_from_instance(
    instance: &Value,
    model_id: &str,
    display_name: String,
    target_id: String,
    session_id: Option<String>,
) -> Result<tauri_plugin_ginfer::benchmark::BenchmarkSession, String> {
    let config = instance
        .get("configuration")
        .ok_or("instance configuration missing")?;
    let number = |field: &str| {
        config
            .get(field)
            .and_then(Value::as_u64)
            .and_then(|v| u32::try_from(v).ok())
    };
    Ok(tauri_plugin_ginfer::benchmark::BenchmarkSession {
        display_name,
        pid: None,
        target_id,
        session_id,
        model_id: model_id.into(),
        model_path: config
            .get("artifact")
            .and_then(Value::as_str)
            .filter(|path| !path.is_empty())
            .ok_or("instance artifact missing")?
            .into(),
        benchmark_profile: match config
            .get("benchmark_profile")
            .filter(|value| !value.is_null())
        {
            Some(value) => Some(
                serde_json::from_value(value.clone())
                    .map_err(|error| format!("invalid instance benchmark profile: {error}"))?,
            ),
            None => None,
        },
        tp: number("tp"),
        max_context: instance
            .get("model_metadata")
            .and_then(|m| m.get("max_model_len"))
            .and_then(Value::as_u64)
            .and_then(|v| u32::try_from(v).ok())
            .ok_or("engine did not report its effective context limit")?,
        max_concurrency: number("concurrency").ok_or("instance concurrency missing")?,
        vision: config
            .get("vision")
            .and_then(Value::as_bool)
            .ok_or("instance vision setting missing")?,
        spec: config
            .get("spec")
            .and_then(Value::as_str)
            .ok_or("instance speculation setting missing")?
            .into(),
        draft_tokens: number("draft_tokens").ok_or("instance draft width missing")?,
        draft_tp: number("draft_tp").ok_or("instance draft TP missing")?,
        draft_policy: config
            .get("draft_policy")
            .and_then(Value::as_str)
            .map(str::to_owned),
        kv_dtype: config
            .get("kv_dtype")
            .and_then(Value::as_str)
            .ok_or("instance KV dtype missing")?
            .into(),
        prefill_chunk: number("prefill_chunk").ok_or("instance prefill setting missing")?,
        cuda_graph: !config
            .get("no_cuda_graph")
            .and_then(Value::as_bool)
            .ok_or("instance graph setting missing")?,
    })
}

pub async fn agent_target(
    alias: &str,
) -> Result<crate::core::agent::ginfer_client::GinferSessionTarget, String> {
    use crate::core::agent::ginfer_client::{GinferConnection, GinferSessionTarget};
    let reference = parse_alias(alias)?;
    let state = state().await?;
    let instance = state.registry.resolve(&reference)?;
    let session_id = instance
        .session_id
        .ok_or("instance has no active session")?;
    let has_vision = state
        .snapshots
        .get(&reference.host_id)
        .and_then(|s| s.get("instances"))
        .and_then(Value::as_array)
        .and_then(|instances| {
            instances.iter().find(|i| {
                i.get("instance_id").and_then(Value::as_str)
                    == Some(reference.instance_id.to_string().as_str())
            })
        })
        .and_then(|i| i.get("configuration"))
        .and_then(|c| c.get("vision"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Ok(GinferSessionTarget {
        connection: GinferConnection::Paired {
            reference: reference.clone(),
            session_id,
        },
        model_id: instance.upstream_model_id.clone(),
        has_vision,
    })
}

pub async fn request_instance(
    reference: &ginfer_host::engine_registry::InstanceRef,
    session_id: Uuid,
    method: reqwest::Method,
    path: &str,
    body: Option<&Value>,
) -> Result<reqwest::Response, String> {
    client()
        .request_instance(reference, session_id, method, path, body)
        .await
        .map_err(|error| error.to_string())
}

pub async fn agent_instances() -> Vec<crate::core::agent::commands::AgentModelInstance> {
    agent_instances_from(client()).await
}
pub(crate) async fn agent_instances_from(
    client: &Client,
) -> Vec<crate::core::agent::commands::AgentModelInstance> {
    let Ok(state) = client.view().await else {
        return Vec::new();
    };
    let mut models = Vec::new();
    for (host_id, snapshot) in &state.snapshots {
        for instance in snapshot
            .get("instances")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(instance_id) = instance
                .get("instance_id")
                .and_then(Value::as_str)
                .and_then(|s| s.parse().ok())
            else {
                continue;
            };
            let reference = ginfer_host::engine_registry::InstanceRef {
                host_id: *host_id,
                instance_id,
            };
            let Ok(resolved) = state.registry.resolve(&reference) else {
                continue;
            };
            let Some(session_id) = resolved.session_id else {
                continue;
            };
            let number = |path| {
                instance
                    .pointer(path)
                    .and_then(Value::as_u64)
                    .and_then(|v| u32::try_from(v).ok())
                    .unwrap_or(0)
            };
            models.push(crate::core::agent::commands::AgentModelInstance {
                aliases: Vec::new(),
                id: reference.model_alias(),
                session_id: session_id.to_string(),
                model_id: resolved.upstream_model_id.clone(),
                port: None,
                host_name: snapshot
                    .get("display_name")
                    .and_then(Value::as_str)
                    .unwrap_or("LAN host")
                    .into(),
                vision: instance
                    .pointer("/configuration/vision")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                concurrency: number("/configuration/concurrency"),
                max_context: number("/model_metadata/max_model_len"),
            });
        }
    }
    models
}
pub async fn available_models() -> Vec<Value> {
    let Ok(state) = state().await else {
        return Vec::new();
    };
    let mut models = Vec::new();
    for (id, snapshot) in &state.snapshots {
        for instance in snapshot
            .get("instances")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(instance_id) = instance
                .get("instance_id")
                .and_then(Value::as_str)
                .and_then(|s| s.parse::<Uuid>().ok())
            else {
                continue;
            };
            let reference = ginfer_host::engine_registry::InstanceRef {
                host_id: *id,
                instance_id,
            };
            if state.registry.resolve(&reference).is_err() {
                continue;
            }
            let mut metadata = instance
                .get("model_metadata")
                .filter(|m| m.is_object())
                .cloned()
                .unwrap_or_else(|| json!({}));
            metadata["id"] = reference.model_alias().into();
            metadata["object"] = "model".into();
            metadata["owned_by"] = "ginfer".into();
            metadata["host_name"] = snapshot
                .get("display_name")
                .cloned()
                .unwrap_or(json!("LAN host"));
            metadata["vision"] = instance
                .pointer("/configuration/vision")
                .cloned()
                .unwrap_or(json!(false));
            metadata["concurrency"] = instance
                .pointer("/configuration/concurrency")
                .cloned()
                .unwrap_or(json!(0));
            metadata["display_name"] = format!(
                "{} — {}",
                instance
                    .get("display_name")
                    .and_then(Value::as_str)
                    .unwrap_or("Model"),
                snapshot
                    .get("display_name")
                    .and_then(Value::as_str)
                    .unwrap_or("Host")
            )
            .into();
            models.push(metadata);
        }
    }
    models
}
pub async fn forward_alias(
    alias: &str,
    path: &str,
    body: &Value,
) -> Result<hyper::Response<hyper::Body>, String> {
    let reference = parse_alias(alias)?;
    let session = state()
        .await?
        .registry
        .resolve(&reference)?
        .session_id
        .ok_or("instance has no active session")?;
    let scope = ginfer_host::response_route::ResponseScope {
        instance: reference.clone(),
        session,
    };
    let mut body = body.clone();
    if path.starts_with("/responses") {
        scope.decode_previous(&mut body)?;
    }
    let response = request_instance(
        &reference,
        session,
        reqwest::Method::POST,
        &format!("/v1{path}"),
        Some(&body),
    )
    .await?;
    ginfer_host::facade::alias_response(response, alias, Some(scope)).await
}

pub async fn forward_response_handle(
    method: reqwest::Method,
    path: &str,
    query: Option<&str>,
) -> Result<hyper::Response<hyper::Body>, String> {
    let (scope, target) =
        ginfer_host::response_route::request_target(method.as_str(), path, query)?;
    let response = request_instance(&scope.instance, scope.session, method, &target, None).await?;
    ginfer_host::facade::alias_response(
        response,
        &scope.instance.model_alias(),
        Some(scope.clone()),
    )
    .await
}

#[cfg(test)]
#[path = "engine_hosts_live_test.rs"]
mod live_tests;

#[cfg(test)]
mod registration_tests {
    use super::*;

    #[test]
    fn data_folder_move_rejects_aliases_and_foreign_data_but_allows_lock_only_retry() {
        let root = tempfile::tempdir().unwrap();
        let current = root.path().join("current");
        let destination = root.path().join("selected");
        std::fs::create_dir_all(&current).unwrap();
        assert!(validate_data_folder_move(&current, &current).is_err());
        assert!(validate_data_folder_move(&current, root.path()).is_err());
        assert!(validate_data_folder_move(&current, &current.join("nested")).is_err());
        #[cfg(unix)]
        {
            let alias = root.path().join("alias");
            std::os::unix::fs::symlink(&current, &alias).unwrap();
            assert!(validate_data_folder_move(&current, &alias).is_err());
        }
        std::fs::create_dir_all(destination.join("ginfer/host")).unwrap();
        std::fs::write(destination.join("ginfer/host/host.lock"), []).unwrap();
        assert!(validate_data_folder_move(&current, &destination).is_ok());
        std::fs::write(destination.join("ginfer/host/host.json"), b"foreign state").unwrap();
        assert!(validate_data_folder_move(&current, &destination).unwrap_err().contains("empty"));
        assert_eq!(std::fs::read(destination.join("ginfer/host/host.json")).unwrap(), b"foreign state");
        assert!(validate_data_folder_move(&current, std::path::Path::new("relative")).is_err());
    }

    #[tokio::test]
    async fn data_folder_move_refuses_a_running_gbot_before_copy_or_host_changes() {
        let root = tempfile::tempdir().unwrap();
        let current = root.path().join("old");
        let destination = root.path().join("new");
        let owner = ginfer_host::service_owner::ServiceOwner::acquire(&current.join("gbot")).unwrap();
        std::fs::write(current.join("gbot/state.json"), b"live bot state").unwrap();
        let client = Client::new(Some(root.path().join("shared-hosts.json")), Arc::new(NativeVault));
        let error = relocate_data_folder_with(&client, &current, &destination, &root.path().join("resources"),
            |_| panic!("a running Gbot must refuse configuration changes"),
            |_| async { panic!("a running Gbot must refuse Host changes") }).await.unwrap_err();
        assert!(error.contains("Quit the Gbot service"), "{error}");
        assert_eq!(std::fs::read(current.join("gbot/state.json")).unwrap(), b"live bot state");
        assert!(!destination.join("gbot").exists(), "live state must not be copied");
        assert!(!current.join("ginfer").exists(), "Host handoff must not begin");
        drop(owner);
        let _available = ginfer_host::service_owner::ServiceOwner::acquire(&current.join("gbot")).unwrap();
    }

    #[tokio::test]
    async fn data_folder_move_copies_owned_state_and_rolls_back_configuration_failure() {
        const FIXTURE: &str = "GCHAT_DATA_FOLDER_MOVE_FIXTURE";
        let root = match std::env::var_os(FIXTURE) {
            Some(root) => std::path::PathBuf::from(root),
            None => {
                let root = tempfile::tempdir().unwrap();
                let result = std::process::Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", "core::engine_hosts::registration_tests::data_folder_move_copies_owned_state_and_rolls_back_configuration_failure", "--nocapture"])
                    .env(FIXTURE, root.path())
                    .env("XDG_CONFIG_HOME", root.path().join("config"))
                    .env("APPDATA", root.path().join("config"))
                    .output().unwrap();
                assert!(result.status.success(), "{}{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
                return;
            }
        };
        for refuse_configuration in [false, true] {
            let selected = root.join(if refuse_configuration { "refused" } else { "committed" });
            let current = selected.join("old");
            let destination = selected.join("new");
            let resources = selected.join("resources");
            std::fs::create_dir_all(&current).unwrap();
            std::fs::create_dir_all(&destination).unwrap();
            let current = current.canonicalize().unwrap();
            let destination = destination.canonicalize().unwrap();
            let directory = current.join("ginfer/host");
            let host = ginfer_host::service::Host::open(directory.clone(), "Move fixture".into(),
                std::env::current_exe().unwrap(), vec![], vec![], vec![]).await.unwrap();
            let snapshot = host.snapshot().await;
            drop(host);
            let original_state = std::fs::read(directory.join("host.json")).unwrap();
            std::fs::write(directory.join("host.lock"), b"source lock must not be copied").unwrap();
            std::fs::write(current.join("chat-history.json"), b"retained conversation").unwrap();
            std::fs::create_dir_all(current.join("gbot")).unwrap();
            std::fs::write(current.join("gbot/state.json"), b"retained bot state").unwrap();
            let mut local = relocation_desktop_host(&current, &resources).unwrap();
            local.listen = "127.0.0.1:17121".parse().unwrap();
            let locator = ginfer_host::local_host_registry::locator_path().unwrap();
            std::fs::create_dir_all(locator.parent().unwrap()).unwrap();
            std::fs::write(locator.parent().unwrap().join("local-host.lock"), []).unwrap();
            ginfer_host::service::write_private(&locator, &serde_json::to_vec(&json!({
                "schema":"ginfer-local-host-v1", "owner":ginfer_host::local_host_registry::Owner::Desktop(Box::new(local))
            })).unwrap()).unwrap();
            let configuration = selected.join("settings.json");
            let persist = |path: &std::path::Path| ginfer_host::service::write_private(&configuration,
                &serde_json::to_vec(&json!({"data_folder":path})).unwrap());
            persist(&current).unwrap();
            let client = Client::new(Some(selected.join("shared-hosts.json")), Arc::new(NativeVault));
            client.set_local_directory(directory.clone()).await.unwrap();
            let result = relocate_data_folder_with(&client, &current, &destination, &resources,
                |path| {
                    assert!(ginfer_host::service_owner::ServiceOwner::acquire(&current.join("gbot")).is_err(),
                        "Gbot ownership must remain reserved until the handoff commits");
                    if refuse_configuration && path == destination.as_path() { Err("fixture configuration denied".into()) } else { persist(path) }
                },
                |_| async { panic!("an unused Host must not be started by a data move") }).await;
            let expected = if refuse_configuration { &current } else { &destination };
            if refuse_configuration { assert!(result.unwrap_err().contains("configuration denied")); } else { result.unwrap(); }
            let saved: Value = serde_json::from_slice(&std::fs::read(&configuration).unwrap()).unwrap();
            assert_eq!(saved["data_folder"], json!(expected));
            let registered: Value = serde_json::from_slice(&std::fs::read(&locator).unwrap()).unwrap();
            assert_eq!(registered["owner"]["directory"], json!(expected.join("ginfer/host")));
            if !refuse_configuration { assert_eq!(registered["identity"]["host_id"], snapshot["host_id"]); }
            assert_eq!(std::fs::read(destination.join("chat-history.json")).unwrap(), b"retained conversation");
            assert_eq!(std::fs::read(destination.join("ginfer/host/host.json")).unwrap(), original_state);
            assert_eq!(std::fs::read(destination.join("ginfer/host/host.lock")).unwrap(), b"");
            assert_eq!(std::fs::read(directory.join("host.lock")).unwrap(), b"source lock must not be copied");
            let _old_owner = ginfer_host::service_owner::ServiceOwner::acquire(&directory).unwrap();
            let _new_owner = ginfer_host::service_owner::ServiceOwner::acquire(&destination.join("ginfer/host")).unwrap();
            assert_eq!(std::fs::read(current.join("chat-history.json")).unwrap(), b"retained conversation");
            assert!(!destination.join("gbot/host.lock").exists(), "never copy a Gbot ownership lock");
            assert_eq!(std::fs::read(destination.join("gbot/state.json")).unwrap(), b"retained bot state");
            let _gbot_owner = ginfer_host::service_owner::ServiceOwner::acquire(&current.join("gbot")).unwrap();
        }
    }

    #[test]
    fn normal_stop_reads_only_an_existing_absolute_configured_root() {
        let root = tempfile::tempdir().unwrap();
        let configuration = root.path().join("config.json");
        assert!(configured_stop_directory(&configuration).is_err());
        assert!(!configuration.exists());
        std::fs::write(&configuration, b"invalid").unwrap();
        assert!(configured_stop_directory(&configuration).is_err());
        std::fs::write(&configuration, br#"{"data_folder":"relative"}"#).unwrap();
        assert!(configured_stop_directory(&configuration).unwrap_err().contains("absolute"));
        let selected = root.path().join("existing-selection");
        std::fs::write(&configuration, serde_json::to_vec(&json!({"data_folder":selected})).unwrap()).unwrap();
        assert_eq!(configured_stop_directory(&configuration).unwrap(), selected.join("ginfer/host"));
        assert!(!selected.exists(), "normal Stop must not create a data directory");
    }

    #[cfg(feature = "hardware")]
    #[test]
    fn local_host_rejects_no_nvidia_but_defers_unreadable_capability_to_host() {
        use tauri_plugin_hardware::{GpuInfo, Vendor};

        let gpu = |vendor| GpuInfo {
            name: "fixture GPU".into(),
            total_memory: 0,
            vendor,
            uuid: "fixture".into(),
            driver_version: String::new(),
            nvidia_info: None,
            vulkan_info: None,
        };
        let error = require_local_cuda_gpu(&[]).unwrap_err();
        assert!(error.contains("No NVIDIA GPU was detected"));
        assert!(error.contains("paired GInfer host"));
        assert_eq!(require_local_cuda_gpu(&[gpu(Vendor::Intel)]), Err(error));
        assert!(require_local_cuda_gpu(&[gpu(Vendor::NVIDIA)]).is_ok());
    }

    #[test]
    fn benchmark_session_retains_actual_launch_profile_without_defaulting_missing_facts() {
        let reference = ginfer_host::max_perf::MaxPerfProfileRef::new(
            ginfer_host::max_perf::MaxPerfModelClass::Qwen27IntDflashQ4,
        );
        let instance = json!({"model_metadata":{"max_model_len":8181},"configuration":{
            "artifact":"/fixture/model.ginfer","benchmark_profile":reference,"tp":1,"concurrency":8,
            "vision":true,"spec":"dflash","draft_tokens":7,"draft_tp":1,"draft_policy":"fixed",
            "kv_dtype":"int8","prefill_chunk":0,"no_cuda_graph":false}});
        let read = |value: &Value| {
            benchmark_session_from_instance(
                value,
                "qwen3.8-27b/groupwise-int-dflash2-q4",
                "fixture".into(),
                "ginfer/host/instance".into(),
                Some("fixture-session".into()),
            )
        };
        let info = read(&instance).unwrap();
        assert_eq!(info.benchmark_profile, Some(reference));
        assert_eq!(info.tp, Some(1));
        assert_eq!(info.draft_policy.as_deref(), Some("fixed"));
        assert_eq!(info.max_context, 8181);
        assert_eq!(info.max_concurrency, 8);
        for field in [
            "spec",
            "draft_tokens",
            "draft_tp",
            "vision",
            "kv_dtype",
            "no_cuda_graph",
        ] {
            let mut missing = instance.clone();
            missing["configuration"]
                .as_object_mut()
                .unwrap()
                .remove(field);
            assert!(read(&missing).is_err(), "{field}");
        }
        let mut missing = instance;
        let config = missing["configuration"].as_object_mut().unwrap();
        config.remove("benchmark_profile");
        config.remove("tp");
        config.remove("draft_policy");
        let unknown = read(&missing).unwrap();
        assert!(unknown.benchmark_profile.is_none());
        assert!(unknown.tp.is_none());
        assert!(unknown.draft_policy.is_none());
    }

    #[tokio::test]
    #[ignore = "requires an unlocked native OS credential vault"]
    async fn native_vault_round_trip_uses_production_credential_lookup_and_cleanup() {
        let id = Uuid::new_v4();
        let write = tokio::task::spawn_blocking(move || {
            keyring::Entry::new("app.gchat.ginfer-host", &id.to_string())
                .and_then(|entry| entry.set_password("gchat-vault-qualification-fixture"))
                .map_err(|e| e.to_string())
        })
        .await
        .unwrap();
        let read = secret(id).await;
        let cleanup = delete_secret(id).await;
        write.expect("native credential vault must accept the test credential");
        assert_eq!(read.unwrap(), "gchat-vault-qualification-fixture");
        cleanup.expect("test credential must be removed");
        assert!(secret(id).await.is_err());
    }

    #[test]
    fn model_detail_accepts_literal_and_encoded_instance_aliases() {
        let alias = format!("ginfer/{}/{}", Uuid::new_v4(), Uuid::new_v4());
        assert_eq!(
            model_detail_alias(&format!("/models/{alias}")).unwrap(),
            Some(alias.clone())
        );
        assert_eq!(
            model_detail_alias(&format!("/models/{}", alias.replace('/', "%2F"))).unwrap(),
            Some(alias)
        );
        assert_eq!(model_detail_alias("/models/other").unwrap(), None);
        assert!(model_detail_alias("/models/ginfer%2Fbad%2Fbad").is_err());
        assert!(model_detail_alias("/models/ginfer%2").is_err());
    }
}
