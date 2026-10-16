#[cfg(target_os = "linux")]
use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
#[cfg(target_os = "linux")]
use clap::Subcommand;

#[derive(Parser)]
#[command(
    name = "gbot-service",
    about = "Gbot KVM maintenance tools; launch the authenticated service through GChat"
)]
struct Args {
    #[cfg(target_os = "linux")]
    #[command(subcommand)]
    command: Option<Mode>,
}

#[cfg(target_os = "linux")]
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
    /// Start the owned libvirt guest; it survives this command/service exiting.
    Start {
        #[arg(long)]
        directory: PathBuf,
    },
    Status {
        #[arg(long)]
        directory: PathBuf,
    },
    Stop {
        #[arg(long)]
        directory: PathBuf,
        #[arg(long)]
        force: bool,
    },
    /// Unregister only a stopped owned domain; retain its disk and setup files.
    Unregister {
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
        KvmCommand::Start { directory } => {
            let vm = PreparedVm::open(&directory).await?;
            println!("{:?}", vm.start(&KvmTools::default()).await?);
        }
        KvmCommand::Status { directory } => {
            let vm = PreparedVm::open(&directory).await?;
            println!("{:?}", vm.state(&KvmTools::default()).await?);
        }
        KvmCommand::Stop { directory, force } => {
            let vm = PreparedVm::open(&directory).await?;
            let tools = KvmTools::default();
            let state = if force {
                vm.force_stop(&tools).await?
            } else {
                vm.shutdown(&tools).await?
            };
            println!("{state:?}");
        }
        KvmCommand::Unregister { directory } => {
            PreparedVm::open(&directory)
                .await?
                .unregister(&KvmTools::default())
                .await?;
        }
    }
    Ok(())
}

async fn run(args: Args) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(not(target_os = "linux"))]
    let _ = args;

    #[cfg(target_os = "linux")]
    if let Some(mode) = args.command {
        match mode {
            #[cfg(target_os = "linux")]
            Mode::Kvm { command } => return kvm(command).await,
        }
    }
    Err(
        "Start Gbot service through GChat so native connectors and packaged Cua share its lifetime"
            .into(),
    )
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
