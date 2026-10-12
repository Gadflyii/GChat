use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::service::ServiceError;

/// A failed save must say whether rollback can still remove dependent resources.
pub(crate) enum SaveError {
    NotPublished(ServiceError),
    Published,
    Unconfirmed,
}

impl SaveError {
    fn service_error(self) -> ServiceError {
        match self {
            Self::NotPublished(error) => error,
            Self::Published | Self::Unconfirmed => ServiceError::Persistence,
        }
    }
}

pub(crate) struct Store {
    path: PathBuf,
    _lock: fs::File,
    writes: Arc<tokio::sync::Mutex<()>>,
    #[cfg(test)]
    pub(crate) fail_after_publish: std::sync::atomic::AtomicBool,
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
            Ok(Self {
                path,
                _lock: lock,
                writes: Arc::new(tokio::sync::Mutex::new(())),
                #[cfg(test)]
                fail_after_publish: std::sync::atomic::AtomicBool::new(false),
            })
        })
        .await
        .map_err(|_| ServiceError::Persistence)?
    }

    pub(crate) async fn load<T: serde::de::DeserializeOwned + Send + 'static>(
        &self,
    ) -> Result<Option<T>, ServiceError> {
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

    pub(crate) async fn save<T: serde::Serialize>(
        self: &Arc<Self>,
        state: &T,
    ) -> Result<(), ServiceError> {
        self.save_with_outcome(state)
            .await
            .map_err(SaveError::service_error)
    }

    pub(crate) async fn save_with_outcome<T: serde::Serialize>(
        self: &Arc<Self>,
        state: &T,
    ) -> Result<(), SaveError> {
        let bytes = serde_json::to_vec_pretty(state)
            .map_err(|_| SaveError::NotPublished(ServiceError::InvalidState))?;
        let guard = self.writes.clone().lock_owned().await;
        let store = self.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = guard;
            write_atomic(&store.path, &bytes)?;
            #[cfg(test)]
            if store
                .fail_after_publish
                .swap(false, std::sync::atomic::Ordering::AcqRel)
            {
                return Err(SaveError::Published);
            }
            #[cfg(unix)]
            {
                let parent = store
                    .path
                    .parent()
                    .filter(|parent| !parent.as_os_str().is_empty())
                    .unwrap_or_else(|| Path::new("."));
                fs::File::open(parent)
                    .and_then(|directory| directory.sync_all())
                    .map_err(|_| SaveError::Published)?;
            }
            Ok(())
        })
        .await
        .map_err(|_| SaveError::Unconfirmed)?
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), SaveError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut temporary_name = path
        .file_name()
        .ok_or(SaveError::NotPublished(ServiceError::InvalidState))?
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
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result.map_err(|_| SaveError::NotPublished(ServiceError::Persistence))?;

    Ok(())
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
