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
                label: format!(
                    "{} · TP{} · C{} · {} context · {}",
                    profile["name"].as_str().unwrap_or("Profile"),
                    profile["tp"],
                    profile["concurrency"],
                    profile["max_context"],
                    group
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                body: json!({"profile_id":profile["id"],"model_id":entry["model_id"],
                    "gpu_uuids":group,"instance_id":replacing,"force":false,
                    "expected_session_id":snapshot["instances"].as_array().into_iter().flatten()
                        .find(|i| i["instance_id"].as_str() == replacing)
                        .map(|i| &i["session_id"])}),
            });
        }
    }
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

fn print_choices(items: &[Choice]) {
    for (index, item) in items.iter().enumerate() {
        println!("  {}. {}", index + 1, item.label);
    }
    if items.is_empty() {
        println!("  No qualified profiles match this host's platform, installed models, and available GPU groups.");
    }
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

pub async fn menu(directory: &Path, origin: &str) -> Result<(), String> {
    require_terminal()?;
    let control = LocalControl::open(directory, origin)?;
    menu_control(control).await
}

async fn menu_control(control: LocalControl) -> Result<(), String> {
    loop {
        let snapshot = control.snapshot().await?;
        println!(
            "\nGInfer — {}\n",
            snapshot["display_name"].as_str().unwrap_or("Local host")
        );
        for gpu in snapshot["gpus"].as_array().into_iter().flatten() {
            println!(
                "  {} · {} MiB · SM {}",
                gpu["name"].as_str().unwrap_or("GPU"),
                gpu["memory_mib"],
                gpu["compute_capability"].as_str().unwrap_or("unknown")
            );
        }
        if let Some(error) = snapshot["profile_error"].as_str() {
            println!("Profile catalog: {error}");
        }
        println!("\nAvailable launch profiles:");
        let available = choices(&snapshot, None);
        print_choices(&available);
        println!("\nInstances:");
        for instance in snapshot["instances"].as_array().into_iter().flatten() {
            println!(
                "  {} · {} · {}",
                instance["display_name"].as_str().unwrap_or("Model"),
                instance["status"].as_str().unwrap_or("unknown"),
                instance["instance_id"].as_str().unwrap_or("")
            );
        }
        println!("\n[number] Start profile   [m] Manage instance   [r] Refresh   [p] Pair GChat   [q] Quit");
        let input = prompt("Select: ")?;
        let result = match input.as_str() {
            "q" => {
                println!("Serving continues on the host. Stop instances from this menu or GChat.");
                return Ok(());
            }
            "r" => control
                .request("/host/v1/scan", Some(json!({})))
                .await
                .map(|_| ()),
            "p" => control
                .request("/host/v1/pairing", Some(json!({})))
                .await
                .map(|pairing| {
                    println!(
                        "Pairing code (5 minutes): {}\nCertificate: {}",
                        pairing["code"].as_str().unwrap_or(""),
                        pairing["certificate_sha256"].as_str().unwrap_or("")
                    );
                }),
            "m" => manage(&control, &snapshot).await,
            _ => match input
                .parse::<usize>()
                .ok()
                .and_then(|n| n.checked_sub(1))
                .and_then(|n| available.get(n))
            {
                Some(choice) => start(&control, choice).await,
                None => {
                    println!("Choose a listed number or command.");
                    Ok(())
                }
            },
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
        let available = choices(snapshot, Some(id));
        print_choices(&available);
        let number = prompt("Profile number (q to cancel): ")?;
        if number == "q" {
            return Ok(());
        }
        let choice = number
            .parse::<usize>()
            .ok()
            .and_then(|n| n.checked_sub(1))
            .and_then(|n| available.get(n))
            .ok_or("invalid profile number")?;
        if prompt("Restart this instance with the selected model/profile? [y/N]: ")?
            .eq_ignore_ascii_case("y")
        {
            start(control, choice).await?;
        }
        return Ok(());
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
    fn menu_uses_host_profiles_and_excludes_other_instances_gpu_groups() {
        let snapshot = json!({"instances":[{"instance_id":"running","status":"ready","configuration":{"gpu_uuids":["gpu0"]}}],
            "launch_profiles":[{"model_id":"model","profile":{"id":"fixture","name":"Test C4","tp":1,"concurrency":4,"max_context":32768},
                "compatible_gpu_groups":[["gpu0"],["gpu1"]]}]});
        let available = choices(&snapshot, None);
        assert_eq!(available.len(), 1);
        assert_eq!(available[0].body["gpu_uuids"], json!(["gpu1"]));
        let replacing = choices(&snapshot, Some("running"));
        assert_eq!(replacing.len(), 2);
        assert_eq!(replacing[0].body["instance_id"], "running");
        assert!(replacing[0].label.contains("32768 context"));
    }
}
