//! A host state directory has exactly one live service owner.
use std::{
    fs::{File, OpenOptions},
    path::Path,
};

pub struct ServiceOwner {
    _lock: File,
}

impl Drop for ServiceOwner {
    fn drop(&mut self) {
        // Release ownership even while a concurrent fork holds the pre-exec descriptor.
        let _ = self._lock.unlock();
    }
}

impl ServiceOwner {
    pub fn acquire(directory: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
        let path = directory.join("host.lock");
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let lock = options
            .open(&path)
            .map_err(|e| format!("Cannot open host ownership lock: {e}"))?;
        lock.try_lock().map_err(|e| format!("Cannot acquire exclusive host ownership at {}: {e}. Use the running host service instead of starting another copy.", directory.display()))?;
        Ok(Self { _lock: lock })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_owner_excludes_another_and_release_does_not_require_deleting_files() {
        let root = tempfile::tempdir().unwrap();
        let first = ServiceOwner::acquire(root.path()).unwrap();
        assert!(ServiceOwner::acquire(root.path()).is_err());
        // A pre-exec child can temporarily retain the same open file description.
        let inherited = first._lock.try_clone().unwrap();
        drop(first);
        assert!(root.path().join("host.lock").exists());
        let second = ServiceOwner::acquire(root.path()).unwrap();
        assert!(ServiceOwner::acquire(root.path()).is_err());
        drop(second);
        drop(inherited);
    }
}
