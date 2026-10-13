//! Per-user credential selection shared by Chat, Manager, connectors and Gbot.
use serde::{Deserialize, Serialize};
#[cfg(target_os = "linux")]
use std::sync::Arc;
use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};
pub use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    MissingProvider,
    Locked,
    Unavailable,
    Missing,
    InvalidData,
    Conflict,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::MissingProvider => "No Secret Service provider is available. Install GNOME Keyring or choose a passphrase vault.",
            Self::Locked => "Secure storage is locked. Unlock the selected store before continuing.",
            Self::Unavailable => "Secure storage did not respond. Restore the selected provider and retry.",
            Self::Missing => "A referenced credential is missing. Recover it or explicitly reconnect before migrating.",
            Self::InvalidData => "The passphrase is incorrect or the encrypted vault is damaged.",
            Self::Conflict => "Secure storage changed. Retry with the current store.",
        })
    }
}
impl std::error::Error for Error {}
fn native_error(error: keyring::Error) -> Error {
    match error {
        keyring::Error::NoEntry => Error::Missing,
        keyring::Error::NoStorageAccess(_) => Error::Locked,
        keyring::Error::Ambiguous(_) => Error::Conflict,
        keyring::Error::BadEncoding(_)
        | keyring::Error::TooLong(_, _)
        | keyring::Error::Invalid(_, _) => Error::InvalidData,
        _ => Error::Unavailable,
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct Reference {
    pub service: String,
    pub account: String,
}
impl Reference {
    pub fn new(service: &str, account: &str) -> Self {
        Self {
            service: service.into(),
            account: account.into(),
        }
    }
    fn identity(&self) -> Result<String, Error> {
        serde_json::to_string(self).map_err(|_| Error::InvalidData)
    }
}
trait Native: Send + Sync {
    fn present(&self) -> Result<bool, Error>;
    fn get(&self, reference: &Reference) -> Result<Option<Vec<u8>>, Error>;
    fn put(&self, reference: &Reference, bytes: &[u8]) -> Result<(), Error>;
    fn delete(&self, reference: &Reference) -> Result<(), Error>;
    fn probe(&self) -> Result<(), Error> {
        use rand::RngCore;
        let mut random = [0; 16];
        rand::rngs::OsRng.fill_bytes(&mut random);
        let id = base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, random);
        let reference = Reference::new("app.gchat.ginfer-host", &format!("setup-check-{id}"));
        self.put(&reference, id.as_bytes())?;
        let result = self.get(&reference);
        self.delete(&reference)?;
        if result?.as_deref() != Some(id.as_bytes()) {
            return Err(Error::InvalidData);
        }
        Ok(())
    }
}
struct NativeProvider;
impl Native for NativeProvider {
    fn present(&self) -> Result<bool, Error> {
        #[cfg(target_os = "linux")]
        {
            let connection = match dbus::blocking::Connection::new_session() {
                Ok(connection) => connection,
                Err(_) => return Ok(false),
            };
            let proxy = connection.with_proxy(
                "org.freedesktop.DBus",
                "/org/freedesktop/DBus",
                std::time::Duration::from_secs(3),
            );
            let (owned,): (bool,) = proxy
                .method_call(
                    "org.freedesktop.DBus",
                    "NameHasOwner",
                    ("org.freedesktop.secrets",),
                )
                .map_err(|_| Error::Unavailable)?;
            if owned {
                return Ok(true);
            }
            let (names,): (Vec<String>,) = proxy
                .method_call("org.freedesktop.DBus", "ListActivatableNames", ())
                .map_err(|_| Error::Unavailable)?;
            Ok(names.iter().any(|name| name == "org.freedesktop.secrets"))
        }
        #[cfg(not(target_os = "linux"))]
        Ok(true)
    }
    fn get(&self, reference: &Reference) -> Result<Option<Vec<u8>>, Error> {
        let entry =
            keyring::Entry::new(&reference.service, &reference.account).map_err(native_error)?;
        let result = if reference.service == "app.gchat.gbot" {
            entry.get_secret()
        } else {
            entry.get_password().map(String::into_bytes)
        };
        match result {
            Ok(bytes) => Ok(Some(bytes)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(native_error(error)),
        }
    }
    fn put(&self, reference: &Reference, bytes: &[u8]) -> Result<(), Error> {
        let entry =
            keyring::Entry::new(&reference.service, &reference.account).map_err(native_error)?;
        if reference.service == "app.gchat.gbot" {
            entry.set_secret(bytes).map_err(native_error)
        } else {
            entry
                .set_password(std::str::from_utf8(bytes).map_err(|_| Error::InvalidData)?)
                .map_err(native_error)
        }
    }
    fn delete(&self, reference: &Reference) -> Result<(), Error> {
        match keyring::Entry::new(&reference.service, &reference.account)
            .and_then(|entry| entry.delete_credential())
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(native_error(error)),
        }
    }
}

#[derive(Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    Native,
    Passphrase,
}
#[derive(Serialize)]
pub struct Status {
    pub ready: bool,
    pub tier: Option<Tier>,
    pub state: String,
    pub can_create: bool,
    pub error: Option<String>,
    pub migrating: bool,
}

static STORE: OnceLock<Store> = OnceLock::new();
pub fn initialize(registry_root: &Path) -> Result<&'static Store, Error> {
    let store = STORE.get_or_init(|| Store::new(registry_root));
    if store.root() != registry_root.join("credentials") {
        return Err(Error::Conflict);
    }
    Ok(store)
}
pub fn shared() -> Result<&'static Store, Error> {
    STORE.get().ok_or(Error::Unavailable)
}

#[cfg(not(target_os = "linux"))]
pub struct Store {
    root: PathBuf,
    native: NativeProvider,
}
#[cfg(not(target_os = "linux"))]
impl Store {
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.join("credentials"),
            native: NativeProvider,
        }
    }
    fn root(&self) -> PathBuf {
        self.root.clone()
    }
    pub fn get(&self, service: &str, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, Error> {
        self.native
            .get(&Reference::new(service, account))
            .map(|bytes| bytes.map(Zeroizing::new))
    }
    pub fn put(&self, service: &str, account: &str, bytes: &[u8]) -> Result<(), Error> {
        self.native.put(&Reference::new(service, account), bytes)
    }
    pub fn delete(&self, service: &str, account: &str) -> Result<(), Error> {
        self.native.delete(&Reference::new(service, account))
    }
    pub fn require_ready(&self) -> Result<(), Error> {
        self.native.probe()
    }
    pub fn status(&self) -> Status {
        let error = self.require_ready().err();
        Status {
            ready: error.is_none(),
            tier: Some(Tier::Native),
            state: if error.is_none() {
                "ready"
            } else {
                "unavailable"
            }
            .into(),
            can_create: false,
            error: error.map(|e| e.to_string()),
            migrating: false,
        }
    }
}

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::Store;
