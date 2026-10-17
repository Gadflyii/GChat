use crate::{
    engine_host::{EngineLaunch, GpuDeviceOrders, HostProcesses, LaunchOptions},
    engine_inventory::{artifact_set_members, inspect_artifact, ArtifactMetadata},
    transport::HostCertificate,
};
use hmac::{Hmac, Mac};
use hyper::{Body, Request, Response, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::{Mutex, Notify, RwLock};
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
pub struct GpuInventory {
    pub gpus: Vec<Gpu>,
    pub device_orders: GpuDeviceOrders,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ModelEntry {
    pub id: Uuid,
    pub path: PathBuf,
    pub metadata: ArtifactMetadata,
    pub artifact_set: bool,
    // The last validated scan owns dependency facts; they are not protocol data.
    #[serde(skip)]
    payload: PathBuf,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct LaunchRequest {
    pub instance_id: Option<Uuid>,
    #[serde(default)]
    pub qualified_profile_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub benchmark_profile: Option<crate::max_perf::MaxPerfProfileRef>,
    pub model_id: Uuid,
    pub gpu_uuids: Vec<String>,
    pub max_context: u32,
    pub concurrency: u32,
    #[serde(flatten)]
    pub options: LaunchOptions,
}
fn one_instance() -> u32 { 1 }
#[derive(Serialize, Deserialize)]
pub struct ClientGrant {
    pub name: String,
    pub token_verifier: String,
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
    #[serde(default)]
    pub share_lan: bool,
    #[serde(default)]
    pub management_origin: Option<String>,
    #[serde(default)]
    pub management_notice: Option<String>,
    #[serde(default)]
    pub lan_port: Option<u16>,
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
    /// Successful Flash startup graph allowances, bound to producer and recipe.
    #[serde(default)]
    pub graph_receipts: BTreeMap<String, u64>,
    /// Exact payload receipts, including imported artifacts, survive Host restart.
    #[serde(default)]
    pub payload_verifications: BTreeMap<PathBuf, crate::payload_verification::PayloadVerification>,
    #[serde(default)]
    pub local_artifacts: Vec<PathBuf>,
    #[serde(default)]
    pub managed_model_root: Option<PathBuf>,
    #[serde(default)]
    pub first_run: crate::first_run::Progress,
}
pub struct Host {
    pub gbot: crate::gbot_control::Control,
    pub lan_sharing: Mutex<crate::lan_sharing::LanSharing>,
    inference_client: reqwest::Client,
    local_inference: Mutex<BTreeMap<Uuid, crate::local_inference::LocalInference>>,
    pub launch_profiles: RwLock<Vec<crate::launch_profiles::LaunchProfile>>,
    pub profile_error: RwLock<Option<String>>,
    pub downloads: Arc<crate::model_downloads::ModelDownloads>,
    pub data: Mutex<Persistent>,
    pub processes: Mutex<HostProcesses>,
    pub(crate) draft_width: Arc<crate::draft_width::DraftWidths>,
    pub inventory: RwLock<Vec<ModelEntry>>,
    pub inventory_errors: RwLock<Vec<serde_json::Value>>,
    inventory_dirty: AtomicBool,
    pub gpus: Vec<Gpu>,
    pub cuda_visible_gpu_uuids: Vec<String>,
    pub gpu_device_orders: GpuDeviceOrders,
    pub boot_id: Uuid,
    pub revision: Arc<AtomicU64>,
    pub directory: PathBuf,
    pub model_dirs: Vec<PathBuf>,
    pub artifact_sets: Vec<PathBuf>,
    pub(crate) lifecycle: Mutex<()>,
    pub(crate) first_run_operation: Mutex<()>,
    load_operations: std::sync::Mutex<BTreeMap<Uuid, Arc<LoadOperation>>>,
    normal_stop_enabled: AtomicBool,
    normal_stop_quit_enabled: AtomicBool,
    normal_stopping: AtomicBool,
    normal_stop_admission: RwLock<()>,
    normal_stop_notification: Notify,
    traffic: Arc<std::sync::Mutex<BTreeMap<Uuid, InstanceTraffic>>>,
    activity: Arc<std::sync::Mutex<BTreeMap<Principal, ClientActivity>>>,
    worker_slots: Arc<std::sync::Mutex<BTreeMap<crate::engine_registry::InstanceRef, u32>>>,
}
// A desktop Installed Load owns preparation work independently of the HTTP timeout.
// Cancellation is cooperative for file reads and targets only the profile job it started.
tokio::task_local! { static LOAD_OPERATION: Arc<LoadOperation>; }
struct LoadOperation {
    cancelled: AtomicBool,
    view: std::sync::Mutex<serde_json::Value>,
    profile: std::sync::Mutex<Option<(Arc<crate::hardware_profile::HardwareProfiles>, Uuid)>>,
}
impl LoadOperation {
    fn new(id: Uuid) -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            view: std::sync::Mutex::new(
                serde_json::json!({"operation_id":id,"status":"queued","phase":"preparing"}),
            ),
            profile: std::sync::Mutex::new(None),
        }
    }
    fn check(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::SeqCst) {
            Err("Model load cancelled".into())
        } else {
            Ok(())
        }
    }
    fn update(&self, phase: &str, detail: &str, bytes: Option<(u64, u64)>) {
        let mut view = self.view.lock().unwrap();
        if self.cancelled.load(Ordering::SeqCst) {
            return;
        }
        view["status"] = "running".into();
        view["phase"] = phase.into();
        view["detail"] = detail.into();
        if let Some((completed, total)) = bytes {
            view["completed_bytes"] = completed.into();
            view["total_bytes"] = total.into();
        } else {
            view.as_object_mut().unwrap().remove("completed_bytes");
            view.as_object_mut().unwrap().remove("total_bytes");
        }
    }
    fn cancel(&self) {
        let mut view = self.view.lock().unwrap();
        if matches!(view["status"].as_str(), Some("ready" | "failed")) {
            return;
        }
        self.cancelled.store(true, Ordering::SeqCst);
        view["status"] = "cancelled".into();
        drop(view);
        if let Some((job, id)) = self.profile.lock().unwrap().as_ref() {
            job.cancel_job(*id);
        }
    }
}
struct LoadRequestGuard {
    operation: Arc<LoadOperation>,
    finished: bool,
}
impl Drop for LoadRequestGuard {
    fn drop(&mut self) {
        if !self.finished {
            self.operation.cancel();
        }
    }
}
fn current_load() -> Option<Arc<LoadOperation>> {
    LOAD_OPERATION.try_with(Arc::clone).ok()
}
fn check_load() -> Result<(), String> {
    current_load().map_or(Ok(()), |operation| operation.check())
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
    traffic: Arc<std::sync::Mutex<BTreeMap<Uuid, InstanceTraffic>>>,
    id: Uuid,
}
// A live coordinator response owns one slot, independently of client grants.
struct WorkerSlot {
    slots: Arc<std::sync::Mutex<BTreeMap<crate::engine_registry::InstanceRef, u32>>>,
    instance: crate::engine_registry::InstanceRef,
}
impl Drop for WorkerSlot {
    fn drop(&mut self) {
        let mut slots = self.slots.lock().unwrap();
        if let Some(used) = slots.get_mut(&self.instance) {
            *used = used.saturating_sub(1);
            if *used == 0 {
                slots.remove(&self.instance);
            }
        }
    }
}

struct DrainGuard {
    traffic: Arc<std::sync::Mutex<BTreeMap<Uuid, InstanceTraffic>>>,
    id: Uuid,
}
impl Drop for DrainGuard {
    fn drop(&mut self) {
        self.traffic.lock().unwrap().entry(self.id).or_default().draining = false;
    }
}
impl Drop for RequestLease {
    fn drop(&mut self) {
        let idle = if let Some(traffic) = self.traffic.lock().unwrap().get_mut(&self.id) {
            traffic.count = traffic.count.saturating_sub(1);
            (traffic.count == 0).then(|| traffic.idle.clone())
        } else { None };
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
        drop(activity);
        if let Some(idle) = idle {
            idle.notify_waiters();
        }
    }
}

#[derive(Default)]
struct InstanceTraffic {
    draining: bool,
    count: usize,
    idle: Arc<Notify>,
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
        Self::open_with_gpu_inventory(
            directory, name, engine, model_dirs, artifact_sets,
            GpuInventory { gpus, device_orders: GpuDeviceOrders::default() },
            desktop_provider,
        ).await
    }

    pub async fn open_with_gpu_inventory(
        directory: PathBuf,
        name: String,
        engine: PathBuf,
        model_dirs: Vec<PathBuf>,
        artifact_sets: Vec<PathBuf>,
        inventory: GpuInventory,
        desktop_provider: Option<PathBuf>,
    ) -> Result<Arc<Self>, String> {
        let GpuInventory { gpus, device_orders } = inventory;
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
            Ok(bytes) => {
                let mut saved: serde_json::Value = serde_json::from_slice(&bytes)
                    .map_err(|e| e.to_string())?;
                if let Some(profiles) = saved.get_mut("profiles").and_then(|value| value.as_object_mut()) {
                    for profile in profiles.values_mut() {
                        if profile.get("structured_outputs").is_none()
                            && profile.get("qualified_profile_id").is_some_and(|id| !id.is_null())
                        {
                            profile["qualified_profile_id"] = serde_json::Value::Null;
                        }
                    }
                }
                serde_json::from_value::<Persistent>(saved).map_err(|e| e.to_string())?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Persistent {
                fleet: Default::default(),
                fleet_revision: 0,
                fleet_membership: None,
                management_origin: None,
                management_notice: None,
                lan_port: None,
                share_lan: false,
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
                graph_receipts: BTreeMap::new(),
                payload_verifications: BTreeMap::new(),
                local_artifacts: vec![],
                managed_model_root: None,
                first_run: Default::default(),
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
        write_private(
            &path,
            &serde_json::to_vec(&data).map_err(|e| e.to_string())?,
        )?;
        let mask = std::env::var("CUDA_VISIBLE_DEVICES").map(Some).or_else(|error| {
            if matches!(error, std::env::VarError::NotPresent) { Ok(None) }
            else { Err("CUDA_VISIBLE_DEVICES must be valid Unicode".to_string()) }
        })?;
        let device_order = std::env::var("CUDA_DEVICE_ORDER").map(Some).or_else(|error| {
            if matches!(error, std::env::VarError::NotPresent) { Ok(None) }
            else { Err("CUDA_DEVICE_ORDER must be valid Unicode".to_string()) }
        })?;
        let cuda_visible_gpu_uuids = device_orders.resolve(
            &gpus.iter().map(|gpu| gpu.uuid.clone()).collect::<Vec<_>>(),
            mask.as_deref(), device_order.as_deref(),
        )?;
        let mut processes = HostProcesses::new(
            engine,
            cuda_visible_gpu_uuids.iter().cloned().collect(),
            Duration::from_secs(600),
        )?;
        processes.configure_runtimes(
            Default::default(),
            gpus.iter()
                .filter_map(|gpu| {
                    gpu.compute_capability
                        .as_ref()
                        .map(|sm| (gpu.uuid.clone(), sm.clone()))
                })
                .collect(),
        )?;
        let revision = Arc::new(AtomicU64::new(1));
        processes.hardware_profile = Some(crate::hardware_profile::HardwareProfiles::open(
            directory.clone(),
            revision.clone(),
        )?);
        let process_activity = processes.activity_notification();
        processes.hardware_profile.as_ref().unwrap()
            .set_activity_notification(process_activity.clone());
        let draft_width = crate::draft_width::DraftWidths::open(
            &directory, revision.clone(), process_activity.clone())?;
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
        downloads.set_activity_notification(process_activity);
        if let Some(root) = &data.managed_model_root {
            std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
            downloads.set_root(root.canonicalize().map_err(|e| e.to_string())?);
        }
        let host = Arc::new(Self {
            gbot: crate::gbot_control::Control::open(directory.clone())?,
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
            draft_width,
            inventory: RwLock::new(vec![]),
            inventory_errors: RwLock::new(vec![]),
            inventory_dirty: AtomicBool::new(false),
            cuda_visible_gpu_uuids,
            gpu_device_orders: device_orders,
            gpus,
            boot_id: Uuid::new_v4(),
            revision,
            directory,
            model_dirs,
            artifact_sets,
            lifecycle: Mutex::new(()),
            first_run_operation: Mutex::new(()),
            load_operations: std::sync::Mutex::new(BTreeMap::new()),
            normal_stop_enabled: AtomicBool::new(false),
            normal_stop_quit_enabled: AtomicBool::new(false),
            normal_stopping: AtomicBool::new(false),
            normal_stop_admission: RwLock::new(()),
            normal_stop_notification: Notify::new(),
            traffic: Arc::new(std::sync::Mutex::new(BTreeMap::new())),
            activity: Arc::new(std::sync::Mutex::new(BTreeMap::new())),
            worker_slots: Arc::new(std::sync::Mutex::new(BTreeMap::new())),
        });
        host.scan().await?;
        Ok(host)
    }
    /// Windows desktop-managed processes offer an explicit Stop and Quit control.
    pub fn enable_normal_stop(&self) {
        self.normal_stop_quit_enabled.store(true, Ordering::SeqCst);
        self.enable_relocation_stop();
    }

    /// Linux desktop-managed processes support idle root handoff without changing
    /// the existing client/Manager Quit behavior or advertising a Stop/Quit control.
    pub fn enable_relocation_stop(&self) {
        self.normal_stop_enabled.store(true, Ordering::SeqCst);
    }

    /// Hold across an HTTP operation or a maintenance pass which can admit work.
    /// Disabled Hosts retain their previous admission and shutdown behavior.
    pub async fn running_admission(&self) -> Result<Option<tokio::sync::RwLockReadGuard<'_, ()>>, String> {
        if !self.normal_stop_enabled.load(Ordering::SeqCst) { return Ok(None); }
        let guard = self.normal_stop_admission.read().await;
        if self.normal_stopping.load(Ordering::SeqCst) {
            return Err("The Host is stopping; start it again before sending work".into());
        }
        Ok(Some(guard))
    }

    pub async fn wait_for_normal_stop(&self) {
        loop {
            let notified = self.normal_stop_notification.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.normal_stopping.load(Ordering::SeqCst) { return; }
            notified.await;
        }
    }

    async fn normal_stop(&self, req: &mut Request<Body>) -> Result<Response<Body>, String> {
        if !self.local_administrator(req).await {
            return Ok(json(StatusCode::FORBIDDEN, serde_json::json!({"error":"local administrator credential required"})));
        }
        if !self.normal_stop_enabled.load(Ordering::SeqCst) {
            return Ok(json(StatusCode::FORBIDDEN, serde_json::json!({"error":"Normal Host Stop is available only for a desktop-managed Host"})));
        }
        #[derive(Deserialize)]
        struct Stop {
            host_id: Uuid,
            boot_id: Uuid,
            local_identity: serde_json::Value,
        }
        let request: Stop = serde_json::from_value(body_json(req).await?).map_err(|e| e.to_string())?;
        let busy = || json(StatusCode::CONFLICT, serde_json::json!({"error":"The Host is busy. Wait for model loads, hardware profiling, downloads and other Host work to finish, then Stop again."}));
        // A successful exclusive acquisition proves no HTTP handler or admitting
        // maintenance pass is in flight. Keep it through the idle check and fence.
        let Ok(_admission) = self.normal_stop_admission.try_write() else { return Ok(busy()); };
        let Ok(_lifecycle) = self.lifecycle.try_lock() else { return Ok(busy()); };
        let Ok(_first_run) = self.first_run_operation.try_lock() else { return Ok(busy()); };
        let Ok(data) = self.data.try_lock() else { return Ok(busy()); };
        let identity = serde_json::json!({"local_identity": request.local_identity});
        if request.host_id != data.host_id || request.boot_id != self.boot_id
            || crate::local_host::validate_local_identity(&self.directory, &identity).is_err() {
            return Ok(json(StatusCode::CONFLICT, serde_json::json!({"error":"The selected Host identity, data folder, platform or process changed; no Host was stopped"})));
        }
        let host_id = data.host_id;
        drop(data);
        let Ok(processes) = self.processes.try_lock() else { return Ok(busy()); };
        if processes.needs_monitoring()
            || processes.hardware_profile.as_ref().is_some_and(|job| job.busy())
            || self.draft_width.busy() {
            return Ok(busy());
        }
        drop(processes);
        {
            // Coordinator leases can keep workers active on another Host after
            // the admitting HTTP handler has returned its streaming body.
            let Ok(slots) = self.worker_slots.try_lock() else { return Ok(busy()); };
            if slots.values().any(|used| *used != 0) { return Ok(busy()); }
        }
        // Download/move transactions can retain their own journal lock after an
        // HTTP caller disconnects. Never wait for or interrupt that transaction.
        let Ok(downloads) = tokio::time::timeout(Duration::from_millis(100), self.downloads.list()).await else { return Ok(busy()); };
        if downloads.iter().any(|job| matches!(job.status.as_str(), "queued" | "downloading" | "verifying" | "pausing")) {
            return Ok(busy());
        }
        self.normal_stopping.store(true, Ordering::SeqCst);
        self.normal_stop_notification.notify_waiters();
        Ok(json(StatusCode::OK, serde_json::json!({"stopping":true,"host_id":host_id,"boot_id":self.boot_id})))
    }
    pub async fn shutdown_hardware_profile(&self) -> Result<(), String> {
        self.draft_width.cancel().await?;
        let job = self.processes.lock().await.hardware_profile.clone();
        if let Some(job) = job {
            job.shutdown().await?;
        }
        Ok(())
    }
    pub async fn idle_maintenance(&self) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().await;
        let job = {
            let processes = self.processes.lock().await;
            if processes.has_children() || self.draft_width.busy() { return Ok(()); }
            let Some(job) = &processes.hardware_profile else { return Ok(()); };
            if job.busy() { return Ok(()); }
            job.clone()
        };
        let stale = job.status(None).stale_groups;
        let saved: Vec<_> = self.data.lock().await.profiles.values().cloned().collect();
        let inventory = self.inventory.read().await.clone();
        let mut recipes = Vec::new();
        for request in saved {
            if !matches!(request.options.spec.as_str(), "auto" | "dflash")
                || !matches!(request.options.draft_policy.as_str(), "auto" | "adaptive")
                || request.options.draft_tokens != 0
                || !inventory.iter().any(|model| model.id == request.model_id && model.metadata.draft_tp > 0)
                || stale.iter().any(|group| crate::hardware_profile::group_key(&group.gpu_uuids)
                    == crate::hardware_profile::group_key(&request.gpu_uuids)) { continue; }
            let cli = self.processes.lock().await.profiling_cli(&request.gpu_uuids);
            let configuration = job.configuration(cli, &request.gpu_uuids)?;
            if !configuration.profile_path.is_file() { continue; }
            let launch = self.prepare_launch(&request).await?;
            let recipe = tokio::task::spawn_blocking(move || crate::draft_width::Recipe::new(launch, configuration))
                .await.map_err(|e| e.to_string())??;
            recipes.push(recipe);
        }
        self.draft_width.reconcile(&recipes)?;
        self.draft_width.start_next(&recipes)?;
        if self.draft_width.busy() || self.first_run_pending().await {
            return Ok(());
        }
        if self.downloads.list().await.iter().any(|download|
            matches!(download.status.as_str(), "queued" | "downloading" | "pausing" | "verifying")) {
            return Ok(());
        }
        // Selected-model readiness is already established. Extend the same
        // native profile only while the Host has no foreground work. A later
        // Start/quote cancels and reaps this process under lifecycle first.
        if let Some(gpus) = job.deferred_groups().into_iter().next() {
            let cli = self.processes.lock().await.profiling_cli(&gpus);
            job.start_remaining_formats(cli, gpus)?;
        }
        Ok(())
    }
    // Call with lifecycle held, without holding processes across the wait.
    // Only idle completion is preempted; foreground calibration remains busy.
    pub(crate) async fn stop_background_profile(&self) -> Result<(), String> {
        let job = self.processes.lock().await.hardware_profile.clone();
        if let Some(job) = job {
            job.cancel_background_and_wait().await?;
        }
        Ok(())
    }
    pub(crate) async fn set_model_storage(&self, root: PathBuf) -> Result<PathBuf, String> {
        let _lifecycle = self.lifecycle.lock().await;
        self.set_model_storage_locked(root).await
    }
    // The caller holds lifecycle so profile starts cannot overlap validation.
    pub(crate) async fn set_model_storage_locked(&self, root: PathBuf) -> Result<PathBuf, String> {
        if !root.is_absolute() {
            return Err("model storage must be an absolute path".into());
        }
        let checked_root = root.clone();
        tokio::task::spawn_blocking(move || {
            crate::model_storage::require_native_model_storage(&checked_root)
        }).await.map_err(|e| e.to_string())??;
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
        Ok(root)
    }
    async fn verify_qualified_payload(
        &self, payload: PathBuf, sha256: String, bytes: u64,
    ) -> Result<(), String> {
        let mut previous: Vec<_> = self.data.lock().await.payload_verifications
            .get(&payload).cloned().into_iter().collect();
        if let Some(installed) = self.downloads.installed_verification(&payload, &sha256, bytes).await {
            previous.push(installed);
        }
        let path = payload.clone();
        let operation = current_load();
        check_load()?;
        let verification = tokio::task::spawn_blocking(move || {
            crate::payload_verification::verify_controlled(&path, &sha256, bytes, previous.iter(),
                || {
                    operation
                        .as_ref()
                        .is_some_and(|operation| operation.cancelled.load(Ordering::SeqCst))
                },
                |completed, total| {
                    if let Some(operation) = &operation {
                        operation.update(
                            "verification",
                            "Verifying model package",
                            Some((completed, total)),
                        );
                    }
                },
            )
        }).await.map_err(|e| e.to_string())?
            .map_err(crate::launch_profiles::profile_verification_error)?;
        check_load()?;
        let mut data = self.data.lock().await;
        check_load()?;
        if data.payload_verifications.get(&payload) == Some(&verification) {
            return Ok(());
        }
        let previous = data.payload_verifications.insert(payload.clone(), verification);
        let persisted = serde_json::to_vec(&*data).map_err(|e| e.to_string())
            .and_then(|bytes| write_private(&self.directory.join("host.json"), &bytes));
        if let Err(error) = persisted {
            match previous {
                Some(record) => { data.payload_verifications.insert(payload, record); }
                None => { data.payload_verifications.remove(&payload); }
            }
            return Err(error);
        }
        Ok(())
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
        roots.push(self.downloads.default_root().to_path_buf());
        let original_root = self.downloads.original_root().to_path_buf();
        roots.extend(
            self.downloads
                .list()
                .await
                .into_iter()
                .filter_map(|job| job.path),
        );
        let sets = self.artifact_sets.clone();
        let (entries, errors) = tokio::task::spawn_blocking(move || {
            let mut inspection = crate::engine_inventory::InventoryInspection::default();
            let mut pending: Vec<_> = roots.into_iter().map(|p| (p, false)).chain(sets.into_iter().map(|p|(p,true))).collect();
            if original_root.exists() {
                pending.push((original_root, false));
            }
            let mut found = Vec::new();
            let mut errors = Vec::new();
            type DirectoryListing = Result<Vec<Result<std::ffi::OsString, String>>, String>;
            let mut directories: BTreeMap<PathBuf, DirectoryListing> = BTreeMap::new();
            let mut paths = BTreeSet::new();
            let mut rejected = BTreeMap::new();
            let mut published = BTreeSet::new();
            while let Some((path, artifact_set)) = pending.pop() {
                if !paths.insert((path.as_os_str().to_owned(), artifact_set)) {
                    continue;
                }
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
                    let resolved = match path.canonicalize() {
                        Ok(path) => path,
                        Err(e) => {
                            errors.push(serde_json::json!({"path":path,"error":e.to_string()}));
                            continue;
                        }
                    };
                    let listing = directories.entry(resolved).or_insert_with(|| {
                        std::fs::read_dir(&path)
                            .map(|entries| entries.map(|entry| entry.map(|entry| entry.file_name()).map_err(|e| e.to_string())).collect())
                            .map_err(|e| e.to_string())
                    });
                    match &*listing {
                        Ok(entries) => {
                            for entry in entries {
                                match entry {
                                    Ok(name) => pending.push((path.join(name), false)),
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
                    let resolved = match path.canonicalize() {
                        Ok(path) => path,
                        Err(e) => {
                            errors.push(serde_json::json!({"path":path,"error":e.to_string()}));
                            continue;
                        }
                    };
                    let key = (resolved.clone(), artifact_set);
                    if published.contains(&key) {
                        continue;
                    }
                    if let Some(error) = rejected.get(&key) {
                        errors.push(serde_json::json!({"path":path,"error":error}));
                        continue;
                    }
                    // Each pass owns one validation per resolved entry. Rejected
                    // entries still report against each configured path.
                    let result = if artifact_set {
                        inspection.artifact_set_members(&resolved)
                    } else {
                        inspection.inspect_artifact(&resolved).map(|metadata| vec![(resolved.clone(), metadata)])
                    };
                    match result {
                        Ok(members) => {
                            published.insert(key);
                            for (payload, metadata) in members {
                                found.push((resolved.clone(), payload, metadata, artifact_set));
                            }
                        }
                        Err(e) => {
                            errors.push(serde_json::json!({"path":path,"error":e}));
                            rejected.insert(key, e);
                        }
                    }
                }
            }
            (found, errors)
        })
        .await
        .map_err(|e| e.to_string())?;
        let mut data = self.data.lock().await;
        let mut models = BTreeMap::new();
        for (path, payload, metadata, artifact_set) in entries {
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
                    payload,
                },
            );
        }
        *self.inventory.write().await = models.into_values().collect();
        *self.inventory_errors.write().await = errors;
        drop(data);
        let host_persistence = if self.inventory_dirty.load(Ordering::SeqCst) {
            self.save().await
        } else {
            Ok(())
        };
        if host_persistence.is_ok() {
            self.revision.fetch_add(1, Ordering::SeqCst);
        }
        let download_persistence = self.downloads.flush_pending().await;
        match (host_persistence, download_persistence) {
            (Err(host_error), Err(journal_error)) => return Err(format!(
                "could not persist Host state: {host_error}; could not persist download journal: {journal_error}"
            )),
            (Err(error), Ok(())) => return Err(error),
            (Ok(()), Err(error)) => return Err(format!("could not persist download journal: {error}")),
            (Ok(()), Ok(())) => {}
        }
        Ok(())
    }
    pub async fn refresh_processes(&self) -> Result<(), String> {
        let probes = self.processes.lock().await.pending_readiness().await?;
        let (observations, exits) = tokio::join!(
            futures_util::future::join_all(probes.readiness.into_iter().map(|probe| probe.observe())),
            futures_util::future::join_all(probes.exits.into_iter().map(|drain| drain.observe())),
        );
        let mut processes = self.processes.lock().await;
        for observation in exits {
            processes.confirm_exit(observation);
        }
        for observation in observations.into_iter().flatten() {
            processes.confirm_readiness(observation)?;
        }
        let receipts = processes.ready_graph_receipts();
        drop(processes);
        if !receipts.is_empty() {
            let mut changed = false;
            let mut data = self.data.lock().await;
            for (key, bytes) in receipts {
                if data.graph_receipts.get(&key).is_none_or(|old| *old < bytes) {
                    data.graph_receipts.insert(key, bytes);
                    changed = true;
                }
            }
            drop(data);
            if changed { self.inventory_dirty.store(true, Ordering::SeqCst); }
            if self.inventory_dirty.load(Ordering::SeqCst) { self.save().await?; }
        }
        Ok(())
    }
    pub async fn snapshot(&self) -> serde_json::Value {
        let state_directory = self.directory.canonicalize().ok();
        let sharing = self.lan_sharing.lock().await;
        let data = self.data.lock().await;
        let network = serde_json::json!({"managed":sharing.managed,"active":sharing.active(),
            "enabled":if sharing.managed { data.share_lan } else { sharing.standalone.is_some() },
            "port":sharing.standalone.unwrap_or(sharing.port),"error":sharing.error,
            "notice":sharing.notice});
        drop(sharing);
        let processes = self.processes.lock().await;
        let (hardware_profile, revision) = match &processes.hardware_profile {
            Some(job) => {
                let (status, revision) = job.observation(processes.profiling_cli(&job.group()));
                (Some(status), revision)
            }
            None => (None, self.revision.load(Ordering::SeqCst)),
        };
        let observations: Vec<_> = processes
            .instances()
            .map(|i| {
                (
                    i.instance_id,
                    i.session_id,
                    i.status.clone(),
                    i.last_error.clone(),
                    i.launch.clone(),
                    i.model_metadata.clone(),
                )
            })
            .collect();
        drop(processes);
        let profiles = data.profiles.clone();
        let first_run_complete = data.first_run.complete;
        let host_id = data.host_id;
        let name = data.name.clone();
        let management_origin = data.management_origin.clone();
        let management_notice = data.management_notice.clone();
        let fleet = data.fleet.clone();
        let usage = self.client_projection(&data);
        let membership = match Self::membership_view(&data) {
            Ok(view) => serde_json::json!(view),
            Err(error) => serde_json::json!({"error":error}),
        };
        let models = self.inventory.read().await.clone();
        drop(data);
        let launch_profiles = self.launch_profiles.read().await;
        let mut model_index: BTreeMap<_, Vec<_>> = BTreeMap::new();
        for model in &models {
            let metadata = &model.metadata;
            model_index
                .entry((
                    metadata.identity.model_id.as_str(),
                    metadata.identity.weights_id.as_str(),
                    metadata.tp_size,
                    metadata.draft_tp,
                    metadata.size_bytes,
                ))
                .or_default()
                .push(model);
        }
        let mut available_profiles = vec![];
        let mut gpu_choices = BTreeMap::new();
        for profile in launch_profiles.iter() {
            let key = (
                profile.identity.model_id.as_str(),
                profile.identity.weights_id.as_str(),
                profile.tp,
                profile.draft_tp,
                profile.artifact_bytes,
            );
            if let Some(matching) = model_index.get(&key) {
                let (groups, compatible) = gpu_choices.entry((
                    profile.platform.as_str(),
                    profile.gpu_name.as_str(),
                    profile.compute_capability.as_str(),
                    profile.min_memory_mib_per_gpu,
                    profile.tp,
                )).or_insert_with(|| (
                    serde_json::json!(profile.gpu_groups(&self.gpus, &Default::default())),
                    serde_json::json!(profile.gpu_groups(&self.gpus, &Default::default())),
                ));
                for model in matching {
                    available_profiles
                        .push(serde_json::json!({"profile":profile,"model_id":model.id,
                    "gpu_groups":groups,"compatible_gpu_groups":compatible}));
                }
            }
        }
        drop(gpu_choices);
        drop(launch_profiles);
        let mut max_perf_profiles = vec![];
        for model in &models {
            let metadata = &model.metadata;
            if let Ok(profile) = crate::max_perf::profile_for_identity(
                &metadata.identity, metadata.tp_size, metadata.draft_tp, metadata.nvfp4_kv_available,
            ) {
                let groups = profile.gpu_groups(&self.gpus, &Default::default());
                let compatible = profile.gpu_groups(&self.gpus, &Default::default());
                for group in compatible {
                    let resolved = profile.clone();
                    let available: Vec<_> = groups.iter().filter(|candidate| **candidate == group).collect();
                    max_perf_profiles.push(serde_json::json!({"profile":resolved,"model_id":model.id,
                        "gpu_groups":available,"compatible_gpu_groups":[group]}));
                }
            }
        }
        let instance_ids: BTreeSet<_> = observations.iter().map(|(id, ..)| *id).collect();
        let mut instances: Vec<_> = observations
            .iter()
            .map(|(id, session, status, error, launch, metadata)| {
                serde_json::json!({
                    "instance_id": id, "session_id": session, "display_name": launch.model_id,
                    "upstream_model_id": launch.model_id, "status": status, "last_error": error,
                    "configuration": launch, "model_metadata": metadata,
                    "profile": profiles.get(id),
                })
            })
            .collect();
        for (id, profile) in &profiles {
            if !instance_ids.contains(id) {
                instances.push(serde_json::json!({
                    "instance_id":id,"session_id":null,"display_name":profile.model_id.to_string(),
                    "upstream_model_id":"","status":"stopped","last_error":null,
                    "configuration":profile,"profile":profile,"model_metadata":null,
                }));
            }
        }
        {
            let traffic = self.traffic.lock().unwrap();
            for instance in &mut instances {
                if let Some(id) = instance["instance_id"]
                    .as_str()
                    .and_then(|id| id.parse::<Uuid>().ok())
                {
                    instance["active_requests"] = traffic
                        .get(&id)
                        .map(|traffic| traffic.count)
                        .unwrap_or(0)
                        .into();
                }
            }
        }
        let engine_presets_available = !available_profiles.is_empty() || !max_perf_profiles.is_empty();
        let mut snapshot = serde_json::json!({"protocol_version":1,"host_id":host_id,"boot_id":self.boot_id,
            "can_stop_host":self.normal_stop_quit_enabled.load(Ordering::SeqCst),
            "local_identity":{"state_directory":state_directory,"platform":std::env::consts::OS},
            "management_origin":management_origin,"management_notice":management_notice,
            "lan_sharing": {"enabled":network["enabled"],"managed":network["managed"],
                "active":network["active"],"port":network["port"],"error":network["error"],
                "notice":network["notice"]},
            "display_name":name,"revision":revision,
            "fleet":fleet,
            "fleet_membership":membership,
            "clients":usage["clients"],"local_administrator":usage["local_administrator"],
            "hardware_profile":hardware_profile,
            "first_run":{"complete":first_run_complete},
            "draft_width_calibrations":self.draft_width.status(),
            "gpus":self.gpus,"cuda_visible_gpu_uuids":self.cuda_visible_gpu_uuids,"gpu_device_orders":self.gpu_device_orders,"models":models,
            "inventory_errors":*self.inventory_errors.read().await,
            "profile_error":*self.profile_error.read().await,
            "model_management":{"version":1,"downloads":self.downloads.list().await,
                "managed_root":self.downloads.root(),"engine_presets_available":engine_presets_available}});
        snapshot["instances"] = serde_json::Value::Array(instances);
        snapshot["launch_profiles"] = serde_json::Value::Array(available_profiles);
        snapshot["max_perf_profiles"] = serde_json::Value::Array(max_perf_profiles);
        snapshot
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
                "gbot_control":self.gbot.status(*id),"active_requests":usage.map(|u|u.instances.values().sum::<usize>()).unwrap_or(0),
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
    pub(crate) async fn prepare_launch(&self, request: &LaunchRequest) -> Result<EngineLaunch, String> {
        let model = self
            .inventory
            .read()
            .await
            .iter()
            .find(|m| m.id == request.model_id)
            .cloned()
            .ok_or("model is not installed")?;
        let id = request.instance_id.unwrap_or_else(Uuid::new_v4);
        let path = model.path.clone();
        let artifact_set = model.artifact_set;
        let members = tokio::task::spawn_blocking(move || {
            if artifact_set {
                artifact_set_members(&path)
            } else {
                let metadata = inspect_artifact(&path)?;
                Ok(vec![(
                    path.canonicalize().map_err(|e| e.to_string())?,
                    metadata,
                )])
            }
        })
        .await
        .map_err(|e| e.to_string())??;
        let (payload, metadata) = members
            .iter()
            .find(|(_, metadata)| !model.artifact_set || metadata.tp_size == model.metadata.tp_size)
            .cloned()
            .ok_or("artifact set no longer declares selected degree")?;
        let artifact_dependencies = members.into_iter().map(|(path, _)| path).collect();
        if metadata != model.metadata {
            return Err(
                "artifact changed since inventory scan; refresh inventory before loading".into(),
            );
        }
        for uuid in &request.gpu_uuids {
            let gpu = self.gpus.iter().find(|gpu| &gpu.uuid == uuid).ok_or("unknown GPU")?;
            if !metadata.identity.supports_gpu(gpu.compute_capability.as_deref())
                || (request.options.kv_dtype == "nvfp4" && gpu.compute_capability.as_deref() != Some("12.0"))
            {
                return Err("Select a supported GPU family (SM 80/86/89/120); NVFP4 weights or KV require Blackwell (sm_120)".into());
            }
        }
        if let Some(reference) = &request.benchmark_profile {
            reference.resolve().map_err(|error| error.to_string())?;
            if request.qualified_profile_id.is_some() {
                return Err("GBench Max Perf is separate from qualified capacity profiles".into());
            }
            let profile = crate::max_perf::profile_for_identity(&metadata.identity,
                metadata.tp_size, metadata.draft_tp, metadata.nvfp4_kv_available)
                .map_err(|error| error.to_string())?;
            if profile.reference != *reference || profile.max_context != request.max_context
                || profile.concurrency != request.concurrency || profile.options != request.options
            {
                return Err("settings no longer match GBench Max Perf; select it again or explicitly use custom settings".into());
            }
            if let Some(id) = request.instance_id {
                let saved_tp = self.data.lock().await.profiles.get(&id)
                    .map(|saved| saved.gpu_uuids.len());
                let live_tp = self.processes.lock().await.instances()
                    .find(|instance| instance.instance_id == id).map(|instance| instance.launch.tp);
                if saved_tp.is_some_and(|tp| tp != 1) || live_tp.is_some_and(|tp| tp != 1) {
                    return Err("GBench Max Perf cannot convert an existing TP2/TP4 instance".into());
                }
            }
            if !profile.gpu_groups(&self.gpus, &Default::default()).contains(&request.gpu_uuids) {
                return Err("GPU group is incompatible with GBench Max Perf".into());
            }
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
            self.verify_qualified_payload(payload, profile.artifact_sha256, profile.artifact_bytes)
                .await?;
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
        let options = request.options.clone();
        let socket = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = socket.local_addr().map_err(|e| e.to_string())?.port();
        drop(socket);
        Ok(EngineLaunch {
            instance_id: id,
            artifact: model.path,
            artifact_dependencies,
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
            benchmark_profile: request.benchmark_profile.clone(),
            options,
        })
    }
    /// Resolve the same validated TP payload as serving. Browser callers never
    /// supply artifact paths, directory identities or package-verification claims.
    pub(crate) async fn selected_profile_intent(
        &self,
        request: &LaunchRequest,
    ) -> Result<crate::hardware_profile::ArtifactProfileIntent, String> {
        let launch = self.prepare_launch(request).await?;
        self.selected_profile_intent_for_launch(&launch).await
    }

    async fn selected_profile_intent_for_launch(
        &self,
        launch: &EngineLaunch,
    ) -> Result<crate::hardware_profile::ArtifactProfileIntent, String> {
        let artifact = launch.artifact.clone();
        let artifact_set = launch.artifact_set;
        let tp = launch.tp;
        let (path, directory_sha256) = tokio::task::spawn_blocking(move || {
            let path = if artifact_set {
                artifact_set_members(&artifact)?.into_iter()
                    .find(|(_, metadata)| metadata.tp_size == tp)
                    .map(|(path, _)| path)
                    .ok_or("artifact set no longer declares selected degree")?
            } else {
                artifact.canonicalize().map_err(|error| error.to_string())?
            };
            let (_, directory_sha256) = crate::engine_inventory::inspect_artifact_directory(&path)?;
            Ok::<_, String>((path, directory_sha256))
        }).await.map_err(|error| error.to_string())??;
        let mut package_sha256 = None;
        for download in self.downloads.list().await {
            if download.status != "installed" { continue; }
            let Some(installed) = download.path else { continue; };
            if tokio::fs::canonicalize(installed).await.ok().as_ref() == Some(&path) {
                package_sha256 = Some(download.release.sha256);
                break;
            }
        }
        Ok(crate::hardware_profile::ArtifactProfileIntent {
            path,
            directory_sha256,
            package_sha256,
            tp: launch.tp,
            draft_tp: launch.options.draft_tp,
            spec: launch.options.spec.clone(),
            draft_tokens: (launch.options.draft_tokens != 0).then_some(launch.options.draft_tokens),
        })
    }
    /// The caller owns lifecycle, but never the processes mutex while waiting.
    /// Only native acceptance in this Host process admits the selected artifact.
    pub(crate) async fn ensure_selected_profile(&self, launch: &EngineLaunch) -> Result<(), String> {
        self.stop_background_profile().await?;
        let (job, cli, has_children) = {
            let processes = self.processes.lock().await;
            (processes.hardware_profile.clone(), processes.profiling_cli(&launch.gpu_uuids), processes.has_children())
        };
        let Some(job) = job else { return Ok(()); };
        let intent = self.selected_profile_intent_for_launch(launch).await?;
        let busy = job.busy();
        let status = job.status(cli.clone());
        let same_group = job.group().into_iter().collect::<std::collections::BTreeSet<_>>()
            == launch.gpu_uuids.iter().cloned().collect::<std::collections::BTreeSet<_>>();
        if busy && (!same_group || status.scope != "artifact" || status.selected_artifact.as_ref() != Some(&intent)) {
            return Err("Another hardware profiling job reserves this host; wait for it or cancel it before loading this model".into());
        }
        if !busy && job.artifact_is_accepted(&launch.gpu_uuids, &intent) { return Ok(()); }
        if has_children {
            return Err("Stop running models before profiling this selected artifact, then retry Load".into());
        }
        check_load()?;
        if let Some(operation) = current_load() {
            operation.update("profiling", "Measuring hardware for this model", None);
        }
        if !busy {
            job.start_scoped(crate::hardware_profile::HardwareProfileAction::Ensure, cli.clone(), launch.gpu_uuids.clone(), intent.clone())?;
            if let (Some(operation), Some(id)) = (current_load(), job.status(cli.clone()).job_id) {
                *operation.profile.lock().unwrap() = Some((job.clone(), id));
                if operation.check().is_err() {
                    job.cancel_job_and_wait(id).await?;
                    return operation.check();
                }
            }
        }
        let job_id = job.status(cli.clone()).job_id;
        loop {
            if let Some(operation) = current_load() {
                if operation.check().is_err() {
                    let owned = operation.profile.lock().unwrap().clone();
                    if let Some((owned_job, id)) = owned {
                        owned_job.cancel_job_and_wait(id).await?;
                    }
                    return operation.check();
                }
            }
            let status = job.status(cli.clone());
            if status.job_id != job_id || status.scope != "artifact" || status.selected_artifact.as_ref() != Some(&intent) {
                return Err("Selected hardware profiling job changed before model loading".into());
            }
            if !job.busy() {
                if job.artifact_is_accepted(&launch.gpu_uuids, &intent) { return Ok(()); }
                return Err(format!("Selected hardware profiling {}: {}", status.status,
                    status.error.as_deref().unwrap_or("use the hardware profiling controls to resume or retry before loading")));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    pub async fn launch(&self, request: LaunchRequest) -> Result<Uuid, String> {
        self.place(request, 1).await
    }
    async fn place(&self, request: LaunchRequest, remaining: u32) -> Result<Uuid, String> {
        let _lifecycle = self.lifecycle.lock().await;
        check_load()?;
        self.stop_background_profile().await?;
        let launch = self.prepare_launch(&request).await?;
        self.start_placement(request, launch, remaining).await
    }
    // The caller owns lifecycle through quote, launch and Ready so another
    // placement cannot quote memory still being allocated by this process.
    async fn start_placement(&self, request: LaunchRequest, launch: EngineLaunch, remaining: u32) -> Result<Uuid, String> {
        use crate::engine_registry::InstanceStatus;
        if remaining == 0 { return Err("remaining instances must be positive".into()); }
        self.ensure_selected_profile(&launch).await?;
        self.processes.lock().await.validate_launch(&launch, false)?;
        let sharing = self.processes.lock().await.reserved_gpus(None)
            .iter().any(|gpu| launch.gpu_uuids.contains(gpu));
        let id = self.start_prepared(request, launch, remaining).await?;
        if remaining == 1 && !sharing { return Ok(id); }
        loop {
            self.refresh_processes().await?;
            let processes = self.processes.lock().await;
            let instance = processes.instances().find(|instance| instance.instance_id == id).ok_or("new instance disappeared")?;
            match instance.status {
                InstanceStatus::Ready => return Ok(id),
                InstanceStatus::Starting => {},
                _ => return Err(format!("Instance {id} did not become Ready: {}", instance.last_error.as_deref().unwrap_or("Engine stopped during startup"))),
            }
            drop(processes);
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    // The caller holds lifecycle so a quote cannot race another placement's
    // allocation. Preview and placement use the same current Engine contract.
    pub(crate) async fn quote_prepared(
        &self,
        launch: &EngineLaunch,
        remaining: u32,
    ) -> Result<(serde_json::Value, Option<u64>), String> {
        use crate::engine_registry::InstanceStatus;
        if remaining == 0 { return Err("remaining instances must be positive".into()); }
        let sharing = self.processes.lock().await.reserved_gpus(Some(launch.instance_id))
            .iter().any(|gpu| launch.gpu_uuids.contains(gpu));
        if (sharing || remaining > 1) && launch.model_id.starts_with("qwen3.8-flash-next/") && launch.options.vram_budget_bytes.is_none() {
            return Err("Flash sharing needs a per-instance weight residency budget: set it in Custom settings, start the package once by itself with that budget and wait for Ready to save its graph-memory receipt, then add instances with the same settings".into());
        }
        self.stop_background_profile().await?;
        self.draft_width.cancel().await?;
        loop {
            self.refresh_processes().await?;
            let starting = self.processes.lock().await.instances().any(|instance|
                instance.status == InstanceStatus::Starting
                && instance.launch.gpu_uuids.iter().any(|gpu| launch.gpu_uuids.contains(gpu)));
            if !starting { break; }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let receipt_key = if launch.model_id.starts_with("qwen3.8-flash-next/") {
            Some(self.processes.lock().await.graph_receipt_key(launch)?)
        } else { None };
        let graph_allowance = match receipt_key {
            Some(key) => self.data.lock().await.graph_receipts.get(&key).copied(),
            None => None,
        };
        let mut command = self.processes.lock().await.startup_quote_command(launch, graph_allowance)?;
        let output = tokio::time::timeout(Duration::from_secs(600), command.output()).await
            .map_err(|_| "Engine startup quote timed out")?
            .map_err(|error| format!("could not run Engine startup quote: {error}"))?;
        if !output.status.success() {
            let tail = &output.stderr[output.stderr.len().saturating_sub(16_384)..];
            return Err(format!("Engine startup quote failed: {}", String::from_utf8_lossy(tail).trim()));
        }
        let value: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("Engine startup quote is unavailable or invalid; update the Engine runtime: {error}"))?;
        let quote: crate::engine_host::StartupQuote = serde_json::from_value(value.clone())
            .map_err(|error| format!("Engine startup quote is unavailable or invalid; update the Engine runtime: {error}"))?;
        // A first solo Flash start measures graph memory. Unknown graph cost
        // cannot authorize an explicit allocation; let the Engine size AUTO.
        quote.validate(launch)?;
        let kv_arena_bytes = if launch.model_id.starts_with("qwen3.8-flash-next/") && remaining == 1 && !sharing
            && launch.options.kv_arena_bytes.is_none() && quote.unknown_graph_allowance() {
            None
        } else {
            Some(quote.kv_budget(launch, remaining)?)
        };
        Ok((value, kv_arena_bytes))
    }
    async fn quote(&self, request: LaunchRequest, remaining: u32) -> Result<serde_json::Value, String> {
        let _lifecycle = self.lifecycle.lock().await;
        // Preserve draft-width calibration during previews. Deferred hardware
        // formats yield to both previews and Start under this lifecycle fence.
        if self.draft_width.busy() {
            return Err("Draft-width calibration is running; wait for it to finish before requesting a startup quote".into());
        }
        let launch = self.prepare_launch(&request).await?;
        self.stop_background_profile().await?;
        self.processes.lock().await.validate_launch(&launch, false)?;
        let (quote, kv_arena_bytes) = self.quote_prepared(&launch, remaining).await?;
        Ok(serde_json::json!({
            "model_identity": {"model_id": quote["model_id"], "weights_id": quote["weights_id"]},
            "instance_count": remaining,
            "kv_arena_bytes": kv_arena_bytes,
            "quote": quote,
        }))
    }
    async fn start_prepared(
        &self,
        mut request: LaunchRequest,
        mut launch: EngineLaunch,
        remaining: u32,
    ) -> Result<Uuid, String> {
        check_load()?;
        if let Some(operation) = current_load() {
            operation.update(
                "starting",
                "Checking startup settings and starting the model",
                None,
            );
        }
        let (_, kv_arena_bytes) = self.quote_prepared(&launch, remaining).await?;
        check_load()?;
        // A pre-load quote estimates capacity; it does not reserve VRAM or
        // include every allocation made during startup. A solo AUTO launch
        // must let the Engine size its arena after those allocations. Shared
        // placement and positive user overrides retain their exact limits.
        let sharing = self.processes.lock().await.reserved_gpus(Some(launch.instance_id))
            .iter().any(|gpu| launch.gpu_uuids.contains(gpu));
        if launch.options.kv_arena_bytes.is_some() || remaining > 1 || sharing {
            launch.options.kv_arena_bytes = kv_arena_bytes;
        }
        if request.options.kv_arena_bytes != launch.options.kv_arena_bytes {
            request.qualified_profile_id = None;
            // Resolving AUTO changes capacity, not the selected Max Perf recipe.
        }
        let id = launch.instance_id;
        check_load()?;
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
        self.processes.lock().await.mark_profile_persisted(id);
        self.revision.fetch_add(1, Ordering::SeqCst);
        Ok(id)
    }
    async fn stop_instance(&self, id: Uuid, force: bool) -> Result<(), String> {
        let idle = {
            let mut traffic = self.traffic.lock().unwrap();
            let traffic = traffic.entry(id).or_default();
            traffic.draining = true;
            traffic.idle.clone()
        };
        let _draining = DrainGuard {
            traffic: self.traffic.clone(),
            id,
        };
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        if !force {
            loop {
                let notified = idle.notified();
                tokio::pin!(notified);
                // Register before inspecting the count so the last release cannot
                // be lost between the check and the await.
                notified.as_mut().enable();
                if !self.traffic.lock().unwrap().get(&id).is_some_and(|traffic| traffic.count > 0) {
                    break;
                }
                if tokio::time::timeout_at(deadline, notified).await.is_err() {
                    return Err("instance still has active requests; retry after completion or choose force-stop".into());
                }
            }
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
            let traffic = traffic.entry(id).or_default();
            if traffic.draining {
                return Err("instance is draining".into());
            }
            traffic.count += 1;
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
                let model = (suffix != "v1/ginfer/benchmark").then_some(model.as_str());
                upstream = upstream
                    .header(hyper::header::CONTENT_TYPE, "application/json")
                    .body(match inference_body(bytes, model, suffix) {
                        Ok(body) => body,
                        Err(message) => return Ok(json(StatusCode::BAD_REQUEST, serde_json::json!({
                            "error": {"message": message, "type": "invalid_request_error", "code": "unsupported_request"}
                        }))),
                    });
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
        let result = if req.method() == hyper::Method::POST && req.uri().path() == "/host/v1/stop" {
            self.normal_stop(&mut req).await
        } else {
            match self.running_admission().await {
                Ok(_admission) => self.handle_load(&mut req).await,
                Err(error) => Ok(json(StatusCode::SERVICE_UNAVAILABLE, serde_json::json!({"error":error}))),
            }
        };
        Ok(result
            .unwrap_or_else(|e| json(StatusCode::BAD_REQUEST, serde_json::json!({"error": e}))))
    }
    fn load_operation(&self, id: Uuid) -> Arc<LoadOperation> {
        self.load_operations
            .lock()
            .unwrap()
            .entry(id)
            .or_insert_with(|| Arc::new(LoadOperation::new(id)))
            .clone()
    }
    async fn handle_load(
        self: &Arc<Self>,
        req: &mut Request<Body>,
    ) -> Result<Response<Body>, String> {
        if req.method() != hyper::Method::POST
            || !matches!(
                req.uri().path(),
                "/host/v1/profile-launch" | "/host/v1/instances"
            )
        {
            return self.handle(req).await;
        }
        // Paired remote clients retain their existing protocol and cannot control desktop loads.
        if !self.local_administrator(req).await {
            return self.handle(req).await;
        }
        let mut body = body_json(req).await?;
        let id = body
            .as_object_mut()
            .and_then(|body| body.remove("load_operation_id"));
        *req.body_mut() = Body::from(body.to_string());
        let Some(id) = id.filter(|id| !id.is_null()) else {
            return self.handle(req).await;
        };
        let id: Uuid = serde_json::from_value(id).map_err(|_| "Invalid model load operation id")?;
        let operation = self.load_operation(id);
        operation.check()?;
        operation.update("preparing", "Preparing model load", None);
        let mut guard = LoadRequestGuard {
            operation: operation.clone(),
            finished: false,
        };
        let result = LOAD_OPERATION
            .scope(operation.clone(), self.handle(req))
            .await;
        if result
            .as_ref()
            .is_ok_and(|response| response.status().is_success())
        {
            guard.finished = true;
        } else {
            let was_cancelled = operation.cancelled.load(Ordering::SeqCst);
            operation.cancel();
            let owned = operation.profile.lock().unwrap().clone();
            if let Some((job, id)) = owned {
                job.cancel_job_and_wait(id).await?;
            }
            if let Err(error) = &result {
                let mut view = operation.view.lock().unwrap();
                if !was_cancelled {
                    view["status"] = "failed".into();
                }
                view["detail"] = error.clone().into();
            }
            guard.finished = true;
        }
        result
    }
    async fn handle(self: &Arc<Self>, req: &mut Request<Body>) -> Result<Response<Body>, String> {
        let path = req.uri().path().to_string();
        if path.starts_with("/host/v1/gbot/") { return self.gbot_route(req).await; }
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
        if let Some(id) = path.strip_prefix("/host/v1/load-operations/") {
            if principal != Principal::LocalAdministrator {
                return Ok(json(
                    StatusCode::FORBIDDEN,
                    serde_json::json!({"error":"local administrator credential required"}),
                ));
            }
            let id: Uuid = id.parse().map_err(|_| "Invalid model load operation id")?;
            let operation = self.load_operation(id);
            if req.method() == hyper::Method::POST {
                let body = body_json(req).await?;
                match body["action"].as_str() {
                    Some("begin") => {
                        operation.check()?;
                    }
                    Some("cancel") => {
                        operation.cancel();
                        let owned = operation.profile.lock().unwrap().clone();
                        if let Some((job, id)) = owned {
                            job.cancel_job_and_wait(id).await?;
                        }
                    }
                    Some("complete") => {
                        let mut view = operation.view.lock().unwrap();
                        // A Ready result wins the final Cancel race; it is already a resident model.
                        view["status"] = "ready".into();
                        view["phase"] = "starting".into();
                    }
                    Some("fail") => {
                        let cancelled = operation.cancelled.load(Ordering::SeqCst);
                        operation.cancel();
                        let mut view = operation.view.lock().unwrap();
                        if !cancelled {
                            view["status"] = "failed".into();
                        }
                    }
                    _ => return Err("Unknown model load operation action".into()),
                }
            } else if req.method() != hyper::Method::GET {
                return Err("Unsupported model load operation method".into());
            }
            let view = operation.view.lock().unwrap().clone();
            return Ok(json(StatusCode::OK, view));
        }

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
        if path == "/host/v1/fleet/worker-slot" && req.method() == hyper::Method::POST {
            let instance: crate::engine_registry::InstanceRef =
                serde_json::from_value(body_json(req).await?).map_err(|error| error.to_string())?;
            let data = self.data.lock().await;
            let crate::fleet::FleetView::Coordinator { fleet } = &data.fleet else {
                return Ok(json(
                    StatusCode::CONFLICT,
                    serde_json::json!({"error":"Worker admission requires the fleet coordinator"}),
                ));
            };
            // The lowest configured limit belongs to the instance, across every
            // pool and every caller. A client never supplies or multiplies it.
            let limit = fleet
                .pools
                .iter()
                .flat_map(|pool| &pool.members)
                .filter(|member| member.instance == instance)
                .map(|member| member.worker_limit)
                .min()
                .ok_or("Instance is not a configured fleet pool member")?;
            let mut slots = self.worker_slots.lock().unwrap();
            let used = slots.entry(instance.clone()).or_default();
            if *used >= limit {
                return Ok(json(
                    StatusCode::TOO_MANY_REQUESTS,
                    serde_json::json!({"error":"Instance worker capacity is full"}),
                ));
            }
            *used += 1;
            let slot = WorkerSlot {
                slots: self.worker_slots.clone(),
                instance,
            };
            drop(slots);
            drop(data);
            let (mut sender, body) = Body::channel();
            let host = self.clone();
            tokio::spawn(async move {
                let _slot = slot;
                loop {
                    // A revoked grant or changed authority ends the lease, and
                    // its desktop cancels work when the stream ends.
                    let data = host.data.lock().await;
                    let valid = matches!(&data.fleet, crate::fleet::FleetView::Coordinator { .. })
                        && match principal {
                            Principal::LocalAdministrator => true,
                            Principal::Client(id) => data.clients.contains_key(&id),
                        };
                    drop(data);
                    if !valid || sender.send_data("slot\n".into()).await.is_err() {
                        break;
                    }
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            });
            return Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "application/octet-stream")
                .header("cache-control", "no-store")
                .body(body)
                .map_err(|error| error.to_string());
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
                        self.stop_background_profile().await?;
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
                        self.start_prepared(profile, launch, 1).await?;
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
                self.gbot.change(id, "revoke")?;
                if let crate::fleet::FleetState::Coordinator { fleet } = &next_fleet {
                    data.fleet_revision = data.fleet_revision.max(fleet.revision);
                }
                let previous_fleet = std::mem::replace(&mut data.fleet, next_fleet);
                let previous = data.clients.remove(&id);
                let saved = write_private(
                    &self.directory.join("host.json"),
                    &serde_json::to_vec(&*data).map_err(|e| e.to_string())?,
                );
                if saved.is_err() {
                    if let Some(previous) = previous {
                        data.clients.insert(id, previous);
                    }
                    data.fleet = previous_fleet;
                    data.fleet_revision = previous_revision;
                }
                drop(data);
                self.gbot.close_client_views(id).await;
                saved?;
                self.revision.fetch_add(1, Ordering::SeqCst);
                return Ok(json(StatusCode::OK, serde_json::json!({"revoked":id})));
            }
        }
        match (req.method().as_str(), path.as_str()) {
            ("GET", "/host/v1/first-run") => {
                Ok(json(StatusCode::OK, self.first_run_status().await?))
            }
            ("POST", "/host/v1/first-run") => Ok(json(
                StatusCode::OK,
                self.first_run_action(body_json(req).await?).await?,
            )),
            ("POST", "/host/v1/hardware-profile") => {
                let request: crate::hardware_profile::HardwareProfileRequest =
                    serde_json::from_value(body_json(req).await?).map_err(|e| e.to_string())?;
                let _lifecycle = self.lifecycle.lock().await;
                self.stop_background_profile().await?;
                self.draft_width.cancel().await?;
                let saved = self
                    .data
                    .lock()
                    .await
                    .profiles
                    .values()
                    .map(|profile| profile.gpu_uuids.clone())
                    .collect();
                let processes = self.processes.lock().await;
                if request.action == crate::hardware_profile::HardwareProfileAction::Ensure
                    && request.gpu_uuids.is_none()
                {
                    processes.ensure_hardware_if_idle(saved)?;
                }
                let result = if request.action
                    == crate::hardware_profile::HardwareProfileAction::Ensure
                    && request.gpu_uuids.is_none()
                {
                    processes
                        .hardware_profile
                        .as_ref()
                        .ok_or("Hardware profiling is not configured")?
                        .status(None)
                } else {
                    processes.hardware_profile_action(request)?
                };
                drop(processes);
                self.revision.fetch_add(1, Ordering::SeqCst);
                Ok(json(
                    StatusCode::OK,
                    serde_json::to_value(result).map_err(|e| e.to_string())?,
                ))
            }
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
                self.draft_width.cancel().await?;
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
                    #[serde(default)]
                    structured_outputs: Option<bool>,
                    #[serde(default = "one_instance")]
                    remaining_instances: u32,
                    #[serde(default)]
                    kv_arena_bytes: Option<u64>,
                }
                let body = body_json(req).await?;
                let selection: Selection =
                    serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
                let _lifecycle = self.lifecycle.lock().await;
                check_load()?;
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
                let mut request = if selection.profile_id.starts_with("gbench-max-perf-") {
                    let model = self.inventory.read().await.iter()
                        .find(|model| model.id == selection.model_id).cloned().ok_or("model is not installed")?;
                    let metadata = &model.metadata;
                    let profile = crate::max_perf::profile_for_identity(&metadata.identity,
                        metadata.tp_size, metadata.draft_tp, metadata.nvfp4_kv_available)
                        .map_err(|error| error.to_string())?;
                    if profile.id != selection.profile_id {
                        return Err("unknown GBench Max Perf profile for this artifact".into());
                    }
                    if selection.structured_outputs == Some(false) {
                        return Err("GBench Max Perf uses the Host structured-output default; explicitly use custom settings to change it".into());
                    }
                    LaunchRequest {instance_id:selection.instance_id,qualified_profile_id:None,
                        benchmark_profile:Some(profile.reference),model_id:selection.model_id,
                        gpu_uuids:selection.gpu_uuids,max_context:profile.max_context,
                        concurrency:profile.concurrency,options:profile.options}
                } else {
                    let profile = self.launch_profiles.read().await.iter()
                        .find(|p| p.id == selection.profile_id).cloned().ok_or("unknown qualified profile")?;
                    LaunchRequest {instance_id:selection.instance_id,qualified_profile_id:Some(profile.id),
                        benchmark_profile:None,model_id:selection.model_id,gpu_uuids:selection.gpu_uuids,
                        max_context:profile.max_context,concurrency:profile.concurrency,options:profile.options}
                };
                // Reap idle completion before payload verification or scoped calibration.
                self.stop_background_profile().await?;
                let mut launch = self.prepare_launch(&request).await?;
                let enabled = selection.structured_outputs.unwrap_or(true);
                if enabled != request.options.structured_outputs {
                    request.options.structured_outputs = enabled;
                    launch.options.structured_outputs = enabled;
                    request.qualified_profile_id = None;
                }
                // Catalog KV bytes describe historical qualification, not
                // current capacity. Only an explicit user override is retained;
                // every spawn quotes the final settings against the live Engine.
                if request.options.kv_arena_bytes != selection.kv_arena_bytes {
                    request.qualified_profile_id = None;
                    request.benchmark_profile = None;
                    launch.benchmark_profile = None;
                }
                request.options.kv_arena_bytes = selection.kv_arena_bytes;
                launch.options.kv_arena_bytes = selection.kv_arena_bytes;
                self.ensure_selected_profile(&launch).await?;
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
                let id = if selection.instance_id.is_some() {
                    self.start_prepared(request, launch, 1).await?
                } else {
                    self.start_placement(request, launch, selection.remaining_instances).await?
                };
                let kv_arena_bytes = self.processes.lock().await.instances().find(|instance| instance.instance_id == id).and_then(|instance| instance.launch.options.kv_arena_bytes);
                Ok(json(StatusCode::OK, serde_json::json!({"instance_id":id,"kv_arena_bytes":kv_arena_bytes})))
            }
            ("POST", "/host/v1/remove-model") => {
                let body = body_json(req).await?;
                let id = body["model_id"]
                    .as_str()
                    .ok_or("model id required")?
                    .parse::<Uuid>()
                    .map_err(|e| e.to_string())?;
                let _lifecycle = self.lifecycle.lock().await;
                let inventory = self.inventory.read().await.clone();
                let model = inventory
                    .iter()
                    .find(|m| m.id == id)
                    .cloned()
                    .ok_or("unknown model")?;
                self.draft_width.cancel().await?;
                let mut affected_paths = BTreeSet::from([model.path.clone()]);
                affected_paths.extend(
                    inventory
                        .iter()
                        .filter(|entry| entry.artifact_set && entry.payload == model.path)
                        .map(|entry| entry.path.clone()),
                );
                let affected_ids: BTreeSet<_> = inventory
                    .iter()
                    .filter(|entry| affected_paths.contains(&entry.path))
                    .map(|entry| entry.id)
                    .collect();
                let present_ids: BTreeSet<_> = inventory.iter().map(|entry| entry.id).collect();
                let processes = self.processes.lock().await;
                let mut active_ids = BTreeSet::new();
                let mut stopped_dependency_ids = BTreeSet::new();
                for instance in processes.instances() {
                    let uses_payload = instance.launch.artifact_dependencies.contains(&model.path);
                    if matches!(instance.status,
                        crate::engine_registry::InstanceStatus::Stopped
                            | crate::engine_registry::InstanceStatus::Failed
                    ) {
                        if instance.profile_persisted && uses_payload {
                            stopped_dependency_ids.insert(instance.instance_id);
                        }
                    } else {
                        if uses_payload {
                            return Err(
                                "stop every instance using this package before removing it".into(),
                            );
                        }
                        active_ids.insert(instance.instance_id);
                    }
                }
                drop(processes);
                let removed = self.downloads.remove_installed(&model.path).await?;
                {
                    let mut data = self.data.lock().await;
                    let previous_len = data.profiles.len();
                    data.profiles.retain(|id, p| {
                        active_ids.contains(id)
                            || (!affected_ids.contains(&p.model_id)
                                && (present_ids.contains(&p.model_id)
                                    || !stopped_dependency_ids.contains(id)))
                    });
                    if data.profiles.len() != previous_len {
                        self.inventory_dirty.store(true, Ordering::SeqCst);
                    }
                }
                let cleanup = self.scan().await;
                match (removed.journal_error, cleanup) {
                    (Some(journal_error), Err(cleanup_error)) => return Err(format!(
                        "package removed but download journal could not be saved: {journal_error}; Host cleanup could not finish: {cleanup_error}"
                    )),
                    (Some(error), Ok(())) => return Err(format!("package removed but download journal could not be saved: {error}")),
                    (None, Err(error)) => return Err(error),
                    (None, Ok(())) => {}
                }
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
                let root = self
                    .set_model_storage(PathBuf::from(
                        body["path"].as_str().ok_or("storage path required")?,
                    ))
                    .await?;
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
                    return Err("release needs a supported homogeneous GPU group of its TP degree; NVFP4 requires Blackwell (sm_120)".into());
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
                let _lifecycle = self.lifecycle.lock().await;
                self.draft_width.cancel().await?;
                self.scan().await?;
                // Discovery does not reserve the Host for an all-format
                // calibration. First-run selects its verified artifact first;
                // deferred formats are extended by idle maintenance.
                self.processes.lock().await.activity_notification().notify_one();
                Ok(json(StatusCode::OK, self.snapshot().await))
            }
            ("POST", "/host/v1/startup-quote") => {
                if !self.local_administrator(req).await {
                    return Ok(json(StatusCode::FORBIDDEN, serde_json::json!({"error":"local administrator credential required"})));
                }
                #[derive(Deserialize)]
                struct Quote {
                    #[serde(default = "one_instance")]
                    remaining_instances: u32,
                    #[serde(flatten)]
                    request: LaunchRequest,
                }
                let request: Quote = serde_json::from_value(body_json(req).await?).map_err(|e| e.to_string())?;
                Ok(json(StatusCode::OK, self.quote(request.request, request.remaining_instances).await?))
            }
            ("POST", "/host/v1/instances") => {
                #[derive(Deserialize)]
                struct Placement {
                    #[serde(default = "one_instance")]
                    remaining_instances: u32,
                    #[serde(flatten)]
                    request: LaunchRequest,
                }
                let placement: Placement = serde_json::from_value(body_json(req).await?).map_err(|e| e.to_string())?;
                let id = self.place(placement.request, placement.remaining_instances).await?;
                let kv_arena_bytes = self.processes.lock().await.instances().find(|instance| instance.instance_id == id).and_then(|instance| instance.launch.options.kv_arena_bytes);
                Ok(json(
                    StatusCode::ACCEPTED,
                    serde_json::json!({"instance_id":id,"kv_arena_bytes":kv_arena_bytes}),
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
pub(crate) async fn body_json(req: &mut Request<Body>) -> Result<serde_json::Value, String> {
    serde_json::from_slice(&bounded_body(req, 1024 * 1024).await?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod load_operation_tests {
    use super::*;

    async fn fixture() -> (tempfile::TempDir, Arc<Host>, String) {
        let directory = tempfile::tempdir().unwrap();
        let host = Host::open(
            directory.path().into(),
            "Load cancellation fixture".into(),
            std::env::current_exe().unwrap(),
            vec![],
            vec![],
            vec![],
        )
        .await
        .unwrap();
        let token = host.data.lock().await.pairing_admin_token.clone();
        (directory, host, token)
    }

    async fn request(
        host: &Arc<Host>,
        token: &str,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> (StatusCode, serde_json::Value) {
        let request = match body {
            Some(body) => Request::post(path).body(Body::from(body.to_string())),
            None => Request::get(path).body(Body::empty()),
        }
        .unwrap();
        let (mut parts, body) = request.into_parts();
        parts
            .headers
            .insert("authorization", format!("Bearer {token}").parse().unwrap());
        let response = host
            .clone()
            .route(Request::from_parts(parts, body))
            .await
            .unwrap();
        let status = response.status();
        let body = hyper::body::to_bytes(response.into_body()).await.unwrap();
        (status, serde_json::from_slice(&body).unwrap())
    }

    #[tokio::test]
    async fn cancellation_before_begin_fences_late_placement_and_other_loads_survive() {
        let (_directory, host, token) = fixture().await;
        let id = Uuid::new_v4();
        let path = format!("/host/v1/load-operations/{id}");
        assert_eq!(
            request(&host, &token, &path, None).await.1["status"],
            "queued"
        );
        assert_eq!(
            request(
                &host,
                &token,
                &path,
                Some(serde_json::json!({"action":"cancel"}))
            )
            .await
            .1["status"],
            "cancelled"
        );
        let (status, body) = request(
            &host,
            &token,
            &path,
            Some(serde_json::json!({"action":"begin"})),
        )
        .await;
        assert!(!status.is_success(), "{body}");
        for placement in ["/host/v1/profile-launch", "/host/v1/instances"] {
            let (status, body) = request(
                &host,
                &token,
                placement,
                Some(serde_json::json!({"load_operation_id":id})),
            )
            .await;
            assert!(!status.is_success(), "{body}");
            assert!(
                body["error"].as_str().unwrap().contains("cancelled"),
                "{body}"
            );
        }
        let other = Uuid::new_v4();
        let other_path = format!("/host/v1/load-operations/{other}");
        assert!(request(
            &host,
            &token,
            &other_path,
            Some(serde_json::json!({"action":"begin"}))
        )
        .await
        .0
        .is_success());
        assert!(!host.load_operation(other).cancelled.load(Ordering::SeqCst));
        assert!(!host.processes.lock().await.has_children());
    }

    #[tokio::test]
    async fn progress_is_scoped_and_paired_clients_cannot_cancel_desktop_loads() {
        let (_directory, host, token) = fixture().await;
        let id = Uuid::new_v4();
        let operation = host.load_operation(id);
        operation.update(
            "verification",
            "Verifying model package",
            Some((1024, 4096)),
        );
        let path = format!("/host/v1/load-operations/{id}");
        let (status, progress) = request(&host, &token, &path, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(progress["operation_id"], serde_json::json!(id));
        assert_eq!(progress["completed_bytes"], 1024);
        assert_eq!(progress["total_bytes"], 4096);
        let client_id = Uuid::new_v4();
        let client_token = format!("{client_id}.load-client");
        host.data.lock().await.clients.insert(
            client_id,
            ClientGrant {
                name: "Paired client".into(),
                token_verifier: hex::encode(verifier(&client_token).finalize().into_bytes()),
            },
        );
        assert_eq!(
            request(&host, &client_token, &path, None).await.0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            request(
                &host,
                &client_token,
                &path,
                Some(serde_json::json!({"action":"cancel"}))
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        assert!(operation.check().is_ok());
        operation.update("profiling", "Measuring hardware for this model", None);
        assert!(request(&host, &token, &path, None)
            .await
            .1
            .get("completed_bytes")
            .is_none());
    }

    #[tokio::test]
    async fn dropped_load_request_cancels_work_and_ready_wins_late_cancel() {
        let (_directory, host, token) = fixture().await;
        let id = Uuid::new_v4();
        let operation = host.load_operation(id);
        let lifecycle = host.lifecycle.lock().await;
        let mut request = Box::pin(
            host.clone().route(
                Request::post("/host/v1/instances")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::from(
                        serde_json::json!({"load_operation_id":id,
                "model_id":Uuid::new_v4(),"gpu_uuids":[],"max_context":4096,"concurrency":1})
                        .to_string(),
                    ))
                    .unwrap(),
            ),
        );
        assert!(matches!(
            futures_util::poll!(request.as_mut()),
            std::task::Poll::Pending
        ));
        drop(request);
        assert!(operation.check().is_err());
        drop(lifecycle);
        let ready_id = Uuid::new_v4();
        let path = format!("/host/v1/load-operations/{ready_id}");
        assert_eq!(
            self::request(
                &host,
                &token,
                &path,
                Some(serde_json::json!({"action":"complete"}))
            )
            .await
            .1["status"],
            "ready"
        );
        assert_eq!(
            self::request(
                &host,
                &token,
                &path,
                Some(serde_json::json!({"action":"cancel"}))
            )
            .await
            .1["status"],
            "ready"
        );
        assert!(host.load_operation(ready_id).check().is_ok());
    }

    #[tokio::test]
    async fn cancelled_load_never_persists_a_payload_receipt() {
        use sha2::Digest;
        let (directory, host, _token) = fixture().await;
        let payload = directory.path().join("cancelled.ginfer");
        std::fs::write(&payload, b"cancelled").unwrap();
        let operation = host.load_operation(Uuid::new_v4());
        operation.cancel();
        let error = LOAD_OPERATION
            .scope(
                operation,
                host.verify_qualified_payload(
                    payload.clone(),
                    hex::encode(Sha256::digest(b"cancelled")),
                    9,
                ),
            )
            .await
            .unwrap_err();
        assert!(error.contains("cancelled"), "{error}");
        assert!(!host
            .data
            .lock()
            .await
            .payload_verifications
            .contains_key(&payload));
    }
}

#[cfg(test)]
mod normal_stop_tests {
    use super::*;

    async fn fixture() -> (tempfile::TempDir, Arc<Host>, String, serde_json::Value) {
        let directory = tempfile::tempdir().unwrap();
        let host = Host::open(directory.path().into(), "Normal Stop fixture".into(),
            std::env::current_exe().unwrap(), vec![], vec![], vec![]).await.unwrap();
        let snapshot = host.snapshot().await;
        let token = host.data.lock().await.pairing_admin_token.clone();
        let body = serde_json::json!({"host_id":snapshot["host_id"],"boot_id":snapshot["boot_id"],
            "local_identity":snapshot["local_identity"]});
        (directory, host, token, body)
    }

    pub(super) async fn stop(host: &Arc<Host>, token: &str, body: serde_json::Value) -> (StatusCode, serde_json::Value) {
        let response = host.clone().route(Request::post("/host/v1/stop")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(body.to_string())).unwrap()).await.unwrap();
        let status = response.status();
        (status, serde_json::from_slice(&hyper::body::to_bytes(response.into_body()).await.unwrap()).unwrap())
    }

    #[tokio::test]
    async fn relocation_stop_keeps_linux_quit_controls_hidden() {
        let (_directory, host, token, body) = fixture().await;
        host.enable_relocation_stop();
        assert_eq!(host.snapshot().await["can_stop_host"], false);
        let (status, reply) = stop(&host, &token, body).await;
        assert_eq!(status, StatusCode::OK, "{reply}");
        assert_eq!(reply["stopping"], true);
    }

    #[tokio::test]
    async fn normal_stop_requires_desktop_mode_admin_and_exact_process_identity() {
        let (_directory, host, token, body) = fixture().await;
        assert_eq!(host.snapshot().await["can_stop_host"], false);
        assert_eq!(stop(&host, &token, body.clone()).await.0, StatusCode::FORBIDDEN);
        host.enable_normal_stop(); // Platform seam: no Windows process or console.
        assert_eq!(host.snapshot().await["can_stop_host"], true);
        assert_eq!(stop(&host, "invalid", body.clone()).await.0, StatusCode::FORBIDDEN);
        let client_id = Uuid::new_v4();
        let client_token = format!("{client_id}.normal-stop-client");
        host.data.lock().await.clients.insert(client_id, ClientGrant {
            name: "Paired client".into(),
            token_verifier: hex::encode(verifier(&client_token).finalize().into_bytes()),
        });
        assert_eq!(stop(&host, &client_token, body.clone()).await.0, StatusCode::FORBIDDEN);
        let mut changed = body.clone();
        changed["host_id"] = serde_json::json!(Uuid::new_v4());
        assert_eq!(stop(&host, &token, changed).await.0, StatusCode::CONFLICT);
        let mut changed = body.clone();
        changed["boot_id"] = serde_json::json!(Uuid::new_v4());
        assert_eq!(stop(&host, &token, changed).await.0, StatusCode::CONFLICT);
        let mut changed = body.clone();
        changed["local_identity"]["state_directory"] = serde_json::json!(host.directory.join("foreign"));
        assert_eq!(stop(&host, &token, changed).await.0, StatusCode::CONFLICT);
        let mut changed = body.clone();
        changed["local_identity"]["platform"] = serde_json::json!("foreign-platform");
        assert_eq!(stop(&host, &token, changed).await.0, StatusCode::CONFLICT);
        assert!(!host.normal_stopping.load(Ordering::SeqCst));
        let (status, reply) = stop(&host, &token, body).await;
        assert_eq!(status, StatusCode::OK, "{reply}");
        assert_eq!(reply["stopping"], true);
        assert_eq!(reply["boot_id"], serde_json::json!(host.boot_id));
    }

    #[tokio::test]
    async fn normal_stop_refuses_inflight_work_and_seals_http_and_maintenance_admission() {
        let (_directory, host, token, body) = fixture().await;
        host.enable_normal_stop();
        let admission = host.running_admission().await.unwrap();
        assert_eq!(stop(&host, &token, body.clone()).await.0, StatusCode::CONFLICT);
        drop(admission);
        let lifecycle = host.lifecycle.lock().await;
        assert_eq!(stop(&host, &token, body.clone()).await.0, StatusCode::CONFLICT);
        drop(lifecycle);
        let operation = host.first_run_operation.lock().await;
        assert_eq!(stop(&host, &token, body.clone()).await.0, StatusCode::CONFLICT);
        drop(operation);
        let instance = crate::engine_registry::InstanceRef {
            host_id: host.data.lock().await.host_id,
            instance_id: Uuid::new_v4(),
        };
        host.data.lock().await.fleet = serde_json::from_value(serde_json::json!({
            "kind":"coordinator","fleet":{
                "schema":crate::fleet::FLEET_SCHEMA,"revision":1,
                "authority":{"host_id":instance.host_id,"origins":["https://127.0.0.1:1"],
                    "certificate_sha256":"00".repeat(32)},
                "members":[],"assignments":[],
                "pools":[{"id":Uuid::new_v4(),"name":"Worker pool",
                    "members":[{"instance":instance,"worker_limit":1}]}]
            }
        })).unwrap();
        let lease = host.clone().route(Request::post("/host/v1/fleet/worker-slot")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(serde_json::to_string(&instance).unwrap())).unwrap()).await.unwrap();
        assert_eq!(lease.status(), StatusCode::OK);
        assert_eq!(stop(&host, &token, body.clone()).await.0, StatusCode::CONFLICT);
        drop(lease);
        tokio::time::timeout(Duration::from_secs(2), async {
            while host.worker_slots.lock().unwrap().values().any(|used| *used != 0) {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.unwrap();
        assert!(!host.normal_stopping.load(Ordering::SeqCst));

        let (status, reply) = stop(&host, &token, body).await;
        assert_eq!(status, StatusCode::OK, "{reply}");
        assert!(host.running_admission().await.is_err());
        let response = host.clone().route(Request::post("/host/v1/instances")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from("{}")).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        host.wait_for_normal_stop().await;
        assert!(!host.processes.lock().await.has_children());
        assert!(host.downloads.list().await.is_empty());
    }

    #[tokio::test]
    async fn normal_stop_fences_a_detached_setup_action_after_its_http_caller_disconnects() {
        let (_directory, host, token, body) = fixture().await;
        host.enable_normal_stop();
        host.data.lock().await.first_run.gpu_uuids = vec!["GPU-fixture".into()];
        host.save().await.unwrap();
        let journal = std::fs::read(host.directory.join("host.json")).unwrap();
        let owners = Arc::strong_count(&host);
        let mut request = Box::pin(host.clone().route(Request::post("/host/v1/first-run")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(serde_json::json!({"action":"storage",
                "path":host.directory.join("must-not-be-admitted")}).to_string())).unwrap()));
        // This current-thread test stops at the first join of the detached
        // setup transition. No spawned task can run between these two polls.
        assert!(matches!(futures_util::poll!(request.as_mut()), std::task::Poll::Pending));
        drop(request);
        assert_eq!(Arc::strong_count(&host), owners + 1, "Only the detached transition retains the Host");
        let mut stopping = Box::pin(stop(&host, &token, body));
        let std::task::Poll::Ready((status, reply)) = futures_util::poll!(stopping.as_mut()) else {
            panic!("An idle Stop must seal admission before the queued setup task runs");
        };
        assert_eq!(status, StatusCode::OK, "{reply}");
        drop(stopping);
        tokio::time::timeout(Duration::from_secs(2), async {
            while Arc::strong_count(&host) != owners { tokio::task::yield_now().await; }
        }).await.unwrap();
        assert!(host.data.lock().await.first_run.requested_storage.is_none());
        assert_eq!(std::fs::read(host.directory.join("host.json")).unwrap(), journal);
        assert!(!host.directory.join("must-not-be-admitted").exists());
    }
}

#[cfg(test)]
mod target_launch_tests {
    use super::*;

    #[tokio::test]
    async fn qualified_payload_receipt_survives_restart_and_rejects_modified_payload() {
        use sha2::Digest;
        let directory = tempfile::tempdir().unwrap();
        let state = directory.path().join("state");
        let payload = directory.path().join("imported.ginfer");
        std::fs::write(&payload, b"verified").unwrap();
        let sha256 = hex::encode(Sha256::digest(b"verified"));
        let open = || Host::open(state.clone(), "Verification test".into(),
            std::env::current_exe().unwrap(), vec![], vec![], vec![]);
        let host = open().await.unwrap();
        host.verify_qualified_payload(payload.clone(), sha256.clone(), 8).await.unwrap();
        let journal = std::fs::read(state.join("host.json")).unwrap();
        let recorded = host.data.lock().await.payload_verifications[&payload].clone();
        drop(host);
        let reopened = open().await.unwrap();
        assert_eq!(reopened.data.lock().await.payload_verifications[&payload], recorded);
        reopened.verify_qualified_payload(payload.clone(), sha256.clone(), 8).await.unwrap();
        assert_eq!(std::fs::read(state.join("host.json")).unwrap(), journal,
            "An unchanged receipt does not rewrite the journal");
        std::fs::write(&payload, b"modified").unwrap();
        assert_eq!(reopened.verify_qualified_payload(payload.clone(), sha256, 8).await.unwrap_err(),
            "profile does not qualify this artifact payload");
        assert_eq!(reopened.data.lock().await.payload_verifications[&payload], recorded,
            "A failed hash must not replace the durable receipt");
    }

    async fn installed_flash(
        weights: &str,
        calibrated: bool,
    ) -> (tempfile::TempDir, Arc<Host>, LaunchRequest) {
        installed_target("qwen3.8-flash-next", weights, calibrated).await
    }

    async fn installed_target(
        family: &str,
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
            "identity":{"model_id":family,"weights_id":weights},
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
            benchmark_profile: None,
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
    async fn ordinary_download_resume_wakes_parked_first_run_maintenance() {
        use sha2::Digest;

        let (dir, host, _) = installed_flash("groupwise-int", false).await;
        let artifact = std::fs::read(&host.inventory.read().await[0].path).unwrap();
        let sha256 = hex::encode(Sha256::digest(&artifact));
        let root = host.downloads.root();
        let id = Uuid::new_v4();
        let release = crate::model_downloads::Release {
            name: "Paused first-run fixture".into(),
            identity: host.inventory.read().await[0].metadata.identity.clone(),
            url: format!(
                "https://huggingface.co/SectileLabs/fixture/resolve/{}/model.ginfer",
                "a".repeat(40)
            ),
            sha256: sha256.clone(),
            bytes: artifact.len() as u64,
            tp: 1,
            qualified_sm: vec!["12.0".into()],
            min_vram_mib_per_gpu: 1,
            capabilities: vec![],
            launch_profiles: vec![],
        };
        release.validate().unwrap();
        // Resume verifies this complete package locally; the test never needs
        // a network transfer, and installed work still needs its startup quote.
        let package = root.join(format!("{sha256}.ginfer"));
        std::fs::write(&package, &artifact).unwrap();
        let download = crate::model_downloads::Download {
            id,
            release,
            status: "paused".into(),
            received: artifact.len() as u64,
            bytes_per_second: 0,
            error: None,
            path: None,
            storage_root: root,
            verification: None,
        };
        std::fs::write(
            host.directory.join("model-downloads.json"),
            serde_json::to_vec(&BTreeMap::from([(id, download)])).unwrap(),
        )
        .unwrap();
        host.data.lock().await.first_run = crate::first_run::Progress {
            gpu_uuids: vec!["GPU-test".into()],
            storage_accepted: true,
            catalog_loaded: true,
            selected_release_ids: vec![sha256],
            download_ids: vec![id],
            ..Default::default()
        };
        host.save().await.unwrap();
        drop(host);
        let host = Host::open(
            dir.path().join("state"),
            "Resume fixture".into(),
            std::env::current_exe().unwrap(),
            vec![dir.path().join("models")],
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
        assert!(!host.processes.lock().await.needs_monitoring());
        assert!(
            !host.first_run_pending().await,
            "A paused download must let the monitor park"
        );
        let activity = host.processes.lock().await.activity_notification();
        let notified = activity.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        assert!(matches!(
            futures_util::poll!(notified.as_mut()),
            std::task::Poll::Pending
        ));
        let token = host.data.lock().await.pairing_admin_token.clone();
        let request = |action| {
            Request::post("/host/v1/download-actions")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(
                    serde_json::json!({"id":id,"action":action}).to_string(),
                ))
                .unwrap()
        };
        let rejected = host.clone().route(request("invalid")).await.unwrap();
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        assert!(
            matches!(
                futures_util::poll!(notified.as_mut()),
                std::task::Poll::Pending
            ),
            "Rejected actions must not wake the parked monitor"
        );

        let response = host.clone().route(request("resume")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(
            matches!(
                futures_util::poll!(notified.as_mut()),
                std::task::Poll::Ready(())
            ),
            "Ordinary Resume must wake the already-parked monitor"
        );
        assert!(
            host.first_run_pending().await,
            "Resumed work must restore maintenance ticks"
        );
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let jobs = host.downloads.list().await;
                assert_ne!(jobs[0].status, "failed", "{:?}", jobs[0].error);
                if jobs[0].status == "installed" {
                    assert_eq!(jobs[0].path.as_ref(), Some(&package));
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(
            host.first_run_pending().await,
            "Installation must keep the pending startup quote awake"
        );
        assert!(!host.processes.lock().await.has_children());
    }

    #[tokio::test]
    async fn flash_graph_receipts_require_ready_and_match_the_saved_startup_recipe() {
        let (dir, host, mut request) = installed_flash("groupwise-int", false).await;
        let engine = dir.path().join("engine");
        std::fs::write(&engine, r#"#!/usr/bin/env python3
import http.server, json, pathlib, sys, time
args = sys.argv[1:]
def arg(name): return args[args.index(name)+1]
root = pathlib.Path(__file__).parent
if '--quote-only' in args:
    graph = int(arg('--graph-allowance-bytes')) if '--graph-allowance-bytes' in args else 0
    with (root/'quotes.jsonl').open('a') as out: out.write(json.dumps(args)+'\n')
    print(json.dumps(dict(schema='ginfer-startup-quote-v1',model_id='qwen3.8-flash-next',weights_id='groupwise-int',
        tensor_parallel_size=1,ranks=[dict(rank=0,free_bytes=65536,weights_bytes=8192,state_bytes=2048,
        graph_allowance_bytes=graph,graph_allowance_source='receipt' if graph else 'unknown',
        minimum_kv_arena_bytes=1024,kv_arena_alignment_bytes=256,headroom_bytes=1024,startup_peak_bytes=11264+graph)])))
    sys.exit(0)
assert arg('--vram-budget-bytes') == '4096'
sys.stderr.write('Flash startup phase=graph-capacity rank=0 admission_'); sys.stderr.flush(); time.sleep(.01)
sys.stderr.write('graph_bytes=1200 topology=first\nFlash startup phase=graph-capacity rank=0 admission_graph_bytes=1000 topology=last\n')
sys.stderr.write('x'*20000+'\n'); sys.stderr.flush()
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body=json.dumps(dict(data=[dict(id=arg('--model-id'))])).encode()
        self.send_response(200); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self,*args): pass
http.server.HTTPServer(('127.0.0.1',int(arg('--port'))),Handler).serve_forever()
"#).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o700)).unwrap();
        *host.processes.lock().await = HostProcesses::new(engine.clone(), BTreeSet::from(["GPU-test".into()]), Duration::from_secs(10)).unwrap();
        request.max_context = 8192;
        request.concurrency = 4;
        request.options.kv_arena_bytes = Some(1024);
        request.options.vram_budget_bytes = Some(4096);
        let mut preview = request.clone();
        preview.options.kv_arena_bytes = None;
        preview.options.vram_budget_bytes = None;
        let quote = host.quote(preview.clone(), 1).await.unwrap();
        assert!(quote["kv_arena_bytes"].is_null());
        assert_eq!(quote["instance_count"], 1);
        assert_eq!(quote["model_identity"], serde_json::json!({"model_id":"qwen3.8-flash-next","weights_id":"groupwise-int"}));
        assert!(host.data.lock().await.profiles.is_empty());
        assert_eq!(host.processes.lock().await.instances().count(), 0);
        let error = host.quote(preview.clone(), 2).await.unwrap_err();
        assert!(error.contains("per-instance weight residency budget"), "{error}");
        preview.options.vram_budget_bytes = Some(4096);
        let error = host.quote(preview, 2).await.unwrap_err();
        assert!(error.contains("graph memory is unknown"), "{error}");
        let error = host.place(request.clone(), 2).await.unwrap_err();
        assert!(error.contains("graph memory is unknown"), "{error}");
        assert!(host.data.lock().await.graph_receipts.is_empty());
        assert_eq!(host.processes.lock().await.instances().count(), 0);
        let error = host.launch(request.clone()).await.unwrap_err();
        assert!(error.contains("graph memory is unknown"), "{error}");
        request.options.kv_arena_bytes = None;
        let id = host.launch(request.clone()).await.unwrap();
        assert!(host.data.lock().await.graph_receipts.is_empty());
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                host.refresh_processes().await.unwrap();
                if !host.data.lock().await.graph_receipts.is_empty() { break; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.unwrap();
        assert_eq!(host.data.lock().await.graph_receipts.values().copied().collect::<Vec<_>>(), [1200]);
        host.processes.lock().await.stop(id).await.unwrap();
        request.options.kv_arena_bytes = Some(1024);
        let reopened = Host::open(dir.path().join("state"), "Test".into(), engine.clone(),
            vec![dir.path().join("models")], vec![], host.gpus.clone()).await.unwrap();
        reopened.processes.lock().await.hardware_profile = None;
        let placement = reopened.place(request.clone(), 2).await;
        if placement.is_err() { reopened.processes.lock().await.shutdown().await.unwrap(); }
        placement.unwrap();
        let quotes = std::fs::read_to_string(dir.path().join("quotes.jsonl")).unwrap();
        let args: Vec<String> = serde_json::from_str(quotes.lines().last().unwrap()).unwrap();
        assert!(args.windows(2).any(|pair| pair == ["--graph-allowance-bytes", "1200"]));
        assert!(args.windows(2).any(|pair| pair == ["--vram-budget-bytes", "4096"]));
        request.concurrency = 3;
        let error = reopened.place(request, 2).await.unwrap_err();
        reopened.processes.lock().await.shutdown().await.unwrap();
        assert!(error.contains("graph memory is unknown"), "{error}");
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
        std::fs::copy(
            dir.path().join("models/flash.ginfer"),
            dir.path().join("models/second.ginfer"),
        )
        .unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert!(host.scan().await.is_err());
        let failed_ids: BTreeMap<_, _> = host
            .inventory
            .read()
            .await
            .iter()
            .map(|model| (model.path.clone(), model.id))
            .collect();
        assert_eq!(failed_ids.len(), 2);
        std::fs::remove_dir(&path).unwrap();
        host.scan().await.unwrap();
        let restarted = Host::open(
            state,
            "Ignored".into(),
            std::env::current_exe().unwrap(),
            vec![dir.path().join("models")],
            vec![],
            vec![],
        )
        .await
        .unwrap();
        let restored_ids: BTreeMap<_, _> = restarted
            .inventory
            .read()
            .await
            .iter()
            .map(|model| (model.path.clone(), model.id))
            .collect();
        assert_eq!(restored_ids, failed_ids);
    }

    #[tokio::test]
    async fn launches_default_to_placed_ready_and_preserve_explicit_progressive_ready() {
        for (model, weights) in [
            ("qwen3.8-27b", "groupwise-int-dflash2-q4"),
            ("qwen3.8-flash-next", "groupwise-int"),
            ("qwen3.8-flash-next", "smol-q2g64"),
            ("qwen3.8-flash-next", "nvfp4"),
        ] {
            let (_dir, mut host, mut request) = installed_target(model, weights, false).await;
            for (name, memory_mib) in [("NVIDIA CMP 170HX", 65536), ("Fixture small", 24576), ("Fixture PRO", 98304)] {
                let gpu = &mut Arc::get_mut(&mut host).unwrap().gpus[0];
                gpu.name = name.into();
                gpu.memory_mib = memory_mib;
                for progressive in [false, true] {
                    request.options.progressive_ready = progressive;
                    let restored: LaunchRequest = serde_json::from_value(serde_json::to_value(&request).unwrap()).unwrap();
                    let launch = host.prepare_launch(&restored).await.unwrap();
                    assert_eq!(launch.options.args().iter().filter(|arg| arg.as_str() == "--progressive-ready").count(), usize::from(progressive));
                    assert!(!launch.options.args().iter().any(|arg| arg == "--wait-for-residency-fill"));
                }
            }
        }
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
pub(crate) fn write_selected_profile_fixture(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::write(path, r#"#!/usr/bin/env python3
import hashlib, json, pathlib, sys, time
root = pathlib.Path(__file__).parent
args = sys.argv[1:]
def arg(name, default=None):
    return args[args.index(name)+1] if name in args else default
assert args[0] == 'profile-hardware'
with (root/'profile-calls.jsonl').open('a') as calls:
    calls.write(json.dumps(args)+'\n')
(root/'profile-argv.json').write_text(json.dumps(args))
(root/'profile-started').touch()
while (root/'hold-profile').exists() and not (root/'release-profile').exists():
    time.sleep(.01)
if (root/'fail-profile').exists():
    print('fixture selected calibration failed', file=sys.stderr)
    sys.exit(23)
model = pathlib.Path(arg('--model'))
contents = model.read_bytes()
directory_size = int.from_bytes(contents[8:16], 'little')
directory_sha = hashlib.sha256(contents[16:16+directory_size]).hexdigest()
output = pathlib.Path(arg('--hardware-profile'))
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(dict(schema_version=2)))
spec = arg('--spec', 'auto')
artifact = dict(path=str(model), directory_sha256=directory_sha, tp=int(arg('--tp')),
    draft_tp=int(arg('--draft-tp', '0')), spec=spec,
    draft_tokens=int(arg('--draft-tokens', '0' if spec in ('auto', 'none') else '3')))
print(json.dumps(dict(schema_version=2, mode='ensure', scope='artifact', state='loaded',
    hardware_profile=str(output), complete=True, base_complete=True,
    all_formats_complete=False, missing_rows=[], artifact=artifact)))
"#).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
}

#[cfg(all(test, unix))]
mod resource_tests {
    use super::*;
    use std::{future::Future, os::unix::fs::PermissionsExt};

    async fn fixture() -> (tempfile::TempDir, Arc<Host>, LaunchRequest) {
        let dir = tempfile::tempdir().unwrap();
        let engine = dir.path().join("ginfer-serve");
        std::fs::write(&engine, r#"#!/usr/bin/env python3
import json, pathlib, sys, time
root = pathlib.Path(__file__).parent
args = sys.argv[1:]
def arg(name): return args[args.index(name)+1]
if '--quote-only' in args:
    (root/'quote-started').touch()
    model, weights = arg('--model-id').split('/', 1)
    print(json.dumps(dict(schema='ginfer-startup-quote-v1', model_id=model, weights_id=weights,
        tensor_parallel_size=1, ranks=[dict(rank=0, free_bytes=4294967296, weights_bytes=8192,
        state_bytes=2048, graph_allowance_bytes=1024, minimum_kv_arena_bytes=1024,
        kv_arena_alignment_bytes=256, headroom_bytes=int(arg('--kv-arena-headroom-bytes')),
        startup_peak_bytes=12288)])))
    sys.exit(0)
(root/'serve-started').touch()
time.sleep(60)
"#).unwrap();
        std::fs::set_permissions(&engine, std::fs::Permissions::from_mode(0o700)).unwrap();
        super::write_selected_profile_fixture(&dir.path().join("ginfer"));
        let models = dir.path().join("models");
        std::fs::create_dir(&models).unwrap();
        let metadata = serde_json::json!({"identity":{"model_id":"muse-glimmer-30b","weights_id":"nvfp4"},"tp_size":1,"draft_tp":0,"objects":[{"kind":"tensor","rank":"all","name":"fixture"}]}).to_string();
        let mut bytes = b"NINFER\0\x03".to_vec();
        bytes.extend((metadata.len() as u64).to_le_bytes());
        bytes.extend(metadata.as_bytes());
        bytes.resize(4096, 0);
        std::fs::write(models.join("model.ginfer"), &bytes).unwrap();
        let gpus = (0..4)
            .map(|index| Gpu {
                uuid: format!("GPU-fixture-{index}"),
                name: "Fixture GPU".into(),
                display_name: None,
                memory_mib: 32768,
                compute_capability: Some("12.0".into()),
            })
            .collect();
        let host = Host::open(
            dir.path().join("state"),
            "Resource fixture".into(),
            engine,
            vec![models],
            vec![],
            gpus,
        )
        .await
        .unwrap();
        let request = LaunchRequest {
            benchmark_profile: None,
            instance_id: None,
            qualified_profile_id: None,
            model_id: host.inventory.read().await[0].id,
            gpu_uuids: vec!["GPU-fixture-0".into()],
            max_context: 8192,
            concurrency: 1,
            options: LaunchOptions::default(),
        };
        (dir, host, request)
    }

    #[tokio::test]
    async fn installed_load_waits_for_selected_scope_before_quote_and_reuses_acceptance() {
        let (dir, host, request) = fixture().await;
        std::fs::write(dir.path().join("hold-profile"), b"").unwrap();
        let job = host.processes.lock().await.hardware_profile.clone().unwrap();
        let loading_host = host.clone();
        let loading_request = request.clone();
        let loading = tokio::spawn(async move { loading_host.launch(loading_request).await });
        tokio::time::timeout(Duration::from_secs(5), async {
            while !dir.path().join("profile-started").is_file() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        }).await.unwrap();
        let snapshot = tokio::time::timeout(Duration::from_secs(1), host.snapshot()).await.unwrap();
        assert!(snapshot["instances"].as_array().unwrap().is_empty());
        assert!(job.busy());
        assert_eq!(job.status(None).scope, "artifact");
        assert!(!dir.path().join("quote-started").exists());
        assert!(!dir.path().join("serve-started").exists());
        std::fs::write(dir.path().join("release-profile"), b"").unwrap();
        let id = tokio::time::timeout(Duration::from_secs(5), loading).await.unwrap().unwrap().unwrap();
        let args: Vec<String> = serde_json::from_slice(&std::fs::read(dir.path().join("profile-argv.json")).unwrap()).unwrap();
        let model_index = args.iter().position(|arg| arg == "--model").unwrap();
        assert_eq!(args[model_index + 1], dir.path().join("models/model.ginfer").canonicalize().unwrap().to_str().unwrap());
        assert!(args.iter().any(|arg| arg == "--json"));
        assert!(!args.iter().any(|arg| arg == "--complete-remaining-formats"));
        assert!(!job.busy());
        let launch = host.prepare_launch(&request).await.unwrap();
        assert!(job.artifact_is_accepted(&request.gpu_uuids, &host.selected_profile_intent_for_launch(&launch).await.unwrap()));
        let _lifecycle = host.lifecycle.lock().await;
        host.ensure_selected_profile(&launch).await.unwrap();
        assert_eq!(std::fs::read_to_string(dir.path().join("profile-calls.jsonl")).unwrap().lines().count(), 1);
        assert!(host.processes.lock().await.instances().any(|instance| instance.instance_id == id));
        host.processes.lock().await.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn installed_load_failed_selected_profile_never_quotes_or_spawns() {
        let (dir, host, request) = fixture().await;
        std::fs::write(dir.path().join("fail-profile"), b"").unwrap();
        let error = host.launch(request).await.unwrap_err();
        assert!(error.contains("Selected hardware profiling failed") && error.contains("23"), "{error}");
        let job = host.processes.lock().await.hardware_profile.clone().unwrap();
        assert!(!job.busy());
        assert_eq!(job.status(None).status, "failed");
        assert!(!dir.path().join("quote-started").exists());
        assert!(!dir.path().join("serve-started").exists());
        assert!(!host.processes.lock().await.has_children());
        assert!(host.data.lock().await.profiles.is_empty());
    }

    #[tokio::test]
    async fn selected_profile_intent_uses_local_payload_and_exact_startup_options() {
        let (dir, host, mut request) = fixture().await;
        request.options.spec = "none".into();
        let intent = host.selected_profile_intent(&request).await.unwrap();
        let path = dir.path().join("models/model.ginfer").canonicalize().unwrap();
        assert_eq!(intent.path, path);
        assert_eq!(intent.tp, 1);
        assert_eq!(intent.draft_tp, 0);
        assert_eq!(intent.spec, "none");
        assert_eq!(intent.draft_tokens, None);
        assert_eq!(intent.package_sha256, None);
        assert_eq!(intent.directory_sha256,
            crate::engine_inventory::inspect_artifact_directory(&path).unwrap().1);
        request.options.spec = "auto".into();
        assert_eq!(host.selected_profile_intent(&request).await.unwrap().spec, "auto");
        let mut bytes = std::fs::read(&path).unwrap();
        bytes[32] ^= 1;
        std::fs::write(&path, bytes).unwrap();
        assert!(host.selected_profile_intent(&request).await.is_err());
        assert!(!host.processes.lock().await.has_children());
        assert!(host.data.lock().await.profiles.is_empty());
    }

    #[tokio::test]
    async fn selected_profile_intent_resolves_the_selected_artifact_set_degree() {
        let (dir, host, mut request) = fixture().await;
        let models = dir.path().join("models");
        let mut declarations = Vec::new();
        for tp in [1, 2] {
            let name = format!("model-tp{tp}.ginfer");
            let directory = serde_json::to_vec(&serde_json::json!({
                "identity":{"model_id":"muse-glimmer-30b","weights_id":"nvfp4"},
                "tp_size":tp,"draft_tp":0,
                "objects":[{"kind":"tensor","rank":"all","name":"fixture"}],
            })).unwrap();
            let mut bytes = b"NINFER\0\x03".to_vec();
            bytes.extend((directory.len() as u64).to_le_bytes());
            bytes.extend(directory);
            bytes.resize(4096, 0);
            std::fs::write(models.join(&name), bytes).unwrap();
            declarations.push(serde_json::json!({
                "tp":tp,"draft_tp":0,"path":name,"bytes":4096,"sha256":"a".repeat(64),
            }));
        }
        let descriptor = models.join("model-set.json");
        std::fs::write(&descriptor, serde_json::to_vec(&serde_json::json!({
            "schema":"ginfer-artifact-set-v1",
            "identity":{"model_id":"muse-glimmer-30b","weights_id":"nvfp4","family_id":"b".repeat(64)},
            "canonical_reconstructed_target_sha256":"c".repeat(64),
            "canonical_reconstructed_draft_sha256":null,"artifacts":declarations,
        })).unwrap()).unwrap();
        let executable = dir.path().join("ginfer-serve");
        let gpus = host.gpus.clone();
        drop(host);
        let host = Host::open(dir.path().join("state"), "Ignored".into(), executable,
            vec![], vec![descriptor.clone()], gpus).await.unwrap();
        request.model_id = host.inventory.read().await.iter()
            .find(|model| model.artifact_set && model.metadata.tp_size == 2).unwrap().id;
        request.gpu_uuids.push("GPU-fixture-1".into());
        request.options.spec = "none".into();
        let intent = host.selected_profile_intent(&request).await.unwrap();
        let payload = models.join("model-tp2.ginfer").canonicalize().unwrap();
        assert_eq!(intent.path, payload);
        assert_ne!(intent.path, descriptor);
        assert_eq!(intent.tp, 2);
        assert_eq!(intent.directory_sha256,
            crate::engine_inventory::inspect_artifact_directory(&payload).unwrap().1);
        assert_eq!(intent.package_sha256, None);
        assert!(!host.processes.lock().await.has_children());
    }

    #[tokio::test]
    async fn foreground_quote_reaps_deferred_profile_before_starting_native_quote() {
        let (dir, host, mut request) = fixture().await;
        request.options.spec = "none".into();
        let engine = dir.path().join("ginfer-serve");
        host.processes.lock().await.configure_executable(engine.clone()).unwrap();
        let cli = dir.path().join("ginfer");
        let pid_path = dir.path().join("profile-pid");
        std::fs::write(&cli, format!(
            "#!/bin/sh\nprintf '%s' \"$$\" > '{}'\nexec /bin/sleep 600\n", pid_path.display()
        )).unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o700)).unwrap();
        let job = host.processes.lock().await.hardware_profile.clone().unwrap();
        let configuration = job.configuration(Some(cli.clone()), &request.gpu_uuids).unwrap();
        std::fs::create_dir_all(configuration.profile_path.parent().unwrap()).unwrap();
        std::fs::write(&configuration.profile_path, r#"{"schema_version":2}"#).unwrap();
        job.start_remaining_formats(Some(cli), request.gpu_uuids.clone()).unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while !pid_path.is_file() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        }).await.unwrap();
        let pid = std::fs::read_to_string(&pid_path).unwrap();
        assert!(job.busy());
        let source = std::fs::read_to_string(&engine).unwrap();
        // The quote itself verifies reaping; checking only after quote returns
        // would miss a transient overlap of the two native processes.
        std::fs::write(&engine, source.replace(
            "if '--quote-only' in args:",
            &format!("if '--quote-only' in args:\n    import os\n    try: os.kill({pid}, 0)\n    except ProcessLookupError: pass\n    else: raise AssertionError('profile still alive at quote')"),
        )).unwrap();
        let quote = tokio::time::timeout(Duration::from_secs(3), host.quote(request, 1))
            .await.unwrap().unwrap();
        assert_eq!(quote["instance_count"], 1);
        assert!(!job.busy());
        assert!(!host.processes.lock().await.has_children());
        assert!(host.data.lock().await.profiles.is_empty());
    }

    #[tokio::test]
    async fn normal_stop_preserves_a_model_load_until_its_owner_stops_it() {
        let (directory, host, request) = fixture().await;
        host.enable_normal_stop();
        let launch = host.prepare_launch(&request).await.unwrap();
        let mut processes = HostProcesses::new(directory.path().join("ginfer-serve"),
            host.gpus.iter().map(|gpu| gpu.uuid.clone()).collect(), Duration::from_secs(600)).unwrap();
        processes.configure_runtimes(Default::default(), host.gpus.iter().filter_map(|gpu| {
            gpu.compute_capability.as_ref().map(|sm| (gpu.uuid.clone(), sm.clone()))
        }).collect()).unwrap();
        processes.launch(launch).unwrap();
        *host.processes.lock().await = processes;
        let snapshot = host.snapshot().await;
        let token = host.data.lock().await.pairing_admin_token.clone();
        let body = serde_json::json!({"host_id":snapshot["host_id"],"boot_id":snapshot["boot_id"],
            "local_identity":snapshot["local_identity"]});
        let (status, rejected) = super::normal_stop_tests::stop(&host, &token, body.clone()).await;
        assert_eq!(status, StatusCode::CONFLICT, "{rejected}");
        host.refresh_processes().await.unwrap();
        assert!(host.processes.lock().await.has_children(), "Stop must preserve the loading model child");
        assert!(!host.normal_stopping.load(Ordering::SeqCst));
        host.processes.lock().await.shutdown().await.unwrap();
        let (status, reply) = super::normal_stop_tests::stop(&host, &token, body).await;
        assert_eq!(status, StatusCode::OK, "{reply}");
        assert_eq!(reply["stopping"], true);
    }

    #[tokio::test]
    async fn local_inventory_startup_quote_uses_fresh_settings_without_creating_instances() {
        let (dir, host, mut request) = fixture().await;
        host.processes.lock().await.hardware_profile = None;
        host.launch_profiles.write().await.clear();
        std::fs::write(dir.path().join("ginfer-serve"), r#"#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
def arg(name): return args[args.index(name)+1]
root = pathlib.Path(__file__).parent
assert '--quote-only' in args and '--api-key' not in args
model, weights = arg('--model-id').split('/', 1)
quote = dict(schema='ginfer-startup-quote-v1', model_id=model, weights_id=weights,
    tensor_parallel_size=1, ranks=[dict(rank=0, free_bytes=int((root/'free-bytes').read_text()),
    weights_bytes=8192, state_bytes=2048, graph_allowance_bytes=1024,
    minimum_kv_arena_bytes=1024, kv_arena_alignment_bytes=256,
    headroom_bytes=int(arg('--kv-arena-headroom-bytes')), startup_peak_bytes=12288)])
with (root/'quotes.jsonl').open('a') as out:
    out.write(json.dumps(dict(args=args, gpu=os.environ['CUDA_VISIBLE_DEVICES']))+'\n')
if (root/'wrong-identity').exists(): quote['weights_id'] = 'different-package'
print(json.dumps(quote))
"#).unwrap();
        async fn post(host: &Arc<Host>, token: &str, path: &str, body: serde_json::Value) -> (StatusCode, serde_json::Value) {
            let response = host.clone().route(Request::post(path)
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(body.to_string())).unwrap()).await.unwrap();
            let status = response.status();
            let body = serde_json::from_slice(&hyper::body::to_bytes(response.into_body()).await.unwrap()).unwrap();
            (status, body)
        }
        let token = host.data.lock().await.pairing_admin_token.clone();
        let imported = dir.path().join("imported.ginfer");
        std::fs::copy(dir.path().join("models/model.ginfer"), &imported).unwrap();
        let (status, model) = post(&host, &token, "/host/v1/local-artifacts", serde_json::json!({"path":imported})).await;
        assert_eq!(status, StatusCode::OK, "{model}");
        request.model_id = serde_json::from_value(model["id"].clone()).unwrap();
        request.max_context = 65536;
        request.concurrency = 4;
        request.options.structured_outputs = false;
        request.options.kv_arena_headroom_bytes = 1024;
        assert!(host.launch_profiles.read().await.is_empty());
        assert!(host.downloads.list().await.is_empty());
        let persisted = std::fs::read(host.directory.join("host.json")).unwrap();
        let first_run = serde_json::to_value(&host.data.lock().await.first_run).unwrap();
        let body = |request: &LaunchRequest, count| {
            let mut body = serde_json::to_value(request).unwrap();
            body["remaining_instances"] = serde_json::json!(count);
            body
        };
        std::fs::write(dir.path().join("free-bytes"), "65536").unwrap();
        let (status, quote) = post(&host, &token, "/host/v1/startup-quote", body(&request, 4)).await;
        assert_eq!(status, StatusCode::OK, "{quote}");
        assert_eq!(quote["model_identity"], serde_json::json!({"model_id":"muse-glimmer-30b","weights_id":"nvfp4"}));
        assert_eq!(quote["instance_count"], 4);
        assert_eq!(quote["kv_arena_bytes"], 4096);
        assert_eq!(quote["quote"]["ranks"][0]["free_bytes"], 65536);

        std::fs::write(dir.path().join("free-bytes"), "98304").unwrap();
        request.max_context = 32768;
        request.concurrency = 2;
        request.options.structured_outputs = true;
        let (status, quote) = post(&host, &token, "/host/v1/startup-quote", body(&request, 2)).await;
        assert_eq!(status, StatusCode::OK, "{quote}");
        assert_eq!(quote["instance_count"], 2);
        assert_eq!(quote["kv_arena_bytes"], 36864);
        assert_eq!(quote["quote"]["ranks"][0]["free_bytes"], 98304);
        let calls: Vec<serde_json::Value> = std::fs::read_to_string(dir.path().join("quotes.jsonl")).unwrap()
            .lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(calls.len(), 2);
        for (call, context, concurrency, structured) in [(&calls[0], "65536", "4", false), (&calls[1], "32768", "2", true)] {
            let args: Vec<_> = call["args"].as_array().unwrap().iter().map(|arg| arg.as_str().unwrap()).collect();
            assert_eq!(call["gpu"], "GPU-fixture-0");
            assert_eq!(args[0], imported.to_str().unwrap());
            for (name, value) in [("--model-id", "muse-glimmer-30b/nvfp4"),
                ("--max-context", context), ("--max-concurrency", concurrency), ("--kv-arena-headroom-bytes", "1024")] {
                assert!(args.windows(2).any(|pair| pair == [name, value]), "{args:?}");
            }
            assert_eq!(args.contains(&"--structured-outputs"), structured);
            assert!(!args.contains(&"--kv-arena-bytes"));
        }

        let (status, rejected) = post(&host, &token, "/host/v1/startup-quote", body(&request, 0)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(rejected["error"].as_str().unwrap().contains("remaining instances must be positive"));
        let (status, rejected) = post(&host, &token, "/host/v1/startup-quote", body(&request, 8)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(rejected["error"].as_str().unwrap().contains("cannot fit 8"));
        std::fs::write(dir.path().join("wrong-identity"), "").unwrap();
        let (status, rejected) = post(&host, &token, "/host/v1/startup-quote", body(&request, 1)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(rejected["error"].as_str().unwrap().contains("does not match this launch"));
        let client_id = Uuid::new_v4();
        let client_token = format!("{client_id}.quote-client");
        host.data.lock().await.clients.insert(client_id, ClientGrant {
            name: "Paired quote client".into(),
            token_verifier: hex::encode(verifier(&client_token).finalize().into_bytes()),
        });
        let (status, rejected) = post(&host, &client_token, "/host/v1/startup-quote", body(&request, 1)).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert!(rejected["error"].as_str().unwrap().contains("local administrator"));
        assert_eq!(std::fs::read_to_string(dir.path().join("quotes.jsonl")).unwrap().lines().count(), 4);
        assert!(host.data.lock().await.profiles.is_empty());
        assert_eq!(serde_json::to_value(&host.data.lock().await.first_run).unwrap(), first_run);
        assert!(!host.processes.lock().await.has_children());
        assert!(host.snapshot().await["instances"].as_array().unwrap().is_empty());
        assert_eq!(std::fs::read(host.directory.join("host.json")).unwrap(), persisted);
    }

    #[tokio::test]
    async fn local_inventory_startup_quote_rejects_changed_and_unknown_identity_before_engine() {
        let (dir, host, mut request) = fixture().await;
        std::fs::write(dir.path().join("ginfer-serve"), r#"#!/usr/bin/env python3
import pathlib, sys
pathlib.Path(__file__).with_name('unexpected-engine').write_text('ran')
sys.exit(1)
"#).unwrap();
        let original_id = request.model_id;
        request.model_id = Uuid::new_v4();
        assert!(host.quote(request.clone(), 1).await.unwrap_err().contains("model is not installed"));
        request.model_id = original_id;
        let metadata = serde_json::json!({"identity":{"model_id":"unregistered-model","weights_id":"nvfp4"},"tp_size":1,"draft_tp":0,"objects":[{"kind":"tensor","rank":"all","name":"fixture"}]}).to_string();
        let mut artifact = b"NINFER\0\x03".to_vec();
        artifact.extend((metadata.len() as u64).to_le_bytes());
        artifact.extend(metadata.as_bytes());
        artifact.resize(4096, 0);
        std::fs::write(dir.path().join("models/model.ginfer"), artifact).unwrap();
        assert!(host.quote(request.clone(), 1).await.unwrap_err().contains("artifact changed since inventory scan"));
        host.scan().await.unwrap();
        assert!(host.quote(request, 1).await.unwrap_err().contains("not a registered host launch target"));
        assert!(!dir.path().join("unexpected-engine").exists());
        assert!(host.data.lock().await.profiles.is_empty());
        assert!(!host.processes.lock().await.has_children());
    }

    #[tokio::test]
    async fn shared_gpu_placement_quotes_before_load_and_preserves_independent_instances() {
        let (dir, host, mut request) = fixture().await;
        // Exercise the real command/HTTP/Ready path with a controlled engine.
        // Its ledger represents physical allocations, not Host accounting.
        std::fs::write(dir.path().join("ginfer-serve"), r#"#!/usr/bin/env python3
import http.server, json, os, pathlib, sys
args = sys.argv[1:]
def arg(name): return args[args.index(name) + 1]
root = pathlib.Path(__file__).parent
ledger = root / 'allocations'
ledger.mkdir(exist_ok=True)
if '--quote-only' in args:
    used = 0
    for path in ledger.iterdir():
        record = json.loads(path.read_text())
        try: os.kill(record['pid'], 0)
        except ProcessLookupError: continue
        used += record['bytes']
    quote = dict(schema='ginfer-startup-quote-v1', model_id='muse-glimmer-30b', weights_id='nvfp4',
        tensor_parallel_size=1, ranks=[dict(rank=0, free_bytes=65536-used, weights_bytes=8192,
        state_bytes=2048, graph_allowance_bytes=1024, minimum_kv_arena_bytes=1024,
        kv_arena_alignment_bytes=256, headroom_bytes=1024, startup_peak_bytes=12288)])
    with (root / 'quotes.jsonl').open('a') as out: out.write(json.dumps(dict(args=args, quote=quote))+'\n')
    print(json.dumps(quote))
    sys.exit(0)
assert os.environ['CUDA_VISIBLE_DEVICES'] == 'GPU-fixture-0'
assert arg('--max-concurrency') == '4'
assert arg('--max-context') == '8192'
port = int(arg('--port'))
budget = int(arg('--kv-arena-bytes'))
(ledger / str(port)).write_text(json.dumps(dict(pid=os.getpid(), bytes=11264+budget)))
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/health' and self.headers.get('Authorization') != 'Bearer '+arg('--api-key'):
            self.send_response(401); self.end_headers(); return
        body = json.dumps(dict(data=[dict(id=arg('--model-id'))])).encode()
        self.send_response(200); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *args): pass
http.server.HTTPServer(('127.0.0.1', port), Handler).serve_forever()
"#).unwrap();
        host.processes.lock().await.hardware_profile = None;
        request.concurrency = 4;
        let mut ids = BTreeSet::new();
        let mut ports = BTreeSet::new();
        let mut sessions = BTreeSet::new();
        for remaining in (1..=4).rev() {
            let id = tokio::time::timeout(Duration::from_secs(5), host.place(request.clone(), remaining))
                .await.unwrap().unwrap();
            assert!(ids.insert(id));
            let snapshot = host.snapshot().await;
            let instance = snapshot["instances"].as_array().unwrap().iter()
                .find(|instance| instance["instance_id"] == id.to_string()).unwrap();
            assert_eq!(instance["status"], "ready");
            assert_eq!(instance["configuration"]["kv_arena_bytes"], 4096);
            assert_eq!(instance["configuration"]["concurrency"], 4);
            assert!(ports.insert(instance["configuration"]["port"].as_u64().unwrap()));
            assert!(sessions.insert(instance["session_id"].as_str().unwrap().to_owned()));
            request.options.kv_arena_bytes = Some(4096);
        }
        let quotes = std::fs::read_to_string(dir.path().join("quotes.jsonl")).unwrap();
        let quotes: Vec<serde_json::Value> = quotes.lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(quotes.len(), 4);
        assert_eq!(quotes[0]["quote"]["ranks"][0]["free_bytes"], 65536);
        assert_eq!(quotes[3]["quote"]["ranks"][0]["free_bytes"], 19456);
        for quote in quotes {
            let args = quote["args"].as_array().unwrap();
            assert!(args.contains(&serde_json::json!("--quote-only")));
            assert!(!args.contains(&serde_json::json!("--api-key")));
        }
        let error = host.launch(request.clone()).await.unwrap_err();
        assert!(error.contains("cannot fit 1 new instance"), "{error}");
        assert_eq!(host.snapshot().await["instances"].as_array().unwrap().len(), 4);
        let stopped = *ids.iter().next().unwrap();
        host.processes.lock().await.stop(stopped).await.unwrap();
        let snapshot = host.snapshot().await;
        assert_eq!(snapshot["instances"].as_array().unwrap().iter().filter(|instance| instance["status"] == "ready").count(), 3);
        host.processes.lock().await.shutdown().await.unwrap();
        let reopened = Host::open(dir.path().join("state"), "Test".into(), dir.path().join("ginfer-serve"),
            vec![dir.path().join("models")], vec![], host.gpus.clone()).await.unwrap();
        let snapshot = reopened.snapshot().await;
        let restored: BTreeSet<_> = snapshot["instances"].as_array().unwrap().iter()
            .map(|instance| Uuid::parse_str(instance["instance_id"].as_str().unwrap()).unwrap()).collect();
        assert_eq!(restored, ids);
        assert!(snapshot["instances"].as_array().unwrap().iter().all(|instance| instance["status"] == "stopped"));
    }

    #[tokio::test]
    async fn profile_and_saved_launches_quote_current_settings_without_persisting_auto_bytes() {
        let (dir, host, request) = fixture().await;
        host.processes.lock().await.hardware_profile = None;
        std::fs::write(dir.path().join("ginfer-serve"), r#"#!/usr/bin/env python3
import http.server, json, os, pathlib, sys
args = sys.argv[1:]
def arg(name): return args[args.index(name)+1]
root = pathlib.Path(__file__).parent
assert os.environ['CUDA_VISIBLE_DEVICES'] == 'GPU-fixture-0'
if '--quote-only' in args:
    memory = json.loads((root/'memory.json').read_text())
    model, weights = arg('--model-id').split('/', 1)
    quote = dict(schema='ginfer-startup-quote-v1', model_id=model, weights_id=weights,
        tensor_parallel_size=1, ranks=[dict(rank=0, free_bytes=memory['free'], weights_bytes=8192,
        state_bytes=memory['state'], graph_allowance_bytes=1024, minimum_kv_arena_bytes=1024,
        kv_arena_alignment_bytes=256, headroom_bytes=int(arg('--kv-arena-headroom-bytes')),
        startup_peak_bytes=10240+memory['state'])])
    with (root/'quotes.jsonl').open('a') as out: out.write(json.dumps(dict(args=args, quote=quote))+'\n')
    print(json.dumps(quote))
    sys.exit(0)
# Startup consumes additional memory after the dry quote. An exact maximum
# copied from that quote no longer fits; Engine AUTO uses the actual capacity.
memory = json.loads((root/'memory.json').read_text())
maximum = memory['free']-8192-memory['state']-1024-int(arg('--kv-arena-headroom-bytes'))-1024
if '--kv-arena-bytes' in args and int(arg('--kv-arena-bytes')) > maximum:
    sys.exit('explicit KV arena exceeds post-startup bytes')
with (root/'loads.jsonl').open('a') as out: out.write(json.dumps(args)+'\n')
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/health' and self.headers.get('Authorization') != 'Bearer '+arg('--api-key'):
            self.send_response(401); self.end_headers(); return
        body=json.dumps(dict(data=[dict(id=arg('--model-id'))])).encode()
        self.send_response(200); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        assert self.path == '/v1/chat/completions'
        assert self.headers.get('Authorization') == 'Bearer '+arg('--api-key')
        request=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert request['messages'][0]['content'] == 'Reply with ok.'
        body=json.dumps(dict(choices=[dict(message=dict(role='assistant',content='ok'),finish_reason='stop')])).encode()
        self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self,*args): pass
http.server.HTTPServer(('127.0.0.1',int(arg('--port'))),Handler).serve_forever()
"#).unwrap();
        let headroom = crate::launch_profiles::HEADROOM_BYTES;
        let memory = |extra, state| {
            std::fs::write(
                dir.path().join("memory.json"),
                serde_json::json!({"free":headroom+extra,"state":state}).to_string(),
            )
            .unwrap();
        };
        memory(65536_u64, 2048_u64);
        let model = host.inventory.read().await[0].clone();
        let artifact_sha256 = {
            use sha2::Digest;
            hex::encode(Sha256::digest(std::fs::read(&model.path).unwrap()))
        };
        let profile: crate::launch_profiles::LaunchProfile = serde_json::from_value(serde_json::json!({
                "id":"stale-arena", "name":"Synthetic fresh-quote fixture", "platform":std::env::consts::OS,
                "identity":model.metadata.identity, "artifact_sha256":artifact_sha256, "artifact_bytes":4096,
                "tp":1, "draft_tp":0, "gpu_name":"Fixture GPU", "compute_capability":"12.0", "vram_tier_gib":32,
                "min_memory_mib_per_gpu":32768, "max_context":131072, "concurrency":1,
                "options":{"kv_arena_bytes":4294967296_u64,"structured_outputs":false},
                "qualification":{"tier":"full-context-tested","evidence":"synthetic fixture only",
                    "engine_revision":"fixture","free_bytes_per_gpu":headroom,"full_context_requests":1}
            })).unwrap();
        profile.validate().unwrap();
        host.launch_profiles.write().await.push(profile);
        let token = host.data.lock().await.pairing_admin_token.clone();
        async fn post(
            host: &Arc<Host>,
            token: &str,
            path: &str,
            body: serde_json::Value,
        ) -> (StatusCode, serde_json::Value) {
            let response = host
                .clone()
                .route(
                    Request::post(path)
                        .header("authorization", format!("Bearer {token}"))
                        .body(Body::from(body.to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();
            let status = response.status();
            let body =
                serde_json::from_slice(&hyper::body::to_bytes(response.into_body()).await.unwrap())
                    .unwrap();
            (status, body)
        }
        async fn ready(host: &Arc<Host>, id: Uuid) -> serde_json::Value {
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    host.refresh_processes().await.unwrap();
                    let snapshot = host.snapshot().await;
                    let instance = snapshot["instances"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|instance| instance["instance_id"] == id.to_string())
                        .unwrap()
                        .clone();
                    if instance["status"] == "ready" {
                        return instance;
                    }
                    assert_eq!(instance["status"], "starting", "{instance}");
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap()
        }
        let logs = |name: &str| -> Vec<serde_json::Value> {
            std::fs::read_to_string(dir.path().join(name))
                .unwrap()
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect()
        };
        // A catalog's old explicit bytes and structured-output setting must
        // not replace the user's default Automatic + structured-ON selection.
        let (status, launched) = post(
            &host,
            &token,
            "/host/v1/profile-launch",
            serde_json::json!({
                "profile_id":"stale-arena","model_id":request.model_id,"gpu_uuids":request.gpu_uuids
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{launched}");
        assert!(launched["kv_arena_bytes"].is_null());
        let id = Uuid::parse_str(launched["instance_id"].as_str().unwrap()).unwrap();
        let first = ready(&host, id).await;
        let (status, completion) = post(
            &host,
            &token,
            &format!("/host/v1/instances/{id}/inference/v1/chat/completions"),
            serde_json::json!({"messages":[{"role":"user","content":"Reply with ok."}],"max_tokens":8}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{completion}");
        assert_eq!(completion["choices"][0]["message"]["content"], "ok");
        assert_eq!(first["configuration"]["max_context"], 131072);
        assert_eq!(first["configuration"]["concurrency"], 1);
        assert_eq!(first["configuration"]["structured_outputs"], true);
        assert_eq!(first["configuration"]["kv_arena_headroom_bytes"], headroom);
        assert!(first["profile"]
            .as_object()
            .unwrap()
            .contains_key("kv_arena_bytes"));
        assert!(first["profile"]["kv_arena_bytes"].is_null());
        assert!(first["profile"]["qualified_profile_id"].is_null());
        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.path().join("state/host.json")).unwrap())
                .unwrap();
        assert!(saved["profiles"][id.to_string()]["kv_arena_bytes"].is_null());

        // Restart must quote again even though its saved settings did not
        // change: another process or a new Engine can change free/state bytes.
        memory(57344, 4096);
        let restart_path = format!("/host/v1/instances/{id}/restart");
        let (status, response) = post(&host, &token, &restart_path, serde_json::json!({})).await;
        assert_eq!(status, StatusCode::OK, "{response}");
        let restarted = ready(&host, id).await;
        assert_ne!(restarted["session_id"], first["session_id"]);
        assert!(restarted["configuration"]["kv_arena_bytes"].is_null());
        assert!(restarted["profile"]["kv_arena_bytes"].is_null());

        memory(61440, 6144);
        let mut configuration = restarted["profile"].clone();
        configuration["max_context"] = 65536.into();
        configuration["concurrency"] = 2.into();
        configuration["structured_outputs"] = false.into();
        configuration["kv_arena_headroom_bytes"] = (headroom + 4096).into();
        let reload_path = format!("/host/v1/instances/{id}/reload");
        let (status, response) = post(
            &host,
            &token,
            &reload_path,
            serde_json::json!({"configuration":configuration}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{response}");
        let reloaded = ready(&host, id).await;
        assert!(reloaded["configuration"]["kv_arena_bytes"].is_null());
        assert!(reloaded["profile"]["kv_arena_bytes"].is_null());
        configuration = reloaded["profile"].clone();
        configuration["kv_arena_bytes"] = 4096.into();
        let (status, response) = post(
            &host,
            &token,
            &reload_path,
            serde_json::json!({"configuration":configuration}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{response}");
        let explicit = ready(&host, id).await;
        assert_eq!(explicit["configuration"]["kv_arena_bytes"], 4096);
        assert_eq!(explicit["profile"]["kv_arena_bytes"], 4096);

        // An exact positive override is not silently shrunk when it cannot
        // fit. Quote refusal must occur before a fifth model process exists.
        configuration = explicit["profile"].clone();
        configuration["instance_id"] = serde_json::Value::Null;
        configuration["kv_arena_bytes"] = (1_u64 << 40).into();
        let (status, response) = post(&host, &token, "/host/v1/instances", configuration).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let error = response["error"].as_str().unwrap();
        assert!(
            error.contains("cannot fit 1 new instance") && error.contains("choose Automatic"),
            "{error}"
        );
        let unchanged = ready(&host, id).await;
        assert_eq!(unchanged["session_id"], explicit["session_id"]);
        assert_eq!(
            host.snapshot().await["instances"].as_array().unwrap().len(),
            1
        );
        let quotes = logs("quotes.jsonl");
        let loads = logs("loads.jsonl");
        assert_eq!(quotes.len(), 5);
        assert_eq!(loads.len(), 4);
        for (index, quote) in quotes.iter().enumerate() {
            let args = quote["args"].as_array().unwrap();
            let value = |flag: &str| {
                args[args.iter().position(|arg| arg == flag).unwrap() + 1]
                    .as_str()
                    .unwrap()
            };
            assert!(args.contains(&serde_json::json!("--quote-only")));
            assert!(!args.contains(&serde_json::json!("--api-key")));
            assert_eq!(
                value("--max-context"),
                if index < 2 { "131072" } else { "65536" }
            );
            assert_eq!(
                value("--max-concurrency"),
                if index < 2 { "1" } else { "2" }
            );
            assert_eq!(
                value("--kv-arena-headroom-bytes"),
                if index < 2 { headroom } else { headroom + 4096 }.to_string()
            );
            assert_eq!(
                args.contains(&serde_json::json!("--structured-outputs")),
                index < 2
            );
            assert_eq!(
                args.contains(&serde_json::json!("--kv-arena-bytes")),
                index >= 3
            );
        }
        for (index, load) in loads.iter().enumerate() {
            let args = load.as_array().unwrap();
            let position = args.iter().position(|arg| arg == "--kv-arena-bytes");
            if index < 3 {
                assert!(position.is_none(), "Automatic must be resolved after startup");
            } else {
                assert_eq!(args[position.unwrap() + 1], "4096");
            }
        }
        host.processes.lock().await.shutdown().await.unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "one coordinator-booked default-worker Linux concurrency measurement"]
    fn service_resource_concurrent_control_scan_and_journal() {
        crate::resource_measurement::native_process_system_allocation();
        #[derive(Clone, Copy, serde::Serialize)]
        struct RouteTiming { start_ns: u128, end_ns: u128 }
        #[derive(Default)]
        struct InFlight {
            active: std::sync::atomic::AtomicUsize,
            peak: std::sync::atomic::AtomicUsize,
            scan: std::sync::atomic::AtomicUsize,
            pause: std::sync::atomic::AtomicUsize,
            reads_started_during_scan: std::sync::atomic::AtomicUsize,
            reads_started_during_pause: std::sync::atomic::AtomicUsize,
        }
        struct ActiveRoute<'a> { counters: &'a InFlight, scan: bool, pause: bool }
        impl Drop for ActiveRoute<'_> {
            fn drop(&mut self) {
                if self.scan { self.counters.scan.fetch_sub(1, Ordering::SeqCst); }
                if self.pause { self.counters.pause.fetch_sub(1, Ordering::SeqCst); }
                self.counters.active.fetch_sub(1, Ordering::SeqCst);
            }
        }
        fn proc_observation() -> serde_json::Value {
            fn capture(path: &str, parse: impl FnOnce(&str) -> Result<serde_json::Value, String>) -> serde_json::Value {
                match std::fs::read_to_string(path).map_err(|error| error.to_string()).and_then(|text| parse(&text)) {
                    Ok(value) => serde_json::json!({"value":value}),
                    Err(error) => serde_json::json!({"unavailable":error}),
                }
            }
            let cpu = capture("/proc/self/stat", |text| {
                let end = text.rfind(')').ok_or("invalid process stat")?;
                let fields: Vec<_> = text[end + 1..].split_whitespace().collect();
                let number = |index: usize| fields.get(index).ok_or("missing CPU field")?.parse::<u64>().map_err(|error| error.to_string());
                Ok(serde_json::json!({"user_ticks":number(11)?,"system_ticks":number(12)?}))
            });
            let threads = capture("/proc/self/status", |text| {
                let count = text.lines().find_map(|line| line.strip_prefix("Threads:"))
                    .ok_or("missing Threads")?.trim().parse::<u64>().map_err(|error| error.to_string())?;
                Ok(serde_json::json!(count))
            });
            let private = capture("/proc/self/smaps_rollup", |text| {
                let field = |name: &str| -> Result<u64, String> {
                    text.lines().find_map(|line| line.strip_prefix(name)).ok_or_else(|| format!("missing {name}"))?
                        .split_whitespace().next().ok_or("missing private-byte value")?
                        .parse::<u64>().map_err(|error| error.to_string())
                };
                let kib = field("Private_Clean:")?.checked_add(field("Private_Dirty:")?)
                    .and_then(|bytes| bytes.checked_add(field("Private_Hugetlb:").ok()?)).ok_or("private-byte overflow or missing hugetlb")?;
                Ok(serde_json::json!(kib.checked_mul(1024).ok_or("private-byte overflow")?))
            });
            let task_switches = (|| -> Result<serde_json::Value, String> {
                let mut tasks = BTreeMap::new();
                for entry in std::fs::read_dir("/proc/self/task").map_err(|error| error.to_string())? {
                    let entry = entry.map_err(|error| error.to_string())?;
                    let text = std::fs::read_to_string(entry.path().join("status")).map_err(|error| error.to_string())?;
                    let field = |name: &str| -> Result<u64, String> {
                        text.lines().find_map(|line| line.strip_prefix(name)).ok_or_else(|| format!("missing {name}"))?
                            .trim().parse::<u64>().map_err(|error| error.to_string())
                    };
                    tasks.insert(entry.file_name().to_string_lossy().into_owned(), serde_json::json!({
                        "voluntary":field("voluntary_ctxt_switches:")?, "involuntary":field("nonvoluntary_ctxt_switches:")?,
                    }));
                }
                Ok(serde_json::json!(tasks))
            })();
            serde_json::json!({"cpu":cpu,"threads":threads,"private_resident_bytes":private,
                "context_switches":match task_switches { Ok(value) => serde_json::json!({"value":value}), Err(error) => serde_json::json!({"unavailable":error}) }})
        }
        async fn request(host: &Arc<Host>, token: &str, counters: &InFlight, epoch: std::time::Instant, method: &str, path: &str, body: serde_json::Value) -> (RouteTiming, serde_json::Value) {
            let request = Request::builder().method(method).uri(path)
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(body.to_string())).unwrap();
            let start_ns = epoch.elapsed().as_nanos();
            let active = counters.active.fetch_add(1, Ordering::SeqCst) + 1;
            counters.peak.fetch_max(active, Ordering::SeqCst);
            let scan = path == "/host/v1/scan";
            let pause = path == "/host/v1/download-actions";
            if scan { counters.scan.fetch_add(1, Ordering::SeqCst); }
            if pause { counters.pause.fetch_add(1, Ordering::SeqCst); }
            if method == "GET" {
                if counters.scan.load(Ordering::SeqCst) != 0 { counters.reads_started_during_scan.fetch_add(1, Ordering::SeqCst); }
                if counters.pause.load(Ordering::SeqCst) != 0 { counters.reads_started_during_pause.fetch_add(1, Ordering::SeqCst); }
            }
            let ownership = ActiveRoute { counters, scan, pause };
            let response = host.clone().route(request).await.unwrap();
            let status = response.status();
            let body = hyper::body::to_bytes(response.into_body()).await.unwrap();
            let end_ns = epoch.elapsed().as_nanos();
            drop(ownership);
            let value = serde_json::from_slice(&body).unwrap();
            assert_eq!(status, StatusCode::OK, "{method} {path}: {value}");
            (RouteTiming { start_ns, end_ns }, value)
        }
        // Match production's default multi-thread worker selection. The ignored
        // fixture has one harness thread; no worker-count or blocking-pool tuning.
        assert!(std::env::var_os("TOKIO_WORKER_THREADS").is_none());
        let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
        let workers = runtime.metrics().num_workers();
        runtime.block_on(async {
            let (dir, host, launch) = fixture().await;
            let model = host.inventory.read().await[0].clone();
            let profiles: Vec<crate::launch_profiles::LaunchProfile> = (0..174).map(|index| {
                serde_json::from_value(serde_json::json!({
                    "id":format!("concurrent-{index}"),"name":"Synthetic concurrency fixture, not qualification",
                    "platform":"linux","identity":model.metadata.identity,"artifact_sha256":"a".repeat(64),
                    "artifact_bytes":4096,"tp":1,"draft_tp":0,"gpu_name":"Fixture GPU","compute_capability":"12.0",
                    "vram_tier_gib":32,"min_memory_mib_per_gpu":32768,"max_context":8192,"concurrency":1,"options":{},
                    "qualification":{"tier":"full-context-tested","evidence":"synthetic fixture only","engine_revision":"fixture",
                        "free_bytes_per_gpu":1_u64 << 30,"full_context_requests":1}
                })).unwrap()
            }).collect();
            let catalog_path = host.directory.join("launch-profiles.json");
            let catalog_bytes = serde_json::to_vec(&serde_json::json!({"schema":"ginfer-launch-profiles-v1","profiles":profiles})).unwrap();
            std::fs::write(&catalog_path, &catalog_bytes).unwrap();
            host.scan().await.unwrap();
            assert_eq!(host.launch_profiles.read().await.len(), 174);
            // Sleep children exercise management without model/hardware admission.
            // Preserve the Host hardware owner for measured Scan.
            let hardware = host.processes.lock().await.hardware_profile.clone();
            let mut synthetic = HostProcesses::new(
                dir.path().join("ginfer-serve"),
                host.gpus.iter().map(|gpu| gpu.uuid.clone()).collect(),
                Duration::from_secs(600),
            ).unwrap();
            synthetic.configure_runtimes(Default::default(), host.gpus.iter().filter_map(|gpu| {
                gpu.compute_capability.as_ref().map(|sm| (gpu.uuid.clone(), sm.clone()))
            }).collect()).unwrap();
            let mut instances = Vec::new();
            for index in 0..4 {
                let mut launch = launch.clone();
                launch.gpu_uuids = vec![format!("GPU-fixture-{index}")];
                let prepared = host.prepare_launch(&launch).await.unwrap();
                let id = prepared.instance_id;
                synthetic.launch(prepared).unwrap();
                launch.instance_id = Some(id);
                host.data.lock().await.profiles.insert(id, launch);
                synthetic.mark_profile_persisted(id);
                instances.push(id);
            }
            synthetic.hardware_profile = hardware;
            *host.processes.lock().await = synthetic;
            host.save().await.unwrap();
            let job_ids: Vec<_> = (0..100).map(|_| Uuid::new_v4()).collect();
            let release = crate::model_downloads::Release {
                name:"Synthetic queued transfer, never started".into(), identity:model.metadata.identity.clone(),
                url:"https://huggingface.co/SectileLabs/fixture/resolve/0000000000000000000000000000000000000000/model.ginfer".into(),
                sha256:"a".repeat(64), bytes:4096, tp:1, qualified_sm:vec!["12.0".into()], min_vram_mib_per_gpu:32768,
                capabilities:vec!["tools".into()], launch_profiles:vec![],
            };
            release.validate().unwrap();
            host.downloads.seed_concurrent_resource_jobs(job_ids.iter().enumerate().map(|(index, id)| crate::model_downloads::Download {
                id:*id,release:release.clone(),status:if index == 0 { "queued" } else { "paused" }.into(),received:0,bytes_per_second:0,error:None,path:None,
                storage_root:host.downloads.root(),
                verification: None,
            }).collect()).await;
            let mut expected_jobs = host.downloads.list().await;
            expected_jobs.iter_mut().find(|job| job.id == job_ids[0]).unwrap().status = "paused".into();
            let expected_jobs = serde_json::to_value(expected_jobs).unwrap();
            let journal = host.directory.join("model-downloads.json");
            assert!(!journal.exists());
            let token = host.data.lock().await.pairing_admin_token.clone();
            let unauthorized = host.clone().route(Request::get("/host/v1/snapshot").body(Body::empty()).unwrap()).await.unwrap();
            assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
            let idle_before = proc_observation();
            let idle_started = std::time::Instant::now();
            tokio::time::sleep(Duration::from_secs(2)).await;
            let idle_ns = idle_started.elapsed().as_nanos();
            let idle_after = proc_observation();
            let epoch = std::time::Instant::now();
            let counters = Arc::new(InFlight::default());
            let barrier = Arc::new(tokio::sync::Barrier::new(8));
            let mut jobs = tokio::task::JoinSet::new();
            for reader in 0..4 {
                let host = host.clone(); let token = token.clone(); let barrier = barrier.clone(); let counters = counters.clone();
                jobs.spawn(async move {
                    barrier.wait().await;
                    let mut observations = Vec::new();
                    for _ in 0..16 {
                        for (label, path) in [("snapshot","/host/v1/snapshot"),("downloads","/host/v1/downloads"),("control_clients","/host/v1/clients")] {
                            let (elapsed, value) = request(&host, &token, &counters, epoch, "GET", path, serde_json::json!({})).await;
                            if label == "snapshot" {
                                assert_eq!(value["launch_profiles"].as_array().unwrap().len(), 174);
                                assert_eq!(value["instances"].as_array().unwrap().len(), 4);
                            } else if label == "downloads" { assert_eq!(value.as_array().unwrap().len(), 100); }
                            observations.push((format!("{label}-reader-{reader}"), elapsed));
                        }
                    }
                    observations
                });
            }
            {
                let host = host.clone(); let token = token.clone(); let barrier = barrier.clone(); let counters = counters.clone();
                jobs.spawn(async move {
                    barrier.wait().await;
                    let mut observations = Vec::new();
                    for _ in 0..4 {
                        let (elapsed, value) = request(&host, &token, &counters, epoch, "POST", "/host/v1/scan", serde_json::json!({})).await;
                        assert_eq!(value["launch_profiles"].as_array().unwrap().len(), 174);
                        observations.push(("scan".into(), elapsed));
                    }
                    observations
                });
            }
            {
                let host = host.clone(); let token = token.clone(); let barrier = barrier.clone(); let id = job_ids[0]; let counters = counters.clone();
                jobs.spawn(async move {
                    barrier.wait().await;
                    let (elapsed, _) = request(&host, &token, &counters, epoch, "POST", "/host/v1/download-actions", serde_json::json!({"id":id,"action":"pause"})).await;
                    vec![("pause_one_ordered_100_job_journal".into(), elapsed)]
                });
            }
            {
                let host = host.clone(); let token = token.clone(); let barrier = barrier.clone(); let id = instances[0]; let counters = counters.clone();
                jobs.spawn(async move {
                    barrier.wait().await;
                    // Three other synthetic children stay live throughout every
                    // Scan: idle hardware preparation must never be admitted.
                    let (elapsed, _) = request(&host, &token, &counters, epoch, "POST", &format!("/host/v1/instances/{id}/stop"), serde_json::json!({})).await;
                    vec![("stop_one_synthetic_child".into(), elapsed)]
                });
            }
            let active_before = proc_observation();
            let started = std::time::Instant::now();
            barrier.wait().await;
            let mut latencies: BTreeMap<String, Vec<RouteTiming>> = BTreeMap::new();
            let outcome = tokio::time::timeout(Duration::from_secs(20), async {
                while let Some(result) = jobs.join_next().await {
                    for (label, ns) in result.map_err(|error| error.to_string())? {
                        latencies.entry(label).or_default().push(ns);
                    }
                }
                Ok::<_, String>(())
            }).await;
            let elapsed_ns = started.elapsed().as_nanos();
            let active_after = proc_observation();
            if !matches!(outcome, Ok(Ok(()))) {
                jobs.abort_all();
                while jobs.join_next().await.is_some() {}
            }
            let final_snapshot = tokio::time::timeout(Duration::from_secs(3), host.snapshot()).await;
            // Reap every owned synthetic child before asserting measurement or
            // journal results, including a task panic or timeout outcome.
            let cleanup = tokio::time::timeout(Duration::from_secs(5), async {
                host.processes.lock().await.shutdown().await
            }).await;
            cleanup.unwrap().unwrap();
            outcome.unwrap().unwrap();
            let final_snapshot = final_snapshot.unwrap();
            let saved: BTreeMap<Uuid, crate::model_downloads::Download> = serde_json::from_slice(&std::fs::read(&journal).unwrap()).unwrap();
            assert_eq!(saved.len(), 100);
            assert_eq!(saved[&job_ids[0]].status, "paused");
            for id in job_ids.iter().skip(1) { assert_eq!(saved[id].status, "paused"); }
            assert_eq!(serde_json::to_value(saved.values().collect::<Vec<_>>()).unwrap(), expected_jobs);
            assert_eq!(serde_json::to_value(host.downloads.list().await).unwrap(), serde_json::to_value(saved.values().collect::<Vec<_>>()).unwrap());
            let reopened = crate::model_downloads::ModelDownloads::open(host.downloads.root(), journal.clone()).unwrap();
            assert_eq!(serde_json::to_value(reopened.list().await).unwrap(), serde_json::to_value(saved.values().collect::<Vec<_>>()).unwrap());
            assert_eq!(std::fs::read(&catalog_path).unwrap(), catalog_bytes);
            assert_eq!(final_snapshot["instances"].as_array().unwrap().iter().filter(|instance| instance["status"] == "stopped").count(), 1);
            assert!(final_snapshot["inventory_errors"].as_array().unwrap().is_empty());
            let profile_status = host.processes.lock().await.hardware_profile.as_ref().unwrap().status(None);
            assert_eq!(profile_status.status, "idle");
            assert!(profile_status.pid.is_none());
            let overlaps = |left: &RouteTiming, right: &RouteTiming| left.start_ns < right.end_ns && right.start_ns < left.end_ns;
            let pause = latencies["pause_one_ordered_100_job_journal"][0];
            let read_timings: Vec<_> = latencies.iter().filter(|(label, _)| label.starts_with("snapshot-") || label.starts_with("downloads-") || label.starts_with("control_clients-"))
                .flat_map(|(_, timings)| timings.iter()).collect();
            let pause_overlap = read_timings.iter().any(|reading| overlaps(&pause, reading));
            let scan_overlap = latencies["scan"].iter().any(|scan| read_timings.iter().any(|reading| overlaps(scan, reading)));
            assert!(pause_overlap, "no observed read/control overlap with the real durable Pause; not a concurrent journal measurement");
            assert!(scan_overlap, "no observed read/control overlap with a production Scan");
            let summaries: BTreeMap<_, _> = latencies.into_iter().map(|(label, mut values)| {
                values.sort_by_key(|value| value.end_ns - value.start_ns);
                let count = values.len();
                let elapsed = |index: usize| values[index].end_ns - values[index].start_ns;
                let p95 = elapsed((count * 95).div_ceil(100).saturating_sub(1));
                (label, if count == 1 { serde_json::json!({"completed":1,"duration_ns":elapsed(0),"intervals":values}) } else {
                    serde_json::json!({"completed":count,"min_ns":elapsed(0),"median_ns":elapsed(count / 2),"sample_p95_ns":p95,"max_ns":elapsed(count - 1),
                        "mixed_workload_share_per_second":count as f64 * 1_000_000_000.0 / elapsed_ns as f64,"intervals":values})
                })
            }).collect();
            println!("CONCURRENT_HOST_RESOURCE_RESULT {}", serde_json::json!({
                "scope":"native Linux test process; actual authenticated Host route, excludes socket/TLS, daemon maintenance and model/hardware admission; four public-process-owner synthetic nongpu children",
                "workers":"production default","worker_count":workers,"catalog_profiles":174,"instances":4,"journal_entries":100,
                "allocator_scope":"System with irreversible accounting bypass; one atomic dispatch branch per allocation, no counting spinlock",
                "journal_writes_in_scope":1,"journal_bytes":std::fs::metadata(journal).unwrap().len(),"elapsed_ns":elapsed_ns,
                "observed_pause_read_overlap":pause_overlap,"observed_scan_read_overlap":scan_overlap,"journal_reopen_exact":true,
                "in_flight":{"peak":counters.peak.load(Ordering::SeqCst),"reads_started_during_scan":counters.reads_started_during_scan.load(Ordering::SeqCst),
                    "reads_started_during_pause":counters.reads_started_during_pause.load(Ordering::SeqCst)},
                "mixed_workload_completed":198,"mixed_workload_per_second":198.0 * 1_000_000_000.0 / elapsed_ns as f64,
                "idle_scope":"two-second loaded Host fixture, no daemon periodic monitor","idle_elapsed_ns":idle_ns,
                "idle_before":idle_before,"idle_after":idle_after,"active_before":active_before,"active_after":active_after,
                "latencies":summaries,"counter_scope":"native process /proc; CPU ticks are raw; context switches retain per-thread IDs; unavailable counters are explicit",
                "full_sha_scope":"prior accepted full-package SHA fixture reused; no new hash measurement",
            }));
        });
    }

    #[tokio::test]
    #[ignore = "global allocation measurement; run explicitly with --test-threads=1"]
    async fn service_resource_inference_body_preserves_json_and_model() {
        let (dir, host, mut request) = fixture().await;
        let hardware = host.processes.lock().await.hardware_profile.clone();
        let mut synthetic = HostProcesses::new(
            dir.path().join("ginfer-serve"),
            host.gpus.iter().map(|gpu| gpu.uuid.clone()).collect(),
            Duration::from_secs(600),
        ).unwrap();
        synthetic.configure_runtimes(Default::default(), host.gpus.iter().filter_map(|gpu| {
            gpu.compute_capability.as_ref().map(|sm| (gpu.uuid.clone(), sm.clone()))
        }).collect()).unwrap();
        let prepared = host.prepare_launch(&request).await.unwrap();
        let id = prepared.instance_id;
        synthetic.launch(prepared).unwrap();
        request.instance_id = Some(id);
        host.data.lock().await.profiles.insert(id, request);
        synthetic.mark_profile_persisted(id);
        synthetic.hardware_profile = hardware;
        *host.processes.lock().await = synthetic;
        let port = host.processes.lock().await.instances().find(|instance| instance.instance_id == id).unwrap().launch.port;
        let received = Arc::new(std::sync::Mutex::new(Vec::new()));
        let capture = received.clone();
        let upstream = hyper::Server::bind(&([127, 0, 0, 1], port).into()).serve(hyper::service::make_service_fn(move |_| {
            let capture = capture.clone();
            async move { Ok::<_, std::convert::Infallible>(hyper::service::service_fn(move |req: Request<Body>| {
                let capture = capture.clone();
                async move {
                    let body = match req.uri().path() {
                        "/health" => "{}".to_owned(),
                        "/v1/models" => serde_json::json!({"data":[{"id":"muse-glimmer-30b/nvfp4"}]}).to_string(),
                        _ => {
                            let content_type = req.headers().get("content-type").map(|value| value.to_str().unwrap().to_owned());
                            let bytes = hyper::body::to_bytes(req.into_body()).await.unwrap();
                            let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                            capture.lock().unwrap().push((content_type, value));
                            "{}".to_owned()
                        }
                    };
                    Ok::<_, std::convert::Infallible>(Response::new(Body::from(body)))
                }
            })) }
        }));
        let server = tokio::spawn(upstream);
        host.refresh_processes().await.unwrap();
        let token = host.data.lock().await.pairing_admin_token.clone();
        let call = |suffix: &str, bytes: Vec<u8>| {
            Request::post(format!("/host/v1/instances/{id}/inference/{suffix}"))
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "text/plain")
                .body(Body::from(bytes))
                .unwrap()
        };
        for mib in [1, 64] {
            let mut original = serde_json::json!({"model":"caller-alias", "messages":[{"role":"user", "content":"Unicode 🐦\nquoted \"text\""}], "padding":""});
            let prefix_bytes = serde_json::to_vec(&original).unwrap().len();
            original["padding"] = "x".repeat(mib * 1024 * 1024 - prefix_bytes).into();
            let bytes = serde_json::to_vec(&original).unwrap();
            assert_eq!(bytes.len(), mib * 1024 * 1024);
            let request = call("v1/chat/completions", bytes);
            let label = format!("service_resource_inference_body_{mib}_mib");
            let measurement = crate::resource_measurement::Measurement::start();
            let response = host.clone().route(request).await.unwrap();
            let status = response.status();
            let response_bytes = hyper::body::to_bytes(response.into_body()).await.unwrap();
            measurement.finish(&label);
            original["model"] = "muse-glimmer-30b/nvfp4".into();
            let captured = std::mem::take(&mut *received.lock().unwrap());
            assert_eq!(status, StatusCode::OK);
            assert_eq!(response_bytes.as_ref(), b"{}");
            assert_eq!(captured, vec![(Some("application/json".to_owned()), original)]);
        }
        let benchmark = host
            .clone()
            .route(call(
                "v1/ginfer/benchmark",
                br#"{"model":"benchmark-owned"}"#.to_vec(),
            ))
            .await
            .unwrap();
        let invalid_object = host
            .clone()
            .route(call("v1/chat/completions", b"[]".to_vec()))
            .await
            .unwrap();
        let invalid_json = host
            .clone()
            .route(call("v1/chat/completions", b"{broken".to_vec()))
            .await
            .unwrap();
        let captured = std::mem::take(&mut *received.lock().unwrap());
        host.processes.lock().await.shutdown().await.unwrap();
        server.abort();
        let _ = server.await;
        assert_eq!(benchmark.status(), StatusCode::OK);
        assert_eq!(invalid_object.status(), StatusCode::BAD_REQUEST);
        assert_eq!(invalid_json.status(), StatusCode::BAD_REQUEST);
        assert_eq!(captured, vec![(Some("application/json".to_owned()), serde_json::json!({"model":"benchmark-owned"}))]);
    }

    #[test]
    fn service_inference_body_preserves_raw_fields_and_object_validation() {
        use serde_json::value::RawValue;
        let source = br#"{"m\u006fdel":"first","model":"last","nested": { "n": 123456789012345678901234567890, "f": 1.2300e+40, "s": "\u0041\/" },"model2":"untouched"}"#;
        let output = inference_body(source.to_vec(), Some("host\"model"), "v1/chat/completions").unwrap();
        let fields: BTreeMap<String, &RawValue> = serde_json::from_slice(&output).unwrap();
        assert_eq!(fields["model"].get(), r#""host\"model""#);
        assert_eq!(fields["model2"].get(), r#""untouched""#);
        assert_eq!(fields["nested"].get(), r#"{ "n": 123456789012345678901234567890, "f": 1.2300e+40, "s": "\u0041\/" }"#);
        assert_eq!(fields.len(), 3);
        assert_eq!(inference_body(b"{}".to_vec(), Some("host"), "v1/chat/completions").unwrap(), br#"{"model":"host"}"#);
        let benchmark = b" { \"model\" : \"benchmark-owned\" } ".to_vec();
        assert_eq!(inference_body(benchmark.clone(), None, "v1/ginfer/benchmark").unwrap(), benchmark);
        for source in ["[]", "null", "true", "42", "\"text\""] {
            assert_eq!(inference_body(source.as_bytes().to_vec(), Some("host"), "v1/chat/completions").unwrap_err(), "inference body must be a JSON object");
        }
        for source in ["{broken", "{} trailing", "{\"x\": NaN}"] {
            assert!(inference_body(source.as_bytes().to_vec(), None, "v1/chat/completions").is_err());
        }
    }

    #[test]
    fn service_inference_rejects_server_hosted_tools_on_each_protocol() {
        for path in ["v1/chat/completions", "v1/responses", "v1/messages"] {
            for kind in ["file_search", "web_search", "mcp"] {
                let body = serde_json::json!({"tools":[{"type":kind,"name":"search","input_schema":{"type":"object"}}]});
                let error = inference_body(serde_json::to_vec(&body).unwrap(), Some("model"), path).unwrap_err();
                assert!(error.contains("tools[0].type"), "{path}: {error}");
                assert!(error.contains(kind), "{path}: {error}");
            }
        }
    }

    #[test]
    fn service_inference_rejects_server_mcp_and_retrieval_declarations() {
        for path in ["v1/chat/completions", "v1/responses", "v1/messages"] {
            for key in ["mcp_servers", "retrieval", "file_search", "web_search"] {
                let mut body = serde_json::json!({"model":"model"});
                body[key] = serde_json::json!([{"url":"https://example.invalid/tool"}]);
                let error = inference_body(serde_json::to_vec(&body).unwrap(), None, path).unwrap_err();
                assert!(error.contains(key) && error.contains("not supported"), "{path}: {error}");
            }
        }
    }

    #[test]
    fn service_inference_rejects_audio_and_wrong_protocol_output_controls() {
        for path in ["v1/chat/completions", "v1/responses", "v1/messages"] {
            for body in [serde_json::json!({"modalities":["text","audio"]}), serde_json::json!({"audio":{"voice":"alloy"}})] {
                let error = inference_body(serde_json::to_vec(&body).unwrap(), None, path).unwrap_err();
                assert!(error.contains("audio") && error.contains("not supported"), "{path}: {error}");
            }
        }
        for (path, body, field) in [
            ("v1/messages", serde_json::json!({"response_format":{"type":"json_object"}}), "response_format"),
            ("v1/chat/completions", serde_json::json!({"output_config":{"format":{"type":"json_schema","schema":{}}}}), "output_config"),
            ("v1/messages", serde_json::json!({"text":{"format":{"type":"json_object"}}}), "text"),
            ("v1/responses", serde_json::json!({"output_format":{"type":"regex","pattern":".*"}}), "output_format"),
        ] {
            let error = inference_body(serde_json::to_vec(&body).unwrap(), None, path).unwrap_err();
            assert!(error.contains(field) && error.contains("not supported"), "{path}: {error}");
        }
    }

    #[test]
    fn service_inference_preserves_supported_tools_and_output_formats() {
        for (path, body) in [
            ("v1/chat/completions", serde_json::json!({"tools":[{"type":"function","function":{"name":"lookup","parameters":{"type":"object"}}}],"response_format":{"type":"json_object"},"modalities":["text"]})),
            ("v1/responses", serde_json::json!({"tools":[{"type":"namespace","name":"workspace","tools":[{"type":"function","name":"read","parameters":{"type":"object"}}]}],"text":{"format":{"type":"json_schema","name":"answer","schema":{"type":"object"}}}})),
            ("v1/messages", serde_json::json!({"tools":[{"type":"custom","name":"lookup","input_schema":{"type":"object"},"strict":false}],"output_config":{"format":{"type":"json_schema","schema":{"type":"object"}}}})),
        ] {
            let bytes = serde_json::to_vec(&body).unwrap();
            assert_eq!(inference_body(bytes.clone(), None, path).unwrap(), bytes);
        }
        let error = inference_body(br#"{"tools":[{"name":"lookup","input_schema":{},"strict":true}]}"#.to_vec(), None, "v1/messages").unwrap_err();
        assert!(error.contains("strict") && error.contains("not supported"));
    }

    #[test]
    fn service_inference_rejects_unsupported_native_parallel_tool_control() {
        for value in [serde_json::json!(true), serde_json::json!("false")] {
            let body = serde_json::json!({"tool_choice":{"type":"auto","disable_parallel_tool_use":value}});
            let error = inference_body(serde_json::to_vec(&body).unwrap(), None, "v1/messages").unwrap_err();
            assert!(error.contains("tool_choice.disable_parallel_tool_use") && error.contains("not supported"));
        }
        let bytes = br#"{"tool_choice":{"type":"auto","disable_parallel_tool_use":false}}"#.to_vec();
        assert_eq!(inference_body(bytes.clone(), None, "v1/messages").unwrap(), bytes);
    }

    #[tokio::test]
    async fn service_body_cap_uses_actual_bytes_with_exact_and_unreliable_hints() {
        let mut exact = Request::new(Body::from("12345678"));
        assert_eq!(bounded_body(&mut exact, 8).await.unwrap(), b"12345678");
        let mut over = Request::new(Body::from("123456789"));
        assert_eq!(bounded_body(&mut over, 8).await.unwrap_err(), "request exceeds host body limit");
        let chunks = futures_util::stream::iter([Ok::<_, std::convert::Infallible>("1234"), Ok("5678")]);
        let mut unknown = Request::builder().header("content-length", u64::MAX.to_string()).body(Body::wrap_stream(chunks)).unwrap();
        assert_eq!(bounded_body(&mut unknown, 8).await.unwrap(), b"12345678");
        let chunks = futures_util::stream::iter([Ok::<_, std::convert::Infallible>("1234"), Ok("56789")]);
        let mut misleading = Request::builder().header("content-length", "1").body(Body::wrap_stream(chunks)).unwrap();
        assert_eq!(bounded_body(&mut misleading, 8).await.unwrap_err(), "request exceeds host body limit");
    }

    #[tokio::test]
    #[ignore = "global allocation measurement; run explicitly with --test-threads=1"]
    async fn service_resource_scan_deduplicates_managed_paths_and_refreshes_errors() {
        use sha2::Digest;
        use crate::engine_inventory::{resource_io, InventoryInspection};
        fn write_member(path: &Path, tp: u32, complete: bool) -> u64 {
            let mut objects = Vec::new();
            for rank in 0..tp {
                for suffix in ["profile_v2", "full_inverse_global_scales", "sliding_inverse_global_scales"] {
                    if !complete && rank + 1 == tp && suffix == "sliding_inverse_global_scales" {
                        continue;
                    }
                    objects.push(serde_json::json!({"kind":"tensor","rank":rank,"name":format!("text/kv_cache/nvfp4_g16/{suffix}")}));
                }
            }
            let directory = serde_json::to_vec(&serde_json::json!({
                "identity":{"model_id":"muse-glimmer-30b","weights_id":"nvfp4"},
                "tp_size":tp,"draft_tp":0,"objects":objects,
            })).unwrap();
            let mut bytes = b"NINFER\0\x03".to_vec();
            bytes.extend((directory.len() as u64).to_le_bytes());
            bytes.extend(&directory);
            bytes.resize(4096, 0);
            std::fs::write(path, bytes).unwrap();
            16 + directory.len() as u64
        }
        fn io_delta(before: resource_io::Counts, after: resource_io::Counts) -> serde_json::Value {
            serde_json::json!({"opens":after.opens-before.opens,"read_bytes":after.read_bytes-before.read_bytes,"read_calls":after.read_calls-before.read_calls})
        }
        fn cpu_ticks() -> Option<u64> {
            let stat = std::fs::read_to_string("/proc/self/stat").ok()?;
            let fields: Vec<_> = stat[stat.rfind(')')? + 1..].split_whitespace().collect();
            let user = fields.get(11)?.parse::<u64>().ok()?;
            user.checked_add(fields.get(12)?.parse::<u64>().ok()?)
        }
        fn cpu_delta(before: Option<u64>, after: Option<u64>) -> Option<u64> {
            after?.checked_sub(before?)
        }
        let (dir, host, _) = fixture().await;
        let mut shared_header_bytes = 0;
        let mut declarations = Vec::new();
        let mut members = Vec::new();
        for tp in [1, 2, 4] {
            let name = format!("shared-tp{tp}.ginfer");
            let path = dir.path().join("models").join(&name);
            shared_header_bytes += write_member(&path, tp, true);
            declarations.push(serde_json::json!({"tp":tp,"draft_tp":0,"path":name,"bytes":4096,"sha256":"a".repeat(64)}));
            members.push(path);
        }
        let descriptor = serde_json::json!({
            "schema":"ginfer-artifact-set-v1",
            "identity":{"model_id":"muse-glimmer-30b","weights_id":"nvfp4","family_id":"b".repeat(64)},
            "canonical_reconstructed_target_sha256":"c".repeat(64),
            "canonical_reconstructed_draft_sha256":null,"artifacts":declarations,
        });
        let sets: Vec<_> = ["shared-a.json", "shared-b.json"].into_iter().map(|name| {
            let path = dir.path().join("models").join(name);
            std::fs::write(&path, serde_json::to_vec(&descriptor).unwrap()).unwrap();
            path
        }).collect();
        let bad_set = dir.path().join("models/shared-bad.json");
        let mut invalid_descriptor = descriptor.clone();
        invalid_descriptor["artifacts"][2]["bytes"] = 4097.into();
        std::fs::write(&bad_set, serde_json::to_vec(&invalid_descriptor).unwrap()).unwrap();
        let original = std::fs::read(dir.path().join("models/model.ginfer")).unwrap();
        let original_header_bytes = 16 + u64::from_le_bytes(original[8..16].try_into().unwrap());
        let package = host.downloads.root().join("package");
        std::fs::create_dir(&package).unwrap();
        let payload = package.join("model.ginfer");
        std::fs::copy(dir.path().join("models/model.ginfer"), &payload).unwrap();
        let id = Uuid::new_v4();
        let download = crate::model_downloads::Download {
            id, release: crate::model_downloads::Release {
                name: "Owned local fixture".into(), identity: host.inventory.read().await[0].metadata.identity.clone(),
                url: "https://huggingface.co/SectileLabs/fixture/resolve/0000000000000000000000000000000000000000/model.ginfer".into(),
                sha256: hex::encode(Sha256::digest(std::fs::read(&payload).unwrap())), bytes: 4096,
                tp: 1, qualified_sm: vec!["12.0".into()], min_vram_mib_per_gpu: 32768,
                capabilities: vec![], launch_profiles: vec![],
            }, status: "installed".into(), received: 4096, bytes_per_second: 0,
            error: None, path: Some(payload.clone()), storage_root: host.downloads.root(),
            verification: None,
        };
        std::fs::write(
            dir.path().join("state/model-downloads.json"),
            serde_json::to_vec(&BTreeMap::from([(id, download)])).unwrap(),
        )
        .unwrap();
        let executable = dir.path().join("ginfer-serve");
        drop(host);
        let broken = dir.path().join("models/broken.ginfer");
        std::fs::write(&broken, b"invalid fixture").unwrap();
        let missing = dir.path().join("missing.ginfer");
        let models_alias = dir.path().join("models/.");
        let host = Host::open(
            dir.path().join("state"),
            "Ignored".into(),
            executable,
            vec![
                dir.path().join("models"),
                models_alias.clone(),
                package,
                payload.clone(),
                missing.clone(),
            ],
            sets.iter().cloned().chain(std::iter::once(bad_set.clone())).collect(),
            vec![],
        )
        .await
        .unwrap();
        host.data.lock().await.local_artifacts.push(payload.clone());
        let ids: BTreeMap<_, _> = host
            .inventory
            .read()
            .await
            .iter()
            .map(|model| ((model.path.clone(), model.metadata.tp_size, model.artifact_set), model.id))
            .collect();
        let before = resource_io::snapshot();
        let cpu_before = cpu_ticks();
        let measurement = crate::resource_measurement::Measurement::start();
        let mut uncached = Vec::new();
        uncached.extend(artifact_set_members(&sets[0]).unwrap());
        for member in &members {
            uncached.push((member.canonicalize().unwrap(), inspect_artifact(member).unwrap()));
        }
        measurement.finish("shared_headers_uncached_wrappers");
        let uncached_cpu = cpu_delta(cpu_before, cpu_ticks());
        let uncached_io = io_delta(before, resource_io::snapshot());
        let before = resource_io::snapshot();
        let cpu_before = cpu_ticks();
        let measurement = crate::resource_measurement::Measurement::start();
        let mut inspection = InventoryInspection::default();
        let mut cached = Vec::new();
        cached.extend(inspection.artifact_set_members(&sets[0]).unwrap());
        for member in &members {
            cached.push((member.canonicalize().unwrap(), inspection.inspect_artifact(member).unwrap()));
        }
        measurement.finish("shared_headers_one_inspection");
        let cached_cpu = cpu_delta(cpu_before, cpu_ticks());
        let cached_io = io_delta(before, resource_io::snapshot());
        assert_eq!(uncached, cached);
        assert!(cached.iter().all(|(_, metadata)| metadata.nvfp4_kv_available));
        assert_eq!(uncached_io["opens"], 7);
        assert_eq!(cached_io["opens"], 4);
        assert_eq!(uncached_io["read_bytes"].as_u64().unwrap() - cached_io["read_bytes"].as_u64().unwrap(), shared_header_bytes);
        assert_eq!(inspection.artifact_set_members(&sets[1]).unwrap(), cached[..3]);
        assert!(inspection.artifact_set_members(&bad_set).unwrap_err().contains("disagrees with its declaration"));
        drop(inspection);
        drop(cached);
        drop(uncached);
        let expected_scan_bytes = shared_header_bytes + 2 * original_header_bytes + b"invalid fixture".len() as u64
            + sets.iter().chain(std::iter::once(&bad_set)).map(|path| std::fs::metadata(path).unwrap().len()).sum::<u64>();
        println!("RESOURCE_SCAN_PHASE_BEGIN managed_packages=1 visible_models=11 shared_members=3 sets=2 duplicate_sources=root/job/local/configured/set");
        let before = resource_io::snapshot();
        let cpu_before = cpu_ticks();
        let measurement = crate::resource_measurement::Measurement::start();
        host.scan().await.unwrap();
        measurement.finish("service_resource_scan_one_pass");
        let scan_cpu = cpu_delta(cpu_before, cpu_ticks());
        let scan_io = io_delta(before, resource_io::snapshot());
        assert_eq!(scan_io["opens"], 9);
        assert_eq!(scan_io["read_bytes"], expected_scan_bytes);
        println!("SHARED_HEADER_RESULT {}", serde_json::json!({"uncached":uncached_io,"inspection":cached_io,"host_scan":scan_io,"process_cpu_ticks":{"uncached":uncached_cpu,"inspection":cached_cpu,"host_scan":scan_cpu},"scope":"one fresh metadata pass; synthetic TP1/2/4, coarse process CPU ticks, no full hash or Engine"}));
        let first = host.snapshot().await;
        std::fs::OpenOptions::new().write(true).open(&payload).unwrap().set_len(8192).unwrap();
        std::fs::remove_file(&broken).unwrap();
        write_member(&members[2], 4, false);
        host.scan().await.unwrap();
        let second = host.snapshot().await;
        let refreshed: BTreeMap<_, _> = host.inventory.read().await.iter().map(|model| ((model.path.clone(), model.metadata.tp_size, model.artifact_set), model.id)).collect();
        assert_eq!(ids, refreshed);
        assert_eq!(first["models"].as_array().unwrap().iter().map(|model| &model["id"]).collect::<Vec<_>>(), second["models"].as_array().unwrap().iter().map(|model| &model["id"]).collect::<Vec<_>>());
        assert_eq!(first["models"].as_array().unwrap().len(), 11);
        let errors = first["inventory_errors"].as_array().unwrap();
        assert_eq!(errors.len(), 4);
        assert!(errors.iter().any(|error| error["path"] == broken.to_string_lossy().as_ref()));
        assert!(errors.iter().any(|error| error["path"] == models_alias.join("broken.ginfer").to_string_lossy().as_ref()));
        assert!(errors.iter().any(|error| error["path"] == bad_set.to_string_lossy().as_ref()));
        assert_eq!(second["inventory_errors"].as_array().unwrap().len(), 2);
        assert!(second["inventory_errors"].as_array().unwrap().iter().any(|error| error["path"] == missing.to_string_lossy().as_ref()));
        assert_eq!(second["models"].as_array().unwrap().iter().find(|model| model["path"] == payload.to_string_lossy().as_ref()).unwrap()["metadata"]["size_bytes"], 8192);
        let inventory = host.inventory.read().await;
        assert_eq!(inventory.iter().filter(|model| model.metadata.tp_size == 4).count(), 3);
        assert!(inventory.iter().filter(|model| model.metadata.tp_size == 4).all(|model| !model.metadata.nvfp4_kv_available));
        drop(inventory);
        write_member(&members[2], 4, true);
        std::fs::write(&bad_set, serde_json::to_vec(&descriptor).unwrap()).unwrap();
        host.scan().await.unwrap();
        let recovered = host.snapshot().await;
        assert_eq!(recovered["inventory_errors"].as_array().unwrap().len(), 1);
        assert_eq!(recovered["inventory_errors"][0]["path"], missing.to_string_lossy().as_ref());
        assert_eq!(recovered["models"].as_array().unwrap().len(), 14);
        assert!(host.inventory.read().await.iter().filter(|model| model.metadata.tp_size == 4).all(|model| model.metadata.nvfp4_kv_available));
    }

    #[tokio::test]
    async fn catalog_snapshot_keeps_gpu_compatibility_and_shared_groups() {
        let (dir, host, request) = fixture().await;
        let model = host.inventory.read().await[0].clone();
        let base: crate::launch_profiles::LaunchProfile = serde_json::from_value(serde_json::json!({
            "id":"base", "name":"Fixture", "platform":std::env::consts::OS,
            "identity":model.metadata.identity, "artifact_sha256":"a".repeat(64), "artifact_bytes":4096,
            "tp":1, "draft_tp":0, "gpu_name":"Fixture GPU", "compute_capability":"12.0", "vram_tier_gib":32,
            "min_memory_mib_per_gpu":32768, "max_context":8192, "concurrency":1, "options":{},
            "qualification":{"tier":"full-context-tested", "evidence":"fixture", "engine_revision":"fixture", "full_context_requests":1}
        })).unwrap();
        let mut catalog = vec![base.clone(); 7];
        catalog[1].platform = "other".into();
        catalog[2].gpu_name = "other".into();
        catalog[3].compute_capability = "8.6".into();
        catalog[4].min_memory_mib_per_gpu = 32769;
        catalog[5].tp = 2;
        catalog[6].tp = 4;
        for profile in &catalog[5..] {
            let mut member = model.clone();
            member.id = Uuid::new_v4();
            member.metadata.tp_size = profile.tp;
            host.inventory.write().await.push(member);
        }
        *host.launch_profiles.write().await = catalog;
        let compatible = serde_json::json!([["GPU-fixture-0"], ["GPU-fixture-1"], ["GPU-fixture-2"], ["GPU-fixture-3"]]);
        let first = host.snapshot().await;
        assert_eq!(first["launch_profiles"][0]["gpu_groups"], compatible);
        for entry in &first["launch_profiles"].as_array().unwrap()[1..5] {
            assert_eq!(entry["gpu_groups"], serde_json::json!([]));
            assert_eq!(entry["compatible_gpu_groups"], serde_json::json!([]));
        }
        assert_eq!(first["launch_profiles"][5]["gpu_groups"].as_array().unwrap().len(), 6);
        assert_eq!(first["launch_profiles"][6]["gpu_groups"], serde_json::json!([["GPU-fixture-0", "GPU-fixture-1", "GPU-fixture-2", "GPU-fixture-3"]]));
        let launch = host.prepare_launch(&request).await.unwrap();
        // CPU children exercise reservations without native hardware admission.
        let mut processes = HostProcesses::new(
            dir.path().join("ginfer-serve"),
            host.gpus.iter().map(|gpu| gpu.uuid.clone()).collect(),
            Duration::from_secs(600),
        ).unwrap();
        processes.configure_runtimes(Default::default(), host.gpus.iter().filter_map(|gpu| {
            gpu.compute_capability.as_ref().map(|sm| (gpu.uuid.clone(), sm.clone()))
        }).collect()).unwrap();
        processes.launch(launch).unwrap();
        *host.processes.lock().await = processes;
        let reserved = host.snapshot().await;
        assert_eq!(reserved["launch_profiles"][0]["gpu_groups"], compatible);
        assert_eq!(reserved["launch_profiles"][0]["compatible_gpu_groups"], compatible);
        assert_eq!(reserved["launch_profiles"][5]["gpu_groups"].as_array().unwrap().len(), 6);
        assert_eq!(reserved["launch_profiles"][6]["gpu_groups"], serde_json::json!([["GPU-fixture-0", "GPU-fixture-1", "GPU-fixture-2", "GPU-fixture-3"]]));
        host.processes.lock().await.shutdown().await.unwrap();
        assert_eq!(host.snapshot().await["launch_profiles"][0]["gpu_groups"], compatible);
        *host.launch_profiles.write().await = vec![base];
        assert_eq!(host.snapshot().await["launch_profiles"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    #[ignore = "global allocation measurement; run explicitly with --test-threads=1"]
    async fn service_resource_snapshot_matches_catalog_and_reserved_instances() {
        let (dir, host, request) = fixture().await;
        std::fs::copy(
            dir.path().join("models/model.ginfer"),
            dir.path().join("models/second.ginfer"),
        )
        .unwrap();
        host.scan().await.unwrap();
        let models = host.inventory.read().await.clone();
        let mut catalog = Vec::new();
        for index in 0..174 {
            let mut profile: crate::launch_profiles::LaunchProfile = serde_json::from_value(serde_json::json!({
                "id":format!("fixture-{index}"), "name":"Synthetic resource fixture", "platform":std::env::consts::OS,
                "identity":models[0].metadata.identity, "artifact_sha256":"a".repeat(64), "artifact_bytes":4096,
                "tp":1, "draft_tp":0, "gpu_name":"Fixture GPU", "compute_capability":"12.0", "vram_tier_gib":32,
                "min_memory_mib_per_gpu":32768, "max_context":8192, "concurrency":1, "options":{},
                "qualification":{"tier":"full-context-tested", "evidence":"synthetic fixture only", "engine_revision":"fixture", "free_bytes_per_gpu":1_u64 << 30, "full_context_requests":1}
            })).unwrap();
            match index { 0 => profile.tp = 2, 1 => profile.artifact_bytes = 8192, 2 => profile.identity.weights_id = "groupwise-int".into(), _ => {} }
            catalog.push(profile);
        }
        *host.launch_profiles.write().await = catalog.clone();
        let hardware = host.processes.lock().await.hardware_profile.clone();
        // Synthetic children measure projection without hardware admission.
        let mut synthetic = HostProcesses::new(
            dir.path().join("ginfer-serve"),
            host.gpus.iter().map(|gpu| gpu.uuid.clone()).collect(),
            Duration::from_secs(600),
        ).unwrap();
        synthetic.configure_runtimes(Default::default(), host.gpus.iter().filter_map(|gpu| {
            gpu.compute_capability.as_ref().map(|sm| (gpu.uuid.clone(), sm.clone()))
        }).collect()).unwrap();
        let mut ids = Vec::new();
        for index in 0..4 {
            let mut request = request.clone();
            request.gpu_uuids = vec![format!("GPU-fixture-{index}")];
            let prepared = host.prepare_launch(&request).await.unwrap();
            let id = prepared.instance_id;
            synthetic.launch(prepared).unwrap();
            request.instance_id = Some(id);
            host.data.lock().await.profiles.insert(id, request);
            ids.push(id);
        }
        synthetic.hardware_profile = hardware;
        *host.processes.lock().await = synthetic;
        let offline_id = Uuid::new_v4();
        let mut offline = request.clone();
        offline.instance_id = Some(offline_id);
        offline.gpu_uuids = vec!["GPU-offline".into()];
        host.data.lock().await.profiles.insert(offline_id, offline.clone());
        let reserved = host.processes.lock().await.reserved_gpus(None);
        let mut expected = Vec::new();
        for profile in &catalog {
            for model in models.iter().filter(|model| profile.matches_model(model)) {
                expected.push(serde_json::json!({
                    "profile":profile, "model_id":model.id, "gpu_groups":profile.gpu_groups(&host.gpus, &reserved),
                    "compatible_gpu_groups":profile.gpu_groups(&host.gpus, &Default::default()),
                }));
            }
        }
        let measurement = crate::resource_measurement::Measurement::start();
        let snapshot = host.snapshot().await;
        measurement.finish("service_resource_snapshot_174_profiles_4_instances");
        host.processes.lock().await.shutdown().await.unwrap();
        assert_eq!(snapshot["launch_profiles"], serde_json::json!(expected));
        assert_eq!(snapshot["models"], serde_json::json!(models));
        assert_eq!(snapshot["max_perf_profiles"], serde_json::json!([]));
        assert_eq!(snapshot["model_management"]["engine_presets_available"], !expected.is_empty());
        let instances = snapshot["instances"].as_array().unwrap();
        assert_eq!(instances.len(), 5);
        let stopped = instances.iter().find(|instance| instance["instance_id"] == offline_id.to_string()).unwrap();
        assert_eq!(stopped["status"], "stopped");
        assert!(stopped["session_id"].is_null());
        assert_eq!(stopped["profile"], serde_json::to_value(offline).unwrap());
        for id in ids {
            let instance = instances.iter().find(|instance| instance["instance_id"] == id.to_string()).unwrap();
            assert_eq!(instance["status"], "starting");
            assert!(instance["session_id"].is_string());
            assert_eq!(instance["profile"]["model_id"], request.model_id.to_string());
        }
    }

    #[tokio::test]
    #[ignore = "global allocation measurement; run explicitly with --test-threads=1"]
    async fn service_resource_stop_waits_for_final_stream_and_force_keeps_leases() {
        let (_dir, host, request) = fixture().await;
        let id = host.launch(request.clone()).await.unwrap();
        let port = host.processes.lock().await.instances().find(|i| i.instance_id == id).unwrap().launch.port;
        let senders = Arc::new(std::sync::Mutex::new(Vec::<hyper::body::Sender>::new()));
        let serve = |port| {
        let capture = senders.clone();
        let upstream = hyper::Server::bind(&([127, 0, 0, 1], port).into()).serve(hyper::service::make_service_fn(move |_| {
            let capture = capture.clone();
            async move { Ok::<_, std::convert::Infallible>(hyper::service::service_fn(move |req: Request<Body>| {
                let capture = capture.clone();
                async move {
                    let body = match req.uri().path() {
                        "/health" => Body::from("{}"),
                        "/v1/models" => Body::from(serde_json::json!({"data":[{"id":"muse-glimmer-30b/nvfp4"}]}).to_string()),
                        _ => { let (sender, body) = Body::channel(); capture.lock().unwrap().push(sender); body }
                    };
                    Ok::<_, std::convert::Infallible>(Response::new(body))
                }
            })) }
        }));
            tokio::spawn(upstream)
        };
        let server = serve(port);
        host.refresh_processes().await.unwrap();
        let token = host.data.lock().await.pairing_admin_token.clone();
        let inference = || {
            Request::post(format!(
                "/host/v1/instances/{id}/inference/v1/chat/completions"
            ))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from("{}"))
            .unwrap()
        };
        let first = host.clone().route(inference()).await.unwrap();
        let second = host.clone().route(inference()).await.unwrap();
        let stop = Request::post(format!("/host/v1/instances/{id}/stop"))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from("{}"))
            .unwrap();
        let mut stopping = Box::pin(host.clone().route(stop));
        let polls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let capture = polls.clone();
        let measurement = crate::resource_measurement::Measurement::start();
        let mut stopping = tokio::spawn(futures_util::future::poll_fn(move |cx| {
            capture.fetch_add(1, Ordering::SeqCst);
            stopping.as_mut().poll(cx)
        }));
        tokio::time::sleep(Duration::from_millis(120)).await;
        let draining = host.clone().route(inference()).await.unwrap();
        drop(first);
        tokio::time::sleep(Duration::from_millis(120)).await;
        let waiting_for_second = !stopping.is_finished();
        drop(second);
        let released = tokio::time::Instant::now();
        let outcome = tokio::time::timeout(Duration::from_secs(3), &mut stopping).await;
        if outcome.is_err() {
            stopping.abort();
            let _ = stopping.await;
        }
        let release_ns = released.elapsed().as_nanos();
        measurement.finish("service_resource_stop_two_withheld_streams");
        println!("RESOURCE_DRAIN polls={} withheld_ms=240 final_release_ns={release_ns}", polls.load(Ordering::SeqCst));
        let after = host.snapshot().await;
        server.abort();
        let _ = server.await;
        let start = Request::post(format!("/host/v1/instances/{id}/start"))
            .header("authorization", format!("Bearer {token}")).body(Body::from("{}")).unwrap();
        let started = host.clone().route(start).await.unwrap();
        let port = host.processes.lock().await.instances().find(|i| i.instance_id == id).unwrap().launch.port;
        let server = serve(port);
        host.refresh_processes().await.unwrap();
        let first = host.clone().route(inference()).await.unwrap();
        let second = host.clone().route(inference()).await.unwrap();
        let force = Request::post(format!("/host/v1/instances/{id}/stop"))
            .header("authorization", format!("Bearer {token}")).body(Body::from("{\"force\":true}")).unwrap();
        let forced = tokio::time::timeout(Duration::from_secs(3), host.clone().route(force)).await;
        let after_force = host.snapshot().await;
        drop(first);
        drop(second);
        host.processes.lock().await.shutdown().await.unwrap();
        server.abort();
        let _ = server.await;
        assert_eq!(draining.status(), StatusCode::BAD_REQUEST);
        assert!(waiting_for_second);
        assert_eq!(outcome.unwrap().unwrap().unwrap().status(), StatusCode::OK);
        assert_eq!(after["instances"][0]["status"], "stopped");
        assert_eq!(after["instances"][0]["active_requests"], 0);
        assert_eq!(started.status(), StatusCode::OK);
        assert_eq!(forced.unwrap().unwrap().status(), StatusCode::OK);
        assert_eq!(after_force["instances"][0]["status"], "stopped");
        assert_eq!(after_force["instances"][0]["active_requests"], 2);
        assert_ne!(after_force["instances"][0]["session_id"], after["instances"][0]["session_id"]);
    }
}

#[cfg(all(test, unix))]
mod lifecycle_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn write_engine_fixture(engine: &Path) {
        std::fs::write(engine, r#"#!/usr/bin/env python3
import http.server, json, pathlib, sys, time
args = sys.argv[1:]
def arg(name): return args[args.index(name)+1]
root = pathlib.Path(__file__).parent
if '--quote-only' in args:
    model, weights = arg('--model-id').split('/', 1)
    unknown = model == 'qwen3.8-flash-next' and '--no-cuda-graph' not in args
    graph = 0 if unknown else 1024
    print(json.dumps(dict(schema='ginfer-startup-quote-v1', model_id=model, weights_id=weights,
        tensor_parallel_size=1, ranks=[dict(rank=0, free_bytes=4294967296, weights_bytes=8192,
        state_bytes=2048, graph_allowance_bytes=graph,
        graph_allowance_source='unknown' if unknown else 'planner', minimum_kv_arena_bytes=1024,
        kv_arena_alignment_bytes=256, headroom_bytes=int(arg('--kv-arena-headroom-bytes')),
        startup_peak_bytes=11264+graph)])))
    sys.exit(0)
(root/'argv').write_text('\n'.join(args)+'\n')
(root/'argv-ready').touch()
if not (root/'serve-ready').exists():
    time.sleep(60)
    sys.exit(0)
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body=json.dumps(dict(data=[dict(id=arg('--model-id'))])).encode()
        self.send_response(200); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self,*args): pass
http.server.HTTPServer(('127.0.0.1',int(arg('--port'))),Handler).serve_forever()
"#).unwrap();
        std::fs::set_permissions(engine, std::fs::Permissions::from_mode(0o700)).unwrap();
    }

    #[tokio::test]
    async fn max_perf_profile_selection_persists_and_refuses_modified_or_stale_session() {
        for (model_id, weights_id, draft_tp) in [
            ("qwen3.8-flash-next", "smol-q2g64", 0),
            ("qwen3.8-27b", "groupwise-int-dflash2-q4", 1),
        ] {
            assert_max_perf_profile_session(model_id, weights_id, draft_tp).await;
        }
    }

    async fn assert_max_perf_profile_session(model_id: &str, weights_id: &str, draft_tp: u8) {
        let dense = draft_tp == 1;
        let dir = tempfile::tempdir().unwrap();
        let state = dir.path().join("state");
        let models = dir.path().join("models");
        std::fs::create_dir(&models).unwrap();
        let engine = dir.path().join("ginfer-serve");
        write_engine_fixture(&engine);
        super::write_selected_profile_fixture(&dir.path().join("ginfer"));
        let hardware = crate::hardware_profile::group_profile_path(&state, &["GPU-test".into()]);
        std::fs::create_dir_all(hardware.parent().unwrap()).unwrap();
        std::fs::write(hardware, br#"{"schema_version":2}"#).unwrap();
        let metadata = serde_json::json!({"identity":{"model_id":model_id,"weights_id":weights_id},
            "tp_size":1,"draft_tp":draft_tp,"objects":[{"kind":"tensor","rank":"all","name":"fixture"}]}).to_string();
        let mut artifact = b"NINFER\0\x03".to_vec();
        artifact.extend((metadata.len() as u64).to_le_bytes());
        artifact.extend(metadata.as_bytes());
        artifact.resize(4096, 0);
        let artifact_path = models.join("fixture.ginfer");
        std::fs::write(&artifact_path, artifact).unwrap();
        let gpus = vec![Gpu {uuid:"GPU-test".into(),name:"Fixture".into(),display_name:None,
            memory_mib:32768,compute_capability:Some("8.6".into())}];
        let host = Host::open(state.clone(), "Fixture".into(), engine.clone(), vec![models.clone()], vec![], gpus.clone()).await.unwrap();
        let available = host.snapshot().await;
        assert!(available["launch_profiles"].as_array().unwrap().is_empty());
        assert_eq!(available["max_perf_profiles"].as_array().unwrap().len(), 1);
        let entry = &available["max_perf_profiles"][0];
        assert!(entry["profile"].get("qualification").is_none());
        assert_eq!(entry["compatible_gpu_groups"], serde_json::json!([["GPU-test"]]));
        let token = host.data.lock().await.pairing_admin_token.clone();
        let selection = serde_json::json!({"profile_id":entry["profile"]["id"],
            "model_id":entry["model_id"],"gpu_uuids":["GPU-test"]});
        let response = host.clone().route(Request::post("/host/v1/profile-launch")
            .header("authorization",format!("Bearer {token}"))
            .body(Body::from(selection.to_string())).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let response: serde_json::Value = serde_json::from_slice(&hyper::body::to_bytes(response.into_body()).await.unwrap()).unwrap();
        let id: Uuid = serde_json::from_value(response["instance_id"].clone()).unwrap();
        let before = host.snapshot().await;
        let instance = &before["instances"][0];
        let reference = entry["profile"]["reference"].clone();
        assert_eq!(instance["configuration"]["benchmark_profile"], reference);
        assert_eq!(instance["profile"]["benchmark_profile"], reference);
        assert!(instance["profile"]["qualified_profile_id"].is_null());
        assert!(instance["profile"]["kv_arena_bytes"].is_null());
        assert!(instance["configuration"]["kv_arena_bytes"].is_null());
        tokio::time::timeout(Duration::from_secs(2), async {
            while !dir.path().join("argv-ready").is_file() { tokio::time::sleep(Duration::from_millis(10)).await; }
        }).await.unwrap();
        let argv = std::fs::read_to_string(dir.path().join("argv")).unwrap();
        let argv: Vec<_> = argv.lines().collect();
        assert_eq!(argv[0], artifact_path.to_str().unwrap());
        for pair in [["--max-context","8181"],["--max-concurrency","8"],["--tp","1"],
            ["--spec",if dense { "dflash" } else { "mtp" }],["--draft-policy","fixed"],
            ["--draft-tokens",if dense { "7" } else { "3" }],["--kv-dtype","int8"]] {
            assert!(argv.windows(2).any(|actual| actual == pair));
        }
        assert!(!argv.contains(&"--kv-arena-bytes"));
        for flag in ["--host-kv-cache-bytes","--prefill-chunk","--no-cuda-graph"] {
            assert!(!argv.contains(&flag));
        }
        assert!(argv.contains(&"--vision") && argv.contains(&"--structured-outputs"));
        let mut altered = instance["profile"].clone();
        altered["max_context"] = 8192.into();
        let response = host.clone().route(Request::post(format!("/host/v1/instances/{id}/reload"))
            .header("authorization",format!("Bearer {token}"))
            .body(Body::from(serde_json::json!({"configuration":altered,"expected_session_id":instance["session_id"]}).to_string())).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(host.snapshot().await["instances"][0]["session_id"], instance["session_id"]);
        let mut stale = selection.clone();
        stale["instance_id"] = id.to_string().into();
        stale["expected_session_id"] = Uuid::new_v4().to_string().into();
        let response = host.clone().route(Request::post("/host/v1/profile-launch")
            .header("authorization",format!("Bearer {token}"))
            .body(Body::from(stale.to_string())).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(host.snapshot().await["instances"][0]["session_id"], instance["session_id"]);
        let response = host.clone().route(Request::post(format!("/host/v1/instances/{id}/restart"))
            .header("authorization",format!("Bearer {token}"))
            .body(Body::from("{}")).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let restarted = host.snapshot().await;
        assert_ne!(restarted["instances"][0]["session_id"], instance["session_id"]);
        assert_eq!(restarted["instances"][0]["configuration"]["benchmark_profile"], reference);
        assert!(restarted["instances"][0]["profile"]["kv_arena_bytes"].is_null());
        assert!(restarted["instances"][0]["configuration"]["kv_arena_bytes"].is_null());
        let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(state.join("host.json")).unwrap()).unwrap();
        assert_eq!(saved["profiles"][id.to_string()]["benchmark_profile"], reference);
        assert!(saved["profiles"][id.to_string()]["kv_arena_bytes"].is_null());
        let response = host.clone().route(Request::post(format!("/host/v1/instances/{id}/stop"))
            .header("authorization",format!("Bearer {token}"))
            .body(Body::from("{}")).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        host.shutdown_hardware_profile().await.unwrap();
        drop(host);
        let reopened = Host::open(state, "Fixture".into(), engine, vec![models], vec![], gpus).await.unwrap();
        let snapshot = reopened.snapshot().await;
        assert_eq!(snapshot["instances"][0]["status"], "stopped");
        assert_eq!(snapshot["instances"][0]["profile"]["benchmark_profile"], reference);
        if dense {
            // An explicit custom arena clears the Max Perf session marker.
            let mut custom = selection.clone();
            custom["instance_id"] = id.to_string().into();
            custom["kv_arena_bytes"] = 4096.into();
            let response = reopened.clone().route(Request::post("/host/v1/profile-launch")
                .header("authorization",format!("Bearer {token}"))
                .body(Body::from(custom.to_string())).unwrap()).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let custom = reopened.snapshot().await;
            assert!(custom["instances"][0]["configuration"]["benchmark_profile"].is_null());
            assert!(custom["instances"][0]["profile"]["benchmark_profile"].is_null());
            assert_eq!(custom["instances"][0]["configuration"]["kv_arena_bytes"], 4096);
            reopened.processes.lock().await.shutdown().await.unwrap();
        }
        reopened.shutdown_hardware_profile().await.unwrap();
    }

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
        let engine = dir.path().join("ginfer-serve");
        write_engine_fixture(&engine);
        super::write_selected_profile_fixture(&dir.path().join("ginfer"));
        for gpu in ["GPU-test", "GPU-second"] {
            let path = crate::hardware_profile::group_profile_path(
                &dir.path().join("state"), &[gpu.to_owned()],
            );
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, br#"{"schema_version":2}"#).unwrap();
        }
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
            benchmark_profile: None,
            instance_id: None,
            qualified_profile_id: None,
            model_id: host.inventory.read().await[0].id,
            gpu_uuids: vec!["GPU-test".into()],
            max_context: 8192,
            concurrency: 1,
            options: LaunchOptions::default(),
        };
        // Calibrate both synthetic GPU groups while idle, before either owns a child.
        {
            let mut second = profile.clone();
            second.gpu_uuids = vec!["GPU-second".into()];
            let _lifecycle = host.lifecycle.lock().await;
            let launch = host.prepare_launch(&second).await.unwrap();
            host.ensure_selected_profile(&launch).await.unwrap();
        }
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
        tokio::time::timeout(
            Duration::from_millis(500),
            wait_for_stage(&mut arrivals, "health", [id, second_id]),
        )
        .await
        .unwrap();
        let snapshot = tokio::time::timeout(Duration::from_millis(500), host.snapshot())
            .await
            .unwrap();
        assert_eq!(snapshot["instances"][0]["status"], "starting");
        assert_eq!(snapshot["instances"][1]["status"], "starting");
        assert!(!refresh.is_finished());
        let stop = Request::post(format!("/host/v1/instances/{id}/stop"))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(
                serde_json::json!({"expected_session_id":session}).to_string(),
            ))
            .unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(500), host.clone().route(stop))
                .await
                .unwrap()
                .unwrap()
                .status()
                .is_success()
        );
        for gate in health_gates {
            gate.add_permits(1);
        }
        tokio::time::timeout(
            Duration::from_millis(500),
            wait_for_stage(&mut arrivals, "models", [id, second_id]),
        )
        .await
        .unwrap();
        let reload = Request::post(format!("/host/v1/instances/{second_id}/reload"))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(
                serde_json::json!({"expected_session_id":second_session}).to_string(),
            ))
            .unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(500), host.clone().route(reload))
                .await
                .unwrap()
                .unwrap()
                .status()
                .is_success()
        );
        assert!(!refresh.is_finished());
        for gate in model_gates {
            gate.add_permits(1);
        }
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
        assert_eq!(snapshot["instances"][0]["profile"]["qualified_profile_id"], qualified.id);
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
        let mut recorded = serde_json::to_value(&qualified).unwrap();
        recorded["options"].as_object_mut().unwrap().remove("structured_outputs");
        let recorded: crate::launch_profiles::LaunchProfile = serde_json::from_value(recorded).unwrap();
        assert!(!recorded.options.structured_outputs);
        *host.launch_profiles.write().await = vec![recorded.clone()];
        assert!(host.clone().route(switch()).await.unwrap().status().is_success());
        let default_on = host.snapshot().await;
        assert_eq!(default_on["instances"][0]["configuration"]["structured_outputs"], true);
        assert!(default_on["instances"][0]["profile"]["qualified_profile_id"].is_null());
        *host.launch_profiles.write().await = vec![qualified.clone()];
        let mut override_selection = selection.clone();
        override_selection["structured_outputs"] = false.into();
        let override_request = || Request::post("/host/v1/profile-launch")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(override_selection.to_string()))
            .unwrap();
        assert!(host.clone().route(override_request()).await.unwrap().status().is_success());
        let overridden = host.snapshot().await;
        assert!(overridden["instances"][0]["profile"]["qualified_profile_id"].is_null());
        assert_eq!(overridden["instances"][0]["configuration"]["structured_outputs"], false);
        assert!(overridden["instances"][0]["configuration"]["host_kv_cache_bytes"].is_null());
        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.path().join("state/host.json")).unwrap())
                .unwrap();
        assert_eq!(saved["profiles"][id.to_string()]["structured_outputs"], false);
        assert!(saved["profiles"][id.to_string()]["host_kv_cache_bytes"].is_null());
        let restart = Request::post(format!("/host/v1/instances/{id}/restart"))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from("{}"))
            .unwrap();
        assert!(host.clone().route(restart).await.unwrap().status().is_success());
        let snapshot = host.snapshot().await;
        assert_eq!(snapshot["instances"][0]["configuration"]["structured_outputs"], false);
        assert!(snapshot["instances"][0]["configuration"]["host_kv_cache_bytes"].is_null());
        assert!(snapshot["instances"][0]["profile"]["qualified_profile_id"].is_null());
        session = snapshot["instances"][0]["session_id"].clone();
        qualified.artifact_sha256 = "0".repeat(64);
        *host.launch_profiles.write().await = vec![qualified];
        assert!(!host
            .clone()
            .route(override_request())
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
            data.profiles.get_mut(&id).unwrap().qualified_profile_id = Some(recorded.id.clone());
            let mut duplicate = data.profiles[&id].clone();
            duplicate.instance_id = Some(duplicate_id);
            data.profiles.insert(duplicate_id, duplicate);
        }
        host.save().await.unwrap();
        let restored = Host::open(
            dir.path().join("state"),
            "Test".into(),
            engine.clone(),
            vec![models.clone()],
            vec![],
            gpus.clone(),
        )
        .await
        .unwrap();
        let snapshot = restored.snapshot().await;
        assert_eq!(snapshot["instances"][0]["instance_id"], id.to_string());
        assert_eq!(snapshot["instances"][0]["status"], "stopped");
        assert!(snapshot["instances"][0]["session_id"].is_null());
        assert_eq!(snapshot["instances"][0]["profile"]["max_context"], 8192);
        assert_eq!(snapshot["instances"].as_array().unwrap().len(), 2);
        assert_eq!(snapshot["instances"][1]["instance_id"], duplicate_id.to_string());
        assert!(!dir.path().join("state/retired-instance-records.json").exists());
        *restored.launch_profiles.write().await = vec![recorded];
        assert_eq!(snapshot["instances"][0]["profile"]["structured_outputs"], false);
        assert_eq!(snapshot["instances"][0]["profile"]["qualified_profile_id"], "fixture-c4");
        let start = Request::post(format!("/host/v1/instances/{id}/start"))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from("{}"))
            .unwrap();
        assert!(restored.clone().route(start).await.unwrap().status().is_success());
        assert_eq!(restored.snapshot().await["instances"][0]["configuration"]["structured_outputs"], false);
        restored.processes.lock().await.shutdown().await.unwrap();
        let path = dir.path().join("state/host.json");
        let mut legacy: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        legacy["profiles"][id.to_string()].as_object_mut().unwrap().remove("structured_outputs");
        std::fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        drop(restored);
        let restored = Host::open(
            dir.path().join("state"), "Test".into(), engine, vec![models], vec![], gpus,
        ).await.unwrap();
        let upgraded = restored.snapshot().await;
        assert_eq!(upgraded["instances"][0]["profile"]["structured_outputs"], true);
        assert!(upgraded["instances"][0]["profile"]["qualified_profile_id"].is_null());
        let persisted: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(persisted["profiles"][id.to_string()]["structured_outputs"], true);
        assert!(persisted["profiles"][id.to_string()]["qualified_profile_id"].is_null());
        let restart = Request::post(format!("/host/v1/instances/{id}/restart"))
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from("{}"))
            .unwrap();
        assert!(restored.clone().route(restart).await.unwrap().status().is_success());
        assert_eq!(restored.snapshot().await["instances"][0]["configuration"]["structured_outputs"], true);
        restored.processes.lock().await.shutdown().await.unwrap();
        std::fs::write(dir.path().join("serve-ready"), b"").unwrap();
        let mut replacement = profile.clone();
        replacement.concurrency = 2;
        let fresh = restored.prepare_launch(&replacement).await.unwrap();
        let fresh_id = fresh.instance_id;
        assert_ne!(fresh_id, id);
        restored.start_prepared(replacement.clone(), fresh, 1).await.unwrap();
        assert_eq!(restored.data.lock().await.profiles.len(), 3);
        let peer = restored.prepare_launch(&replacement).await.unwrap();
        let peer_id = peer.instance_id;
        assert_ne!(fresh_id, peer_id);
        restored.start_prepared(replacement.clone(), peer, 1).await.unwrap();
        assert_eq!(restored.data.lock().await.profiles.len(), 4);
        replacement.instance_id = Some(fresh_id);
        assert!(restored.launch(replacement).await.is_err());
        restored.processes.lock().await.shutdown().await.unwrap();
        serde_json::from_value::<crate::engine_registry::HostSnapshot>(snapshot).unwrap();
    }
}
/// Reject hosted-tool and output declarations that the native protocols cannot honor.
/// Client function tools (including configured GChat MCP connectors) remain supported.
pub fn validate_inference_request(suffix: &str, body: &serde_json::Value) -> Result<(), String> {
    let path = suffix.trim_start_matches('/').trim_start_matches("v1/");
    if !matches!(path, "chat/completions" | "chat/completions/count_tokens" | "messages" | "messages/count_tokens" | "responses" | "responses/input_tokens" | "responses/compact") {
        return Ok(());
    }
    for key in ["mcp_servers", "retrieval", "file_search", "web_search", "audio", "output_format"] {
        if body.get(key).is_some_and(|value| !value.is_null()) {
            return Err(format!("{key} is not supported by native GInfer"));
        }
    }
    if let Some(modalities) = body.get("modalities").filter(|value| !value.is_null()) {
        if !modalities.as_array().is_some_and(|values| values.iter().all(|value| value.as_str() == Some("text"))) {
            return Err("modalities supports only text output; audio output is not supported".into());
        }
    }
    let messages = path.starts_with("messages");
    let responses = path.starts_with("responses");
    if messages && body.get("tool_choice")
        .and_then(|choice| choice.get("disable_parallel_tool_use"))
        .is_some_and(|value| !value.is_null() && value.as_bool() != Some(false))
    {
        return Err("tool_choice.disable_parallel_tool_use is not supported by native GInfer; parallel tool calls cannot be disabled".into());
    }
    for (key, supported) in [("response_format", !messages && !responses), ("output_config", messages), ("text", responses)] {
        if !supported && body.get(key).is_some_and(|value| !value.is_null()) {
            return Err(format!("{key} is not supported on native /{path}; use this protocol's output-format field"));
        }
    }
    if let Some(tools) = body.get("tools").filter(|value| !value.is_null()) {
        let tools = tools.as_array().ok_or("tools must be an array")?;
        for (index, tool) in tools.iter().enumerate() {
            let kind = tool.get("type").and_then(serde_json::Value::as_str);
            let supported = if messages {
                tool.is_object() && (tool.get("type").is_none() || kind == Some("custom"))
            } else {
                kind == Some("function") || (responses && kind == Some("namespace"))
            };
            if !supported {
                return Err(format!("tools[{index}].type {} is not supported; native inference supports client function tools, not server hosted tools", tool.get("type").unwrap_or(&serde_json::Value::Null)));
            }
            if messages && tool.get("strict").is_some_and(|value| !value.is_null() && value.as_bool() != Some(false)) {
                return Err(format!("tools[{index}].strict is not supported; strict function schema enforcement is unavailable"));
            }
        }
    }
    Ok(())
}

fn inference_body(bytes: Vec<u8>, model: Option<&str>, suffix: &str) -> Result<Vec<u8>, String> {
    use serde_json::value::{to_raw_value, RawValue};
    let mut fields: BTreeMap<String, &RawValue> = serde_json::from_slice(&bytes).map_err(|error| {
        if error.is_data() {
            "inference body must be a JSON object".to_owned()
        } else {
            error.to_string()
        }
    })?;
    // Parse only capability declarations; preserve large input arrays, exact numbers,
    // and property order in the original raw fields during the model rewrite.
    let mut controls = serde_json::Map::new();
    for key in ["mcp_servers", "retrieval", "file_search", "web_search", "audio", "modalities", "output_format", "response_format", "output_config", "text", "tools", "tool_choice"] {
        if let Some(value) = fields.get(key) {
            controls.insert(key.into(), serde_json::from_str(value.get()).map_err(|error| error.to_string())?);
        }
    }
    validate_inference_request(suffix, &serde_json::Value::Object(controls))?;
    let Some(model) = model else {
        return Ok(bytes);
    };
    let model = to_raw_value(model).map_err(|error| error.to_string())?;
    // Input size plus the encoded model and its key bounds the rewritten object.
    let capacity = bytes.len().checked_add(model.get().len())
        .and_then(|size| size.checked_add(9))
        .ok_or_else(|| "inference body size overflow".to_owned())?;
    fields.insert("model".to_owned(), &model);
    let mut output = Vec::with_capacity(capacity);
    serde_json::to_writer(&mut output, &fields).map_err(|error| error.to_string())?;
    Ok(output)
}
async fn bounded_body(req: &mut Request<Body>, limit: usize) -> Result<Vec<u8>, String> {
    use hyper::body::HttpBody;
    let capacity = req.body().size_hint().exact()
        .filter(|size| *size <= limit as u64)
        .map_or(0, |size| size as usize);
    let mut bytes = Vec::with_capacity(capacity);
    while let Some(chunk) = req.body_mut().data().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if bytes.len() + chunk.len() > limit {
            return Err("request exceeds host body limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
