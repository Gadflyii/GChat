use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

// Resolve each junction itself, without first traversing its protected target.
fn physical_path(path: &Path) -> Result<PathBuf, String> {
    let mut resolved = PathBuf::new();
    for component in path.components() {
        resolved.push(component);
        for _ in 0..32 {
            match std::fs::read_link(&resolved) {
                Ok(target) => {
                    resolved = if target.is_absolute() {
                        target
                    } else {
                        resolved.parent().unwrap_or(Path::new("")).join(target)
                    };
                }
                Err(_) => break,
            }
        }
    }
    Ok(resolved)
}

fn copy_package(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let target = destination.join(entry.file_name());
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            copy_package(&entry.path(), &target)?;
        } else if kind.is_file() {
            std::fs::copy(entry.path(), target).map_err(|e| e.to_string())?;
        } else {
            return Err(format!(
                "Hermes package contains an unresolved link: {}",
                entry.path().display()
            ));
        }
    }
    Ok(())
}

fn repair_tui_packages(directory: &Path) -> Result<(), String> {
    // These are the TUI's two local file dependencies, not registry packages.
    for name in ["ink", "shared"] {
        let package = directory
            .join("hermes-agent/node_modules/@hermes")
            .join(name);
        if let Ok(target) = std::fs::read_link(&package) {
            let source = if target.is_absolute() {
                target
            } else {
                package.parent().unwrap().join(target)
            };
            let staged = package.with_file_name(format!("{name}.gchat-physical"));
            copy_package(&physical_path(&source)?, &staged)?;
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_nanos();
            let backup = package.with_file_name(format!("{name}.gchat-junction-{nonce}"));
            std::fs::rename(&package, &backup).map_err(|e| e.to_string())?;
            if let Err(error) = std::fs::rename(&staged, &package) {
                let _ = std::fs::rename(&backup, &package);
                return Err(format!(
                    "Could not install physical Hermes package: {error}"
                ));
            }
        }
    }
    Ok(())
}

pub(crate) fn repair_managed_runtime(directory: &Path) -> Result<(), String> {
    repair_tui_packages(directory)?;
    let venv = directory.join("hermes-agent").join("venv");
    let config = venv.join("pyvenv.cfg");
    if !config.is_file() {
        return Ok(());
    }
    let content = std::fs::read_to_string(&config).map_err(|e| e.to_string())?;
    let home = content
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once('=')?;
            (key.trim() == "home").then(|| PathBuf::from(value.trim()))
        })
        .ok_or("Hermes virtual environment has no Python home")?;
    let physical = physical_path(&home)?;
    if physical == home {
        return Ok(());
    }
    let python = physical.join("python.exe");
    if !python.is_file() {
        return Err(format!(
            "Hermes Python is missing at {}. Repair Hermes installation.",
            python.display()
        ));
    }
    let output = Command::new(directory.join("bin").join("uv.exe"))
        .args([
            "venv",
            "--allow-existing",
            "--offline",
            "--no-config",
            "--no-project",
            "--no-python-downloads",
            "--python",
        ])
        .arg(&python)
        .arg(&venv)
        .env_remove("UV_VENV_CLEAR")
        .env_remove("UV_VENV_RELOCATABLE")
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("Could not repair Hermes Python launcher: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Could not repair Hermes Python launcher: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let check = Command::new(venv.join("Scripts").join("python.exe"))
        .args([
            "-c",
            "from hermes_cli.main import main; import sys; print(sys.version)",
        ])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| e.to_string())?;
    if !check.status.success() {
        return Err(format!(
            "Hermes Python verification failed: {}",
            String::from_utf8_lossy(&check.stderr)
        ));
    }
    Ok(())
}
