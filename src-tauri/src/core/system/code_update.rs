use serde::Serialize;
use std::{
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{ipc::Channel, AppHandle, Runtime};

use super::{
    commands::ProxyEnv,
    opencode_runtime::{self, OpenCodeOwnership, ResolvedOpenCode},
};

static UPDATING: AtomicBool = AtomicBool::new(false);
struct UpdateGuard;
impl Drop for UpdateGuard {
    fn drop(&mut self) {
        UPDATING.store(false, Ordering::Release);
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CodeUpdateResult {
    Updated {
        #[serde(rename = "logPath")]
        log_path: String,
    },
    External {
        command: String,
    },
}

fn manual_update_command(executable: &Path) -> String {
    opencode_runtime::shell_invocation(executable, &["upgrade"])
}

fn external_update(resolved: ResolvedOpenCode) -> Option<CodeUpdateResult> {
    (resolved.ownership != OpenCodeOwnership::Managed).then(|| CodeUpdateResult::External {
        command: manual_update_command(&resolved.executable),
    })
}

fn prepare_update(
    data: &Path,
    custom_path: Option<&str>,
    use_managed_copy: bool,
) -> Result<Option<CodeUpdateResult>, String> {
    if use_managed_copy {
        return Ok(None);
    }
    Ok(opencode_runtime::resolve(data, custom_path)?.and_then(external_update))
}

#[tauri::command]
pub async fn update_code<R: Runtime>(
    app: AppHandle<R>,
    custom_path: Option<String>,
    use_managed_copy: Option<bool>,
    proxy: Option<ProxyEnv>,
    on_progress: Channel<String>,
) -> Result<CodeUpdateResult, String> {
    let data = crate::core::app::commands::get_jan_data_folder_path(app);
    if UPDATING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("Code is already updating.".into());
    }
    let guard = UpdateGuard;
    let selected_data = data.clone();
    if let Some(external) = tokio::task::spawn_blocking(move || {
        prepare_update(
            &selected_data,
            custom_path.as_deref(),
            use_managed_copy.unwrap_or(false),
        )
    })
    .await
    .map_err(|error| format!("Could not find Code: {error}"))??
    {
        // External installations remain under the user's control. In particular,
        // do not fetch a release or run an installer before explicit adoption.
        return Ok(external);
    }
    let _ = on_progress.send("Checking for updates".into());
    let mut client = reqwest::Client::builder();
    if let Some(proxy) = proxy.as_ref().filter(|proxy| !proxy.url.trim().is_empty()) {
        let mut configured = reqwest::Proxy::all(proxy.url.trim()).map_err(|error| {
            format!("Check the app's proxy address, then retry. Details: {error}")
        })?;
        if let Some(username) = proxy.username.as_deref().filter(|value| !value.is_empty()) {
            configured = configured.basic_auth(username, proxy.password.as_deref().unwrap_or(""));
        }
        if let Some(no_proxy) = proxy.no_proxy.as_deref() {
            configured = configured.no_proxy(reqwest::NoProxy::from_string(no_proxy));
        }
        client = client.proxy(configured);
    }
    let release: serde_json::Value = client
        .build()
        .map_err(|error| error.to_string())?
        .get("https://registry.npmjs.org/opencode-ai/latest")
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|error| format!("Could not check for Code updates: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Could not check for Code updates: {error}"))?
        .json()
        .await
        .map_err(|error| error.to_string())?;
    let target = release["version"]
        .as_str()
        .filter(|version| !version.is_empty())
        .ok_or("The Code release has no version.")?
        .to_owned();
    tokio::task::spawn_blocking(move || {
        let _guard = guard;
        let _ = on_progress.send("Downloading and installing Code in GChat's data folder".into());
        opencode_runtime::install_managed(
            &data,
            Some(&target),
            proxy.as_ref(),
            "gchat-update.log",
            |line| {
                let _ = on_progress.send(line.into());
            },
        )?;
        Ok(CodeUpdateResult::Updated {
            log_path: super::opencode_config::config_directory(&data)
                .join("gchat-update.log")
                .to_string_lossy()
                .into_owned(),
        })
    })
    .await
    .map_err(|error| format!("Code updater stopped: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_update_is_a_manual_command_without_mutating_the_installation() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("selected data");
        let executable = dir.path().join("user's code");
        std::fs::write(&executable, "external installation, never run by GChat").unwrap();
        let result = prepare_update(&data, executable.to_str(), false)
            .unwrap()
            .unwrap();
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["kind"], "external");
        assert_eq!(value["command"], manual_update_command(&executable));
        assert_eq!(
            std::fs::read_to_string(&executable).unwrap(),
            "external installation, never run by GChat"
        );
        assert!(!data.exists());
        assert!(external_update(ResolvedOpenCode {
            executable,
            ownership: OpenCodeOwnership::Native
        })
        .is_some());
    }

    #[test]
    fn only_explicit_adoption_bypasses_an_invalid_authoritative_custom_path() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("selected data");
        assert!(prepare_update(&data, Some("missing custom code"), false).is_err());
        assert!(prepare_update(&data, Some("missing custom code"), true)
            .unwrap()
            .is_none());
        assert!(!data.exists());
    }

    #[test]
    fn managed_update_retains_the_selected_root_and_returns_the_typed_log_result() {
        let dir = tempfile::tempdir().unwrap();
        let executable = opencode_runtime::managed_executable(dir.path());
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, "managed").unwrap();
        std::fs::write(dir.path().join("code/opencode/runtime/.gchat-verified"), "1.2.3").unwrap();
        assert!(prepare_update(dir.path(), None, false).unwrap().is_none());
        let result = CodeUpdateResult::Updated {
            log_path: "selected data/code/opencode/gchat-update.log".into(),
        };
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({
                "kind": "updated", "logPath": "selected data/code/opencode/gchat-update.log"
            })
        );
    }

    #[test]
    fn manual_commands_quote_user_paths() {
        let command = manual_update_command(Path::new("/users/it's code/$tool"));
        if cfg!(windows) {
            assert_eq!(command, "& '/users/it''s code/$tool' 'upgrade'");
        } else {
            assert_eq!(command, "'/users/it'\\''s code/$tool' 'upgrade'");
        }
    }
}
