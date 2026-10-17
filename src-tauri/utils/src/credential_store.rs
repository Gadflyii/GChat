//! Per-user credential selection shared by Chat, Manager, connectors and Gbot.
use serde::{Deserialize, Serialize};
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

#[cfg(any(not(target_os = "linux"), test))]
mod native_store {
    use super::*;

    pub struct Store {
        root: PathBuf,
        native: Arc<dyn Native>,
    }
    impl Store {
        pub fn new(root: &Path) -> Self {
            Self {
                root: root.join("credentials"),
                #[cfg(target_os = "windows")]
                native: Arc::new(windows::WindowsNative::new()),
                #[cfg(not(target_os = "windows"))]
                native: Arc::new(NativeProvider),
            }
        }
        #[cfg(test)]
        pub(super) fn with_native(root: &Path, native: Arc<dyn Native>) -> Self {
            Self {
                native,
                ..Self::new(root)
            }
        }
        pub(super) fn root(&self) -> PathBuf {
            self.root.clone()
        }
        pub fn get(
            &self,
            service: &str,
            account: &str,
        ) -> Result<Option<Zeroizing<Vec<u8>>>, Error> {
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
            // Availability is checked explicitly when a credential is needed.
            Status {
                ready: false,
                tier: Some(Tier::Native),
                state: "unchecked".into(),
                can_create: false,
                error: None,
                migrating: false,
            }
        }
    }
}
#[cfg(not(target_os = "linux"))]
pub use native_store::Store;

#[cfg(any(target_os = "windows", test))]
mod windows;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::Store;

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::BTreeMap, fs, io::Write, process::Command};

    // Synthetic test records only. This replaces the OS service, never its Store adapter.
    struct PersistentNative {
        path: PathBuf,
    }
    impl PersistentNative {
        fn records(&self) -> Result<BTreeMap<String, Vec<u8>>, Error> {
            match fs::read(&self.path) {
                Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| Error::InvalidData),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
                Err(_) => Err(Error::Unavailable),
            }
        }
        fn save(&self, records: &BTreeMap<String, Vec<u8>>) -> Result<(), Error> {
            let bytes = serde_json::to_vec(records).map_err(|_| Error::InvalidData)?;
            let mut file = fs::File::create(&self.path).map_err(|_| Error::Unavailable)?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| Error::Unavailable)
        }
    }
    impl Native for PersistentNative {
        fn present(&self) -> Result<bool, Error> {
            Ok(true)
        }
        fn get(&self, reference: &Reference) -> Result<Option<Vec<u8>>, Error> {
            Ok(self.records()?.get(&reference.identity()?).cloned())
        }
        fn put(&self, reference: &Reference, bytes: &[u8]) -> Result<(), Error> {
            let mut records = self.records()?;
            records.insert(reference.identity()?, bytes.into());
            self.save(&records)
        }
        fn delete(&self, reference: &Reference) -> Result<(), Error> {
            let mut records = self.records()?;
            records.remove(&reference.identity()?);
            self.save(&records)
        }
    }

    fn round_trip_phase(
        phase: &str,
        get: impl Fn(&Reference) -> Result<Option<Zeroizing<Vec<u8>>>, Error>,
        put: impl Fn(&Reference, &[u8]) -> Result<(), Error>,
        delete: impl Fn(&Reference) -> Result<(), Error>,
    ) {
        let records = [
            (
                Reference::new("app.gchat.ginfer-host", "same-account"),
                b"fixture-token".as_slice(),
            ),
            (
                Reference::new("app.gchat.gbot", "same-account"),
                b"\0\xfffixture-key".as_slice(),
            ),
            (
                Reference::new("app.gchat.ginfer-host", "other-account"),
                b"other-token".as_slice(),
            ),
        ];
        match phase {
            "write" => {
                for (reference, bytes) in &records {
                    assert!(get(reference).unwrap().is_none());
                    put(reference, bytes).unwrap();
                }
            }
            "read-delete" => {
                for (reference, bytes) in &records {
                    assert_eq!(get(reference).unwrap().unwrap().as_slice(), *bytes);
                }
                delete(&records[0].0).unwrap();
                assert!(get(&records[0].0).unwrap().is_none());
                for (reference, bytes) in &records[1..] {
                    assert_eq!(get(reference).unwrap().unwrap().as_slice(), *bytes);
                    delete(reference).unwrap();
                }
            }
            "missing" => {
                for (reference, _) in &records {
                    assert!(get(reference).unwrap().is_none());
                }
            }
            _ => panic!("unknown credential restart phase"),
        }
    }

    #[test]
    fn native_credentials_survive_process_restart_and_deletion_through_the_seam() {
        const ROOT: &str = "GCHAT_CREDENTIAL_RESTART_TEST_ROOT";
        const PHASE: &str = "GCHAT_CREDENTIAL_RESTART_TEST_PHASE";
        const ADAPTER: &str = "GCHAT_CREDENTIAL_RESTART_TEST_ADAPTER";
        const TEST: &str = "credential_store::tests::native_credentials_survive_process_restart_and_deletion_through_the_seam";
        if let Some(root) = std::env::var_os(ROOT) {
            let root = PathBuf::from(root);
            let phase = std::env::var(PHASE).unwrap();
            let provider = Arc::new(PersistentNative {
                path: root.join("provider.json"),
            });
            match std::env::var(ADAPTER).unwrap().as_str() {
                "native-only" => {
                    let store = native_store::Store::with_native(&root, provider);
                    assert_eq!(store.root(), root.join("credentials"));
                    assert_eq!(store.status().state, "unchecked");
                    if phase == "write" {
                        store.require_ready().unwrap();
                    }
                    round_trip_phase(
                        &phase,
                        |r| store.get(&r.service, &r.account),
                        |r, bytes| store.put(&r.service, &r.account, bytes),
                        |r| store.delete(&r.service, &r.account),
                    );
                }
                #[cfg(target_os = "linux")]
                "linux" => {
                    let store = linux::Store::with_native(&root, provider);
                    assert_eq!(store.root(), root.join("credentials"));
                    assert_eq!(store.status().state, "unchecked");
                    if phase == "write" {
                        store.require_ready().unwrap();
                    }
                    round_trip_phase(
                        &phase,
                        |r| store.get(&r.service, &r.account),
                        |r, bytes| store.put(&r.service, &r.account, bytes),
                        |r| store.delete(&r.service, &r.account),
                    );
                }
                _ => panic!("unknown credential restart adapter"),
            }
            fs::write(
                root.join(format!("{phase}.done")),
                std::process::id().to_string(),
            )
            .unwrap();
            return;
        }

        let adapters = [
            "native-only",
            #[cfg(target_os = "linux")]
            "linux",
        ];
        for adapter in adapters {
            let directory = tempfile::tempdir().unwrap();
            // Each output() waits and reaps the preceding process before the next starts.
            // Only the fake provider's file and the real Store metadata cross the boundary.
            for phase in ["write", "read-delete", "missing"] {
                let result = Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", TEST, "--nocapture"])
                    .env(ROOT, directory.path())
                    .env(PHASE, phase)
                    .env(ADAPTER, adapter)
                    .output()
                    .unwrap();
                assert!(
                    result.status.success(),
                    "{adapter}/{phase}: {}{}",
                    String::from_utf8_lossy(&result.stdout),
                    String::from_utf8_lossy(&result.stderr)
                );
                assert!(
                    String::from_utf8_lossy(&result.stdout).contains("test result: ok. 1 passed;"),
                    "{adapter}/{phase} must execute exactly the selected test"
                );
                let pid: u32 = fs::read_to_string(directory.path().join(format!("{phase}.done")))
                    .unwrap()
                    .parse()
                    .unwrap();
                assert_ne!(pid, std::process::id(), "phase must run in another process");
            }
        }
    }
}
