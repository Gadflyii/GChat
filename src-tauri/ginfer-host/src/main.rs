use clap::Parser;
use ginfer_host::{
    discovery::advertise,
    service::{Gpu, Host, Persistent},
    transport::pinned_client,
};
use std::{path::PathBuf, sync::atomic::Ordering, time::Duration};

#[cfg(windows)]
mod windows_service;

#[derive(Parser)]
#[command(about = "GInfer LAN host: inventory, pairing, and owned inference instances")]
struct Args {
    /// Run under the Windows Service Control Manager (installer-owned mode).
    #[cfg(windows)]
    #[arg(long, conflicts_with_all = ["pair", "request_pairing"])]
    windows_service: bool,
    #[arg(long)]
    data_dir: PathBuf,
    /// NVIDIA inventory executable; installers resolve service-specific PATHs.
    #[arg(long, default_value = "nvidia-smi")]
    nvidia_smi: PathBuf,
    #[arg(long, required_unless_present = "request_pairing")]
    engine: Option<PathBuf>,
    #[arg(long)]
    models: Vec<PathBuf>,
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
    /// Print a one-use pairing code and certificate fingerprint, valid five minutes.
    #[arg(long)]
    pair: bool,
    /// Activate pairing on an already-running service using its local private state.
    #[arg(long, conflicts_with = "pair")]
    request_pairing: bool,
    /// Management origin for --request-pairing (certificate is pinned from local state).
    #[arg(
        long,
        default_value = "https://127.0.0.1:7443",
        requires = "request_pairing"
    )]
    host_url: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
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
async fn run(
    args: Args,
    ready: impl FnOnce() -> Result<(), String>,
    shutdown: impl std::future::Future<Output = ()>,
) -> Result<(), String> {
    if args.request_pairing {
        let data: Persistent = serde_json::from_slice(
            &std::fs::read(args.data_dir.join("host.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let mut url = reqwest::Url::parse(&args.host_url).map_err(|e| e.to_string())?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
        {
            return Err("host URL must be an HTTPS origin".into());
        }
        url.set_path("/host/v1/pairing");
        let response = pinned_client(&data.certificate.fingerprint())?
            .post(url)
            .bearer_auth(data.pairing_admin_token)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("pairing activation failed: {}", response.status()));
        }
        let result: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
        println!(
            "Host: {}\nCertificate SHA256: {}\nPairing code (5 minutes): {}",
            result["host_id"].as_str().ok_or("missing host ID")?,
            result["certificate_sha256"]
                .as_str()
                .ok_or("missing certificate fingerprint")?,
            result["code"].as_str().ok_or("missing code")?
        );
        return Ok(());
    }
    if args.discoverable && args.listen.ip().is_loopback() {
        return Err("LAN discovery requires a LAN or wildcard --listen address".into());
    }
    let output = tokio::process::Command::new(&args.nvidia_smi)
        .args([
            "--query-gpu=uuid,name,memory.total,compute_cap",
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
        if values.len() != 4 {
            return Err("unrecognized NVIDIA inventory row".into());
        }
        gpus.push(Gpu {
            uuid: values[0].into(),
            name: values[1].into(),
            memory_mib: values[2].parse::<u64>().map_err(|e| e.to_string())?,
            compute_capability: values[3].parse::<f32>().ok().map(|_| values[3].to_string()),
        });
    }
    let host = Host::open(
        args.data_dir,
        args.name,
        args.engine.ok_or("engine is required")?,
        args.models,
        args.artifact_set,
        gpus,
    )
    .await?;
    let listener = tokio::net::TcpListener::bind(args.listen)
        .await
        .map_err(|e| e.to_string())?;
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
            listener.local_addr().map_err(|e| e.to_string())?.port(),
        )?)
    } else {
        None
    };
    drop(data);
    if args.pair {
        println!("Pairing code (5 minutes): {}", host.enable_pairing().await);
    }
    let mut connections = tokio::task::JoinSet::new();
    ready()?;
    // Disk inventory and health requests must never prevent accepting a fresh
    // client connection (notably while an engine saturates NAS startup reads).
    let mut maintenance = tokio::task::JoinSet::new();
    let monitor_host = host.clone();
    maintenance.spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            if let Err(e) = monitor_host.processes.lock().await.refresh().await {
                eprintln!("Engine monitoring: {e}");
            }
            monitor_host.revision.fetch_add(1, Ordering::SeqCst);
        }
    });
    let scan_host = host.clone();
    maintenance.spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(30));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        tick.tick().await; // Host::open already performed the initial inventory.
        loop {
            tick.tick().await;
            if let Err(e) = scan_host.scan().await {
                eprintln!("Inventory refresh: {e}");
            }
        }
    });
    tokio::pin!(shutdown);
    let outcome = loop {
        tokio::select! {
            _ = &mut shutdown => break Ok(()),
            result = maintenance.join_next() => break Err(format!("Host maintenance stopped unexpectedly: {result:?}")),
            Some(_) = connections.join_next(), if !connections.is_empty() => {},
            result = listener.accept() => {
                let (socket,_) = match result { Ok(socket) => socket, Err(e) => break Err(e.to_string()) };
                let acceptor = acceptor.clone(); let host = host.clone();
                connections.spawn(async move {
                    let Ok(Ok(tls)) = tokio::time::timeout(Duration::from_secs(10),acceptor.accept(socket)).await else { return };
                    let service = hyper::service::service_fn(move |req| host.clone().route(req));
                    let _ = hyper::server::conn::Http::new().serve_connection(tls, service).await;
                });
            },
        }
    };
    if let Some(advertisement) = advertisement {
        let _ = advertisement.shutdown();
    }
    connections.abort_all();
    while connections.join_next().await.is_some() {}
    maintenance.abort_all();
    while maintenance.join_next().await.is_some() {}
    host.processes.lock().await.shutdown().await?;
    outcome
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
