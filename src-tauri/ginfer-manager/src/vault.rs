use ginfer_host::client::{CredentialFuture, CredentialStore, VAULT_SERVICE};
use uuid::Uuid;
pub struct NativeVault;
pub fn store() -> Result<&'static jan_utils::credential_store::Store, String> {
    let locator = ginfer_host::local_host_registry::locator_path()?;
    jan_utils::credential_store::initialize(
        locator.parent().ok_or("Host registry root is missing")?,
    )
    .map_err(|e| e.to_string())
}
async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let task = tokio::task::spawn_blocking(operation);
    tokio::time::timeout(std::time::Duration::from_secs(30), task)
        .await
        .map_err(|_| {
            "Secure storage did not respond. Unlock the selected store and retry.".to_string()
        })?
        .map_err(|e| e.to_string())?
}
async fn checked<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    use std::sync::{Arc, OnceLock};
    static CONTROL: OnceLock<Arc<tokio::sync::Mutex<()>>> = OnceLock::new();
    let guard = CONTROL.get_or_init(|| Arc::new(tokio::sync::Mutex::new(()))).clone().try_lock_owned()
        .map_err(|_| "Secure storage is still waiting for its provider. Complete its unlock prompt and retry.".to_string())?;
    blocking(move || {
        let _guard = guard;
        operation()
    })
    .await
}
impl CredentialStore for NativeVault {
    fn get(&self, id: Uuid) -> CredentialFuture<'_, String> {
        Box::pin(blocking(move || {
            let bytes = store()?
                .get(VAULT_SERVICE, &id.to_string())
                .map_err(|e| e.to_string())?
                .ok_or("Pairing credential is missing")?;
            String::from_utf8(bytes.to_vec()).map_err(|_| "Pairing credential is invalid".into())
        }))
    }
    fn set<'a>(&'a self, id: Uuid, token: &'a str) -> CredentialFuture<'a, ()> {
        let token = jan_utils::credential_store::Zeroizing::new(token.to_owned());
        Box::pin(blocking(move || {
            store()?
                .put(VAULT_SERVICE, &id.to_string(), token.as_bytes())
                .map_err(|e| e.to_string())
        }))
    }
    fn delete(&self, id: Uuid) -> CredentialFuture<'_, ()> {
        Box::pin(blocking(move || {
            store()?
                .delete(VAULT_SERVICE, &id.to_string())
                .map_err(|e| e.to_string())
        }))
    }
    fn ensure_ready(&self) -> CredentialFuture<'_, ()> {
        Box::pin(checked(|| {
            store()?.require_ready().map_err(|e| e.to_string())
        }))
    }
}
pub async fn control(
    operation: Option<String>,
    passphrase: Option<String>,
) -> Result<serde_json::Value, String> {
    let passphrase = passphrase.map(jan_utils::credential_store::Zeroizing::new);
    checked(move || {
        let store = store()?;
        #[cfg(target_os = "linux")]
        match operation.as_deref() {
            Some("unlock") => store
                .unlock(
                    passphrase
                        .as_deref()
                        .ok_or("Passphrase required")?
                        .as_bytes(),
                )
                .map_err(|e| e.to_string())?,
            Some("lock") => store.lock().map_err(|e| e.to_string())?,
            None | Some("status") => (),
            _ => {
                return Err(
                    "Create or migrate your passphrase vault in GChat, then unlock it here.".into(),
                )
            }
        }
        #[cfg(not(target_os = "linux"))]
        let _ = (operation, passphrase);
        serde_json::to_value(store.status()).map_err(|e| e.to_string())
    })
    .await
}
