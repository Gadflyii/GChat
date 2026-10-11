use std::{path::PathBuf, process::ExitCode, sync::Arc};

use clap::Parser;
use gbot_service::{api::Api, service::Service, vault::NativeVault};

#[derive(Parser)]
#[command(
    name = "gbot-service",
    about = "GChat's local-first bot workspace service"
)]
struct Args {
    #[arg(long)]
    data_folder: PathBuf,
    #[arg(long, default_value_t = 0)]
    port: u16,
}

async fn run(args: Args) -> Result<(), Box<dyn std::error::Error>> {
    if args.data_folder.as_os_str().is_empty() {
        return Err("Gbot requires an explicit data folder".into());
    }
    let service = Arc::new(Service::open(args.data_folder.join("gbot/state.json")).await?);
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
