//! Opt-in Linux desktop sign-in startup, independent of the GChat window.
use crate::{gbot_bootstrap::Bootstrap, service::write_private};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub fn enabled(root: &Path) -> Result<bool, String> {
    match std::fs::read(root.join("gbot-login.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

pub fn configure(bootstrap: &Bootstrap, enabled: bool, local: bool) -> Result<(), String> {
    reconcile(bootstrap, enabled && local)?;
    write_private(
        &bootstrap.data_folder.join("gbot-login.json"),
        if enabled { b"true" } else { b"false" },
    )
}

pub fn reconcile(bootstrap: &Bootstrap, run: bool) -> Result<(), String> {
    reconcile_at(&config_directory()?, bootstrap, run)
}

fn config_directory() -> Result<PathBuf, String> {
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .ok_or("Linux sign-in startup requires a user config directory")?;
    if !config.is_absolute() {
        return Err("Linux sign-in startup requires an absolute config directory".into());
    }
    Ok(config)
}

/// Move an existing sign-in entry together with the caller's App Data handoff.
pub fn relocate<T>(
    current: &Path,
    updated: &Bootstrap,
    commit: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    relocate_at(&config_directory()?, current, updated, commit)
}

fn relocate_at<T>(
    config: &Path,
    current: &Path,
    updated: &Bootstrap,
    commit: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let old_entry = entry_path(config, current);
    let new_entry = entry_path(config, &updated.data_folder);
    if old_entry == new_entry {
        return commit();
    }
    let prior = match std::fs::read(&old_entry) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return commit(),
        Err(error) => return Err(error.to_string()),
    };
    if new_entry.try_exists().map_err(|error| error.to_string())? {
        return Err("The new App Data folder already has a Gbot sign-in registration; choose another folder so that registration is not overwritten".into());
    }
    let restore = |error: String| {
        let mut error = error;
        if let Err(rollback) = write_private(&old_entry, &prior) {
            error = format!(
                "{error}; could not restore the previous Gbot sign-in registration: {rollback}"
            );
        }
        if let Err(rollback) = std::fs::remove_file(&new_entry) {
            if rollback.kind() != std::io::ErrorKind::NotFound {
                error = format!(
                    "{error}; could not remove the new Gbot sign-in registration: {rollback}"
                );
            }
        }
        error
    };
    reconcile_at(config, updated, true)?;
    std::fs::remove_file(&old_entry).map_err(|error| restore(error.to_string()))?;
    commit().map_err(restore)
}

fn entry_path(config: &Path, root: &Path) -> PathBuf {
    use std::os::unix::ffi::OsStrExt;
    let key = hex::encode(Sha256::digest(root.as_os_str().as_bytes()));
    config
        .join("autostart")
        .join(format!("gchat-gbot-{key}.desktop"))
}

fn quote(value: &std::ffi::OsStr) -> Result<String, String> {
    let value = value
        .to_str()
        .ok_or("Linux sign-in paths must be valid UTF-8")?;
    if value.chars().any(char::is_control) {
        return Err("Linux sign-in paths cannot contain control characters".into());
    }
    // Desktop Entry escaping precedes Exec argument parsing.
    let mut result = String::from("\"");
    for character in value.chars() {
        match character {
            '\\' => result.push_str("\\\\\\\\"),
            '"' | '$' | '`' => {
                result.push_str("\\\\");
                result.push(character);
            }
            '%' => result.push_str("%%"),
            other => result.push(other),
        }
    }
    result.push('"');
    Ok(result)
}

fn reconcile_at(config: &Path, bootstrap: &Bootstrap, run: bool) -> Result<(), String> {
    bootstrap.validate()?;
    let path = entry_path(config, &bootstrap.data_folder);
    if !run {
        return match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    let mut args = vec![quote(bootstrap.executable.as_os_str())?];
    args.extend(
        bootstrap
            .arguments()
            .iter()
            .map(|arg| quote(arg))
            .collect::<Result<Vec<_>, _>>()?,
    );
    let entry = format!(
        "[Desktop Entry]\nType=Application\nName=Gbot background service\nExec={}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
        args.join(" ")
    );
    write_private(&path, entry.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn installed_bootstrap(data_folder: PathBuf) -> Bootstrap {
        Bootstrap {
            data_folder,
            executable: "/opt/GChat/GChat.AppImage".into(),
            resources: "/tmp/.mount/Resources".into(),
            appimage_resources: Some("usr/lib/GChat/resources".into()),
        }
    }

    #[test]
    fn sign_in_entry_uses_exact_installed_root_and_removes_only_its_owner() {
        let directory = tempfile::tempdir().unwrap();
        let bootstrap = Bootstrap {
            data_folder: directory.path().join("data folder"),
            executable: "/opt/GChat/GChat.AppImage".into(),
            resources: "/tmp/.mount/Resources".into(),
            appimage_resources: Some("usr/lib/GChat/resources".into()),
        };
        let other = directory.path().join("autostart/unrelated.desktop");
        reconcile_at(directory.path(), &bootstrap, true).unwrap();
        std::fs::write(&other, "keep").unwrap();
        let entry = entry_path(directory.path(), &bootstrap.data_folder);
        let content = std::fs::read_to_string(&entry).unwrap();
        assert!(content.contains("Exec=\"/opt/GChat/GChat.AppImage\" \"--gbot-service\""));
        assert!(content.contains(&format!(
            "\"--data-folder\" \"{}\"",
            bootstrap.data_folder.display()
        )));
        assert!(content.contains("\"--appimage-resources\" \"usr/lib/GChat/resources\""));
        assert!(!content.contains("/tmp/.mount"));
        assert!(!content.contains("credential"));
        reconcile_at(directory.path(), &bootstrap, false).unwrap();
        reconcile_at(directory.path(), &bootstrap, false).unwrap();
        assert!(!entry.exists());
        assert_eq!(std::fs::read_to_string(other).unwrap(), "keep");
    }

    #[test]
    fn relocation_moves_enabled_entry_before_committing_and_preserves_other_entries() {
        let directory = tempfile::tempdir().unwrap();
        let config = directory.path().join("config");
        let old = installed_bootstrap(directory.path().join("old data"));
        let updated = installed_bootstrap(directory.path().join("new data"));
        reconcile_at(&config, &old, true).unwrap();
        let old_entry = entry_path(&config, &old.data_folder);
        let new_entry = entry_path(&config, &updated.data_folder);
        let unrelated = config.join("autostart/unrelated.desktop");
        std::fs::write(&unrelated, b"unrelated registration\n").unwrap();

        let result = relocate_at(&config, &old.data_folder, &updated, || {
            assert!(!old_entry.exists());
            let content = std::fs::read_to_string(&new_entry).unwrap();
            assert!(content.contains("Exec=\"/opt/GChat/GChat.AppImage\" \"--gbot-service\""));
            assert!(content.contains(&format!(
                "\"--data-folder\" \"{}\"",
                updated.data_folder.display()
            )));
            assert!(!content.contains(&old.data_folder.display().to_string()));
            assert_eq!(
                std::fs::read(&unrelated).unwrap(),
                b"unrelated registration\n"
            );
            Ok("committed")
        })
        .unwrap();

        assert_eq!(result, "committed");
        assert!(!old_entry.exists());
        assert!(new_entry.exists());
        assert_eq!(
            std::fs::read(unrelated).unwrap(),
            b"unrelated registration\n"
        );
    }

    #[test]
    fn relocation_does_not_enable_disabled_or_paired_startup() {
        for (enabled, local) in [(false, true), (true, false)] {
            let directory = tempfile::tempdir().unwrap();
            let config = directory.path().join("config");
            let old = installed_bootstrap(directory.path().join("old data"));
            let updated = installed_bootstrap(directory.path().join("new data"));
            reconcile_at(&config, &old, enabled && local).unwrap();
            let old_entry = entry_path(&config, &old.data_folder);
            let new_entry = entry_path(&config, &updated.data_folder);

            let result = relocate_at(&config, &old.data_folder, &updated, || {
                assert!(!old_entry.exists());
                assert!(!new_entry.exists());
                Ok("committed without startup")
            })
            .unwrap();

            assert_eq!(result, "committed without startup");
            assert!(!old_entry.exists());
            assert!(!new_entry.exists());
        }
    }

    #[test]
    fn relocation_restores_exact_old_entry_when_commit_fails() {
        let directory = tempfile::tempdir().unwrap();
        let config = directory.path().join("config");
        let old = installed_bootstrap(directory.path().join("old data"));
        let updated = installed_bootstrap(directory.path().join("new data"));
        reconcile_at(&config, &old, true).unwrap();
        let old_entry = entry_path(&config, &old.data_folder);
        let new_entry = entry_path(&config, &updated.data_folder);
        let mut original = std::fs::read(&old_entry).unwrap();
        original.extend_from_slice(b"# retained exact original bytes\r\n");
        std::fs::write(&old_entry, &original).unwrap();

        let error = relocate_at(&config, &old.data_folder, &updated, || {
            assert!(!old_entry.exists());
            assert!(new_entry.exists());
            Err::<(), String>("configuration rejected".into())
        })
        .unwrap_err();

        assert_eq!(error, "configuration rejected");
        assert_eq!(std::fs::read(old_entry).unwrap(), original);
        assert!(!new_entry.exists());
    }

    #[test]
    fn relocation_rejects_existing_destination_without_committing_or_changing_entries() {
        let directory = tempfile::tempdir().unwrap();
        let config = directory.path().join("config");
        let old = installed_bootstrap(directory.path().join("old data"));
        let updated = installed_bootstrap(directory.path().join("new data"));
        reconcile_at(&config, &old, true).unwrap();
        reconcile_at(&config, &updated, true).unwrap();
        let old_entry = entry_path(&config, &old.data_folder);
        let new_entry = entry_path(&config, &updated.data_folder);
        let old_bytes = std::fs::read(&old_entry).unwrap();
        let new_bytes = std::fs::read(&new_entry).unwrap();
        let committed = std::cell::Cell::new(false);

        let error = relocate_at(&config, &old.data_folder, &updated, || {
            committed.set(true);
            Ok(())
        })
        .unwrap_err();

        assert!(error.contains("already has a Gbot sign-in registration"));
        assert!(!committed.get());
        assert_eq!(std::fs::read(old_entry).unwrap(), old_bytes);
        assert_eq!(std::fs::read(new_entry).unwrap(), new_bytes);
    }

    #[test]
    fn exec_paths_escape_desktop_fields_and_reject_newlines() {
        assert_eq!(
            quote(std::ffi::OsStr::new("a% b$`\"\\")).unwrap(),
            "\"a%% b\\\\$\\\\`\\\\\"\\\\\\\\\""
        );
        assert!(quote(std::ffi::OsStr::new("a\nExec=other")).is_err());
    }
}
