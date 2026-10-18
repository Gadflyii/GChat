//! Desktop login startup. Linux owns its XDG entry; other desktop platforms
//! retain the autostart plugin's native registration.

use tauri::{AppHandle, Runtime};

#[cfg(target_os = "linux")]
use std::{
    fs, io,
    path::{Path, PathBuf},
};
#[cfg(target_os = "linux")]
use tauri::Manager;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use tauri_plugin_autostart::ManagerExt;

#[cfg(target_os = "linux")]
struct LinuxAutostart {
    entry: PathBuf,
}

#[cfg(target_os = "linux")]
impl LinuxAutostart {
    fn new(config_dir: &Path) -> Self {
        Self {
            entry: config_dir.join("autostart/GChat.desktop"),
        }
    }

    fn is_enabled(&self) -> Result<bool, String> {
        match fs::metadata(&self.entry) {
            Ok(metadata) if metadata.is_file() => Ok(true),
            Ok(_) => Err(format!(
                "Startup entry is not a file: {}",
                self.entry.display()
            )),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(format!(
                "Could not read startup entry {}: {error}",
                self.entry.display()
            )),
        }
    }

    fn enable(&self, target: &Path) -> Result<(), String> {
        let exec = desktop_exec(target)?;
        let directory = self.entry.parent().expect("autostart entry has a parent");
        fs::create_dir_all(directory).map_err(|error| {
            format!(
                "Could not create startup directory {}: {error}",
                directory.display()
            )
        })?;
        fs::write(
            &self.entry,
            format!("[Desktop Entry]\nType=Application\nVersion=1.0\nName=GChat\nExec={exec}\nStartupNotify=false\nTerminal=false\n"),
        ).map_err(|error| format!("Could not write startup entry {}: {error}", self.entry.display()))
    }

    fn disable(&self) -> Result<(), String> {
        match fs::remove_file(&self.entry) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!(
                "Could not remove startup entry {}: {error}",
                self.entry.display()
            )),
        }
    }
}

#[cfg(target_os = "linux")]
fn linux_launch_target(
    appimage: Option<&Path>,
    appdir: Option<&Path>,
    executable: &Path,
) -> PathBuf {
    if let Some(appimage) = appimage {
        appimage.to_owned()
    } else if let Some(appdir) = appdir {
        // An extracted AppDir needs AppRun's library paths and runtime hooks.
        appdir.join("AppRun")
    } else {
        executable.to_owned()
    }
}

#[cfg(target_os = "linux")]
fn desktop_exec(target: &Path) -> Result<String, String> {
    let target = target
        .to_str()
        .ok_or_else(|| "Startup executable path is not valid UTF-8".to_string())?;
    // Exec has two escaping layers: its quoted argument, then the desktop
    // entry string value. Percent signs must also escape Exec field codes.
    let mut argument = String::from("\"");
    for ch in target.chars() {
        match ch {
            '%' => argument.push_str("%%"),
            '"' | '`' | '$' | '\\' => {
                argument.push('\\');
                argument.push(ch);
            }
            _ => argument.push(ch),
        }
    }
    argument.push('"');
    Ok(argument
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t"))
}

#[tauri::command]
pub async fn is_launch_at_startup_enabled<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    {
        let config = app.path().config_dir().map_err(|error| {
            format!("Could not resolve startup configuration directory: {error}")
        })?;
        tauri::async_runtime::spawn_blocking(move || LinuxAutostart::new(&config).is_enabled())
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        app.autolaunch()
            .is_enabled()
            .map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        let _ = app;
        Err("Launch at startup is available only on desktop".to_string())
    }
}

#[tauri::command]
pub async fn set_launch_at_startup_enabled<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        // Tauri/dirs respects an absolute XDG_CONFIG_HOME, falling back to
        // HOME/.config. Never create a second configuration tree under HOME.
        let config = app.path().config_dir().map_err(|error| {
            format!("Could not resolve startup configuration directory: {error}")
        })?;
        let target = if enabled {
            let environment = app.env();
            let executable = std::env::current_exe()
                .map_err(|error| format!("Could not resolve startup executable: {error}"))?;
            Some(linux_launch_target(
                environment.appimage.as_deref().map(Path::new),
                environment.appdir.as_deref().map(Path::new),
                &executable,
            ))
        } else {
            None
        };
        tauri::async_runtime::spawn_blocking(move || {
            let autostart = LinuxAutostart::new(&config);
            match target {
                Some(target) => autostart.enable(&target),
                None => autostart.disable(),
            }
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let manager = app.autolaunch();
        if enabled {
            manager.enable()
        } else {
            manager.disable()
        }
        .map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        let _ = (app, enabled);
        Err("Launch at startup is available only on desktop".to_string())
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn linux_autostart_creates_missing_parents_and_removes_only_its_entry() {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("fresh-home/.config");
        let autostart = LinuxAutostart::new(&config);
        assert!(!autostart.is_enabled().unwrap());
        assert!(!config.exists());

        autostart.enable(Path::new("/usr/bin/gchat")).unwrap();
        assert!(autostart.is_enabled().unwrap());
        let other = config.join("autostart/another-app.desktop");
        fs::write(&other, "another app").unwrap();
        autostart.disable().unwrap();
        autostart.disable().unwrap();
        assert!(!autostart.is_enabled().unwrap());
        assert_eq!(fs::read_to_string(other).unwrap(), "another app");
    }

    #[test]
    fn linux_autostart_uses_resolved_xdg_config_without_creating_home_config() {
        let home = tempfile::tempdir().unwrap();
        let config = home.path().join("private-xdg/config");
        let autostart = LinuxAutostart::new(&config);
        autostart.enable(Path::new("/usr/bin/gchat")).unwrap();
        assert!(config.join("autostart/GChat.desktop").is_file());
        assert!(!home.path().join(".config").exists());

        // The OS state remains authoritative after an external removal.
        fs::remove_file(&autostart.entry).unwrap();
        assert!(!autostart.is_enabled().unwrap());
    }

    #[test]
    fn linux_autostart_reports_configuration_and_entry_write_failures() {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("blocked-config");
        fs::write(&config, "not a directory").unwrap();
        let error = LinuxAutostart::new(&config)
            .enable(Path::new("/usr/bin/gchat"))
            .unwrap_err();
        assert!(
            error.contains("Could not create startup directory"),
            "{error}"
        );
        assert!(error.contains("blocked-config"), "{error}");

        let autostart = LinuxAutostart::new(&root.path().join("config"));
        fs::create_dir_all(&autostart.entry).unwrap();
        let error = autostart.enable(Path::new("/usr/bin/gchat")).unwrap_err();
        assert!(error.contains("Could not write startup entry"), "{error}");
        assert!(autostart.is_enabled().is_err());
        assert!(autostart.disable().is_err());
    }

    #[test]
    fn linux_autostart_preserves_appimage_appdir_and_deb_launchers() {
        let root = tempfile::tempdir().unwrap();
        let autostart = LinuxAutostart::new(root.path());
        let executable = Path::new("/tmp/.mount-gchat/usr/bin/gchat");
        for (image, directory, expected) in [
            (
                Some(Path::new("/saved/GChat.AppImage")),
                Some(Path::new("/tmp/.mount-gchat")),
                "/saved/GChat.AppImage",
            ),
            (
                None,
                Some(Path::new("/saved/GChat.AppDir")),
                "/saved/GChat.AppDir/AppRun",
            ),
            (None, None, "/usr/bin/gchat"),
        ] {
            let current = if directory.is_some() {
                executable
            } else {
                Path::new("/usr/bin/gchat")
            };
            let target = linux_launch_target(image, directory, current);
            autostart.enable(&target).unwrap();
            let entry = fs::read_to_string(&autostart.entry).unwrap();
            assert!(
                entry
                    .lines()
                    .any(|line| line == format!("Exec=\"{expected}\"")),
                "{entry}"
            );
        }
    }

    #[test]
    fn linux_autostart_escapes_desktop_exec_as_one_literal_path() {
        let root = tempfile::tempdir().unwrap();
        let autostart = LinuxAutostart::new(root.path());
        autostart
            .enable(Path::new(r#"/saved/GChat %f "$`\.AppImage"#))
            .unwrap();
        let entry = fs::read_to_string(&autostart.entry).unwrap();
        assert!(
            entry
                .lines()
                .any(|line| line == r#"Exec="/saved/GChat %%f \\"\\$\\`\\\\.AppImage""#),
            "{entry}"
        );
    }
}
