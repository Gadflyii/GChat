//! Native per-user service bootstrap. No webview, GUI lifetime, or secrets in discovery.
use gbot_service::{
    api::Api,
    executor::{ExecutorProcesses, ProcessSpec},
    service::Service,
    vault::NativeVault,
};
use ginfer_host::service_owner::ServiceOwner;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
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

pub(super) use ginfer_host::gbot_bootstrap::connect;
pub(crate) use ginfer_host::gbot_bootstrap::LocalClient as Client;

#[cfg(target_os = "linux")]
pub(crate) async fn credential_control(
    root: &Path,
    operation: &str,
    passphrase: Option<&str>,
) -> Result<(), String> {
    if !root.join("gbot/service.json").exists() {
        return Ok(());
    }
    let client = match connect(root).await {
        Ok(client) => client,
        // A stopped process has no unlocked key to clear or update.
        Err(error) if error.contains("connection lost") || error.contains("not responding") => {
            return Ok(())
        }
        Err(error) => return Err(error),
    };
    tokio::time::timeout(
        Duration::from_secs(5),
        client.call(
            &format!("/v1/credentials/{operation}"),
            serde_json::json!({"passphrase": passphrase}),
        ),
    )
    .await
    .map_err(|_| "Gbot secure storage did not respond; reconnect before continuing".to_string())?
    .map(|_| ())
}

pub(super) async fn ensure_running(root: &Path, resources: &Path) -> Result<Client, String> {
    let bootstrap = ginfer_host::gbot_bootstrap::Bootstrap::capture(root, resources)?;
    let hosts = super::super::engine_hosts::shared_client().await?;
    if let Some(local) = hosts.local_host().await? {
        hosts
            .request_json(
                local,
                reqwest::Method::POST,
                "/host/v1/gbot/bootstrap",
                Some(&serde_json::to_value(&bootstrap).map_err(|e| e.to_string())?),
            )
            .await
            .map_err(String::from)?;
    }
    ginfer_host::gbot_bootstrap::ensure_running(&bootstrap).await
}

#[derive(clap::Parser)]
struct ServiceArgs {
    #[arg(long)]
    data_folder: PathBuf,
    #[arg(long)]
    credential_session_stdin: bool,
    #[arg(
        long,
        conflicts_with = "appimage_resources",
        required_unless_present = "appimage_resources"
    )]
    resources: Option<PathBuf>,
    #[arg(long, conflicts_with = "resources")]
    appimage_resources: Option<PathBuf>,
}

async fn serve(
    root: PathBuf,
    resources: PathBuf,
    credential_session_stdin: bool,
) -> Result<(), String> {
    if !root.is_absolute() || !resources.is_absolute() {
        return Err("Gbot requires absolute data and resource folders".into());
    }
    let store = super::super::engine_hosts::initialize_credentials()?;
    #[cfg(target_os = "linux")]
    if credential_session_stdin {
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            use std::io::Read;
            let mut bytes = jan_utils::credential_store::Zeroizing::new(Vec::new());
            std::io::stdin()
                .take(49)
                .read_to_end(&mut bytes)
                .map_err(|_| "Gbot credential channel unavailable")?;
            if !bytes.is_empty() {
                store
                    .accept_session_key(&bytes)
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())??;
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (store, credential_session_stdin);
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
    api = api
        .with_guest_assets(directory.join("vms/assets"))
        .map_err(|error| error.to_string())?;
    api = api
        .with_cloud_setup(
            directory.clone(),
            Arc::new(super::cloud::NativeCloudHost::new()?),
        )
        .await
        .map_err(|error| error.to_string())?;
    api = api
        .with_m365_setup(directory.clone())
        .await
        .map_err(|error| error.to_string())?;
    api = api
        .with_inference_host(Arc::new(
            super::inference::NativeInferenceHost::open().await?,
        ))
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
    let discovery = ginfer_host::gbot_bootstrap::Discovery {
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
            .block_on(serve(
                args.data_folder,
                resources,
                args.credential_session_stdin,
            ))
    });
    Some(match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Gbot service failed: {error}");
            std::process::ExitCode::FAILURE
        }
    })
}
