//! Per-user Windows sign-in registration. The registry boundary is faked on Linux.
use ginfer_host::{gbot_bootstrap::Bootstrap, service::write_private};
use sha2::{Digest, Sha256};
use std::{ffi::OsStr, path::Path};

trait RunKey {
    fn get(&self, name: &str) -> Result<Option<String>, String>;
    fn set(&self, name: &str, command: Option<&str>) -> Result<(), String>;
}

pub(super) fn enabled(root: &Path) -> Result<bool, String> {
    match std::fs::read(root.join("gbot-login.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(windows)]
pub(super) fn configure(bootstrap: &Bootstrap, enabled: bool, local: bool) -> Result<(), String> {
    configure_with(bootstrap, enabled, local, &NativeRunKey)
}

#[cfg(windows)]
pub(super) fn reconcile(bootstrap: &Bootstrap, run: bool) -> Result<(), String> {
    reconcile_with(bootstrap, run, &NativeRunKey).map(|_| ())
}

#[cfg(windows)]
pub(super) fn relocate<T>(
    current: &Path,
    updated: &Bootstrap,
    commit: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    relocate_with(current, updated, &NativeRunKey, commit)
}

// App Data and the local Host locator commit together in the caller. Keep the
// old sign-in entry recoverable until that commit succeeds as well.
fn relocate_with<T>(
    current: &Path,
    updated: &Bootstrap,
    registry: &impl RunKey,
    commit: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let old_name = entry_name(current)?;
    let new_name = entry_name(&updated.data_folder)?;
    if old_name == new_name {
        return commit();
    }
    let old_command = registry.get(&old_name)?;
    let new_command = registry.get(&new_name)?;
    if new_command.is_some() {
        return Err("The new App Data folder already has a Gbot sign-in registration; choose another folder so that registration is not overwritten".into());
    }
    // Paired/disabled startup has no local entry to move. Preserve that state
    // without validating or enabling a new startup command.
    if old_command.is_none() {
        return commit();
    }
    let desired = command_line(updated)?;
    let restore = |error| {
        let error = rollback(registry, &old_name, old_command.as_deref(), error);
        rollback(registry, &new_name, new_command.as_deref(), error)
    };
    if let Err(error) = set_verified(registry, &new_name, Some(&desired)) {
        return Err(restore(error));
    }
    if let Err(error) = set_verified(registry, &old_name, None) {
        return Err(restore(error));
    }
    commit().map_err(restore)
}

fn configure_with(
    bootstrap: &Bootstrap,
    enabled: bool,
    local: bool,
    registry: &impl RunKey,
) -> Result<(), String> {
    let (name, prior) = reconcile_with(bootstrap, enabled && local, registry)?;
    if let Err(error) = write_private(
        &bootstrap.data_folder.join("gbot-login.json"),
        if enabled { b"true" } else { b"false" },
    ) {
        return Err(rollback(registry, &name, prior.as_deref(), error));
    }
    Ok(())
}

fn entry_name(root: &Path) -> Result<String, String> {
    if !root.is_absolute() {
        return Err("Gbot sign-in startup requires an absolute App Data path".into());
    }
    let root = root
        .to_str()
        .ok_or("Gbot sign-in paths must be valid Unicode")?;
    Ok(format!(
        "GChat-Gbot-{}",
        hex::encode(Sha256::digest(root.as_bytes()))
    ))
}

// Windows command-line quoting, without a shell or environment expansion.
fn quote(value: &OsStr) -> Result<String, String> {
    let value = value
        .to_str()
        .ok_or("Gbot sign-in paths must be valid Unicode")?;
    if value.chars().any(char::is_control) {
        return Err("Gbot sign-in paths cannot contain control characters".into());
    }
    let mut result = String::from("\"");
    let mut backslashes = 0;
    for character in value.chars() {
        if character == '\\' {
            backslashes += 1;
            continue;
        }
        let count = if character == '"' {
            backslashes * 2 + 1
        } else {
            backslashes
        };
        result.extend(std::iter::repeat_n('\\', count));
        result.push(character);
        backslashes = 0;
    }
    result.extend(std::iter::repeat_n('\\', backslashes * 2));
    result.push('"');
    Ok(result)
}

fn command_line(bootstrap: &Bootstrap) -> Result<String, String> {
    bootstrap.validate()?;
    let mut args = vec![quote(bootstrap.executable.as_os_str())?];
    args.extend(
        bootstrap
            .arguments()
            .iter()
            .map(|arg| quote(arg))
            .collect::<Result<Vec<_>, _>>()?,
    );
    let command = args.join(" ");
    // https://learn.microsoft.com/windows/win32/setupapi/run-and-runonce-registry-keys
    if command.encode_utf16().count() > 260 {
        return Err("Gbot sign-in startup command exceeds the Windows Run key's 260-character limit; use shorter installation and App Data paths".into());
    }
    Ok(command)
}

fn set_verified(registry: &impl RunKey, name: &str, command: Option<&str>) -> Result<(), String> {
    registry.set(name, command)?;
    if registry.get(name)?.as_deref() != command {
        return Err("Windows did not retain the requested Gbot sign-in registration".into());
    }
    Ok(())
}

fn rollback(registry: &impl RunKey, name: &str, prior: Option<&str>, error: String) -> String {
    match set_verified(registry, name, prior) {
        Ok(()) => error,
        Err(rollback) => {
            format!("{error}; could not restore the previous Gbot sign-in registration: {rollback}")
        }
    }
}

fn reconcile_with(
    bootstrap: &Bootstrap,
    run: bool,
    registry: &impl RunKey,
) -> Result<(String, Option<String>), String> {
    let name = entry_name(&bootstrap.data_folder)?;
    let desired = run.then(|| command_line(bootstrap)).transpose()?;
    let prior = registry.get(&name)?;
    if prior != desired {
        if let Err(error) = set_verified(registry, &name, desired.as_deref()) {
            return Err(rollback(registry, &name, prior.as_deref(), error));
        }
    }
    Ok((name, prior))
}

#[cfg(windows)]
struct NativeRunKey;

#[cfg(windows)]
impl RunKey for NativeRunKey {
    fn get(&self, name: &str) -> Result<Option<String>, String> {
        use winreg::{
            enums::{HKEY_CURRENT_USER, REG_SZ},
            types::FromRegValue,
            RegKey,
        };
        let read = || -> std::io::Result<String> {
            let value = RegKey::predef(HKEY_CURRENT_USER)
                .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")?
                .get_raw_value(name)?;
            if value.vtype != REG_SZ {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Gbot sign-in startup must be a REG_SZ command",
                ));
            }
            String::from_reg_value(&value)
        };
        match read() {
            Ok(command) => Ok(Some(command)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!(
                "Could not query Gbot Windows sign-in startup: {error}"
            )),
        }
    }

    fn set(&self, name: &str, command: Option<&str>) -> Result<(), String> {
        use winreg::{
            enums::{HKEY_CURRENT_USER, KEY_SET_VALUE},
            RegKey,
        };
        let current_user = RegKey::predef(HKEY_CURRENT_USER);
        let path = r"Software\Microsoft\Windows\CurrentVersion\Run";
        let result = if let Some(command) = command {
            current_user
                .create_subkey(path)
                .and_then(|(key, _)| key.set_value(name, &command))
        } else {
            current_user
                .open_subkey_with_flags(path, KEY_SET_VALUE)
                .and_then(|key| key.delete_value(name))
        };
        match result {
            Ok(()) => Ok(()),
            Err(error) if command.is_none() && error.kind() == std::io::ErrorKind::NotFound => {
                Ok(())
            }
            Err(error) => Err(format!(
                "Could not update Gbot Windows sign-in startup: {error}"
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::BTreeMap};

    #[derive(Default)]
    struct FakeRunKey {
        entries: RefCell<BTreeMap<String, String>>,
        fail: std::cell::Cell<bool>,
        fail_read: std::cell::Cell<bool>,
        ignore_write: std::cell::Cell<bool>,
        fail_remove_once: std::cell::Cell<bool>,
    }
    impl RunKey for FakeRunKey {
        fn get(&self, name: &str) -> Result<Option<String>, String> {
            if self.fail_read.get() {
                return Err("query denied".into());
            }
            Ok(self.entries.borrow().get(name).cloned())
        }
        fn set(&self, name: &str, command: Option<&str>) -> Result<(), String> {
            if self.fail.get() {
                return Err("access denied".into());
            }
            if self.ignore_write.get() {
                return Ok(());
            }
            if command.is_none() && self.fail_remove_once.replace(false) {
                return Err("removal denied".into());
            }
            let mut entries = self.entries.borrow_mut();
            if let Some(command) = command {
                entries.insert(name.into(), command.into());
            } else {
                entries.remove(name);
            }
            Ok(())
        }
    }

    fn bootstrap(root: &Path) -> Bootstrap {
        Bootstrap {
            data_folder: root.join("data folder"),
            executable: root.join("GChat.exe"),
            resources: root.join("resources"),
            appimage_resources: None,
        }
    }

    #[test]
    fn enable_query_disable_preserves_other_installations_and_exact_service_arguments() {
        let directory = tempfile::tempdir().unwrap();
        let bootstrap = bootstrap(directory.path());
        let registry = FakeRunKey::default();
        let other = entry_name(&directory.path().join("other data")).unwrap();
        registry
            .entries
            .borrow_mut()
            .insert(other.clone(), "keep".into());
        assert!(!enabled(&bootstrap.data_folder).unwrap());
        configure_with(&bootstrap, true, true, &registry).unwrap();
        let name = entry_name(&bootstrap.data_folder).unwrap();
        assert_eq!(
            registry.get(&name).unwrap(),
            Some(format!(
                "\"{}\" \"--gbot-service\" \"--data-folder\" \"{}\" \"--resources\" \"{}\"",
                bootstrap.executable.display(),
                bootstrap.data_folder.display(),
                bootstrap.resources.display()
            ))
        );
        assert!(enabled(&bootstrap.data_folder).unwrap());
        configure_with(&bootstrap, false, true, &registry).unwrap();
        configure_with(&bootstrap, false, true, &registry).unwrap();
        assert_eq!(registry.get(&name).unwrap(), None);
        assert!(!enabled(&bootstrap.data_folder).unwrap());
        assert_eq!(registry.get(&other).unwrap().as_deref(), Some("keep"));
    }

    #[test]
    fn paired_service_removes_local_entry_without_losing_sign_in_preference() {
        let directory = tempfile::tempdir().unwrap();
        let bootstrap = bootstrap(directory.path());
        let registry = FakeRunKey::default();
        configure_with(&bootstrap, true, true, &registry).unwrap();
        reconcile_with(&bootstrap, false, &registry).unwrap();
        assert!(enabled(&bootstrap.data_folder).unwrap());
        assert_eq!(
            registry
                .get(&entry_name(&bootstrap.data_folder).unwrap())
                .unwrap(),
            None
        );
        configure_with(&bootstrap, true, false, &registry).unwrap();
        assert!(enabled(&bootstrap.data_folder).unwrap());
        reconcile_with(
            &bootstrap,
            enabled(&bootstrap.data_folder).unwrap(),
            &registry,
        )
        .unwrap();
        assert_eq!(
            registry
                .get(&entry_name(&bootstrap.data_folder).unwrap())
                .unwrap(),
            Some(command_line(&bootstrap).unwrap())
        );
    }

    #[test]
    fn failed_or_ignored_registration_never_saves_success() {
        let directory = tempfile::tempdir().unwrap();
        let bootstrap = bootstrap(directory.path());
        let registry = FakeRunKey::default();
        registry.fail_read.set(true);
        assert!(configure_with(&bootstrap, true, true, &registry)
            .unwrap_err()
            .contains("query denied"));
        assert!(!enabled(&bootstrap.data_folder).unwrap());
        assert!(registry.entries.borrow().is_empty());
        registry.fail_read.set(false);
        registry.fail.set(true);
        assert!(configure_with(&bootstrap, true, true, &registry)
            .unwrap_err()
            .contains("access denied"));
        assert!(!enabled(&bootstrap.data_folder).unwrap());
        registry.fail.set(false);
        registry.ignore_write.set(true);
        assert!(configure_with(&bootstrap, true, true, &registry)
            .unwrap_err()
            .contains("did not retain"));
        assert!(!enabled(&bootstrap.data_folder).unwrap());
        registry.ignore_write.set(false);
        configure_with(&bootstrap, true, true, &registry).unwrap();
        registry.ignore_write.set(true);
        assert!(configure_with(&bootstrap, false, true, &registry).is_err());
        assert!(enabled(&bootstrap.data_folder).unwrap());
        assert!(registry
            .get(&entry_name(&bootstrap.data_folder).unwrap())
            .unwrap()
            .is_some());
    }

    #[test]
    fn failed_preference_save_restores_previous_registration() {
        let directory = tempfile::tempdir().unwrap();
        let bootstrap = bootstrap(directory.path());
        let registry = FakeRunKey::default();
        std::fs::create_dir_all(bootstrap.data_folder.join("gbot-login.json")).unwrap();
        assert!(configure_with(&bootstrap, true, true, &registry).is_err());
        let name = entry_name(&bootstrap.data_folder).unwrap();
        assert_eq!(registry.get(&name).unwrap(), None);
        registry
            .entries
            .borrow_mut()
            .insert(name.clone(), "previous installation command".into());
        assert!(configure_with(&bootstrap, true, true, &registry).is_err());
        assert_eq!(
            registry.get(&name).unwrap().as_deref(),
            Some("previous installation command")
        );
    }

    #[test]
    fn data_folder_move_transfers_enabled_startup_then_disables_without_duplicate() {
        let directory = tempfile::tempdir().unwrap();
        let original = bootstrap(directory.path());
        let mut updated = original.clone();
        updated.data_folder = directory.path().join("new data folder");
        let registry = FakeRunKey::default();
        let other = entry_name(&directory.path().join("another installation")).unwrap();
        registry.entries.borrow_mut().insert(other.clone(), "keep".into());
        configure_with(&original, true, true, &registry).unwrap();
        // The ordinary App Data copy retains the desired startup preference.
        write_private(&updated.data_folder.join("gbot-login.json"), b"true").unwrap();
        let old_name = entry_name(&original.data_folder).unwrap();
        let new_name = entry_name(&updated.data_folder).unwrap();
        relocate_with(&original.data_folder, &updated, &registry, || {
            assert_eq!(registry.get(&old_name).unwrap(), None);
            assert_eq!(registry.get(&new_name).unwrap(), Some(command_line(&updated).unwrap()));
            assert!(enabled(&updated.data_folder).unwrap());
            Ok(())
        }).unwrap();
        assert_eq!(registry.entries.borrow().len(), 2);
        configure_with(&updated, false, true, &registry).unwrap();
        assert_eq!(registry.get(&old_name).unwrap(), None);
        assert_eq!(registry.get(&new_name).unwrap(), None);
        assert_eq!(registry.get(&other).unwrap().as_deref(), Some("keep"));
        assert!(!enabled(&updated.data_folder).unwrap());
        // Moving an inactive local registration must not turn startup on.
        relocate_with(&original.data_folder, &updated, &registry, || Ok(())).unwrap();
        assert_eq!(registry.get(&old_name).unwrap(), None);
        assert_eq!(registry.get(&new_name).unwrap(), None);
    }

    #[test]
    fn data_folder_move_registration_and_commit_failures_restore_old_startup() {
        let directory = tempfile::tempdir().unwrap();
        let original = bootstrap(directory.path());
        let mut updated = original.clone();
        updated.data_folder = directory.path().join("new data folder");
        let old_name = entry_name(&original.data_folder).unwrap();
        let new_name = entry_name(&updated.data_folder).unwrap();
        for phase in ["registration", "removal", "commit"] {
            let registry = FakeRunKey::default();
            configure_with(&original, true, true, &registry).unwrap();
            let old_command = registry.get(&old_name).unwrap();
            registry.ignore_write.set(phase == "registration");
            registry.fail_remove_once.set(phase == "removal");
            let committed = std::cell::Cell::new(false);
            let failure = relocate_with(&original.data_folder, &updated, &registry, || {
                committed.set(true);
                Err::<(), _>("configuration or Host locator commit denied".into())
            }).unwrap_err();
            assert_eq!(committed.get(), phase == "commit");
            assert_eq!(registry.get(&old_name).unwrap(), old_command);
            assert_eq!(registry.get(&new_name).unwrap(), None);
            let expected = match phase {
                "registration" => "did not retain",
                "removal" => "removal denied",
                _ => "configuration or Host locator commit denied",
            };
            assert!(failure.contains(expected), "{failure}");
        }
        let registry = FakeRunKey::default();
        configure_with(&original, true, true, &registry).unwrap();
        let old_command = registry.get(&old_name).unwrap();
        registry.entries.borrow_mut().insert(new_name.clone(), "another registration".into());
        assert!(relocate_with(&original.data_folder, &updated, &registry, || -> Result<(), String> {
            panic!("an occupied destination must not commit App Data")
        }).unwrap_err().contains("not overwritten"));
        assert_eq!(registry.get(&old_name).unwrap(), old_command);
        assert_eq!(registry.get(&new_name).unwrap().as_deref(), Some("another registration"));
    }

    #[test]
    fn windows_arguments_quote_spaces_quotes_and_trailing_backslashes_without_a_shell() {
        assert_eq!(
            quote(OsStr::new(r"C:\GChat data\")).unwrap(),
            "\"C:\\GChat data\\\\\""
        );
        assert_eq!(quote(OsStr::new("a\\\"b")).unwrap(), "\"a\\\\\\\"b\"");
        assert_eq!(
            quote(OsStr::new("%PATH% & data")).unwrap(),
            "\"%PATH% & data\""
        );
        assert_eq!(
            quote(OsStr::new("GChat ユーザー")).unwrap(),
            "\"GChat ユーザー\""
        );
        assert!(quote(OsStr::new("x\nother.exe")).is_err());
        let directory = tempfile::tempdir().unwrap();
        let mut bootstrap = bootstrap(directory.path());
        bootstrap.resources = directory.path().join("x".repeat(261));
        let registry = FakeRunKey::default();
        assert!(configure_with(&bootstrap, true, true, &registry)
            .unwrap_err()
            .contains("260-character"));
        assert!(registry.entries.borrow().is_empty());
        registry.entries.borrow_mut().insert(
            entry_name(&bootstrap.data_folder).unwrap(),
            "old executable".into(),
        );
        bootstrap.executable = "no longer installed".into();
        bootstrap.resources = "no longer installed".into();
        configure_with(&bootstrap, false, true, &registry).unwrap();
        assert!(registry.entries.borrow().is_empty());
    }
}
