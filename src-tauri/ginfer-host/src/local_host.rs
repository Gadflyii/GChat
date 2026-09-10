//! Reconnect or start one persistent local host; never launch an inference child.
use crate::{launcher::LocalControl, service_owner::ServiceOwner};
use std::{net::SocketAddr, path::PathBuf, process::Stdio, time::Duration};

#[cfg(windows)]
fn keep_client_pipes_private() -> Result<(), String> {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetStdHandle(which: u32) -> *mut c_void;
        fn GetFileType(handle: *mut c_void) -> u32;
        fn SetHandleInformation(handle: *mut c_void, mask: u32, flags: u32) -> i32;
    }
    // The host gets explicit log/null handles. Inheriting a client's original
    // pipeline handles would keep PowerShell waiting for EOF after the client exits.
    for which in [-10_i32, -11, -12] {
        unsafe {
            let handle = GetStdHandle(which as u32);
            if GetFileType(handle) == 3 && SetHandleInformation(handle, 1, 0) == 0 {
                return Err(format!("cannot isolate launcher pipe: {}", std::io::Error::last_os_error()));
            }
        }
    }
    Ok(())
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalHost {
    pub binary: PathBuf,
    pub engine: PathBuf,
    pub directory: PathBuf,
    pub desktop_provider: Option<PathBuf>,
    pub models: Vec<PathBuf>,
    pub artifact_sets: Vec<PathBuf>,
    pub name: String,
    pub nvidia_smi: PathBuf,
    pub listen: SocketAddr,
}

impl LocalHost {
    pub async fn ensure_shared_running(self) -> Result<LocalControl, String> {
        crate::local_host_registry::resolve(Some(
            crate::local_host_registry::Owner::Desktop(self),
        )).await?.connect().await
    }

    async fn connect(&self) -> Result<(LocalControl, serde_json::Value), String> {
        let control = LocalControl::open(&self.directory, &format!("https://{}", self.listen))?;
        let snapshot = tokio::time::timeout(Duration::from_secs(2), control.snapshot())
            .await
            .map_err(|_| "local host connection timed out".to_string())??;
        Ok((control, snapshot))
    }

    fn validate_storage(&self, snapshot: &serde_json::Value) -> Result<(), String> {
        if let Some(provider) = &self.desktop_provider {
            let expected = provider.join("models").canonicalize().map_err(|e| format!("desktop model cache unavailable: {e}"))?;
            let actual: PathBuf = serde_json::from_value(snapshot["model_management"]["managed_root"].clone()).map_err(|e| e.to_string())?;
            if actual != expected { return Err("The running host uses different managed storage; explicitly restart it with the desktop provider configuration".into()); }
        }
        Ok(())
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        if !self.listen.ip().is_loopback() || self.listen.port() == 0 {
            return Err("local bootstrap requires a fixed loopback management address".into());
        }
        if !self.directory.is_absolute() || !self.binary.is_absolute() || !self.engine.is_absolute()
        {
            return Err("local host paths must be absolute".into());
        }
        if self.desktop_provider.as_ref().is_some_and(|provider|
            !provider.is_absolute() || self.directory != provider.join("host")) {
            return Err("desktop provider storage must use its dedicated provider/host state directory".into());
        }
        Ok(())
    }

    pub async fn ensure_running(&self) -> Result<LocalControl, String> {
        self.validate()?;
        if let Ok((control, snapshot)) = self.connect().await {
            self.validate_storage(&snapshot)?;
            return Ok(control);
        }
        let mut child = None;
        // An existing owner may still be initializing. Never replace it merely
        // because its HTTP endpoint is not ready.
        if let Ok(owner) = ServiceOwner::acquire(&self.directory) {
            if !self.binary.is_file() {
                return Err("installed host executable is missing".into());
            }
            let mut log_options = std::fs::OpenOptions::new();
            log_options.create(true).append(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                log_options.mode(0o600);
            }
            let log = log_options
                .open(self.directory.join("host.log"))
                .map_err(|e| format!("cannot open host log: {e}"))?;
            drop(owner);
            #[cfg(windows)]
            keep_client_pipes_private()?;
            let mut command = tokio::process::Command::new(&self.binary);
            command
                .arg("--data-dir")
                .arg(&self.directory)
                .arg("--engine")
                .arg(&self.engine)
                .arg("--name")
                .arg(&self.name)
                .arg("--listen")
                .arg(self.listen.to_string())
                .arg("--nvidia-smi")
                .arg(&self.nvidia_smi)
                .stdin(Stdio::null())
                .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
                .stderr(Stdio::from(log))
                .kill_on_drop(false);
            for model in &self.models {
                command.arg("--models").arg(model);
            }
            if let Some(provider) = &self.desktop_provider { command.arg("--desktop-provider").arg(provider); }
            for descriptor in &self.artifact_sets {
                command.arg("--artifact-set").arg(descriptor);
            }
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                command.as_std_mut().process_group(0);
            }
            #[cfg(windows)]
            command.creation_flags(0x00000008 | 0x00000200); // Detached, independent process group.
            child = Some(
                command
                    .spawn()
                    .map_err(|e| format!("cannot start ginfer-host: {e}"))?,
            );
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        let mut exit = None;
        loop {
            if let Ok((control, snapshot)) = self.connect().await {
                self.validate_storage(&snapshot)?;
                if let Some(mut child) = child {
                    tokio::spawn(async move {
                        let _ = child.wait().await;
                    });
                }
                return Ok(control);
            }
            if let Some(process) = child.as_mut() {
                if let Some(status) = process.try_wait().map_err(|e| e.to_string())? {
                    exit = Some(status);
                    child = None;
                    // A concurrent bootstrap may have won the owner lock.
                }
            }
            if tokio::time::Instant::now() >= deadline {
                if let Some(mut child) = child {
                    tokio::spawn(async move {
                        let _ = child.wait().await;
                    });
                }
                return Err(match exit {
                    Some(status) => format!("ginfer-host exited ({status}); no local owner became ready. See {}", self.directory.join("host.log").display()),
                    None => format!("ginfer-host has not become ready; its existing owner was left running. See {}", self.directory.join("host.log").display()),
                });
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}
