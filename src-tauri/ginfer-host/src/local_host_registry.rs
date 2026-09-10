//! One per-user locator; model storage and credentials remain with the host owner.
use crate::{launcher::LocalControl, local_host::LocalHost};
use std::{fs::OpenOptions, path::{Path, PathBuf}};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum Owner {
    Desktop(LocalHost),
    Service { directory: PathBuf, origin: String },
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Locator {
    schema: String,
    owner: Owner,
}

impl Owner {
    fn validate(&self) -> Result<(), String> {
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
            Self::Desktop(local) => local.ensure_running().await,
            Self::Service { directory, origin } => {
                let control = LocalControl::open(directory, origin)?;
                control.snapshot().await?;
                Ok(control)
            }
        }
    }
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
    if let Some(owner) = read(path)? { return Ok(owner); }
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
    if let Some(owner) = read(path)? { return Ok(owner); }
    let bytes = serde_json::to_vec_pretty(&Locator {
        schema: "ginfer-local-host-v1".into(), owner: seed.clone(),
    }).map_err(|error| error.to_string())?;
    crate::service::write_private(path, &bytes)?;
    Ok(seed)
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
