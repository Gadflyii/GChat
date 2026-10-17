use crate::{
    commands::{GinferConfig, GinferLoadRequest},
    state::{GinferSession, SessionInfo, SessionOwner},
};
use ginfer_host::{
    engine_host::{GpuDeviceOrders, LaunchOptions}, launch_profiles::LaunchProfile, local_host::LocalHost,
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
    if config.use_profile_defaults {
        return Ok(LaunchOptions::default());
    }
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

fn canonical_gpu_selection(mut config: GinferConfig) -> GinferConfig {
    if let Some(selected) = &mut config.gpu_uuids {
        for uuid in selected {
            // Desktop hardware IDs omit this prefix; Host inventory and CUDA use it.
            if !uuid.starts_with("GPU-") {
                uuid.insert_str(0, "GPU-");
            }
        }
    }
    config
}

fn visible_selection(
    snapshot: &Value,
    config: &GinferConfig,
    mask: Option<&str>,
    device_order: Option<&str>,
) -> Result<Vec<String>, String> {
    let inventory: Vec<String> = serde_json::from_value(
        Value::Array(snapshot["gpus"].as_array().ok_or("Host GPU inventory is unavailable")?
            .iter().map(|gpu| gpu["uuid"].clone()).collect()))
        .map_err(|_| "Host GPU inventory is invalid")?;
    let host_visible: Vec<String> = match snapshot.get("cuda_visible_gpu_uuids") {
        Some(value) => serde_json::from_value(value.clone()).map_err(|_| "Host GPU visibility is invalid")?,
        None => inventory.clone(),
    };
    let orders: GpuDeviceOrders = match snapshot.get("gpu_device_orders") {
        Some(value) => serde_json::from_value(value.clone()).map_err(|_| "Host GPU enumeration order is invalid")?,
        None => GpuDeviceOrders::default(),
    };
    // The desktop's order may differ from the Host's; the Host grant bounds access,
    // while the desktop resolves its own inherited ordinal mask and rank order.
    let visible: Vec<String> = orders.resolve(&inventory, mask, device_order)?
        .into_iter().filter(|id| host_visible.contains(id)).collect();
    if let Some(selected) = &config.gpu_uuids {
        if selected.is_empty() || selected.iter().collect::<BTreeSet<_>>().len() != selected.len()
            || selected.iter().any(|id| !visible.contains(id)) {
            return Err("Selected GPUs are unavailable or excluded by CUDA_VISIBLE_DEVICES; choose available GPUs explicitly".into());
        }
    }
    Ok(visible)
}

fn group_matches(group: &[String], config: &GinferConfig, visible: &[String]) -> bool {
    !group.is_empty() && group.iter().all(|id| visible.contains(id))
        && config.gpu_uuids.as_ref().map_or(true, |selected| selected == group)
}

fn selected_group(groups: &Value, config: &GinferConfig, visible: &[String]) -> Option<Vec<String>> {
    groups.as_array()?.iter()
        .filter_map(|group| {
            let mut group: Vec<String> = serde_json::from_value(group.clone()).ok()?;
            let members: BTreeSet<_> = group.iter().collect();
            if group.is_empty() || members.len() != group.len()
                || group.iter().any(|id| !visible.contains(id)) {
                return None;
            }
            // Host qualification checks exact membership; launch order selects ranks.
            if let Some(selected) = &config.gpu_uuids {
                return (selected.len() == group.len()
                    && selected.iter().collect::<BTreeSet<_>>() == members)
                    .then(|| selected.clone());
            }
            group.sort_by_key(|id| visible.iter().position(|visible_id| visible_id == id));
            Some(group)
        })
        .min_by_key(|group| group.iter().map(|id| {
            visible.iter().position(|visible_id| visible_id == id).unwrap_or(usize::MAX)
        }).collect::<Vec<_>>())
}

fn selected_profile(
    snapshot: &Value,
    model: Uuid,
    config: &GinferConfig,
    requested: &LaunchOptions,
    visible: &[String],
) -> Option<(LaunchProfile, Vec<String>)> {
    snapshot["launch_profiles"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|entry| entry["model_id"].as_str() == Some(&model.to_string()))
        .filter_map(|entry| {
            let profile: LaunchProfile = serde_json::from_value(entry["profile"].clone()).ok()?;
            let group = selected_group(&entry["gpu_groups"], config, visible)?;
            let p = &profile.options;
            (config.use_profile_defaults || ((config.max_context == 0 || config.max_context == profile.max_context)
                && (config.max_concurrency == 0 || config.max_concurrency == profile.concurrency)
                && requested.vision == p.vision
                && requested.no_cuda_graph == p.no_cuda_graph
                && (requested.spec == "auto" || requested.spec == p.spec)
                && (requested.kv_dtype == "auto" || requested.kv_dtype == p.kv_dtype)
                && (requested.draft_tp == 0 || requested.draft_tp == p.draft_tp)
                && (requested.draft_tokens == 0 || requested.draft_tokens == p.draft_tokens)
                && (requested.prefill_chunk == 0 || requested.prefill_chunk == p.prefill_chunk)))
                .then_some((profile, group))
        })
        .max_by_key(|(profile, _)| (profile.max_context, profile.concurrency))
}

fn profile_request(
    model: Uuid,
    profile: &LaunchProfile,
    gpu_uuids: Vec<String>,
    config: &GinferConfig,
    requested: &LaunchOptions,
) -> LaunchRequest {
    let mut options = profile.options.clone();
    // Catalog KV bytes describe historical qualification. Match Host's saved
    // request: Automatic unless the caller explicitly supplies a byte budget.
    options.kv_arena_bytes = requested.kv_arena_bytes;
    if !config.use_profile_defaults {
        options.structured_outputs = requested.structured_outputs;
    }
    LaunchRequest {
        benchmark_profile: None,
        instance_id: None,
        qualified_profile_id: (options == profile.options).then(|| profile.id.clone()),
        model_id: model,
        gpu_uuids,
        max_context: profile.max_context,
        concurrency: profile.concurrency,
        options,
    }
}

fn matches_resident(
    launch: &LaunchRequest,
    config: &GinferConfig,
    requested: &LaunchOptions,
    visible: &[String],
) -> bool {
    let p = &launch.options;
    group_matches(&launch.gpu_uuids, config, visible)
        && (config.max_context == 0 || config.max_context == launch.max_context)
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
    request: GinferLoadRequest,
) -> Result<SessionInfo, String> {
    if request.is_embedding {
        return Err("GInfer does not provide an embeddings endpoint".into());
    }
    let GinferLoadRequest {
        binary_path: engine,
        host_directory: directory,
        model_id,
        model_path,
        config,
        timeout,
        is_embedding: _,
    } = request;
    let control = Arc::new(
        LocalHost {
            binary: host_binary,
            engine,
            engine_runtimes: {
                #[cfg(target_os = "linux")]
                {
                    ginfer_host::local_host::desktop_runtimes(
                        directory
                            .parent()
                            .ok_or("GChat host has no provider directory")?,
                    )?
                }
                #[cfg(not(target_os = "linux"))]
                {
                    Default::default()
                }
            },
            desktop_provider: directory.parent().map(std::path::Path::to_path_buf),
            directory,
            models: vec![],
            artifact_sets: vec![],
            name: ginfer_host::local_host::computer_name()?,
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
    let operation_id = config.load_operation_id;
    if let Some(id) = operation_id {
        control
            .request(
                &format!("/host/v1/load-operations/{id}"),
                Some(serde_json::json!({"action":"begin"})),
            )
            .await?;
    }
    let result = load_on_host_inner(
        sessions,
        control.clone(),
        model_id,
        model_path,
        config,
        timeout,
    )
    .await;
    if let Some(id) = operation_id {
        let action = if result.is_ok() { "complete" } else { "fail" };
        let _ = control
            .request(
                &format!("/host/v1/load-operations/{id}"),
                Some(serde_json::json!({"action":action})),
            )
            .await;
    }
    result
}

async fn load_on_host_inner(
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
    let config = canonical_gpu_selection(config);
    let requested = options(&config)?;
    let mask = std::env::var("CUDA_VISIBLE_DEVICES").map(Some).or_else(|error| {
        if matches!(error, std::env::VarError::NotPresent) { Ok(None) }
        else { Err("CUDA_VISIBLE_DEVICES must be valid Unicode".to_string()) }
    })?;
    let device_order = std::env::var("CUDA_DEVICE_ORDER").map(Some).or_else(|error| {
        if matches!(error, std::env::VarError::NotPresent) { Ok(None) }
        else { Err("CUDA_DEVICE_ORDER must be valid Unicode".to_string()) }
    })?;
    let visible = visible_selection(&snapshot, &config, mask.as_deref(), device_order.as_deref())?;
    let selected = selected_profile(&snapshot, model.id, &config, &requested, &visible);
    let automatic_launch = if config.use_profile_defaults {
        selected.as_ref().map(|(profile, group)| {
            profile_request(model.id, profile, group.clone(), &config, &requested)
        })
    } else {
        None
    };
    let residents: Vec<_> = snapshot["instances"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|i| matches!(i["status"].as_str(), Some("ready" | "starting")))
        .filter_map(|i| {
            let launch: LaunchRequest = serde_json::from_value(i["profile"].clone()).ok()?;
            let id: Uuid = serde_json::from_value(i["instance_id"].clone()).ok()?;
            let settings_match = if config.use_profile_defaults {
                automatic_launch.as_ref().is_some_and(|expected| {
                    launch.gpu_uuids == expected.gpu_uuids
                        && launch.max_context == expected.max_context
                        && launch.concurrency == expected.concurrency
                        && launch.options == expected.options
                })
            } else {
                matches_resident(&launch, &config, &requested, &visible)
            };
            (launch.model_id == model.id && settings_match)
                .then_some((id, launch))
        })
        .collect();
    if residents.len() > 1 {
        return Err("Multiple matching resident instances exist; choose the intended host instance explicitly".into());
    }
    if let Some((id, launch)) = residents.into_iter().next() {
        return attach(sessions, control, launch, id, model_id, model_path, timeout,
            config.load_operation_id,
        ).await;
    }
    if let Some((profile, gpu_uuids)) = selected {
        let mut launch = profile_request(model.id, &profile, gpu_uuids, &config, &requested);
        let result = control.request("/host/v1/profile-launch", Some(serde_json::json!({
            "profile_id": profile.id, "model_id": model.id, "gpu_uuids": launch.gpu_uuids,
            "structured_outputs": launch.options.structured_outputs,
            "kv_arena_bytes": launch.options.kv_arena_bytes,
                    "load_operation_id":config.load_operation_id,
                }))).await?;
        let instance_id: Uuid = serde_json::from_value(result["instance_id"].clone())
            .map_err(|e| e.to_string())?;
        launch.instance_id = Some(instance_id);
        return attach(sessions, control, launch, instance_id, model_id, model_path, timeout,
            config.load_operation_id,
        ).await;
    }
    if config.use_profile_defaults || config.max_context == 0 || config.max_concurrency == 0 {
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
    let inventory = snapshot["gpus"].as_array().ok_or("Host GPU inventory is unavailable")?;
    let order = config.gpu_uuids.as_ref().unwrap_or(&visible);
    let available: Vec<_> = order.iter().filter(|id| !occupied.contains(id.as_str()))
        .filter_map(|id| inventory.iter().find(|gpu| gpu["uuid"].as_str() == Some(id.as_str())))
        .collect();
    let gpu_uuids = if let Some(selected) = &config.gpu_uuids {
        if selected.len() != model.metadata.tp_size as usize || available.len() != selected.len()
            || available.iter().any(|gpu| gpu["name"] != available[0]["name"]
                || gpu["compute_capability"] != available[0]["compute_capability"]) {
            return Err("Selected GPUs must be unreserved, homogeneous, and match the model tensor parallel size".into());
        }
        selected.clone()
    } else {
        available.iter().find_map(|first| {
            let group: Vec<String> = available.iter().filter(|gpu| gpu["name"] == first["name"]
                && gpu["compute_capability"] == first["compute_capability"])
                .take(model.metadata.tp_size as usize).filter_map(|gpu| gpu["uuid"].as_str().map(str::to_string)).collect();
            (group.len() == model.metadata.tp_size as usize).then_some(group)
        }).ok_or("No visible unreserved homogeneous GPU group is available; manage existing instances in Engines")?
    };
    let launch = LaunchRequest {
        benchmark_profile: None,
        instance_id: None,
        qualified_profile_id: None,
        model_id: model.id,
        gpu_uuids,
        max_context: config.max_context,
        concurrency: config.max_concurrency,
        options: requested,
    };
    let mut placement = serde_json::to_value(&launch).map_err(|e| e.to_string())?;
    placement["load_operation_id"] =
        serde_json::to_value(config.load_operation_id).map_err(|e| e.to_string())?;
    let result = control
        .request("/host/v1/instances", Some(placement))
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
        config.load_operation_id,
    )
    .await
}

#[allow(clippy::too_many_arguments)] // Keep the load owner beside the existing attachment inputs.
async fn attach(
    sessions: Arc<Mutex<HashMap<i32, GinferSession>>>,
    control: Arc<ginfer_host::launcher::LocalControl>,
    launch: LaunchRequest,
    instance_id: Uuid,
    model_id: String,
    model_path: String,
    timeout: u64,
    operation_id: Option<Uuid>,
) -> Result<SessionInfo, String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout);
    let mut expected_session = None;
    let connection = loop {
        if let Some(id) = operation_id {
            let status = control
                .request(&format!("/host/v1/load-operations/{id}"), None)
                .await?;
            if status["status"] == "cancelled" {
                return Err("Model load cancelled".into());
            }
        }
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
            || active.gpu_uuids != launch.gpu_uuids
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
    use std::os::unix::fs::PermissionsExt;

    fn ordered_snapshot() -> Value {
        serde_json::json!({
            "gpus":[{"uuid":"GPU-zero"},{"uuid":"GPU-one"}],
            "cuda_visible_gpu_uuids":["GPU-zero","GPU-one"],
            "gpu_device_orders": {
                "pci_bus_id":["GPU-zero","GPU-one"],
                "fastest_first": {
                    "cuda_device_uuids":["GPU-one","GPU-zero"],
                    "cuda_device_order":"FASTEST_FIRST",
                    "effective_cuda_device_order":"FASTEST_FIRST"
                }
            }
        })
    }

    #[test]
    fn installed_load_canonicalizes_bare_and_prefixed_uuids_before_selection() {
        let snapshot = ordered_snapshot();
        let groups = serde_json::json!([["GPU-zero", "GPU-one"]]);
        for selected in [
            vec!["one", "zero"],
            vec!["GPU-one", "GPU-zero"],
            vec!["one", "GPU-zero"],
        ] {
            let config = canonical_gpu_selection(GinferConfig {
                gpu_uuids: Some(selected.into_iter().map(String::from).collect()),
                ..Default::default()
            });
            let visible = visible_selection(&snapshot, &config, None, None).unwrap();
            let expected = vec!["GPU-one".to_string(), "GPU-zero".to_string()];
            assert_eq!(config.gpu_uuids.as_ref().unwrap(), &expected);
            assert_eq!(selected_group(&groups, &config, &visible), Some(expected.clone()));
            assert!(group_matches(&expected, &config, &visible));
            assert!(visible_selection(&snapshot, &config, Some("0"), Some("PCI_BUS_ID")).is_err());
            assert!(visible_selection(&snapshot, &config, Some("GPU-one"), None).is_err());
        }
        for selected in [vec!["one", "GPU-one"], vec!["gone"]] {
            let config = canonical_gpu_selection(GinferConfig {
                gpu_uuids: Some(selected.into_iter().map(String::from).collect()),
                ..Default::default()
            });
            assert!(visible_selection(&snapshot, &config, None, None).is_err());
        }
        assert!(canonical_gpu_selection(GinferConfig::default()).gpu_uuids.is_none());
    }

    #[test]
    fn installed_load_intersects_visibility_and_rejects_missing_saved_gpu() {
        let snapshot = ordered_snapshot();
        let mut config = GinferConfig::default();
        assert_eq!(visible_selection(&snapshot, &config, Some("1"), Some("PCI_BUS_ID")).unwrap(), vec!["GPU-one"]);
        assert_eq!(visible_selection(&snapshot, &config, Some("1,0"), Some("PCI_BUS_ID")).unwrap(), vec!["GPU-one", "GPU-zero"]);
        config.gpu_uuids = Some(vec!["GPU-zero".into()]);
        assert!(visible_selection(&snapshot, &config, Some("1"), Some("PCI_BUS_ID")).unwrap_err().contains("excluded"));
        config.gpu_uuids = Some(vec!["GPU-gone".into()]);
        assert!(visible_selection(&snapshot, &config, None, None).is_err());
        config.gpu_uuids = None;
        let mut restricted = snapshot.clone();
        restricted["cuda_visible_gpu_uuids"] = serde_json::json!(["GPU-one"]);
        assert!(visible_selection(&restricted, &config, Some("0"), Some("PCI_BUS_ID")).unwrap().is_empty());
    }

    #[test]
    fn desktop_uses_its_own_order_and_intersects_a_differently_ordered_host_grant() {
        let snapshot = ordered_snapshot();
        let config = GinferConfig::default();
        assert_eq!(visible_selection(&snapshot, &config, Some("0"), None).unwrap(), vec!["GPU-one"]);
        assert_eq!(visible_selection(&snapshot, &config, Some("0"), Some("PCI_BUS_ID")).unwrap(), vec!["GPU-zero"]);
        assert_eq!(visible_selection(&snapshot, &config, Some("1,0"), None).unwrap(), vec!["GPU-zero", "GPU-one"]);
        assert_eq!(visible_selection(&snapshot, &config, None, None).unwrap(), vec!["GPU-one", "GPU-zero"]);
        let mut restricted = snapshot;
        restricted["cuda_visible_gpu_uuids"] = serde_json::json!(["GPU-zero"]);
        assert!(visible_selection(&restricted, &config, Some("0"), None).unwrap().is_empty());
        assert_eq!(visible_selection(&restricted, &config, Some("0"), Some("PCI_BUS_ID")).unwrap(), vec!["GPU-zero"]);
    }

    #[test]
    fn old_host_without_authoritative_order_allows_uuid_but_rejects_numeric_masks() {
        let snapshot = serde_json::json!({"gpus":[{"uuid":"GPU-zero"},{"uuid":"GPU-one"}],
            "cuda_visible_gpu_uuids":["GPU-zero","GPU-one"]});
        let config = GinferConfig::default();
        assert_eq!(visible_selection(&snapshot, &config, Some("GPU-one,GPU-zero"), None).unwrap(), vec!["GPU-one", "GPU-zero"]);
        assert!(visible_selection(&snapshot, &config, Some("0"), None).unwrap_err().contains("authoritative"));
        assert!(visible_selection(&snapshot, &config, Some("0"), Some("PCI_BUS_ID")).is_err());
        assert!(visible_selection(&snapshot, &config, None, Some("invalid")).is_err());
    }

    #[test]
    fn automatic_catalog_selection_respects_visibility_order() {
        let groups = serde_json::json!([["GPU-zero"], ["GPU-one"]]);
        let visible = vec!["GPU-one".to_string(), "GPU-zero".to_string()];
        assert_eq!(selected_group(&groups, &GinferConfig::default(), &visible), Some(vec!["GPU-one".to_string()]));
        let explicit = GinferConfig { gpu_uuids: Some(vec!["GPU-zero".to_string()]), ..Default::default() };
        assert_eq!(selected_group(&groups, &explicit, &visible), Some(vec!["GPU-zero".to_string()]));
    }

    fn screened_profile() -> LaunchProfile {
        serde_json::from_value(serde_json::json!({
            "id": "rtx-pro6000-flash-next-smol-q2g64-tp1-c8-128k-int8-screened",
            "name": "RTX PRO 6000 Flash Next — screened, not full-context qualified",
            "platform": "linux",
            "identity": {"model_id":"qwen3.8-flash-next", "weights_id":"smol-q2g64"},
            "artifact_sha256":"8bbb85bf6ba669157045bac0a6fdd623dd87694b7b1fe09b7f2150fc3636ab08",
            "artifact_bytes": 1, "tp": 1, "draft_tp": 0,
            "gpu_name": "NVIDIA RTX PRO 6000 Blackwell Workstation Edition",
            "compute_capability": "12.0", "vram_tier_gib": 96,
            "min_memory_mib_per_gpu": 95000, "max_context": 131072, "concurrency": 8,
            "options": {"vision":false, "structured_outputs":true, "spec":"mtp",
                "draft_policy":"fixed", "draft_tokens":3, "kv_dtype":"int8"},
            "qualification": {"tier":"screened-startup", "evidence":"pm-v2-20261015-caaddfaa",
                "engine_revision":"caaddfaa", "free_bytes_per_gpu":18581880832u64,
                "full_context_requests":0, "smoke_requests":8}
        })).unwrap()
    }

    #[test]
    fn installed_profile_defaults_select_the_screened_cap_without_model_overrides() {
        let model = Uuid::new_v4();
        let profile = screened_profile();
        profile.validate().unwrap();
        let snapshot = serde_json::json!({"launch_profiles":[{
            "model_id":model, "profile":profile, "gpu_groups":[["GPU-one"]]
        }]});
        let visible = vec!["GPU-zero".into(), "GPU-one".into()];
        let mut config = GinferConfig {
            max_context: 262144, vision: true, gpu_uuids: Some(vec!["GPU-one".into()]),
            ..Default::default()
        };
        // The RC treated the library's native-context/Vision defaults as overrides.
        assert!(selected_profile(&snapshot, model, &config, &options(&config).unwrap(), &visible).is_none());
        config.use_profile_defaults = true;
        config.kv_arena_bytes = "saved custom value".into();
        let requested = options(&config).unwrap();
        let (selected, group) = selected_profile(&snapshot, model, &config, &requested, &visible).unwrap();
        let launch = profile_request(model, &selected, group, &config, &requested);
        assert_eq!((launch.max_context, launch.concurrency), (131072, 8));
        assert_eq!(launch.options, profile.options);
        assert_eq!(launch.qualified_profile_id.as_deref(), Some(profile.id.as_str()));
        assert_eq!(launch.gpu_uuids, vec!["GPU-one"]);
        assert!(!launch.options.vision);
        assert_eq!(selected.qualification.tier, ginfer_host::launch_profiles::QualificationTier::ScreenedStartup);

        // Automatic intent cannot select a different GPU or an invisible group.
        config.gpu_uuids = Some(vec!["GPU-zero".into()]);
        assert!(selected_profile(&snapshot, model, &config, &requested, &visible).is_none());
        config.gpu_uuids = Some(vec!["GPU-one".into()]);
        assert!(selected_profile(&snapshot, model, &config, &requested, &["GPU-zero".into()]).is_none());

        // Other callers keep their explicit settings and the existing exact-match rules.
        config.use_profile_defaults = false;
        config.kv_arena_bytes = "auto".into();
        config.max_context = 131072;
        config.max_concurrency = 8;
        config.vision = false;
        let requested = options(&config).unwrap();
        assert!(selected_profile(&snapshot, model, &config, &requested, &visible).is_some());
        config.max_context = 262144;
        assert!(selected_profile(&snapshot, model, &config, &requested, &visible).is_none());

        // Preserve catalog OFF too; Host's profile-launch default is ON if omitted.
        let mut text_profile = profile;
        text_profile.options.structured_outputs = false;
        config.use_profile_defaults = true;
        assert!(!profile_request(model, &text_profile, vec!["GPU-one".into()], &config, &requested)
            .options.structured_outputs);
    }

    #[test]
    fn installed_profile_kv_is_auto_unless_explicitly_overridden() {
        let model = Uuid::new_v4();
        let mut profile = screened_profile();
        profile.options.kv_arena_bytes = Some(8 << 30);
        let snapshot = serde_json::json!({"launch_profiles":[{
            "model_id":model, "profile":profile, "gpu_groups":[["GPU-one"]]
        }]});
        let visible = vec!["GPU-one".into()];
        let mut config = GinferConfig {
            use_profile_defaults: true,
            kv_arena_bytes: "saved custom value".into(),
            ..Default::default()
        };
        let requested = options(&config).unwrap();
        let (selected, group) = selected_profile(&snapshot, model, &config, &requested, &visible).unwrap();
        let automatic = profile_request(model, &selected, group, &config, &requested);
        let mut expected = profile.options.clone();
        expected.kv_arena_bytes = None;
        assert_eq!(automatic.options, expected);
        assert!(automatic.qualified_profile_id.is_none());

        config.use_profile_defaults = false;
        config.vision = profile.options.vision;
        config.kv_arena_bytes = (1_u64 << 30).to_string();
        let requested = options(&config).unwrap();
        let (selected, group) = selected_profile(&snapshot, model, &config, &requested, &visible).unwrap();
        let explicit = profile_request(model, &selected, group, &config, &requested);
        expected.kv_arena_bytes = Some(1 << 30);
        assert_eq!(explicit.options, expected);
        assert!(explicit.qualified_profile_id.is_none());

        // Qualification survives only an exact match of the normalized options.
        config.kv_arena_bytes = (8_u64 << 30).to_string();
        let exact = profile_request(model, &profile, visible, &config, &options(&config).unwrap());
        assert_eq!(exact.options, profile.options);
        assert_eq!(exact.qualified_profile_id.as_deref(), Some(profile.id.as_str()));
    }

    #[test]
    fn multi_gpu_catalog_selection_preserves_visible_rank_order() {
        let visible: Vec<String> = ["GPU-three", "GPU-one", "GPU-two", "GPU-zero"]
            .into_iter().map(String::from).collect();
        let pairs = serde_json::json!([["GPU-zero", "GPU-one"], ["GPU-two", "GPU-three"]]);
        assert_eq!(selected_group(&pairs, &GinferConfig::default(), &visible),
            Some(vec!["GPU-three".into(), "GPU-two".into()]));
        let four = serde_json::json!([["GPU-zero", "GPU-one", "GPU-two", "GPU-three"]]);
        assert_eq!(selected_group(&four, &GinferConfig::default(), &visible), Some(visible));
    }

    #[test]
    fn explicit_catalog_selection_preserves_order_only_for_the_exact_qualified_set() {
        let groups = serde_json::json!([["GPU-zero", "GPU-one"]]);
        let visible = vec!["GPU-zero".into(), "GPU-one".into(), "GPU-two".into()];
        let mut config = GinferConfig {
            gpu_uuids: Some(vec!["GPU-one".into(), "GPU-zero".into()]),
            ..Default::default()
        };
        assert_eq!(selected_group(&groups, &config, &visible), config.gpu_uuids);
        config.gpu_uuids = Some(vec!["GPU-zero".into(), "GPU-two".into()]);
        assert!(selected_group(&groups, &config, &visible).is_none());
        config.gpu_uuids = Some(vec!["GPU-zero".into(), "GPU-zero".into()]);
        assert!(selected_group(&groups, &config, &visible).is_none());
        let invalid = serde_json::json!([[], ["GPU-zero", "GPU-zero"], ["GPU-zero", "GPU-hidden"]]);
        assert!(selected_group(&invalid, &GinferConfig::default(), &visible).is_none());
    }

    #[test]
    fn installed_load_never_reuses_a_resident_on_the_wrong_or_hidden_gpu() {
        let requested = LaunchOptions::default();
        let mut config = GinferConfig {
            gpu_uuids: Some(vec!["GPU-one".into()]),
            ..Default::default()
        };
        let mut launch = LaunchRequest {
            instance_id: None, qualified_profile_id: None, benchmark_profile: None,
            model_id: Uuid::nil(), gpu_uuids: vec!["GPU-zero".into()],
            max_context: 8192, concurrency: 1, options: requested.clone(),
        };
        let visible = vec!["GPU-zero".into(), "GPU-one".into()];
        assert!(!matches_resident(&launch, &config, &requested, &visible));
        launch.gpu_uuids = vec!["GPU-one".into()];
        assert!(matches_resident(&launch, &config, &requested, &visible));
        assert!(!matches_resident(&launch, &config, &requested, &["GPU-zero".into()]));
        config.gpu_uuids = None;
        assert!(!matches_resident(&launch, &config, &requested, &["GPU-zero".into()]));
        config.gpu_uuids = Some(vec!["GPU-one".into(), "GPU-zero".into()]);
        launch.gpu_uuids = vec!["GPU-zero".into(), "GPU-one".into()];
        assert!(!matches_resident(&launch, &config, &requested, &visible));
        launch.gpu_uuids.reverse();
        assert!(matches_resident(&launch, &config, &requested, &visible));
    }

    #[tokio::test]
    async fn desktop_attaches_and_reuses_auto_kv_profiles_and_preserves_explicit_budgets() {
        let root = tempfile::tempdir().unwrap();
        let engine = root.path().join("ginfer-serve");
        std::fs::write(
            &engine,
            r#"#!/usr/bin/env python3
import http.server, json, sys
args = sys.argv[1:]
def arg(name):
    return args[args.index(name) + 1]
if '--quote-only' in args:
    model, weights = arg('--model-id').split('/', 1)
    print(json.dumps(dict(schema='ginfer-startup-quote-v1', model_id=model,
        weights_id=weights, tensor_parallel_size=int(arg('--tp')), ranks=[dict(rank=0,
        free_bytes=4294967296, weights_bytes=8192, state_bytes=2048,
        graph_allowance_bytes=1024, graph_allowance_source='planner',
        minimum_kv_arena_bytes=1024, kv_arena_alignment_bytes=256,
        headroom_bytes=int(arg('--kv-arena-headroom-bytes')),
        startup_peak_bytes=12288)])))
    sys.exit(0)
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps(dict(data=[dict(id=arg('--model-id'))])).encode())
    def log_message(self, *args): pass
http.server.HTTPServer(('127.0.0.1', int(arg('--port'))), Handler).serve_forever()
"#,
        )
        .unwrap();
        std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o700)).unwrap();
        let profiling_cli = root.path().join("ginfer");
        std::fs::write(&profiling_cli, r#"#!/usr/bin/env python3
import hashlib, json, pathlib, sys
args = sys.argv[1:]
def arg(name, default=None):
    return args[args.index(name) + 1] if name in args else default
# The resident fixture must pass the same selected-artifact preparation as
# production. It cannot calibrate hardware or load weights.
model = pathlib.Path(arg('--model')).resolve()
model.with_suffix('.sha256').write_text(hashlib.sha256(model.read_bytes()).hexdigest())
with model.open('rb') as source:
    prefix = source.read(16)
    directory = source.read(int.from_bytes(prefix[8:], 'little'))
output = pathlib.Path(arg('--hardware-profile'))
output.write_text(json.dumps(dict(schema_version=2)))
print(json.dumps(dict(schema_version=2, mode='ensure', scope='artifact',
    hardware_profile=str(output), state='loaded', complete=True,
    base_complete=True, all_formats_complete=False, missing_rows=[],
    artifact=dict(path=str(model), directory_sha256=hashlib.sha256(directory).hexdigest(),
        tp=int(arg('--tp')), draft_tp=int(arg('--draft-tp', '0')),
        spec=arg('--spec'), draft_tokens=int(arg('--draft-tokens', '0'))))))
"#).unwrap();
        std::fs::set_permissions(&profiling_cli, std::fs::Permissions::from_mode(0o700)).unwrap();
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
        let hardware = ginfer_host::hardware_profile::group_profile_path(
            &directory,
            &["GPU-test".into()],
        );
        std::fs::create_dir_all(hardware.parent().unwrap()).unwrap();
        std::fs::write(hardware, br#"{"schema_version":2}"#).unwrap();
        let host = Host::open(
            directory.clone(),
            "Test".into(),
            engine,
            vec![artifact.clone()],
            vec![],
            vec![Gpu {
                display_name: None,
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
            benchmark_profile: None,
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
        let monitored_host = host.clone();
        let monitor = tokio::spawn(async move {
            loop {
                monitored_host.refresh_processes().await.unwrap();
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        });
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if host.snapshot().await["instances"][0]["status"] == "ready" {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }).await.unwrap();
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
            gpu_uuids: Some(vec!["test".into()]),
            ..GinferConfig::default()
        };
        let desktop = crate::state::GinferState::new();
        let sessions = desktop.ginfer_process.clone();
        let embedding = load(
            sessions.clone(),
            root.path().join("absent-host"),
            GinferLoadRequest {
                binary_path: root.path().join("absent-engine"),
                host_directory: directory.clone(),
                model_id: "embedding-alias".into(),
                model_path: artifact.to_string_lossy().into_owned(),
                config: config.clone(),
                is_embedding: true,
                timeout: 5,
            },
        )
        .await;
        assert_eq!(
            embedding.unwrap_err(),
            "GInfer does not provide an embeddings endpoint"
        );
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
        let original_connection = sessions.lock().await[&info.pid].owner.connection.clone();
        assert_eq!(original_connection.instance_id, id);
        let original_endpoint = host.processes.lock().await.endpoint(id).unwrap();
        let response = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{}/v1/models", info.port))
            .bearer_auth(&info.api_key)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.json::<Value>().await.unwrap()["data"][0]["id"], "muse-glimmer-30b/nvfp4");

        // Desktop cleanup drops client state, not the Host-owned Engine.
        sessions.lock().await.clear();
        drop(sessions);
        drop(control);
        drop(desktop);
        assert_eq!(host.processes.lock().await.endpoint(id).unwrap(), original_endpoint);

        // A reopened desktop authenticates again and discovers the same Ready
        // session without inheriting the old client's in-memory handles.
        let desktop = crate::state::GinferState::new();
        let sessions = desktop.ginfer_process.clone();
        assert!(sessions.lock().await.is_empty());
        let control = Arc::new(LocalControl::open(&directory, &origin).unwrap());
        let reopened = control.snapshot().await.unwrap();
        assert_eq!(reopened["instances"].as_array().unwrap().len(), 1);
        assert_eq!(reopened["instances"][0]["instance_id"], id.to_string());
        assert_eq!(reopened["instances"][0]["session_id"], original_connection.session_id.to_string());
        assert_eq!(reopened["instances"][0]["status"], "ready");
        assert_eq!(reopened["instances"][0]["configuration"]["port"], port);
        let automatic = load_on_host(
            sessions.clone(), control.clone(), "desktop-alias".into(),
            artifact.to_string_lossy().into_owned(),
            GinferConfig { use_profile_defaults: true, ..config.clone() }, 5,
        ).await.unwrap_err();
        assert!(automatic.contains("No qualified automatic profile"));
        assert_eq!(host.processes.lock().await.instances().count(), 1);
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
            GinferConfig {
                gpu_uuids: Some(vec!["GPU-test".into()]),
                ..config.clone()
            },
            5,
        )
        .await
        .unwrap();
        assert_eq!(reconnected.port, info.port);
        let reconnected_connection = sessions.lock().await[&reconnected.pid].owner.connection.clone();
        assert_eq!(reconnected_connection.instance_id, original_connection.instance_id);
        assert_eq!(reconnected_connection.session_id, original_connection.session_id);
        assert_eq!(reconnected_connection.port, original_connection.port);
        assert_eq!(host.processes.lock().await.endpoint(id).unwrap(), original_endpoint);
        assert_eq!(host.processes.lock().await.instances().count(), 1);
        let response = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{}/v1/models", reconnected.port))
            .bearer_auth(&reconnected.api_key)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.json::<Value>().await.unwrap()["data"][0]["id"], "muse-glimmer-30b/nvfp4");
        let session = sessions.lock().await.remove(&reconnected.pid).unwrap();
        let SessionOwner {
            control,
            connection,
        } = session.owner;
        control.stop_session(&connection).await.unwrap();
        assert!(host.processes.lock().await.endpoint(id).is_err());
        assert_eq!(control.snapshot().await.unwrap()["instances"][0]["status"], "stopped");
        assert!(tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_err());

        let active: LaunchRequest = serde_json::from_value(
            host.snapshot().await["instances"][0]["profile"].clone(),
        ).unwrap();
        let mut profile = screened_profile();
        profile.platform = std::env::consts::OS.into();
        profile.identity.model_id = "muse-glimmer-30b".into();
        profile.identity.weights_id = "nvfp4".into();
        profile.artifact_sha256 = std::fs::read_to_string(artifact.with_extension("sha256")).unwrap();
        profile.artifact_bytes = 4096;
        profile.gpu_name = "Fixture".into();
        profile.vram_tier_gib = 32;
        profile.min_memory_mib_per_gpu = 32768;
        profile.max_context = 8192;
        profile.concurrency = 1;
        profile.qualification.smoke_requests = Some(1);
        profile.options = active.options;
        profile.options.kv_arena_bytes = Some(8 << 30);
        profile.validate().unwrap();
        // Registering the artifact rescans the installed catalog on every Load.
        std::fs::write(
            directory.join("launch-profiles.json"),
            serde_json::to_vec(&serde_json::json!({
                "schema": "ginfer-launch-profiles-v1", "profiles": [profile]
            })).unwrap(),
        ).unwrap();
        host.scan().await.unwrap();
        let catalog = host.snapshot().await;
        assert_eq!(catalog["launch_profiles"].as_array().unwrap().len(), 1);
        assert_eq!(catalog["launch_profiles"][0]["model_id"], model_id.to_string());
        assert_eq!(catalog["launch_profiles"][0]["gpu_groups"], serde_json::json!([["GPU-test"]]));

        // A positive historical catalog arena becomes Auto in both the saved
        // Host request and the adapter's attachment expectation.
        let automatic_config = GinferConfig { use_profile_defaults: true, ..config.clone() };
        let automatic = load_on_host(
            sessions.clone(), control.clone(), "desktop-alias".into(),
            artifact.to_string_lossy().into_owned(), automatic_config.clone(), 5,
        ).await.unwrap();
        assert_eq!(automatic.kv_arena_bytes, "auto");
        assert_eq!(automatic.max_context, 8192);
        assert_eq!(automatic.spec, "none");
        let automatic_connection = sessions.lock().await[&automatic.pid].owner.connection.clone();
        let snapshot = host.snapshot().await;
        let automatic_instance = snapshot["instances"].as_array().unwrap().iter()
            .find(|instance| instance["instance_id"] == automatic_connection.instance_id.to_string()).unwrap();
        assert!(automatic_instance["profile"]["kv_arena_bytes"].is_null());
        assert!(automatic_instance["profile"]["qualified_profile_id"].is_null());
        let reused = load_on_host(
            sessions.clone(), control.clone(), "desktop-alias".into(),
            artifact.to_string_lossy().into_owned(), automatic_config, 5,
        ).await.unwrap();
        assert_eq!(reused.kv_arena_bytes, "auto");
        assert_eq!(reused.port, automatic.port);
        let reused_connection = sessions.lock().await[&reused.pid].owner.connection.clone();
        assert_eq!(reused_connection.instance_id, automatic_connection.instance_id);
        assert_eq!(reused_connection.session_id, automatic_connection.session_id);
        control.stop_session(&automatic_connection).await.unwrap();

        // A different positive budget must travel through profile-launch,
        // remain exact in persisted settings, and attach without qualification.
        let explicit = load_on_host(
            sessions.clone(), control.clone(), "desktop-alias".into(),
            artifact.to_string_lossy().into_owned(),
            GinferConfig {
                kv_arena_bytes: (1_u64 << 30).to_string(),
                max_context: 0, max_concurrency: 0, ..config
            }, 5,
        ).await.unwrap();
        assert_eq!(explicit.kv_arena_bytes, (1_u64 << 30).to_string());
        assert_eq!(explicit.max_context, 8192);
        assert_eq!(explicit.spec, "none");
        let explicit_connection = sessions.lock().await[&explicit.pid].owner.connection.clone();
        let snapshot = host.snapshot().await;
        let explicit_instance = snapshot["instances"].as_array().unwrap().iter()
            .find(|instance| instance["instance_id"] == explicit_connection.instance_id.to_string()).unwrap();
        assert_eq!(explicit_instance["configuration"]["kv_arena_bytes"], 1_u64 << 30);
        assert_eq!(explicit_instance["profile"]["kv_arena_bytes"], 1_u64 << 30);
        assert!(explicit_instance["profile"]["qualified_profile_id"].is_null());
        let persisted: Value = serde_json::from_slice(
            &std::fs::read(directory.join("host.json")).unwrap(),
        ).unwrap();
        let explicit_id = explicit_connection.instance_id.to_string();
        assert_eq!(persisted["profiles"][&explicit_id]["kv_arena_bytes"], 1_u64 << 30);
        assert!(persisted["profiles"][&explicit_id]["qualified_profile_id"].is_null());
        let saved: LaunchRequest = serde_json::from_value(explicit_instance["profile"].clone()).unwrap();
        for (kv_arena_bytes, no_cuda_graph) in [(Some(2 << 30), false), (Some(1 << 30), true)] {
            let mut drifted = saved.clone();
            drifted.options.kv_arena_bytes = kv_arena_bytes;
            drifted.options.no_cuda_graph = no_cuda_graph;
            let error = attach(
                sessions.clone(), control.clone(), drifted, explicit_connection.instance_id,
                "desktop-alias".into(), artifact.to_string_lossy().into_owned(), 5, None,
            ).await.unwrap_err();
            assert_eq!(error, "Host launch settings changed while attaching");
        }
        assert!(host.processes.lock().await.endpoint(explicit_connection.instance_id).is_ok());
        control.stop_session(&explicit_connection).await.unwrap();
        server.abort();
        monitor.abort();
        host.processes.lock().await.shutdown().await.unwrap();
    }
}
