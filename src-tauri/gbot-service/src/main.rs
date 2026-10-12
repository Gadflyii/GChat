use std::{path::PathBuf, process::ExitCode, sync::Arc};

use clap::Parser;
#[cfg(target_os = "linux")]
use clap::Subcommand;
use gbot_service::{
    api::Api,
    executor::{ExecutorProcesses, ProcessSpec},
    service::Service,
    vault::NativeVault,
};

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
    /// Python from the configured Cua environment.
    #[arg(long, requires = "context_program")]
    cua_python: Option<PathBuf>,
    /// GChat's existing context/compaction helper.
    #[arg(long, requires = "cua_python")]
    context_program: Option<PathBuf>,
    #[arg(long, requires = "context_program", allow_hyphen_values = true)]
    context_arg: Vec<String>,
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
    #[cfg(target_os = "linux")]
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
    let mut api = Api::bind(service, Arc::new(NativeVault), args.port).await?;
    if let (Some(python), Some(context)) = (args.cua_python, args.context_program) {
        api = api
            .with_executor(
                data_folder.join("gbot/tasks"),
                ExecutorProcesses {
                    python: ProcessSpec {
                        program: python,
                        args: vec![],
                    },
                    context: ProcessSpec {
                        program: context,
                        args: args.context_arg,
                    },
                },
            )
            .await?;
    }
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
