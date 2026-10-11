use std::{path::PathBuf, process::ExitCode, sync::Arc};

use clap::{Parser, Subcommand};
use gbot_service::{api::Api, service::Service, vault::NativeVault};

#[derive(Parser)]
#[command(
    name = "gbot-service",
    about = "GChat's local-first bot workspace service"
)]
struct Args {
    #[arg(long)]
    data_folder: Option<PathBuf>,
    #[arg(long, default_value_t = 0)]
    port: u16,
    #[command(subcommand)]
    command: Option<Mode>,
}

#[derive(Subcommand)]
enum Mode {
    #[cfg(target_os = "linux")]
    Kvm {
        #[command(subcommand)]
        command: KvmCommand,
    },
}

#[cfg(target_os = "linux")]
#[derive(Subcommand)]
enum KvmCommand {
    /// Render shared first-boot setup without creating or starting a guest.
    CloudInit {
        #[arg(long)]
        spec: PathBuf,
    },
    /// Prepare one owned guest disk and NoCloud seed; does not start QEMU.
    Prepare {
        #[arg(long)]
        root: PathBuf,
        #[arg(long)]
        image: PathBuf,
        #[arg(long)]
        spec: PathBuf,
    },
    /// Run a prepared guest in the foreground; Ctrl-C stops only this guest.
    Run {
        #[arg(long)]
        directory: PathBuf,
    },
}

#[cfg(target_os = "linux")]
async fn kvm(command: KvmCommand) -> Result<(), Box<dyn std::error::Error>> {
    use gbot_service::kvm::{KvmSpec, KvmTools, PreparedVm};
    match command {
        KvmCommand::CloudInit { spec } => {
            let spec: KvmSpec = serde_json::from_slice(&tokio::fs::read(spec).await?)?;
            print!("{}", spec.cloud_init()?);
        }
        KvmCommand::Prepare { root, image, spec } => {
            let spec: KvmSpec = serde_json::from_slice(&tokio::fs::read(spec).await?)?;
            let vm = PreparedVm::prepare(&root, &image, spec, &KvmTools::default()).await?;
            println!("{}", serde_json::to_string(&vm)?);
        }
        KvmCommand::Run { directory } => {
            let vm = PreparedVm::open(&directory).await?;
            let running = vm.start(&KvmTools::default()).await?;
            println!(
                "{}",
                serde_json::json!({"vm_id": vm.spec.id, "pid": running.id(), "ssh": format!("127.0.0.1:{}", vm.spec.ssh_port)})
            );
            running.until_shutdown().await?;
        }
    }
    Ok(())
}

async fn run(args: Args) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(mode) = args.command {
        match mode {
            #[cfg(target_os = "linux")]
            Mode::Kvm { command } => return kvm(command).await,
        }
    }
    let data_folder = args
        .data_folder
        .ok_or("Gbot requires an explicit data folder")?;
    if data_folder.as_os_str().is_empty() {
        return Err("Gbot requires an explicit data folder".into());
    }
    let service = Arc::new(Service::open(data_folder.join("gbot/state.json")).await?);
    let service_id = service.snapshot().await.service_id;
    let api = Api::bind(service, Arc::new(NativeVault), args.port).await?;
    println!(
        "{}",
        serde_json::json!({
            "service_id": service_id,
            "endpoint": format!("http://{}", api.endpoint())
        })
    );
    api.serve(async {
        if tokio::signal::ctrl_c().await.is_err() {
            eprintln!("Gbot shutdown signal is unavailable");
        }
    })
    .await?;
    Ok(())
}

#[tokio::main]
async fn main() -> ExitCode {
    match run(Args::parse()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Gbot service failed: {error}");
            ExitCode::FAILURE
        }
    }
}
