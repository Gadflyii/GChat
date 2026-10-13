use std::{future::Future, pin::Pin};

use uuid::Uuid;

pub const VAULT_SERVICE: &str = "app.gchat.gbot";

/// Secret bytes cross only the native vault/transport boundary.
pub struct Secret(jan_utils::credential_store::Zeroizing<Vec<u8>>);

impl Secret {
    pub fn new(bytes: Vec<u8>) -> Self {
        Self(jan_utils::credential_store::Zeroizing::new(bytes))
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

fn storage_error(error: jan_utils::credential_store::Error) -> VaultError {
    use jan_utils::credential_store::Error;
    match error {
        Error::Locked => VaultError::AccessDenied,
        Error::Missing => VaultError::Missing,
        Error::InvalidData => VaultError::InvalidData,
        Error::Conflict => VaultError::Ambiguous,
        Error::MissingProvider | Error::Unavailable => VaultError::Unavailable,
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
            jan_utils::credential_store::shared()
                .map_err(storage_error)?
                .get(VAULT_SERVICE, &reference.to_string())
                .map(|bytes| bytes.map(Secret))
                .map_err(storage_error)
        }))
    }
    fn put(&self, reference: Uuid, secret: Secret) -> VaultFuture<'_, ()> {
        Box::pin(blocking(move || {
            jan_utils::credential_store::shared()
                .map_err(storage_error)?
                .put(
                    VAULT_SERVICE,
                    &reference.to_string(),
                    secret.expose_secret(),
                )
                .map_err(storage_error)
        }))
    }
    fn delete(&self, reference: Uuid) -> VaultFuture<'_, ()> {
        Box::pin(blocking(move || {
            jan_utils::credential_store::shared()
                .map_err(storage_error)?
                .delete(VAULT_SERVICE, &reference.to_string())
                .map_err(storage_error)
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

        let locked = storage_error(jan_utils::credential_store::Error::Locked);
        assert_eq!(locked, VaultError::AccessDenied);
        assert_eq!(
            locked.to_string(),
            "Secure storage is locked or access is denied"
        );
        assert!(!format!("{locked:?}").contains("fixture-private-key"));
    }
}
