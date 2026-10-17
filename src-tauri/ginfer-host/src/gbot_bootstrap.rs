//! Shared bootstrap for the user-owned Gbot process; discovery never contains secrets.
use crate::service_owner::ServiceOwner;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use uuid::Uuid;

pub fn credential_store() -> Result<&'static jan_utils::credential_store::Store, String> {
    let registry = crate::local_host_registry::locator_path()?;
    jan_utils::credential_store::initialize(registry.parent().ok_or("Host registry root missing")?)
        .map_err(|e| e.to_string())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bootstrap {
    pub data_folder: PathBuf,
    pub executable: PathBuf,
    pub resources: PathBuf,
    pub appimage_resources: Option<PathBuf>,
}
impl Bootstrap {
    pub fn arguments(&self) -> Vec<OsString> {
        let mut args = vec![
            "--gbot-service".into(),
            "--data-folder".into(),
            self.data_folder.as_os_str().to_owned(),
        ];
        if let Some(relative) = &self.appimage_resources {
            args.extend([
                "--appimage-resources".into(),
                relative.as_os_str().to_owned(),
            ]);
        } else {
            args.extend(["--resources".into(), self.resources.as_os_str().to_owned()]);
        }
        args
    }
    pub fn capture(root: &Path, resources: &Path) -> Result<Self, String> {
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        let appimage_resources = None;
        #[cfg(target_os = "linux")]
        let (executable, appimage_resources) = if let Some(appimage) = std::env::var_os("APPIMAGE")
        {
            let appdir = std::env::var_os("APPDIR").ok_or("AppImage resource owner missing")?;
            let relative = resources
                .strip_prefix(Path::new(&appdir))
                .map_err(|_| "Gbot resources outside AppImage")?
                .to_path_buf();
            (appimage.into(), Some(relative))
        } else {
            (executable, appimage_resources)
        };
        let value = Self {
            data_folder: root.into(),
            executable,
            resources: resources.into(),
            appimage_resources,
        };
        value.validate()?;
        Ok(value)
    }
    pub fn validate(&self) -> Result<(), String> {
        if !self.data_folder.is_absolute()
            || !self.executable.is_absolute()
            || !self.resources.is_absolute()
            || self.appimage_resources.as_ref().is_some_and(|p| {
                p.components()
                    .any(|c| !matches!(c, std::path::Component::Normal(_)))
            })
        {
            return Err(
                "Gbot requires absolute installed paths and a relative AppImage resource path"
                    .into(),
            );
        }
        Ok(())
    }
}
pub fn request_method(path: &str) -> reqwest::Method {
    if matches!(
        path,
        "/v1/state"
            | "/v1/tasks"
            | "/v1/tasks/approvals"
            | "/v1/schedules"
            | "/v1/assignments/models"
    ) {
        reqwest::Method::GET
    } else {
        reqwest::Method::POST
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Discovery {
    pub service_id: uuid::Uuid,
    pub endpoint: std::net::SocketAddr,
    pub data_folder: PathBuf,
}

#[derive(Clone)]
pub struct LocalClient {
    endpoint: std::net::SocketAddr,
    token: Arc<jan_utils::credential_store::Zeroizing<Vec<u8>>>,
    http: reqwest::Client,
}

impl LocalClient {
    pub async fn call(&self, path: &str, body: Value) -> Result<Value, String> {
        if matches!(path, "/v1/tasks/start" | "/v1/tasks/resume")
            && body.get("assignment").is_some()
        {
            return Err("Bot tasks use this bot's saved model assignment".into());
        }
        let url = format!("http://{}{path}", self.endpoint);
        let request = self.http.request(request_method(path), url).json(&body);
        let token = std::str::from_utf8(&self.token).map_err(|_| "Invalid service credential")?;
        let response = request
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| "Gbot service connection lost; reconnect to the service")?;
        let status = response.status();
        let value: Value = response
            .json()
            .await
            .map_err(|_| "Invalid Gbot service response")?;
        if status.is_success() {
            Ok(value)
        } else {
            Err(format!(
                "{} {}",
                value["error"]["message"]
                    .as_str()
                    .unwrap_or("Gbot request failed"),
                value["error"]["next_action"].as_str().unwrap_or("")
            )
            .trim()
            .to_owned())
        }
    }
}

pub fn view_close_request(open: &Value, lease: Uuid) -> Value {
    serde_json::json!({"identity":open["identity"],"owner":open["owner"],"lease_id":lease})
}

pub async fn connect(root: &Path) -> Result<LocalClient, String> {
    let discovery: Discovery = serde_json::from_slice(
        &tokio::fs::read(root.join("gbot/service.json"))
            .await
            .map_err(|_| "Gbot service is not running")?,
    )
    .map_err(|_| "Invalid Gbot service discovery")?;
    if discovery.data_folder != root
        || !discovery.endpoint.ip().is_loopback()
        || discovery.endpoint.port() == 0
    {
        return Err("Gbot service uses a different data folder or nonlocal endpoint".into());
    }
    let token = credential_store()?
        .get("app.gchat.gbot", &discovery.service_id.to_string())
        .map_err(|error| error.to_string())?
        .ok_or(
            "Gbot service credential is missing; unlock secure storage on the service computer",
        )?;
    let client = LocalClient {
        endpoint: discovery.endpoint,
        token: Arc::new(token),
        http: reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(2))
            .build()
            .map_err(|_| "Gbot service client unavailable")?,
    };
    let state = tokio::time::timeout(
        Duration::from_secs(2),
        client.call("/v1/state", Value::Null),
    )
    .await
    .map_err(|_| "Gbot service is not responding")??;
    if state["service_id"]
        != serde_json::to_value(discovery.service_id)
            .map_err(|_| "Invalid Gbot service identity")?
    {
        return Err("Gbot service identity differs from discovery".into());
    }
    Ok(client)
}

pub async fn ensure_running(bootstrap: &Bootstrap) -> Result<LocalClient, String> {
    bootstrap.validate()?;
    let root = &bootstrap.data_folder;
    if let Ok(client) = connect(root).await {
        return Ok(client);
    }
    let directory = root.join("gbot");
    let mut child = None;
    if let Ok(owner) = ServiceOwner::acquire(&directory) {
        let mut command = tokio::process::Command::new(&bootstrap.executable);
        command.args(bootstrap.arguments());
        #[cfg(target_os = "linux")]
        let session_key = {
            command.arg("--credential-session-stdin");
            credential_store()?
                .session_key()
                .map_err(|e| e.to_string())?
        };
        let mut options = std::fs::OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let log = options
            .open(directory.join("service.log"))
            .map_err(|error| error.to_string())?;
        command
            .stdin(Stdio::null())
            .stdout(Stdio::from(
                log.try_clone().map_err(|error| error.to_string())?,
            ))
            .stderr(Stdio::from(log))
            .kill_on_drop(false);
        #[cfg(target_os = "linux")]
        command.stdin(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.as_std_mut().process_group(0);
        }
        #[cfg(windows)]
        {
            command.creation_flags(0x00000008 | 0x00000200);
        }
        drop(owner);
        child = Some(
            command
                .spawn()
                .map_err(|error| format!("Could not start Gbot service: {error}"))?,
        );
        #[cfg(target_os = "linux")]
        if let Some(process) = child.as_mut() {
            use tokio::io::AsyncWriteExt;
            let mut input = process
                .stdin
                .take()
                .ok_or("Gbot credential channel unavailable")?;
            if let Some(key) = session_key {
                input
                    .write_all(&key)
                    .await
                    .map_err(|_| "Gbot credential channel closed")?;
            }
            input
                .shutdown()
                .await
                .map_err(|_| "Gbot credential channel closed")?;
        }
    }
    wait_for_service(root, child).await
}

/// The service writes its own failure reason as the last log line; show it so the
/// person sees why it stopped without opening the file.
fn last_log_reason(log: &Path) -> String {
    let Ok(text) = std::fs::read_to_string(log) else {
        return String::new();
    };
    let Some(line) = text
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
    else {
        return String::new();
    };
    let reason = line.strip_prefix("Gbot service failed: ").unwrap_or(line);
    format!(": {}", reason.chars().take(300).collect::<String>())
}

async fn wait_for_service(
    root: &Path,
    mut child: Option<tokio::process::Child>,
) -> Result<LocalClient, String> {
    let directory = root.join("gbot");
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    let mut exited = None;
    loop {
        if let Ok(client) = connect(root).await {
            if let Some(mut child) = child {
                tokio::spawn(async move {
                    let _ = child.wait().await;
                });
            }
            return Ok(client);
        }
        if let Some(process) = child.as_mut() {
            if let Some(status) = process.try_wait().map_err(|error| error.to_string())? {
                exited = Some(status);
                child = None;
            }
        }
        if let Some(status) = exited {
            // A concurrent starter may own the service after our child loses the lock.
            if let Ok(_owner) = ServiceOwner::acquire(&directory) {
                return Err(format!(
                    "Gbot service exited before becoming ready ({status}){}; see {}",
                    last_log_reason(&directory.join("service.log")),
                    directory.join("service.log").display()
                ));
            }
        }
        if tokio::time::Instant::now() >= deadline {
            if let Some(mut child) = child {
                tokio::spawn(async move {
                    let _ = child.wait().await;
                });
            }
            return Err(format!(
                "Gbot service did not become ready; see {}",
                directory.join("service.log").display()
            ));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn child_exit_is_reported_without_waiting_for_the_startup_timeout() {
        let root = tempfile::tempdir().unwrap();
        for code in [0, 17] {
            let child = tokio::process::Command::new("/bin/sh")
                .args(["-c", &format!("exit {code}")])
                .spawn()
                .unwrap();
            let result = tokio::time::timeout(
                Duration::from_secs(3),
                wait_for_service(root.path(), Some(child)),
            )
            .await
            .expect("Exited children must not wait for the 30-second readiness deadline");
            let error = result.err().expect("An exited service cannot be ready");
            assert!(error.contains(&format!("exit status: {code}")), "{error}");
            assert!(error.contains("service.log"), "{error}");
        }
    }

    #[tokio::test]
    async fn exit_error_shows_the_last_service_log_reason() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("gbot");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
            directory.join("service.log"),
            "old line\nGbot service failed: Gbot secure storage: Secure storage is unavailable\n\n",
        )
        .unwrap();
        let child = tokio::process::Command::new("/bin/sh")
            .args(["-c", "exit 1"])
            .spawn()
            .unwrap();
        let error = tokio::time::timeout(
            Duration::from_secs(3),
            wait_for_service(root.path(), Some(child)),
        )
        .await
        .unwrap()
        .err()
        .unwrap();
        assert!(
            error.contains(
                "(exit status: 1): Gbot secure storage: Secure storage is unavailable; see "
            ),
            "{error}"
        );
        assert!(!error.contains("old line"), "{error}");
    }

    #[tokio::test]
    async fn a_losing_child_keeps_waiting_for_the_other_service_owner() {
        let root = tempfile::tempdir().unwrap();
        let owner = ServiceOwner::acquire(&root.path().join("gbot")).unwrap();
        let child = tokio::process::Command::new("/bin/sh")
            .args(["-c", "exit 17"])
            .spawn()
            .unwrap();
        let waiting = wait_for_service(root.path(), Some(child));
        tokio::pin!(waiting);
        assert!(
            tokio::time::timeout(Duration::from_millis(200), &mut waiting)
                .await
                .is_err()
        );
        drop(owner);
        let result = tokio::time::timeout(Duration::from_secs(3), waiting)
            .await
            .expect("Failure must be reported when no service owner remains");
        let error = result.err().expect("Neither service became ready");
        assert!(error.contains("exit status: 17"), "{error}");
    }
}
