//! GChat's native paired-host registry. Credentials remain in the OS vault.
mod credential_setup;
use ginfer_host::{
    discovery::Discovery,
    engine_registry::{EngineRegistry, RegisteredHost},
    transport::pinned_client,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::PathBuf, sync::OnceLock};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
pub struct SavedHost {
    pub host_id: Uuid,
    pub name: String,
    pub base_url: String,
    pub certificate_sha256: String,
    pub client_id: Uuid,
}
#[derive(Default)]
struct Hosts {
    path: Option<PathBuf>,
    saved: BTreeMap<Uuid, SavedHost>,
    registry: EngineRegistry,
    discovery: Option<Discovery>,
    snapshots: BTreeMap<Uuid, Value>,
}
fn state() -> &'static Mutex<Hosts> {
    static STATE: OnceLock<Mutex<Hosts>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(Hosts::default()))
}
fn endpoint(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value).map_err(|e| e.to_string())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(
            "host address must be an HTTPS origin, for example https://192.168.1.10:7443".into(),
        );
    }
    Ok(url.as_str().trim_end_matches('/').into())
}
async fn secret(id: Uuid) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        keyring::Entry::new("app.gchat.ginfer-host", &id.to_string())
            .and_then(|e| e.get_password())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn registration(host: &SavedHost) -> RegisteredHost {
    RegisteredHost {
        host_id: host.host_id,
        display_name: host.name.clone(),
        credential_ref: host.client_id.to_string(),
        certificate_sha256: host.certificate_sha256.clone(),
    }
}
pub async fn initialize<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let mut state = state().lock().await;
    if state.path.is_some() {
        return Ok(());
    }
    let path = crate::core::app::commands::get_jan_data_folder_path(app.clone())
        .join("ginfer")
        .join("hosts.json");
    let saved: Vec<SavedHost> = match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("cannot read saved engine hosts: {e}"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
        Err(e) => return Err(e.to_string()),
    };
    for host in saved {
        state.registry.register_paired(registration(&host));
        state.saved.insert(host.host_id, host);
    }
    state.path = Some(path);
    Ok(())
}
fn persist(state: &Hosts) -> Result<(), String> {
    let path = state.path.as_ref().ok_or("host registry not initialized")?;
    ginfer_host::service::write_private(
        path,
        &serde_json::to_vec(&state.saved.values().collect::<Vec<_>>())
            .map_err(|e| e.to_string())?,
    )
}

// Persist first while holding the registry lock. Readers never observe an
// unsaved replacement, and a failed write leaves the old credential reference live.
fn publish_registration(state: &mut Hosts, host: SavedHost) -> Result<Option<SavedHost>, String> {
    let id = host.host_id;
    let previous = state.saved.insert(id, host.clone());
    if let Err(error) = persist(state) {
        if let Some(previous) = previous {
            state.saved.insert(id, previous);
        } else {
            state.saved.remove(&id);
        }
        return Err(error);
    }
    state.registry.register_paired(registration(&host));
    state.snapshots.remove(&id);
    Ok(previous)
}

async fn delete_secret(id: Uuid) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        match keyring::Entry::new("app.gchat.ginfer-host", &id.to_string())
            .and_then(|e| e.delete_credential())
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn remove_registration(state: &mut Hosts, id: Uuid) -> Result<SavedHost, String> {
    let previous = state.saved.remove(&id).ok_or("host is not registered")?;
    if let Err(error) = persist(state) {
        state.saved.insert(id, previous);
        return Err(error);
    }
    state.registry.forget(id);
    state.snapshots.remove(&id);
    Ok(previous)
}

async fn rollback_pairing(client: &reqwest::Client, origin: &str, id: Uuid, token: &str) -> String {
    let mut warnings = Vec::new();
    if let Err(e) = delete_secret(id).await {
        warnings.push(format!("new vault credential cleanup failed: {e}"));
    }
    match client
        .delete(format!("{origin}/host/v1/clients/{id}"))
        .bearer_auth(token)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {}
        _ => warnings.push("new host grant could not be revoked; remove it on the host".into()),
    }
    if warnings.is_empty() {
        String::new()
    } else {
        format!("; {}", warnings.join("; "))
    }
}

pub async fn request(
    host_id: Uuid,
    method: reqwest::Method,
    path: &str,
    body: Option<&Value>,
) -> Result<reqwest::Response, String> {
    let host = state()
        .lock()
        .await
        .saved
        .get(&host_id)
        .cloned()
        .ok_or("host is not registered")?;
    let token = secret(host.client_id).await?;
    let client = pinned_client(&host.certificate_sha256)?;
    let mut req = client
        .request(method, format!("{}{}", host.base_url, path))
        .bearer_auth(token);
    if let Some(body) = body {
        req = req.json(body);
    }
    req.send().await.map_err(|e| e.to_string())
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

#[tauri::command]
pub async fn engine_hosts_command<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    action: String,
    args: Value,
) -> Result<Value, String> {
    if action.starts_with("local_model_") {
        static DOWNLOADS: OnceLock<Mutex<Option<std::sync::Arc<ginfer_host::model_downloads::ModelDownloads>>>> = OnceLock::new();
        let root = crate::core::app::commands::get_jan_data_folder_path(app.clone());
        let mut slot = DOWNLOADS.get_or_init(|| Mutex::new(None)).lock().await;
        let manager = if let Some(manager) = slot.as_ref() { manager.clone() } else {
            let manager = ginfer_host::model_downloads::ModelDownloads::open_local(
                root.join("ginfer/models"), root.join("ginfer/model-downloads.json"))?;
            *slot = Some(manager.clone()); manager
        };
        drop(slot);
        return match action.as_str() {
            "local_model_downloads" => serde_json::to_value(manager.list().await).map_err(|e| e.to_string()),
            "local_model_download" => {
                let release: ginfer_host::model_downloads::Release = serde_json::from_value(args.get("body").cloned().ok_or("release required")?).map_err(|e| e.to_string())?;
                release.validate()?;
                let hardware = tauri_plugin_hardware::get_system_info().await?;
                let gpus: Vec<_> = hardware.gpus.into_iter().map(|gpu| ginfer_host::service::Gpu {
                    uuid: gpu.uuid, name: gpu.name, memory_mib: gpu.total_memory,
                    compute_capability: gpu.nvidia_info.map(|info| info.compute_capability),
                }).collect();
                if release.compatible_group(&gpus).is_none() { return Err("release does not match this computer's actual SM and per-GPU memory".into()); }
                serde_json::to_value(manager.enqueue(release).await?).map_err(|e| e.to_string())
            }
            "local_model_download_action" => {
                manager.action(argument_id(&args, "id")?, args["operation"].as_str().ok_or("operation required")?).await?;
                Ok(json!({"ok":true}))
            }
            "local_model_adopt" => {
                let scan_root = root.clone();
                let report = tokio::task::spawn_blocking(move || crate::core::ginfer_models::adopt_root_ginfer_models_in(&scan_root)).await.map_err(|e| e.to_string())??;
                serde_json::to_value(report).map_err(|e| e.to_string())
            }
            _ => Err("unknown local model operation".into()),
        };
    }
    // The prerequisite check must work before registry initialization or pairing.
    if action == "credential_status" {
        return Ok(credential_setup::status().await);
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
            let state = state().lock().await;
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
                let state = state().lock().await;
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
            let result =
                tauri_plugin_ginfer::benchmark::run_benchmark_target(app, request, target).await?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "list" => {
            let state = state().lock().await;
            Ok(
                json!({"registered":state.saved.values().collect::<Vec<_>>(),"discovered":state.discovery.as_ref().map(|d|d.hosts()).unwrap_or_default()}),
            )
        }
        "discovery" => {
            let enabled = args
                .get("enabled")
                .and_then(Value::as_bool)
                .ok_or("enabled is required")?;
            let mut state = state().lock().await;
            if enabled && state.discovery.is_none() {
                state.discovery = Some(Discovery::start()?);
            }
            if !enabled {
                state.discovery = None;
            }
            Ok(json!({"enabled":enabled}))
        }
        "pair" => {
            credential_setup::require_ready().await?;
            let base_url = endpoint(
                args.get("base_url")
                    .and_then(Value::as_str)
                    .ok_or("host address is required")?,
            )?;
            let fingerprint = args
                .get("fingerprint")
                .and_then(Value::as_str)
                .ok_or("host certificate fingerprint is required")?
                .trim()
                .to_lowercase();
            let client = pinned_client(&fingerprint)?;
            let identity = response_json(
                client
                    .get(format!("{base_url}/.well-known/ginfer"))
                    .timeout(std::time::Duration::from_secs(10))
                    .send()
                    .await
                    .map_err(|e| e.to_string())?,
            )
            .await?;
            if identity.get("protocol_version").and_then(Value::as_u64) != Some(1) {
                return Err("unsupported host protocol".into());
            }
            let host_id = identity
                .get("host_id")
                .and_then(Value::as_str)
                .ok_or("host identity missing")?
                .parse::<Uuid>()
                .map_err(|e| e.to_string())?;
            let paired = response_json(
                client
                    .post(format!("{base_url}/host/v1/pair"))
                    .timeout(std::time::Duration::from_secs(10))
                    .json(&json!({"code":args.get("code"),"client_name":"GChat"}))
                    .send()
                    .await
                    .map_err(|e| e.to_string())?,
            )
            .await?;
            if paired.get("host_id").and_then(Value::as_str) != Some(host_id.to_string().as_str()) {
                return Err("pairing returned a different host identity".into());
            }
            let token = paired
                .get("token")
                .and_then(Value::as_str)
                .ok_or("pairing returned no credential")?
                .to_owned();
            let client_id = paired
                .get("client_id")
                .and_then(Value::as_str)
                .ok_or("pairing returned no client identity")?
                .parse::<Uuid>()
                .map_err(|e| e.to_string())?;
            let vault_token = token.clone();
            let stored = tokio::task::spawn_blocking(move || {
                keyring::Entry::new("app.gchat.ginfer-host", &client_id.to_string())
                    .and_then(|e| e.set_password(&vault_token))
                    .map_err(|e| format!("could not save paired credential in OS vault: {e}"))
            })
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r);
            if let Err(error) = stored {
                return Err(format!(
                    "{error}{}",
                    rollback_pairing(&client, &base_url, client_id, &token).await
                ));
            }
            let host = SavedHost {
                host_id,
                name: identity
                    .get("display_name")
                    .and_then(Value::as_str)
                    .unwrap_or("GInfer host")
                    .into(),
                base_url,
                certificate_sha256: fingerprint,
                client_id,
            };
            let mut state = state().lock().await;
            let published = publish_registration(&mut state, host.clone());
            drop(state);
            let previous = match published {
                Ok(previous) => previous,
                Err(error) => {
                    return Err(format!(
                        "{error}{}",
                        rollback_pairing(&client, &host.base_url, client_id, &token).await
                    ))
                }
            };
            let mut cleanup_warnings = Vec::new();
            if let Some(previous) = previous {
                match client
                    .delete(format!(
                        "{}/host/v1/clients/{}",
                        host.base_url, previous.client_id
                    ))
                    .bearer_auth(&token)
                    .timeout(std::time::Duration::from_secs(5))
                    .send()
                    .await
                {
                    Ok(response) if response.status().is_success() => {}
                    _ => cleanup_warnings.push("old host grant could not be revoked".to_string()),
                }
                if let Err(error) = delete_secret(previous.client_id).await {
                    cleanup_warnings.push(format!(
                        "old OS-vault credential could not be removed: {error}"
                    ));
                }
            }
            let mut result = json!(host);
            if !cleanup_warnings.is_empty() {
                result["credential_cleanup_warning"] = cleanup_warnings.join("; ").into();
            }
            Ok(result)
        }
        "snapshot" => {
            let id = argument_id(&args, "host_id")?;
            let (connection, host, alternatives) = {
                let mut state = state().lock().await;
                let host = state
                    .saved
                    .get(&id)
                    .cloned()
                    .ok_or("host is not registered")?;
                let alternatives = state
                    .discovery
                    .as_ref()
                    .map(|d| d.hosts())
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|h| h.host_id == id.to_string())
                    .flat_map(|h| h.urls)
                    .filter(|url| url != &host.base_url)
                    .collect::<std::collections::BTreeSet<_>>();
                (state.registry.poll_connection(id)?, host, alternatives)
            };
            let result = tokio::time::timeout(std::time::Duration::from_secs(10), async {
                use futures_util::StreamExt;
                let token = secret(host.client_id).await?;
                let current = ginfer_host::transport::host_snapshot_at(
                    &host.base_url,
                    &host.certificate_sha256,
                    &token,
                    id,
                )
                .await;
                match current {
                    Ok(snapshot) => Ok((host.base_url.clone(), snapshot)),
                    Err(error) => {
                        let mut probes =
                            futures_util::stream::iter(alternatives.into_iter().map(|url| {
                                let fingerprint = &host.certificate_sha256;
                                let token = &token;
                                async move {
                                    ginfer_host::transport::host_snapshot_at(
                                        &url,
                                        fingerprint,
                                        token,
                                        id,
                                    )
                                    .await
                                    .map(|s| (url, s))
                                }
                            }))
                            .buffer_unordered(4);
                        while let Some(result) = probes.next().await {
                            if let Ok(found) = result {
                                return Ok(found);
                            }
                        }
                        Err(error)
                    }
                }
            })
            .await
            .map_err(|_| "host did not respond".to_string())
            .and_then(|r| r);
            match result {
                Ok((origin, snapshot)) => {
                    let mut state = state().lock().await;
                    let validated = serde_json::from_value(snapshot.clone())
                        .map_err(|e| e.to_string())
                        .and_then(|parsed| state.registry.reconcile(connection, parsed));
                    if let Err(error) = validated {
                        state.registry.disconnect(connection);
                        return Err(error);
                    }
                    if origin != host.base_url {
                        let saved = state.saved.get_mut(&id).ok_or("host was forgotten")?;
                        let previous = saved.base_url.clone();
                        saved.base_url = origin;
                        if let Err(error) = persist(&state) {
                            state.saved.get_mut(&id).unwrap().base_url = previous;
                            state.registry.disconnect(connection);
                            return Err(error);
                        }
                    }
                    state.snapshots.insert(id, snapshot.clone());
                    Ok(snapshot)
                }
                Err(e) => {
                    state().lock().await.registry.disconnect(connection);
                    Err(e)
                }
            }
        }
        "remove_model" | "download" | "download_action" | "launch" | "stop" | "reload" | "scan" => {
            let id = argument_id(&args, "host_id")?;
            let path = match action.as_str() {
                "launch" => "/host/v1/instances".into(),
                "scan" => "/host/v1/scan".into(),
                "download" => "/host/v1/downloads".into(),
                "download_action" => "/host/v1/download-actions".into(),
                "remove_model" => "/host/v1/remove-model".into(),
                _ => format!(
                    "/host/v1/instances/{}/{}",
                    argument_id(&args, "instance_id")?,
                    action
                ),
            };
            response_json(
                request(
                    id,
                    reqwest::Method::POST,
                    &path,
                    Some(args.get("body").unwrap_or(&json!({}))),
                )
                .await?,
            )
            .await
        }
        "forget" => {
            let id = argument_id(&args, "host_id")?;
            // Forget is local and works while a server is offline. Revoke is a separate host action.
            let mut state = state().lock().await;
            let previous = remove_registration(&mut state, id)?;
            drop(state);
            let warning = delete_secret(previous.client_id).await.err();
            Ok(json!({"forgotten":id,"credential_cleanup_warning":warning}))
        }
        _ => Err("unknown engine-host command".into()),
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
        display_name: format!(
            "{} — {}",
            resolved.upstream_model_id,
            snapshot
                .get("display_name")
                .and_then(Value::as_str)
                .unwrap_or("Host")
        ),
        pid: None,
        target_id: reference.model_alias(),
        session_id: resolved.session_id.map(|s| s.to_string()),
        model_id: resolved.upstream_model_id.clone(),
        model_path: config
            .get("artifact")
            .and_then(Value::as_str)
            .unwrap_or("")
            .into(),
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
            .unwrap_or(false),
        spec: config
            .get("spec")
            .and_then(Value::as_str)
            .unwrap_or("auto")
            .into(),
        draft_tokens: number("draft_tokens").unwrap_or(0),
        draft_tp: number("draft_tp").unwrap_or(0),
        kv_dtype: config
            .get("kv_dtype")
            .and_then(Value::as_str)
            .unwrap_or("auto")
            .into(),
        prefill_chunk: number("prefill_chunk").unwrap_or(0),
        cuda_graph: !config
            .get("no_cuda_graph")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

pub async fn agent_target(
    alias: &str,
) -> Result<crate::core::agent::ginfer_client::GinferSessionTarget, String> {
    use crate::core::agent::ginfer_client::{GinferConnection, GinferSessionTarget};
    let reference = parse_alias(alias)?;
    let state = state().lock().await;
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
    let host = {
        let state = state().lock().await;
        if state.registry.resolve(reference)?.session_id != Some(session_id) {
            return Err("assigned engine instance restarted; resume the run against its new session explicitly".into());
        }
        state
            .saved
            .get(&reference.host_id)
            .cloned()
            .ok_or("host registration missing")?
    };
    let client = pinned_client(&host.certificate_sha256)?;
    let mut request = client
        .request(
            method,
            format!(
                "{}/host/v1/instances/{}/inference{}",
                host.base_url, reference.instance_id, path
            ),
        )
        .bearer_auth(secret(host.client_id).await?)
        .header("x-ginfer-session-id", session_id.to_string())
        .timeout(std::time::Duration::from_secs(600));
    if let Some(body) = body {
        request = request.json(body);
    }
    request.send().await.map_err(|e| e.to_string())
}

pub async fn agent_instances() -> Vec<crate::core::agent::commands::AgentModelInstance> {
    let state = state().lock().await;
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
            let number = |path| {
                instance
                    .pointer(path)
                    .and_then(Value::as_u64)
                    .and_then(|v| u32::try_from(v).ok())
                    .unwrap_or(0)
            };
            models.push(crate::core::agent::commands::AgentModelInstance {
                id: reference.model_alias(),
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
    let state = state().lock().await;
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
        .lock()
        .await
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
    use ginfer_host::engine_registry::{
        HostSnapshot, InstanceRef, InstanceSnapshot, InstanceStatus,
    };

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

    #[test]
    fn failed_repair_or_forget_preserves_live_registration_and_success_persists_new_reference() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("hosts.json");
        let mut state = Hosts {
            path: Some(file.clone()),
            ..Hosts::default()
        };
        let host = SavedHost {
            host_id: Uuid::new_v4(),
            name: "Lab".into(),
            base_url: "https://127.0.0.1:7443".into(),
            certificate_sha256: "a".repeat(64),
            client_id: Uuid::new_v4(),
        };
        publish_registration(&mut state, host.clone()).unwrap();
        let reference = InstanceRef {
            host_id: host.host_id,
            instance_id: Uuid::new_v4(),
        };
        let connection = state.registry.connect(host.host_id).unwrap();
        state
            .registry
            .reconcile(
                connection,
                HostSnapshot {
                    protocol_version: 1,
                    host_id: host.host_id,
                    boot_id: Uuid::new_v4(),
                    revision: 1,
                    display_name: "Lab".into(),
                    instances: vec![InstanceSnapshot {
                        instance_id: reference.instance_id,
                        session_id: Some(Uuid::new_v4()),
                        display_name: "Muse".into(),
                        upstream_model_id: "Muse".into(),
                        status: InstanceStatus::Ready,
                    }],
                },
            )
            .unwrap();
        let replacement = SavedHost {
            client_id: Uuid::new_v4(),
            ..host.clone()
        };
        // A directory cannot be replaced with a registry file on either supported OS.
        let invalid = dir.path().join("not-a-file");
        std::fs::create_dir(&invalid).unwrap();
        state.path = Some(invalid);
        assert!(publish_registration(&mut state, replacement.clone()).is_err());
        assert!(remove_registration(&mut state, host.host_id).is_err());
        assert_eq!(state.saved[&host.host_id].client_id, host.client_id);
        assert!(state.registry.resolve(&reference).is_ok());
        let stored: Vec<SavedHost> =
            serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        assert_eq!(stored[0].client_id, host.client_id);
        state.path = Some(file.clone());
        publish_registration(&mut state, replacement.clone()).unwrap();
        assert!(state.registry.resolve(&reference).is_err());
        let stored: Vec<SavedHost> =
            serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        assert_eq!(stored[0].client_id, replacement.client_id);
        remove_registration(&mut state, host.host_id).unwrap();
        assert!(state.saved.is_empty());
        assert_eq!(std::fs::read_to_string(file).unwrap(), "[]");
    }
}
