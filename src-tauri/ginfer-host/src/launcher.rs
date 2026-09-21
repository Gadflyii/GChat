//! Interactive client of an installed host service; never owns inference children.
use crate::{service::Persistent, transport::pinned_client};
use serde_json::{json, Value};
use std::{
    io::{IsTerminal, Write},
    path::Path,
    time::Duration,
};

pub struct LocalControl {
    client: reqwest::Client,
    origin: reqwest::Url,
    token: String,
    host_id: uuid::Uuid,
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

pub fn installed_configuration() -> Result<InstalledConfiguration, String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let path = executable
        .parent()
        .ok_or("launcher executable has no parent")?
        .join("ginfer-launch.json");
    let config: InstalledConfiguration = serde_json::from_reader(std::io::BufReader::new(
        std::fs::File::open(&path).map_err(|e| {
            format!(
                "Missing installed launcher configuration {}: {e}",
                path.display()
            )
        })?,
    ))
    .map_err(|e| e.to_string())?;
    if !config.data_dir.is_absolute() {
        return Err("installed host data path must be absolute".into());
    }
    Ok(config)
}

impl InstalledConfiguration {
    pub async fn open_menu(self) -> Result<(), String> {
        require_terminal()?;
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
            engine_runtimes: Default::default(),
                directory: self.data_dir.clone(),
                desktop_provider: Some(desktop.provider),
                models: Vec::new(), artifact_sets: Vec::new(),
                name: "This computer".into(), nvidia_smi: "nvidia-smi".into(),
                listen: std::net::SocketAddr::new(address, origin.port_or_known_default().ok_or("missing host port")?),
            };
            crate::local_host_registry::Owner::Desktop(local)
        } else {
            crate::local_host_registry::Owner::Service { directory: self.data_dir, origin: self.host_url }
        };
        let owner = crate::local_host_registry::resolve(Some(owner)).await?;
        menu_control(owner.connect().await?).await
    }
}

pub async fn installed_menu() -> Result<(), String> {
    require_terminal()?;
    if let Some(owner) = crate::local_host_registry::registered().await? {
        return menu_control(owner.connect().await?).await;
    }
    installed_configuration()?.open_menu().await
}

impl LocalControl {
    pub fn open(directory: &Path, origin: &str) -> Result<Self, String> {
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
        Ok(Self {
            client: pinned_client(&state.certificate.fingerprint())?,
            origin,
            token: state.pairing_admin_token,
            host_id: state.host_id,
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

#[derive(Debug)]
struct Choice {
    label: String,
    body: Value,
    vision: bool,
    concurrency: u64,
}

fn choices(snapshot: &Value, replacing: Option<&str>) -> Vec<Choice> {
    let occupied: std::collections::BTreeSet<_> = snapshot["instances"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|i| {
            i["instance_id"].as_str() != replacing
                && matches!(
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
    let mut result = vec![];
    for entry in snapshot["launch_profiles"].as_array().into_iter().flatten() {
        for group in entry["compatible_gpu_groups"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_array)
        {
            if group
                .iter()
                .any(|g| g.as_str().is_none_or(|id| occupied.contains(id)))
            {
                continue;
            }
            let profile = &entry["profile"];
            result.push(Choice {
                vision: profile["options"]["vision"].as_bool() == Some(true),
                concurrency: profile["concurrency"].as_u64().unwrap_or(8),
                label: format!(
                    "{} · {} · TP{} · C{} · {} context · {}",
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
        let available = choices(&snapshot, None);
        if snapshot["models"].as_array().is_none_or(Vec::is_empty) {
            println!("\nNo local models registered. Download a model or add an existing local package.");
        } else if available.is_empty() {
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
    fn menu_uses_host_profiles_and_excludes_other_instances_gpu_groups() {
        let snapshot = json!({"instances":[{"instance_id":"running","status":"ready","configuration":{"gpu_uuids":["gpu0"]}}],
            "launch_profiles":[{"model_id":"model","profile":{"id":"fixture","name":"Test C4","tp":1,"concurrency":4,"max_context":32768,"qualification":{"tier":"calculated-startup-smoke"}},
                "compatible_gpu_groups":[["gpu0"],["gpu1"]]}]});
        let available = choices(&snapshot, None);
        assert_eq!(available.len(), 1);
        assert_eq!(available[0].body["gpu_uuids"], json!(["gpu1"]));
        let replacing = choices(&snapshot, Some("running"));
        assert_eq!(replacing.len(), 2);
        assert_eq!(replacing[0].body["instance_id"], "running");
        assert!(replacing[0].label.contains("32768 context"));
        assert!(replacing[0].label.contains("not full-context tested"));
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
