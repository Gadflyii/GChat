//! Native per-user service bootstrap. No webview, GUI lifetime, or secrets in discovery.
use gbot_service::{
    api::Api,
    executor::{ExecutorProcesses, ProcessSpec},
    service::Service,
    vault::{NativeVault, Secret, Vault},
};
use ginfer_host::service_owner::ServiceOwner;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};

pub(super) fn packaged_executor(resource_dir: &Path) -> Result<Option<ExecutorProcesses>, String> {
    // Only the accepted Ubuntu 24.04 x86-64 closure is packaged today.
    if !cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        return Ok(None);
    }
    let root = resource_dir.join("resources/gbot");
    let manifest = match std::fs::read(root.join("runtime.json")) {
        Ok(manifest) => manifest,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Read packaged Gbot runtime: {error}")),
    };
    let manifest: Value = serde_json::from_slice(&manifest)
        .map_err(|error| format!("Read packaged Gbot runtime manifest: {error}"))?;
    if manifest["schema"] != "gbot-cua-runtime-v1"
        || manifest["platform"] != "linux-x64"
        || manifest["python_version"] != "3.12.3"
        || manifest["sdk_revision"] != "0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc"
        || manifest["agent_revision"] != "896c68871da6f3a659c58f341781a977ada20459"
        || manifest["package_count"] != 61
    {
        return Err("Unsupported packaged Gbot runtime".into());
    }
    let python = root.join("python/bin/python");
    let bun = resource_dir.join("resources/bin/bun");
    let context = root.join("context-preparer.ts");
    for path in [
        python.clone(),
        root.join("python/bin/python3.12"),
        root.join("python/lib/python3.12/os.py"),
        root.join("python/lib/python3.12/dist-packages/cua_agent/loops/ginfer.py"),
        bun.clone(),
        context.clone(),
        root.join("smart-context.ts"),
    ] {
        if !path
            .metadata()
            .is_ok_and(|file| file.is_file() && file.len() > 0)
        {
            return Err(format!(
                "Missing packaged Gbot runtime file: {}",
                path.display()
            ));
        }
    }
    Ok(Some(ExecutorProcesses {
        python: ProcessSpec {
            program: python,
            args: Vec::new(),
        },
        context: ProcessSpec {
            program: bun,
            args: vec![context.to_string_lossy().into_owned()],
        },
    }))
}

fn executor_processes(resources: &Path) -> Result<Option<ExecutorProcesses>, String> {
    match (
        std::env::var_os("GBOT_CUA_PYTHON"),
        std::env::var("GBOT_CONTEXT_PREPARER"),
    ) {
        (Some(python), Ok(context)) => Ok(Some(ExecutorProcesses {
            python: ProcessSpec {
                program: python.into(),
                args: vec![],
            },
            context: ProcessSpec {
                program: "node".into(),
                args: vec![context],
            },
        })),
        (None, Err(_)) => packaged_executor(resources),
        _ => Err("Set both GBOT_CUA_PYTHON and GBOT_CONTEXT_PREPARER for bot tasks".into()),
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Discovery {
    service_id: uuid::Uuid,
    endpoint: std::net::SocketAddr,
    data_folder: PathBuf,
}

#[derive(Clone)]
pub(crate) struct Client {
    endpoint: std::net::SocketAddr,
    token: Arc<Secret>,
    http: reqwest::Client,
}

impl Client {
    pub(crate) async fn call(&self, path: &str, body: Value) -> Result<Value, String> {
        if matches!(path, "/v1/tasks/start" | "/v1/tasks/resume")
            && body.get("assignment").is_some()
        {
            return Err("Bot tasks use this bot's saved model assignment".into());
        }
        let url = format!("http://{}{path}", self.endpoint);
        let request = if matches!(
            path,
            "/v1/state" | "/v1/tasks" | "/v1/tasks/approvals" | "/v1/schedules"
        ) {
            self.http.get(url)
        } else {
            self.http.post(url).json(&body)
        };
        let token = std::str::from_utf8(self.token.expose_secret())
            .map_err(|_| "Invalid service credential")?;
        let response = request
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| "Gbot service connection lost; reconnect to the service")?;
        let status = response.status();
        let value: Value = response
            .json()
            .await
            .map_err(|_| "Invalid Gbot service response")?;
        if status.is_success() {
            Ok(value)
        } else {
            Err(format!(
                "{} {}",
                value["error"]["message"]
                    .as_str()
                    .unwrap_or("Gbot request failed"),
                value["error"]["next_action"].as_str().unwrap_or("")
            )
            .trim()
            .to_owned())
        }
    }
}

pub(super) async fn connect(root: &Path) -> Result<Client, String> {
    let discovery: Discovery = serde_json::from_slice(
        &tokio::fs::read(root.join("gbot/service.json"))
            .await
            .map_err(|_| "Gbot service is not running")?,
    )
    .map_err(|_| "Invalid Gbot service discovery")?;
    if discovery.data_folder != root
        || !discovery.endpoint.ip().is_loopback()
        || discovery.endpoint.port() == 0
    {
        return Err("Gbot service uses a different data folder or nonlocal endpoint".into());
    }
    let token = NativeVault
        .get(discovery.service_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Gbot service credential is missing")?;
    let client = Client {
        endpoint: discovery.endpoint,
        token: Arc::new(token),
        http: reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(2))
            .build()
            .map_err(|_| "Gbot service client unavailable")?,
    };
    let state = tokio::time::timeout(
        Duration::from_secs(2),
        client.call("/v1/state", Value::Null),
    )
    .await
    .map_err(|_| "Gbot service is not responding")??;
    if state["service_id"]
        != serde_json::to_value(discovery.service_id)
            .map_err(|_| "Invalid Gbot service identity")?
    {
        return Err("Gbot service identity differs from discovery".into());
    }
    Ok(client)
}

pub(super) async fn ensure_running(root: &Path, resources: &Path) -> Result<Client, String> {
    if !root.is_absolute() || !resources.is_absolute() {
        return Err("Gbot requires the exact absolute GChat data and resource folders".into());
    }
    if let Ok(client) = connect(root).await {
        return Ok(client);
    }
    let directory = root.join("gbot");
    let mut child = None;
    if let Ok(owner) = ServiceOwner::acquire(&directory) {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let mut command = tokio::process::Command::new(&executable);
        #[cfg(target_os = "linux")]
        if let Some(appimage) = std::env::var_os("APPIMAGE") {
            let appdir = std::env::var_os("APPDIR").ok_or("AppImage resource owner is missing")?;
            let relative = resources
                .strip_prefix(Path::new(&appdir))
                .map_err(|_| "Gbot resources are outside the AppImage mount")?;
            // A separate AppImage process owns a separate mount until the service exits.
            command = tokio::process::Command::new(appimage);
            command
                .arg("--gbot-service")
                .arg("--data-folder")
                .arg(root)
                .arg("--appimage-resources")
                .arg(relative);
        } else {
            command
                .arg("--gbot-service")
                .arg("--data-folder")
                .arg(root)
                .arg("--resources")
                .arg(resources);
        }
        #[cfg(not(target_os = "linux"))]
        command
            .arg("--gbot-service")
            .arg("--data-folder")
            .arg(root)
            .arg("--resources")
            .arg(resources);
        let mut options = std::fs::OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let log = options
            .open(directory.join("service.log"))
            .map_err(|error| error.to_string())?;
        command
            .stdin(Stdio::null())
            .stdout(Stdio::from(
                log.try_clone().map_err(|error| error.to_string())?,
            ))
            .stderr(Stdio::from(log))
            .kill_on_drop(false);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.as_std_mut().process_group(0);
        }
        #[cfg(windows)]
        {
            command.creation_flags(0x00000008 | 0x00000200);
        }
        drop(owner);
        child = Some(
            command
                .spawn()
                .map_err(|error| format!("Could not start Gbot service: {error}"))?,
        );
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        if let Ok(client) = connect(root).await {
            if let Some(mut child) = child {
                tokio::spawn(async move {
                    let _ = child.wait().await;
                });
            }
            return Ok(client);
        }
        if let Some(process) = child.as_mut() {
            if process
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_some()
            {
                child = None;
            }
        }
        if tokio::time::Instant::now() >= deadline {
            if let Some(mut child) = child {
                tokio::spawn(async move {
                    let _ = child.wait().await;
                });
            }
            return Err(format!(
                "Gbot service did not become ready; see {}",
                directory.join("service.log").display()
            ));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[derive(clap::Parser)]
struct ServiceArgs {
    #[arg(long)]
    data_folder: PathBuf,
    #[arg(
        long,
        conflicts_with = "appimage_resources",
        required_unless_present = "appimage_resources"
    )]
    resources: Option<PathBuf>,
    #[arg(long, conflicts_with = "resources")]
    appimage_resources: Option<PathBuf>,
}

async fn serve(root: PathBuf, resources: PathBuf) -> Result<(), String> {
    if !root.is_absolute() || !resources.is_absolute() {
        return Err("Gbot requires absolute data and resource folders".into());
    }
    let directory = root.join("gbot");
    let _owner = ServiceOwner::acquire(&directory)?;
    let service = Arc::new(
        Service::open(directory.join("state.json"))
            .await
            .map_err(|error| error.to_string())?,
    );
    let service_id = service.snapshot().await.service_id;
    let connectors = Arc::new(super::super::connectors::BotConnectorHost::open(
        root.clone(),
    )?);
    let mut api = Api::bind_with_connectors(service, Arc::new(NativeVault), 0, connectors)
        .await
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "linux")]
    {
        api = api
            .with_kvm_setup(directory.clone())
            .await
            .map_err(|error| error.to_string())?;
    }
    if let Some(processes) = executor_processes(&resources)? {
        api = api
            .with_executor(directory.join("tasks"), processes)
            .await
            .map_err(|error| error.to_string())?;
    }
    let discovery = Discovery {
        service_id,
        endpoint: api.endpoint(),
        data_folder: root,
    };
    ginfer_host::service::write_private(
        &directory.join("service.json"),
        &serde_json::to_vec(&discovery).map_err(|error| error.to_string())?,
    )?;
    let result = api
        .serve(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .map_err(|error| error.to_string());
    // Only this locked owner may retire its discovery, after tasks/workspaces have closed.
    let _ = tokio::fs::remove_file(directory.join("service.json")).await;
    result
}

/// Called before Tauri, its single-instance hook, or any webview is created.
pub fn run_service_mode() -> Option<std::process::ExitCode> {
    use clap::Parser;
    let mut args = std::env::args_os();
    let executable = args.next()?;
    if args.next()?.to_str() != Some("--gbot-service") {
        return None;
    }
    let parsed = ServiceArgs::try_parse_from(std::iter::once(executable).chain(args));
    let result = parsed.map_err(|error| error.to_string()).and_then(|args| {
        let resources = match (args.resources, args.appimage_resources) {
            (Some(resources), None) => resources,
            (None, Some(relative))
                if !relative.is_absolute()
                    && !relative
                        .components()
                        .any(|part| matches!(part, std::path::Component::ParentDir)) =>
            {
                PathBuf::from(std::env::var_os("APPDIR").ok_or("Gbot AppImage mount unavailable")?)
                    .join(relative)
            }
            _ => return Err("Gbot requires its installed resource folder".into()),
        };
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(|error| error.to_string())?
            .block_on(serve(args.data_folder, resources))
    });
    Some(match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Gbot service failed: {error}");
            std::process::ExitCode::FAILURE
        }
    })
}
