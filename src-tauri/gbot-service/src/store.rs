use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::service::{DurableState, ServiceError};

pub(crate) struct Store {
    path: PathBuf,
    _lock: fs::File,
}

impl Store {
    pub(crate) async fn open(path: PathBuf) -> Result<Self, ServiceError> {
        if path.file_name().is_none() {
            return Err(ServiceError::InvalidState);
        }
        tokio::task::spawn_blocking(move || {
            create_parent(&path).map_err(|_| ServiceError::Persistence)?;
            let mut options = OpenOptions::new();
            options.read(true).write(true).create(true).truncate(false);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let lock = options
                .open(path.with_extension("lock"))
                .map_err(|_| ServiceError::Persistence)?;
            lock.try_lock().map_err(|error| match error {
                fs::TryLockError::WouldBlock => ServiceError::AlreadyRunning,
                fs::TryLockError::Error(_) => ServiceError::Persistence,
            })?;
            Ok(Self { path, _lock: lock })
        })
        .await
        .map_err(|_| ServiceError::Persistence)?
    }

    pub(crate) async fn load(&self) -> Result<Option<DurableState>, ServiceError> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|_| ServiceError::InvalidState),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(ServiceError::Persistence),
        })
        .await
        .map_err(|_| ServiceError::Persistence)?
    }

    pub(crate) async fn save(self: &Arc<Self>, state: &DurableState) -> Result<(), ServiceError> {
        let bytes = serde_json::to_vec_pretty(state).map_err(|_| ServiceError::InvalidState)?;
        let store = self.clone();
        tokio::task::spawn_blocking(move || write_atomic(&store.path, &bytes))
            .await
            .map_err(|_| ServiceError::Persistence)?
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), ServiceError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut temporary_name = path
        .file_name()
        .ok_or(ServiceError::InvalidState)?
        .to_os_string();
    temporary_name.push(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let temporary = parent.join(temporary_name);
    let result = (|| -> std::io::Result<()> {
        create_parent(path)?;

        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)?;
        #[cfg(unix)]
        fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result.map_err(|_| ServiceError::Persistence)
}

fn create_parent(path: &Path) -> std::io::Result<()> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(parent)
    }
    #[cfg(not(unix))]
    fs::create_dir_all(parent)
}
