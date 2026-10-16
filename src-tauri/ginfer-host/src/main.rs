use clap::Parser;
use ginfer_host::{
    discovery::advertise,
    service::{Gpu, Host},
};
use std::{path::PathBuf, sync::atomic::Ordering, time::Duration};

#[cfg(windows)]
mod windows_service;

#[derive(Parser)]
#[command(about = "GInfer LAN host: inventory, pairing, and owned inference instances")]
struct Args {
    /// Run under the Windows Service Control Manager (installer-owned mode).
    #[cfg(windows)]
    #[arg(long, conflicts_with_all = ["menu", "ensure_running"])]
    windows_service: bool,
    #[arg(long, required_unless_present = "menu")]
    data_dir: Option<PathBuf>,
    /// Open the installed host menu; desktop installations bootstrap their local owner.
    #[arg(long)]
    menu: bool,
    /// Reconnect or start an independent loopback host, then print its snapshot.
    #[arg(long, conflicts_with_all = ["menu", "discoverable"])]
    ensure_running: bool,
    /// Allow the desktop to manage a separate, persistent LAN listener.
    #[arg(long, conflicts_with = "discoverable")]
    desktop_managed: bool,
    /// NVIDIA inventory executable; installers resolve service-specific PATHs.
    #[arg(long, default_value = "nvidia-smi")]
    nvidia_smi: PathBuf,
    #[arg(long, required_unless_present = "menu")]
    engine: Option<PathBuf>,
    /// Explicit per-architecture runtimes (repeat SM=PATH); disables fallback to --engine.
    #[arg(long, value_parser = parse_runtime)]
    engine_runtime: Vec<(String, PathBuf)>,
    #[arg(long)]
    models: Vec<PathBuf>,
    /// Own the desktop provider's model cache and existing transfer journal.
    #[arg(long)]
    desktop_provider: Option<PathBuf>,
    /// Explicit deployment descriptors; only declared exact degrees enter inventory.
    #[arg(long)]
    artifact_set: Vec<PathBuf>,
    #[arg(long, default_value = "GInfer host")]
    name: String,
    #[arg(long, default_value = "127.0.0.1:7443")]
    listen: std::net::SocketAddr,
    /// Advertise this host on the LAN; requires a reachable --listen address.
    #[arg(long)]
    discoverable: bool,
    /// Management origin for explicit menu commands; pinned from local state.
    #[arg(long, default_value = "https://127.0.0.1:7443")]
    host_url: String,
}

fn parse_runtime(value: &str) -> Result<(String, PathBuf), String> {
    let (architecture, path) = value
        .split_once('=')
        .ok_or("runtime must be COMPUTE_CAPABILITY=/absolute/executable")?;
    let entry = (architecture.to_owned(), PathBuf::from(path));
    ginfer_host::engine_host::validate_runtimes(&std::collections::BTreeMap::from(
        [entry.clone()],
    ))?;
    Ok(entry)
}

#[derive(Parser)]
#[command(about = "Prepare the current user's shared Host-owned hardware installation")]
struct PrepareHardware {
    #[arg(long)]
    data_dir: Option<PathBuf>,
    /// Existing installed launcher configuration; preserves desktop provider storage.
    #[arg(long, conflicts_with_all = ["data_dir", "desktop_provider"])]
    installed_configuration: Option<PathBuf>,
    /// Verified installed native ginfer CLI, never ginfer-serve.
    #[arg(long)]
    engine: PathBuf,
    #[arg(long)]
    hardware_profile: Option<PathBuf>,
    #[arg(long)]
    desktop_provider: Option<PathBuf>,
    #[arg(long, default_value = "https://127.0.0.1:7443")]
    host_url: String,
    #[arg(long, default_value = "nvidia-smi")]
    nvidia_smi: PathBuf,
    /// Use the installed GChat four-image Linux runtime set (single-image installs omit this).
    #[arg(long)]
    runtime_set: bool,
    /// Exact ordered deployment GPU UUID grant (repeat for TP2/TP4).
    #[arg(long)]
    gpu: Vec<String>,
    #[arg(long)]
    reprofile: bool,
}
#[derive(Parser)]
#[command(about = "Continue the shared local Host first-run setup")]
struct FirstRun {
    /// Drive the text wizard; automation without this flag prints JSON and never prompts.
    #[arg(long, conflicts_with = "action")]
    interactive: bool,
    #[arg(long, value_parser = ["profile", "storage", "models", "refresh_catalog", "startup", "move", "complete", "resume"])]
    action: Option<String>,
    #[arg(long)]
    gpu: Vec<String>,
    #[arg(long)]
    path: Option<PathBuf>,
    #[arg(long)]
    release: Vec<String>,
    #[arg(long)]
    download_id: Option<String>,
    #[arg(long)]
    concurrency: Option<u64>,
    #[arg(long)]
    max_context: Option<u64>,
    #[arg(long)]
    instance_count: Option<u64>,
    #[arg(long)]
    kv_arena_bytes: Option<u64>,
}

async fn first_run(args: FirstRun) -> Result<(), String> {
    use std::io::IsTerminal;
    if args.interactive && !std::io::stdin().is_terminal() {
        return Err("The first-run wizard requires an interactive terminal; omit --interactive for JSON status and explicit actions.".into());
    }
    let control = ginfer_host::launcher::installed_control().await?;
    if args.interactive {
        return ginfer_host::launcher::first_run(&control).await;
    }
    let body = args.action.map(|action| {
        let mut body = serde_json::json!({"action":action});
        if !args.gpu.is_empty() {
            body["gpu_uuids"] = serde_json::json!(args.gpu);
        }
        if let Some(path) = args.path {
            body["path"] = serde_json::json!(path);
        }
        if !args.release.is_empty() {
            body["release_ids"] = serde_json::json!(args.release);
        }
        if let Some(value) = args.download_id {
            body["download_id"] = serde_json::json!(value);
        }
        if let Some(value) = args.concurrency {
            body["concurrency"] = serde_json::json!(value);
        }
        if let Some(value) = args.max_context {
            body["max_context"] = serde_json::json!(value);
        }
        if let Some(value) = args.instance_count {
            body["instance_count"] = serde_json::json!(value);
        }
        if let Some(value) = args.kv_arena_bytes {
            body["kv_arena_bytes"] = serde_json::json!(value);
        }
        body
    });
    println!("{}", control.request("/host/v1/first-run", body).await?);
    Ok(())
}
fn store_hardware_configuration(
    configuration: &ginfer_host::hardware_profile::Configuration,
    directory: &std::path::Path,
    architectures: &std::collections::BTreeMap<String, String>,
) -> Result<(), String> {
    ginfer_host::hardware_profile::validate_gpu_group(&configuration.gpu_uuids, architectures)?;
    configuration.store(directory)
}
async fn prepare_hardware(args: PrepareHardware) -> Result<(), String> {
    use ginfer_host::hardware_profile::{Configuration, HardwareProfileAction};
    let (directory, provider, origin, configured_engine) =
        if let Some(path) = args.installed_configuration {
            let config: ginfer_host::launcher::InstalledConfiguration =
                serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            let desktop = config.desktop;
            (
                config.data_dir,
                desktop.as_ref().map(|d| d.provider.clone()),
                config.host_url,
                desktop.map(|d| d.engine),
            )
        } else {
            (
                args.data_dir
                    .ok_or("--data-dir or --installed-configuration is required")?,
                args.desktop_provider,
                args.host_url,
                None,
            )
        };
    let supplied_engine = args.engine;
    let cli_name = if cfg!(windows) {
        "ginfer.exe"
    } else {
        "ginfer"
    };
    if supplied_engine.file_name() != Some(std::ffi::OsStr::new(cli_name)) {
        return Err("--engine must select the installed ginfer CLI".into());
    }
    let engine = configured_engine.unwrap_or_else(|| {
        supplied_engine.with_file_name(if cfg!(windows) {
            "ginfer-serve.exe"
        } else {
            "ginfer-serve"
        })
    });
    let url = reqwest::Url::parse(&origin).map_err(|e| e.to_string())?;
    if url.scheme() != "https"
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("prepare-hardware requires the local HTTPS Host origin".into());
    }
    let address: std::net::IpAddr = url
        .host_str()
        .ok_or("local Host address is missing")?
        .trim_matches(['[', ']'])
        .parse()
        .map_err(|_| "local Host origin must use a loopback IP address")?;
    #[cfg(target_os = "linux")]
    let engine_runtimes = if args.runtime_set {
        ginfer_host::local_host::desktop_runtimes(
            provider
                .as_ref()
                .ok_or("--runtime-set requires desktop provider storage")?,
        )?
    } else {
        Default::default()
    };
    #[cfg(not(target_os = "linux"))]
    let engine_runtimes = Default::default();
    let local = ginfer_host::local_host::LocalHost {
        binary: std::env::current_exe().map_err(|e| e.to_string())?,
        engine,
        engine_runtimes,
        directory: directory.clone(),
        desktop_provider: provider,
        models: vec![],
        artifact_sets: vec![],
        name: ginfer_host::local_host::computer_name()?,
        nvidia_smi: args.nvidia_smi,
        listen: std::net::SocketAddr::new(
            address,
            url.port_or_known_default()
                .ok_or("local Host port is missing")?,
        ),
    };
    let owner = ginfer_host::local_host_registry::resolve(Some(
        ginfer_host::local_host_registry::Owner::Desktop(Box::new(local)),
    ))
    .await?;
    let directory = match &owner {
        ginfer_host::local_host_registry::Owner::Desktop(local) => local.directory.clone(),
        ginfer_host::local_host_registry::Owner::Service { directory, .. } => directory.clone(),
    };
    let control = owner.connect().await?;
    let before = control.snapshot().await?;
    if matches!(
        before["hardware_profile"]["status"].as_str(),
        Some("running" | "cancelling")
    ) {
        println!("{}", before["hardware_profile"]);
        return Ok(());
    }
    if args.gpu.is_empty() && !args.reprofile {
        if args.hardware_profile.is_some() {
            return Err("--hardware-profile requires an explicit --gpu deployment".into());
        }
        let result = control
            .request(
                "/host/v1/hardware-profile",
                Some(serde_json::json!({"action":"ensure"})),
            )
            .await?;
        println!("{result}");
        return Ok(());
    }
    let gpus = if args.gpu.is_empty() {
        serde_json::from_value::<Vec<String>>(before["hardware_profile"]["gpu_uuids"].clone())
            .map_err(|e| e.to_string())?
    } else {
        args.gpu
    };
    if gpus.is_empty() {
        return Err("Choose an explicit GPU group before refreshing its hardware profile".into());
    }
    let configuration = Configuration {
        gpu_uuids: gpus.clone(),
        engine: supplied_engine,
        profile_path: args.hardware_profile.unwrap_or_else(|| {
            ginfer_host::hardware_profile::group_profile_path(&directory, &gpus)
        }),
    };
    if let ginfer_host::local_host_registry::Owner::Desktop(local) = &owner {
        let selected = if local.engine_runtimes.is_empty() {
            local.engine.clone()
        } else {
            let architecture = gpus
                .first()
                .and_then(|gpu| {
                    before["gpus"]
                        .as_array()?
                        .iter()
                        .find(|fact| fact["uuid"].as_str() == Some(gpu))?["compute_capability"]
                        .as_str()
                })
                .ok_or("Selected GPU has no compute architecture")?;
            local
                .engine_runtimes
                .get(architecture)
                .cloned()
                .ok_or("No runtime installed for the selected GPU group")?
        };
        let expected = selected.with_file_name(if cfg!(windows) {
            "ginfer.exe"
        } else {
            "ginfer"
        });
        if expected != configuration.engine {
            return Err(
                "The registered Host owns a different profiling runtime; select its installed CLI"
                    .into(),
            );
        }
    }
    if matches!(
        owner,
        ginfer_host::local_host_registry::Owner::Service { .. }
    ) {
        return Err("Configure the registered service owner's profiling runtime locally before preparing its hardware profile".into());
    }
    let inventory: Vec<ginfer_host::service::Gpu> =
        serde_json::from_value(before["gpus"].clone()).map_err(|error| error.to_string())?;
    let architectures = inventory
        .into_iter()
        .filter_map(|gpu| gpu.compute_capability.map(|architecture| (gpu.uuid, architecture)))
        .collect();
    store_hardware_configuration(&configuration, &directory, &architectures)?;
    let action = if args.reprofile {
        HardwareProfileAction::Refresh
    } else {
        HardwareProfileAction::Ensure
    };
    let result = control
        .request(
            "/host/v1/hardware-profile",
            Some(serde_json::json!({"action":action,"gpu_uuids":gpus})),
        )
        .await?;
    println!("{result}");
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args_os()
        .nth(1)
        .is_some_and(|arg| arg == "first-run")
    {
        let args = FirstRun::parse_from(std::env::args_os().skip(1));
        return tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()?
            .block_on(first_run(args))
            .map_err(|e| std::io::Error::other(e).into());
    }
    if std::env::args_os()
        .nth(1)
        .is_some_and(|arg| arg == "prepare-hardware")
    {
        let args = PrepareHardware::parse_from(std::env::args_os().skip(1));
        return tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()?
            .block_on(prepare_hardware(args))
            .map_err(|e| std::io::Error::other(e).into());
    }
    #[cfg(windows)]
    if std::env::args_os().any(|arg| arg == "--windows-service") {
        windows_service::dispatch()?;
        return Ok(());
    }
    let args = Args::parse();
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run(args, || Ok(()), shutdown_signal()))
        .map_err(std::io::Error::other)?;
    Ok(())
}

#[cfg(any(windows, test))]
async fn pending_checkpoints(
    mut pending: tokio::sync::watch::Receiver<bool>,
    period: Duration,
    mut report: impl FnMut(),
) {
    let mut interval = Some(tokio::time::interval(period));
    loop {
        if !*pending.borrow_and_update() {
            // Drop the timer registration completely while SCM reports Running.
            interval = None;
            if pending.changed().await.is_err() { return; }
            continue;
        }
        let interval = interval.get_or_insert_with(|| {
            tokio::time::interval_at(tokio::time::Instant::now() + period, period)
        });
        tokio::select! {
            changed = pending.changed() => {
                if changed.is_err() { return; }
            }
            _ = interval.tick() => report(),
        }
    }
}

async fn run(
    args: Args,
    ready: impl FnOnce() -> Result<(), String>,
    shutdown: impl std::future::Future<Output = ()>,
) -> Result<(), String> {
    if args.menu {
        return match args.data_dir {
            Some(directory) => ginfer_host::launcher::menu(&directory, &args.host_url).await,
            None => ginfer_host::launcher::installed_menu().await,
        };
    }
    let data_dir = args
        .data_dir
        .ok_or("--data-dir is required for host service operations")?;
    let mut engine_runtimes = std::collections::BTreeMap::new();
    for (architecture, path) in args.engine_runtime {
        if engine_runtimes.insert(architecture, path).is_some() { return Err("Duplicate runtime compute capability".into()); }
    }
    if args.ensure_running {
        let local = ginfer_host::local_host::LocalHost {
            binary: std::env::current_exe().map_err(|e| e.to_string())?,
            engine: args.engine.ok_or("engine is required")?,
            engine_runtimes,
            directory: data_dir,
            desktop_provider: args.desktop_provider,
            models: args.models,
            artifact_sets: args.artifact_set,
            name: args.name,
            nvidia_smi: args.nvidia_smi,
            listen: args.listen,
        };
        let control = local.ensure_running().await?;
        println!("{}", control.snapshot().await?);
        return Ok(());
    }
    if args.desktop_managed && !args.listen.ip().is_loopback() {
        return Err("desktop management requires a loopback listen address".into());
    }
    if args.discoverable && args.listen.ip().is_loopback() {
        return Err("LAN discovery requires a LAN or wildcard --listen address".into());
    }
    let _owner = ginfer_host::service_owner::ServiceOwner::acquire(&data_dir)?;
    let mut inventory = tokio::process::Command::new(&args.nvidia_smi);
    #[cfg(windows)]
    inventory.creation_flags(0x08000000);
    let output = inventory.args([
            "--query-gpu=uuid,name,memory.total,compute_cap,pci.device_id",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .await
        .map_err(|e| format!("could not inventory NVIDIA GPUs: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    let mut gpus = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let values: Vec<_> = line.split(',').map(str::trim).collect();
        if values.len() != 5 {
            return Err("unrecognized NVIDIA inventory row".into());
        }
        gpus.push(Gpu {
            uuid: values[0].into(),
            name: values[1].into(),
            display_name: gpu_display_alias(values[4]).map(str::to_owned),
            memory_mib: values[2].parse::<u64>().map_err(|e| e.to_string())?,
            compute_capability: values[3].parse::<f32>().ok().map(|_| values[3].to_string()),
        });
    }
    let host = Host::open_with_model_storage(
        data_dir.clone(),
        args.name,
        args.engine.ok_or("engine is required")?,
        args.models,
        args.artifact_set,
        gpus,
        args.desktop_provider,
    )
    .await?;
    #[cfg(windows)]
    if args.desktop_managed && !args.windows_service { host.enable_normal_stop(); }
    host.processes.lock().await.configure_runtimes(
        engine_runtimes,
        host.gpus
            .iter()
            .filter_map(|gpu| {
                gpu.compute_capability
                    .as_ref()
                    .map(|sm| (gpu.uuid.clone(), sm.clone()))
            })
            .collect(),
    )?;
    let preferred = if args.desktop_managed {
        ginfer_host::local_host::management_address(&data_dir, args.listen)?
    } else {
        args.listen
    };
    let (listener, notice) =
        ginfer_host::local_host::bind_management(preferred, args.desktop_managed).await?;
    let mut local_address = listener.local_addr().map_err(|e| e.to_string())?;
    if local_address.ip().is_unspecified() {
        local_address.set_ip(if local_address.is_ipv4() {
            std::net::Ipv4Addr::LOCALHOST.into()
        } else { std::net::Ipv6Addr::LOCALHOST.into() });
    }
    {
        let mut data = host.data.lock().await;
        data.management_origin = Some(format!("https://{local_address}"));
        if let Some(notice) = notice {
            eprintln!("{notice}");
            data.management_notice = Some(notice);
        }
    }
    host.save().await?;
    let data = host.data.lock().await;
    let acceptor = data.certificate.acceptor()?;
    println!(
        "Host: {} ({})\nCertificate SHA256: {}",
        data.name,
        data.host_id,
        data.certificate.fingerprint()
    );
    let advertisement = if args.discoverable {
        Some(advertise(
            data.host_id,
            &data.name,
            listener.local_addr().map_err(|e| e.to_string())?,
        )?)
    } else {
        None
    };
    drop(data);
    host.lan_sharing.lock().await.standalone = if args.discoverable {
        Some(listener.local_addr().map_err(|e| e.to_string())?.port())
    } else {
        None
    };
    if args.desktop_managed { host.initialize_lan_sharing().await; }
    let mut connections = tokio::task::JoinSet::new();
    ready()?;
    // Keep slow inventory and health reads off the connection accept loop.
    let mut maintenance = tokio::task::JoinSet::new();
    let monitor_host = host.clone();
    maintenance.spawn(async move {
        monitor_processes(&monitor_host).await;
    });
    let scan_host = host.clone();
    maintenance.spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(30));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        tick.tick().await; // Host::open already performed the initial inventory.
        loop {
            tick.tick().await;
            let Ok(_admission) = scan_host.running_admission().await else {
                std::future::pending::<()>().await;
                return;
            };
            if let Err(e) = scan_host.scan().await {
                eprintln!("Inventory refresh: {e}");
            }
        }
    });
    tokio::pin!(shutdown);
    let mut normal_stop = false;
    let outcome = loop {
        tokio::select! {
            _ = host.wait_for_normal_stop() => { normal_stop = true; break Ok(()); },
            _ = &mut shutdown => break Ok(()),
            result = maintenance.join_next() => break Err(format!("Host maintenance stopped unexpectedly: {result:?}")),
            Some(_) = connections.join_next(), if !connections.is_empty() => {},
            result = listener.accept() => {
                let (socket,_) = match result { Ok(socket) => socket, Err(e) => break Err(e.to_string()) };
                connections.spawn(serve_management_connection(socket, acceptor.clone(), host.clone()));
            },
        }
    };
    drop(listener);
    if let Some(advertisement) = advertisement {
        let _ = advertisement.shutdown();
    }
    {
        let mut sharing = host.lan_sharing.lock().await;
        sharing.standalone = None;
        sharing.stop().await;
    }
    maintenance.abort_all();
    while maintenance.join_next().await.is_some() {}
    // Let the authenticated Stop response flush and finish current HTTP replies.
    // No work can be admitted after the Stop fence; idle keep-alives do not pin
    // the process because each connection enters Hyper's graceful shutdown.
    if normal_stop {
        let _ = tokio::time::timeout(Duration::from_secs(2), async {
            while connections.join_next().await.is_some() {}
        }).await;
    }
    connections.abort_all();
    while connections.join_next().await.is_some() {}
    host.shutdown_hardware_profile().await?;
    host.processes.lock().await.shutdown().await?;
    outcome
}

async fn serve_management_connection(
    socket: tokio::net::TcpStream,
    acceptor: tokio_rustls::TlsAcceptor,
    host: std::sync::Arc<Host>,
) {
    let Ok(Ok(tls)) = tokio::time::timeout(Duration::from_secs(10), acceptor.accept(socket)).await else { return; };
    let stopping_host = host.clone();
    let service = hyper::service::service_fn(move |req| host.clone().route(req));
    let connection = hyper::server::conn::Http::new().serve_connection(tls, service).with_upgrades();
    tokio::pin!(connection);
    tokio::select! {
        _ = &mut connection => {},
        _ = stopping_host.wait_for_normal_stop() => {
            connection.as_mut().graceful_shutdown();
            let _ = connection.await;
        }
    }
}

async fn monitor_processes(host: &Host) {
    let activity = host.processes.lock().await.activity_notification();
    let mut tick = None;
    loop {
        let notified = activity.notified();
        tokio::pin!(notified);
        // Register before inspecting ownership so a launch cannot lose its wake.
        notified.as_mut().enable();
        {
            let Ok(_admission) = host.running_admission().await else {
                std::future::pending::<()>().await;
                return;
            };
            if let Err(error) = host.first_run_maintenance().await {
                eprintln!("First-run setup: {error}");
            }
            if let Err(error) = host.idle_maintenance().await {
                eprintln!("Draft calibration: {error}");
            }
        }
        if !host.processes.lock().await.needs_monitoring() && !host.first_run_pending().await {
            tick = None;
            notified.await;
            continue;
        }
        let tick = tick.get_or_insert_with(|| {
            let mut tick = tokio::time::interval(Duration::from_secs(1));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            tick
        });
        tokio::select! {
            _ = notified => {},
            _ = tick.tick() => {
                if let Err(e) = refresh_active_processes(host).await {
                    eprintln!("Engine monitoring: {e}");
                }
            }
        }
    }
}

async fn refresh_active_processes(host: &Host) -> Result<bool, String> {
    let Ok(_admission) = host.running_admission().await else { return Ok(false); };
    if !host.processes.lock().await.needs_monitoring() {
        return Ok(false);
    }
    let result = host.refresh_processes().await;
    host.revision.fetch_add(1, Ordering::SeqCst);
    result.map(|_| true)
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("SIGTERM handler");
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

fn gpu_display_alias(pci_device_id: &str) -> Option<&'static str> {
    match u32::from_str_radix(
        pci_device_id
            .trim_start_matches("0x")
            .trim_start_matches("0X"),
        16,
    ) {
        Ok(0x20c210de) => Some("NVIDIA CMP 170HX"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn hardware_profile_preparation_rejects_invalid_groups_without_changing_persistence() {
        use ginfer_host::hardware_profile::{group_key, group_profile_path, Configuration};
        use std::collections::BTreeMap;
        let directory = tempfile::tempdir().unwrap();
        let cli = directory.path().join("ginfer");
        std::fs::write(&cli, b"fixture CLI").unwrap();
        let group = vec!["GPU-B".to_string(), "GPU-A".to_string()];
        let configuration = Configuration {
            gpu_uuids: group.clone(),
            engine: cli,
            profile_path: group_profile_path(directory.path(), &group),
        };
        let valid = BTreeMap::from([
            ("GPU-A".into(), "8.6".into()),
            ("GPU-B".into(), "8.6".into()),
        ]);
        let path = directory
            .path()
            .join("hardware-profile-config")
            .join(format!("{}.json", group_key(&group)));
        let unknown = BTreeMap::from([("GPU-A".into(), "8.6".into())]);
        let mixed = BTreeMap::from([
            ("GPU-A".into(), "8.6".into()),
            ("GPU-B".into(), "12.0".into()),
        ]);
        for invalid in [&unknown, &mixed] {
            assert!(
                super::store_hardware_configuration(&configuration, directory.path(), invalid)
                    .is_err()
            );
            assert!(!path.exists());
        }
        super::store_hardware_configuration(&configuration, directory.path(), &valid).unwrap();
        let accepted = std::fs::read(&path).unwrap();
        for invalid in [&unknown, &mixed] {
            assert!(
                super::store_hardware_configuration(&configuration, directory.path(), invalid)
                    .is_err()
            );
            assert_eq!(std::fs::read(&path).unwrap(), accepted);
        }
        let saved: Configuration = serde_json::from_slice(&accepted).unwrap();
        assert_eq!(saved.gpu_uuids, group);
        let reversed: Vec<_> = group.into_iter().rev().collect();
        assert_eq!(
            saved.profile_path,
            group_profile_path(directory.path(), &reversed)
        );
    }

    use std::future::Future;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    #[tokio::test]
    async fn normal_stop_flushes_its_tls_ack_and_closes_an_idle_keepalive() {
        let directory = tempfile::tempdir().unwrap();
        let host = ginfer_host::service::Host::open(directory.path().into(),
            "Normal Stop TLS fixture".into(), std::env::current_exe().unwrap(),
            vec![], vec![], vec![]).await.unwrap();
        host.enable_normal_stop(); // Portable seam; the production opt-in is Windows-only.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        host.data.lock().await.management_origin = Some(format!("https://{address}"));
        host.save().await.unwrap();
        let acceptor = host.data.lock().await.certificate.acceptor().unwrap();
        let serving_host = host.clone();
        let server = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            super::serve_management_connection(socket, acceptor, serving_host).await;
        });
        let local = ginfer_host::local_host::LocalHost {
            binary: std::env::current_exe().unwrap(), engine: std::env::current_exe().unwrap(),
            engine_runtimes: Default::default(), directory: directory.path().into(),
            desktop_provider: None, models: vec![], artifact_sets: vec![],
            name: "Normal Stop TLS fixture".into(), nvidia_smi: "unused".into(),
            listen: address,
        };
        let response = local.stop_if_idle().await.unwrap();
        assert_eq!(response["stopping"], true);
        assert_eq!(response["boot_id"], serde_json::json!(host.boot_id));
        tokio::time::timeout(std::time::Duration::from_secs(2), server).await.unwrap().unwrap();
        assert!(host.running_admission().await.is_err());
    }

    #[test]
    fn cmp_alias_uses_device_identity_not_generic_driver_name() {
        assert_eq!(
            super::gpu_display_alias("0x20C210DE"),
            Some("NVIDIA CMP 170HX")
        );
        assert_eq!(super::gpu_display_alias("0x220410DE"), None);
        assert_eq!(super::gpu_display_alias("N/A"), None);
    }

    #[tokio::test]
    async fn scm_checkpoints_sleep_while_running_and_resume_pending() {
        let period = std::time::Duration::from_millis(20);
        let (state, receiver) = tokio::sync::watch::channel(true);
        let reports = Arc::new(AtomicUsize::new(0));
        let polls = Arc::new(AtomicUsize::new(0));
        let observed = reports.clone();
        let candidate_polls = polls.clone();
        let candidate = tokio::spawn(async move {
            let future = super::pending_checkpoints(receiver, period, move || {
                observed.fetch_add(1, Ordering::SeqCst);
            });
            tokio::pin!(future);
            std::future::poll_fn(|context| {
                candidate_polls.fetch_add(1, Ordering::SeqCst);
                future.as_mut().poll(context)
            }).await;
        });
        tokio::time::sleep(period * 3).await;
        assert!(reports.load(Ordering::SeqCst) >= 2);
        state.send(false).unwrap();
        tokio::time::sleep(period).await; // Let the Running transition settle.
        let running_reports = reports.load(Ordering::SeqCst);
        let running_polls = polls.load(Ordering::SeqCst);
        let baseline_ticks = Arc::new(AtomicUsize::new(0));
        let baseline_work = baseline_ticks.clone();
        let baseline = tokio::spawn(async move {
            let mut interval = tokio::time::interval(period);
            loop {
                interval.tick().await;
                baseline_work.fetch_add(1, Ordering::SeqCst);
            }
        });
        tokio::time::sleep(period * 5).await;
        baseline.abort();
        let _ = baseline.await;
        assert!(baseline_ticks.load(Ordering::SeqCst) >= 4);
        assert_eq!(reports.load(Ordering::SeqCst), running_reports);
        assert_eq!(polls.load(Ordering::SeqCst), running_polls);
        eprintln!("SCM portable correctness, synthetic timer comparison: timer ticks={}, candidate Running polls=0, checkpoint reports=0",
            baseline_ticks.load(Ordering::SeqCst));
        state.send(true).unwrap();
        tokio::time::sleep(period * 3).await;
        assert!(reports.load(Ordering::SeqCst) >= running_reports + 2);
        drop(state);
        tokio::time::timeout(period * 3, candidate).await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn empty_host_monitor_resource_pass() {
        let directory = tempfile::tempdir().unwrap();
        let host = ginfer_host::service::Host::open(
            directory.path().into(),
            "Empty monitor".into(),
            std::env::current_exe().unwrap(),
            vec![],
            vec![],
            vec![],
        )
        .await
        .unwrap();
        let initial = host.revision.load(std::sync::atomic::Ordering::SeqCst);
        let start = std::time::Instant::now();
        let refreshed = super::refresh_active_processes(&host).await.unwrap();
        let elapsed = start.elapsed();
        let revision_changes = host.revision.load(std::sync::atomic::Ordering::SeqCst) - initial;
        assert!(host.snapshot().await["instances"].as_array().unwrap().is_empty());
        eprintln!("RESOURCE_EMPTY_MONITOR elapsed={elapsed:?} refreshed={refreshed} revision_changes={revision_changes}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn process_monitor_wakes_for_launch_and_parks_after_stop_and_exit() {
        use ginfer_host::engine_host::{EngineLaunch, HostProcesses, LaunchOptions};
        use std::{collections::BTreeSet, os::unix::fs::PermissionsExt, time::Duration};

        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("engine");
        std::fs::write(&executable, "#!/bin/sh\nexec sleep 60\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let artifact = directory.path().join("fixture.ginfer");
        std::fs::write(&artifact, b"fixture").unwrap();
        let host = ginfer_host::service::Host::open(
            directory.path().join("host"), "Monitor fixture".into(), executable.clone(),
            vec![], vec![], vec![],
        ).await.unwrap();
        *host.processes.lock().await = HostProcesses::new(
            executable.clone(), BTreeSet::from(["GPU-fixture".into()]), Duration::from_secs(10),
        ).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = hyper::Server::from_tcp(listener).unwrap().serve(
            hyper::service::make_service_fn(|_| async {
                Ok::<_, hyper::Error>(hyper::service::service_fn(|_| async {
                    Ok::<_, hyper::Error>(hyper::Response::new(hyper::Body::from(
                        r#"{"data":[{"id":"fixture","owned_by":"monitor-test"}]}"#,
                    )))
                }))
            }),
        );
        let mut jobs = tokio::task::JoinSet::new();
        jobs.spawn(async move { server.await.unwrap(); });
        let polls = Arc::new(AtomicUsize::new(0));
        let observed = polls.clone();
        let monitor_host = host.clone();
        let (registered, ready) = tokio::sync::oneshot::channel();
        jobs.spawn(async move {
            let future = super::monitor_processes(&monitor_host);
            tokio::pin!(future);
            let mut registered = Some(registered);
            std::future::poll_fn(|context| {
                observed.fetch_add(1, Ordering::SeqCst);
                let result = future.as_mut().poll(context);
                if let Some(registered) = registered.take() {
                    registered.send(()).unwrap();
                }
                result
            }).await;
        });
        ready.await.unwrap();
        let idle_polls = polls.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(1100)).await;
        assert_eq!(polls.load(Ordering::SeqCst), idle_polls);
        let id = uuid::Uuid::new_v4();
        let launch = || EngineLaunch {
            benchmark_profile: None,
            instance_id: id, artifact: artifact.clone(), artifact_dependencies: vec![artifact.clone()],
            artifact_set: false, model_id: "fixture".into(), gpu_uuids: vec!["GPU-fixture".into()],
            tp: 1, port, max_context: 4096, concurrency: 1, options: LaunchOptions::default(),
        };
        let revision = host.revision.load(Ordering::SeqCst);
        let started = std::time::Instant::now();
        let first = host.processes.lock().await.launch(launch()).unwrap();
        tokio::time::timeout(Duration::from_millis(750), async {
            loop {
                if let Ok((_, _, model, session)) = host.processes.lock().await.endpoint(id) {
                    assert_eq!(model, "fixture");
                    assert_eq!(session, first);
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        }).await.unwrap();
        let readiness_elapsed = started.elapsed();
        assert!(host.revision.load(Ordering::SeqCst) > revision);
        host.processes.lock().await.stop(id).await.unwrap();
        tokio::time::sleep(Duration::from_millis(25)).await;
        let stopped_polls = polls.load(Ordering::SeqCst);
        let stopped_revision = host.revision.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(1100)).await;
        assert_eq!(polls.load(Ordering::SeqCst), stopped_polls);
        assert_eq!(host.revision.load(Ordering::SeqCst), stopped_revision);
        assert_eq!(host.snapshot().await["instances"][0]["status"], "stopped");

        std::fs::write(&executable, "#!/bin/sh\nprintf 'final diagnostic\\n'\nexit 7\n").unwrap();
        let restarted = std::time::Instant::now();
        let second = host.processes.lock().await.launch(launch()).unwrap();
        assert_ne!(first, second);
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let snapshot = host.snapshot().await;
                if snapshot["instances"][0]["status"] == "failed" {
                    assert_eq!(snapshot["instances"][0]["session_id"], second.to_string());
                    assert_eq!(snapshot["instances"][0]["last_error"],
                        "engine exited unexpectedly: exit status: 7\nfinal diagnostic");
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        }).await.unwrap();
        let exit_elapsed = restarted.elapsed();
        assert!(host.processes.lock().await.reserved_gpus(None).is_empty());
        assert!(host.revision.load(Ordering::SeqCst) > stopped_revision);
        tokio::time::sleep(Duration::from_millis(25)).await;
        let exited_polls = polls.load(Ordering::SeqCst);
        let exited_revision = host.revision.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(1100)).await;
        assert_eq!(polls.load(Ordering::SeqCst), exited_polls);
        assert_eq!(host.revision.load(Ordering::SeqCst), exited_revision);
        eprintln!("RESOURCE_ACTIVE_MONITOR readiness_elapsed={readiness_elapsed:?} exit_diagnostic_elapsed={exit_elapsed:?} monitor_revision_changes={}",
            exited_revision - revision);
        jobs.abort_all();
        while jobs.join_next().await.is_some() {}
    }

    #[tokio::test]
    #[ignore = "one actual one-second idle timer comparison"]
    async fn process_monitor_idle_timer_measurement() {
        let directory = tempfile::tempdir().unwrap();
        let host = ginfer_host::service::Host::open(
            directory.path().into(), "Idle monitor".into(), std::env::current_exe().unwrap(),
            vec![], vec![], vec![],
        ).await.unwrap();
        let baseline_polls = Arc::new(AtomicUsize::new(0));
        let candidate_polls = Arc::new(AtomicUsize::new(0));
        let baseline_host = host.clone();
        let baseline_observed = baseline_polls.clone();
        let candidate_host = host.clone();
        let candidate_observed = candidate_polls.clone();
        let mut jobs = tokio::task::JoinSet::new();
        jobs.spawn(async move {
            let future = async {
                let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
                tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    tick.tick().await;
                    if baseline_host.processes.lock().await.instances().next().is_some() {
                        let result = baseline_host.refresh_processes().await;
                        baseline_host.revision.fetch_add(1, Ordering::SeqCst);
                        result.unwrap();
                    }
                }
            };
            tokio::pin!(future);
            std::future::poll_fn(|context| {
                baseline_observed.fetch_add(1, Ordering::SeqCst);
                future.as_mut().poll(context)
            }).await;
        });
        jobs.spawn(async move {
            let future = super::monitor_processes(&candidate_host);
            tokio::pin!(future);
            std::future::poll_fn(|context| {
                candidate_observed.fetch_add(1, Ordering::SeqCst);
                future.as_mut().poll(context)
            }).await;
        });
        let started = std::time::Instant::now();
        tokio::time::sleep(std::time::Duration::from_millis(2200)).await;
        jobs.abort_all();
        while jobs.join_next().await.is_some() {}
        let baseline = baseline_polls.load(Ordering::SeqCst);
        let candidate = candidate_polls.load(Ordering::SeqCst);
        assert!(baseline >= 3);
        assert_eq!(candidate, 1);
        eprintln!("RESOURCE_IDLE_MONITOR elapsed={:?} baseline_future_polls={baseline} candidate_future_polls={candidate} revision={}",
            started.elapsed(), host.revision.load(Ordering::SeqCst));
    }
}
