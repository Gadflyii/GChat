//! GChat routing adapters over the shared native GInfer client.
mod credential_setup;
use ginfer_host::{
    client::{Client, ClientState as Hosts, CredentialFuture, CredentialStore},
    transport::pinned_client,
};
use serde_json::{json, Value};
use std::sync::{Arc, OnceLock};
use uuid::Uuid;
struct NativeVault;
impl CredentialStore for NativeVault {
    fn get(&self, id: Uuid) -> CredentialFuture<'_, String> {
        Box::pin(async move {
            tokio::task::spawn_blocking(move || {
                keyring::Entry::new(ginfer_host::client::VAULT_SERVICE, &id.to_string())
                    .and_then(|e| e.get_password())
                    .map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| e.to_string())?
        })
    }
    fn set<'a>(&'a self, id: Uuid, token: &'a str) -> CredentialFuture<'a, ()> {
        Box::pin(async move {
            let token = token.to_owned();
            tokio::task::spawn_blocking(move || {
                keyring::Entry::new(ginfer_host::client::VAULT_SERVICE, &id.to_string())
                    .and_then(|e| e.set_password(&token))
                    .map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| e.to_string())?
        })
    }
    fn delete(&self, id: Uuid) -> CredentialFuture<'_, ()> {
        Box::pin(async move {
            tokio::task::spawn_blocking(move || {
                match keyring::Entry::new(ginfer_host::client::VAULT_SERVICE, &id.to_string())
                    .and_then(|e| e.delete_credential())
                {
                    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                    Err(e) => Err(e.to_string()),
                }
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
async fn state() -> Result<ginfer_host::client::ClientViewGuard<'static>, String> {
    client().view().await
}
pub async fn shared_client() -> Result<Arc<Client>, String> {
    client().initialize().await?;
    Ok(client().clone())
}
pub async fn initialize<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(test)]
    let _ = client_slot().set(Arc::new(Client::new(
        Some(
            crate::core::app::commands::get_jan_data_folder_path(app.clone())
                .join("ginfer/shared-hosts.json"),
        ),
        Arc::new(NativeVault),
    )));
    client().initialize().await?;
    client()
        .import_legacy(
            &crate::core::app::commands::get_jan_data_folder_path(app.clone())
                .join("ginfer/hosts.json"),
        )
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
    client().request(id, method, path, body).await
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
        #[cfg(not(target_os = "linux"))]
        use tauri::Manager;
        let root = crate::core::app::commands::get_jan_data_folder_path(app.clone());
        if action == "local_model_adopt" {
            let report = tokio::task::spawn_blocking(move || {
                crate::core::ginfer_models::adopt_root_ginfer_models_in(&root)
            })
            .await
            .map_err(|e| e.to_string())??;
            return serde_json::to_value(report).map_err(|e| e.to_string());
        }
        let provider = root.join("ginfer");
        #[cfg(target_os = "linux")]
        let engine_runtimes = ginfer_host::local_host::desktop_runtimes(&provider)?;
        #[cfg(not(target_os = "linux"))]
        let engine_runtimes = Default::default();
        #[cfg(target_os = "linux")]
        let binary = provider.join("bin/ginfer-host");
        #[cfg(not(target_os = "linux"))]
        let binary = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
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
        let control = ginfer_host::local_host::LocalHost {
            binary,
            engine,
            directory: provider.join("host"),
            desktop_provider: Some(provider),
            engine_runtimes,
            models: vec![],
            artifact_sets: vec![],
            name: ginfer_host::local_host::computer_name()?,
            nvidia_smi: "nvidia-smi".into(),
            listen: "127.0.0.1:7443".parse().unwrap(),
        }
        .ensure_shared_running()
        .await?;
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
    let host = {
        let state = state().await?;
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
