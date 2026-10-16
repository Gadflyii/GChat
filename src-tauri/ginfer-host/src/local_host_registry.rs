//! One per-user locator; model storage and credentials remain with the host owner.
use crate::{launcher::LocalControl, local_host::LocalHost};
use std::{fs::OpenOptions, path::{Path, PathBuf}};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum Owner {
    Desktop(Box<LocalHost>),
    Service { directory: PathBuf, origin: String },
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Locator {
    schema: String,
    owner: Owner,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    identity: Option<serde_json::Value>,
}

impl Owner {
    pub fn directory(&self) -> &Path {
        match self { Self::Desktop(local) => &local.directory, Self::Service { directory, .. } => directory }
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        match self {
            Self::Desktop(local) => local.validate(),
            Self::Service { directory, origin } => {
                let url = reqwest::Url::parse(origin).map_err(|error| error.to_string())?;
                let address: std::net::IpAddr = url.host_str().ok_or("missing host address")?
                    .trim_matches(['[', ']']).parse().map_err(|_| "local host must use a loopback IP address")?;
                if !directory.is_absolute() || !address.is_loopback() || url.scheme() != "https"
                    || url.path() != "/" || url.query().is_some() || url.fragment().is_some()
                    || !url.username().is_empty() || url.password().is_some() || url.port() == Some(0) {
                    return Err("local service requires an absolute state path and HTTPS loopback origin".into());
                }
                Ok(())
            }
        }
    }

    pub async fn connect(&self) -> Result<LocalControl, String> {
        match self {
            Self::Desktop(local) => {
                let control = local.ensure_running().await?;
                refresh_connected(local.clone()).await?;
                Ok(control)
            }
            Self::Service { directory, origin } => {
                let control = LocalControl::open(directory, origin)?;
                control.snapshot().await?;
                Ok(control)
            }
        }
    }
}

pub(crate) fn same_directory(left: &Path, right: &Path) -> bool {
    left.canonicalize().unwrap_or_else(|_| left.to_owned())
        == right.canonicalize().unwrap_or_else(|_| right.to_owned())
}

fn write(path: &Path, mut owner: Owner) -> Result<Owner, String> {
    let identity = if let Owner::Desktop(local) = &mut owner {
        local.listen = crate::local_host::management_address(&local.directory, local.listen)?;
        match std::fs::read(local.directory.join("host.json")) {
            Ok(bytes) => {
                let state: crate::service::Persistent = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                Some(serde_json::json!({"host_id":state.host_id, "platform":std::env::consts::OS,
                    "state_directory":local.directory.canonicalize().map_err(|e| e.to_string())?}))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.to_string()),
        }
    } else { None };
    let bytes = serde_json::to_vec_pretty(&Locator {
        schema: "ginfer-local-host-v1".into(), owner: owner.clone(), identity,
    }).map_err(|error| error.to_string())?;
    if std::fs::read(path).ok().as_deref() != Some(bytes.as_slice()) {
        crate::service::write_private(path, &bytes)?;
    }
    Ok(owner)
}

pub fn locator_path() -> Result<PathBuf, String> {
    #[cfg(windows)]
    let root = std::env::var_os("APPDATA").map(PathBuf::from)
        .ok_or("APPDATA is unavailable")?.join("GInfer");
    #[cfg(not(windows))]
    let root = match std::env::var_os("XDG_CONFIG_HOME").filter(|value| !value.is_empty()) {
        Some(value) => PathBuf::from(value),
        None => PathBuf::from(std::env::var_os("HOME").ok_or("HOME is unavailable")?).join(".config"),
    }.join("ginfer");
    if !root.is_absolute() { return Err("local host configuration root must be absolute".into()); }
    Ok(root.join("local-host.json"))
}

fn read(path: &Path) -> Result<Option<Owner>, String> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Cannot read local host locator {}: {error}", path.display())),
    };
    let locator: Locator = serde_json::from_reader(file)
        .map_err(|error| format!("Invalid local host locator {}: {error}", path.display()))?;
    if locator.schema != "ginfer-local-host-v1" { return Err("Unsupported local host locator schema".into()); }
    locator.owner.validate()?;
    Ok(Some(locator.owner))
}

fn select(path: &Path, seed: Option<Owner>) -> Result<Owner, String> {
    if !matches!(&seed, Some(Owner::Desktop(_))) {
        if let Some(owner) = read(path)? { return Ok(owner); }
    }
    let seed = seed.ok_or("No local host is registered; install GInfer or enable the local engine in GChat first")?;
    seed.validate()?;
    let parent = path.parent().ok_or("local host locator has no parent")?;
    let mut directory = std::fs::DirBuilder::new();
    directory.recursive(true);
    #[cfg(unix)]
    { use std::os::unix::fs::DirBuilderExt; directory.mode(0o700); }
    directory.create(parent).map_err(|error| error.to_string())?;
    let mut options = OpenOptions::new();
    options.create(true).read(true).write(true);
    #[cfg(unix)]
    { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let lock = options.open(parent.join("local-host.lock")).map_err(|error| error.to_string())?;
    lock.lock().map_err(|error| error.to_string())?;
    if let Some(owner) = read(path)? {
        if let (Owner::Desktop(current), Owner::Desktop(updated)) = (&owner, &seed) {
            if same_directory(&current.directory, &updated.directory) {
                let mut refreshed = updated.clone();
                refreshed.listen = current.listen;
                return write(path, Owner::Desktop(refreshed));
            }
        }
        if !matches!(&seed, Owner::Desktop(_)) { return Ok(owner); }
        // A desktop owns its configured root. Registration never transfers another
        // installation's storage or stops its process; clients retain their owner.
    }
    write(path, seed)
}

async fn refresh_connected(local: Box<LocalHost>) -> Result<(), String> {
    let path = locator_path()?;
    tokio::task::spawn_blocking(move || {
        if !path.try_exists().map_err(|e| e.to_string())? { return Ok(()); }
        let Some(parent) = path.parent() else { return Err("local host locator has no parent".into()); };
        // Only refresh an existing registration; a direct private bootstrap does
        // not register itself, and a concurrent different root keeps its locator.
        let lock = OpenOptions::new().read(true).write(true).open(parent.join("local-host.lock"))
            .map_err(|e| e.to_string())?;
        lock.lock().map_err(|e| e.to_string())?;
        if let Some(Owner::Desktop(current)) = read(&path)? {
            if same_directory(&current.directory, &local.directory) {
                write(&path, Owner::Desktop(current))?;
            }
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

pub async fn resolve(seed: Option<Owner>) -> Result<Owner, String> {
    let path = locator_path()?;
    tokio::task::spawn_blocking(move || select(&path, seed)).await.map_err(|error| error.to_string())?
}

pub async fn registered() -> Result<Option<Owner>, String> {
    let path = locator_path()?;
    tokio::task::spawn_blocking(move || read(&path)).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn locator_records_root_identity_and_reuses_its_saved_management_port() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("provider/host");
        let host = crate::service::Host::open(directory.clone(), "Managed Host".into(),
            std::env::current_exe().unwrap(), vec![], vec![], vec![]).await.unwrap();
        host.data.lock().await.management_origin = Some("https://127.0.0.1:17445".into());
        host.save().await.unwrap();
        let local = LocalHost {
            binary: std::env::current_exe().unwrap(), engine: std::env::current_exe().unwrap(),
            engine_runtimes: Default::default(), directory: directory.clone(), desktop_provider: directory.parent().map(Path::to_owned),
            models: vec![], artifact_sets: vec![], name: "Fixture".into(), nvidia_smi: "unused".into(), listen: "127.0.0.1:17443".parse().unwrap(),
        };
        let path = root.path().join("config/local-host.json");
        let selected = select(&path, Some(Owner::Desktop(Box::new(local.clone())))).unwrap();
        let Owner::Desktop(selected) = selected else { panic!("desktop owner expected"); };
        assert_eq!(selected.listen.port(), 17445);
        let locator: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(locator["identity"]["host_id"], host.data.lock().await.host_id.to_string());
        assert_eq!(locator["identity"]["state_directory"], serde_json::json!(directory.canonicalize().unwrap()));
        assert_eq!(locator["identity"]["platform"], std::env::consts::OS);
        let Owner::Desktop(reopened) = select(&path, Some(Owner::Desktop(Box::new(local)))).unwrap() else { panic!("desktop owner expected"); };
        assert_eq!(reopened.listen.port(), 17445);
        assert_eq!(reopened.directory, directory);
    }

    #[test]
    fn desktop_roots_keep_their_own_owner_and_refresh_installed_paths() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("config/local-host.json");
        let provider = root.path().join("provider");
        let executable = root.path().join("ginfer-serve");
        std::fs::write(&executable, "engine").unwrap();
        let host = root.path().join("ginfer-host");
        std::fs::write(&host, "host").unwrap();
        let mut local = LocalHost {
            binary: host.clone(), engine: executable.clone(), engine_runtimes: Default::default(),
            directory: provider.join("host"), desktop_provider: Some(provider.clone()),
            models: vec![], artifact_sets: vec![], name: "computer".into(),
            nvidia_smi: "nvidia-smi".into(), listen: "127.0.0.1:7443".parse().unwrap(),
        };
        select(&path, Some(Owner::Desktop(Box::new(local.clone())))).unwrap();
        local.engine_runtimes.insert("8.6".into(), executable.clone());
        let refreshed = select(&path, Some(Owner::Desktop(Box::new(local.clone())))).unwrap();
        assert_eq!(serde_json::to_value(refreshed).unwrap()["engine_runtimes"]["8.6"], executable.to_string_lossy().as_ref());
        let other = root.path().join("other");
        local.desktop_provider = Some(other.clone());
        local.directory = other.join("host");
        select(&path, Some(Owner::Desktop(Box::new(local.clone())))).unwrap();
        let retained = select(&path, None).unwrap();
        assert_eq!(serde_json::to_value(retained).unwrap()["directory"], other.join("host").to_string_lossy().as_ref());
        // A service can still be the default for clients without a desktop root,
        // but cannot redirect an explicitly configured desktop installation.
        let service_path = root.path().join("service-config/local-host.json");
        select(&service_path, Some(Owner::Service { directory: root.path().join("service"),
            origin: "https://127.0.0.1:17443".into() })).unwrap();
        let selected = select(&service_path, Some(Owner::Desktop(Box::new(local)))).unwrap();
        assert_eq!(selected.directory(), other.join("host"));
    }

    #[test]
    fn concurrent_clients_keep_first_owner_and_storage() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("config/local-host.json");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let clients: Vec<_> = (0..8).map(|index| {
            let path = path.clone(); let barrier = barrier.clone();
            let directory = root.path().join(format!("existing-model-store-{index}"));
            std::thread::spawn(move || {
                barrier.wait();
                let owner = select(&path, Some(Owner::Service {
                    directory, origin: "https://127.0.0.1:7443".into(),
                })).unwrap();
                serde_json::to_value(owner).unwrap()
            })
        }).collect();
        let owners: Vec<_> = clients.into_iter().map(|client| client.join().unwrap()).collect();
        assert!(owners.iter().all(|owner| owner == &owners[0]));
        assert_eq!(serde_json::to_value(select(&path, None).unwrap()).unwrap(), owners[0]);
        assert!(!PathBuf::from(owners[0]["directory"].as_str().unwrap()).exists());
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt;
          assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600); }
    }

    #[test]
    fn damaged_record_is_not_replaced_by_another_installation() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("local-host.json");
        std::fs::write(&path, b"incomplete").unwrap();
        assert!(select(&path, Some(Owner::Service {
            directory: root.path().join("other"), origin: "https://127.0.0.1:7443".into(),
        })).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"incomplete");
    }
}
