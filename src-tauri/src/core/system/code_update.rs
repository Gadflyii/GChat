use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::ipc::Channel;

static UPDATING: AtomicBool = AtomicBool::new(false);
struct UpdateGuard;
impl Drop for UpdateGuard {
    fn drop(&mut self) {
        UPDATING.store(false, Ordering::Release);
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeUpdateResult {
    log_path: String,
}

fn command(executable: &Path, args: &[&str], directory: &Path) -> Command {
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let literal = |s: &str| format!("'{}'", s.replace('\'', "''"));
        let mut cmd = Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command"])
            .arg(format!(
                "& {} {}; exit $LASTEXITCODE",
                literal(&executable.to_string_lossy()),
                args.iter()
                    .map(|s| literal(s))
                    .collect::<Vec<_>>()
                    .join(" ")
            ))
            .creation_flags(0x08000000);
        cmd
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut cmd = Command::new(executable);
        cmd.args(args);
        cmd
    };
    super::commands::apply_login_path(&mut cmd);
    super::commands::apply_runtime_path(&mut cmd);
    cmd.current_dir(directory)
        .stdin(Stdio::null())
        .env("NO_COLOR", "1");
    cmd
}

fn run_update(
    executable: &Path,
    directory: &Path,
    target: &str,
    progress: impl Fn(&str),
) -> Result<CodeUpdateResult, String> {
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let log_path = directory.join("gchat-update.log");
    let log = std::fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let stderr = log.try_clone().map_err(|e| e.to_string())?;
    progress("Downloading and installing updates");
    let status = command(executable, &["upgrade", target], directory)
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr))
        .status()
        .map_err(|e| format!("Could not start the Code updater: {e}"))?;
    if !status.success() {
        return Err(format!("Code could not finish updating. Close other Code sessions and retry. Diagnostic log: {}", log_path.display()));
    }
    progress("Checking Code version");
    let check = command(executable, &["--version"], directory)
        .output()
        .map_err(|e| e.to_string())?;
    // Upstream can return exit code zero after a failed upgrade.
    if !check.status.success()
        || String::from_utf8_lossy(&check.stdout)
            .trim()
            .trim_start_matches('v')
            != target
    {
        return Err(format!("Code did not reach the requested version. Retry the update; if it keeps failing, check installation permissions. Diagnostic log: {}", log_path.display()));
    }
    Ok(CodeUpdateResult {
        log_path: log_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn update_code(
    custom_path: Option<String>,
    on_progress: Channel<String>,
) -> Result<CodeUpdateResult, String> {
    if UPDATING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("Code is already updating.".into());
    }
    let guard = UpdateGuard;
    let _ = on_progress.send("Checking for updates".into());
    let release: serde_json::Value = reqwest::Client::new()
        .get("https://registry.npmjs.org/opencode-ai/latest")
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Could not check for Code updates: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Could not check for Code updates: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let target = release["version"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("The Code release has no version.")?
        .to_owned();
    tokio::task::spawn_blocking(move || {
        let _guard = guard;
        let home = dirs::home_dir().ok_or("The user home directory is unavailable.")?;
        let directory = super::opencode_config::config_directory(&home.to_string_lossy());
        let executable = if let Some(path) = custom_path.filter(|p| !p.trim().is_empty()) {
            let path = PathBuf::from(path);
            if !path.is_absolute() || !path.is_file() {
                return Err("The custom Code executable must be an absolute file path.".into());
            }
            path
        } else {
            PathBuf::from(if cfg!(windows) {
                "opencode.cmd"
            } else {
                "opencode"
            })
        };
        run_update(&executable, &directory, &target, |phase| {
            let _ = on_progress.send(phase.into());
        })
    })
    .await
    .map_err(|e| format!("Code updater stopped: {e}"))?
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn update_is_noninteractive_and_requires_the_requested_version() {
        for (version, exit, success) in
            [("1.2.3", 0, true), ("1.2.2", 0, false), ("1.2.3", 7, false)]
        {
            let dir = tempfile::tempdir().unwrap();
            let exe = dir.path().join("code");
            std::fs::write(&exe, format!("#!/bin/sh\nif [ \"$1\" = '--version' ]; then echo '{version}'; exit 0; fi\n[ \"$*\" = 'upgrade 1.2.3' ] || exit 8\nread answer && exit 9\necho 'private update log'\nexit {exit}\n")).unwrap();
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o700)).unwrap();
            assert_eq!(
                run_update(&exe, dir.path(), "1.2.3", |_| {}).is_ok(),
                success
            );
            assert!(std::fs::read_to_string(dir.path().join("gchat-update.log"))
                .unwrap()
                .contains("private update log"));
        }
    }
}
