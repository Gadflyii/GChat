use serde::Serialize;
use std::{
    path::PathBuf,
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::ipc::Channel;

static UPDATING: AtomicBool = AtomicBool::new(false);
const UPDATE_ARGS: &[&str] = &["update", "--yes", "--keep-stash", "--no-gateway-restart"];

struct UpdateGuard;
impl Drop for UpdateGuard {
    fn drop(&mut self) {
        UPDATING.store(false, Ordering::Release);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesUpdateResult {
    log_path: String,
}

fn command(executable: &std::path::Path) -> Command {
    let mut cmd = Command::new(executable);
    super::commands::apply_login_path(&mut cmd);
    super::commands::apply_runtime_path(&mut cmd);
    cmd.stdin(Stdio::null()).env("NO_COLOR", "1");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd
}

fn run_update(
    executable: PathBuf,
    directory: PathBuf,
    managed: bool,
    progress: impl Fn(&str),
) -> Result<HermesUpdateResult, String> {
    progress("Preparing update");
    let config_path = directory.join("config.yaml");
    if config_path.is_file() {
        let config: serde_yaml::Value =
            serde_yaml::from_str(&std::fs::read_to_string(config_path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("Hermes settings could not be read: {e}"))?;
        if config["updates"]["non_interactive_local_changes"]
            .as_str()
            .is_some_and(|mode| mode.eq_ignore_ascii_case("discard"))
        {
            return Err("Hermes is configured to discard local customizations during updates. Change that setting to preserve them before updating from GChat.".into());
        }
    }
    #[cfg(windows)]
    if managed {
        super::hermes_runtime::repair_managed_runtime(&directory)?;
    }
    #[cfg(not(windows))]
    let _ = managed;
    let help = command(&executable)
        .args(["update", "--help"])
        .output()
        .map_err(|e| format!("Could not start Hermes: {e}"))?;
    let help_text = String::from_utf8_lossy(&help.stdout);
    if !help.status.success() || !UPDATE_ARGS[1..].iter().all(|flag| help_text.contains(flag)) {
        return Err("This Hermes version does not support safe background updates. Repair or reinstall Hermes before updating.".into());
    }
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let log_path = directory.join("gchat-update.log");
    let log = std::fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let stderr = log.try_clone().map_err(|e| e.to_string())?;
    progress("Downloading and installing updates");
    // Upstream parks source edits; GChat themes and user data live outside the checkout.
    let status = command(&executable)
        .args(UPDATE_ARGS)
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr))
        .status()
        .map_err(|e| format!("Could not run the updater: {e}"))?;
    if !status.success() {
        return Err(format!("Hermes could not finish updating. Close other Hermes sessions and retry. Diagnostic log: {}", log_path.display()));
    }
    progress("Checking Hermes runtime");
    #[cfg(windows)]
    if managed {
        super::hermes_runtime::repair_managed_runtime(&directory)?;
    }
    let check = command(&executable)
        .arg("--version")
        .output()
        .map_err(|e| e.to_string())?;
    if !check.status.success() {
        return Err(format!(
            "The update finished, but Hermes did not pass its startup check. Diagnostic log: {}",
            log_path.display()
        ));
    }
    Ok(HermesUpdateResult {
        log_path: log_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn update_hermes(
    custom_path: Option<String>,
    on_progress: Channel<String>,
) -> Result<HermesUpdateResult, String> {
    if UPDATING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("Hermes is already updating.".into());
    }
    let guard = UpdateGuard;
    tokio::task::spawn_blocking(move || {
        let _guard = guard;
        let directory = super::commands::resolve_hermes_dir()?;
        let custom = custom_path.filter(|path| !path.trim().is_empty());
        let managed = custom.is_none();
        let executable = if let Some(path) = custom {
            let path = PathBuf::from(path);
            if !path.is_absolute() || !path.is_file() {
                return Err("The custom Hermes executable must be an absolute file path.".into());
            }
            path
        } else {
            #[cfg(windows)]
            {
                directory.join("bin/hermes.exe")
            }
            #[cfg(not(windows))]
            {
                PathBuf::from("hermes")
            }
        };
        run_update(executable, directory, managed, |phase| {
            let _ = on_progress.send(phase.into());
        })
    })
    .await
    .map_err(|e| format!("Hermes updater stopped: {e}"))?
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn fixture(script: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("hermes");
        std::fs::write(&exe, format!("#!/bin/sh\n{script}")).unwrap();
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o700)).unwrap();
        (dir, exe)
    }

    #[test]
    fn background_update_has_no_prompt_and_checks_runtime() {
        let (dir, exe) = fixture(
            r#"
if [ "$2" = '--help' ]; then echo '--yes --keep-stash --no-gateway-restart'; exit 0; fi
if [ "$1" = '--version' ]; then echo 'Hermes test'; exit 0; fi
[ "$*" = 'update --yes --keep-stash --no-gateway-restart' ] || exit 4
read answer && exit 5
echo 'private updater output'
echo 'private stderr' >&2
exit 0
"#,
        );
        let phases = std::sync::Mutex::new(Vec::new());
        let result = run_update(exe, dir.path().into(), false, |phase| {
            phases.lock().unwrap().push(phase.to_owned())
        })
        .unwrap();
        let log = std::fs::read_to_string(result.log_path).unwrap();
        assert!(log.contains("private updater output"));
        assert!(log.contains("private stderr"));
        assert_eq!(
            phases.lock().unwrap().last().unwrap(),
            "Checking Hermes runtime"
        );
    }

    #[test]
    fn failed_update_and_failed_startup_never_report_success() {
        for script in [
            "if [ \"$2\" = '--help' ]; then echo '--yes --keep-stash --no-gateway-restart'; exit 0; fi\nexit 7",
            "if [ \"$2\" = '--help' ]; then echo '--yes --keep-stash --no-gateway-restart'; exit 0; fi\n[ \"$1\" != '--version' ]",
        ] {
            let (dir, exe) = fixture(script);
            assert!(run_update(exe, dir.path().into(), false, |_| {}).unwrap_err().contains("Diagnostic log:"));
        }
    }

    #[test]
    fn refuses_unsafe_policy_or_missing_noninteractive_support() {
        let (dir, exe) = fixture("echo old-updater");
        assert!(run_update(exe.clone(), dir.path().into(), false, |_| {}).is_err());
        std::fs::write(
            dir.path().join("config.yaml"),
            "updates:\n  non_interactive_local_changes: discard\n",
        )
        .unwrap();
        assert!(run_update(exe, dir.path().into(), false, |_| {})
            .unwrap_err()
            .contains("discard"));
        assert!(!dir.path().join("gchat-update.log").exists());
    }
}
