//! Filesystem placement shared by managed model installers and downloaders.
use std::path::{Path, PathBuf};

#[cfg(target_os = "linux")]
use sha2::{Digest, Sha256};
#[cfg(target_os = "linux")]
use std::{fs, io::ErrorKind, path::Component};

/// Resolve implicit managed storage without creating directories or moving files.
pub fn resolve_artifact_root(requested_root: &Path) -> Result<PathBuf, String> {
    #[cfg(target_os = "linux")]
    {
        let xdg = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from);
        let home = std::env::var_os("HOME").map(PathBuf::from);
        resolve_with(
            requested_root,
            is_wsl()?,
            xdg.as_deref(),
            home.as_deref(),
            &is_windows_filesystem,
        )
    }
    #[cfg(not(target_os = "linux"))]
    Ok(requested_root.to_path_buf())
}

/// Explicit destinations and resumed downloads must remain on native storage.
pub fn require_native_model_storage(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        require_with(path, is_wsl()?, &is_windows_filesystem)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path;
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn is_wsl() -> Result<bool, String> {
    let release = fs::read_to_string("/proc/sys/kernel/osrelease")
        .map_err(|error| format!("Cannot determine model storage platform: {error}"))?;
    Ok(release.to_ascii_lowercase().contains("microsoft"))
}

#[cfg(target_os = "linux")]
fn is_windows_filesystem(existing_path: &Path) -> Result<bool, String> {
    let metadata = rustix::fs::statfs(existing_path).map_err(|error| {
        format!(
            "Cannot inspect model storage filesystem '{}': {error}",
            existing_path.display()
        )
    })?;
    Ok(metadata.f_type == 0x0102_1997)
}

#[cfg(target_os = "linux")]
fn resolve_with(
    requested: &Path,
    wsl: bool,
    xdg: Option<&Path>,
    home: Option<&Path>,
    windows_filesystem: &impl Fn(&Path) -> Result<bool, String>,
) -> Result<PathBuf, String> {
    if !wsl {
        return Ok(requested.to_path_buf());
    }
    let (canonical, ancestor) = canonical_existing_prefix(requested)?;
    if !windows_filesystem(&ancestor)? {
        return Ok(requested.to_path_buf());
    }

    let namespace = format!("{:x}", Sha256::digest(canonical.as_os_str().as_encoded_bytes()));
    let bases = [
        xdg.filter(|path| path.is_absolute()).map(Path::to_path_buf),
        home.filter(|path| path.is_absolute())
            .map(|path| path.join(".local/share")),
    ];
    let mut failures = Vec::new();
    for base in bases.into_iter().flatten() {
        let candidate = base.join("ginfer/managed-models").join(&namespace);
        let inspected = canonical_existing_prefix(&candidate)
            .and_then(|(_, ancestor)| windows_filesystem(&ancestor));
        match inspected {
            Ok(false) => return Ok(candidate),
            Ok(true) => failures.push(format!("'{}' is Windows-backed 9p", candidate.display())),
            Err(error) => failures.push(error),
        }
    }
    let detail = if failures.is_empty() {
        "XDG_DATA_HOME and HOME provide no absolute storage root".to_owned()
    } else {
        failures.join("; ")
    };
    Err(format!(
        "No verified Linux-backed managed model storage is available under WSL: {detail}. \
         Set XDG_DATA_HOME to an absolute Linux-filesystem directory, or choose native model storage explicitly. \
         Existing model files and partial downloads have not been moved."
    ))
}

#[cfg(target_os = "linux")]
fn require_with(
    path: &Path,
    wsl: bool,
    windows_filesystem: &impl Fn(&Path) -> Result<bool, String>,
) -> Result<(), String> {
    if wsl {
        let (_, ancestor) = canonical_existing_prefix(path)?;
        if windows_filesystem(&ancestor)? {
            return Err(format!(
                "Model storage '{}' is on the Windows-backed 9p filesystem under WSL. \
                 Choose a Linux-filesystem directory for new downloads. \
                 A Windows-backed partial download cannot be resumed here; start a new download \
                 in native storage and leave the existing files unchanged.",
                path.display()
            ));
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn canonical_existing_prefix(path: &Path) -> Result<(PathBuf, PathBuf), String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("Cannot resolve model storage working directory: {error}"))?
            .join(path)
    };
    let mut resolved = PathBuf::new();
    // Resolve existing links before processing `..`, which can change filesystem ownership.
    for part in absolute.components() {
        match part {
            Component::RootDir => resolved.push(part.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                resolved.pop();
            }
            Component::Normal(name) => {
                let next = resolved.join(name);
                match fs::canonicalize(&next) {
                    Ok(canonical) => resolved = canonical,
                    Err(error) if error.kind() == ErrorKind::NotFound => {
                        match fs::symlink_metadata(&next) {
                            Err(error) if error.kind() == ErrorKind::NotFound => resolved = next,
                            Ok(_) => return Err(format!("Cannot resolve model storage '{}': {error}", next.display())),
                            Err(error) => return Err(format!("Cannot inspect model storage '{}': {error}", next.display())),
                        }
                    }
                    Err(error) => return Err(format!("Cannot resolve model storage '{}': {error}", next.display())),
                }
            }
            Component::Prefix(_) => return Err("Model storage has an invalid Linux path prefix".into()),
        }
    }
    let mut ancestor = resolved.clone();
    loop {
        match fs::metadata(&ancestor) {
            Ok(_) => return Ok((resolved, ancestor)),
            Err(error) if error.kind() == ErrorKind::NotFound && ancestor.pop() => {}
            Err(error) => return Err(format!("Cannot inspect model storage '{}': {error}", ancestor.display())),
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn placement_preserves_native_paths_and_redirects_only_implicit_wsl_windows_storage() {
        let root = tempfile::tempdir().unwrap();
        let windows = root.path().join("windows");
        let native = root.path().join("native");
        let home = root.path().join("home");
        for directory in [&windows, &native, &home] {
            fs::create_dir(directory).unwrap();
        }
        let windows = fs::canonicalize(windows).unwrap();
        let classify = |path: &Path| Ok(path.starts_with(&windows));
        let requested = windows.join("missing/models");
        let no_probe = |_: &Path| -> Result<bool, String> { panic!("non-WSL must not inspect storage") };
        assert_eq!(resolve_with(&requested, false, None, None, &no_probe).unwrap(), requested);
        require_with(&requested, false, &no_probe).unwrap();
        let unchanged = native.join("missing/models");
        assert_eq!(resolve_with(&unchanged, true, None, None, &classify).unwrap(), unchanged);
        require_with(&unchanged, true, &classify).unwrap();

        let chosen = resolve_with(&requested, true, Some(&native), Some(&home), &classify).unwrap();
        assert!(chosen.starts_with(native.join("ginfer/managed-models")));
        assert!(!chosen.exists());
        assert_eq!(chosen.file_name().unwrap().len(), 64);
        let alias = root.path().join("alias");
        symlink(&windows, &alias).unwrap();
        assert_eq!(resolve_with(&alias.join("missing/./models"), true, Some(&native), None, &classify).unwrap(), chosen);
        assert_eq!(resolve_with(&alias.join("missing/../missing/models"), true, Some(&native), None, &classify).unwrap(), chosen);
        assert_ne!(resolve_with(&windows.join("other/models"), true, Some(&native), None, &classify).unwrap(), chosen);

        let fallback = resolve_with(&requested, true, Some(&windows), Some(&home), &classify).unwrap();
        assert!(fallback.starts_with(home.join(".local/share/ginfer/managed-models")));
        assert_eq!(resolve_with(&requested, true, Some(Path::new("relative")), Some(&home), &classify).unwrap(), fallback);
        let linked_xdg = root.path().join("linked-xdg");
        symlink(&windows, &linked_xdg).unwrap();
        assert_eq!(resolve_with(&requested, true, Some(&linked_xdg), Some(&home), &classify).unwrap(), fallback);
        assert!(resolve_with(&requested, true, Some(&windows), Some(&windows), &classify).unwrap_err().contains("XDG_DATA_HOME"));
        assert!(resolve_with(&requested, true, None, None, &classify).is_err());
        assert!(require_with(&requested, true, &classify).unwrap_err().contains("cannot be resumed"));
        assert!(require_with(&alias.join("missing/models"), true, &classify).is_err());
        assert!(!native.join("ginfer").exists());

        fs::create_dir(native.join("ginfer")).unwrap();
        symlink(&windows, native.join("ginfer/managed-models")).unwrap();
        assert_eq!(resolve_with(&requested, true, Some(&native), Some(&home), &classify).unwrap(), fallback);

        let dangling = root.path().join("dangling");
        symlink(windows.join("absent"), &dangling).unwrap();
        assert!(resolve_with(&dangling.join("models"), true, Some(&native), None, &classify).is_err());
        assert!(!home.join(".local").exists());
    }
}
