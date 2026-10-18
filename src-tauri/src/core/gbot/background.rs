//! Native per-user service bootstrap. No webview, GUI lifetime, or secrets in discovery.
use gbot_service::{
    api::{Api, ApiError},
    executor::{ExecutorProcesses, ProcessSpec},
    service::Service,
    vault::{NativeVault, VaultError},
};
use ginfer_host::gbot_bootstrap::{StartupError, StartupFailure};
use ginfer_host::service_owner::ServiceOwner;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

fn packaged_executor(resources: &Path) -> Result<Option<ExecutorProcesses>, StartupError> {
    let processes = ExecutorProcesses::packaged(resources)
        .map_err(|detail| StartupError::new(StartupFailure::BotUnavailable, detail))?;
    #[cfg(windows)]
    if processes.is_none() {
        return Err(StartupError::new(
            StartupFailure::BotUnavailable,
            "The installed Windows Cua runtime manifest is missing",
        ));
    }
    Ok(processes)
}

fn executor_processes(resources: &Path) -> Result<Option<ExecutorProcesses>, StartupError> {
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
        _ => Err(StartupError::new(
            StartupFailure::BotUnavailable,
            "Set both GBOT_CUA_PYTHON and GBOT_CONTEXT_PREPARER for bot tasks",
        )),
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
) -> Result<(), StartupError> {
    if !root.is_absolute() || !resources.is_absolute() {
        return Err("Gbot requires absolute data and resource folders".into());
    }
    let store = ginfer_host::gbot_bootstrap::credential_store()?;
    #[cfg(target_os = "linux")]
    if credential_session_stdin {
        tokio::task::spawn_blocking(move || -> Result<(), StartupError> {
            use std::io::Read;
            let mut bytes = jan_utils::credential_store::Zeroizing::new(Vec::new());
            std::io::stdin()
                .take(49)
                .read_to_end(&mut bytes)
                .map_err(|_| "Gbot credential channel unavailable")?;
            if !bytes.is_empty() {
                store.accept_session_key(&bytes)?;
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
        .map_err(api_startup_error)?;
    api = api
        .with_guest_assets(directory.join("vms/assets"))
        .map_err(api_startup_error)?;
    api = api
        .with_cloud_setup(
            directory.clone(),
            Arc::new(super::cloud::NativeCloudHost::new()?),
        )
        .await
        .map_err(api_startup_error)?;
    api = api
        .with_m365_setup(directory.clone())
        .await
        .map_err(api_startup_error)?;
    api = api
        .with_inference_host(Arc::new(
            super::inference::NativeInferenceHost::open().await?,
        ))
        .map_err(api_startup_error)?;
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        api = api
            .with_kvm_setup(directory.clone())
            .await
            .map_err(api_startup_error)?;
    }
    if let Some(processes) = executor_processes(&resources)? {
        api = api
            .with_executor(directory.join("tasks"), processes)
            .await
            .map_err(api_startup_error)?;
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
        .map_err(api_startup_error);
    // Only this locked owner may retire its discovery, after tasks/workspaces have closed.
    let _ = tokio::fs::remove_file(directory.join("service.json")).await;
    result
}

fn api_startup_error(error: ApiError) -> StartupError {
    let failure = match &error {
        ApiError::Vault(VaultError::AccessDenied) => StartupFailure::SecureStorageLocked,
        ApiError::Vault(VaultError::Unavailable) => StartupFailure::SecureStorageUnavailable,
        ApiError::Vault(VaultError::InvalidData) => StartupFailure::InvalidCredentials,
        ApiError::Vault(VaultError::Ambiguous) => StartupFailure::ConflictingCredentials,
        ApiError::Vault(VaultError::Missing) => StartupFailure::MissingCredentials,
        _ => StartupFailure::Other,
    };
    StartupError::new(failure, error.to_string())
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
    let result = parsed
        .map_err(|error| StartupError::from(error.to_string()))
        .and_then(|args| {
            let resources = match (args.resources, args.appimage_resources) {
                (Some(resources), None) => resources,
                (None, Some(relative))
                    if !relative.is_absolute()
                        && !relative
                            .components()
                            .any(|part| matches!(part, std::path::Component::ParentDir)) =>
                {
                    PathBuf::from(
                        std::env::var_os("APPDIR").ok_or("Gbot AppImage mount unavailable")?,
                    )
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
            std::process::ExitCode::from(error.failure.exit_code())
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrupt_packaged_runtime_reports_bot_unavailable() {
        let root = tempfile::tempdir().unwrap();
        let runtime = root.path().join("resources/gbot");
        std::fs::create_dir_all(&runtime).unwrap();
        std::fs::write(runtime.join("runtime.json"), "invalid manifest").unwrap();
        let error = packaged_executor(root.path()).err().unwrap();
        assert_eq!(error.failure, StartupFailure::BotUnavailable);
        let message = String::from(error);
        assert!(message.starts_with("Bot unavailable:"), "{message}");
        assert!(message.contains("Chat is still available."), "{message}");
    }

    #[cfg(windows)]
    #[test]
    fn missing_packaged_runtime_reports_bot_unavailable() {
        let root = tempfile::tempdir().unwrap();
        let error = packaged_executor(root.path()).err().unwrap();
        assert_eq!(error.failure, StartupFailure::BotUnavailable);
    }

    #[test]
    fn startup_exit_codes_preserve_typed_vault_failures() {
        for (cause, code) in [
            (VaultError::AccessDenied, 201),
            (VaultError::Unavailable, 202),
            (VaultError::InvalidData, 203),
            (VaultError::Ambiguous, 204),
            (VaultError::Missing, 205),
            (VaultError::WorkerFailure, 1),
        ] {
            assert_eq!(
                api_startup_error(ApiError::Vault(cause))
                    .failure
                    .exit_code(),
                code
            );
        }
        // Human-readable text cannot turn an unrelated failure into a vault cause.
        let unrelated = ApiError::Listener(std::io::Error::other("Secure storage is locked"));
        assert_eq!(api_startup_error(unrelated).failure.exit_code(), 1);
    }
}
