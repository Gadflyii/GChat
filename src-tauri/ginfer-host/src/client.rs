//! Shared native paired-host client. Discovery proposes addresses; enrollment owns trust.
//! Desktop adapters inject their credential vault; tokens never enter metadata or UI state.
use crate::{
    discovery::Discovery,
    engine_registry::{EngineRegistry, RegisteredHost},
    transport::{host_snapshot_with_client, pinned_client, response_json},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::Arc,
};
use tokio::sync::Mutex;
use uuid::Uuid;

/// Availability failures are separate from authentication, trust and configuration problems.
#[derive(Debug)]
pub enum ClientError {
    Offline(String),
    Problem(String),
}
impl ClientError {
    pub fn is_offline(&self) -> bool {
        matches!(self, Self::Offline(_))
    }
}
impl std::fmt::Display for ClientError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Offline(message) | Self::Problem(message) => formatter.write_str(message),
        }
    }
}
impl std::error::Error for ClientError {}
impl From<String> for ClientError {
    fn from(message: String) -> Self {
        Self::Problem(message)
    }
}
impl From<&str> for ClientError {
    fn from(message: &str) -> Self {
        Self::Problem(message.into())
    }
}
impl From<ClientError> for String {
    fn from(error: ClientError) -> Self {
        error.to_string()
    }
}
impl From<reqwest::Error> for ClientError {
    fn from(error: reqwest::Error) -> Self {
        use std::error::Error;
        let mut offline = error.is_timeout();
        let mut message = error.to_string();
        let mut source = error.source();
        while let Some(cause) = source {
            if let Some(io) = cause.downcast_ref::<std::io::Error>() {
                offline |= (error.is_connect() || error.is_request())
                    && io.kind() == std::io::ErrorKind::UnexpectedEof;
                offline |= matches!(
                    io.kind(),
                    std::io::ErrorKind::ConnectionRefused
                        | std::io::ErrorKind::ConnectionReset
                        | std::io::ErrorKind::NotConnected
                        | std::io::ErrorKind::TimedOut
                        | std::io::ErrorKind::NetworkUnreachable
                        | std::io::ErrorKind::HostUnreachable
                );
            }
            let detail = cause.to_string();
            if !message.contains(&detail) {
                message.push_str(&format!(": {detail}"));
            }
            source = cause.source();
        }
        if offline {
            Self::Offline(message)
        } else {
            Self::Problem(message)
        }
    }
}

pub const VAULT_SERVICE: &str = "app.gchat.ginfer-host";
pub type CredentialFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;
pub trait CredentialStore: Send + Sync {
    fn get(&self, id: Uuid) -> CredentialFuture<'_, String>;
    fn set<'a>(&'a self, id: Uuid, token: &'a str) -> CredentialFuture<'a, ()>;
    fn delete(&self, id: Uuid) -> CredentialFuture<'_, ()>;
    fn ensure_ready(&self) -> CredentialFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
pub struct SavedHost {
    pub host_id: Uuid,
    pub name: String,
    pub base_url: String,
    pub certificate_sha256: String,
    pub client_id: Uuid,
}
#[derive(Default)]
pub struct ClientState {
    transports: BTreeMap<Uuid, HostTransport>,
    local_credentials: BTreeMap<Uuid, String>,
    path: Option<PathBuf>,
    installation_id: Option<Uuid>,
    imported: BTreeSet<PathBuf>,
    fleet_authority: Option<crate::fleet::AuthorityLocator>,
    fleet_snapshot: Option<crate::fleet::FleetSnapshot>,
    pub saved: BTreeMap<Uuid, SavedHost>,
    pub registry: EngineRegistry,
    discovery: Option<Discovery>,
    pub snapshots: BTreeMap<Uuid, Value>,
}
struct HostTransport {
    certificate_sha256: String,
    client_id: Uuid,
    client: reqwest::Client,
}
impl HostTransport {
    fn matches(&self, host: &SavedHost) -> bool {
        self.certificate_sha256 == host.certificate_sha256 && self.client_id == host.client_id
    }
}
#[derive(Serialize, Deserialize)]
struct Document {
    schema: String,
    #[serde(default)]
    installation_id: Option<Uuid>,
    hosts: Vec<SavedHost>,
    #[serde(default)]
    imported: BTreeSet<PathBuf>,
    #[serde(default)]
    fleet_authority: Option<crate::fleet::AuthorityLocator>,
    #[serde(default)]
    fleet_snapshot: Option<crate::fleet::FleetSnapshot>,
}
pub struct Client {
    state: Mutex<ClientState>,
    credentials: Arc<dyn CredentialStore>,
    configured_path: Option<PathBuf>,
    operation: Mutex<()>,
}
/// Read-only native routing view. Mutations stay behind the client's locked operations.
pub struct ClientViewGuard<'a>(tokio::sync::MutexGuard<'a, ClientState>);
impl std::ops::Deref for ClientViewGuard<'_> {
    type Target = ClientState;
    fn deref(&self) -> &ClientState {
        &self.0
    }
}
#[derive(Serialize)]
pub struct PairRequest {
    pub host_id: Option<Uuid>,
    pub base_url: Option<String>,
    pub client_name: String,
}
struct RegistryLock(std::fs::File);
impl Drop for RegistryLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}
fn endpoint(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value).map_err(|e| e.to_string())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(
            "host address must be an HTTPS origin, for example https://192.168.1.10:7443".into(),
        );
    }
    Ok(url.as_str().trim_end_matches('/').into())
}
fn read_document(path: &Path) -> Result<Document, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Document {
                schema: "ginfer-host-client-v1".into(),
                installation_id: None,
                hosts: vec![],
                imported: Default::default(),
                fleet_authority: None,
                fleet_snapshot: None,
            })
        }
        Err(e) => return Err(e.to_string()),
    };
    let document: Document = serde_json::from_slice(&bytes)
        .map_err(|e| format!("cannot read shared engine hosts: {e}"))?;
    if document.schema != "ginfer-host-client-v1" {
        return Err("unsupported host client registry schema".into());
    }
    for host in &document.hosts {
        endpoint(&host.base_url)?;
        if host.certificate_sha256.len() != 64 || hex::decode(&host.certificate_sha256).is_err() {
            return Err("invalid saved host certificate pin".into());
        }
    }
    Ok(document)
}
fn reload(state: &mut ClientState) -> Result<(), String> {
    let document = read_document(state.path.as_ref().ok_or("host registry not initialized")?)?;
    let saved: BTreeMap<_, _> = document
        .hosts
        .into_iter()
        .map(|host| (host.host_id, host))
        .collect();
    state.transports.retain(|id, transport| saved.get(id).is_some_and(|host| transport.matches(host)));
    let removed: Vec<_> = state
        .saved
        .keys()
        .filter(|id| !saved.contains_key(id))
        .copied()
        .collect();
    for id in removed {
        state.registry.forget(id);
        state.snapshots.remove(&id);
    }
    for (id, host) in &saved {
        if state.saved.get(id).is_none_or(|previous| {
            previous.client_id != host.client_id
                || previous.certificate_sha256 != host.certificate_sha256
        }) {
            state.registry.register_paired(registration(host));
            state.snapshots.remove(id);
        }
    }
    state.saved = saved;
    state.installation_id = document.installation_id;
    state.imported = document.imported;
    state.fleet_authority = document.fleet_authority;
    state.fleet_snapshot = document.fleet_snapshot;
    Ok(())
}
fn persist(state: &ClientState) -> Result<(), String> {
    crate::service::write_private(
        state.path.as_ref().ok_or("host registry not initialized")?,
        &serde_json::to_vec(&Document {
            schema: "ginfer-host-client-v1".into(),
            installation_id: state.installation_id,
            hosts: state.saved.values().cloned().collect(),
            imported: state.imported.clone(),
            fleet_authority: state.fleet_authority.clone(),
            fleet_snapshot: state.fleet_snapshot.clone(),
        })
        .map_err(|e| e.to_string())?,
    )
}
fn publish_fleet_authority(
    state: &mut ClientState,
    locator: crate::fleet::AuthorityLocator,
) -> Result<(), String> {
    if state.fleet_authority.as_ref() == Some(&locator) {
        return Ok(());
    }
    let previous = state.fleet_authority.replace(locator);
    let cache = state.fleet_snapshot.clone();
    if previous
        .as_ref()
        .map(|p| (p.host_id, &p.certificate_sha256))
        != state
            .fleet_authority
            .as_ref()
            .map(|p| (p.host_id, &p.certificate_sha256))
    {
        state.fleet_snapshot = None;
    }
    if let Err(error) = persist(state) {
        state.fleet_authority = previous;
        state.fleet_snapshot = cache;
        return Err(error);
    }
    Ok(())
}
fn registration(host: &SavedHost) -> RegisteredHost {
    RegisteredHost {
        host_id: host.host_id,
        display_name: host.name.clone(),
        credential_ref: host.client_id.to_string(),
        certificate_sha256: host.certificate_sha256.clone(),
    }
}
fn visible_hosts(state: &ClientState) -> Vec<Value> {
    state
        .saved
        .values()
        .map(|host| {
            let mut value = json!(host);
            value["local"] = state.local_credentials.contains_key(&host.client_id).into();
            value
        })
        .collect()
}

// Persist first while holding the registry lock. Readers never observe an
// unsaved replacement, and a failed write leaves the old credential reference live.
fn publish_registration(
    state: &mut ClientState,
    host: SavedHost,
) -> Result<Option<SavedHost>, String> {
    let id = host.host_id;
    let previous = state.saved.insert(id, host.clone());
    if let Err(error) = persist(state) {
        if let Some(previous) = previous {
            state.saved.insert(id, previous);
        } else {
            state.saved.remove(&id);
        }
        return Err(error);
    }
    state.registry.register_paired(registration(&host));
    if state.transports.get(&id).is_some_and(|transport| !transport.matches(&host)) {
        state.transports.remove(&id);
    }
    state.snapshots.remove(&id);
    Ok(previous)
}

fn remove_registration(state: &mut ClientState, id: Uuid) -> Result<SavedHost, String> {
    let previous = state.saved.remove(&id).ok_or("host is not registered")?;
    if let Err(error) = persist(state) {
        state.saved.insert(id, previous);
        return Err(error);
    }
    state.registry.forget(id);
    state.transports.remove(&id);
    state.snapshots.remove(&id);
    Ok(previous)
}

fn publish_local_owner(
    state: &mut ClientState,
    owner: crate::service::Persistent,
) -> Result<(), String> {
    let Some(origin) = owner.management_origin else {
        return Ok(());
    };
    let origin = endpoint(&origin)?;
    let client_id = owner.local_client_id.unwrap_or_else(|| {
        state
            .saved
            .get(&owner.host_id)
            .map(|host| host.client_id)
            .unwrap_or(owner.host_id)
    });
    let host = SavedHost {
        host_id: owner.host_id,
        name: owner.name,
        base_url: origin,
        certificate_sha256: owner.certificate.fingerprint(),
        client_id,
    };
    if state.saved.get(&host.host_id) != Some(&host) {
        publish_registration(state, host)?;
    }
    state
        .local_credentials
        .insert(client_id, owner.pairing_admin_token);
    Ok(())
}

impl Client {
    pub fn new(path: Option<PathBuf>, credentials: Arc<dyn CredentialStore>) -> Self {
        Self {
            state: Mutex::new(ClientState::default()),
            configured_path: path,
            credentials,
            operation: Mutex::new(()),
        }
    }
    fn state(&self) -> &Mutex<ClientState> {
        &self.state
    }
    pub async fn view(&self) -> Result<ClientViewGuard<'_>, String> {
        self.refresh().await?;
        Ok(ClientViewGuard(self.state.lock().await))
    }
    pub async fn initialize(&self) -> Result<(), String> {
        let mut state = self.state.lock().await;
        if state.path.is_none() {
            let path = match &self.configured_path {
                Some(path) => path.clone(),
                None => crate::local_host_registry::locator_path()?.with_file_name("hosts.json"),
            };
            if !path.is_absolute() {
                return Err("host registry path must be absolute".into());
            }
            state.path = Some(path);
            if let Err(e) = reload(&mut state) {
                state.path = None;
                return Err(e);
            }
        }
        Ok(())
    }
    /// Manager-first startup imports the registered owner's existing client metadata.
    /// This reads its configured storage; it does not start a host or enroll again.
    pub async fn initialize_from_local_owner(&self) -> Result<(), String> {
        self.initialize().await?;
        if let Some(owner) = crate::local_host_registry::registered().await? {
            self.initialize_from_owner(&owner).await?;
        }
        Ok(())
    }
    pub async fn initialize_from_owner(
        &self,
        owner: &crate::local_host_registry::Owner,
    ) -> Result<(), String> {
        self.initialize().await?;
        let provider = match owner {
            crate::local_host_registry::Owner::Desktop(local) => local.desktop_provider.as_deref(),
            // Service client metadata lives beside the private host directory.
            crate::local_host_registry::Owner::Service { directory, .. } => directory.parent(),
        };
        if let Some(provider) = provider {
            let legacy = provider.join("hosts.json");
            let shared = self.state.lock().await.path.as_ref() == Some(&legacy);
            if !shared {
                self.import_legacy(&legacy).await?;
            }
        }
        Ok(())
    }
    async fn lock_registry(&self) -> Result<RegistryLock, String> {
        self.initialize().await?;
        let path = self.state.lock().await.path.clone().unwrap();
        tokio::task::spawn_blocking(move || {
            let parent = path.parent().ok_or("host registry has no parent")?;
            let mut directory = std::fs::DirBuilder::new();
            directory.recursive(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                directory.mode(0o700);
            }
            directory.create(parent).map_err(|e| e.to_string())?;
            let mut options = std::fs::OpenOptions::new();
            options.create(true).read(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let file = options
                .open(path.with_extension("lock"))
                .map_err(|e| e.to_string())?;
            file.lock().map_err(|e| e.to_string())?;
            Ok(RegistryLock(file))
        })
        .await
        .map_err(|e| e.to_string())?
    }
    async fn refresh(&self) -> Result<(), String> {
        self.initialize().await?;
        reload(&mut *self.state.lock().await)
    }
    pub async fn import_legacy(&self, path: &Path) -> Result<(), String> {
        let _operation = self.operation.lock().await;
        let _lock = self.lock_registry().await?;
        let mut state = self.state.lock().await;
        reload(&mut state)?;
        if state.imported.contains(path) {
            return Ok(());
        }
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e.to_string()),
        };
        let hosts: Vec<SavedHost> = serde_json::from_slice(&bytes)
            .map_err(|e| format!("cannot import saved engine hosts: {e}"))?;
        for host in &hosts {
            endpoint(&host.base_url)?;
        }
        let previous = state.saved.clone();
        for host in hosts {
            state.saved.entry(host.host_id).or_insert(host);
        }
        state.imported.insert(path.to_path_buf());
        if let Err(e) = persist(&state) {
            state.saved = previous;
            state.imported.remove(path);
            return Err(e);
        }
        reload(&mut state)?;
        // The disk merge above precedes publishing newly imported routes.
        for host in state.saved.values().cloned().collect::<Vec<_>>() {
            state.registry.register_paired(registration(&host));
        }
        Ok(())
    }
    async fn attach_local(&self) -> Result<Option<Uuid>, String> {
        let Some(owner) = crate::local_host_registry::registered().await? else {
            return Ok(None);
        };
        // Ownership/connection stays in the existing locator implementation.
        let connection = tokio::time::timeout(std::time::Duration::from_secs(10), owner.connect())
            .await
            .unwrap_or_else(|_| Err("local host did not respond".into()));
        if let Ok(control) = &connection {
            tokio::time::timeout(
                std::time::Duration::from_secs(10),
                control.request("/host/v1/local-client", Some(json!({}))),
            )
            .await
            .map_err(|_| "local host did not respond".to_string())??;
        }
        let directory = match owner {
            crate::local_host_registry::Owner::Desktop(local) => local.directory,
            crate::local_host_registry::Owner::Service { directory, .. } => directory,
        };
        let private: crate::service::Persistent = serde_json::from_slice(
            &std::fs::read(directory.join("host.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let id = private.host_id;
        let _lock = self.lock_registry().await?;
        let mut state = self.state.lock().await;
        reload(&mut state)?;
        publish_local_owner(&mut state, private)?;
        // Retain the known local identity even when its service is currently offline.
        connection?;
        Ok(Some(id))
    }
    pub async fn local_host(&self) -> Result<Option<Uuid>, String> {
        self.attach_local().await
    }
    pub async fn registered(&self) -> Result<Vec<SavedHost>, String> {
        self.refresh().await?;
        Ok(self.state.lock().await.saved.values().cloned().collect())
    }
    pub async fn list(&self) -> Result<Value, String> {
        let local_error = self.attach_local().await.err();
        let mut result = self.command("list", json!({})).await?;
        result["local_error"] = json!(local_error);
        Ok(result)
    }
    pub async fn discovery(&self, enabled: bool) -> Result<Value, String> {
        self.command("discovery", json!({"enabled":enabled})).await
    }
    pub async fn pair(&self, args: PairRequest) -> Result<Value, String> {
        self.command("pair", json!(args)).await
    }
    /// Enroll an authority endorsed by a paired host, retaining its exact identity and pin.
    pub async fn pair_locator(
        &self,
        locator: &crate::fleet::AuthorityLocator,
        client_name: &str,
    ) -> Result<Value, String> {
        locator.validate()?;
        self.command("pair",json!({"host_id":locator.host_id,"origins":locator.origins,"expected_certificate_sha256":locator.certificate_sha256,"client_name":client_name})).await
    }
    pub async fn snapshots(&self, ids: &[Uuid]) -> Vec<Result<Value, ClientError>> {
        futures_util::future::join_all(ids.iter().map(|id| self.snapshot(*id))).await
    }
    pub async fn snapshot(&self, id: Uuid) -> Result<Value, ClientError> {
        self.refresh().await?;
        let (connection, host, alternatives) = {
            let mut state = self.state().lock().await;
            let host = state
                .saved
                .get(&id)
                .cloned()
                .ok_or("host is not registered")?;
            let alternatives = state
                .discovery
                .as_ref()
                .map(|d| d.hosts())
                .unwrap_or_default()
                .into_iter()
                .filter(|h| h.host_id == id.to_string())
                .flat_map(|h| h.urls)
                .filter(|url| url != &host.base_url)
                .collect::<std::collections::BTreeSet<_>>();
            (state.registry.poll_connection(id)?, host, alternatives)
        };
        let mut network_started = false;
        let result = tokio::time::timeout(std::time::Duration::from_secs(10), async {
            use futures_util::StreamExt;
            let token = self.secret(host.client_id).await?;
            network_started = true;
            let client = self.pinned_transport(&host).await?;
            match host_snapshot_with_client(&host.base_url, &client, &token, id).await {
                Ok(snapshot) => Ok((host.base_url.clone(), snapshot)),
                Err(mut error) => {
                    let mut probes =
                        futures_util::stream::iter(alternatives.into_iter().map(|url| {
                            let client = &client;
                            let token = &token;
                            async move {
                                host_snapshot_with_client(&url, client, token, id)
                                    .await
                                    .map(|s| (url, s))
                            }
                        }))
                        .buffer_unordered(4);
                    while let Some(result) = probes.next().await {
                        match result {
                            Ok(found) => return Ok(found),
                            Err(problem) if error.is_offline() && !problem.is_offline() => {
                                error = problem
                            }
                            Err(_) => {}
                        }
                    }
                    Err(error)
                }
            }
        })
        .await
        .map_err(|_| {
            if network_started {
                ClientError::Offline("host did not respond".into())
            } else {
                ClientError::Problem("Secure storage did not respond".into())
            }
        })
        .and_then(|result| result);
        match result {
            Ok((origin, snapshot)) => {
                // HTTP runs without the metadata lock. Merge into the latest
                // disk document, never the pre-request copy held by this app.
                let _operation = self.operation.lock().await;
                let _lock = self.lock_registry().await?;
                let mut state = self.state().lock().await;
                reload(&mut state)?;
                if state.saved.get(&id) != Some(&host) {
                    state.registry.disconnect(connection);
                    return Err("host registration changed while observing its snapshot".into());
                }
                let validated = serde_json::from_value(snapshot.clone())
                    .map_err(|e| e.to_string())
                    .and_then(|parsed| state.registry.reconcile(connection, parsed));
                if let Err(error) = validated {
                    state.registry.disconnect(connection);
                    return Err(error.into());
                }
                let name = snapshot["display_name"]
                    .as_str()
                    .ok_or("host name missing")?;
                if origin != host.base_url || name != host.name {
                    let saved = state.saved.get_mut(&id).ok_or("host was forgotten")?;
                    let previous = saved.clone();
                    saved.base_url = origin;
                    saved.name = name.into();
                    if let Err(error) = persist(&state) {
                        state.saved.insert(id, previous);
                        state.registry.disconnect(connection);
                        return Err(error.into());
                    }
                }
                state.snapshots.insert(id, snapshot.clone());
                Ok(snapshot)
            }
            Err(e) => {
                self.state().lock().await.registry.disconnect(connection);
                Err(e)
            }
        }
    }
    pub async fn forget(&self, id: Uuid) -> Result<Value, String> {
        self.command("forget", json!({"host_id":id})).await
    }
    pub async fn secret(&self, id: Uuid) -> Result<String, String> {
        if let Some(token) = self.state.lock().await.local_credentials.get(&id).cloned() {
            return Ok(token);
        }
        self.credentials.get(id).await
    }
    pub async fn pinned_transport(&self, host: &SavedHost) -> Result<reqwest::Client, String> {
        let mut state = self.state.lock().await;
        if state.saved.get(&host.host_id).is_none_or(|current|
            current.certificate_sha256 != host.certificate_sha256 || current.client_id != host.client_id) {
            // An in-flight operation may outlive its registration; never cache that transport.
            return pinned_client(&host.certificate_sha256);
        }
        if let Some(transport) = state.transports.get(&host.host_id).filter(|transport| transport.matches(host)) {
            return Ok(transport.client.clone());
        }
        let client = pinned_client(&host.certificate_sha256)?;
        state.transports.insert(host.host_id, HostTransport {
            certificate_sha256: host.certificate_sha256.clone(), client_id: host.client_id, client: client.clone(),
        });
        Ok(client)
    }
    pub async fn request(
        &self,
        host_id: Uuid,
        method: reqwest::Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<reqwest::Response, ClientError> {
        self.refresh().await?;
        self.request_current(host_id, method, path, body).await
    }
    async fn request_current(
        &self,
        host_id: Uuid,
        method: reqwest::Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<reqwest::Response, ClientError> {
        self.prepare_request_current(host_id, method, path, body)
            .await?
            .send()
            .await
            .map_err(ClientError::from)
    }
    async fn prepare_request_current(
        &self,
        host_id: Uuid,
        method: reqwest::Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<reqwest::RequestBuilder, ClientError> {
        let host = self
            .state
            .lock()
            .await
            .saved
            .get(&host_id)
            .cloned()
            .ok_or("host is not registered")?;
        let token = self.secret(host.client_id).await?;
        let client = self.pinned_transport(&host).await?;
        let mut req = client
            .request(method, format!("{}{}", host.base_url, path))
            .bearer_auth(token)
            .timeout(std::time::Duration::from_secs(600));
        if let Some(body) = body {
            req = req.json(body);
        }
        Ok(req)
    }
    pub async fn request_json(
        &self,
        id: Uuid,
        method: reqwest::Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, ClientError> {
        response_json(self.request(id, method, path, body).await?).await
    }
    /// Bound the complete operation, keeping registry/vault waits distinct from
    /// host availability without allocating separate preparation/network budgets.
    pub(crate) async fn request_json_bounded(
        &self,
        id: Uuid,
        method: reqwest::Method,
        path: &str,
        body: Option<&Value>,
        timeout: std::time::Duration,
    ) -> Result<Value, ClientError> {
        let mut network_started = false;
        tokio::time::timeout(timeout, async {
            self.refresh().await?;
            let request = self.prepare_request_current(id, method, path, body).await?;
            network_started = true;
            let response = request.send().await.map_err(ClientError::from)?;
            response_json(response).await
        })
        .await
        .map_err(|_| {
            if network_started {
                ClientError::Offline("Fleet host did not respond".into())
            } else {
                ClientError::Problem(
                    "Host request preparation did not respond; check the registry and secure storage"
                        .into(),
                )
            }
        })?
    }
    async fn rollback_pairing(
        &self,
        client: &reqwest::Client,
        origin: &str,
        id: Uuid,
        token: &str,
    ) -> String {
        let mut warnings = Vec::new();
        if let Err(e) = self.credentials.delete(id).await {
            warnings.push(format!("new vault credential cleanup failed: {e}"));
        }
        match client
            .delete(format!("{origin}/host/v1/clients/{id}"))
            .bearer_auth(token)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {}
            _ => warnings.push("new host grant could not be revoked; remove it on the host".into()),
        }
        if warnings.is_empty() {
            String::new()
        } else {
            format!("; {}", warnings.join("; "))
        }
    }
    pub async fn command(&self, action: &str, args: Value) -> Result<Value, String> {
        let serialized = matches!(action, "pair" | "forget");
        let _operation = if serialized {
            Some(self.operation.lock().await)
        } else {
            None
        };
        let _lock = if serialized {
            Some(self.lock_registry().await?)
        } else {
            None
        };
        self.refresh().await?;
        match action {
            "list" => {
                let state = self.state().lock().await;
                Ok(
                    json!({"registered":visible_hosts(&state),"discovered":state.discovery.as_ref().map(|d|d.hosts()).unwrap_or_default()}),
                )
            }
            "discovery" => {
                let enabled = args
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .ok_or("enabled is required")?;
                let mut state = self.state().lock().await;
                if enabled && state.discovery.is_none() {
                    state.discovery = Some(Discovery::start()?);
                }
                if !enabled {
                    state.discovery = None;
                }
                Ok(json!({"enabled":enabled}))
            }
            "pair" => {
                self.credentials.ensure_ready().await?;
                let expected = args
                    .get("host_id")
                    .and_then(Value::as_str)
                    .map(str::parse::<Uuid>)
                    .transpose()
                    .map_err(|error| error.to_string())?;
                let origins = if let Some(origins) = args.get("origins") {
                    let origins: Vec<String> =
                        serde_json::from_value(origins.clone()).map_err(|e| e.to_string())?;
                    origins
                        .iter()
                        .map(|origin| endpoint(origin))
                        .collect::<Result<Vec<_>, _>>()?
                } else if let Some(id) = expected {
                    self.state().lock().await.discovery.as_ref().map(|discovery| discovery.hosts())
                    .unwrap_or_default().into_iter().find(|host| host.host_id == id.to_string())
                    .ok_or("Host is no longer nearby; refresh discovery or enter its address manually")?.urls
                } else {
                    vec![endpoint(
                        args.get("base_url")
                            .and_then(Value::as_str)
                            .ok_or("host address is required")?,
                    )?]
                };
                let (base_url, host_id, host_name, fingerprint) =
                    crate::transport::pairing_origin(&origins, expected).await?;
                if let Some(pin) = args
                    .get("expected_certificate_sha256")
                    .and_then(Value::as_str)
                {
                    if pin != fingerprint {
                        return Err(
                            "Fleet coordinator certificate does not match its paired-host locator"
                                .into(),
                        );
                    }
                }
                if let Some(saved) = self.state().lock().await.saved.get(&host_id) {
                    if saved.certificate_sha256 != fingerprint {
                        return Err("Paired host certificate has changed; forget it explicitly before pairing again".into());
                    }
                    return Ok(json!({"host_id":host_id}));
                }
                let client = pinned_client(&fingerprint)?;
                let paired = response_json(
                client
                    .post(format!("{base_url}/host/v1/pair"))
                    .timeout(std::time::Duration::from_secs(10))
                    .json(&json!({"client_name":args["client_name"].as_str().filter(|name| !name.trim().is_empty()).ok_or("client name is required")?}))
                    .send()
                    .await
                    .map_err(|e| e.to_string())?,
            )
            .await?;
                if paired.get("host_id").and_then(Value::as_str)
                    != Some(host_id.to_string().as_str())
                {
                    return Err("pairing returned a different host identity".into());
                }
                let token = paired
                    .get("token")
                    .and_then(Value::as_str)
                    .ok_or("pairing returned no credential")?
                    .to_owned();
                let client_id = paired
                    .get("client_id")
                    .and_then(Value::as_str)
                    .ok_or("pairing returned no client identity")?
                    .parse::<Uuid>()
                    .map_err(|e| e.to_string())?;
                let stored = self.credentials.set(client_id, &token).await;
                if let Err(error) = stored {
                    return Err(format!(
                        "{error}{}",
                        self.rollback_pairing(&client, &base_url, client_id, &token)
                            .await
                    ));
                }
                let host = SavedHost {
                    host_id,
                    name: host_name,
                    base_url,
                    certificate_sha256: fingerprint,
                    client_id,
                };
                let mut state = self.state().lock().await;
                let published = publish_registration(&mut state, host.clone());
                drop(state);
                let previous = match published {
                    Ok(previous) => previous,
                    Err(error) => {
                        return Err(format!(
                            "{error}{}",
                            self.rollback_pairing(&client, &host.base_url, client_id, &token)
                                .await
                        ))
                    }
                };
                let mut cleanup_warnings = Vec::new();
                if let Some(previous) = previous {
                    match client
                        .delete(format!(
                            "{}/host/v1/clients/{}",
                            host.base_url, previous.client_id
                        ))
                        .bearer_auth(&token)
                        .timeout(std::time::Duration::from_secs(5))
                        .send()
                        .await
                    {
                        Ok(response) if response.status().is_success() => {}
                        _ => {
                            cleanup_warnings.push("old host grant could not be revoked".to_string())
                        }
                    }
                    if let Err(error) = self.credentials.delete(previous.client_id).await {
                        cleanup_warnings.push(format!(
                            "old OS-vault credential could not be removed: {error}"
                        ));
                    }
                }
                let mut result = json!(host);
                if let Some(fleet) = paired.get("fleet") {
                    result["fleet"] = fleet.clone();
                }
                if !cleanup_warnings.is_empty() {
                    result["credential_cleanup_warning"] = cleanup_warnings.join("; ").into();
                }
                Ok(result)
            }
            "snapshot" => self
                .snapshot(argument_id(&args, "host_id")?)
                .await
                .map_err(String::from),
            "host_name" | "lan_sharing" | "remove_model" | "download" | "download_action"
            | "profile_launch" | "launch" | "start" | "stop" | "restart" | "reload" | "scan" => {
                let id = argument_id(&args, "host_id")?;
                let path = match action {
                    "host_name" => "/host/v1/name".into(),
                    "lan_sharing" => "/host/v1/lan-sharing".into(),
                    "launch" => "/host/v1/instances".into(),
                    "profile_launch" => "/host/v1/profile-launch".into(),
                    "scan" => "/host/v1/scan".into(),
                    "download" => "/host/v1/downloads".into(),
                    "download_action" => "/host/v1/download-actions".into(),
                    "remove_model" => "/host/v1/remove-model".into(),
                    _ => format!(
                        "/host/v1/instances/{}/{}",
                        argument_id(&args, "instance_id")?,
                        action
                    ),
                };
                response_json(
                    self.request_current(
                        id,
                        reqwest::Method::POST,
                        &path,
                        Some(args.get("body").unwrap_or(&json!({}))),
                    )
                    .await?,
                )
                .await
                .map_err(String::from)
            }
            "forget" => {
                let id = argument_id(&args, "host_id")?;
                // Forget is local and works while a server is offline. Revoke is a separate host action.
                let mut state = self.state().lock().await;
                if state
                    .saved
                    .get(&id)
                    .is_some_and(|host| state.local_credentials.contains_key(&host.client_id))
                {
                    return Err("The local host is managed automatically; stop its instances instead of forgetting this computer".into());
                }
                let previous = remove_registration(&mut state, id)?;
                drop(state);
                let warning = self.credentials.delete(previous.client_id).await.err();
                Ok(json!({"forgotten":id,"credential_cleanup_warning":warning}))
            }
            _ => Err("unknown engine-host command".into()),
        }
    }
    /// Stable private installation provenance; separate from host-issued grants.
    pub async fn installation_id(&self) -> Result<Uuid, String> {
        let _operation = self.operation.lock().await;
        let _lock = self.lock_registry().await?;
        let mut state = self.state.lock().await;
        reload(&mut state)?;
        if let Some(id) = state.installation_id {
            return Ok(id);
        }
        let id = Uuid::new_v4();
        state.installation_id = Some(id);
        if let Err(e) = persist(&state) {
            state.installation_id = None;
            return Err(e);
        }
        Ok(id)
    }
    pub async fn fleet_authority(&self) -> Result<Option<crate::fleet::AuthorityLocator>, String> {
        self.refresh().await?;
        Ok(self.state.lock().await.fleet_authority.clone())
    }
    pub async fn cached_fleet(&self) -> Result<Option<crate::fleet::FleetSnapshot>, String> {
        self.refresh().await?;
        Ok(self.state.lock().await.fleet_snapshot.clone())
    }
    pub async fn set_fleet_authority(
        &self,
        locator: crate::fleet::AuthorityLocator,
    ) -> Result<(), String> {
        locator.validate()?;
        let _op = self.operation.lock().await;
        let _lock = self.lock_registry().await?;
        let mut state = self.state.lock().await;
        reload(&mut state)?;
        publish_fleet_authority(&mut state, locator)
    }
    /// A discovered locator may initialize the fleet, but never replace another app's choice.
    pub async fn adopt_fleet_authority_if_unconfigured(
        &self,
        locator: crate::fleet::AuthorityLocator,
    ) -> Result<crate::fleet::AuthorityLocator, String> {
        locator.validate()?;
        let _op = self.operation.lock().await;
        let _lock = self.lock_registry().await?;
        let mut state = self.state.lock().await;
        reload(&mut state)?;
        if let Some(current) = &state.fleet_authority {
            return Ok(current.clone());
        }
        publish_fleet_authority(&mut state, locator.clone())?;
        Ok(locator)
    }
    /// Refresh the same observation only while its complete locator remains current.
    pub async fn refresh_fleet_authority(
        &self,
        expected: &crate::fleet::AuthorityLocator,
        published: crate::fleet::AuthorityLocator,
    ) -> Result<bool, String> {
        published.validate()?;
        if published.host_id != expected.host_id
            || published.certificate_sha256 != expected.certificate_sha256
        {
            return Err("fleet observation changed its coordinator identity".into());
        }
        let _op = self.operation.lock().await;
        let _lock = self.lock_registry().await?;
        let mut state = self.state.lock().await;
        reload(&mut state)?;
        if state.fleet_authority.as_ref() != Some(expected) {
            return Ok(false);
        }
        publish_fleet_authority(&mut state, published)?;
        Ok(true)
    }
    pub async fn save_fleet_snapshot(
        &self,
        snapshot: crate::fleet::FleetSnapshot,
    ) -> Result<(), String> {
        snapshot.validate()?;
        let _op = self.operation.lock().await;
        let _lock = self.lock_registry().await?;
        let mut state = self.state.lock().await;
        reload(&mut state)?;
        if state.fleet_authority.as_ref().is_none_or(|authority| {
            authority.host_id != snapshot.authority.host_id
                || authority.certificate_sha256 != snapshot.authority.certificate_sha256
        }) {
            return Err("fleet authority changed while observing its catalog".into());
        }
        if let Some(previous) = &state.fleet_snapshot {
            if previous.authority.host_id == snapshot.authority.host_id
                && previous.revision > snapshot.revision
            {
                return Err("stale fleet snapshot".into());
            }
        }
        let previous = state.fleet_snapshot.replace(snapshot);
        if let Err(e) = persist(&state) {
            state.fleet_snapshot = previous;
            return Err(e);
        }
        Ok(())
    }
}

fn argument_id(args: &Value, field: &str) -> Result<Uuid, String> {
    args.get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{field} is required"))?
        .parse::<Uuid>()
        .map_err(|e| e.to_string())
}
