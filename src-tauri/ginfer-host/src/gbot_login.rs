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
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .ok_or("Linux sign-in startup requires a user config directory")?;
    if !config.is_absolute() {
        return Err("Linux sign-in startup requires an absolute config directory".into());
    }
    reconcile_at(&config, bootstrap, run)
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
    fn exec_paths_escape_desktop_fields_and_reject_newlines() {
        assert_eq!(
            quote(std::ffi::OsStr::new("a% b$`\"\\")).unwrap(),
            "\"a%% b\\\\$\\\\`\\\\\"\\\\\\\\\""
        );
        assert!(quote(std::ffi::OsStr::new("a\nExec=other")).is_err());
    }
}
