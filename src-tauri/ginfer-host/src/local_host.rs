//! Reconnect or start one persistent local host; never launch an inference child.
use crate::{launcher::LocalControl, service_owner::ServiceOwner};
use std::{net::SocketAddr, path::{Path, PathBuf}, process::Stdio, time::Duration};

/// The saved endpoint belongs to this state directory, never to another locator owner.
pub fn management_address(directory: &Path, preferred: SocketAddr) -> Result<SocketAddr, String> {
    let bytes = match std::fs::read(directory.join("host.json")) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(preferred),
        Err(error) => return Err(format!("Cannot read local Host state: {error}")),
    };
    let state: crate::service::Persistent = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let Some(origin) = state.management_origin else { return Ok(preferred); };
    let url = reqwest::Url::parse(&origin).map_err(|e| e.to_string())?;
    let address: std::net::IpAddr = url.host_str().ok_or("Missing local Host address")?
        .trim_matches(['[', ']']).parse().map_err(|_| "Local Host requires a loopback IP address")?;
    let port = url.port_or_known_default().ok_or("Missing local Host port")?;
    if url.scheme() != "https" || !address.is_loopback() || port == 0 || url.path() != "/"
        || url.query().is_some() || url.fragment().is_some() || !url.username().is_empty() || url.password().is_some() {
        return Err("Saved local Host endpoint must be an HTTPS loopback origin".into());
    }
    Ok(SocketAddr::new(address, port))
}

/// Keep the fallback socket bound: a probe followed by a second bind is racy.
pub async fn bind_management(preferred: SocketAddr, managed: bool) -> Result<(tokio::net::TcpListener, Option<String>), String> {
    match tokio::net::TcpListener::bind(preferred).await {
        Ok(listener) => Ok((listener, None)),
        Err(error) if managed && preferred.ip().is_loopback() && error.kind() == std::io::ErrorKind::AddrInUse => {
            let listener = tokio::net::TcpListener::bind(SocketAddr::new(preferred.ip(), 0)).await.map_err(|e| e.to_string())?;
            let actual = listener.local_addr().map_err(|e| e.to_string())?;
            let notice = format!("Local Host port {} is already in use. GChat is using https://{actual} for this data folder; the other Host was left running.", preferred.port());
            Ok((listener, Some(notice)))
        }
        Err(error) => Err(format!("Cannot open Host management address {preferred}: {error}")),
    }
}

/// Local authority alone can be copied; verify the authenticated process's root too.
pub(crate) fn validate_local_identity(directory: &Path, snapshot: &serde_json::Value) -> Result<(), String> {
    let expected = directory.canonicalize().map_err(|e| e.to_string())?;
    let identity = &snapshot["local_identity"];
    let actual: Option<PathBuf> = serde_json::from_value(identity["state_directory"].clone()).map_err(|e| e.to_string())?;
    if actual.as_ref() != Some(&expected) || identity["platform"] != std::env::consts::OS {
        return Err("The running Host belongs to a different data folder or platform, or cannot prove its local identity. Restart this data folder's Host after updating GChat.".into());
    }
    Ok(())
}

/// Stop the process belonging to an explicitly configured root during relocation.
/// Missing state or authority fails closed; no discovery, credentials or bootstrap.
pub(crate) async fn stop_existing_if_idle(directory: &Path) -> Result<serde_json::Value, String> {
    tokio::time::timeout(Duration::from_secs(5), async {
        let private: crate::service::Persistent = serde_json::from_slice(
            &std::fs::read(directory.join("host.json")).map_err(|e| e.to_string())?,
        ).map_err(|e| e.to_string())?;
        private.management_origin.ok_or("The configured Host has no saved management endpoint; data folder move was refused")?;
        let address = management_address(directory, SocketAddr::from(([127, 0, 0, 1], 1)))?;
        let control = LocalControl::open(directory, &format!("https://{address}"))?;
        control.stop_host_for_relocation(directory).await
    }).await.map_err(|_| "The configured Host did not confirm idle Stop in time; data folder move was refused and no forced stop was sent".to_string())?
}

#[cfg(windows)]
fn keep_client_pipes_private() -> Result<(), String> {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetStdHandle(which: u32) -> *mut c_void;
        fn GetFileType(handle: *mut c_void) -> u32;
        fn SetHandleInformation(handle: *mut c_void, mask: u32, flags: u32) -> i32;
    }
    // Inherited client pipes would keep PowerShell waiting for EOF after client exit.
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

pub fn computer_name() -> Result<String, String> {
    #[cfg(windows)]
    let name = std::env::var("COMPUTERNAME").map_err(|error| error.to_string())?;
    #[cfg(not(windows))]
    let name = std::fs::read_to_string("/proc/sys/kernel/hostname").map_err(|error| error.to_string())?;
    let name = name.trim();
    if name.is_empty() { return Err("Computer name is unavailable".into()); }
    Ok(name.to_owned())
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalHost {
    pub binary: PathBuf,
    pub engine: PathBuf,
    #[serde(default)]
    pub engine_runtimes: std::collections::BTreeMap<String, PathBuf>,
    pub directory: PathBuf,
    pub desktop_provider: Option<PathBuf>,
    pub models: Vec<PathBuf>,
    pub artifact_sets: Vec<PathBuf>,
    pub name: String,
    pub nvidia_smi: PathBuf,
    pub listen: SocketAddr,
}

impl LocalHost {
    /// Control only this already-running managed Host. Never bootstrap, resolve
    /// another installation's locator, or send a process-wide Windows signal.
    pub async fn stop_if_idle(&self) -> Result<serde_json::Value, String> {
        tokio::time::timeout(Duration::from_secs(5), async {
            let address = management_address(&self.directory, self.listen)?;
            let control = LocalControl::open(&self.directory, &format!("https://{address}"))?;
            control.stop_host_if_idle(&self.directory).await
        }).await.map_err(|_| "The selected Host did not confirm normal Stop in time; status is unknown and no forced stop was sent".to_string())?
    }

    pub async fn ensure_shared_running(self) -> Result<LocalControl, String> {
        crate::local_host_registry::resolve(Some(
            crate::local_host_registry::Owner::Desktop(Box::new(self)),
        )).await?.connect().await
    }

    async fn connect(&self, control: &mut Option<LocalControl>) -> Result<serde_json::Value, String> {
        let previous = control.take();
        let address = management_address(&self.directory, self.listen)?;
        *control = Some(LocalControl::open_reusing(&self.directory,
            &format!("https://{address}"), previous)?);
        let snapshot = tokio::time::timeout(Duration::from_secs(2), control.as_ref().unwrap().snapshot())
            .await
            .map_err(|_| "local host connection timed out".to_string())??;
        validate_local_identity(&self.directory, &snapshot)?;
        Ok(snapshot)
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        crate::engine_host::validate_runtimes(&self.engine_runtimes)?;
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
        let mut control = None;
        if self.connect(&mut control).await.is_ok() {
            return Ok(control.unwrap());
        }
        let mut child = None;
        // An initializing owner must retain ownership before its endpoint is ready.
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
            #[cfg(target_os = "linux")]
            if std::env::var_os("APPIMAGE").is_some() {
                // The host and its engine children outlive the AppImage library mount.
                for variable in [
                    "APPDIR", "APPIMAGE", "ARGV0", "OWD", "LD_LIBRARY_PATH", "LD_PRELOAD",
                    "GDK_PIXBUF_MODULE_FILE", "GDK_PIXBUF_MODULEDIR", "GIO_EXTRA_MODULES",
                    "GIO_MODULE_DIR", "GSETTINGS_SCHEMA_DIR", "GST_PLUGIN_SCANNER",
                    "GST_PLUGIN_SYSTEM_PATH", "GST_PLUGIN_SYSTEM_PATH_1_0", "GTK_DATA_PREFIX",
                    "GTK_EXE_PREFIX", "GTK_IM_MODULE_FILE", "GTK_PATH", "PERLLIB",
                    "PYTHONHOME", "PYTHONPATH", "QT_PLUGIN_PATH",
                ] {
                    command.env_remove(variable);
                }
            }
            command
                .arg("--desktop-managed")
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
            for (architecture, executable) in &self.engine_runtimes {
                command.arg("--engine-runtime").arg(format!("{architecture}={}", executable.display()));
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
            let last_error = match self.connect(&mut control).await {
                Ok(_) => {
                    if let Some(mut child) = child {
                        tokio::spawn(async move {
                            let _ = child.wait().await;
                        });
                    }
                    return Ok(control.unwrap());
                }
                Err(error) => error,
            };
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
                    Some(status) => format!("ginfer-host exited ({status}); no local owner became ready: {last_error}. See {}", self.directory.join("host.log").display()),
                    None => format!("ginfer-host has not become ready; its existing owner was left running: {last_error}. See {}", self.directory.join("host.log").display()),
                });
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}

#[cfg(target_os = "linux")]
pub fn desktop_runtimes(provider: &std::path::Path) -> Result<std::collections::BTreeMap<String, PathBuf>, String> {
    let root = provider.join("linux");
    let set: serde_json::Value = serde_json::from_slice(&std::fs::read(root.join("runtime-set.json"))
        .map_err(|e| format!("GChat Linux engine runtime set is unavailable: {e}"))?)
        .map_err(|e| format!("Invalid GChat Linux engine runtime set: {e}"))?;
    if set["schema"] != "ginfer-linux-runtime-set-v1" || set["platform"] != "linux-x64" {
        return Err("Unsupported GChat Linux engine runtime set".into());
    }
    let declared = set["runtimes"].as_object().ok_or("GChat Linux engine runtime map is missing")?;
    let expected = [("8.0", "sm80"), ("8.6", "sm86"), ("8.9", "sm89"), ("12.0", "sm120a")];
    if declared.len() != expected.len() { return Err("GChat Linux engine runtime map is incomplete".into()); }
    let mut runtimes = std::collections::BTreeMap::new();
    for (architecture, directory) in expected {
        if declared.get(architecture).and_then(|entry| entry.as_str()) != Some(directory) {
            return Err(format!("GChat Linux engine runtime map has an invalid {architecture} entry"));
        }
        runtimes.insert(architecture.into(), root.join(directory).join("bin/ginfer-serve"));
    }
    crate::engine_host::validate_runtimes(&runtimes)?;
    Ok(runtimes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};

    #[tokio::test]
    async fn managed_port_collision_preserves_foreign_listener_and_saved_endpoint() {
        let directory = tempfile::tempdir().unwrap();
        let host = crate::service::Host::open(directory.path().into(), "Own Host".into(),
            std::env::current_exe().unwrap(), vec![], vec![], vec![]).await.unwrap();
        let foreign = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let preferred = foreign.local_addr().unwrap();
        assert!(bind_management(preferred, false).await.is_err(), "Explicit standalone listeners stay fixed");
        let (own, notice) = bind_management(preferred, true).await.unwrap();
        let selected = own.local_addr().unwrap();
        assert_ne!(selected, preferred);
        assert!(notice.as_ref().unwrap().contains(&preferred.port().to_string()));
        let connection = tokio::net::TcpStream::connect(preferred).await.unwrap();
        let (_, peer) = tokio::time::timeout(Duration::from_secs(2), foreign.accept()).await.unwrap().unwrap();
        assert_eq!(peer, connection.local_addr().unwrap());
        host.data.lock().await.management_origin = Some(format!("https://{selected}"));
        host.save().await.unwrap();
        drop(own);
        let saved = management_address(directory.path(), preferred).unwrap();
        assert_eq!(saved, selected);
        let (reopened, notice) = bind_management(saved, true).await.unwrap();
        assert_eq!(reopened.local_addr().unwrap(), selected);
        assert!(notice.is_none());
        for invalid in ["http://127.0.0.1:17443", "https://192.0.2.1:17443", "https://127.0.0.1:17443/host", "https://user@127.0.0.1:17443"] {
            host.data.lock().await.management_origin = Some(invalid.into());
            host.save().await.unwrap();
            assert!(management_address(directory.path(), preferred).is_err(), "{invalid}");
        }
    }

    #[tokio::test]
    async fn copied_host_credentials_cannot_prove_another_data_roots_identity() {
        let directory = tempfile::tempdir().unwrap();
        let copied = tempfile::tempdir().unwrap();
        let host = crate::service::Host::open(directory.path().into(), "Original Host".into(),
            std::env::current_exe().unwrap(), vec![], vec![], vec![]).await.unwrap();
        host.enable_normal_stop(); // Exercise the platform seam over actual pinned TLS.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        host.data.lock().await.management_origin = Some(format!("https://{address}"));
        host.save().await.unwrap();
        let acceptor = host.data.lock().await.certificate.acceptor().unwrap();
        std::fs::copy(directory.path().join("host.json"), copied.path().join("host.json")).unwrap();
        let serving = host.clone();
        let server = tokio::spawn(async move {
            let mut connections = tokio::task::JoinSet::new();
            loop {
                tokio::select! {
                    Some(_) = connections.join_next(), if !connections.is_empty() => {},
                    socket = listener.accept() => {
                        let (socket, _) = socket.unwrap();
                        let acceptor = acceptor.clone();
                        let host = serving.clone();
                        connections.spawn(async move {
                            if let Ok(tls) = acceptor.accept(socket).await {
                                let service = hyper::service::service_fn(move |request| {
                                    let host = host.clone();
                                    async move { host.route(request).await }
                                });
                                let _ = hyper::server::conn::Http::new().serve_connection(tls, service).await;
                            }
                        });
                    }
                }
            }
        });
        let mut local = LocalHost {
            binary: std::env::current_exe().unwrap(), engine: std::env::current_exe().unwrap(),
            engine_runtimes: Default::default(), directory: copied.path().into(), desktop_provider: None,
            models: vec![], artifact_sets: vec![], name: "Fixture".into(), nvidia_smi: "unused".into(), listen: address,
        };
        let mut control = None;
        assert!(local.connect(&mut control).await.unwrap_err().contains("different data folder"));
        assert!(local.stop_if_idle().await.unwrap_err().contains("different data folder"));
        assert!(host.running_admission().await.is_ok(), "Copied authority cannot stop the original Host");
        local.directory = directory.path().join("not-created-by-stop");
        assert!(local.stop_if_idle().await.is_err());
        assert!(!local.directory.exists(), "Stop never bootstraps or creates local Host state");
        local.directory = directory.path().into();
        assert!(local.connect(&mut control).await.is_ok(), "The original Host remains reachable");
        let mut wrong_platform = host.snapshot().await;
        wrong_platform["local_identity"]["platform"] = serde_json::json!("another-platform");
        assert!(validate_local_identity(&local.directory, &wrong_platform).is_err());
        local.listen = "127.0.0.1:1".parse().unwrap();
        let response = local.stop_if_idle().await.unwrap();
        assert_eq!(response["stopping"], true, "Stop follows the persisted own endpoint");
        assert!(host.running_admission().await.is_err());
        server.abort();
        let _ = server.await;
    }

    #[tokio::test]
    async fn delayed_bootstrap_reuses_tls_only_with_fresh_local_authority() {
        let directory = tempfile::tempdir().unwrap();
        let host = crate::service::Host::open(directory.path().into(), "Delayed bootstrap".into(),
            std::env::current_exe().unwrap(), vec![], vec![], vec![]).await.unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let acceptor = host.data.lock().await.certificate.acceptor().unwrap();
        let requests = Arc::new(AtomicUsize::new(0));
        let connections = Arc::new(AtomicUsize::new(0));
        let server_requests = requests.clone();
        let server_connections = connections.clone();
        let serving_host = host.clone();
        let server = tokio::spawn(async move {
            let mut connections = tokio::task::JoinSet::new();
            loop {
                tokio::select! {
                    Some(_) = connections.join_next(), if !connections.is_empty() => {},
                    socket = listener.accept() => {
                        let (socket, _) = socket.unwrap();
                        server_connections.fetch_add(1, Ordering::SeqCst);
                        let acceptor = acceptor.clone();
                        let requests = server_requests.clone();
                        let host = serving_host.clone();
                        connections.spawn(async move {
                            if let Ok(tls) = acceptor.accept(socket).await {
                                let service = hyper::service::service_fn(move |request| {
                                    let host = host.clone();
                                    let waiting = requests.fetch_add(1, Ordering::SeqCst) < 4;
                                    async move {
                                        if waiting {
                                            Ok::<_, std::convert::Infallible>(hyper::Response::builder().status(503)
                                                .body(hyper::Body::from(r#"{"error":"starting"}"#)).unwrap())
                                        } else { host.route(request).await }
                                    }
                                });
                                let _ = hyper::server::conn::Http::new().serve_connection(tls, service).await;
                            }
                        });
                    }
                }
            }
        });
        let local = LocalHost {
            binary: std::env::current_exe().unwrap(), engine: std::env::current_exe().unwrap(),
            engine_runtimes: Default::default(), directory: directory.path().into(), desktop_provider: None,
            models: vec![], artifact_sets: vec![], name: "Fixture".into(), nvidia_smi: "unused".into(), listen: address,
        };
        let owner = ServiceOwner::acquire(directory.path()).unwrap();
        let before = crate::launcher::control_work_counts();
        let control = tokio::time::timeout(Duration::from_secs(2), local.ensure_running()).await.unwrap().unwrap();
        let after_candidate = crate::launcher::control_work_counts();
        assert_eq!((after_candidate.0 - before.0, after_candidate.1 - before.1), (5, 1));
        assert_eq!(connections.load(Ordering::SeqCst), 1);
        assert_eq!(control.host_id(), host.data.lock().await.host_id);
        assert!(ServiceOwner::acquire(directory.path()).is_err());
        let mut cached = Some(control);
        host.data.lock().await.pairing_admin_token = "rotated local authority".into();
        host.save().await.unwrap();
        assert!(local.connect(&mut cached).await.is_ok(), "rotation must use the new token");
        assert_eq!(crate::launcher::control_work_counts().1, after_candidate.1 + 1);
        host.data.lock().await.host_id = uuid::Uuid::new_v4();
        host.save().await.unwrap();
        let snapshot = local.connect(&mut cached).await.unwrap();
        assert_eq!(snapshot["host_id"].as_str(), Some(cached.as_ref().unwrap().host_id().to_string().as_str()));
        assert_eq!(crate::launcher::control_work_counts().1, after_candidate.1 + 2);
        // A freshly changed pin must discard even a live pooled TLS connection.
        host.data.lock().await.certificate = crate::transport::HostCertificate::generate().unwrap();
        host.save().await.unwrap();
        assert!(local.connect(&mut cached).await.is_err());
        assert_eq!(crate::launcher::control_work_counts().1, after_candidate.1 + 3);
        std::fs::write(directory.path().join("host.json"), b"invalid state").unwrap();
        assert!(local.connect(&mut cached).await.is_err());
        assert!(cached.is_none(), "invalid authority must discard the previous control");
        host.save().await.unwrap();
        assert!(local.connect(&mut cached).await.is_err());
        assert_eq!(crate::launcher::control_work_counts().1, after_candidate.1 + 4);
        drop(owner);
        server.abort();
        let _ = server.await;
    }

    #[tokio::test]
    async fn delayed_bootstrap_resource_pass() {
        let directory = tempfile::tempdir().unwrap();
        let host = crate::service::Host::open(directory.path().into(), "Delayed bootstrap".into(),
            std::env::current_exe().unwrap(), vec![], vec![], vec![]).await.unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let acceptor = host.data.lock().await.certificate.acceptor().unwrap();
        let requests = Arc::new(AtomicUsize::new(0));
        let connections = Arc::new(AtomicUsize::new(0));
        let server_requests = requests.clone();
        let server_connections = connections.clone();
        let serving_host = host.clone();
        let server = tokio::spawn(async move {
            let mut connections = tokio::task::JoinSet::new();
            loop {
                tokio::select! {
                    Some(_) = connections.join_next(), if !connections.is_empty() => {},
                    socket = listener.accept() => {
                        let (socket, _) = socket.unwrap();
                        server_connections.fetch_add(1, Ordering::SeqCst);
                        let acceptor = acceptor.clone();
                        let requests = server_requests.clone();
                        let host = serving_host.clone();
                        connections.spawn(async move {
                            if let Ok(tls) = acceptor.accept(socket).await {
                                let service = hyper::service::service_fn(move |request| {
                                    let host = host.clone();
                                    let waiting = requests.fetch_add(1, Ordering::SeqCst) < 4;
                                    async move {
                                        if waiting {
                                            Ok::<_, std::convert::Infallible>(hyper::Response::builder().status(503)
                                                .body(hyper::Body::from(r#"{"error":"starting"}"#)).unwrap())
                                        } else { host.route(request).await }
                                    }
                                });
                                let _ = hyper::server::conn::Http::new().serve_connection(tls, service).await;
                            }
                        });
                    }
                }
            }
        });
        let local = LocalHost {
            binary: std::env::current_exe().unwrap(), engine: std::env::current_exe().unwrap(),
            engine_runtimes: Default::default(), directory: directory.path().into(), desktop_provider: None,
            models: vec![], artifact_sets: vec![], name: "Fixture".into(), nvidia_smi: "unused".into(), listen: address,
        };
        let owner = ServiceOwner::acquire(directory.path()).unwrap();
        let before = crate::launcher::control_work_counts();
        let start = std::time::Instant::now();
        let control = tokio::time::timeout(Duration::from_secs(2), local.ensure_running()).await.unwrap().unwrap();
        let candidate = start.elapsed();
        let after = crate::launcher::control_work_counts();
        assert_eq!(requests.load(Ordering::SeqCst), 5);
        assert_eq!(after.0 - before.0, 5);
        assert_eq!(control.host_id(), host.data.lock().await.host_id);
        assert!(ServiceOwner::acquire(directory.path()).is_err());
        eprintln!("RESOURCE_BOOTSTRAP attempts=5 elapsed={candidate:?} state_opens={} client_constructions={} tls_connections={}",
            after.0 - before.0, after.1 - before.1, connections.load(Ordering::SeqCst));
        drop(owner);
        server.abort();
        let _ = server.await;
    }
}
