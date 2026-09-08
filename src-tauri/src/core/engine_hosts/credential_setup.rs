//! Desktop-only prerequisite checks. Never installs software without an explicit request.
use serde_json::{json, Value};
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex;
use uuid::Uuid;

async fn probe() -> Result<(), String> {
    static PROBE: OnceLock<Arc<Mutex<()>>> = OnceLock::new();
    let guard = PROBE.get_or_init(|| Arc::new(Mutex::new(()))).clone().try_lock_owned()
        .map_err(|_| "A secure storage check is still waiting for your keyring. Complete its unlock prompt, then check again.".to_string())?;
    let task = tokio::task::spawn_blocking(move || {
        // Retain the guard even if the UI times out: retry must not accumulate
        // blocked native vault operations or additional unlock prompts.
        let _guard = guard;
        let id = format!("setup-check-{}", Uuid::new_v4());
        let value = Uuid::new_v4().to_string();
        let entry = keyring::Entry::new("app.gchat.ginfer-host", &id).map_err(|e| e.to_string())?;
        entry.set_password(&value).map_err(|e| e.to_string())?;
        let read = entry.get_password().map_err(|e| e.to_string());
        let cleanup = entry.delete_credential().map_err(|e| e.to_string());
        cleanup?;
        if read? != value { return Err("Secure storage returned an unexpected value".into()); }
        Ok(())
    });
    // A locked provider may display its own unlock dialog. Keep the UI responsive.
    let result = tokio::time::timeout(std::time::Duration::from_secs(30), task).await
        .map_err(|_| "Secure storage did not respond. Unlock your keyring and check again.".to_string())?
        .map_err(|e| e.to_string())?;
    result
}

#[cfg(target_os = "linux")]
fn installer() -> Option<(&'static str, &'static [&'static str])> {
    // Use only fixed absolute executables and fixed package arguments; no shell.
    if !std::path::Path::new("/usr/bin/pkexec").exists() { return None; }
    let release = std::fs::read_to_string("/etc/os-release").ok()?;
    let id = release.lines().find_map(|line| line.strip_prefix("ID="))?.trim_matches('"');
    let plan: (&str, &[&str]) = match id {
        "ubuntu" | "debian" | "linuxmint" | "pop" => ("/usr/bin/apt-get", &["install", "-y", "gnome-keyring"]),
        "fedora" => ("/usr/bin/dnf", &["install", "-y", "gnome-keyring"]),
        "arch" | "manjaro" => ("/usr/bin/pacman", &["-S", "--needed", "--noconfirm", "gnome-keyring"]),
        "opensuse-tumbleweed" | "opensuse-leap" => ("/usr/bin/zypper", &["--non-interactive", "install", "gnome-keyring"]),
        _ => return None,
    };
    std::path::Path::new(plan.0).exists().then_some(plan)
}

pub async fn status() -> Value {
    let result = probe().await;
    #[cfg(target_os = "linux")]
    let can_install = installer().is_some() && !std::path::Path::new("/usr/bin/gnome-keyring-daemon").exists();
    #[cfg(not(target_os = "linux"))]
    let can_install = false;
    json!({ "ready": result.is_ok(), "platform": std::env::consts::OS,
        "can_install": can_install, "error": result.err() })
}

pub async fn require_ready() -> Result<(), String> {
    probe().await.map_err(|e| format!("Secure credential storage is unavailable. Set up or unlock secure storage in Engines before pairing. {e}"))
}

pub async fn install(confirmed: bool) -> Result<Value, String> {
    if !confirmed { return Err("Installing secure storage requires your approval".into()); }
    #[cfg(target_os = "linux")]
    {
        static INSTALL: OnceLock<Mutex<()>> = OnceLock::new();
        let _guard = INSTALL.get_or_init(|| Mutex::new(())).try_lock()
            .map_err(|_| "Secure storage installation is already running")?;
        // Preserve an existing functional provider, including non-GNOME providers.
        if probe().await.is_ok() { return Ok(json!({"installed": false})); }
        if std::path::Path::new("/usr/bin/gnome-keyring-daemon").exists() {
            return Err("A keyring is already installed. Unlock it, or sign out and back in, then check again.".into());
        }
        let (program, args) = installer().ok_or("Automatic installation is unavailable. Install a Secret Service provider using your system software manager.")?;
        let output = tokio::process::Command::new("/usr/bin/pkexec").arg(program).args(args)
            .stdin(std::process::Stdio::null()).output().await.map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!("Secure storage installation was cancelled or failed ({}). {}", output.status, String::from_utf8_lossy(&output.stderr)));
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
        assert!(super::install(false).await.unwrap_err().contains("approval"));
    }
}
