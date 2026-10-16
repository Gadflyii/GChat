//! Desktop-only prerequisite checks. Never installs software without an explicit request.
use jan_utils::credential_store::{Reference, Zeroizing};
use serde_json::{json, Value};
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex;

async fn checked<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    static PROBE: OnceLock<Arc<Mutex<()>>> = OnceLock::new();
    let guard = PROBE.get_or_init(|| Arc::new(Mutex::new(()))).clone().try_lock_owned()
        .map_err(|_| "Secure storage is still waiting for its provider. Complete its unlock prompt, then retry.".to_string())?;
    let task = tokio::task::spawn_blocking(move || {
        // Keep serialization after a UI timeout until the provider returns.
        let _guard = guard;
        operation()
    });
    tokio::time::timeout(std::time::Duration::from_secs(30), task)
        .await
        .map_err(|_| {
            "Secure storage did not respond. Unlock the selected store and retry.".to_string()
        })?
        .map_err(|e| e.to_string())?
}
async fn probe() -> Result<(), String> {
    checked(|| {
        super::initialize_credentials()?
            .require_ready()
            .map_err(|e| e.to_string())
    })
    .await
}
#[cfg(target_os = "linux")]
fn installer() -> Option<(&'static str, &'static [&'static str])> {
    // Use only fixed absolute executables and fixed package arguments; no shell.
    if !std::path::Path::new("/usr/bin/pkexec").exists() {
        return None;
    }
    let release = std::fs::read_to_string("/etc/os-release").ok()?;
    let id = release
        .lines()
        .find_map(|line| line.strip_prefix("ID="))?
        .trim_matches('"');
    let plan: (&str, &[&str]) = match id {
        "ubuntu" | "debian" | "linuxmint" | "pop" => {
            ("/usr/bin/apt-get", &["install", "-y", "gnome-keyring"])
        }
        "fedora" => ("/usr/bin/dnf", &["install", "-y", "gnome-keyring"]),
        "arch" | "manjaro" => (
            "/usr/bin/pacman",
            &["-S", "--needed", "--noconfirm", "gnome-keyring"],
        ),
        "opensuse-tumbleweed" | "opensuse-leap" => (
            "/usr/bin/zypper",
            &["--non-interactive", "install", "gnome-keyring"],
        ),
        _ => return None,
    };
    std::path::Path::new(plan.0).exists().then_some(plan)
}

pub async fn status(check: bool) -> Value {
    let result = checked(move || {
        let store = super::initialize_credentials()?;
        let verified = check.then(|| store.require_ready());
        let mut status = store.status();
        if let Some(result) = verified {
            status.ready = result.is_ok();
            status.state = if result.is_ok() {
                "ready"
            } else {
                "unavailable"
            }
            .into();
            status.error = result.err().map(|error| error.to_string());
        }
        serde_json::to_value(status).map_err(|e| e.to_string())
    })
    .await;
    let mut value = result
        .unwrap_or_else(|error| json!({"ready": false, "state": "unavailable", "error": error}));
    #[cfg(target_os = "linux")]
    let can_install =
        installer().is_some() && !std::path::Path::new("/usr/bin/gnome-keyring-daemon").exists();
    #[cfg(not(target_os = "linux"))]
    let can_install = false;
    value["platform"] = json!(std::env::consts::OS);
    value["can_install"] = json!(can_install && value["tier"] != "passphrase");
    value
}

#[cfg(target_os = "linux")]
async fn references(root: &std::path::Path) -> Result<Vec<Reference>, String> {
    super::initialize_data_folder(root).await?;
    let hosts = super::client().view().await?;
    let mut references: Vec<_> = hosts
        .saved
        .values()
        .map(|host| {
            Reference::new(
                ginfer_host::client::VAULT_SERVICE,
                &host.client_id.to_string(),
            )
        })
        .collect();
    drop(hosts);
    let root = root.to_owned();
    references.extend(
        tokio::task::spawn_blocking(move || -> Result<Vec<Reference>, String> {
            let mut entries = crate::core::connectors::accounts::credential_references(&root)?;
            match std::fs::read(root.join("gbot/state.json")) {
                Ok(bytes) => {
                    let state: gbot_service::service::DurableState = serde_json::from_slice(&bytes)
                        .map_err(|_| {
                            "Invalid Gbot state; recover it before migrating credentials"
                        })?;
                    entries.push(Reference::new(
                        "app.gchat.gbot",
                        &state.service_id.to_string(),
                    ));
                    for workspace in state.workspaces {
                        if let gbot_service::contract::WorkspaceConnection::Ssh(ssh) =
                            workspace.connection
                        {
                            entries.push(Reference::new(
                                "app.gchat.gbot",
                                &ssh.credential_ref.as_uuid().to_string(),
                            ));
                        }
                    }
                    entries.extend(
                        state
                            .assignments
                            .into_iter()
                            .filter_map(|assignment| assignment.credential_ref)
                            .map(|reference| {
                                Reference::new("app.gchat.gbot", &reference.as_uuid().to_string())
                            }),
                    );
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(error) => return Err(error.to_string()),
            }
            Ok(entries)
        })
        .await
        .map_err(|e| e.to_string())??,
    );
    Ok(references)
}

#[cfg(target_os = "linux")]
pub async fn change(
    root: &std::path::Path,
    action: &str,
    mut arguments: Value,
) -> Result<Value, String> {
    let passphrase = arguments
        .as_object_mut()
        .and_then(|args| args.remove("passphrase"))
        .and_then(|value| match value {
            Value::String(value) => Some(Zeroizing::new(value)),
            _ => None,
        });
    match action {
        "credential_create" => {
            if arguments["confirmed"] != true {
                return Err("Creating or migrating a vault requires explicit confirmation".into());
            }
            let entries = references(root).await?;
            let secret = passphrase.as_ref().ok_or("Passphrase required")?.clone();
            checked(move || {
                super::initialize_credentials()?
                    .create_or_migrate(secret.as_bytes(), &entries)
                    .map_err(|e| e.to_string())
            })
            .await?;
            if let Some(passphrase) = &passphrase {
                crate::core::gbot::credential_control(root, "unlock", Some(passphrase)).await?;
            }
        }
        "credential_unlock" => {
            let secret = passphrase.as_ref().ok_or("Passphrase required")?.clone();
            checked(move || {
                super::initialize_credentials()?
                    .unlock(secret.as_bytes())
                    .map_err(|e| e.to_string())
            })
            .await?;
            crate::core::gbot::credential_control(
                root,
                "unlock",
                passphrase.as_deref().map(String::as_str),
            )
            .await?;
        }
        "credential_lock" => {
            let service_result = crate::core::gbot::credential_control(root, "lock", None).await;
            checked(|| {
                super::initialize_credentials()?
                    .lock()
                    .map_err(|e| e.to_string())
            })
            .await?;
            service_result?;
        }
        _ => return Err("Unknown credential operation".into()),
    }
    Ok(status(false).await)
}

pub async fn require_ready() -> Result<(), String> {
    probe().await.map_err(|e| format!("Secure credential storage is unavailable. Set up or unlock secure storage in Engines before pairing. {e}"))
}

pub async fn install(confirmed: bool) -> Result<Value, String> {
    if !confirmed {
        return Err("Installing secure storage requires your approval".into());
    }
    #[cfg(target_os = "linux")]
    {
        static INSTALL: OnceLock<Mutex<()>> = OnceLock::new();
        let _guard = INSTALL
            .get_or_init(|| Mutex::new(()))
            .try_lock()
            .map_err(|_| "Secure storage installation is already running")?;
        // Preserve an existing functional provider, including non-GNOME providers.
        if probe().await.is_ok() {
            return Ok(json!({"installed": false}));
        }
        if std::path::Path::new("/usr/bin/gnome-keyring-daemon").exists() {
            return Err("A keyring is already installed. Unlock it, or sign out and back in, then check again.".into());
        }
        let (program, args) = installer().ok_or("Automatic installation is unavailable. Install a Secret Service provider using your system software manager.")?;
        let output = tokio::process::Command::new("/usr/bin/pkexec")
            .arg(program)
            .args(args)
            .stdin(std::process::Stdio::null())
            .output()
            .await
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "Secure storage installation was cancelled or failed ({}). {}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Ok(json!({"installed": true}))
    }
    #[cfg(not(target_os = "linux"))]
    Err("Secure storage installation is only offered on Linux".into())
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn installation_requires_explicit_approval() {
        assert!(super::install(false)
            .await
            .unwrap_err()
            .contains("approval"));
    }
}
