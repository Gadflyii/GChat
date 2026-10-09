use crate::{
    engine_host::{EngineLaunch, HostProcesses, LaunchOptions},
    engine_inventory::{inspect_artifact, inspect_artifact_set, ArtifactMetadata},
    transport::HostCertificate,
};
use hmac::{Hmac, Mac};
use hyper::{Body, Request, Response, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
pub struct Gpu {
    pub uuid: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub memory_mib: u64,
    #[serde(default)]
    pub compute_capability: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct ModelEntry {
    pub id: Uuid,
    pub path: PathBuf,
    pub metadata: ArtifactMetadata,
    pub artifact_set: bool,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct LaunchRequest {
    pub instance_id: Option<Uuid>,
    #[serde(default)]
    pub qualified_profile_id: Option<String>,
    pub model_id: Uuid,
    pub gpu_uuids: Vec<String>,
    pub max_context: u32,
    pub concurrency: u32,
    #[serde(flatten)]
    pub options: LaunchOptions,
}
fn gpu_group(gpus: &[String]) -> Vec<String> {
    let mut group = gpus.to_vec();
    group.sort();
    group
}

fn consolidate_instances(data: &mut Persistent, directory: &Path) -> Result<(), String> {
    let mut groups = BTreeMap::new();
    let mut retired = BTreeMap::new();
    for (id, profile) in &data.profiles {
        if groups.insert(gpu_group(&profile.gpu_uuids), *id).is_some() {
            retired.insert(*id, profile.clone());
        }
    }
    if retired.is_empty() {
        return Ok(());
    }
    let archive = directory.join("retired-instance-records.json");
    let mut archived: BTreeMap<Uuid, LaunchRequest> = match std::fs::read(&archive) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string())?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
        Err(error) => return Err(error.to_string()),
    };
    archived.extend(retired.clone());
    write_private(
        &archive,
        &serde_json::to_vec(&archived).map_err(|error| error.to_string())?,
    )?;
    data.profiles.retain(|id, _| !retired.contains_key(id));
    Ok(())
}
#[derive(Serialize, Deserialize)]
pub struct ClientGrant {
    pub name: String,
    pub token_verifier: String,
}
fn default_share_lan() -> bool {
    true
}

#[derive(Serialize, Deserialize)]
pub struct Persistent {
    #[serde(default)]
    pub fleet: crate::fleet::FleetState,
    /// Keeps this host's catalog revisions monotonic across explicit ownership changes.
    #[serde(default)]
    pub fleet_revision: u64,
    /// Last-known read-only projection from the configured authority, never a catalog.
    #[serde(default)]
    pub fleet_membership: Option<crate::fleet::HostMembershipProjection>,
    #[serde(default = "default_share_lan")]
    pub share_lan: bool,
    #[serde(default)]
    pub management_origin: Option<String>,
    pub host_id: Uuid,
    pub name: String,
    pub certificate: HostCertificate,
    /// Local pairing/control credential; never issued to paired desktop clients.
    pub pairing_admin_token: String,
    pub clients: BTreeMap<Uuid, ClientGrant>,
    #[serde(default)]
    pub local_client_id: Option<Uuid>,
    pub models: BTreeMap<String, Uuid>,
    pub profiles: BTreeMap<Uuid, LaunchRequest>,
    #[serde(default)]
    pub local_artifacts: Vec<PathBuf>,
    #[serde(default)]
    pub managed_model_root: Option<PathBuf>,
}
pub struct Host {
    pub lan_sharing: Mutex<crate::lan_sharing::LanSharing>,
    inference_client: reqwest::Client,
    local_inference: Mutex<BTreeMap<Uuid, crate::local_inference::LocalInference>>,
    pub launch_profiles: RwLock<Vec<crate::launch_profiles::LaunchProfile>>,
    pub profile_error: RwLock<Option<String>>,
    pub downloads: Arc<crate::model_downloads::ModelDownloads>,
    pub data: Mutex<Persistent>,
    pub processes: Mutex<HostProcesses>,
    pub inventory: RwLock<Vec<ModelEntry>>,
    pub inventory_errors: RwLock<Vec<serde_json::Value>>,
    inventory_dirty: AtomicBool,
    pub gpus: Vec<Gpu>,
    pub boot_id: Uuid,
    pub revision: AtomicU64,
    pub directory: PathBuf,
    pub model_dirs: Vec<PathBuf>,
    pub artifact_sets: Vec<PathBuf>,
    lifecycle: Mutex<()>,
    traffic: Arc<std::sync::Mutex<BTreeMap<Uuid, (bool, usize)>>>,
    activity: Arc<std::sync::Mutex<BTreeMap<Principal, ClientActivity>>>,
}
/// An authenticated HTTP caller, not a persistent desktop connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Principal {
    LocalAdministrator,
    Client(Uuid),
}
#[derive(Default)]
struct ClientActivity {
    last_seen_unix_ms: Option<u64>,
    instances: BTreeMap<Uuid, usize>,
}
fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
struct RequestLease {
    activity: Arc<std::sync::Mutex<BTreeMap<Principal, ClientActivity>>>,
    principal: Principal,
    traffic: Arc<std::sync::Mutex<BTreeMap<Uuid, (bool, usize)>>>,
    id: Uuid,
}
struct DrainGuard {
    traffic: Arc<std::sync::Mutex<BTreeMap<Uuid, (bool, usize)>>>,
    id: Uuid,
}
impl Drop for DrainGuard {
    fn drop(&mut self) {
        self.traffic.lock().unwrap().entry(self.id).or_default().0 = false;
    }
}
impl Drop for RequestLease {
    fn drop(&mut self) {
        if let Some((_, count)) = self.traffic.lock().unwrap().get_mut(&self.id) {
            *count = count.saturating_sub(1);
        }
        let mut activity = self.activity.lock().unwrap();
        if let Some(caller) = activity.get_mut(&self.principal) {
            if let Some(count) = caller.instances.get_mut(&self.id) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    caller.instances.remove(&self.id);
                }
            }
            caller.last_seen_unix_ms = Some(now_unix_ms());
        }
    }
}

// Secrets never pass through desktop-visible snapshots or command logs.
fn verifier(token: &str) -> Hmac<Sha256> {
    let mut h = Hmac::<Sha256>::new_from_slice(b"ginfer-host/client-token/v1").unwrap();
    h.update(token.as_bytes());
    h
}

pub fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("state path has no parent")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = parent.join(format!(".{}.tmp", Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        use std::io::Write;
        let mut f = options.open(&temporary).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
        drop(f);
        std::fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

impl Host {
    pub async fn open(
        directory: PathBuf,
        name: String,
        engine: PathBuf,
        model_dirs: Vec<PathBuf>,
        artifact_sets: Vec<PathBuf>,
        gpus: Vec<Gpu>,
    ) -> Result<Arc<Self>, String> {
        Self::open_with_model_storage(
            directory,
            name,
            engine,
            model_dirs,
            artifact_sets,
            gpus,
            None,
        )
        .await
    }

    pub async fn open_with_model_storage(
        directory: PathBuf,
        name: String,
        engine: PathBuf,
        model_dirs: Vec<PathBuf>,
        artifact_sets: Vec<PathBuf>,
        gpus: Vec<Gpu>,
        desktop_provider: Option<PathBuf>,
    ) -> Result<Arc<Self>, String> {
        if desktop_provider
            .as_ref()
            .is_some_and(|provider| !provider.is_absolute() || directory != provider.join("host"))
        {
            return Err(
                "desktop provider storage must use its dedicated provider/host state directory"
                    .into(),
            );
        }
        let path = directory.join("host.json");
        let mut data = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<Persistent>(&bytes).map_err(|e| e.to_string())?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Persistent {
                fleet: Default::default(),
                fleet_revision: 0,
                fleet_membership: None,
                management_origin: None,
                share_lan: true,
                host_id: Uuid::new_v4(),
                name,
                certificate: HostCertificate::generate()?,
                pairing_admin_token: format!(
                    "{}{}",
                    Uuid::new_v4().simple(),
                    Uuid::new_v4().simple()
                ),
                clients: BTreeMap::new(),
                local_client_id: None,
                models: BTreeMap::new(),
                profiles: BTreeMap::new(),
                local_artifacts: vec![],
                managed_model_root: None,
            },
            Err(e) => return Err(e.to_string()),
        };
        data.fleet
            .validate_owner(data.host_id, &data.certificate.fingerprint())?;
        if let Some(membership) = &data.fleet_membership {
            membership.validate()?;
            if membership.host_id != data.host_id
                || !matches!(data.fleet, crate::fleet::FleetView::Member { .. })
                || data
                    .fleet
                    .authority()
                    .is_none_or(|authority| !membership.matches_authority(authority))
            {
                return Err(
                    "Stored membership does not match this host's configured coordinator".into(),
                );
            }
        }
        if let crate::fleet::FleetView::Coordinator { fleet } = &data.fleet {
            data.fleet_revision = data.fleet_revision.max(fleet.revision);
        }
        consolidate_instances(&mut data, &directory)?;
        write_private(
            &path,
            &serde_json::to_vec(&data).map_err(|e| e.to_string())?,
        )?;
        let processes = HostProcesses::new(
            engine,
            gpus.iter().map(|g| g.uuid.clone()).collect(),
            Duration::from_secs(600),
        )?;
        let downloads = match desktop_provider {
            Some(provider) => crate::model_downloads::ModelDownloads::open_local(
                provider.join("models"),
                provider.join("model-downloads.json"),
            )?,
            None => crate::model_downloads::ModelDownloads::open(
                directory.join("managed-models"),
                directory.join("model-downloads.json"),
            )?,
        };
        if let Some(root) = &data.managed_model_root {
            std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
            downloads.set_root(root.canonicalize().map_err(|e| e.to_string())?);
        }
        let host = Arc::new(Self {
            lan_sharing: Mutex::new(Default::default()),
            inference_client: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|e| e.to_string())?,
            local_inference: Mutex::new(BTreeMap::new()),
            launch_profiles: RwLock::new(vec![]),
            profile_error: RwLock::new(None),
            downloads,
            data: Mutex::new(data),
            processes: Mutex::new(processes),
            inventory: RwLock::new(vec![]),
            inventory_errors: RwLock::new(vec![]),
            inventory_dirty: AtomicBool::new(false),
            gpus,
            boot_id: Uuid::new_v4(),
            revision: AtomicU64::new(1),
            directory,
            model_dirs,
            artifact_sets,
            lifecycle: Mutex::new(()),
            traffic: Arc::new(std::sync::Mutex::new(BTreeMap::new())),
            activity: Arc::new(std::sync::Mutex::new(BTreeMap::new())),
        });
        host.scan().await?;
        Ok(host)
    }
    pub async fn save(&self) -> Result<(), String> {
        let data = self.data.lock().await;
        write_private(
            &self.directory.join("host.json"),
            &serde_json::to_vec(&*data).map_err(|e| e.to_string())?,
        )?;
        self.inventory_dirty.store(false, Ordering::SeqCst);
        Ok(())
    }

    // The caller holds data's lock through the durable write. Neither another
    // request nor a snapshot can observe a candidate whose commit failed.
    fn commit_fleet(
        &self,
        data: &mut Persistent,
        next: crate::fleet::FleetState,
    ) -> Result<(), String> {
        let previous_revision = data.fleet_revision;
        let previous_membership = data.fleet_membership.clone();
        if !matches!(next, crate::fleet::FleetView::Member { .. })
            || data.fleet_membership.as_ref().is_some_and(|membership| {
                next.authority()
                    .is_none_or(|authority| !membership.matches_authority(authority))
            })
        {
            data.fleet_membership = None;
        }
        if let crate::fleet::FleetView::Coordinator { fleet } = &data.fleet {
            data.fleet_revision = data.fleet_revision.max(fleet.revision);
        }
        if let crate::fleet::FleetView::Coordinator { fleet } = &next {
            data.fleet_revision = data.fleet_revision.max(fleet.revision);
        }
        let previous = std::mem::replace(&mut data.fleet, next);
        let saved = serde_json::to_vec(data)
            .map_err(|error| error.to_string())
            .and_then(|bytes| write_private(&self.directory.join("host.json"), &bytes));
        if let Err(error) = saved {
            data.fleet = previous;
            data.fleet_revision = previous_revision;
            data.fleet_membership = previous_membership;
            return Err(format!("Could not persist fleet configuration: {error}"));
        }
        self.revision.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn membership_view(data: &Persistent) -> Result<crate::fleet::MembershipView, String> {
        let membership = match &data.fleet {
            crate::fleet::FleetView::Coordinator { fleet } => Some(fleet.membership(data.host_id)?),
            crate::fleet::FleetView::Member { .. } => data.fleet_membership.clone(),
            crate::fleet::FleetView::Unconfigured => None,
        };
        Ok(crate::fleet::MembershipView {
            authority: data.fleet.authority().cloned(),
            membership,
            coordinator: matches!(data.fleet, crate::fleet::FleetView::Coordinator { .. }),
        })
    }

    pub async fn scan(&self) -> Result<(), String> {
        let path = self.directory.join("launch-profiles.json");
        let catalog = tokio::task::spawn_blocking(move || {
            let executable = std::env::current_exe().map_err(|error| error.to_string())?;
            let bundled = executable
                .parent()
                .ok_or("host executable has no parent")?
                .join("launch-profiles.json");
            crate::launch_profiles::ProfileCatalog::read_installed(&path, &bundled)
        })
        .await
        .map_err(|e| e.to_string())?;
        let catalog = match (catalog, self.downloads.installed_profiles().await) {
            (Ok(mut profiles), Ok(installed)) => {
                let mut conflict = None;
                for profile in installed {
                    if let Some(existing) =
                        profiles.iter().find(|existing| existing.id == profile.id)
                    {
                        if serde_json::to_value(existing).map_err(|e| e.to_string())?
                            != serde_json::to_value(&profile).map_err(|e| e.to_string())?
                        {
                            conflict = Some(format!(
                                "conflicting installed launch profile: {}",
                                profile.id
                            ));
                            break;
                        }
                    } else {
                        profiles.push(profile);
                    }
                }
                conflict.map_or(Ok(profiles), Err)
            }
            (Err(error), _) | (_, Err(error)) => Err(error),
        };
        match catalog {
            Ok(profiles) => {
                *self.launch_profiles.write().await = profiles;
                *self.profile_error.write().await = None;
            }
            Err(error) => {
                self.launch_profiles.write().await.clear();
                *self.profile_error.write().await = Some(error);
            }
        }
        let mut roots = self.model_dirs.clone();
        roots.extend(self.data.lock().await.local_artifacts.iter().cloned());
        roots.push(self.downloads.root().to_path_buf());
        roots.extend(
            self.downloads
                .list()
                .await
                .into_iter()
                .filter_map(|job| job.path),
        );
        let sets = self.artifact_sets.clone();
        let (entries, errors) = tokio::task::spawn_blocking(move || {
            let mut pending: Vec<_> = roots.into_iter().map(|p| (p, false)).chain(sets.into_iter().map(|p|(p,true))).collect();
            let mut found = Vec::new();
            let mut errors = Vec::new();
            while let Some((path, artifact_set)) = pending.pop() {
                let metadata = match std::fs::symlink_metadata(&path) {
                    Ok(m) => m,
                    Err(e) => {
                        errors.push(serde_json::json!({"path":path,"error":e.to_string()}));
                        continue;
                    }
                };
                if metadata.is_symlink() {
                    errors.push(serde_json::json!({"path":path,"error":"symlink inventory roots and entries are not followed; configure the resolved path"}));
                    continue;
                }
                if metadata.is_dir() && !artifact_set {
                    match std::fs::read_dir(&path) {
                        Ok(entries) => {
                            for entry in entries {
                                match entry {
                                    Ok(entry) => pending.push((entry.path(), false)),
                                    Err(e) => errors.push(
                                        serde_json::json!({"path":path,"error":e.to_string()}),
                                    ),
                                }
                            }
                        }
                        Err(e) => {
                            errors.push(serde_json::json!({"path":path,"error":e.to_string()}))
                        }
                    }
                } else if artifact_set || path.extension().and_then(|s| s.to_str()) == Some("ginfer") {
                    let result = if artifact_set {
                        inspect_artifact_set(&path)
                    } else {
                        inspect_artifact(&path).map(|m| vec![m])
                    };
                    match result.and_then(|members| {
                        path.canonicalize()
                            .map(|p| (p, members))
                            .map_err(|e| e.to_string())
                    }) {
                        Ok((path, members)) => {
                            for metadata in members {
                                found.push((path.clone(), metadata, artifact_set));
                            }
                        }
                        Err(e) => errors.push(serde_json::json!({"path":path,"error":e})),
                    }
                }
            }
            (found, errors)
        })
        .await
        .map_err(|e| e.to_string())?;
        let mut data = self.data.lock().await;
        let mut models = BTreeMap::new();
        for (path, metadata, artifact_set) in entries {
            let key = serde_json::to_string(&(&path, artifact_set, metadata.tp_size))
                .map_err(|e| e.to_string())?;
            let id = *data.models.entry(key).or_insert_with(|| {
                self.inventory_dirty.store(true, Ordering::SeqCst);
                Uuid::new_v4()
            });
            models.insert(
                id,
                ModelEntry {
                    id,
                    path,
                    metadata,
                    artifact_set,
                },
            );
        }
        *self.inventory.write().await = models.into_values().collect();
        *self.inventory_errors.write().await = errors;
        drop(data);
        if self.inventory_dirty.load(Ordering::SeqCst) { self.save().await?; }
        self.revision.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    pub async fn refresh_processes(&self) -> Result<(), String> {
        let probes = self.processes.lock().await.pending_readiness().await?;
        let observations = futures_util::future::join_all(
            probes.into_iter().map(|probe| probe.observe()),
        ).await;
        let mut processes = self.processes.lock().await;
        for observation in observations.into_iter().flatten() {
            processes.confirm_readiness(observation)?;
        }
        Ok(())
    }
    pub async fn snapshot(&self) -> serde_json::Value {
        let sharing = self.lan_sharing.lock().await;
        let data = self.data.lock().await;
        let network = serde_json::json!({"managed":sharing.managed,"active":sharing.active(),
            "enabled":if sharing.managed { data.share_lan } else { sharing.standalone.is_some() },
            "port":sharing.standalone.unwrap_or(sharing.port),"error":sharing.error});
        drop(sharing);
        let processes = self.processes.lock().await;
        let reserved = processes.reserved_gpus(None);
        let mut available_profiles = vec![];
        for profile in self.launch_profiles.read().await.iter() {
            for model in self
                .inventory
                .read()
                .await
                .iter()
                .filter(|m| profile.matches_model(m))
            {
                available_profiles.push(serde_json::json!({"profile":profile,"model_id":model.id,
                    "gpu_groups":profile.gpu_groups(&self.gpus, &reserved),
                    "compatible_gpu_groups":profile.gpu_groups(&self.gpus, &Default::default())}));
            }
        }
        let mut instances: Vec<_> = processes.instances().map(|i| serde_json::json!({
            "instance_id": i.instance_id, "session_id": i.session_id, "display_name": i.launch.model_id,
            "upstream_model_id": i.launch.model_id, "status": i.status, "last_error": i.last_error,
            "configuration": i.launch, "model_metadata": i.model_metadata,
            "profile": data.profiles.get(&i.instance_id),
        })).collect();
        for (id, profile) in &data.profiles {
            if !processes.instances().any(|i| i.instance_id == *id) {
                instances.push(serde_json::json!({
                    "instance_id":id,"session_id":null,"display_name":profile.model_id.to_string(),
                    "upstream_model_id":"","status":"stopped","last_error":null,
                    "configuration":profile,"profile":profile,"model_metadata":null,
                }));
            }
        }
        let usage = self.client_projection(&data);
        let membership = match Self::membership_view(&data) {
            Ok(view) => serde_json::json!(view),
            Err(error) => serde_json::json!({"error":error}),
        };
        {
            let traffic = self.traffic.lock().unwrap();
            for instance in &mut instances {
                if let Some(id) = instance["instance_id"]
                    .as_str()
                    .and_then(|id| id.parse::<Uuid>().ok())
                {
                    instance["active_requests"] = traffic
                        .get(&id)
                        .map(|(_, count)| *count)
                        .unwrap_or(0)
                        .into();
                }
            }
        }
        serde_json::json!({"protocol_version":1,"host_id":data.host_id,"boot_id":self.boot_id,
            "lan_sharing": {"enabled":network["enabled"],"managed":network["managed"],
                "active":network["active"],"port":network["port"],"error":network["error"]},
            "display_name":data.name,"revision":self.revision.load(Ordering::SeqCst),
            "fleet":data.fleet,
            "fleet_membership":membership,
            "clients":usage["clients"],"local_administrator":usage["local_administrator"],
            "instances":instances,"gpus":self.gpus,"models":*self.inventory.read().await,
            "inventory_errors":*self.inventory_errors.read().await,
            "launch_profiles":available_profiles,"profile_error":*self.profile_error.read().await,
            "model_management":{"version":1,"downloads":self.downloads.list().await,
                "managed_root":self.downloads.root(),"engine_presets_available":!available_profiles.is_empty()}})
    }
    pub async fn authenticated(&self, request: &Request<Body>) -> bool {
        self.principal(request).await.is_some()
    }
    pub async fn principal(&self, request: &Request<Body>) -> Option<Principal> {
        let token = request
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())?
            .strip_prefix("Bearer ")?;
        let data = self.data.lock().await;
        let admin = verifier(&data.pairing_admin_token).finalize().into_bytes();
        let principal = if verifier(token).verify_slice(&admin).is_ok() {
            Principal::LocalAdministrator
        } else {
            let (id, _) = token.split_once('.')?;
            let id = Uuid::parse_str(id).ok()?;
            let grant = data.clients.get(&id)?;
            let digest = hex::decode(&grant.token_verifier).ok()?;
            if verifier(token).verify_slice(&digest).is_err() {
                return None;
            }
            Principal::Client(id)
        };
        drop(data);
        self.activity
            .lock()
            .unwrap()
            .entry(principal)
            .or_default()
            .last_seen_unix_ms = Some(now_unix_ms());
        Some(principal)
    }
    fn client_projection(&self, data: &Persistent) -> serde_json::Value {
        let activity = self.activity.lock().unwrap();
        let clients:Vec<_>=data.clients.iter().map(|(id,grant)|{
            let usage=activity.get(&Principal::Client(*id));
            serde_json::json!({"client_id":id,"name":grant.name,"local":data.local_client_id==Some(*id),
                "active_requests":usage.map(|u|u.instances.values().sum::<usize>()).unwrap_or(0),
                "active_instances":usage.map(|u|&u.instances),"last_seen_unix_ms":usage.and_then(|u|u.last_seen_unix_ms)})
        }).collect();
        let administrator = activity.get(&Principal::LocalAdministrator);
        serde_json::json!({"clients":clients,"local_administrator":{
            "active_requests":administrator.map(|u|u.instances.values().sum::<usize>()).unwrap_or(0),
            "active_instances":administrator.map(|u|&u.instances),"last_seen_unix_ms":administrator.and_then(|u|u.last_seen_unix_ms)}})
    }

    async fn local_administrator(&self, request: &Request<Body>) -> bool {
        self.principal(request).await == Some(Principal::LocalAdministrator)
    }
    async fn prepare_launch(&self, request: &LaunchRequest) -> Result<EngineLaunch, String> {
        let model = self
            .inventory
            .read()
            .await
            .iter()
            .find(|m| m.id == request.model_id)
            .cloned()
            .ok_or("model is not installed")?;
        let group = gpu_group(&request.gpu_uuids);
        let existing = self
            .data
            .lock()
            .await
            .profiles
            .iter()
            .find(|(_, saved)| gpu_group(&saved.gpu_uuids) == group)
            .map(|(id, _)| *id);
        if request.instance_id.is_some() && existing.is_some() && request.instance_id != existing {
            return Err("This GPU group already has a server instance; select that instance to change its model or profile".into());
        }
        let id = request
            .instance_id
            .or(existing)
            .unwrap_or_else(Uuid::new_v4);
        let metadata = if model.artifact_set {
            inspect_artifact_set(&model.path)?
                .into_iter()
                .find(|m| m.tp_size == model.metadata.tp_size)
                .ok_or("artifact set no longer declares selected degree")?
        } else {
            inspect_artifact(&model.path)?
        };
        if metadata != model.metadata {
            return Err(
                "artifact changed since inventory scan; refresh inventory before loading".into(),
            );
        }
        if let Some(profile_id) = &request.qualified_profile_id {
            let profile = self
                .launch_profiles
                .read()
                .await
                .iter()
                .find(|p| &p.id == profile_id)
                .cloned()
                .ok_or("qualified profile is no longer available; rescan profiles")?;
            if !profile.matches_model(&model)
                || profile.max_context != request.max_context
                || profile.concurrency != request.concurrency
                || serde_json::to_value(&profile.options).map_err(|e| e.to_string())?
                    != serde_json::to_value(&request.options).map_err(|e| e.to_string())?
            {
                return Err("settings no longer match the qualified profile; select it again or use custom settings".into());
            }
            let selected: std::collections::BTreeSet<_> =
                request.gpu_uuids.iter().cloned().collect();
            if selected.len() != request.gpu_uuids.len()
                || !profile
                    .gpu_groups(&self.gpus, &Default::default())
                    .iter()
                    .any(|g| {
                        g.iter().cloned().collect::<std::collections::BTreeSet<_>>() == selected
                    })
            {
                return Err("GPU group is not qualified for this profile".into());
            }
            let path = if model.artifact_set {
                crate::engine_inventory::artifact_set_payload(&model.path, metadata.tp_size)?
            } else {
                model.path.clone()
            };
            tokio::task::spawn_blocking(move || profile.verify_payload(&path))
                .await
                .map_err(|e| e.to_string())??;
        }
        let limit = request.options.validate_target(
            &metadata.identity,
            metadata.tp_size,
            metadata.draft_tp,
        )?;
        if request.options.kv_dtype == "nvfp4" && !metadata.nvfp4_kv_available {
            return Err("This artifact lacks complete NVFP4 KV calibration metadata. Install its calibrated NVFP4 KV artifact or explicitly select INT8/BF16 KV. NVFP4 model weights alone do not provide KV calibration.".into());
        }
        if request.max_context > limit {
            return Err(format!("context exceeds model maximum of {limit}"));
        }
        let socket = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = socket.local_addr().map_err(|e| e.to_string())?.port();
        drop(socket);
        Ok(EngineLaunch {
            instance_id: id,
            artifact: model.path,
            artifact_set: model.artifact_set,
            model_id: format!(
                "{}/{}",
                model.metadata.identity.model_id, model.metadata.identity.weights_id
            ),
            gpu_uuids: request.gpu_uuids.clone(),
            tp: model.metadata.tp_size,
            port,
            max_context: request.max_context,
            concurrency: request.concurrency,
            options: request.options.clone(),
        })
    }
    pub async fn launch(&self, request: LaunchRequest) -> Result<Uuid, String> {
        let _lifecycle = self.lifecycle.lock().await;
        let launch = self.prepare_launch(&request).await?;
        self.start_prepared(request, launch).await
    }
    async fn start_prepared(
        &self,
        mut request: LaunchRequest,
        launch: EngineLaunch,
    ) -> Result<Uuid, String> {
        let id = launch.instance_id;
        self.processes.lock().await.launch(launch)?;
        request.instance_id = Some(id);
        let previous = self.data.lock().await.profiles.insert(id, request);
        if let Err(error) = self.save().await {
            let stopped = self.processes.lock().await.stop(id).await;
            let mut data = self.data.lock().await;
            if let Some(previous) = previous {
                data.profiles.insert(id, previous);
            } else {
                data.profiles.remove(&id);
            }
            self.revision.fetch_add(1, Ordering::SeqCst);
            return Err(match stopped {
                Ok(()) => format!("could not persist launch profile; new process stopped: {error}"),
                Err(stop_error) => format!("could not persist launch profile: {error}; new process could not be stopped: {stop_error}"),
            });
        }
        self.revision.fetch_add(1, Ordering::SeqCst);
        Ok(id)
    }
    async fn stop_instance(&self, id: Uuid, force: bool) -> Result<(), String> {
        self.traffic.lock().unwrap().entry(id).or_default().0 = true;
        let _draining = DrainGuard {
            traffic: self.traffic.clone(),
            id,
        };
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        while !force
            && self
                .traffic
                .lock()
                .unwrap()
                .get(&id)
                .is_some_and(|(_, count)| *count > 0)
        {
            if tokio::time::Instant::now() >= deadline {
                return Err("instance still has active requests; retry after completion or choose force-stop".into());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let result = self.processes.lock().await.stop(id).await;
        self.revision.fetch_add(1, Ordering::SeqCst);
        result
    }
    pub(crate) async fn inference(
        &self,
        id: Uuid,
        suffix: &str,
        req: &mut Request<Body>,
    ) -> Result<Response<Body>, String> {
        let allowed = match req.method().as_str() {
            "GET" => {
                suffix == "v1/models"
                    || suffix.starts_with("v1/models/")
                    || suffix.starts_with("v1/responses/")
            }
            "POST" => {
                matches!(
                    suffix,
                    "v1/chat/completions"
                        | "v1/ginfer/benchmark"
                        | "v1/chat/completions/count_tokens"
                        | "v1/messages"
                        | "v1/messages/count_tokens"
                        | "v1/responses"
                        | "v1/responses/compact"
                        | "v1/responses/input_tokens"
                ) || (suffix.starts_with("v1/responses/") && suffix.ends_with("/cancel"))
            }
            "DELETE" => suffix
                .strip_prefix("v1/responses/")
                .is_some_and(|id| !id.is_empty() && !id.contains('/')),
            _ => false,
        };
        if !allowed || suffix.contains("..") {
            return Err("unsupported inference route".into());
        }
        let principal = req
            .extensions()
            .get::<Principal>()
            .copied()
            .ok_or("missing authenticated inference principal")?;
        let lease = {
            let mut traffic = self.traffic.lock().unwrap();
            let (draining, count) = traffic.entry(id).or_default();
            if *draining {
                return Err("instance is draining".into());
            }
            *count += 1;
            let mut activity = self.activity.lock().unwrap();
            let caller = activity.entry(principal).or_default();
            *caller.instances.entry(id).or_default() += 1;
            caller.last_seen_unix_ms = Some(now_unix_ms());
            RequestLease {
                activity: self.activity.clone(),
                principal,
                traffic: self.traffic.clone(),
                id,
            }
        };
        let (port, key, model, session_id) = self.processes.lock().await.endpoint(id)?;
        if let Some(expected) = req.headers().get("x-ginfer-session-id") {
            if expected.to_str().ok() != Some(session_id.to_string().as_str()) {
                return Err("assigned engine session has changed".into());
            }
        }
        let query = req
            .uri()
            .query()
            .map(|q| format!("?{q}"))
            .unwrap_or_default();
        let mut upstream = self
            .inference_client
            .request(
                req.method().clone(),
                format!("http://127.0.0.1:{port}/{suffix}{query}"),
            )
            .bearer_auth(key);
        for header in ["accept", "anthropic-version", "anthropic-beta"] {
            if let Some(value) = req.headers().get(header) {
                upstream = upstream.header(header, value);
            }
        }
        if req.method() == hyper::Method::POST {
            let bytes = bounded_body(req, 384 * 1024 * 1024).await?;
            if !bytes.is_empty() {
                let mut body: serde_json::Value =
                    serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                if !body.is_object() {
                    return Err("inference body must be a JSON object".into());
                }
                if suffix != "v1/ginfer/benchmark" {
                    body["model"] = model.into();
                }
                upstream = upstream.json(&body);
            }
        }
        let response = upstream.send().await.map_err(|e| e.to_string())?;
        let mut builder = Response::builder().status(response.status());
        for (name, value) in response.headers() {
            if !matches!(
                name.as_str(),
                "connection" | "transfer-encoding" | "content-length" | "keep-alive"
            ) {
                builder = builder.header(name, value);
            }
        }
        let stream = futures_util::stream::try_unfold(
            (response.bytes_stream(), lease),
            |(mut stream, lease)| async move {
                use futures_util::StreamExt;
                match stream.next().await {
                    Some(Ok(bytes)) => Ok(Some((bytes, (stream, lease)))),
                    Some(Err(e)) => Err(e),
                    None => Ok(None),
                }
            },
        );
        builder
            .body(Body::wrap_stream(stream))
            .map_err(|e| e.to_string())
    }
    pub async fn route(
        self: Arc<Self>,
        mut req: Request<Body>,
    ) -> Result<Response<Body>, std::convert::Infallible> {
        let result = self.handle(&mut req).await;
        Ok(result
            .unwrap_or_else(|e| json(StatusCode::BAD_REQUEST, serde_json::json!({"error": e}))))
    }
    async fn handle(self: &Arc<Self>, req: &mut Request<Body>) -> Result<Response<Body>, String> {
        let path = req.uri().path().to_string();
        if req.method() == hyper::Method::GET && path == "/.well-known/ginfer" {
            let data = self.data.lock().await;
            return Ok(json(
                StatusCode::OK,
                serde_json::json!({"protocol_version":1,"host_id":data.host_id,"display_name":data.name}),
            ));
        }
        if req.method() == hyper::Method::POST
            && matches!(path.as_str(), "/host/v1/lan-sharing" | "/host/v1/name")
        {
            if !self.local_administrator(req).await {
                return Ok(json(
                    StatusCode::UNAUTHORIZED,
                    serde_json::json!({"error":"local administrator credential required"}),
                ));
            }
            let body = body_json(req).await?;
            if path == "/host/v1/name" {
                self.set_name(body["name"].as_str().ok_or("name must be text")?)
                    .await?;
            } else {
                let enabled = body["enabled"]
                    .as_bool()
                    .ok_or("enabled must be a boolean")?;
                self.set_lan_sharing(enabled).await?;
            }
            return Ok(json(StatusCode::OK, self.snapshot().await));
        }
        if req.method() == hyper::Method::POST && path == "/host/v1/pair" {
            let body = body_json(req).await?;
            let name = body
                .get("client_name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or("client name is required")?;
            let sharing = self.lan_sharing.lock().await;
            if !sharing.active() {
                return Ok(json(
                    StatusCode::FORBIDDEN,
                    serde_json::json!({"error":"Enable Share this host before pairing"}),
                ));
            }
            let id = Uuid::new_v4();
            let token = format!(
                "{id}.{}{}",
                Uuid::new_v4().simple(),
                Uuid::new_v4().simple()
            );
            let mut data = self.data.lock().await;
            data.clients.insert(
                id,
                ClientGrant {
                    name: name.into(),
                    token_verifier: hex::encode(verifier(&token).finalize().into_bytes()),
                },
            );
            let host_id = data.host_id;
            let fleet = data.fleet.clone();
            if let Err(error) = write_private(
                &self.directory.join("host.json"),
                &serde_json::to_vec(&*data).map_err(|e| e.to_string())?,
            ) {
                data.clients.remove(&id);
                return Err(error);
            }
            drop(data);
            self.revision.fetch_add(1, Ordering::SeqCst);
            drop(sharing);
            return Ok(json(
                StatusCode::OK,
                serde_json::json!({"host_id":host_id,"client_id":id,"token":token,"fleet":fleet}),
            ));
        }
        let Some(principal) = self.principal(req).await else {
            return Ok(json(
                StatusCode::UNAUTHORIZED,
                serde_json::json!({"error":"invalid host credential"}),
            ));
        };
        req.extensions_mut().insert(principal);
        if req.method() == hyper::Method::GET && path == "/host/v1/clients" {
            return Ok(json(
                StatusCode::OK,
                self.client_projection(&*self.data.lock().await),
            ));
        }
        if req.method() == hyper::Method::POST && path == "/host/v1/local-client" {
            if principal != Principal::LocalAdministrator {
                return Ok(json(
                    StatusCode::FORBIDDEN,
                    serde_json::json!({"error":"local administrator credential required"}),
                ));
            }
            let mut data = self.data.lock().await;
            if let Some(id) = data
                .local_client_id
                .filter(|id| data.clients.contains_key(id))
            {
                return Ok(json(StatusCode::OK, serde_json::json!({"client_id":id})));
            }
            let id = Uuid::new_v4();
            data.clients.insert(
                id,
                ClientGrant {
                    name: "Local applications".into(),
                    token_verifier: String::new(),
                },
            );
            let previous = data.local_client_id.replace(id);
            if let Err(error) = write_private(
                &self.directory.join("host.json"),
                &serde_json::to_vec(&*data).map_err(|e| e.to_string())?,
            ) {
                data.clients.remove(&id);
                data.local_client_id = previous;
                return Err(error);
            }
            self.revision.fetch_add(1, Ordering::SeqCst);
            return Ok(json(StatusCode::OK, serde_json::json!({"client_id":id})));
        }
        if path == "/host/v1/fleet" && req.method() == hyper::Method::GET {
            let fleet = self.data.lock().await.fleet.clone();
            return Ok(json(
                StatusCode::OK,
                serde_json::to_value(fleet).map_err(|error| error.to_string())?,
            ));
        }
        if path == "/host/v1/fleet/membership" && req.method() == hyper::Method::GET {
            let data = self.data.lock().await;
            return Ok(json(
                StatusCode::OK,
                serde_json::to_value(Self::membership_view(&data)?)
                    .map_err(|error| error.to_string())?,
            ));
        }
        if path == "/host/v1/fleet/membership" && req.method() == hyper::Method::POST {
            let membership: crate::fleet::HostMembershipProjection =
                serde_json::from_value(body_json(req).await?).map_err(|error| error.to_string())?;
            membership.validate()?;
            let mut data = self.data.lock().await;
            let crate::fleet::FleetView::Member { authority } = &data.fleet else {
                return Ok(json(
                    StatusCode::CONFLICT,
                    serde_json::json!({"error":"Only a configured member accepts read-only membership projections"}),
                ));
            };
            if membership.host_id != data.host_id || !membership.matches_authority(authority) {
                return Ok(json(
                    StatusCode::CONFLICT,
                    serde_json::json!({"error":"Membership projection does not match this host and its configured coordinator"}),
                ));
            }
            if let Some(current) = &data.fleet_membership {
                if membership.revision < current.revision || membership == *current {
                    return Ok(json(
                        StatusCode::OK,
                        serde_json::json!({"applied":false,"membership":current}),
                    ));
                }
                if membership.revision == current.revision {
                    return Ok(json(
                        StatusCode::CONFLICT,
                        serde_json::json!({"error":"Membership changed without a new coordinator revision", "current_revision":current.revision}),
                    ));
                }
            }
            let previous = data.fleet_membership.replace(membership.clone());
            let saved = serde_json::to_vec(&*data)
                .map_err(|error| error.to_string())
                .and_then(|bytes| write_private(&self.directory.join("host.json"), &bytes));
            if let Err(error) = saved {
                data.fleet_membership = previous;
                return Err(format!("Could not persist host membership: {error}"));
            }
            self.revision.fetch_add(1, Ordering::SeqCst);
            return Ok(json(
                StatusCode::OK,
                serde_json::json!({"applied":true,"membership":membership}),
            ));
        }
        if path == "/host/v1/fleet/authority" && req.method() == hyper::Method::POST {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct ConfigureAuthority {
                authority: crate::fleet::AuthorityLocator,
            }
            let request: ConfigureAuthority =
                serde_json::from_value(body_json(req).await?).map_err(|error| error.to_string())?;
            let mut data = self.data.lock().await;
            let mut next = data.fleet.configured(
                request.authority,
                data.host_id,
                &data.name,
                &data.certificate.fingerprint(),
            )?;
            if !matches!(data.fleet, crate::fleet::FleetView::Coordinator { .. }) {
                if let crate::fleet::FleetView::Coordinator { fleet } = &mut next {
                    fleet.revision = data
                        .fleet_revision
                        .checked_add(1)
                        .ok_or("Fleet revision exhausted")?;
                }
            }
            self.commit_fleet(&mut data, next)?;
            return Ok(json(
                StatusCode::OK,
                serde_json::to_value(&data.fleet).map_err(|error| error.to_string())?,
            ));
        }
        if path == "/host/v1/fleet/update" && req.method() == hyper::Method::POST {
            let request: crate::fleet::FleetUpdate =
                serde_json::from_value(body_json(req).await?).map_err(|error| error.to_string())?;
            let mut data = self.data.lock().await;
            let next = match data.fleet.updated(request.clone()) {
                Ok(next) => next,
                Err(crate::fleet::FleetError::Conflict { current_revision }) => {
                    return Ok(json(
                        StatusCode::CONFLICT,
                        serde_json::json!({"error":"Fleet changed; refresh and review your edit", "current_revision":current_revision}),
                    ));
                }
                Err(crate::fleet::FleetError::NotCoordinator) => {
                    return Ok(json(
                        StatusCode::CONFLICT,
                        serde_json::json!({"error":"This host does not own the fleet catalog; connect to the configured coordinator", "fleet":data.fleet}),
                    ));
                }
                Err(crate::fleet::FleetError::Invalid(error)) => return Err(error),
            };
            if let crate::fleet::FleetOperation::SetClientAssignment { assignment } =
                request.operation
            {
                if !data.clients.contains_key(&assignment.client_id) {
                    return Err(
                        "Client placement requires a current coordinator-issued client grant"
                            .into(),
                    );
                }
            }
            self.commit_fleet(&mut data, next)?;
            let crate::fleet::FleetView::Coordinator { fleet } = &data.fleet else {
                unreachable!();
            };
            return Ok(json(
                StatusCode::OK,
                serde_json::to_value(fleet).map_err(|error| error.to_string())?,
            ));
        }
        if let Some(tail) = path.strip_prefix("/host/v1/instances/") {
            if let Some((id, operation)) = tail.split_once('/') {
                let id = Uuid::parse_str(id).map_err(|e| e.to_string())?;
                if req.method() == hyper::Method::POST && operation == "local-connection" {
                    if !self.local_administrator(req).await {
                        return Ok(json(
                            StatusCode::FORBIDDEN,
                            serde_json::json!({"error":"local administrator credential required"}),
                        ));
                    }
                    let (_, _, model_id, session_id) = self.processes.lock().await.endpoint(id)?;
                    let mut routes = self.local_inference.lock().await;
                    if !routes
                        .get(&id)
                        .is_some_and(|route| route.session_id == session_id)
                    {
                        routes.insert(
                            id,
                            crate::local_inference::LocalInference::bind(self, id, session_id)?,
                        );
                    }
                    let route = &routes[&id];
                    return Ok(json(
                        StatusCode::OK,
                        serde_json::json!({"instance_id":id,"session_id":session_id,
                        "model_id":model_id,"port":route.port,"api_key":route.api_key}),
                    ));
                }
                if let Some(suffix) = operation.strip_prefix("inference/") {
                    return self.inference(id, suffix, req).await;
                }
                if req.method() == hyper::Method::GET && operation == "benchmark-hardware" {
                    let (_, _, _, session_id) = self.processes.lock().await.endpoint(id)?;
                    let profile = self
                        .data
                        .lock()
                        .await
                        .profiles
                        .get(&id)
                        .cloned()
                        .ok_or("instance profile missing")?;
                    let gpus: Vec<_> = self.gpus.iter().filter(|gpu| profile.gpu_uuids.contains(&gpu.uuid))
                        .map(|gpu| serde_json::json!({"model":gpu.name,"vram_mib":gpu.memory_mib,"sm":gpu.compute_capability})).collect();
                    let mut hardware = crate::benchmark_hardware::collect().await;
                    hardware["gpus"] = serde_json::json!(gpus);
                    return Ok(json(
                        StatusCode::OK,
                        serde_json::json!({"session_id":session_id,"hardware":hardware}),
                    ));
                }
                if req.method() == hyper::Method::POST
                    && matches!(operation, "start" | "stop" | "restart" | "reload")
                {
                    let body = body_json(req).await?;
                    let _lifecycle = self.lifecycle.lock().await;
                    if let Some(expected) = body.get("expected_session_id") {
                        let expected: Option<Uuid> = serde_json::from_value(expected.clone())
                            .map_err(|e| format!("invalid expected session: {e}"))?;
                        let current = self
                            .processes
                            .lock()
                            .await
                            .instances()
                            .find(|instance| instance.instance_id == id)
                            .map(|instance| instance.session_id);
                        if current != expected {
                            return Ok(json(
                                StatusCode::CONFLICT,
                                serde_json::json!({"error":"assigned engine session has changed"}),
                            ));
                        }
                    }
                    let force = body.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
                    if matches!(operation, "start" | "restart")
                        && body.get("configuration").is_some()
                    {
                        return Err("start and restart use saved settings; use reload to change configuration".into());
                    }
                    let reload = if operation != "stop" {
                        let mut profile: LaunchRequest =
                            if let Some(config) = body.get("configuration") {
                                serde_json::from_value(config.clone()).map_err(|e| e.to_string())?
                            } else {
                                self.data
                                    .lock()
                                    .await
                                    .profiles
                                    .get(&id)
                                    .cloned()
                                    .ok_or("instance has no saved launch profile")?
                            };
                        profile.instance_id = Some(id);
                        let launch = self.prepare_launch(&profile).await?;
                        self.processes
                            .lock()
                            .await
                            .validate_launch(&launch, operation != "start")?;
                        Some((profile, launch))
                    } else {
                        None
                    };
                    let has_process = self
                        .processes
                        .lock()
                        .await
                        .instances()
                        .any(|i| i.instance_id == id);
                    if has_process && operation != "start" {
                        self.stop_instance(id, force).await?;
                    } else if reload.is_none() && !self.data.lock().await.profiles.contains_key(&id)
                    {
                        return Err("unknown instance".into());
                    }
                    if let Some((profile, launch)) = reload {
                        self.start_prepared(profile, launch).await?;
                    }
                    return Ok(json(StatusCode::OK, self.snapshot().await));
                }
            }
        }
        if req.method() == hyper::Method::DELETE {
            if let Some(id) = path.strip_prefix("/host/v1/clients/") {
                let id = Uuid::parse_str(id).map_err(|e| e.to_string())?;
                let mut data = self.data.lock().await;
                if data.local_client_id == Some(id) {
                    return Ok(json(
                        StatusCode::FORBIDDEN,
                        serde_json::json!({"error":"the local administrator identity is managed by this host"}),
                    ));
                }
                let mut next_fleet = data.fleet.clone();
                next_fleet.remove_client(id)?;
                let previous_revision = data.fleet_revision;
                if let crate::fleet::FleetState::Coordinator { fleet } = &next_fleet {
                    data.fleet_revision = data.fleet_revision.max(fleet.revision);
                }
                let previous_fleet = std::mem::replace(&mut data.fleet, next_fleet);
                let previous = data.clients.remove(&id);
                if let Err(error) = write_private(
                    &self.directory.join("host.json"),
                    &serde_json::to_vec(&*data).map_err(|e| e.to_string())?,
                ) {
                    if let Some(previous) = previous {
                        data.clients.insert(id, previous);
                    }
                    data.fleet = previous_fleet;
                    data.fleet_revision = previous_revision;
                    return Err(error);
                }
                self.revision.fetch_add(1, Ordering::SeqCst);
                return Ok(json(StatusCode::OK, serde_json::json!({"revoked":id})));
            }
        }
        match (req.method().as_str(), path.as_str()) {
            ("POST", "/host/v1/local-engine") => {
                if !self.local_administrator(req).await {
                    return Ok(json(
                        StatusCode::FORBIDDEN,
                        serde_json::json!({"error":"local administrator credential required"}),
                    ));
                }
                let body = body_json(req).await?;
                let executable: PathBuf =
                    serde_json::from_value(body["path"].clone()).map_err(|e| e.to_string())?;
                let _lifecycle = self.lifecycle.lock().await;
                self.processes
                    .lock()
                    .await
                    .configure_executable(executable)?;
                Ok(json(StatusCode::OK, serde_json::json!({"ok":true})))
            }
            ("POST", "/host/v1/local-artifacts") => {
                if !self.local_administrator(req).await {
                    return Ok(json(
                        StatusCode::FORBIDDEN,
                        serde_json::json!({"error":"local administrator credential required"}),
                    ));
                }
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct LocalArtifact {
                    path: PathBuf,
                }
                let request: LocalArtifact =
                    serde_json::from_value(body_json(req).await?).map_err(|e| e.to_string())?;
                if !request.path.is_absolute() {
                    return Err("local artifact path must be absolute".into());
                }
                let path = request.path.canonicalize().map_err(|e| e.to_string())?;
                if path.extension().and_then(|s| s.to_str()) != Some("ginfer") {
                    return Err("local registration requires a .ginfer container".into());
                }
                let inspect_path = path.clone();
                tokio::task::spawn_blocking(move || inspect_artifact(&inspect_path))
                    .await
                    .map_err(|e| e.to_string())??;
                let _lifecycle = self.lifecycle.lock().await;
                let added = {
                    let mut data = self.data.lock().await;
                    if data.local_artifacts.contains(&path) {
                        false
                    } else {
                        data.local_artifacts.push(path.clone());
                        true
                    }
                };
                if let Err(error) = self.save().await {
                    if added {
                        self.data
                            .lock()
                            .await
                            .local_artifacts
                            .retain(|p| p != &path);
                    }
                    return Err(error);
                }
                self.scan().await?;
                let entry = self
                    .inventory
                    .read()
                    .await
                    .iter()
                    .find(|m| m.path == path)
                    .cloned()
                    .ok_or("artifact could not be inventoried; inspect host inventory errors")?;
                Ok(json(
                    StatusCode::OK,
                    serde_json::to_value(entry).map_err(|e| e.to_string())?,
                ))
            }
            ("POST", "/host/v1/profile-launch") => {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct Selection {
                    profile_id: String,
                    model_id: Uuid,
                    gpu_uuids: Vec<String>,
                    instance_id: Option<Uuid>,
                    #[serde(default)]
                    force: bool,
                    #[serde(default)]
                    expected_session_id: Option<Uuid>,
                }
                let body = body_json(req).await?;
                let selection: Selection =
                    serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
                let _lifecycle = self.lifecycle.lock().await;
                if let Some(id) = selection.instance_id {
                    if body.get("expected_session_id").is_some() {
                        let current = self
                            .processes
                            .lock()
                            .await
                            .instances()
                            .find(|instance| instance.instance_id == id)
                            .map(|instance| instance.session_id);
                        if current != selection.expected_session_id {
                            return Ok(json(
                                StatusCode::CONFLICT,
                                serde_json::json!({"error":"assigned engine session has changed"}),
                            ));
                        }
                    }
                    if !self.data.lock().await.profiles.contains_key(&id) {
                        return Err("unknown instance".into());
                    }
                }
                let profile = self
                    .launch_profiles
                    .read()
                    .await
                    .iter()
                    .find(|p| p.id == selection.profile_id)
                    .cloned()
                    .ok_or("unknown qualified profile")?;
                let request = LaunchRequest {
                    instance_id: selection.instance_id,
                    qualified_profile_id: Some(profile.id),
                    model_id: selection.model_id,
                    gpu_uuids: selection.gpu_uuids,
                    max_context: profile.max_context,
                    concurrency: profile.concurrency,
                    options: profile.options,
                };
                let launch = self.prepare_launch(&request).await?;
                self.processes
                    .lock()
                    .await
                    .validate_launch(&launch, selection.instance_id.is_some())?;
                if let Some(id) = selection.instance_id {
                    if self
                        .processes
                        .lock()
                        .await
                        .instances()
                        .any(|i| i.instance_id == id)
                    {
                        self.stop_instance(id, selection.force).await?;
                    }
                }
                let id = self.start_prepared(request, launch).await?;
                Ok(json(StatusCode::OK, serde_json::json!({"instance_id":id})))
            }
            ("POST", "/host/v1/remove-model") => {
                let body = body_json(req).await?;
                let id = body["model_id"]
                    .as_str()
                    .ok_or("model id required")?
                    .parse::<Uuid>()
                    .map_err(|e| e.to_string())?;
                let _lifecycle = self.lifecycle.lock().await;
                let model = self
                    .inventory
                    .read()
                    .await
                    .iter()
                    .find(|m| m.id == id)
                    .cloned()
                    .ok_or("unknown model")?;
                let processes = self.processes.lock().await;
                if processes.instances().any(|i| {
                    i.launch.artifact == model.path
                        && !matches!(
                            i.status,
                            crate::engine_registry::InstanceStatus::Stopped
                                | crate::engine_registry::InstanceStatus::Failed
                        )
                }) {
                    return Err("stop every instance using this package before removing it".into());
                }
                drop(processes);
                self.downloads.remove_installed(&model.path).await?;
                self.data
                    .lock()
                    .await
                    .profiles
                    .retain(|_, p| p.model_id != id);
                self.scan().await?;
                Ok(json(StatusCode::OK, self.snapshot().await))
            }
            ("GET", "/host/v1/model-catalog") => {
                let releases = crate::model_downloads::published_releases().await?;
                let releases: Vec<_> = releases
                    .into_iter()
                    .filter(|r| r.compatible_group(&self.gpus).is_some())
                    .collect();
                Ok(json(
                    StatusCode::OK,
                    serde_json::to_value(releases).map_err(|e| e.to_string())?,
                ))
            }
            ("GET", "/host/v1/model-storage") => {
                let root = self.downloads.root();
                let free = crate::model_downloads::available_bytes(root.clone()).await?;
                Ok(json(
                    StatusCode::OK,
                    serde_json::json!({"path":root,"available_bytes":free}),
                ))
            }
            ("POST", "/host/v1/model-storage") => {
                let body = body_json(req).await?;
                let root = PathBuf::from(body["path"].as_str().ok_or("storage path required")?);
                if !root.is_absolute() {
                    return Err("model storage must be an absolute path".into());
                }
                tokio::fs::create_dir_all(&root)
                    .await
                    .map_err(|e| e.to_string())?;
                let root = tokio::fs::canonicalize(root)
                    .await
                    .map_err(|e| e.to_string())?;
                let probe = root.join(format!(".ginfer-write-check-{}", Uuid::new_v4()));
                tokio::fs::write(&probe, [])
                    .await
                    .map_err(|e| format!("model storage is not writable: {e}"))?;
                tokio::fs::remove_file(probe)
                    .await
                    .map_err(|e| e.to_string())?;
                let _lifecycle = self.lifecycle.lock().await;
                let mut data = self.data.lock().await;
                let previous = data.managed_model_root.replace(root.clone());
                if let Err(error) = write_private(
                    &self.directory.join("host.json"),
                    &serde_json::to_vec(&*data).map_err(|e| e.to_string())?,
                ) {
                    data.managed_model_root = previous;
                    return Err(error);
                }
                self.downloads.set_root(root.clone());
                Ok(json(StatusCode::OK, serde_json::json!({"path":root})))
            }
            ("GET", "/host/v1/downloads") => Ok(json(
                StatusCode::OK,
                serde_json::to_value(self.downloads.list().await).map_err(|e| e.to_string())?,
            )),
            ("POST", "/host/v1/downloads") => {
                let release: crate::model_downloads::Release =
                    serde_json::from_value(body_json(req).await?).map_err(|e| e.to_string())?;
                release.validate()?;
                if release.compatible_group(&self.gpus).is_none() {
                    return Err("release has no qualified homogeneous GPU group on this host; compute capability and per-GPU memory must match".into());
                }
                Ok(json(
                    StatusCode::OK,
                    serde_json::to_value(self.downloads.enqueue(release).await?)
                        .map_err(|e| e.to_string())?,
                ))
            }
            ("POST", "/host/v1/download-actions") => {
                let body = body_json(req).await?;
                let id = body["id"]
                    .as_str()
                    .ok_or("download id required")?
                    .parse::<Uuid>()
                    .map_err(|e| e.to_string())?;
                self.downloads
                    .action(
                        id,
                        body["action"].as_str().ok_or("download action required")?,
                    )
                    .await?;
                Ok(json(StatusCode::OK, serde_json::json!({"ok":true})))
            }
            ("GET", "/host/v1/snapshot") => Ok(json(StatusCode::OK, self.snapshot().await)),
            ("POST", "/host/v1/scan") => {
                self.scan().await?;
                Ok(json(StatusCode::OK, self.snapshot().await))
            }
            ("POST", "/host/v1/instances") => {
                let request: LaunchRequest =
                    serde_json::from_value(body_json(req).await?).map_err(|e| e.to_string())?;
                let id = self.launch(request).await?;
                Ok(json(
                    StatusCode::ACCEPTED,
                    serde_json::json!({"instance_id":id}),
                ))
            }
            _ => Ok(json(
                StatusCode::NOT_FOUND,
                serde_json::json!({"error":"unknown host route"}),
            )),
        }
    }
}
pub fn json(status: StatusCode, body: serde_json::Value) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .header("cache-control", "no-store")
        .body(Body::from(body.to_string()))
        .unwrap()
}
async fn body_json(req: &mut Request<Body>) -> Result<serde_json::Value, String> {
    serde_json::from_slice(&bounded_body(req, 1024 * 1024).await?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod target_launch_tests {
    use super::*;

    async fn installed_flash(
        weights: &str,
        calibrated: bool,
    ) -> (tempfile::TempDir, Arc<Host>, LaunchRequest) {
        let dir = tempfile::tempdir().unwrap();
        let models = dir.path().join("models");
        std::fs::create_dir(&models).unwrap();
        let objects = if calibrated {
            serde_json::json!([
                {"kind":"tensor","rank":"all","name":"nvfp4_kv/profile_v2"},
                {"kind":"tensor","rank":"all","name":"nvfp4_kv/body_inverse_global_scales"},
                {"kind":"tensor","rank":"all","name":"nvfp4_kv/mtp_inverse_global_scales"},
                {"kind":"resource","name":"nvfp4_kv/provenance"}
            ])
        } else {
            serde_json::json!([{"kind":"tensor","rank":"all","name":"fixture"}])
        };
        let metadata = serde_json::json!({
            "identity":{"model_id":"qwen3.8-flash-next","weights_id":weights},
            "tp_size":1,"draft_tp":0,"objects":objects
        })
        .to_string();
        let mut artifact = b"NINFER\0\x03".to_vec();
        artifact.extend((metadata.len() as u64).to_le_bytes());
        artifact.extend(metadata.as_bytes());
        artifact.resize(4096, 0);
        // Header-only fixture tests host admission; the Engine validates real payloads.
        std::fs::write(models.join("flash.ginfer"), artifact).unwrap();
        let host = Host::open(
            dir.path().join("state"),
            "Test".into(),
            std::env::current_exe().unwrap(),
            vec![models],
            vec![],
            vec![Gpu {
                uuid: "GPU-test".into(),
                name: "Test".into(),
                display_name: None,
                memory_mib: 32768,
                compute_capability: Some("12.0".into()),
            }],
        )
        .await
        .unwrap();
        let request = LaunchRequest {
            instance_id: None,
            qualified_profile_id: None,
            model_id: host.inventory.read().await[0].id,
            gpu_uuids: vec!["GPU-test".into()],
            max_context: 262144,
            concurrency: 1,
            options: LaunchOptions::default(),
        };
        (dir, host, request)
    }

    #[tokio::test]
    async fn unchanged_inventory_keeps_durable_state_and_refreshes_artifact_metadata() {
        let (dir, host, _) = installed_flash("groupwise-int", false).await;
        let path = dir.path().join("state/host.json");
        let formatted = serde_json::to_vec_pretty(&*host.data.lock().await).unwrap();
        std::fs::write(&path, &formatted).unwrap();
        let original = host.inventory.read().await[0].clone();
        host.scan().await.unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), formatted);

        let artifact = dir.path().join("models/flash.ginfer");
        let file = std::fs::OpenOptions::new().write(true).open(artifact).unwrap();
        file.set_len(8192).unwrap();
        drop(file);
        host.scan().await.unwrap();
        let updated = host.inventory.read().await[0].clone();
        assert_eq!(updated.id, original.id);
        assert_eq!(updated.metadata.size_bytes, 8192);
        assert_eq!(std::fs::read(&path).unwrap(), formatted);
    }

    #[tokio::test]
    async fn new_inventory_mapping_retries_failed_persistence_and_survives_restart() {
        let (dir, host, _) = installed_flash("groupwise-int", false).await;
        let state = dir.path().join("state");
        let path = state.join("host.json");
        std::fs::copy(dir.path().join("models/flash.ginfer"), dir.path().join("models/second.ginfer")).unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert!(host.scan().await.is_err());
        let failed_ids: BTreeMap<_, _> = host.inventory.read().await.iter().map(|model| (model.path.clone(), model.id)).collect();
        assert_eq!(failed_ids.len(), 2);
        std::fs::remove_dir(&path).unwrap();
        host.scan().await.unwrap();
        let restarted = Host::open(state, "Ignored".into(), std::env::current_exe().unwrap(),
            vec![dir.path().join("models")], vec![], vec![]).await.unwrap();
        let restored_ids: BTreeMap<_, _> = restarted.inventory.read().await.iter().map(|model| (model.path.clone(), model.id)).collect();
        assert_eq!(restored_ids, failed_ids);
    }

    #[tokio::test]
    async fn prepare_flash_launch_preserves_auto_and_admits_mtp_above_dflash_limit() {
        for weights in ["groupwise-int", "smol-q2g64", "nvfp4"] {
            let (_dir, host, mut request) = installed_flash(weights, false).await;
            let launch = host.prepare_launch(&request).await.unwrap();
            assert_eq!(launch.model_id, format!("qwen3.8-flash-next/{weights}"));
            assert_eq!(launch.options.spec, "auto");
            assert_eq!(launch.options.draft_tokens, 0);
            for vision in [false, true] {
                request.options.vision = vision;
                request.options.spec = "mtp".into();
                request.options.draft_tokens = 16;
                for policy in ["auto", "fixed"] {
                    request.options.draft_policy = policy.into();
                    let launch = host.prepare_launch(&request).await.unwrap();
                    assert_eq!(launch.options.vision, vision);
                    assert_eq!(launch.options.draft_tokens, 16);
                }
            }
            request.max_context += 1;
            assert!(host
                .prepare_launch(&request)
                .await
                .unwrap_err()
                .contains("context exceeds"));
            request.max_context = 262144;
            request.options.draft_policy = "adaptive".into();
            assert!(host.prepare_launch(&request).await.is_err());
            request.options.draft_policy = "auto".into();
            for width in [0, u32::MAX] {
                request.options.draft_tokens = width;
                assert!(host.prepare_launch(&request).await.is_err());
            }
            request.options.spec = "dflash".into();
            request.options.draft_tokens = 4;
            assert!(host.prepare_launch(&request).await.is_err());
            request.options.spec = "none".into();
            request.options.draft_tokens = 0;
            host.prepare_launch(&request).await.unwrap();
            request.options.draft_tp = 1;
            assert!(host.prepare_launch(&request).await.is_err());
        }
    }

    #[tokio::test]
    async fn prepare_flash_launch_requires_own_kv_metadata_and_exact_registered_weights() {
        let (_dir, host, mut request) = installed_flash("nvfp4", false).await;
        request.options.kv_dtype = "nvfp4".into();
        assert!(host
            .prepare_launch(&request)
            .await
            .unwrap_err()
            .contains("calibration metadata"));
        for dtype in ["auto", "bf16", "int8"] {
            request.options.kv_dtype = dtype.into();
            host.prepare_launch(&request).await.unwrap();
        }
        let (_dir, host, mut request) = installed_flash("nvfp4", true).await;
        request.options.kv_dtype = "nvfp4".into();
        host.prepare_launch(&request).await.unwrap();
        for unregistered in ["nvfp4-mtp", "groupwise-int-dflash2-q4"] {
            let (_dir, host, request) = installed_flash(unregistered, false).await;
            assert!(host
                .prepare_launch(&request)
                .await
                .unwrap_err()
                .contains("registered weights"));
        }
    }
}

#[cfg(all(test, unix))]
mod lifecycle_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[tokio::test]
    async fn inventory_reports_rejections_and_recovers_on_rescan() {
        let dir = tempfile::tempdir().unwrap();
        let models = dir.path().join("models");
        std::fs::create_dir(&models).unwrap();
        let broken = models.join("broken.ginfer");
        std::fs::write(&broken, b"not an artifact").unwrap();
        let missing = dir.path().join("missing-set.json");
        let host = Host::open(
            dir.path().join("state"),
            "Test".into(),
            std::env::current_exe().unwrap(),
            vec![models],
            vec![missing],
            vec![],
        )
        .await
        .unwrap();
        let snapshot = host.snapshot().await;
        assert_eq!(snapshot["models"].as_array().unwrap().len(), 0);
        assert_eq!(snapshot["inventory_errors"].as_array().unwrap().len(), 2);
        std::fs::remove_file(&broken).unwrap();
        host.scan().await.unwrap();
        let snapshot = host.snapshot().await;
        assert_eq!(snapshot["inventory_errors"].as_array().unwrap().len(), 1);
        assert!(snapshot["inventory_errors"][0]["path"]
            .as_str()
            .unwrap()
            .ends_with("missing-set.json"));
    }

    #[tokio::test]
    async fn model_storage_selection_survives_host_restart() {
        let dir = tempfile::tempdir().unwrap();
        let state = dir.path().join("state");
        let engine = std::env::current_exe().unwrap();
        let host = Host::open(
            state.clone(),
            "Test".into(),
            engine.clone(),
            vec![],
            vec![],
            vec![],
        )
        .await
        .unwrap();
        let root = dir.path().join("chosen-models");
        let token = host.data.lock().await.pairing_admin_token.clone();
        let request = Request::post("/host/v1/model-storage")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(serde_json::json!({"path":root}).to_string()))
            .unwrap();
        assert_eq!(
            host.clone().route(request).await.unwrap().status(),
            StatusCode::OK
        );
        assert_eq!(host.downloads.root(), root.canonicalize().unwrap());
        drop(host);
        let reopened = Host::open(state, "Test".into(), engine, vec![], vec![], vec![])
            .await
            .unwrap();
        assert_eq!(reopened.downloads.root(), root.canonicalize().unwrap());
        assert_eq!(
            reopened.snapshot().await["model_management"]["managed_root"],
            root.to_string_lossy().as_ref()
        );
    }

    #[tokio::test]
    async fn invalid_reload_preserves_session_and_restart_preserves_profile() {
        let dir = tempfile::tempdir().unwrap();
        let engine = dir.path().join("engine");
        std::fs::write(&engine, "#!/bin/sh\nexec sleep 60\n").unwrap();
        std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o700)).unwrap();
        let models = dir.path().join("models");
        std::fs::create_dir(&models).unwrap();
        let metadata = serde_json::json!({"identity":{"model_id":"muse-glimmer-30b","weights_id":"nvfp4"},"tp_size":1,"draft_tp":0,"objects":[{"kind":"tensor","rank":"all","name":"fixture"}]}).to_string();
        let mut artifact = b"NINFER\0\x03".to_vec();
        artifact.extend((metadata.len() as u64).to_le_bytes());
        artifact.extend(metadata.as_bytes());
        artifact.resize(4096, 0);
        std::fs::write(models.join("model.ginfer"), artifact).unwrap();
        let mut gpus = vec![Gpu {
            uuid: "GPU-test".into(),
            name: "Test".into(),
            display_name: None,
            memory_mib: 32768,
            compute_capability: Some("12.0".into()),
        }];
        gpus.push(Gpu {
            uuid: "GPU-second".into(),
            name: "Test".into(),
            display_name: None,
            memory_mib: 32768,
            compute_capability: Some("12.0".into()),
        });
        let host = Host::open(
            dir.path().join("state"),
            "Test".into(),
            engine.clone(),
            vec![models.clone()],
            vec![],
            gpus.clone(),
        )
        .await
        .unwrap();
        let profile = LaunchRequest {
            instance_id: None,
            qualified_profile_id: None,
            model_id: host.inventory.read().await[0].id,
            gpu_uuids: vec!["GPU-test".into()],
            max_context: 8192,
            concurrency: 1,
            options: LaunchOptions::default(),
        };
        let id = host.launch(profile.clone()).await.unwrap();
        let before = host.snapshot().await;
        let token = format!("{}.test", Uuid::new_v4());
        let client_id = Uuid::parse_str(token.split_once('.').unwrap().0).unwrap();
        host.data.lock().await.clients.insert(
            client_id,
            ClientGrant {
                name: "Test".into(),
                token_verifier: hex::encode(verifier(&token).finalize().into_bytes()),
            },
        );
        let mut invalid = profile.clone();
        invalid.gpu_uuids = vec!["GPU-missing".into()];
        let req = Request::post(format!("/host/v1/instances/{id}/reload"))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(
                serde_json::json!({"configuration":invalid}).to_string(),
            ))
            .unwrap();
        let response = host.clone().route(req).await.unwrap();
        assert!(!response.status().is_success());
        let after = host.snapshot().await;
        assert_eq!(
            before["instances"][0]["session_id"],
            after["instances"][0]["session_id"]
        );
        assert_eq!(after["instances"][0]["status"], "starting");
        let mut session = after["instances"][0]["session_id"].clone();
        for (operation, expected_success, expected_status) in [
            ("start", false, "starting"),
            ("restart", true, "starting"),
            ("stop", true, "stopped"),
            ("start", true, "starting"),
        ] {
            let req = Request::post(format!("/host/v1/instances/{id}/{operation}"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from("{}"))
                .unwrap();
            let response = host.clone().route(req).await.unwrap();
            assert_eq!(response.status().is_success(), expected_success);
            let snapshot = host.snapshot().await;
            assert_eq!(snapshot["instances"][0]["status"], expected_status);
            let next = snapshot["instances"][0]["session_id"].clone();
            if expected_success && operation != "stop" {
                assert_ne!(next, session);
            } else {
                assert_eq!(next, session);
            }
            assert_eq!(snapshot["instances"][0]["profile"]["max_context"], 8192);
            session = next;
        }
        for operation in ["stop", "restart", "reload"] {
            let request = Request::post(format!("/host/v1/instances/{id}/{operation}"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(
                    serde_json::json!({
                        "expected_session_id":before["instances"][0]["session_id"]
                    })
                    .to_string(),
                ))
                .unwrap();
            let response = host.clone().route(request).await.unwrap();
            assert_eq!(response.status(), StatusCode::CONFLICT);
            let unchanged = host.snapshot().await;
            assert_eq!(unchanged["instances"][0]["session_id"], session);
            assert_eq!(unchanged["instances"][0]["status"], "starting");
        }
        let second_id = Uuid::from_u128(u128::MAX);
        let mut second_profile = profile.clone();
        second_profile.instance_id = Some(second_id);
        second_profile.gpu_uuids = vec!["GPU-second".into()];
        host.launch(second_profile).await.unwrap();
        let second_session = host.snapshot().await["instances"][1]["session_id"].clone();
        let (arrived, mut arrivals) = tokio::sync::mpsc::unbounded_channel();
        let mut delayed_upstreams = Vec::new();
        let mut health_gates = Vec::new();
        let mut model_gates = Vec::new();
        for instance_id in [id, second_id] {
            let launch = host.processes.lock().await.instances()
                .find(|instance| instance.instance_id == instance_id).unwrap().launch.clone();
            let health_gate = Arc::new(tokio::sync::Semaphore::new(0));
            let model_gate = Arc::new(tokio::sync::Semaphore::new(0));
            health_gates.push(health_gate.clone());
            model_gates.push(model_gate.clone());
            let arrived = arrived.clone();
            let upstream = hyper::Server::bind(&([127, 0, 0, 1], launch.port).into()).serve(
                hyper::service::make_service_fn(move |_| {
                    let model = launch.model_id.clone();
                    let arrived = arrived.clone();
                    let health_gate = health_gate.clone();
                    let model_gate = model_gate.clone();
                    async move {
                        Ok::<_, std::convert::Infallible>(hyper::service::service_fn(
                            move |request: Request<Body>| {
                                let model = model.clone();
                                let arrived = arrived.clone();
                                let health_gate = health_gate.clone();
                                let model_gate = model_gate.clone();
                                async move {
                                    let (stage, gate) = if request.uri().path() == "/health" {
                                        ("health", health_gate)
                                    } else {
                                        ("models", model_gate)
                                    };
                                    arrived.send((instance_id, stage)).unwrap();
                                    let _permit = gate.acquire().await.unwrap();
                                    Ok::<_, std::convert::Infallible>(json(
                                        StatusCode::OK,
                                        if stage == "models" {
                                            serde_json::json!({"data":[{"id":model,"fixture":"stale readiness"}]})
                                        } else {
                                            serde_json::json!({})
                                        },
                                    ))
                                }
                            },
                        ))
                    }
                }),
            );
            delayed_upstreams.push(tokio::spawn(upstream));
        }
        let monitor_host = host.clone();
        let refresh = tokio::spawn(async move { monitor_host.refresh_processes().await });
        async fn wait_for_stage(
            arrivals: &mut tokio::sync::mpsc::UnboundedReceiver<(Uuid, &'static str)>,
            stage: &'static str,
            expected: [Uuid; 2],
        ) {
            let mut observed = std::collections::BTreeSet::new();
            for _ in 0..2 {
                let (instance_id, actual_stage) = arrivals.recv().await.unwrap();
                assert_eq!(actual_stage, stage);
                observed.insert(instance_id);
            }
            assert_eq!(observed, expected.into_iter().collect());
        }
        tokio::time::timeout(Duration::from_millis(500), wait_for_stage(&mut arrivals, "health", [id, second_id]))
            .await.unwrap();
        let snapshot = tokio::time::timeout(Duration::from_millis(500), host.snapshot()).await.unwrap();
        assert_eq!(snapshot["instances"][0]["status"], "starting");
        assert_eq!(snapshot["instances"][1]["status"], "starting");
        assert!(!refresh.is_finished());
        let stop = Request::post(format!("/host/v1/instances/{id}/stop"))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(serde_json::json!({"expected_session_id":session}).to_string())).unwrap();
        assert!(tokio::time::timeout(Duration::from_millis(500), host.clone().route(stop))
            .await.unwrap().unwrap().status().is_success());
        for gate in health_gates { gate.add_permits(1); }
        tokio::time::timeout(Duration::from_millis(500), wait_for_stage(&mut arrivals, "models", [id, second_id]))
            .await.unwrap();
        let reload = Request::post(format!("/host/v1/instances/{second_id}/reload"))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(serde_json::json!({"expected_session_id":second_session}).to_string())).unwrap();
        assert!(tokio::time::timeout(Duration::from_millis(500), host.clone().route(reload))
            .await.unwrap().unwrap().status().is_success());
        assert!(!refresh.is_finished());
        for gate in model_gates { gate.add_permits(1); }
        refresh.await.unwrap().unwrap();
        let after_probes = host.snapshot().await;
        assert_eq!(after_probes["instances"][0]["status"], "stopped");
        assert!(after_probes["instances"][0]["model_metadata"].is_null());
        assert_eq!(after_probes["instances"][1]["status"], "starting");
        assert_ne!(after_probes["instances"][1]["session_id"], second_session);
        assert!(after_probes["instances"][1]["model_metadata"].is_null());
        for upstream in delayed_upstreams {
            upstream.abort();
            let _ = upstream.await;
        }
        for (instance_id, operation) in [(second_id, "stop"), (id, "start")] {
            let request = Request::post(format!("/host/v1/instances/{instance_id}/{operation}"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from("{}")).unwrap();
            assert!(host.clone().route(request).await.unwrap().status().is_success());
        }
        session = host.snapshot().await["instances"][0]["session_id"].clone();
        let mut qualified = crate::launch_profiles::LaunchProfile {
            id: "fixture-c4".into(),
            name: "Synthetic lifecycle fixture".into(),
            platform: std::env::consts::OS.into(),
            identity: host.inventory.read().await[0].metadata.identity.clone(),
            artifact_sha256: {
                use sha2::Digest;
                hex::encode(Sha256::digest(
                    std::fs::read(models.join("model.ginfer")).unwrap(),
                ))
            },
            artifact_bytes: 4096,
            tp: 1,
            draft_tp: 0,
            gpu_name: "Test".into(),
            compute_capability: "12.0".into(),
            vram_tier_gib: 32,
            min_memory_mib_per_gpu: 32000,
            max_context: 8192,
            concurrency: 4,
            options: LaunchOptions {
                kv_arena_bytes: None,
                ..LaunchOptions::default()
            },
            qualification: crate::launch_profiles::Qualification {
                tier: crate::launch_profiles::QualificationTier::FullContextTested,
                calculation: None,
                smoke_requests: None,
                evidence: "synthetic fixture only".into(),
                engine_revision: "fixture".into(),
                free_bytes_per_gpu: Some(crate::launch_profiles::HEADROOM_BYTES),
                full_context_requests: 4,
            },
        };
        qualified.validate().unwrap();
        host.launch_profiles.write().await.push(qualified.clone());
        let selection = serde_json::json!({"profile_id":qualified.id,"model_id":host.inventory.read().await[0].id,
            "gpu_uuids":["GPU-test"],"instance_id":id});
        let mut stale_selection = selection.clone();
        stale_selection["expected_session_id"] = before["instances"][0]["session_id"].clone();
        let stale = Request::post("/host/v1/profile-launch")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(stale_selection.to_string()))
            .unwrap();
        assert_eq!(
            host.clone().route(stale).await.unwrap().status(),
            StatusCode::CONFLICT
        );
        assert_eq!(host.snapshot().await["instances"][0]["session_id"], session);
        let switch = || {
            Request::post("/host/v1/profile-launch")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(selection.to_string()))
                .unwrap()
        };
        assert!(host
            .clone()
            .route(switch())
            .await
            .unwrap()
            .status()
            .is_success());
        let snapshot = host.snapshot().await;
        assert_eq!(snapshot["instances"][0]["profile"]["concurrency"], 4);
        assert_eq!(
            snapshot["instances"][0]["profile"]["qualified_profile_id"],
            "fixture-c4"
        );
        assert_ne!(snapshot["instances"][0]["session_id"], session);
        assert!(snapshot["instances"][0]["configuration"]["kv_arena_bytes"].is_null());
        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.path().join("state/host.json")).unwrap())
                .unwrap();
        assert!(saved["profiles"][id.to_string()]["kv_arena_bytes"].is_null());
        let restart = Request::post(format!("/host/v1/instances/{id}/restart"))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from("{}"))
            .unwrap();
        assert!(host
            .clone()
            .route(restart)
            .await
            .unwrap()
            .status()
            .is_success());
        let snapshot = host.snapshot().await;
        assert!(snapshot["instances"][0]["configuration"]["kv_arena_bytes"].is_null());
        session = snapshot["instances"][0]["session_id"].clone();
        qualified.artifact_sha256 = "0".repeat(64);
        *host.launch_profiles.write().await = vec![qualified];
        assert!(!host
            .clone()
            .route(switch())
            .await
            .unwrap()
            .status()
            .is_success());
        assert_eq!(host.snapshot().await["instances"][0]["session_id"], session);
        let current = host.snapshot().await;
        let engine_port = current["instances"][0]["configuration"]["port"]
            .as_u64()
            .unwrap() as u16;
        let public_model = current["instances"][0]["upstream_model_id"]
            .as_str()
            .unwrap()
            .to_string();
        let upstream = hyper::Server::bind(&([127, 0, 0, 1], engine_port).into()).serve(
            hyper::service::make_service_fn(move |_| {
                let model = public_model.clone();
                async move {
                    Ok::<_, std::convert::Infallible>(hyper::service::service_fn(
                        move |request: Request<Body>| {
                            let model = model.clone();
                            async move {
                                if request.uri().path() == "/v1/ginfer/benchmark" {
                                    let body =
                                        hyper::body::to_bytes(request.into_body()).await.unwrap();
                                    let body: serde_json::Value =
                                        serde_json::from_slice(&body).unwrap();
                                    return Ok::<_, std::convert::Infallible>(json(
                                        StatusCode::OK,
                                        body,
                                    ));
                                }
                                Ok::<_, std::convert::Infallible>(json(
                                    StatusCode::OK,
                                    if request.uri().path() == "/v1/models" {
                                        serde_json::json!({"data":[{"id":model}]})
                                    } else {
                                        serde_json::json!({"fixture":"forwarded"})
                                    },
                                ))
                            }
                        },
                    ))
                }
            }),
        );
        let upstream = tokio::spawn(upstream);
        host.refresh_processes().await.unwrap();
        let denied = Request::post(format!("/host/v1/instances/{id}/local-connection"))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            host.clone().route(denied).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        let administrator = host.data.lock().await.pairing_admin_token.clone();
        let request = Request::post(format!("/host/v1/instances/{id}/local-connection"))
            .header("authorization", format!("Bearer {administrator}"))
            .body(Body::empty())
            .unwrap();
        let response = host.clone().route(request).await.unwrap();
        assert!(response.status().is_success());
        let connection: serde_json::Value =
            serde_json::from_slice(&hyper::body::to_bytes(response.into_body()).await.unwrap())
                .unwrap();
        let api_key = connection["api_key"].as_str().unwrap();
        assert_ne!(api_key, administrator);
        assert!(!host.snapshot().await.to_string().contains(api_key));
        let base = format!("http://127.0.0.1:{}", connection["port"]);
        let client = reqwest::Client::new();
        let preflight = client
            .request(reqwest::Method::OPTIONS, format!("{base}/v1/models"))
            .header("origin", "http://tauri.localhost")
            .header("access-control-request-method", "GET")
            .header("access-control-request-headers", "authorization")
            .send()
            .await
            .unwrap();
        assert_eq!(preflight.status(), 204);
        assert_eq!(
            preflight.headers()["access-control-allow-origin"],
            "http://tauri.localhost"
        );
        let unauthorized = client
            .get(format!("{base}/v1/models"))
            .header("origin", "http://tauri.localhost")
            .send()
            .await
            .unwrap();
        assert_eq!(unauthorized.status(), 401);
        assert_eq!(
            unauthorized.headers()["access-control-allow-origin"],
            "http://tauri.localhost"
        );
        assert_eq!(
            client
                .get(format!("{base}/v1/models"))
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        let result = client
            .post(format!("{base}/v1/chat/completions"))
            .header("origin", "http://tauri.localhost")
            .bearer_auth(api_key)
            .json(&serde_json::json!({"model":"client-alias","messages":[]}))
            .send()
            .await
            .unwrap();
        assert_eq!(result.status(), 200);
        assert_eq!(
            result.headers()["access-control-allow-origin"],
            "http://tauri.localhost"
        );
        assert_eq!(
            result.json::<serde_json::Value>().await.unwrap()["fixture"],
            "forwarded"
        );
        let benchmark_body = serde_json::json!({"prompt_tokens":2048,"output_tokens":500,"concurrency":4,"warmup_rounds":1,"measured_rounds":1});
        let benchmark = client
            .post(format!("{base}/v1/ginfer/benchmark"))
            .bearer_auth(api_key)
            .json(&benchmark_body)
            .send()
            .await
            .unwrap();
        assert_eq!(benchmark.status(), 200);
        assert_eq!(
            benchmark.json::<serde_json::Value>().await.unwrap(),
            benchmark_body
        );
        host.processes.lock().await.shutdown().await.unwrap();
        assert_eq!(
            client
                .get(format!("{base}/health"))
                .send()
                .await
                .unwrap()
                .status(),
            503
        );
        upstream.abort();
        let duplicate_id = Uuid::from_u128(u128::MAX);
        {
            let mut data = host.data.lock().await;
            let mut duplicate = data.profiles[&id].clone();
            duplicate.instance_id = Some(duplicate_id);
            data.profiles.insert(duplicate_id, duplicate);
        }
        host.save().await.unwrap();
        let restored = Host::open(
            dir.path().join("state"),
            "Test".into(),
            engine,
            vec![models],
            vec![],
            gpus,
        )
        .await
        .unwrap();
        let snapshot = restored.snapshot().await;
        assert_eq!(snapshot["instances"][0]["instance_id"], id.to_string());
        assert_eq!(snapshot["instances"][0]["status"], "stopped");
        assert!(snapshot["instances"][0]["session_id"].is_null());
        assert_eq!(snapshot["instances"][0]["profile"]["max_context"], 8192);
        assert_eq!(snapshot["instances"].as_array().unwrap().len(), 1);
        let retired: BTreeMap<Uuid, LaunchRequest> = serde_json::from_slice(
            &std::fs::read(dir.path().join("state/retired-instance-records.json")).unwrap(),
        )
        .unwrap();
        assert!(retired.contains_key(&duplicate_id));
        let mut replacement = profile.clone();
        replacement.concurrency = 2;
        assert_eq!(restored.launch(replacement.clone()).await.unwrap(), id);
        assert_eq!(restored.data.lock().await.profiles.len(), 1);
        assert!(restored.launch(replacement.clone()).await.is_err());
        restored.processes.lock().await.shutdown().await.unwrap();
        assert_eq!(restored.launch(replacement.clone()).await.unwrap(), id);
        assert_eq!(restored.data.lock().await.profiles.len(), 1);
        replacement.gpu_uuids = vec!["GPU-second".into()];
        let second_id = restored.launch(replacement.clone()).await.unwrap();
        assert_ne!(second_id, id);
        assert_eq!(restored.data.lock().await.profiles.len(), 2);
        replacement.instance_id = Some(Uuid::new_v4());
        assert!(restored.launch(replacement).await.is_err());
        restored.processes.lock().await.shutdown().await.unwrap();
        serde_json::from_value::<crate::engine_registry::HostSnapshot>(snapshot).unwrap();
    }
}
async fn bounded_body(req: &mut Request<Body>, limit: usize) -> Result<Vec<u8>, String> {
    use hyper::body::HttpBody;
    let mut bytes = Vec::new();
    while let Some(chunk) = req.body_mut().data().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if bytes.len() + chunk.len() > limit {
            return Err("request exceeds host body limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
