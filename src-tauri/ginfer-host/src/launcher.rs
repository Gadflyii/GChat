//! Interactive client of an installed host service; never owns inference children.
use crate::{service::Persistent, transport::pinned_client};
use serde_json::{json, Value};
use std::{
    io::{IsTerminal, Write},
    path::Path,
    time::Duration,
};

#[cfg(test)]
thread_local! {
    static CONTROL_WORK: std::cell::Cell<(usize, usize)> = const { std::cell::Cell::new((0, 0)) };
}

#[cfg(test)]
pub(crate) fn control_work_counts() -> (usize, usize) {
    CONTROL_WORK.with(std::cell::Cell::get)
}

pub struct LocalControl {
    client: reqwest::Client,
    origin: reqwest::Url,
    token: String,
    host_id: uuid::Uuid,
    fingerprint: String,
}

#[derive(Clone, serde::Deserialize)]
pub struct LocalConnection {
    pub instance_id: uuid::Uuid,
    pub session_id: uuid::Uuid,
    pub model_id: String,
    pub port: u16,
    pub api_key: String,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstalledConfiguration {
    pub data_dir: std::path::PathBuf,
    pub host_url: String,
    pub desktop: Option<DesktopBootstrap>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesktopBootstrap {
    pub provider: std::path::PathBuf,
    pub engine: std::path::PathBuf,
}

fn installed_configuration_path() -> Result<std::path::PathBuf, String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(executable
        .parent()
        .ok_or("launcher executable has no parent")?
        .join("ginfer-launch.json"))
}

fn read_installed_configuration(path: &Path) -> Result<Option<InstalledConfiguration>, String> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Could not read installed launcher configuration {}: {error}",
                path.display()
            ));
        }
    };
    let config: InstalledConfiguration = serde_json::from_reader(std::io::BufReader::new(file))
        .map_err(|error| {
            format!(
                "Invalid installed launcher configuration {}: {error}",
                path.display()
            )
        })?;
    if !config.data_dir.is_absolute() {
        return Err("installed host data path must be absolute".into());
    }
    Ok(Some(config))
}

pub fn installed_configuration() -> Result<InstalledConfiguration, String> {
    let path = installed_configuration_path()?;
    read_installed_configuration(&path)?.ok_or_else(|| {
        format!(
            "Missing installed launcher configuration {}",
            path.display()
        )
    })
}

impl InstalledConfiguration {
    pub async fn open_menu(self) -> Result<(), String> {
        require_terminal()?;
        menu_control(self.connect().await?).await
    }

    pub async fn connect(self) -> Result<LocalControl, String> {
        self.connect_resolving(|owner| async move {
            crate::local_host_registry::resolve(Some(owner)).await
        }).await
    }

    async fn connect_resolving<F, Fut>(self, resolve: F) -> Result<LocalControl, String>
    where
        F: FnOnce(crate::local_host_registry::Owner) -> Fut,
        Fut: std::future::Future<Output = Result<crate::local_host_registry::Owner, String>>,
    {
        let owner = if let Some(desktop) = self.desktop {
            if self.data_dir != desktop.provider.join("host") {
                return Err("desktop launcher must use its provider-owned host directory".into());
            }
            let origin = reqwest::Url::parse(&self.host_url).map_err(|e| e.to_string())?;
            if origin.scheme() != "https" || origin.path() != "/" || origin.query().is_some()
                || origin.fragment().is_some() || !origin.username().is_empty() || origin.password().is_some() {
                return Err("desktop launcher requires an HTTPS loopback origin".into());
            }
            let address: std::net::IpAddr = origin.host_str().ok_or("missing local host address")?
                .trim_matches(['[', ']']).parse().map_err(|_| "desktop launcher requires a loopback IP address")?;
            let local = crate::local_host::LocalHost {
                binary: std::env::current_exe().map_err(|e| e.to_string())?,
                engine: desktop.engine,
                engine_runtimes: {
                    #[cfg(target_os = "linux")]
                    { crate::local_host::desktop_runtimes(&desktop.provider)? }
                    #[cfg(not(target_os = "linux"))]
                    { Default::default() }
                },
                directory: self.data_dir.clone(),
                desktop_provider: Some(desktop.provider),
                models: Vec::new(), artifact_sets: Vec::new(),
                name: "This computer".into(), nvidia_smi: "nvidia-smi".into(),
                listen: std::net::SocketAddr::new(address, origin.port_or_known_default().ok_or("missing host port")?),
            };
            crate::local_host_registry::Owner::Desktop(Box::new(local))
        } else {
            crate::local_host_registry::Owner::Service { directory: self.data_dir, origin: self.host_url }
        };
        owner.validate()?;
        let owner = match owner {
            owner @ crate::local_host_registry::Owner::Desktop(_) => resolve(owner).await?,
            owner @ crate::local_host_registry::Owner::Service { .. } => owner,
        };
        owner.connect().await
    }
}

pub async fn installed_menu() -> Result<(), String> {
    require_terminal()?;
    menu_control(installed_control().await?).await
}

pub async fn installed_control() -> Result<LocalControl, String> {
    let path = installed_configuration_path()?;
    if let Some(config) = read_installed_configuration(&path)? {
        return config.connect().await;
    }
    if let Some(owner) = crate::local_host_registry::registered().await? {
        return owner.connect().await;
    }
    Err(format!(
        "Missing installed launcher configuration {}",
        path.display()
    ))
}

pub async fn first_run(control: &LocalControl) -> Result<(), String> {
    require_terminal()?;
    println!("\nSet up local GInfer — progress is shared with GChat and GInfer Manager.");
    println!("You can quit at any step. Profiling and downloads continue on the Host.");
    loop {
        let flow = control.request("/host/v1/first-run", None).await?;
        if let Some(error) = flow["error"].as_str() {
            println!("Setup needs attention: {error}");
        }
        let action = match flow["step"].as_str() {
            Some("complete") => {
                println!("Local setup complete. Choose Launch instance when ready.");
                return Ok(());
            }
            Some("gpu") => {
                let snapshot = control.snapshot().await?;
                let gpus: Vec<_> = snapshot["gpus"].as_array().into_iter().flatten().collect();
                println!("\nChoose 1, 2 or 4 matching GPUs. Profiling starts after selection.");
                for (index, gpu) in gpus.iter().enumerate() {
                    println!(
                        "  {}. {} · {} MiB · {}",
                        index + 1,
                        gpu["display_name"]
                            .as_str()
                            .or_else(|| gpu["name"].as_str())
                            .unwrap_or("GPU"),
                        gpu["memory_mib"],
                        gpu["uuid"].as_str().unwrap_or("unknown UUID")
                    );
                }
                if gpus.is_empty() {
                    return Err("No supported NVIDIA GPU detected. Check your GPU and CUDA 13.1 driver, or connect a network host.".into());
                }
                let input = prompt("Select: GPU numbers separated by spaces (q to leave): ")?;
                if input == "q" {
                    return Ok(());
                }
                let selected = match selected_indices(&input, gpus.len()) {
                    Ok(selected) => selected,
                    Err(error) => {
                        println!("{error}");
                        continue;
                    }
                };
                json!({"action":"profile","gpu_uuids":selected.into_iter().map(|index| gpus[index]["uuid"].clone()).collect::<Vec<_>>()})
            }
            Some("profiling") => {
                let profile = &flow["hardware_profile"];
                println!(
                    "\nHardware profiling: {}",
                    profile["status"].as_str().unwrap_or("unknown")
                );
                println!("Recent full installs took 22–73 minutes. The Host keeps working when you close this menu.");
                if let Some(error) = profile["error"].as_str() {
                    println!("{error}");
                }
                let input = prompt("[Enter] Refresh  [r] Resume saved work  [q] Leave: ")?;
                if input == "q" {
                    return Ok(());
                }
                if input != "r" {
                    continue;
                }
                json!({"action":"resume"})
            }
            Some("storage") => {
                let storage = &flow["storage"];
                let recommended = storage["recommended_path"]
                    .as_str()
                    .or_else(|| storage["path"].as_str())
                    .unwrap_or("");
                println!("\nChoose model storage. Recommended: {recommended}");
                if let Some(error) = storage["error"].as_str() {
                    println!("{error}");
                }
                for candidate in storage["candidates"].as_array().into_iter().flatten() {
                    let capacity = candidate["available_bytes"]
                        .as_u64()
                        .map(|bytes| format!("{:.1} GiB free", bytes as f64 / 1073741824.0))
                        .unwrap_or_else(|| "free space unavailable".into());
                    println!(
                        "  {} · {} · {}",
                        candidate["path"].as_str().unwrap_or("unknown"),
                        capacity,
                        candidate["reason"].as_str().unwrap_or("")
                    );
                }
                let input = prompt("Absolute model folder (Enter = recommended, q to leave): ")?;
                if input == "q" {
                    return Ok(());
                }
                json!({"action":"storage","path":if input.is_empty() { recommended } else { input.trim_matches('"') }})
            }
            Some("models") => {
                let models: Vec<_> = flow["models"].as_array().into_iter().flatten().collect();
                println!("\nChoose models to download:");
                for (index, model) in models.iter().enumerate() {
                    println!(
                        "  {}. {} · {:.1} GiB{}\n     {}",
                        index + 1,
                        model["release"]["name"].as_str().unwrap_or("Model"),
                        model["release"]["bytes"].as_u64().unwrap_or(0) as f64 / 1073741824.0,
                        if model["recommended"] == true {
                            " · Recommended"
                        } else {
                            ""
                        },
                        model["reason"].as_str().unwrap_or("")
                    );
                }
                let snapshot = control.snapshot().await?;
                let storage = flow["storage"]["path"].as_str().unwrap_or("");
                let movable: Vec<_> = snapshot["model_management"]["downloads"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|job| {
                        job["status"] == "installed"
                            && job["path"]
                                .as_str()
                                .is_some_and(|path| !Path::new(path).starts_with(storage))
                    })
                    .collect();
                if !movable.is_empty() {
                    println!("Existing models remain in their current folders. Enter m to optionally move one into {storage}.");
                }
                if models.is_empty() {
                    println!(
                        "{}",
                        if flow["catalog_loaded"] == false && flow["error"].is_null() {
                            "Loading published model catalog. Press Enter to refresh saved progress."
                        } else {
                            "No compatible published models are available. Check the runtime, selected GPU group and model catalog, then refresh."
                        }
                    );
                }
                let input = prompt("Model numbers (Enter = recommended, r = refresh catalog, m = move existing, q = leave): ")?;
                if input == "q" {
                    return Ok(());
                }
                if models.is_empty() && input.is_empty() {
                    continue;
                }
                if input == "r" {
                    if let Err(error) = control
                        .request(
                            "/host/v1/first-run",
                            Some(json!({"action":"refresh_catalog"})),
                        )
                        .await
                    {
                        println!("Catalog unavailable: {error}");
                    }
                    continue;
                }
                if input == "m" {
                    let labels = movable
                        .iter()
                        .map(|job| {
                            format!(
                                "{} · {}",
                                job["release"]["name"].as_str().unwrap_or("Model"),
                                job["path"].as_str().unwrap_or("")
                            )
                        })
                        .collect::<Vec<_>>();
                    if let Some(index) =
                        select(&labels, "Move an existing model to selected storage")?
                    {
                        match control
                            .request(
                                "/host/v1/first-run",
                                Some(json!({"action":"move","download_id":movable[index]["id"]})),
                            )
                            .await
                        {
                            Ok(_) => println!("Model moved."),
                            Err(error) => println!("{error}"),
                        }
                    }
                    continue;
                }
                let selected = if input.is_empty() {
                    models
                        .iter()
                        .enumerate()
                        .filter_map(|(i, model)| (model["recommended"] == true).then_some(i))
                        .collect()
                } else {
                    match selected_indices(&input, models.len()) {
                        Ok(selected) => selected,
                        Err(error) => {
                            println!("{error}");
                            continue;
                        }
                    }
                };
                if selected.is_empty() {
                    println!("Select at least one model.");
                    continue;
                }
                json!({"action":"models","release_ids":selected.into_iter().map(|index| models[index]["release_id"].as_str().unwrap_or_else(|| models[index]["release"]["sha256"].as_str().unwrap_or(""))).collect::<Vec<_>>()})
            }
            Some("downloads") => {
                for job in flow["selected_downloads"].as_array().into_iter().flatten() {
                    println!(
                        "{} · {} · {:.1}% · {:.1} MiB/s",
                        job["release"]["name"].as_str().unwrap_or("Model"),
                        job["status"].as_str().unwrap_or("unknown"),
                        100.0 * job["received"].as_u64().unwrap_or(0) as f64
                            / job["release"]["bytes"].as_u64().unwrap_or(1).max(1) as f64,
                        job["bytes_per_second"].as_u64().unwrap_or(0) as f64 / 1048576.0
                    );
                    if let Some(error) = job["error"].as_str() {
                        println!("{error}");
                    }
                }
                let input = prompt("[Enter] Refresh  [r] Resume downloads  [q] Leave: ")?;
                if input == "q" {
                    return Ok(());
                }
                if input != "r" {
                    continue;
                }
                json!({"action":"resume"})
            }
            Some("startup") => {
                println!("\nReview startup defaults:");
                if flow["startup_profiles"]
                    .as_array()
                    .is_none_or(Vec::is_empty)
                {
                    println!("Preparing startup settings and checking Engine memory…");
                }
                for profile in flow["startup_profiles"].as_array().into_iter().flatten() {
                    let kv = profile["kv_arena_bytes"]
                        .as_u64()
                        .map(|bytes| format!("{:.1} GiB GPU KV cache", bytes as f64 / 1073741824.0))
                        .unwrap_or_else(|| "Automatic GPU KV cache".into());
                    println!(
                        "{} · {} instance(s) · C{} · {} tokens · {}",
                        profile["model_id"].as_str().unwrap_or("Model"),
                        profile["instance_count"],
                        profile["concurrency"],
                        profile["max_context"],
                        kv
                    );
                    if let Some(error) = profile["error"].as_str() {
                        println!("{error}");
                    }
                    if profile["quote"].is_null() && profile["error"].is_null() {
                        println!("Checking these settings with the Engine…");
                    }
                }
                let input = prompt("[y] Save defaults and finish  [a] Adjust settings  [Enter] Refresh  [q] Leave (models stay stopped): ")?;
                if input == "q" {
                    return Ok(());
                }
                if input == "a" {
                    let profiles = flow["startup_profiles"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default();
                    let labels = profiles
                        .iter()
                        .map(|profile| profile["model_id"].as_str().unwrap_or("Model").to_string())
                        .collect::<Vec<_>>();
                    let Some(index) = select(&labels, "Adjust startup defaults")? else {
                        continue;
                    };
                    let profile = &profiles[index];
                    let mut update =
                        json!({"action":"startup","download_id":profile["download_id"]});
                    for (field, label) in [
                        ("concurrency", "Concurrent requests"),
                        ("max_context", "Context tokens"),
                        ("instance_count", "Instances"),
                        ("kv_arena_bytes", "GPU KV cache bytes"),
                    ] {
                        let answer = prompt(&format!("{label} [{}]: ", profile[field]))?;
                        update[field] = if answer.is_empty() {
                            profile[field].clone()
                        } else {
                            json!(answer
                                .parse::<u64>()
                                .map_err(|_| "Use positive whole numbers for startup settings")?)
                        };
                    }
                    match control.request("/host/v1/first-run", Some(update)).await {
                        Ok(_) => (),
                        Err(error) => println!("{error}"),
                    }
                    continue;
                }
                if !input.eq_ignore_ascii_case("y") {
                    continue;
                }
                json!({"action":"complete"})
            }
            _ => {
                return Err(
                    "Host returned an unknown first-run step; update GInfer before continuing"
                        .into(),
                )
            }
        };
        match control.request("/host/v1/first-run", Some(action)).await {
            Ok(_) => (),
            Err(error) => println!("Setup needs attention: {error}"),
        }
    }
}

fn selected_indices(input: &str, count: usize) -> Result<Vec<usize>, String> {
    let mut selected = Vec::new();
    for number in input.split([' ', ',']).filter(|s| !s.is_empty()) {
        let index = number
            .parse::<usize>()
            .ok()
            .and_then(|n| n.checked_sub(1))
            .filter(|i| *i < count)
            .ok_or("Choose listed numbers")?;
        if selected.contains(&index) {
            return Err("Choose each item only once".into());
        }
        selected.push(index);
    }
    if selected.is_empty() {
        return Err("Choose at least one listed item".into());
    }
    Ok(selected)
}

impl LocalControl {
    pub fn host_id(&self) -> uuid::Uuid {
        self.host_id
    }

    pub fn open(directory: &Path, origin: &str) -> Result<Self, String> {
        Self::open_reusing(directory, origin, None)
    }

    pub(crate) fn open_reusing(directory: &Path, origin: &str, previous: Option<Self>) -> Result<Self, String> {
        #[cfg(test)]
        CONTROL_WORK.with(|counts| { let (opens, clients) = counts.get(); counts.set((opens + 1, clients)); });
        let state: Persistent = serde_json::from_reader(std::io::BufReader::new(
            std::fs::File::open(directory.join("host.json")).map_err(|e| {
                format!(
                    "Cannot open installed host state: {e}. Install and start ginfer-host first."
                )
            })?,
        ))
        .map_err(|e| e.to_string())?;
        let origin = reqwest::Url::parse(origin).map_err(|e| e.to_string())?;
        if origin.scheme() != "https"
            || origin.path() != "/"
            || origin.query().is_some()
            || origin.fragment().is_some()
            || !origin.username().is_empty()
            || origin.password().is_some()
        {
            return Err("host address must be an HTTPS origin".into());
        }
        let fingerprint = state.certificate.fingerprint();
        // Re-read local authority on every attempt before reusing its TLS pool.
        if let Some(previous) = previous {
            if previous.origin == origin && previous.host_id == state.host_id
                && previous.token == state.pairing_admin_token && previous.fingerprint == fingerprint {
                return Ok(previous);
            }
        }
        let client = pinned_client(&fingerprint)?;
        #[cfg(test)]
        CONTROL_WORK.with(|counts| { let (opens, clients) = counts.get(); counts.set((opens, clients + 1)); });
        Ok(Self {
            client,
            origin,
            token: state.pairing_admin_token,
            host_id: state.host_id,
            fingerprint,
        })
    }

    pub async fn request(&self, path: &str, body: Option<Value>) -> Result<Value, String> {
        let url = self.origin.join(path).map_err(|e| e.to_string())?;
        let request = match body {
            Some(body) => self.client.post(url).json(&body),
            None => self.client.get(url),
        };
        let response = request
            .bearer_auth(&self.token)
            .timeout(Duration::from_secs(600))
            .send()
            .await
            .map_err(|e| format!("Cannot reach ginfer-host: {e}"))?;
        let status = response.status();
        let value: Value = response.json().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(value["error"]
                .as_str()
                .unwrap_or("host operation failed")
                .to_string());
        }
        Ok(value)
    }

    pub async fn snapshot(&self) -> Result<Value, String> {
        let value = self.request("/host/v1/snapshot", None).await?;
        if value["host_id"].as_str() != Some(&self.host_id.to_string())
            || value["protocol_version"] != 1
        {
            return Err("host identity or protocol differs from installed service".into());
        }
        Ok(value)
    }

    pub async fn stop_host_if_idle(&self, directory: &Path) -> Result<Value, String> {
        let snapshot = self.snapshot().await?;
        crate::local_host::validate_local_identity(directory, &snapshot)?;
        if snapshot["can_stop_host"] != true {
            return Err("This Host does not support Windows desktop normal Stop; it was left running".into());
        }
        let boot_id: uuid::Uuid = serde_json::from_value(snapshot["boot_id"].clone())
            .map_err(|_| "The selected Host cannot prove its current process identity")?;
        self.request("/host/v1/stop", Some(json!({
            "host_id":self.host_id,"boot_id":boot_id,
            "local_identity":{"state_directory":directory.canonicalize().map_err(|e| e.to_string())?,"platform":std::env::consts::OS}
        }))).await
    }

    pub async fn register_model(&self, path: &Path) -> Result<crate::service::ModelEntry, String> {
        let entry = self
            .request("/host/v1/local-artifacts", Some(json!({"path":path})))
            .await?;
        serde_json::from_value(entry).map_err(|e| e.to_string())
    }

    pub async fn connection(&self, instance_id: uuid::Uuid) -> Result<LocalConnection, String> {
        let value = self
            .request(
                &format!("/host/v1/instances/{instance_id}/local-connection"),
                Some(json!({})),
            )
            .await?;
        serde_json::from_value(value).map_err(|e| e.to_string())
    }

    pub async fn stop_session(&self, connection: &LocalConnection) -> Result<(), String> {
        self.request(
            &format!("/host/v1/instances/{}/stop", connection.instance_id),
            Some(json!({"expected_session_id":connection.session_id,"force":false})),
        ).await?;
        Ok(())
    }
}

struct Choice {
    label: String,
    body: Value,
    vision: bool,
    concurrency: u64,
}

fn group_available(group: &[Value]) -> bool {
    !group.is_empty() && group.iter().all(Value::is_string)
}

fn has_choices(snapshot: &Value) -> bool {
    snapshot["launch_profiles"].as_array().into_iter().flatten().any(|entry| {
        entry["compatible_gpu_groups"].as_array().into_iter().flatten()
            .filter_map(Value::as_array).any(|group| group_available(group))
    })
}

fn choices(snapshot: &Value, replacing: Option<&str>) -> Vec<Choice> {
    let mut result = vec![];
    for entry in snapshot["launch_profiles"].as_array().into_iter().flatten() {
        for group in entry["compatible_gpu_groups"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_array)
        {
            if !group_available(group) {
                continue;
            }
            let profile = &entry["profile"];
            result.push(Choice {
                vision: profile["options"]["vision"].as_bool() == Some(true),
                concurrency: profile["concurrency"].as_u64().unwrap_or(8),
                label: format!(
                    "{} · {} · TP{} · C{} · {} context · {} · Engine {} (recorded evidence)",
                    profile["name"].as_str().unwrap_or("Profile"),
                    if profile["options"]["vision"].as_bool() == Some(true) {
                        "Vision + text (default)"
                    } else {
                        "Text only"
                    },
                    profile["tp"],
                    profile["concurrency"],
                    profile["max_context"],
                    match profile["qualification"]["tier"].as_str() {
                        Some("full-context-tested") => "Full-context tested",
                        Some("calculated-startup-smoke") => "Calculated + startup/smoke checked (not full-context tested)",
                        Some("calculated-pending-validation") => "Calculated — pending validation (startup/memory/inference unverified; may require engine update)",
                        _ => "Unknown evidence tier",
                    },
                    profile["qualification"]["engine_revision"].as_str()
                        .unwrap_or("unrecorded").chars().take(8).collect::<String>(),
                ),
                body: json!({"profile_id":profile["id"],"model_id":entry["model_id"],
                    "gpu_uuids":group,"instance_id":replacing,"force":false,
                    "expected_session_id":snapshot["instances"].as_array().into_iter().flatten()
                        .find(|i| i["instance_id"].as_str() == replacing)
                        .map(|i| &i["session_id"])}),
            });
        }
    }
    result.sort_by_key(|choice| (!choice.vision, choice.concurrency));
    result
}

fn prompt(text: &str) -> Result<String, String> {
    print!("{text}");
    std::io::stdout().flush().map_err(|e| e.to_string())?;
    let mut line = String::new();
    if std::io::stdin()
        .read_line(&mut line)
        .map_err(|e| e.to_string())?
        == 0
    {
        return Ok("q".into());
    }
    Ok(line.trim().to_string())
}

async fn start(control: &LocalControl, choice: &Choice) -> Result<(), String> {
    println!("Checking profile and artifact, then starting serving...");
    let result = control
        .request("/host/v1/profile-launch", Some(choice.body.clone()))
        .await?;
    let id = result["instance_id"]
        .as_str()
        .ok_or("host did not return an instance ID")?;
    println!("Instance {id} is starting. Refresh to see readiness or startup errors.");
    println!(
        "Managed endpoint: {}host/v1/instances/{id}/inference/v1",
        control.origin
    );
    println!("GChat can discover and control this instance through the paired host.");
    Ok(())
}

fn require_terminal() -> Result<(), String> {
    if !std::io::stdin().is_terminal() {
        return Err("The launch menu requires an interactive terminal; use explicit CLI commands for automation.".into());
    }
    Ok(())
}

const BANNER: &str = " ██████╗     ██╗███╗   ██╗███████╗███████╗██████╗\n██╔════╝     ██║████╗  ██║██╔════╝██╔════╝██╔══██╗\n██║  ███╗ ██╗██║██╔██╗ ██║█████╗  █████╗  ██████╔╝\n██║   ██║ ╚═╝██║██║╚██╗██║██╔══╝  ██╔══╝  ██╔══██╗\n╚██████╔╝    ██║██║ ╚████║██║     ███████╗██║  ██║\n ╚═════╝     ╚═╝╚═╝  ╚═══╝╚═╝     ╚══════╝╚═╝  ╚═╝";

fn print_banner() {
    let terminal = std::io::stdout().is_terminal();
    let dumb = std::env::var("TERM").is_ok_and(|v| v == "dumb");
    let unicode = terminal && !dumb && (cfg!(windows) || ["LC_ALL", "LC_CTYPE", "LANG"].iter()
        .find_map(|key| std::env::var(key).ok().filter(|v| !v.is_empty()))
        .is_some_and(|v| v.to_uppercase().contains("UTF-8") || v.to_uppercase().contains("UTF8")));
    let color = terminal && !dumb && std::env::var_os("NO_COLOR").is_none();
    if color { print!("\x1b[38;2;61;211;200m"); }
    println!("\n{}", if unicode { BANNER } else { "G [#] INFER" });
    if color { print!("\x1b[0m"); }
    println!("\n              by Sectile Research Labs\n");
}

fn gpu_occupied(snapshot: &Value, id: &str) -> bool {
    snapshot["instances"].as_array().into_iter().flatten().any(|instance| {
        matches!(instance["status"].as_str(), Some("ready" | "starting" | "stopping"))
            && instance["configuration"]["gpu_uuids"].as_array().is_some_and(|g| g.iter().any(|g| g == id))
    })
}

fn group_label(snapshot: &Value, group: &Value) -> String {
    group.as_array().into_iter().flatten().map(|id| {
        snapshot["gpus"].as_array().into_iter().flatten().enumerate()
            .find(|(_, gpu)| gpu["uuid"] == *id)
            .map(|(index, gpu)| format!("GPU {index} — {}", gpu["display_name"].as_str().or_else(|| gpu["name"].as_str()).unwrap_or("GPU")))
            .unwrap_or_else(|| "Unavailable GPU".into())
    }).collect::<Vec<_>>().join(" + ")
}

fn select(labels: &[String], title: &str) -> Result<Option<usize>, String> {
    println!("\n{title}");
    if labels.is_empty() { println!("  None available."); return Ok(None); }
    for (index, label) in labels.iter().enumerate() { println!("  {}. {label}", index + 1); }
    loop {
        let input = prompt("Number (q to go back): ")?;
        if input == "q" || input.is_empty() { return Ok(None); }
        if let Some(index) = input.parse::<usize>().ok().and_then(|n| n.checked_sub(1)).filter(|i| *i < labels.len()) {
            return Ok(Some(index));
        }
        println!("Choose a listed number.");
    }
}

fn model_label(snapshot: &Value, id: &Value) -> String {
    snapshot["models"].as_array().into_iter().flatten().find(|model| model["id"] == *id)
        .map(|model| format!("{} / {}", model["metadata"]["identity"]["model_id"].as_str().unwrap_or("Model"),
            model["metadata"]["identity"]["weights_id"].as_str().unwrap_or("Package")))
        .unwrap_or_else(|| "Installed model".into())
}

async fn launch_menu(control: &LocalControl, snapshot: &Value, replacing: Option<&str>) -> Result<(), String> {
    let available = choices(snapshot, replacing);
    let mut groups = Vec::new();
    for choice in &available {
        let group = &choice.body["gpu_uuids"];
        if !groups.contains(group) { groups.push(group.clone()); }
    }
    let labels: Vec<_> = groups.iter().map(|g| format!("{} · TP{}", group_label(snapshot, g), g.as_array().map_or(0, Vec::len))).collect();
    let Some(group) = select(&labels, "Launch on")? else { return Ok(()); };
    let mut models = Vec::new();
    for choice in available.iter().filter(|c| c.body["gpu_uuids"] == groups[group]) {
        let model = &choice.body["model_id"];
        if !models.contains(model) { models.push(model.clone()); }
    }
    let Some(model) = select(&models.iter().map(|id| model_label(snapshot, id)).collect::<Vec<_>>(), "Select model")? else { return Ok(()); };
    let profiles: Vec<_> = available.iter().filter(|c| c.body["gpu_uuids"] == groups[group] && c.body["model_id"] == models[model]).collect();
    let Some(profile) = select(&profiles.iter().map(|p| p.label.clone()).collect::<Vec<_>>(), "Select profile (C = simultaneous requests)")? else { return Ok(()); };
    if prompt(if replacing.is_some() { "Restart with this model/profile? [y/N]: " } else { "Start this instance? [y/N]: " })?.eq_ignore_ascii_case("y") {
        start(control, profiles[profile]).await?;
    }
    Ok(())
}

async fn storage_menu(control: &LocalControl) -> Result<(), String> {
    let storage = control.request("/host/v1/model-storage", None).await?;
    println!("\nModel downloads: {}\nFree space: {:.1} GiB", storage["path"].as_str().unwrap_or("unknown"),
        storage["available_bytes"].as_u64().unwrap_or(0) as f64 / 1073741824.0);
    println!("Changing this folder affects new downloads only. Existing models and transfers stay where they are.");
    let path = prompt("New absolute folder (blank to keep current): ")?;
    if !path.is_empty() {
        control.request("/host/v1/model-storage", Some(json!({"path":path.trim_matches('"')}))).await?;
        println!("Model download folder updated.");
    }
    Ok(())
}

async fn download_menu(control: &LocalControl, snapshot: &Value) -> Result<(), String> {
    println!("Checking published models…");
    let releases: Vec<crate::model_downloads::Release> = serde_json::from_value(control.request("/host/v1/model-catalog", None).await?).map_err(|e| e.to_string())?;
    if releases.is_empty() {
        println!("No published compatible models are available in the configured catalog yet.\nUse Add a local model to register an existing .ginfer package.");
        return Ok(());
    }
    let gpus: Vec<crate::service::Gpu> = serde_json::from_value(snapshot["gpus"].clone()).map_err(|e| e.to_string())?;
    let labels: Vec<_> = releases.iter().map(|r| format!("{} · TP{} · {:.1} GiB download · {}", r.name, r.tp,
        r.bytes as f64 / 1073741824.0, group_label(snapshot, &json!(r.compatible_group(&gpus).unwrap_or_default())))).collect();
    let Some(index) = select(&labels, "Download a compatible model")? else { return Ok(()); };
    let release = &releases[index];
    let storage = control.request("/host/v1/model-storage", None).await?;
    let required = release.bytes + 64 * 1024 * 1024;
    println!("Destination: {}\nRequired free space: {:.1} GiB", storage["path"].as_str().unwrap_or("unknown"), required as f64 / 1073741824.0);
    if storage["available_bytes"].as_u64().unwrap_or(0) < required { return Err("Not enough disk space. Change Model storage or free space first.".into()); }
    if prompt("Download this model? [y/N]: ")?.eq_ignore_ascii_case("y") {
        control.request("/host/v1/downloads", Some(serde_json::to_value(release).map_err(|e| e.to_string())?)).await?;
        println!("Download queued. It continues if you close this menu.");
        download_progress(control).await?;
    }
    Ok(())
}

async fn download_progress(control: &LocalControl) -> Result<(), String> {
    loop {
        let jobs: Vec<crate::model_downloads::Download> = serde_json::from_value(control.request("/host/v1/downloads", None).await?).map_err(|e| e.to_string())?;
        let labels: Vec<_> = jobs.iter().map(|j| format!("{} · {} · {:.1}% · {:.1} MiB/s{}", j.release.name, j.status,
            100.0 * j.received as f64 / j.release.bytes.max(1) as f64, j.bytes_per_second as f64 / 1048576.0,
            j.error.as_ref().map(|e| format!(" · {e}")).unwrap_or_default())).collect();
        let Some(index) = select(&labels, "Downloads (select to manage or launch)")? else { return Ok(()); };
        let job = &jobs[index];
        if job.status == "installed" {
            control.request("/host/v1/scan", Some(json!({}))).await?;
            return launch_menu(control, &control.snapshot().await?, None).await;
        }
        let action = prompt("[r] Refresh  [p] Pause  [c] Continue/resume  [q] Back: ")?;
        match action.as_str() {
            "q" | "" => return Ok(()),
            "p" | "c" => { control.request("/host/v1/download-actions", Some(json!({"id":job.id,"action":if action == "p" { "pause" } else { "resume" }}))).await?; }
            _ => (),
        }
    }
}

pub async fn menu(directory: &Path, origin: &str) -> Result<(), String> {
    require_terminal()?;
    let control = LocalControl::open(directory, origin)?;
    menu_control(control).await
}

async fn menu_control(control: LocalControl) -> Result<(), String> {
    print_banner();
    loop {
        let snapshot = control.snapshot().await?;
        println!(
            "\nGInfer — {}\n",
            snapshot["display_name"].as_str().unwrap_or("Local host")
        );
        for (index, gpu) in snapshot["gpus"].as_array().into_iter().flatten().enumerate() {
            println!(
                "  GPU {index}: {} · {} MiB · SM {} · {}",
                gpu["display_name"].as_str().or_else(|| gpu["name"].as_str()).unwrap_or("GPU"),
                gpu["memory_mib"],
                gpu["compute_capability"].as_str().unwrap_or("unknown"),
                if gpu_occupied(&snapshot, gpu["uuid"].as_str().unwrap_or("")) { "In use" } else { "Available" }
            );
        }
        if let Some(error) = snapshot["profile_error"].as_str() {
            println!("Profile catalog: {error}");
        }
        if snapshot["models"].as_array().is_none_or(Vec::is_empty) {
            println!("\nNo local models registered. Download a model or add an existing local package.");
        } else if !has_choices(&snapshot) {
            println!("\nNo launch profiles match the installed models and available GPU groups.");
        }
        println!("\nInstances:");
        for instance in snapshot["instances"].as_array().into_iter().flatten() {
            println!(
                "  {} · {}",
                instance["display_name"].as_str().unwrap_or("Model"),
                instance["status"].as_str().unwrap_or("unknown"),
            );
        }
        println!("\n[l] Launch instance      [m] Manage instances\n[d] Download models      [a] Add a local model\n[s] Model storage        [t] Download progress\n[r] Refresh\n[q] Quit (keep serving)");
        let input = prompt("Select: ")?;
        let result = match input.as_str() {
            "l" => launch_menu(&control, &snapshot, None).await,
            "d" => download_menu(&control, &snapshot).await,
            "t" => download_progress(&control).await,
            "s" => storage_menu(&control).await,
            "a" => {
                let path = prompt("Absolute local .ginfer package path (blank to cancel): ")?;
                if path.is_empty() { Ok(()) } else {
                    control.register_model(Path::new(path.trim_matches('"'))).await.map(|model| {
                        println!("Registered {}. Choose Launch instance to select its profile.", model.id);
                    })
                }
            }
            "q" => {
                println!("Serving continues on the host. Stop instances from this menu or GChat.");
                return Ok(());
            }
            "r" => control
                .request("/host/v1/scan", Some(json!({})))
                .await
                .map(|_| ()),
            "m" => manage(&control, &snapshot).await,
            _ => { println!("Choose a listed command."); Ok(()) },
        };
        if let Err(error) = result {
            println!("Could not complete the action: {error}");
        }
    }
}

async fn manage(control: &LocalControl, snapshot: &Value) -> Result<(), String> {
    let instances = snapshot["instances"]
        .as_array()
        .ok_or("host returned no instance inventory")?;
    for (index, i) in instances.iter().enumerate() {
        println!(
            "  {}. {} · {}",
            index + 1,
            i["display_name"].as_str().unwrap_or("Model"),
            i["status"].as_str().unwrap_or("unknown")
        );
    }
    let selected = prompt("Instance number (q to cancel): ")?;
    if selected == "q" {
        return Ok(());
    }
    let instance = selected
        .parse::<usize>()
        .ok()
        .and_then(|n| n.checked_sub(1))
        .and_then(|n| instances.get(n))
        .ok_or("invalid instance number")?;
    let id = instance["instance_id"]
        .as_str()
        .ok_or("missing instance identity")?;
    let action = prompt("[s] Start  [t] Stop  [r] Restart  [p] Switch profile  [q] Back: ")?;
    if action == "q" {
        return Ok(());
    }
    if action == "p" {
        return launch_menu(control, snapshot, Some(id)).await;
    }
    let operation = match action.as_str() {
        "s" => "start",
        "t" => "stop",
        "r" => "restart",
        _ => return Err("unknown action".into()),
    };
    if operation != "start"
        && !prompt("Interrupt serving after current requests drain? [y/N]: ")?
            .eq_ignore_ascii_case("y")
    {
        return Ok(());
    }
    control
        .request(
            &format!("/host/v1/instances/{id}/{operation}"),
            Some(json!({"force":false,"expected_session_id":instance["session_id"]})),
        )
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn installed_service_configuration_keeps_its_own_host_despite_discovery() {
        async fn serve(host: std::sync::Arc<crate::service::Host>)
            -> (String, tokio::task::JoinHandle<()>)
        {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let origin = format!("https://{}", listener.local_addr().unwrap());
            let acceptor = host.data.lock().await.certificate.acceptor().unwrap();
            let server = tokio::spawn(async move {
                let mut connections = tokio::task::JoinSet::new();
                loop {
                    tokio::select! {
                        Some(_) = connections.join_next(), if !connections.is_empty() => {},
                        socket = listener.accept() => {
                            let (socket, _) = socket.unwrap();
                            let acceptor = acceptor.clone();
                            let host = host.clone();
                            connections.spawn(async move {
                                if let Ok(tls) = acceptor.accept(socket).await {
                                    let service = hyper::service::service_fn(move |request| {
                                        let host = host.clone();
                                        async move { host.route(request).await }
                                    });
                                    let _ = hyper::server::conn::Http::new()
                                        .serve_connection(tls, service).await;
                                }
                            });
                        }
                    }
                }
            });
            (origin, server)
        }

        let configured_directory = tempfile::tempdir().unwrap();
        let foreign_directory = tempfile::tempdir().unwrap();
        let configured_host = crate::service::Host::open(
            configured_directory.path().into(), "Configured".into(),
            std::env::current_exe().unwrap(), vec![], vec![], vec![],
        ).await.unwrap();
        let foreign_host = crate::service::Host::open(
            foreign_directory.path().into(), "Foreign".into(),
            std::env::current_exe().unwrap(), vec![], vec![], vec![],
        ).await.unwrap();
        let configured_id = configured_host.data.lock().await.host_id;
        let foreign_id = foreign_host.data.lock().await.host_id;
        assert_ne!(configured_id, foreign_id);
        let (configured_origin, configured_server) = serve(configured_host).await;
        let (foreign_origin, foreign_server) = serve(foreign_host).await;
        let foreign_owner = crate::local_host_registry::Owner::Service {
            directory: foreign_directory.path().into(), origin: foreign_origin.clone(),
        };
        let discovery_called = std::cell::Cell::new(false);
        let control = tokio::time::timeout(Duration::from_secs(5), InstalledConfiguration {
            data_dir: configured_directory.path().into(), host_url: configured_origin, desktop: None,
        }.connect_resolving(|_| {
            discovery_called.set(true);
            async move { Ok(foreign_owner) }
        })).await.unwrap().unwrap();
        assert!(!discovery_called.get(), "An installed service must not rediscover another root");
        assert_eq!(control.host_id(), configured_id);
        let snapshot = control.snapshot().await.unwrap();
        assert_eq!(snapshot["local_identity"]["state_directory"],
            serde_json::to_value(configured_directory.path().canonicalize().unwrap()).unwrap());

        // Matching TLS/UUID authority copied from another root must not authorize
        // an installed launcher to use that root's live Host.
        let copied_directory = tempfile::tempdir().unwrap();
        std::fs::copy(foreign_directory.path().join("host.json"),
            copied_directory.path().join("host.json")).unwrap();
        let copied_control = LocalControl::open(copied_directory.path(), &foreign_origin).unwrap();
        assert_eq!(copied_control.snapshot().await.unwrap()["host_id"], json!(foreign_id),
            "Copied authority really authenticates to the foreign Host before the root check");
        let copied_result = tokio::time::timeout(Duration::from_secs(5), InstalledConfiguration {
            data_dir: copied_directory.path().into(), host_url: foreign_origin.clone(), desktop: None,
        }.connect()).await.unwrap();
        assert!(copied_result.err().unwrap().contains("different data folder"));
        let mut wrong_platform = snapshot.clone();
        wrong_platform["local_identity"]["platform"] = json!("another-platform");
        assert!(crate::local_host::validate_local_identity(configured_directory.path(), &wrong_platform).is_err());

        let foreign_control = LocalControl::open(foreign_directory.path(), &foreign_origin).unwrap();
        assert_eq!(foreign_control.snapshot().await.unwrap()["host_id"], json!(foreign_id),
            "The other Host remains reachable with its own local authority");
        configured_server.abort();
        foreign_server.abort();
        let _ = configured_server.await;
        let _ = foreign_server.await;
    }

    #[test]
    fn installed_configuration_falls_back_only_when_missing() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("ginfer-launch.json");
        assert!(read_installed_configuration(&path).unwrap().is_none());
        for invalid in [
            json!({"data_dir":"relative", "host_url":"https://127.0.0.1:17443"}),
            json!({"data_dir":root.path(), "host_url":"https://127.0.0.1:17443", "unknown":true}),
        ] {
            std::fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
            assert!(read_installed_configuration(&path).is_err());
        }
        std::fs::write(&path, b"{invalid").unwrap();
        assert!(read_installed_configuration(&path).is_err());
        std::fs::write(
            &path,
            serde_json::to_vec(&json!({
                "data_dir":root.path(), "host_url":"https://127.0.0.1:17443"
            }))
            .unwrap(),
        )
        .unwrap();
        let config = read_installed_configuration(&path).unwrap().unwrap();
        assert_eq!(config.data_dir, root.path());
        assert_eq!(config.host_url, "https://127.0.0.1:17443");
    }

    #[test]
    fn first_run_selection_preserves_order_and_rejects_invalid_items() {
        assert_eq!(selected_indices("2, 1", 2).unwrap(), vec![1, 0]);
        for input in ["", "0", "3", "1 1", "GPU-one"] {
            assert!(selected_indices(input, 2).is_err(), "accepted {input}");
        }
    }
    #[test]
    fn menu_availability_resource_pass() {
        let snapshot = json!({"instances": [], "launch_profiles": (0..174).map(|index| {
            json!({"model_id":"model","profile":{"id":index,"name":"Fixture","concurrency":4},
                "compatible_gpu_groups":[["gpu0"],["gpu1"]]})
        }).collect::<Vec<_>>()});
        let started = std::time::Instant::now();
        assert!(has_choices(&snapshot));
        eprintln!("RESOURCE_LAUNCHER profiles=174 groups=348 elapsed={:?}", started.elapsed());
    }
    #[test]
    fn menu_availability_matches_choices_without_rendering_them() {
        let mut snapshot = json!({"instances": [], "launch_profiles": (0..174).map(|index| {
            json!({"model_id":"model","profile":{"id":index,"name":"Fixture","concurrency":4},
                "compatible_gpu_groups":[["gpu0"],["gpu1"]]})
        }).collect::<Vec<_>>()});
        for status in ["ready", "starting", "stopping", "stopped", "failed"] {
            snapshot["instances"] = json!([{"instance_id":"occupied","status":status,
                "configuration":{"gpu_uuids":["gpu0","gpu1"]}}]);
            assert_eq!(has_choices(&snapshot), !choices(&snapshot, None).is_empty());
        }
        snapshot["instances"] = json!([]);
        for groups in [json!([[123]]), json!([null]), json!([]), json!([[]])] {
            snapshot["launch_profiles"] = json!([{"compatible_gpu_groups":groups}]);
            assert_eq!(has_choices(&snapshot), !choices(&snapshot, None).is_empty());
        }
    }
    #[test]
    fn gpu_labels_identify_distinct_devices_and_occupancy() {
        let snapshot = json!({"gpus":[
            {"uuid":"a","name":"RTX 3090"},{"uuid":"b","name":"RTX 5090"}],
            "instances":[{"status":"ready","configuration":{"gpu_uuids":["a"]}}]});
        assert_eq!(group_label(&snapshot, &json!(["b"])), "GPU 1 — RTX 5090");
        assert!(gpu_occupied(&snapshot, "a"));
        assert!(!gpu_occupied(&snapshot, "b"));
        let models = json!({"models":[{"id":"model", "metadata":{"identity":{
            "model_id":"muse-glimmer-30b", "weights_id":"nvfp4"}}}]});
        assert_eq!(model_label(&models, &json!("model")), "muse-glimmer-30b / nvfp4");
    }
    #[test]
    fn menu_uses_host_profiles_including_shared_gpu_groups() {
        let snapshot = json!({"instances":[{"instance_id":"running","status":"ready","configuration":{"gpu_uuids":["gpu0"]}}],
            "launch_profiles":[{"model_id":"model","profile":{"id":"fixture","name":"Test C4","tp":1,"concurrency":4,"max_context":32768,"qualification":{"tier":"calculated-startup-smoke","engine_revision":"922e5a879b9af12e52763d52b73362937f9dd148"}},
                "compatible_gpu_groups":[["gpu0"],["gpu1"]]}]});
        let available = choices(&snapshot, None);
        assert_eq!(available.len(), 2);
        assert_eq!(available[0].body["gpu_uuids"], json!(["gpu0"]));
        let replacing = choices(&snapshot, Some("running"));
        assert_eq!(replacing.len(), 2);
        assert_eq!(replacing[0].body["instance_id"], "running");
        assert!(replacing[0].label.contains("32768 context"));
        assert!(replacing[0].label.contains("not full-context tested"));
        assert!(replacing[0].label.contains("Engine 922e5a87 (recorded evidence)"));
    }

    #[test]
    fn menu_prioritizes_vision_without_removing_text_choices() {
        let snapshot = json!({"instances": [], "launch_profiles": [
            {"model_id":"model", "profile":{"id":"text","name":"Text","concurrency":1,"options":{"vision":false}},"compatible_gpu_groups":[["gpu0"]]},
            {"model_id":"model", "profile":{"id":"vision","name":"Vision","concurrency":4,"options":{"vision":true}},"compatible_gpu_groups":[["gpu0"]]}
        ]});
        let available = choices(&snapshot, None);
        assert_eq!(available.len(), 2);
        assert_eq!(available[0].body["profile_id"], "vision");
        assert!(available[0].label.contains("Vision + text (default)"));
        assert!(available[1].label.contains("Text only"));
    }
}
