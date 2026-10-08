use ginfer_host::client::{CredentialFuture, CredentialStore, VAULT_SERVICE};
use std::sync::OnceLock;
use tokio::sync::Mutex;
use uuid::Uuid;

pub struct NativeVault;

async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|error| error.to_string())?
}

impl CredentialStore for NativeVault {
    fn get(&self, id: Uuid) -> CredentialFuture<'_, String> {
        Box::pin(blocking(move || {
            keyring::Entry::new(VAULT_SERVICE, &id.to_string())
                .and_then(|entry| entry.get_password())
                .map_err(|error| error.to_string())
        }))
    }
    fn set<'a>(&'a self, id: Uuid, token: &'a str) -> CredentialFuture<'a, ()> {
        let token = token.to_owned();
        Box::pin(blocking(move || {
            keyring::Entry::new(VAULT_SERVICE, &id.to_string())
                .and_then(|entry| entry.set_password(&token))
                .map_err(|error| error.to_string())
        }))
    }
    fn delete(&self, id: Uuid) -> CredentialFuture<'_, ()> {
        Box::pin(blocking(move || {
            match keyring::Entry::new(VAULT_SERVICE, &id.to_string())
                .and_then(|entry| entry.delete_credential())
            {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(error.to_string()),
            }
        }))
    }
    fn ensure_ready(&self) -> CredentialFuture<'_, ()> {
        Box::pin(async {
            static PROBE: OnceLock<Mutex<()>> = OnceLock::new();
            let guard = PROBE.get_or_init(|| Mutex::new(())).try_lock()
                .map_err(|_| "An unlock check is still waiting for secure storage. Complete its prompt before retrying.")?;
            let task = blocking(move || {
                // A timed-out native unlock operation keeps this guard until it ends.
                let _guard = guard;
                let value = Uuid::new_v4().to_string();
                let entry = keyring::Entry::new(VAULT_SERVICE, &format!("manager-check-{value}"))
                    .map_err(|error| error.to_string())?;
                entry
                    .set_password(&value)
                    .map_err(|error| error.to_string())?;
                let read = entry.get_password().map_err(|error| error.to_string());
                entry
                    .delete_credential()
                    .map_err(|error| error.to_string())?;
                if read? != value {
                    return Err("Secure storage returned an unexpected credential".into());
                }
                Ok(())
            });
            tokio::time::timeout(std::time::Duration::from_secs(30), task).await
                .map_err(|_| "Secure storage did not respond. Unlock your keyring and retry.")?
                .map_err(|error| format!("Secure storage is unavailable. Unlock your keyring before pairing. {error}"))
        })
    }
}
