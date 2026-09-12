use crate::{
    commands::GinferConfig,
    state::{GinferSession, SessionInfo, SessionOwner},
};
use ginfer_host::{
    engine_host::LaunchOptions, launch_profiles::LaunchProfile, local_host::LocalHost,
    service::LaunchRequest,
};
use serde_json::Value;
use std::{
    collections::{BTreeSet, HashMap},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};
use tokio::sync::Mutex;
use uuid::Uuid;

fn options(config: &GinferConfig) -> Result<LaunchOptions, String> {
    let bytes = config.kv_arena_bytes.trim();
    Ok(LaunchOptions {
        vision: config.vision,
        spec: config.spec.clone(),
        draft_tokens: config.draft_tokens,
        draft_tp: config.draft_tp,
        kv_dtype: config.kv_dtype.clone(),
        kv_arena_bytes: if bytes.is_empty() || bytes == "auto" {
            None
        } else {
            Some(
                bytes
                    .parse()
                    .map_err(|_| "KV arena must be bytes or auto")?,
            )
        },
        prefill_chunk: config.prefill_chunk,
        no_cuda_graph: config.no_cuda_graph,
        ..LaunchOptions::default()
    })
}

fn selected_profile(
    snapshot: &Value,
    model: Uuid,
    config: &GinferConfig,
    requested: &LaunchOptions,
) -> Option<(LaunchProfile, Vec<String>)> {
    snapshot["launch_profiles"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|entry| entry["model_id"].as_str() == Some(&model.to_string()))
        .filter_map(|entry| {
            let profile: LaunchProfile = serde_json::from_value(entry["profile"].clone()).ok()?;
            let group: Vec<String> =
                serde_json::from_value(entry["gpu_groups"].get(0)?.clone()).ok()?;
            let p = &profile.options;
            ((config.max_context == 0 || config.max_context == profile.max_context)
                && (config.max_concurrency == 0 || config.max_concurrency == profile.concurrency)
                && requested.vision == p.vision
                && requested.no_cuda_graph == p.no_cuda_graph
                && (requested.spec == "auto" || requested.spec == p.spec)
                && (requested.kv_dtype == "auto" || requested.kv_dtype == p.kv_dtype)
                && (requested.draft_tp == 0 || requested.draft_tp == p.draft_tp)
                && (requested.draft_tokens == 0 || requested.draft_tokens == p.draft_tokens)
                && (requested.prefill_chunk == 0 || requested.prefill_chunk == p.prefill_chunk)
                && (requested.kv_arena_bytes.is_none()
                    || requested.kv_arena_bytes == p.kv_arena_bytes))
                .then_some((profile, group))
        })
        .max_by_key(|(profile, _)| (profile.max_context, profile.concurrency))
}

fn matches_resident(
    launch: &LaunchRequest,
    config: &GinferConfig,
    requested: &LaunchOptions,
) -> bool {
    let p = &launch.options;
    (config.max_context == 0 || config.max_context == launch.max_context)
        && (config.max_concurrency == 0 || config.max_concurrency == launch.concurrency)
        && requested.vision == p.vision
        && requested.no_cuda_graph == p.no_cuda_graph
        && (requested.spec == "auto" || requested.spec == p.spec)
        && (requested.kv_dtype == "auto" || requested.kv_dtype == p.kv_dtype)
        && (requested.draft_tp == 0 || requested.draft_tp == p.draft_tp)
        && (requested.draft_tokens == 0 || requested.draft_tokens == p.draft_tokens)
        && (requested.prefill_chunk == 0 || requested.prefill_chunk == p.prefill_chunk)
        && (requested.kv_arena_bytes.is_none() || requested.kv_arena_bytes == p.kv_arena_bytes)
}

pub async fn load(
    sessions: Arc<Mutex<HashMap<i32, GinferSession>>>,
    host_binary: PathBuf,
    engine: PathBuf,
    directory: PathBuf,
    model_id: String,
    model_path: String,
    config: GinferConfig,
    is_embedding: bool,
    timeout: u64,
) -> Result<SessionInfo, String> {
    if is_embedding {
        return Err("GInfer does not provide an embeddings endpoint".into());
    }
    let control = Arc::new(
        LocalHost {
            binary: host_binary,
            engine: engine.clone(),
            desktop_provider: directory.parent().map(std::path::Path::to_path_buf),
            directory,
            models: vec![],
            artifact_sets: vec![],
            name: "This computer".into(),
            nvidia_smi: "nvidia-smi".into(),
            listen: "127.0.0.1:7443".parse().unwrap(),
        }
        .ensure_shared_running()
        .await?,
    );
    load_on_host(sessions, control, model_id, model_path, config, timeout).await
}

async fn load_on_host(
    sessions: Arc<Mutex<HashMap<i32, GinferSession>>>,
    control: Arc<ginfer_host::launcher::LocalControl>,
    model_id: String,
    model_path: String,
    config: GinferConfig,
    timeout: u64,
) -> Result<SessionInfo, String> {
    let model = control
        .register_model(std::path::Path::new(&model_path))
        .await?;
    let snapshot = control.snapshot().await?;
    let requested = options(&config)?;
    let residents: Vec<_> = snapshot["instances"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|i| matches!(i["status"].as_str(), Some("ready" | "starting")))
        .filter_map(|i| {
            let launch: LaunchRequest = serde_json::from_value(i["profile"].clone()).ok()?;
            let id: Uuid = serde_json::from_value(i["instance_id"].clone()).ok()?;
            (launch.model_id == model.id && matches_resident(&launch, &config, &requested))
                .then_some((id, launch))
        })
        .collect();
    if residents.len() > 1 {
        return Err("Multiple matching resident instances exist; choose the intended host instance explicitly".into());
    }
    if let Some((id, launch)) = residents.into_iter().next() {
        return attach(sessions, control, launch, id, model_id, model_path, timeout).await;
    }
    let launch = if let Some((profile, gpu_uuids)) =
        selected_profile(&snapshot, model.id, &config, &requested)
    {
        LaunchRequest {
            instance_id: None,
            qualified_profile_id: Some(profile.id),
            model_id: model.id,
            gpu_uuids,
            max_context: profile.max_context,
            concurrency: profile.concurrency,
            options: profile.options,
        }
    } else {
        if config.max_context == 0 || config.max_concurrency == 0 {
            return Err("No qualified automatic profile is available. Select a qualified profile in Engines, or specify both context and concurrency as custom settings.".into());
        }
        let occupied: BTreeSet<&str> = snapshot["instances"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|i| {
                matches!(
                    i["status"].as_str(),
                    Some("ready" | "starting" | "stopping")
                )
            })
            .flat_map(|i| {
                i["configuration"]["gpu_uuids"]
                    .as_array()
                    .into_iter()
                    .flatten()
            })
            .filter_map(Value::as_str)
            .collect();
        let available: Vec<_> = snapshot["gpus"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|g| g["uuid"].as_str().is_some_and(|id| !occupied.contains(id)))
            .collect();
        let gpu_uuids = available.iter().find_map(|first| {
            let group: Vec<String> = available.iter().filter(|g| g["name"] == first["name"]
                && g["compute_capability"] == first["compute_capability"])
                .take(model.metadata.tp_size as usize).filter_map(|g| g["uuid"].as_str().map(str::to_string)).collect();
            (group.len() == model.metadata.tp_size as usize).then_some(group)
        }).ok_or("No unreserved homogeneous GPU group is available; manage existing instances in Engines")?;
        LaunchRequest {
            instance_id: None,
            qualified_profile_id: None,
            model_id: model.id,
            gpu_uuids,
            max_context: config.max_context,
            concurrency: config.max_concurrency,
            options: requested,
        }
    };
    let result = control
        .request(
            "/host/v1/instances",
            Some(serde_json::to_value(&launch).map_err(|e| e.to_string())?),
        )
        .await?;
    let instance_id: Uuid =
        serde_json::from_value(result["instance_id"].clone()).map_err(|e| e.to_string())?;
    attach(
        sessions,
        control,
        launch,
        instance_id,
        model_id,
        model_path,
        timeout,
    )
    .await
}

async fn attach(
    sessions: Arc<Mutex<HashMap<i32, GinferSession>>>,
    control: Arc<ginfer_host::launcher::LocalControl>,
    launch: LaunchRequest,
    instance_id: Uuid,
    model_id: String,
    model_path: String,
    timeout: u64,
) -> Result<SessionInfo, String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout);
    let mut expected_session = None;
    let connection = loop {
        let snapshot = control.snapshot().await?;
        let instance = snapshot["instances"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|i| i["instance_id"].as_str() == Some(&instance_id.to_string()))
            .ok_or("host lost the requested instance")?;
        let current: Uuid =
            serde_json::from_value(instance["session_id"].clone()).map_err(|e| e.to_string())?;
        if expected_session.is_some_and(|expected| expected != current) {
            return Err(
                "Host session changed while loading; select the replacement explicitly".into(),
            );
        }
        expected_session = Some(current);
        let active: LaunchRequest =
            serde_json::from_value(instance["profile"].clone()).map_err(|e| e.to_string())?;
        if active.model_id != launch.model_id
            || active.max_context != launch.max_context
            || active.concurrency != launch.concurrency
            || serde_json::to_value(&active.options).unwrap()
                != serde_json::to_value(&launch.options).unwrap()
        {
            return Err("Host launch settings changed while attaching".into());
        }
        match instance["status"].as_str() {
            Some("ready") => {
                let connection = control.connection(instance_id).await?;
                if connection.session_id != current {
                    return Err("Host session changed while attaching".into());
                }
                break connection;
            }
            Some("failed" | "stopped") => {
                return Err(instance["last_error"]
                    .as_str()
                    .unwrap_or("instance stopped before readiness")
                    .into())
            }
            _ => {}
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "Host instance {instance_id} is still loading; inspect or stop it in Engines"
            ));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    };
    let mut map = sessions.lock().await;
    let pid = loop {
        let handle = rand::random::<u32>() as i32 & i32::MAX;
        if handle > 0 && !map.contains_key(&handle) {
            break handle;
        }
    };
    let info = SessionInfo {
        pid,
        port: connection.port,
        model_id,
        model_path,
        is_embedding: false,
        vision: launch.options.vision,
        max_context: launch.max_context,
        spec: launch.options.spec,
        draft_tokens: launch.options.draft_tokens,
        draft_tp: launch.options.draft_tp,
        kv_dtype: launch.options.kv_dtype,
        kv_arena_bytes: launch
            .options
            .kv_arena_bytes
            .map(|v| v.to_string())
            .unwrap_or_else(|| "auto".into()),
        prefill_chunk: launch.options.prefill_chunk,
        max_concurrency: launch.concurrency,
        no_cuda_graph: launch.options.no_cuda_graph,
        api_key: connection.api_key.clone(),
    };
    map.insert(
        pid,
        GinferSession {
            owner: SessionOwner {
                control,
                connection,
            },
            info: info.clone(),
            endpoint: None,
        },
    );
    Ok(info)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use ginfer_host::{
        launcher::LocalControl,
        service::{Gpu, Host},
    };
    use hyper::{Body, Response};
    use std::{convert::Infallible, os::unix::fs::PermissionsExt};

    #[tokio::test]
    async fn desktop_reconnects_to_resident_and_dropping_sessions_leaves_host_running() {
        let root = tempfile::tempdir().unwrap();
        let engine = root.path().join("engine");
        std::fs::write(&engine, "#!/bin/sh\nexec sleep 30\n").unwrap();
        std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o700)).unwrap();
        let artifact = root.path().join("model.ginfer");
        let metadata =
            serde_json::json!({"identity":{"model_id":"muse-glimmer-30b","weights_id":"nvfp4"},
            "tp_size":1,"draft_tp":0,"objects":[{"kind":"tensor","rank":"all","name":"fixture"}]})
            .to_string();
        let mut bytes = b"NINFER\0\x03".to_vec();
        bytes.extend((metadata.len() as u64).to_le_bytes());
        bytes.extend(metadata.as_bytes());
        bytes.resize(4096, 0);
        std::fs::write(&artifact, bytes).unwrap();
        let directory = root.path().join("state");
        let host = Host::open(
            directory.clone(),
            "Test".into(),
            engine,
            vec![artifact.clone()],
            vec![],
            vec![Gpu {
                uuid: "GPU-test".into(),
                name: "Fixture".into(),
                memory_mib: 32768,
                compute_capability: Some("12.0".into()),
            }],
        )
        .await
        .unwrap();
        let model_id = host.inventory.read().await[0].id;
        let launch = LaunchRequest {
            instance_id: None,
            qualified_profile_id: None,
            model_id,
            gpu_uuids: vec!["GPU-test".into()],
            max_context: 8192,
            concurrency: 1,
            options: LaunchOptions {
                spec: "none".into(),
                ..LaunchOptions::default()
            },
        };
        let id = host.launch(launch).await.unwrap();
        let port = host.snapshot().await["instances"][0]["configuration"]["port"]
            .as_u64()
            .unwrap() as u16;
        let upstream = hyper::Server::bind(&([127, 0, 0, 1], port).into()).serve(
            hyper::service::make_service_fn(|_| async {
                Ok::<_, Infallible>(hyper::service::service_fn(|_| async {
                    Ok::<_, Infallible>(Response::new(Body::from(
                        serde_json::json!({"data":[{"id":"muse-glimmer-30b/nvfp4"}]}).to_string(),
                    )))
                }))
            }),
        );
        let upstream = tokio::spawn(upstream);
        host.processes.lock().await.refresh().await.unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("https://{}", listener.local_addr().unwrap());
        let acceptor = host.data.lock().await.certificate.acceptor().unwrap();
        let server_host = host.clone();
        let server = tokio::spawn(async move {
            loop {
                let (socket, _) = listener.accept().await.unwrap();
                let acceptor = acceptor.clone();
                let host = server_host.clone();
                tokio::spawn(async move {
                    if let Ok(tls) = acceptor.accept(socket).await {
                        let _ = hyper::server::conn::Http::new()
                            .serve_connection(
                                tls,
                                hyper::service::service_fn(move |request| {
                                    host.clone().route(request)
                                }),
                            )
                            .await;
                    }
                });
            }
        });
        let control = Arc::new(LocalControl::open(&directory, &origin).unwrap());
        let config = GinferConfig {
            max_context: 8192,
            max_concurrency: 1,
            spec: "none".into(),
            ..GinferConfig::default()
        };
        let sessions = Arc::new(Mutex::new(HashMap::new()));
        let info = load_on_host(
            sessions.clone(),
            control.clone(),
            "desktop-alias".into(),
            artifact.to_string_lossy().into_owned(),
            config.clone(),
            5,
        )
        .await
        .unwrap();
        assert_ne!(info.port, port);
        assert_eq!(
            sessions.lock().await[&info.pid]
                .owner
                .connection
                .instance_id,
            id
        );
        let response = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{}/v1/models", info.port))
            .bearer_auth(&info.api_key)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        sessions.lock().await.clear();
        assert!(host.processes.lock().await.endpoint(id).is_ok());
        let changed = GinferConfig {
            max_context: 16384,
            ..config.clone()
        };
        assert!(load_on_host(
            sessions.clone(),
            control.clone(),
            "desktop-alias".into(),
            artifact.to_string_lossy().into_owned(),
            changed,
            5
        )
        .await
        .is_err());
        assert!(host.processes.lock().await.endpoint(id).is_ok());
        let reconnected = load_on_host(
            sessions.clone(),
            control,
            "desktop-alias".into(),
            artifact.to_string_lossy().into_owned(),
            config,
            5,
        )
        .await
        .unwrap();
        assert_eq!(reconnected.port, info.port);
        assert_eq!(host.processes.lock().await.instances().count(), 1);
        let session = sessions.lock().await.remove(&reconnected.pid).unwrap();
        let SessionOwner {
            control,
            connection,
        } = session.owner;
        control.stop_session(&connection).await.unwrap();
        assert!(host.processes.lock().await.endpoint(id).is_err());
        server.abort();
        upstream.abort();
        host.processes.lock().await.shutdown().await.unwrap();
    }
}
