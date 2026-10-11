use std::{future::Future, pin::Pin};

use uuid::Uuid;

pub const VAULT_SERVICE: &str = "app.gchat.gbot";

/// Secret bytes cross only the native vault/transport boundary.
pub struct Secret(Vec<u8>);

impl Secret {
    pub fn new(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }

    pub fn expose_secret(&self) -> &[u8] {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VaultError {
    AccessDenied,
    Unavailable,
    InvalidData,
    Ambiguous,
    Missing,
    WorkerFailure,
}

impl std::fmt::Display for VaultError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::AccessDenied => "Secure storage is locked or access is denied",
            Self::Unavailable => "Secure storage is unavailable",
            Self::InvalidData => "Secure storage rejected the credential data",
            Self::Ambiguous => "Secure storage contains conflicting credential entries",
            Self::Missing => "The secure storage credential is missing",
            Self::WorkerFailure => "The secure storage operation could not complete",
        })
    }
}

impl std::error::Error for VaultError {}

pub type VaultFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, VaultError>> + Send + 'a>>;

pub trait Vault: Send + Sync {
    fn get(&self, reference: Uuid) -> VaultFuture<'_, Option<Secret>>;
    fn put(&self, reference: Uuid, secret: Secret) -> VaultFuture<'_, ()>;
    fn delete(&self, reference: Uuid) -> VaultFuture<'_, ()>;
}

pub struct NativeVault;

fn storage_error(error: keyring::Error) -> VaultError {
    // Provider errors can contain credential data; never retain or format them.
    match error {
        keyring::Error::NoStorageAccess(_) => VaultError::AccessDenied,
        keyring::Error::PlatformFailure(_) => VaultError::Unavailable,
        keyring::Error::NoEntry => VaultError::Missing,
        keyring::Error::BadEncoding(_)
        | keyring::Error::TooLong(_, _)
        | keyring::Error::Invalid(_, _) => VaultError::InvalidData,
        keyring::Error::Ambiguous(_) => VaultError::Ambiguous,
        _ => VaultError::Unavailable,
    }
}

async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, VaultError> + Send + 'static,
) -> Result<T, VaultError> {
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|_| VaultError::WorkerFailure)?
}

impl Vault for NativeVault {
    fn get(&self, reference: Uuid) -> VaultFuture<'_, Option<Secret>> {
        Box::pin(blocking(move || {
            let entry = keyring::Entry::new(VAULT_SERVICE, &reference.to_string())
                .map_err(storage_error)?;
            match entry.get_secret() {
                Ok(bytes) => Ok(Some(Secret::new(bytes))),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(storage_error(error)),
            }
        }))
    }

    fn put(&self, reference: Uuid, secret: Secret) -> VaultFuture<'_, ()> {
        Box::pin(blocking(move || {
            keyring::Entry::new(VAULT_SERVICE, &reference.to_string())
                .and_then(|entry| entry.set_secret(secret.expose_secret()))
                .map_err(storage_error)
        }))
    }

    fn delete(&self, reference: Uuid) -> VaultFuture<'_, ()> {
        Box::pin(blocking(move || {
            let entry = keyring::Entry::new(VAULT_SERVICE, &reference.to_string())
                .map_err(storage_error)?;
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(storage_error(error)),
            }
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::BTreeMap, sync::Mutex};

    #[derive(Default)]
    struct MemoryVault(Mutex<BTreeMap<Uuid, Vec<u8>>>);

    impl Vault for MemoryVault {
        fn get(&self, reference: Uuid) -> VaultFuture<'_, Option<Secret>> {
            Box::pin(async move {
                Ok(self
                    .0
                    .lock()
                    .unwrap()
                    .get(&reference)
                    .cloned()
                    .map(Secret::new))
            })
        }

        fn put(&self, reference: Uuid, secret: Secret) -> VaultFuture<'_, ()> {
            Box::pin(async move {
                self.0
                    .lock()
                    .unwrap()
                    .insert(reference, secret.expose_secret().to_vec());
                Ok(())
            })
        }

        fn delete(&self, reference: Uuid) -> VaultFuture<'_, ()> {
            Box::pin(async move {
                self.0.lock().unwrap().remove(&reference);
                Ok(())
            })
        }
    }

    #[tokio::test]
    async fn credential_reference_round_trip_and_locked_storage_are_separate_from_secrets() {
        let vault: Box<dyn Vault> = Box::new(MemoryVault::default());
        let reference = Uuid::new_v4();
        let bytes = b"fixture-private-key\0\xff".to_vec();
        vault
            .put(reference, Secret::new(bytes.clone()))
            .await
            .unwrap();
        let recovered = vault.get(reference).await.unwrap().unwrap();
        assert_eq!(recovered.expose_secret(), bytes);
        let persisted_reference = serde_json::json!({ "credential_ref": reference.to_string() });
        assert_eq!(persisted_reference.as_object().unwrap().len(), 1);
        assert!(!persisted_reference
            .to_string()
            .contains("fixture-private-key"));
        vault.delete(reference).await.unwrap();
        vault.delete(reference).await.unwrap();
        assert!(vault.get(reference).await.unwrap().is_none());

        let locked = storage_error(keyring::Error::NoStorageAccess(Box::new(
            std::io::Error::new(std::io::ErrorKind::PermissionDenied, "fixture-private-key"),
        )));
        assert_eq!(locked, VaultError::AccessDenied);
        assert_eq!(
            locked.to_string(),
            "Secure storage is locked or access is denied"
        );
        assert!(!format!("{locked:?}").contains("fixture-private-key"));
    }
}
