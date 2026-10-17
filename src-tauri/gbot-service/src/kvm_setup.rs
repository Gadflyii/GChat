//! Product-owned, resumable setup of a separate Linux guest. No host installation.
use crate::{
    contract::*,
    kvm::{GuestBinary, KvmSpec, KvmTools, PreparedVm, VmState, CUA_DRIVER_REVISION, CUA_REVISION},
    service::Service,
    store::Store,
    vault::{Secret, Vault},
    workspace::WorkspaceRuntime,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Weak,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    fs,
    process::Command,
    sync::{watch, Mutex, Notify},
};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SetupIssue {
    pub code: String,
    pub message: String,
    pub next_action: String,
}
impl SetupIssue {
    pub(crate) fn new(code: &str, message: impl Into<String>, action: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            next_action: action.into(),
        }
    }
}
impl std::fmt::Display for SetupIssue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}", self.message, self.next_action)
    }
}
impl std::error::Error for SetupIssue {}
fn persistence(_: impl std::fmt::Display) -> SetupIssue {
    SetupIssue::new(
        "setup_persistence",
        "The setup record could not be saved.",
        "Check that the GChat data folder is writable, then retry this setup.",
    )
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SetupStage {
    CheckingPc,
    PreparingComputer,
    StartingComputer,
    Connecting,
    TestingDesktop,
    Ready,
    Removing,
    Removed,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupRecord {
    pub id: WorkspaceId,
    pub name: String,
    pub service_id: Uuid,
    pub credential_ref: VaultCredentialRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_model_credential: Option<VaultCredentialRef>,
    pub identity: SessionIdentity,
    pub stage: SetupStage,
    #[serde(default)]
    pub resume_on_start: bool,
    pub issue: Option<SetupIssue>,
    pub spec: Option<KvmSpec>,
    pub pinned_host_key: Option<SshHostPublicKey>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StartSetup {
    pub id: WorkspaceId,
    pub name: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupId {
    pub id: WorkspaceId,
}
#[derive(Serialize)]
pub struct Preflight {
    pub ready: bool,
    pub issues: Vec<SetupIssue>,
    pub cpus: u16,
    pub memory_mib: u32,
    pub disk_gib: u32,
}

#[derive(Clone)]
struct Assets {
    image: PathBuf,
    driver: PathBuf,
    media: PathBuf,
    image_pin: String,
    driver_pin: String,
    media_pin: String,
}
impl Assets {
    fn at(root: &Path) -> Self {
        let root = root.join("assets");
        let assets = crate::guest_assets::accepted();
        Self {
            image: root.join(&assets[0].filename),
            driver: root.join(&assets[1].filename),
            media: root.join(&assets[2].filename),
            image_pin: assets[0].digest.clone(),
            driver_pin: assets[1].digest.clone(),
            media_pin: assets[2].digest.clone(),
        }
    }
    async fn check(&self) -> Vec<SetupIssue> {
        let mut issues = Vec::new();
        for (path, tool, pin) in [
            (&self.image, "sha512sum", &self.image_pin),
            (&self.driver, "sha256sum", &self.driver_pin),
            (&self.media, "sha256sum", &self.media_pin),
        ] {
            if !path.is_file() {
                issues.push(SetupIssue::new("asset_missing", format!("The approved guest asset {} is missing.", path.display()), format!("Stage the accepted pinned release asset at {} and retry. Install the GChat release containing its pinned guest resources, or stage these accepted assets locally. This setup does not download assets.", path.display())));
                continue;
            }
            match Command::new(tool).arg(path).output().await {
                Ok(output)
                    if output.status.success()
                        && String::from_utf8_lossy(&output.stdout)
                            .split_whitespace()
                            .next()
                            == Some(pin.as_str()) => {}
                Ok(_) => issues.push(SetupIssue::new(
                    "asset_mismatch",
                    format!(
                        "{} does not match the accepted artifact digest.",
                        path.display()
                    ),
                    "Replace it with the accepted pinned release asset, then retry.",
                )),
                Err(_) => issues.push(SetupIssue::new(
                    "tool_missing",
                    format!("{tool} is unavailable."),
                    format!("Install the host checksum utility {tool} yourself, then retry."),
                )),
            }
        }
        issues
    }
}

pub struct KvmSetup {
    root: PathBuf,
    store: Arc<Store>,
    records: Mutex<BTreeMap<WorkspaceId, SetupRecord>>,
    jobs: Mutex<BTreeSet<WorkspaceId>>,
    lifecycle: Mutex<BTreeMap<WorkspaceId, Arc<Mutex<()>>>>,
    renewals: Mutex<()>,
    service: Arc<Service>,
    vault: Arc<dyn Vault>,
    runtime: Weak<WorkspaceRuntime>,
    tools: KvmTools,
    assets: Assets,
    kvm_device: PathBuf,
    stopping: AtomicBool,
    cancellations: Mutex<BTreeSet<WorkspaceId>>,
    cancel_update: Notify,
    updates: watch::Sender<u64>,
}
impl KvmSetup {
    pub async fn open(
        root: PathBuf,
        service: Arc<Service>,
        vault: Arc<dyn Vault>,
        runtime: Weak<WorkspaceRuntime>,
    ) -> Result<Self, SetupIssue> {
        let store = Arc::new(
            Store::open(root.join("kvm-setups.json"))
                .await
                .map_err(persistence)?,
        );
        let saved: Vec<SetupRecord> = store.load().await.map_err(persistence)?.unwrap_or_default();
        let service_id = service.snapshot().await.service_id;
        let mut records = BTreeMap::new();
        for mut record in saved {
            if record.stage == SetupStage::Ready {
                record.resume_on_start = true;
                record.stage = SetupStage::CheckingPc;
                record.issue = Some(SetupIssue::new(
                    "computer_reconnecting",
                    "Gbot is reconnecting this saved computer.",
                    "Wait for its readiness check; setup errors will appear here.",
                ));
            }
            if record.id.validate().is_err()
                || record.identity.validate().is_err()
                || record.credential_ref.validate().is_err()
                || record.identity.workspace_id != record.id
                || record.service_id != service_id
                || record
                    .spec
                    .as_ref()
                    .is_some_and(|spec| spec.id != record.id.as_uuid())
                || records.insert(record.id, record).is_some()
            {
                return Err(persistence("invalid setup identity"));
            }
        }
        store
            .save(&records.values().collect::<Vec<_>>())
            .await
            .map_err(persistence)?;
        let root = root.join("vms");
        fs::create_dir_all(&root).await.map_err(persistence)?;
        let root = fs::canonicalize(root).await.map_err(persistence)?;
        let (updates, _) = watch::channel(0);
        Ok(Self {
            assets: Assets::at(&root),
            root,
            store,
            records: Mutex::new(records),
            jobs: Mutex::new(BTreeSet::new()),
            lifecycle: Mutex::new(BTreeMap::new()),
            renewals: Mutex::new(()),
            service,
            vault,
            runtime,
            tools: KvmTools::default(),
            kvm_device: "/dev/kvm".into(),
            stopping: AtomicBool::new(false),
            cancellations: Mutex::new(BTreeSet::new()),
            cancel_update: Notify::new(),
            updates,
        })
    }
    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.updates.subscribe()
    }
    pub async fn status(&self) -> Vec<SetupRecord> {
        self.records.lock().await.values().cloned().collect()
    }
    pub async fn resume_saved(self: &Arc<Self>) -> Result<(), SetupIssue> {
        for record in self.status().await {
            if record.resume_on_start
                && record.stage != SetupStage::Removing
                && record.stage != SetupStage::Removed
            {
                self.start(StartSetup {
                    id: record.id,
                    name: record.name,
                })
                .await?;
            }
        }
        Ok(())
    }
    pub(crate) async fn ensure_ready(
        &self,
        id: WorkspaceId,
    ) -> Result<(), crate::workspace::WorkspaceError> {
        if self
            .records
            .lock()
            .await
            .get(&id)
            .is_some_and(|record| record.stage != SetupStage::Ready)
        {
            return Err(crate::workspace::WorkspaceError::SetupIncomplete);
        }
        Ok(())
    }
    async fn save(&self, record: SetupRecord) -> Result<(), SetupIssue> {
        let mut records = self.records.lock().await;
        let mut next = records.clone();
        next.insert(record.id, record);
        self.store
            .save(&next.values().collect::<Vec<_>>())
            .await
            .map_err(persistence)?;
        *records = next;
        self.updates
            .send_modify(|version| *version = version.wrapping_add(1));
        Ok(())
    }
    async fn lock(&self, id: WorkspaceId) -> Arc<Mutex<()>> {
        self.lifecycle
            .lock()
            .await
            .entry(id)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
    pub async fn preflight(&self) -> Preflight {
        let mut issues = Vec::new();
        if std::thread::available_parallelism().map_or(true, |count| count.get() < 2) {
            issues.push(SetupIssue::new(
                "cpu_unavailable",
                "This PC has fewer than two available CPU threads.",
                "Provide two available CPU threads before creating the guest.",
            ));
        }
        let memory = fs::read_to_string("/proc/meminfo")
            .await
            .unwrap_or_default();
        let available = memory
            .lines()
            .find_map(|line| {
                line.strip_prefix("MemAvailable:")
                    .and_then(|value| value.split_whitespace().next()?.parse::<u64>().ok())
            })
            .unwrap_or(0);
        if available < 4096 * 1024 {
            issues.push(SetupIssue::new(
                "memory_unavailable",
                "Less than 4 GiB of host memory is available for the guest.",
                "Free at least 4 GiB of memory, then retry.",
            ));
        }
        match Command::new("df")
            .args(["-Pk"])
            .arg(&self.root)
            .output()
            .await
        {
            Ok(output)
                if output.status.success()
                    && String::from_utf8_lossy(&output.stdout)
                        .lines()
                        .last()
                        .and_then(|line| line.split_whitespace().nth(3)?.parse::<u64>().ok())
                        .is_some_and(|available| available >= 40 * 1024 * 1024) => {}
            _ => issues.push(SetupIssue::new(
                "disk_unavailable",
                "The owned VM folder has not proved 40 GiB of free disk space.",
                "Free 40 GiB on the GChat data volume and ensure df is available, then retry.",
            )),
        }
        if !Command::new("qemu-system-x86_64")
            .arg("--version")
            .output()
            .await
            .is_ok_and(|output| output.status.success())
        {
            issues.push(SetupIssue::new(
                "qemu_unavailable",
                "The x86-64 QEMU emulator is unavailable.",
                "Install the host qemu-system-x86 package yourself and retry.",
            ));
        }
        if !cfg!(all(target_os = "linux", target_arch = "x86_64")) {
            issues.push(SetupIssue::new(
                "unsupported_host",
                "Local KVM setup requires Linux x86-64.",
                "Use a supported Linux service PC; Hyper-V setup is unfinished.",
            ));
        }
        if std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&self.kvm_device)
            .is_err()
        {
            issues.push(SetupIssue::new("kvm_unavailable", "KVM is unavailable to the GChat service user.", "Enable virtualization in firmware, load the host KVM module and grant this user access to /dev/kvm, then sign in again and retry."));
        }
        for (path, package) in [
            (
                &self.tools.virsh,
                "libvirt-clients and the libvirt QEMU session driver",
            ),
            (&self.tools.image, "qemu-utils"),
            (&self.tools.seed_iso, "genisoimage"),
        ] {
            if !Command::new(path)
                .arg("--version")
                .output()
                .await
                .is_ok_and(|output| output.status.success())
            {
                issues.push(SetupIssue::new("tool_missing", format!("{} is unavailable.", path.display()), format!("Install {package} yourself and retry. GChat does not install host packages.")));
            }
        }
        match Command::new(&self.tools.virsh).args(["--connect", "qemu:///session", "list", "--all", "--uuid"]).output().await {
            Ok(output) if output.status.success() => {},
            _ => issues.push(SetupIssue::new("libvirt_unavailable", "The user's libvirt QEMU session is unavailable.", "Enable the per-user libvirt QEMU session and verify virsh --connect qemu:///session list --all, then retry.")),
        }
        issues.extend(self.assets.check().await);
        Preflight {
            ready: issues.is_empty(),
            issues,
            cpus: 2,
            memory_mib: 4096,
            disk_gib: 40,
        }
    }
    pub async fn start(self: &Arc<Self>, input: StartSetup) -> Result<SetupRecord, SetupIssue> {
        if self.stopping.load(Ordering::Acquire) {
            return Err(SetupIssue::new(
                "service_stopping",
                "The service is stopping.",
                "Reopen GChat and resume this setup.",
            ));
        }
        if input.id.validate().is_err() || input.name.trim().is_empty() {
            return Err(SetupIssue::new(
                "invalid_setup",
                "Enter a bot name and a valid setup identity.",
                "Return to the Name step.",
            ));
        }
        if self.jobs.lock().await.contains(&input.id) {
            if let Some(record) = self.records.lock().await.get(&input.id).cloned() {
                if record.name == input.name.trim() {
                    return Ok(record);
                }
                return Err(SetupIssue::new(
                    "setup_conflict",
                    "An active setup already owns this identity.",
                    "Resume its original name.",
                ));
            }
        }
        let lock = self.lock(input.id).await;
        let _guard = lock.lock().await;
        let existing = self.records.lock().await.get(&input.id).cloned();
        let record = match existing {
            Some(record)
                if record.name == input.name.trim() && record.stage != SetupStage::Removed =>
            {
                record
            }
            Some(_) => {
                return Err(SetupIssue::new(
                    "setup_conflict",
                    "This setup identity belongs to another or removed request.",
                    "Start a new setup or resume the original name.",
                ))
            }
            None => {
                if self
                    .service
                    .snapshot()
                    .await
                    .workspaces
                    .iter()
                    .any(|w| w.id == input.id)
                {
                    return Err(SetupIssue::new(
                        "workspace_conflict",
                        "This bot identity is already in use.",
                        "Choose a new bot setup.",
                    ));
                }
                let record = SetupRecord {
                    id: input.id,
                    name: input.name.trim().into(),
                    service_id: self.service.snapshot().await.service_id,
                    credential_ref: VaultCredentialRef::new(),
                    pending_model_credential: None,
                    identity: SessionIdentity {
                        workspace_id: input.id,
                        session_id: SessionId::new(),
                    },
                    stage: SetupStage::CheckingPc,
                    resume_on_start: false,
                    issue: None,
                    spec: None,
                    pinned_host_key: None,
                };
                self.save(record.clone()).await?;
                record
            }
        };
        self.cancellations.lock().await.remove(&record.id);
        if self.jobs.lock().await.insert(record.id) {
            let owner = self.clone();
            let record = record.clone();
            tokio::spawn(async move {
                let lock = owner.lock(record.id).await;
                let _guard = lock.lock().await;
                let mut record = record;
                if let Err(issue) = owner.advance(&mut record).await {
                    record.issue = Some(issue);
                    let _ = owner.save(record.clone()).await;
                }
                owner.jobs.lock().await.remove(&record.id);
            });
        }
        Ok(record)
    }
    async fn stage(&self, record: &mut SetupRecord, stage: SetupStage) -> Result<(), SetupIssue> {
        if stage != SetupStage::Removing
            && stage != SetupStage::Removed
            && (self.stopping.load(Ordering::Acquire)
                || self.cancellations.lock().await.contains(&record.id))
        {
            return Err(SetupIssue::new(
                "setup_cancelled",
                "Setup stopped before its next step.",
                "Resume this same setup, or remove its owned VM.",
            ));
        }
        record.stage = stage;
        match record.stage {
            SetupStage::Ready => record.resume_on_start = true,
            SetupStage::Removing | SetupStage::Removed => record.resume_on_start = false,
            _ => {}
        }
        record.issue = None;
        self.save(record.clone()).await
    }
    async fn advance(&self, record: &mut SetupRecord) -> Result<(), SetupIssue> {
        self.stage(record, SetupStage::CheckingPc).await?;
        let preflight = self.preflight().await;
        if let Some(issue) = preflight.issues.into_iter().next() {
            return Err(issue);
        }
        self.stage(record, SetupStage::PreparingComputer).await?;
        let secret = match self
            .vault
            .get(record.credential_ref.as_uuid())
            .await
            .map_err(|e| {
                SetupIssue::new(
                    "vault_unavailable",
                    e.to_string(),
                    "Unlock GChat's native vault, then retry.",
                )
            })? {
            Some(secret) => secret,
            None if record.spec.is_some() => return Err(SetupIssue::new(
                "credential_missing",
                "The owned guest key is missing from secure storage.",
                "Remove this setup's VM and start a new setup; do not replace the guest identity.",
            )),
            None => {
                let private = russh::keys::PrivateKey::random(
                    &mut russh::keys::key::safe_rng(),
                    russh::keys::Algorithm::Ed25519,
                )
                .map_err(persistence)?;
                let encoded = private
                    .to_openssh(russh::keys::ssh_key::LineEnding::LF)
                    .map_err(persistence)?;
                let bytes = encoded.as_bytes().to_vec();
                self.vault
                    .put(record.credential_ref.as_uuid(), Secret::new(bytes.clone()))
                    .await
                    .map_err(|e| {
                        SetupIssue::new(
                            "vault_unavailable",
                            e.to_string(),
                            "Unlock GChat's native vault, then retry.",
                        )
                    })?;
                Secret::new(bytes)
            }
        };
        let public = russh::keys::PrivateKey::from_openssh(secret.expose_secret())
            .and_then(|private| private.public_key().to_openssh())
            .map_err(persistence)?;
        if record.spec.is_none() {
            let port = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .map_err(persistence)?
                .local_addr()
                .map_err(persistence)?
                .port();
            record.spec = Some(KvmSpec {
                id: record.id.as_uuid(),
                cpus: 2,
                host_cpus: vec![],
                memory_mib: 4096,
                disk_gib: 40,
                ssh_port: port,
                ssh_public_key: public.clone(),
                browser_package: "chromium".into(),
                driver: GuestBinary::SeedArchive {
                    path: self.assets.driver.clone(),
                    sha256: self.assets.driver_pin.clone(),
                },
                driver_revision: CUA_DRIVER_REVISION.into(),
                media: GuestBinary::SeedArchive {
                    path: self.assets.media.clone(),
                    sha256: self.assets.media_pin.clone(),
                },
                media_revision: CUA_REVISION.into(),
            });
            self.save(record.clone()).await?;
        }
        let spec = record
            .spec
            .clone()
            .ok_or_else(|| persistence("missing spec"))?;
        if spec.ssh_public_key != public {
            return Err(SetupIssue::new(
                "credential_mismatch",
                "The vault key differs from the owned guest key.",
                "Restore this setup's original vault entry or remove the setup.",
            ));
        }
        let vm = PreparedVm::prepare(&self.root, &self.assets.image, spec, &self.tools)
            .await
            .map_err(|error| {
                SetupIssue::new(
                    "prepare_failed",
                    error.to_string(),
                    "Resolve the reported libvirt/disk error, then retry this same setup.",
                )
            })?;
        self.stage(record, SetupStage::StartingComputer).await?;
        if vm.start(&self.tools).await.map_err(|error| {
            SetupIssue::new(
                "start_failed",
                error.to_string(),
                "Check the owned libvirt guest and its saved SSH port, then retry.",
            )
        })? != VmState::Running
        {
            return Err(SetupIssue::new(
                "start_failed",
                "The owned guest is not running.",
                "Check its libvirt state and retry.",
            ));
        }
        self.stage(record, SetupStage::Connecting).await?;
        if record.pinned_host_key.is_none() {
            record.pinned_host_key = Some(self.console_key(&vm).await?);
            self.save(record.clone()).await?;
        }
        let runtime = self.runtime.upgrade().ok_or_else(|| {
            SetupIssue::new(
                "service_unavailable",
                "The Gbot service is shutting down.",
                "Reopen GChat and resume this setup.",
            )
        })?;
        let config = WorkspaceConfig {
            id: record.id,
            name: record.name.clone(),
            service_pc: ServicePc::Local,
            bot_pc: BotPc::LocalVm {
                host_id: record.service_id,
                vm_id: vm.spec.id.to_string(),
                hypervisor: Hypervisor::Kvm,
            },
            connection: WorkspaceConnection::Ssh(SshConnection {
                endpoint: SshEndpoint {
                    hostname: "127.0.0.1".into(),
                    port: vm.spec.ssh_port,
                    user: "gbot".into(),
                },
                pinned_host_key: record
                    .pinned_host_key
                    .clone()
                    .ok_or_else(|| persistence("missing host key"))?,
                credential_ref: record.credential_ref,
            }),
        };
        let existing = self
            .service
            .snapshot()
            .await
            .workspaces
            .into_iter()
            .find(|w| w.id == record.id);
        match existing {
            Some(existing) if existing == config => {}
            Some(_) => {
                return Err(SetupIssue::new(
                    "workspace_conflict",
                    "The saved workspace differs from the owned guest.",
                    "Review the existing workspace before retrying.",
                ))
            }
            None => runtime
                .register_workspace(config)
                .await
                .map_err(persistence)?,
        }
        let hello = self.connect_guest(record, &runtime).await?;
        if ![
            GuestCapability::Exec,
            GuestCapability::Read,
            GuestCapability::Write,
            GuestCapability::DesktopCapture,
            GuestCapability::DesktopInput,
            GuestCapability::ViewTransport,
        ]
        .iter()
        .all(|cap| hello.capabilities.contains(cap))
        {
            return Err(SetupIssue::new(
                "guest_capability_missing",
                "The guest has not proved command, file, desktop and media readiness.",
                "Inspect the guest's cloud-init and desktop services, then retry.",
            ));
        }
        self.stage(record, SetupStage::TestingDesktop).await?;
        self.verify_guest(&runtime, record).await?;
        self.stage(record, SetupStage::Ready).await
    }
    async fn connect_guest(
        &self,
        record: &mut SetupRecord,
        runtime: &WorkspaceRuntime,
    ) -> Result<GuestHello, SetupIssue> {
        let error = match runtime.connect_for_setup(record.identity).await {
            Ok(hello) => return Ok(hello),
            Err(error) => error,
        };
        if !matches!(
            error,
            crate::workspace::WorkspaceError::Transport(
                crate::ssh::SshError::DesktopRestarted { .. }
            )
        ) {
            return Err(SetupIssue::new("guest_not_ready", error.to_string(),
                "Wait for guest cloud-init and the desktop session to complete, then retry this same setup."));
        }
        let (_serial, renewal) = self
            .lock_setup_renewal(record.identity, runtime, &error)
            .await?;
        let previous = record.identity;
        let mut next = record.clone();
        next.identity.session_id = SessionId::new();
        // Persist before connecting: a failed reconnect resumes this same new identity.
        self.save(next.clone()).await?;
        *record = next;
        eprintln!("Gbot saved setup desktop renewal: workspace={} guest={} previous_session={} session={} owner=Bot; {}",
            record.id.as_uuid(), record.spec.as_ref().map(|spec| spec.id).unwrap_or(record.id.as_uuid()),
            previous.session_id.as_uuid(), record.identity.session_id.as_uuid(), error);
        renewal.connect(record.identity).await.map_err(|error| SetupIssue::new(
            "guest_not_ready", error.to_string(),
            "Wait for the guest desktop, then retry this saved setup; its fresh session is retained.",
        ))
    }

    async fn lock_setup_renewal<'a>(
        &'a self,
        identity: SessionIdentity,
        runtime: &'a WorkspaceRuntime,
        cause: &crate::workspace::WorkspaceError,
    ) -> Result<
        (
            tokio::sync::MutexGuard<'a, ()>,
            crate::workspace::SetupSessionRenewal<'a>,
        ),
        SetupIssue,
    > {
        // Queue automatic renewals before workspace lifecycle: TaskRunner must
        // still refuse contention with user tasks or removal without waiting.
        let serial = self.renewals.lock().await;
        if self.stopping.load(Ordering::Acquire)
            || self
                .cancellations
                .lock()
                .await
                .contains(&identity.workspace_id)
        {
            return Err(SetupIssue::new(
                "setup_cancelled",
                "The saved setup renewal was cancelled.",
                "Resume or remove this same setup.",
            ));
        }
        let renewal = runtime.lock_for_setup_renewal(identity).await.map_err(|blocked| {
            SetupIssue::new("guest_session_recovery_blocked", format!("{cause}; {blocked}"),
                "Keep human or paused control and unresolved operations intact. Review them before retrying setup.")
        })?;
        if self.stopping.load(Ordering::Acquire)
            || self
                .cancellations
                .lock()
                .await
                .contains(&identity.workspace_id)
        {
            return Err(SetupIssue::new(
                "setup_cancelled",
                "The saved setup renewal was cancelled.",
                "Resume or remove this same setup.",
            ));
        }
        Ok((serial, renewal))
    }

    async fn verify_guest(
        &self,
        runtime: &Arc<WorkspaceRuntime>,
        record: &SetupRecord,
    ) -> Result<(), SetupIssue> {
        let action = "Inspect the guest's operation, desktop and media services, then retry this same setup.";
        let path = GuestPath(format!("/home/gbot/Gbot-setup-{}.txt", record.id.as_uuid()));
        let expected = b"Gbot computer readiness check\n".to_vec();
        let written = self
            .guest(
                runtime,
                record,
                GuestOperationKind::Write {
                    path: path.clone(),
                    offset: 0,
                    data: expected.clone(),
                    truncate: true,
                },
            )
            .await?;
        if !matches!(written, GuestResult::Written { bytes_written } if bytes_written == expected.len() as u64)
        {
            return Err(SetupIssue::new(
                "guest_file_failed",
                "The guest did not confirm the readiness file write.",
                action,
            ));
        }
        let read = self
            .guest(
                runtime,
                record,
                GuestOperationKind::Read {
                    path: path.clone(),
                    offset: 0,
                    length: expected.len() as u64,
                },
            )
            .await?;
        if !matches!(read, GuestResult::Read { data } if data == expected) {
            return Err(SetupIssue::new(
                "guest_file_failed",
                "The guest readiness file did not read back exactly.",
                action,
            ));
        }
        let launch_time = SystemTime::now().duration_since(UNIX_EPOCH).ok();
        let command = readiness_editor_command(record.id, &path);
        let launched = self
            .guest(
                runtime,
                record,
                GuestOperationKind::Exec {
                    program: "/bin/sh".into(),
                    args: vec!["-c".into(), command],
                    cwd: GuestPath("/home/gbot".into()),
                    env: BTreeMap::new(),
                },
            )
            .await?;
        if !matches!(launched, GuestResult::ExecFinished { exit_code: 0, .. }) {
            return Err(SetupIssue::new(
                "guest_exec_failed",
                "Readiness exec did not report completion of the guest document launch.",
                action,
            ));
        }
        let title = format!("Gbot-setup-{}", record.id.as_uuid());
        let mut window = None;
        let mut last_windows = serde_json::Value::Null;
        for _ in 0..20 {
            let result = self
                .guest(
                    runtime,
                    record,
                    GuestOperationKind::Desktop {
                        tool: "list_windows".into(),
                        arguments: serde_json::json!({}),
                    },
                )
                .await?;
            if let GuestResult::Desktop { result } = result {
                last_windows = window_diagnostics(&result, &title);
                window = result["structuredContent"]["windows"]
                    .as_array()
                    .and_then(|windows| {
                        windows.iter().find(|window| {
                            window["title"]
                                .as_str()
                                .is_some_and(|value| value.contains(&title))
                                && window["pid"].as_u64().is_some_and(|n| n > 0)
                                && window["window_id"].as_u64().is_some_and(|n| n > 0)
                        })
                    })
                    .cloned();
            }
            if window.is_some() {
                break;
            }
            if self.stopping.load(Ordering::Acquire)
                || self.cancellations.lock().await.contains(&record.id)
            {
                return Err(SetupIssue::new(
                    "setup_cancelled",
                    "The setup check was cancelled.",
                    "Resume or remove this same setup.",
                ));
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        let window = match window {
            Some(window) => window,
            None => {
                // Exec success above proves unit submission, not editor startup.
                // Use only the existing setup transport and this setup's exact unit.
                let diagnostic = self
                    .guest(
                        runtime,
                        record,
                        GuestOperationKind::Exec {
                            program: "/bin/sh".into(),
                            args: vec![
                                "-c".into(),
                                window_diagnostic_command(record.id, launch_time),
                            ],
                            cwd: GuestPath("/home/gbot".into()),
                            env: BTreeMap::new(),
                        },
                    )
                    .await;
                let editor = match editor_diagnostic_target(&last_windows, &diagnostic) {
                    Some(arguments) => {
                        let result = self
                            .guest(
                                runtime,
                                record,
                                GuestOperationKind::Desktop {
                                    tool: "get_window_state".into(),
                                    arguments,
                                },
                            )
                            .await;
                        editor_diagnostics(result, &title)?
                    }
                    None => serde_json::json!({
                        "unavailable": "No unique listed window matches a confirmed positive unit MainPID."
                    }),
                };
                if self.stopping.load(Ordering::Acquire)
                    || self.cancellations.lock().await.contains(&record.id)
                {
                    return Err(SetupIssue::new(
                        "setup_cancelled",
                        "The setup check was cancelled.",
                        "Resume or remove this same setup.",
                    ));
                }
                let mut issue = window_failure_issue(last_windows, diagnostic);
                issue
                    .message
                    .push_str(&format!("\nEditor accessibility: {editor}"));
                return Err(issue);
            }
        };
        // Verify the saved effect in this setup's disposable document.
        let input_expected = "Gbot desktop input readiness confirmed\n";
        for (tool, arguments) in readiness_input(&window, input_expected) {
            self.guest(
                runtime,
                record,
                GuestOperationKind::Desktop {
                    tool: tool.into(),
                    arguments,
                },
            )
            .await?;
        }
        let mut input_verified = false;
        for _ in 0..20 {
            let result = self
                .guest(
                    runtime,
                    record,
                    GuestOperationKind::Read {
                        path: path.clone(),
                        offset: 0,
                        length: input_expected.len() as u64 + 1,
                    },
                )
                .await?;
            if matches!(result, GuestResult::Read { data } if data.as_slice() == input_expected.as_bytes())
            {
                input_verified = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if !input_verified {
            return Err(SetupIssue::new(
                "desktop_input_not_ready",
                "The guest did not save the exact readiness text entered through its desktop.",
                action,
            ));
        }
        let result = self
            .guest(
                runtime,
                record,
                GuestOperationKind::Desktop {
                    tool: "get_desktop_state".into(),
                    arguments: serde_json::json!({}),
                },
            )
            .await
            .map_err(|mut issue| {
                if issue.code == "guest_not_ready" {
                    issue.code = "desktop_not_ready".into();
                }
                issue
            })?;
        if !desktop_ready(&result) {
            return Err(SetupIssue::new(
                "desktop_not_ready",
                "Readiness get_desktop_state did not return a real frame after foreground input.",
                action,
            ));
        }
        let owner = Uuid::new_v4();
        let view = runtime
            .open_view_for_setup(crate::media::OpenView {
                identity: record.identity,
                owner,
                interactive: false,
                audio: false,
                h264: false,
            })
            .await
            .map_err(|error| {
                SetupIssue::new(
                    "media_not_ready",
                    format!("Readiness open_view failed: {error}"),
                    action,
                )
            })?;
        runtime
            .close_view(crate::media::CloseView {
                identity: record.identity,
                owner,
                lease_id: view.lease_id,
            })
            .await
            .map_err(|error| {
                SetupIssue::new(
                    "media_cleanup",
                    format!("Readiness close_view failed: {error}"),
                    action,
                )
            })?;
        Ok(())
    }
    async fn guest(
        &self,
        runtime: &WorkspaceRuntime,
        record: &SetupRecord,
        operation: GuestOperationKind,
    ) -> Result<GuestResult, SetupIssue> {
        if self.stopping.load(Ordering::Acquire)
            || self.cancellations.lock().await.contains(&record.id)
        {
            return Err(SetupIssue::new(
                "setup_cancelled",
                "The setup check was cancelled.",
                "Resume or remove this same setup.",
            ));
        }
        let label = match &operation {
            GuestOperationKind::Exec { .. } => "exec",
            GuestOperationKind::Read { .. } => "read",
            GuestOperationKind::Write { .. } => "write",
            GuestOperationKind::Desktop { tool, .. } => tool.as_str(),
            GuestOperationKind::Status { .. } => "status",
            GuestOperationKind::Cancel { .. } => "cancel",
        }
        .to_owned();
        let reply = runtime
            .request_for_setup(GuestRequest {
                identity: record.identity,
                operation_id: OperationId::new(),
                operation,
            })
            .await
            .map_err(|error| {
                SetupIssue::new(
                    "guest_not_ready",
                    format!("Readiness {label} failed: {error}"),
                    "Repair the guest services and retry this same setup.",
                )
            })?;
        readiness_result(&label, reply.outcome)
    }
    async fn console_key(&self, vm: &PreparedVm) -> Result<SshHostPublicKey, SetupIssue> {
        let inspect = async {
            // The serial log belongs to the exact PreparedVm. Reading from the start
            // retains the guest's one-time readiness proof across service restarts.
            loop {
                if self.stopping.load(Ordering::Acquire)
                    || self
                        .cancellations
                        .lock()
                        .await
                        .contains(&WorkspaceId(vm.spec.id))
                {
                    return Err(io::Error::other("setup cancelled"));
                }
                match fs::read(vm.directory.join("serial.log")).await {
                    Ok(bytes) => {
                        let marker = b"GBOT_READY_KEY ";
                        for line in bytes
                            .split_inclusive(|byte| *byte == b'\n')
                            .filter(|line| line.last() == Some(&b'\n'))
                        {
                            if let Some(offset) =
                                line.windows(marker.len()).position(|part| part == marker)
                            {
                                let key = russh::keys::PublicKey::from_openssh(
                                    std::str::from_utf8(&line[offset + marker.len()..])
                                        .map_err(io::Error::other)?
                                        .trim(),
                                )
                                .map_err(io::Error::other)?;
                                let public = key.to_openssh().map_err(io::Error::other)?;
                                let mut fields = public.split_whitespace();
                                let algorithm = fields
                                    .next()
                                    .ok_or_else(|| io::Error::other("invalid guest host key"))?;
                                let public_key = fields
                                    .next()
                                    .ok_or_else(|| io::Error::other("invalid guest host key"))?;
                                return Ok(SshHostPublicKey {
                                    algorithm: algorithm.into(),
                                    public_key: public_key.into(),
                                });
                            }
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error),
                }
                tokio::select! { _ = tokio::time::sleep(Duration::from_millis(500)) => {}, _ = self.cancel_update.notified() => {} }
            }
        };
        tokio::time::timeout(Duration::from_secs(600), inspect).await.map_err(|_| SetupIssue::new("guest_boot_timeout", "The guest did not complete cloud-init within the setup wait.", "Inspect the owned guest's serial.log and cloud-init; retry after repairing guest startup."))?.map_err(|error| SetupIssue::new("guest_console", error.to_string(), "Inspect the owned VM serial.log, then retry this setup."))
    }
    pub async fn close(&self) {
        self.stopping.store(true, Ordering::Release);
        self.cancel_update.notify_waiters();
        let ids: Vec<_> = self.lifecycle.lock().await.keys().copied().collect();
        for id in ids {
            let lock = self.lock(id).await;
            let _guard = lock.lock().await;
        }
    }
    pub async fn remove(self: &Arc<Self>, id: WorkspaceId) -> Result<SetupRecord, SetupIssue> {
        if self.stopping.load(Ordering::Acquire) {
            return Err(SetupIssue::new(
                "setup_closed",
                "The setup service is closing.",
                "Reopen GChat and retry this same setup.",
            ));
        }
        if !self.records.lock().await.contains_key(&id) {
            return Err(SetupIssue::new(
                "setup_missing",
                "This setup was not found.",
                "Refresh the setup list.",
            ));
        }
        let lock = self.lock(id).await;
        self.cancellations.lock().await.insert(id);
        self.cancel_update.notify_waiters();
        let owner = self.clone();
        tokio::spawn(async move { let _guard = lock.lock().await;
            let mut record = owner.records.lock().await.get(&id).cloned().ok_or_else(|| SetupIssue::new("setup_missing", "This setup was not found.", "Refresh the setup list."))?;
            if record.stage == SetupStage::Removed { return Ok(record); }
            let result: Result<(), SetupIssue> = async {
            let owned_pc = BotPc::LocalVm { host_id: record.service_id, vm_id: id.as_uuid().to_string(), hypervisor: Hypervisor::Kvm };
            if owner.service.snapshot().await.workspaces.iter().any(|workspace| workspace.id == id && workspace.bot_pc != owned_pc) {
                return Err(SetupIssue::new("workspace_not_owned", "This workspace no longer belongs to this local setup.", "Resolve the workspace ownership before removing this setup."));
            }
            let runtime = owner.runtime.upgrade();
            let transport = match runtime.as_ref() {
                Some(runtime) => Some(runtime.lock_for_removal(record.identity).await.map_err(persistence)?),
                None => None,
            };
            let mut removal = owner.service.begin_owned_workspace_removal(id, &owned_pc, transport.as_ref().and_then(|transport| transport.session())).await.map_err(|error| SetupIssue::new("workspace_in_use", error.to_string(), "Resolve attached accounts, unsettled operations and human control before removing this VM."))?;
            owner.stage(&mut record, SetupStage::Removing).await?;
            removal.detach_session();
            if let Some(transport) = &transport { transport.disconnect().await.map_err(persistence)?; }
            if let Some(credential) = removal.model_credential() {
                record.pending_model_credential = Some(credential);
                owner.save(record.clone()).await?;
            }
            let directory = owner.root.join(id.as_uuid().to_string());
            let output = Command::new(&owner.tools.virsh).args(["--connect", "qemu:///session", "list", "--all", "--uuid"]).output().await.map_err(persistence)?;
            if !output.status.success() { return Err(SetupIssue::new("removal_unconfirmed", "Libvirt could not confirm owned guest registration.", "Restore the libvirt session, then retry removal.")); }
            let registered = String::from_utf8_lossy(&output.stdout).lines().any(|line| line.trim() == id.as_uuid().to_string());
            if registered && directory.join("prepared").is_file() {
                let vm = PreparedVm::open(&directory).await.map_err(persistence)?;
                vm.force_stop(&owner.tools).await.map_err(persistence)?; vm.unregister(&owner.tools).await.map_err(persistence)?;
            } else if registered {
                return Err(SetupIssue::new("removal_unconfirmed", "An incompletely prepared guest may still be registered.", "Resume the same setup to reconcile registration before removing its disk or key."));
            }
            if directory.exists() { fs::remove_dir_all(&directory).await.map_err(persistence)?; }
            removal.commit().await.map_err(persistence)?;
            if let Some(credential) = record.pending_model_credential {
                owner.vault.delete(credential.as_uuid()).await.map_err(|error| SetupIssue::new("credential_cleanup", error.to_string(), "Unlock the vault and retry removal of this same setup."))?;
            }
            owner.vault.delete(record.credential_ref.as_uuid()).await.map_err(|error| SetupIssue::new("credential_cleanup", error.to_string(), "Unlock the vault and retry removal of this same setup."))?;
            record.pending_model_credential = None;
            owner.stage(&mut record, SetupStage::Removed).await?; Ok(())
            }.await;
            if let Err(issue) = result { record.issue = Some(issue.clone()); owner.save(record).await?; return Err(issue); }
            Ok(record)
        }).await.map_err(persistence)?
    }
}
fn readiness_editor_command(id: WorkspaceId, path: &GuestPath) -> String {
    let unit = format!("gbot-setup-{}", id.as_uuid());
    // --disable-server gives this unit its own editor process, but Mousepad still
    // restores the user's previous session. Keep this disposable readiness editor
    // away from both the user's settings and their unsaved recovery documents.
    // systemd removes the private runtime directory when this exact unit stops.
    format!(
        r#"systemctl --user stop {unit}.service 2>/dev/null; systemctl --user reset-failed {unit}.service 2>/dev/null; systemd-run --user --collect --unit={unit} --property=RuntimeDirectory={unit} --property=RuntimeDirectoryMode=0700 --property=RuntimeDirectoryPreserve=no /usr/local/bin/gbot-in-session /bin/sh -c 'set -eu; : "${{RUNTIME_DIRECTORY:?}}"; export GSETTINGS_BACKEND=memory XDG_CONFIG_HOME="$RUNTIME_DIRECTORY/config" XDG_DATA_HOME="$RUNTIME_DIRECTORY/data" XDG_CACHE_HOME="$RUNTIME_DIRECTORY/cache" XDG_STATE_HOME="$RUNTIME_DIRECTORY/state"; exec mousepad --disable-server "$1"' sh {}"#,
        path.0
    )
}
pub(crate) fn readiness_input(
    window: &serde_json::Value,
    text: &str,
) -> [(&'static str, serde_json::Value); 3] {
    let pid = &window["pid"];
    let window_id = &window["window_id"];
    [
        (
            "press_key",
            serde_json::json!({"pid":pid,"window_id":window_id,"key":"a","modifiers":["ctrl"]}),
        ),
        (
            "type_text",
            serde_json::json!({"pid":pid,"window_id":window_id,"text":text}),
        ),
        (
            "press_key",
            serde_json::json!({"pid":pid,"window_id":window_id,"key":"s","modifiers":["ctrl"]}),
        ),
    ]
}
fn diagnostic_text(text: &str, limit: usize) -> String {
    text.chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .take(limit)
        .collect()
}

fn diagnostic_window_text(value: &serde_json::Value, limit: usize) -> Option<String> {
    let mut remaining = limit;
    value.as_str().map(|text| {
        text.chars()
            .take_while(|character| {
                // Bound the serialized size while letting serde escape control characters.
                let bytes = match *character {
                    '"' | '\\' | '\u{8}' | '\t' | '\n' | '\u{c}' | '\r' => 2,
                    '\u{0}'..='\u{1f}' => 6,
                    character => character.len_utf8(),
                };
                if bytes > remaining {
                    return false;
                }
                remaining -= bytes;
                true
            })
            .collect()
    })
}

fn window_diagnostics(result: &serde_json::Value, title: &str) -> serde_json::Value {
    match result["structuredContent"]["windows"].as_array() {
        Some(windows) => serde_json::json!({
            "count": windows.len(),
            "windows": windows.iter().take(6).map(|window| serde_json::json!({
                "title": diagnostic_window_text(&window["title"], 160),
                "app_name": diagnostic_window_text(&window["app_name"], 64),
                "title_matches": window["title"].as_str().map(|value| value.contains(title)),
                "pid": window["pid"].as_u64(),
                "window_id": window["window_id"].as_u64(),
            })).collect::<Vec<_>>()
        }),
        None => serde_json::json!({"windows": "missing or not an array"}),
    }
}

fn window_diagnostic_command(id: WorkspaceId, launch_time: Option<Duration>) -> String {
    let unit = format!("gbot-setup-{}.service", id.as_uuid());
    let journal = match launch_time {
        Some(time) => format!(
            r#"timeout -k 1s 2s journalctl --user --unit={unit} --since=@{} --lines=12 --no-pager --output=short-iso 2>&1; printf '\njournal-exit=%s\n' "$?""#,
            time.as_secs()
        ),
        None => "printf 'Launch time unavailable; journal omitted\\n'".into(),
    };
    format!(
        r#"(status=$(timeout -k 1s 2s systemctl --user show {unit} --property=LoadState,ActiveState,SubState,Result,MainPID,ExecMainCode,ExecMainStatus 2>&1); code=$?; printf '%s\nunit-status-exit=%s\n' "$status" "$code"; pid=$(printf '%s\n' "$status" | sed -n 's/^MainPID=//p'); case "$code:$pid" in 0:[1-9]*) case "$pid" in *[!0-9]*) printf 'editor-process=unavailable\n';; *) printf 'editor-argv-hex-prefix(max256B)=\n'; od -An -v -N256 -tx1 /proc/"$pid"/cmdline 2>&1; printf '\neditor-argv-exit=%s\neditor-stat-prefix(max512B)=' "$?"; head -c 512 /proc/"$pid"/stat 2>&1; printf '\neditor-stat-exit=%s\neditor-wchan-prefix(max128B)=' "$?"; head -c 128 /proc/"$pid"/wchan 2>&1; printf '\neditor-wchan-exit=%s\n' "$?";; esac;; *) printf 'editor-process=unavailable\n';; esac; printf 'mousepad-version='; timeout -k 1s 2s dpkg-query --show --showformat='${{Version}}\n' mousepad 2>&1; printf '\nmousepad-version-exit=%s\n' "$?"; {journal}) | head -c 3072"#
    )
}

fn editor_diagnostic_target(
    windows: &serde_json::Value,
    diagnostic: &Result<GuestResult, SetupIssue>,
) -> Option<serde_json::Value> {
    let Ok(GuestResult::ExecFinished {
        exit_code: 0,
        stdout,
        ..
    }) = diagnostic
    else {
        return None;
    };
    let output = std::str::from_utf8(stdout).ok()?;
    let status = output.split_once("\nunit-status-exit=0\n")?.0;
    let mut pids = status
        .lines()
        .filter_map(|line| line.strip_prefix("MainPID="));
    let pid = pids.next()?.parse::<u32>().ok().filter(|pid| *pid > 0)?;
    if pids.next().is_some() {
        return None;
    }
    let listed = windows["windows"].as_array()?;
    if windows["count"].as_u64()? != listed.len() as u64 {
        // A truncated list cannot establish that the editor has just one window.
        return None;
    }
    let mut matches = listed.iter().filter(|window| {
        window["pid"].as_u64() == Some(u64::from(pid))
            && window["window_id"].as_u64().is_some_and(|id| id > 0)
    });
    let window = matches.next()?;
    if matches.next().is_some() {
        return None;
    }
    Some(serde_json::json!({
        "pid": pid, "window_id": window["window_id"],
        "include_screenshot": false, "include_accessibility_tree": true,
        "max_elements": 80, "max_depth": 8, "timeout_ms": 2000
    }))
}

fn editor_diagnostics(
    result: Result<GuestResult, SetupIssue>,
    title: &str,
) -> Result<serde_json::Value, SetupIssue> {
    let result = match result {
        Err(issue) if issue.code == "setup_cancelled" => return Err(issue),
        Err(issue) => {
            return Ok(serde_json::json!({"unavailable": diagnostic_text(&issue.message, 256)}))
        }
        Ok(GuestResult::Desktop { result }) => result,
        Ok(_) => return Ok(serde_json::json!({"unavailable": "No desktop result returned."})),
    };
    let state = &result["structuredContent"];
    let tree = diagnostic_window_text(&state["tree_markdown"], 768);
    let document_match = state["tree_markdown"]
        .as_str()
        .map(|text| text.contains(title));
    let mut diagnostic = serde_json::json!({
        "isError": result["isError"].as_bool(),
        "pid": state["pid"].as_u64(), "window_id": state["window_id"].as_u64(),
        "window_title": diagnostic_window_text(&state["window_title"], 160),
        "elements_complete": state["elements_complete"].as_bool(),
        "truncated": state["truncated"].as_bool(),
        "degraded": state["degraded"].as_bool(),
        "degraded_reason": diagnostic_window_text(&state["degraded_reason"], 160),
        "truncation_reason": diagnostic_window_text(&state["truncation_reason"], 160),
        "total_element_count": state["total_element_count"].as_u64(),
        "nodes_pending": state["nodes_pending"].as_u64(),
        "walk_elapsed_ms": state["walk_elapsed_ms"].as_u64(),
        "tree_markdown": tree,
        "retained_tree_truncated": tree.as_deref().zip(state["tree_markdown"].as_str())
            .map(|(retained, original)| retained != original),
        // These are observations, never substitutes for title/input/readback readiness.
        "observed_document_match": state["elements"].as_array().map(|elements| {
            document_match == Some(true) || elements.iter().any(|element| ["label", "value"].iter().any(|field| {
                element[field].as_str().is_some_and(|text| text.contains(title))
            }))
        }).or(document_match),
    });
    diagnostic["error_text"] = if result["isError"] == true {
        serde_json::json!(result["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|part| part["type"] == "text")
            .take(2)
            .map(|part| diagnostic_window_text(&part["text"], 192))
            .collect::<Vec<_>>())
    } else {
        serde_json::Value::Null
    };
    diagnostic["elements"] = match state["elements"].as_array() {
        Some(elements) => serde_json::json!(elements
            .iter()
            .take(20)
            .map(|element| {
                serde_json::json!({
                    "role": diagnostic_window_text(&element["role"], 48),
                    "label": diagnostic_window_text(&element["label"], 96),
                    "value": diagnostic_window_text(&element["value"], 96),
                    "depth": element["depth"].as_u64(),
                    "parent_index": element["parent_index"].as_u64(),
                })
            })
            .collect::<Vec<_>>()),
        None => serde_json::Value::Null,
    };
    diagnostic["retained_elements_truncated"] = serde_json::json!(state["elements"]
        .as_array()
        .is_some_and(|elements| elements.len() > 20));
    Ok(diagnostic)
}

fn window_failure_issue(
    windows: serde_json::Value,
    diagnostic: Result<GuestResult, SetupIssue>,
) -> SetupIssue {
    let details = match diagnostic {
        Err(issue) if issue.code == "setup_cancelled" => return issue,
        Err(issue) => format!("Diagnostics unavailable: {}", issue.message),
        Ok(GuestResult::ExecFinished {
            exit_code,
            stdout,
            stderr,
        }) => format!(
            "Unit diagnostic collection (exit {exit_code}): {}\n{}",
            String::from_utf8_lossy(&stdout),
            String::from_utf8_lossy(&stderr)
        ),
        Ok(_) => "Diagnostics did not return command completion.".into(),
    };
    SetupIssue::new(
        "desktop_not_ready",
        format!(
            "Readiness list_windows did not observe the dedicated guest document window. Last window metadata: {windows}. {}",
            diagnostic_text(&details, 2304)
        ),
        "Inspect the guest's operation, desktop and media services, then retry this same setup.",
    )
}

fn readiness_result(operation: &str, outcome: GuestOutcome) -> Result<GuestResult, SetupIssue> {
    let mut code = "guest_not_ready";
    let reason = match outcome {
        GuestOutcome::Error { error } => format!("{:?}: {}", error.code, error.message),
        GuestOutcome::Success {
            result: GuestResult::Desktop { result },
        } if result["isError"] == true => {
            let text = result["content"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|part| part["type"] == "text")
                .filter_map(|part| part["text"].as_str())
                .filter(|text| !text.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            if text.is_empty() {
                "The desktop tool returned an error without a text reason.".into()
            } else {
                text
            }
        }
        GuestOutcome::Success {
            result: GuestResult::ExecFinished {
                exit_code, stderr, ..
            },
        } if exit_code != 0 => {
            code = "guest_exec_failed";
            format!(
                "exit code {exit_code}: {}",
                String::from_utf8_lossy(&stderr).trim()
            )
        }
        GuestOutcome::Success { result } => return Ok(result),
    };
    Err(SetupIssue::new(
        code,
        format!("Readiness {operation} failed: {reason}"),
        "Inspect the guest operation result, repair its services and retry this same setup.",
    ))
}

fn desktop_ready(result: &GuestResult) -> bool {
    matches!(result, GuestResult::Desktop { result }
        if result["isError"] != true && ["screenshot_width", "screenshot_height", "screen_width", "screen_height"].iter().all(|field| result["structuredContent"][field].as_u64().is_some_and(|n| n > 0))
        && result["content"].as_array().is_some_and(|content| content.iter().any(|part| part["type"] == "image" && part["data"].as_str().is_some_and(|data| !data.is_empty()))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::VaultFuture;
    use std::os::unix::fs::PermissionsExt;
    #[derive(Default)]
    struct MemoryVault(Mutex<BTreeMap<Uuid, Vec<u8>>>, Mutex<Option<Uuid>>);
    impl Vault for MemoryVault {
        fn get(&self, id: Uuid) -> VaultFuture<'_, Option<Secret>> {
            Box::pin(async move { Ok(self.0.lock().await.get(&id).cloned().map(Secret::new)) })
        }
        fn put(&self, id: Uuid, secret: Secret) -> VaultFuture<'_, ()> {
            Box::pin(async move {
                self.0
                    .lock()
                    .await
                    .insert(id, secret.expose_secret().to_vec());
                Ok(())
            })
        }
        fn delete(&self, id: Uuid) -> VaultFuture<'_, ()> {
            Box::pin(async move {
                if self.1.lock().await.as_ref() == Some(&id) {
                    return Err(crate::vault::VaultError::AccessDenied);
                }
                self.0.lock().await.remove(&id);
                Ok(())
            })
        }
    }
    async fn settled(setup: &KvmSetup) {
        tokio::time::timeout(Duration::from_secs(5), async {
            while !setup.jobs.lock().await.is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }
    #[tokio::test]
    async fn saved_setup_renewals_serialize_and_retain_identity_on_failed_connect() {
        use crate::{
            executor::{ExecutorProcesses, ProcessSpec},
            service::{
                DurableState, OperationRecord, OperationState, SessionControl, SessionControlState,
            },
            ssh::{generate_ssh_key, ssh_public_key, SshError},
            tasks::TaskRunner,
            workspace::WorkspaceError,
        };
        let root = tempfile::tempdir().unwrap();
        let id = WorkspaceId::new();
        let previous = SessionIdentity {
            workspace_id: id,
            session_id: SessionId::new(),
        };
        let service_id = Uuid::new_v4();
        let credential_ref = VaultCredentialRef::new();
        let pinned_host_key = ssh_public_key(&generate_ssh_key().unwrap()).unwrap();
        let state_path = root.path().join("state.json");
        let mut initial = DurableState {
            service_id,
            service_pc: ServicePc::Local,
            workspaces: vec![WorkspaceConfig {
                id,
                name: "Saved computer".into(),
                service_pc: ServicePc::Local,
                bot_pc: BotPc::LocalVm {
                    host_id: service_id,
                    vm_id: id.as_uuid().to_string(),
                    hypervisor: Hypervisor::Kvm,
                },
                connection: WorkspaceConnection::Ssh(SshConnection {
                    endpoint: SshEndpoint {
                        hostname: "127.0.0.1".into(),
                        port: 2222,
                        user: "gbot".into(),
                    },
                    pinned_host_key: pinned_host_key.clone(),
                    credential_ref,
                }),
            }],
            operations: vec![OperationRecord {
                id: OperationId::new(),
                identity: previous,
                capability: GuestCapability::Exec,
                target_operation_id: None,
                state: OperationState::Completed,
            }],
            controls: vec![SessionControl {
                identity: previous,
                owner: None,
                state: SessionControlState::Bot,
            }],
            assignments: vec![],
            connector_accounts: vec![],
        };
        let other = SessionIdentity {
            workspace_id: WorkspaceId::new(),
            session_id: SessionId::new(),
        };
        let mut other_workspace = initial.workspaces[0].clone();
        other_workspace.id = other.workspace_id;
        other_workspace.bot_pc = BotPc::LocalVm {
            host_id: service_id,
            vm_id: other.workspace_id.as_uuid().to_string(),
            hypervisor: Hypervisor::Kvm,
        };
        initial.workspaces.push(other_workspace);
        initial.controls.push(SessionControl {
            identity: other,
            owner: None,
            state: SessionControlState::Bot,
        });
        let store = Arc::new(Store::open(state_path.clone()).await.unwrap());
        store.save(&initial).await.unwrap();
        drop(store);
        let service = Arc::new(Service::open(state_path).await.unwrap());
        let runtime = Arc::new(WorkspaceRuntime::new(
            service.clone(),
            Arc::new(MemoryVault::default()),
        ));
        runtime
            .configure_kvm_setup(root.path().to_owned())
            .await
            .unwrap();
        let tasks = Arc::new(
            TaskRunner::new(
                root.path().join("tasks"),
                runtime.clone(),
                ExecutorProcesses {
                    python: ProcessSpec {
                        program: "/bin/false".into(),
                        args: vec![],
                    },
                    context: ProcessSpec {
                        program: "/bin/false".into(),
                        args: vec![],
                    },
                },
            )
            .await
            .unwrap(),
        );
        runtime
            .configure_task_runner(Arc::downgrade(&tasks))
            .unwrap();
        let setup = runtime.kvm_setup().unwrap();
        let mut record = SetupRecord {
            id,
            name: "Saved computer".into(),
            service_id,
            credential_ref,
            pending_model_credential: None,
            identity: previous,
            stage: SetupStage::TestingDesktop,
            resume_on_start: true,
            issue: None,
            spec: None,
            pinned_host_key: Some(pinned_host_key),
        };
        setup.save(record.clone()).await.unwrap();
        let mut other_record = SetupRecord {
            id: other.workspace_id,
            identity: other,
            ..record.clone()
        };
        setup.save(other_record.clone()).await.unwrap();
        for identity in [previous, other] {
            service
                .register_session(
                    identity,
                    GuestHello {
                        protocol_version: GUEST_PROTOCOL_VERSION,
                        identity,
                        capabilities: [
                            GuestCapability::Exec,
                            GuestCapability::Read,
                            GuestCapability::Write,
                            GuestCapability::Status,
                            GuestCapability::Cancel,
                        ]
                        .into(),
                        view: None,
                    },
                )
                .await
                .unwrap();
        }

        // Exercise the persistence/connection boundary after stale-desktop proof.
        // An absent credential fails before SSH or any guest process can start.
        let cause = WorkspaceError::Transport(SshError::DesktopRestarted {
            saved_invocation_id: Uuid::new_v4(),
            current_invocation_id: Uuid::new_v4(),
            display: 1,
        });
        let (serial, renewal) = setup
            .lock_setup_renewal(previous, &runtime, &cause)
            .await
            .unwrap();
        let waiting = setup.lock_setup_renewal(other, &runtime, &cause);
        tokio::pin!(waiting);
        // Poll deterministically while the first renewal owns TaskRunner. The
        // second automatic setup must wait rather than fail task admission.
        assert!(
            std::future::poll_fn(|cx| std::task::Poll::Ready(
                std::future::Future::poll(waiting.as_mut(), cx).is_pending()
            ))
            .await
        );
        record.identity.session_id = SessionId::new();
        let fresh = record.identity;
        setup.save(record.clone()).await.unwrap();
        assert!(matches!(
            renewal.connect(fresh).await,
            Err(WorkspaceError::Transport(SshError::MissingCredential))
        ));
        drop(serial);
        let (_serial, renewal) = waiting.await.unwrap();
        other_record.identity.session_id = SessionId::new();
        setup.save(other_record.clone()).await.unwrap();
        assert!(matches!(
            renewal.connect(other_record.identity).await,
            Err(WorkspaceError::Transport(SshError::MissingCredential))
        ));
        let saved = setup
            .store
            .load::<Vec<SetupRecord>>()
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.len(), 2);
        assert_eq!(
            serde_json::to_value(saved.iter().find(|saved| saved.id == id).unwrap()).unwrap(),
            serde_json::to_value(&record).unwrap()
        );
        assert_eq!(
            serde_json::to_value(
                saved
                    .iter()
                    .find(|saved| saved.id == other.workspace_id)
                    .unwrap()
            )
            .unwrap(),
            serde_json::to_value(&other_record).unwrap()
        );
        assert_ne!(fresh, previous);
        assert_eq!(service.snapshot().await, initial);
        assert!(service.live_sessions().await.is_empty());

        // The actual setup retry retains the durable new identity on an ordinary
        // connection error; only a newly proven desktop restart can renew it again.
        let issue = setup
            .connect_guest(&mut record, &runtime)
            .await
            .unwrap_err();
        assert_eq!(issue.code, "guest_not_ready");
        assert!(issue.message.contains("SSH credential is missing"));
        assert_eq!(record.identity, fresh);
        let retried = setup
            .store
            .load::<Vec<SetupRecord>>()
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::to_value(retried).unwrap(),
            serde_json::to_value(saved).unwrap()
        );
        assert_eq!(service.snapshot().await, initial);
        assert!(service.live_sessions().await.is_empty());
        assert!(matches!(
            runtime.connect(fresh).await,
            Err(WorkspaceError::SetupIncomplete)
        ));
        tasks.close().await.unwrap();
        runtime.close().await.unwrap();
    }

    #[tokio::test]
    async fn queued_setup_renewal_rechecks_cancellation_and_shutdown_before_workspace_lock() {
        for stopping in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let service = Arc::new(Service::open(root.path().join("state.json")).await.unwrap());
            let vault = Arc::new(MemoryVault::default());
            let runtime = Arc::new(WorkspaceRuntime::new(service.clone(), vault.clone()));
            let setup = KvmSetup::open(
                root.path().to_owned(),
                service.clone(),
                vault,
                Arc::downgrade(&runtime),
            )
            .await
            .unwrap();
            let identity = SessionIdentity {
                workspace_id: WorkspaceId::new(),
                session_id: SessionId::new(),
            };
            let before = service.snapshot().await;
            let cause = crate::workspace::WorkspaceError::Transport(
                crate::ssh::SshError::DesktopRestarted {
                    saved_invocation_id: Uuid::new_v4(),
                    current_invocation_id: Uuid::new_v4(),
                    display: 1,
                },
            );
            let serial = setup.renewals.lock().await;
            let waiting = setup.lock_setup_renewal(identity, &runtime, &cause);
            tokio::pin!(waiting);
            assert!(
                std::future::poll_fn(|cx| std::task::Poll::Ready(
                    std::future::Future::poll(waiting.as_mut(), cx).is_pending()
                ))
                .await
            );
            if stopping {
                setup.close().await;
            } else {
                setup
                    .cancellations
                    .lock()
                    .await
                    .insert(identity.workspace_id);
            }
            drop(serial);
            let issue = match waiting.await {
                Err(issue) => issue,
                Ok(_) => panic!("cancelled renewal reached the workspace"),
            };
            assert_eq!(issue.code, "setup_cancelled");
            assert!(setup.status().await.is_empty());
            assert_eq!(service.snapshot().await, before);
            assert!(service.live_sessions().await.is_empty());
            runtime.close().await.unwrap();
        }
    }

    #[tokio::test]
    async fn unfinished_and_restarted_setups_hold_user_admission_until_ready() {
        use crate::{media::OpenView, workspace::WorkspaceError};
        let root = tempfile::tempdir().unwrap();
        let service = Arc::new(Service::open(root.path().join("state.json")).await.unwrap());
        let vault = Arc::new(MemoryVault::default());
        let runtime = Arc::new(WorkspaceRuntime::new(service.clone(), vault.clone()));
        runtime
            .configure_kvm_setup(root.path().to_owned())
            .await
            .unwrap();
        let setup = runtime.kvm_setup().unwrap();
        let id = WorkspaceId::new();
        let identity = SessionIdentity {
            workspace_id: id,
            session_id: SessionId::new(),
        };
        let mut record = SetupRecord {
            id,
            name: "Unfinished computer".into(),
            service_id: service.snapshot().await.service_id,
            credential_ref: VaultCredentialRef::new(),
            pending_model_credential: None,
            identity,
            stage: SetupStage::TestingDesktop,
            issue: None,
            resume_on_start: false,
            spec: None,
            pinned_host_key: None,
        };
        setup.save(record.clone()).await.unwrap();
        let request = GuestRequest {
            identity,
            operation_id: OperationId::new(),
            operation: GuestOperationKind::Desktop {
                tool: "list_windows".into(),
                arguments: serde_json::json!({}),
            },
        };
        let view = || OpenView {
            identity,
            owner: Uuid::new_v4(),
            interactive: false,
            audio: false,
            h264: false,
        };
        assert!(matches!(
            runtime.connect(identity).await,
            Err(WorkspaceError::SetupIncomplete)
        ));
        assert!(matches!(
            runtime.desktop_tools(identity).await,
            Err(WorkspaceError::SetupIncomplete)
        ));
        assert!(matches!(
            runtime.request(request.clone()).await,
            Err(WorkspaceError::SetupIncomplete)
        ));
        assert!(matches!(
            runtime.open_view(view()).await,
            Err(WorkspaceError::SetupIncomplete)
        ));
        assert!(matches!(
            runtime.take_over(identity, Uuid::new_v4()).await,
            Err(WorkspaceError::SetupIncomplete)
        ));
        // The setup owner can verify the guest through the same transport and journal.
        assert!(matches!(
            runtime.connect_for_setup(identity).await,
            Err(WorkspaceError::NotFound)
        ));
        assert!(matches!(
            runtime.request_for_setup(request).await,
            Err(WorkspaceError::NotConnected)
        ));
        assert!(matches!(
            runtime.open_view_for_setup(view()).await,
            Err(WorkspaceError::NotConnected)
        ));
        record.stage = SetupStage::Ready;
        setup.save(record.clone()).await.unwrap();
        let mut unfinished = record.clone();
        unfinished.id = WorkspaceId::new();
        unfinished.identity.workspace_id = unfinished.id;
        unfinished.stage = SetupStage::TestingDesktop;
        setup.save(unfinished.clone()).await.unwrap();
        assert!(matches!(
            runtime.connect(identity).await,
            Err(WorkspaceError::NotFound)
        ));
        assert!(matches!(
            runtime.desktop_tools(identity).await,
            Err(WorkspaceError::NotConnected)
        ));
        assert!(matches!(
            runtime
                .connect(SessionIdentity {
                    workspace_id: WorkspaceId::new(),
                    ..identity
                })
                .await,
            Err(WorkspaceError::NotFound)
        ));
        drop(setup);
        drop(runtime);
        let resumed = Arc::new(WorkspaceRuntime::new(service.clone(), vault.clone()));
        resumed
            .configure_kvm_setup(root.path().to_owned())
            .await
            .unwrap();
        let setup = resumed.kvm_setup().unwrap();
        settled(&setup).await;
        let recovered = setup.records.lock().await.get(&id).unwrap().clone();
        assert_eq!(recovered.stage, SetupStage::CheckingPc);
        assert!(recovered.resume_on_start);
        assert!(recovered.issue.is_some());
        assert_eq!(recovered.credential_ref, record.credential_ref);
        assert_eq!(recovered.identity, record.identity);
        assert_eq!(
            setup
                .records
                .lock()
                .await
                .get(&unfinished.id)
                .unwrap()
                .stage,
            SetupStage::TestingDesktop
        );
        setup.close().await;
        drop(setup);
        drop(resumed);
        let cold = KvmSetup::open(
            root.path().to_owned(),
            service.clone(),
            vault.clone(),
            Weak::new(),
        )
        .await
        .unwrap();
        assert!(cold.records.lock().await.get(&id).unwrap().resume_on_start);
        assert!(matches!(
            cold.ensure_ready(id).await,
            Err(WorkspaceError::SetupIncomplete)
        ));
    }
    #[tokio::test]
    async fn readiness_failure_details_survive_setup_restart() {
        let root = tempfile::tempdir().unwrap();
        let service = Arc::new(Service::open(root.path().join("state.json")).await.unwrap());
        let vault = Arc::new(MemoryVault::default());
        let mut setup = KvmSetup::open(
            root.path().to_owned(),
            service.clone(),
            vault.clone(),
            Weak::new(),
        )
        .await
        .unwrap();
        let id = WorkspaceId::new();
        let mut record = SetupRecord {
            id,
            name: "Readiness".into(),
            service_id: service.snapshot().await.service_id,
            credential_ref: VaultCredentialRef::new(),
            pending_model_credential: None,
            identity: SessionIdentity {
                workspace_id: id,
                session_id: SessionId::new(),
            },
            stage: SetupStage::TestingDesktop,
            issue: None,
            resume_on_start: false,
            spec: None,
            pinned_host_key: None,
        };
        let failures = [
            ("list_windows", GuestOutcome::Error { error: GuestError {
                code: GuestErrorCode::PermissionDenied,
                message: "Session access refused".into(),
            }}, "Readiness list_windows failed: PermissionDenied: Session access refused"),
            ("press_key", GuestOutcome::Success { result: GuestResult::Desktop {
                result: serde_json::json!({"isError":true,"content":[
                    {"type":"text","text":"Target is not foreground"},
                    {"type":"image","data":"excluded image bytes"}
                ],"structuredContent":{"private":"excluded raw reply"}}),
            }}, "Readiness press_key failed: Target is not foreground"),
            ("get_desktop_state", GuestOutcome::Success { result: GuestResult::Desktop {
                result: serde_json::json!({"isError":true,"content":[]}),
            }}, "Readiness get_desktop_state failed: The desktop tool returned an error without a text reason."),
            ("exec", GuestOutcome::Success { result: GuestResult::ExecFinished {
                exit_code: 1,
                stdout: b"excluded stdout".to_vec(),
                stderr: b"Failed to connect to user bus\n".to_vec(),
            }}, "Readiness exec failed: exit code 1: Failed to connect to user bus"),
        ];
        for (operation, outcome, message) in failures {
            let issue = readiness_result(operation, outcome).unwrap_err();
            assert_eq!(issue.message, message);
            assert_eq!(
                issue.code,
                if operation == "exec" {
                    "guest_exec_failed"
                } else {
                    "guest_not_ready"
                }
            );
            record.issue = Some(issue.clone());
            setup.save(record.clone()).await.unwrap();
            drop(setup);
            setup = KvmSetup::open(
                root.path().to_owned(),
                service.clone(),
                vault.clone(),
                Weak::new(),
            )
            .await
            .unwrap();
            let saved = setup.status().await;
            assert_eq!(saved[0].stage, SetupStage::TestingDesktop);
            assert_eq!(saved[0].issue, Some(issue));
        }
        let mut issue = window_failure_issue(
            window_diagnostics(
                &serde_json::json!({"structuredContent":{"windows":[
                    {"title":"Mousepad", "pid":42, "window_id":7}
                ]}}),
                "Gbot-setup-test",
            ),
            Ok(GuestResult::ExecFinished {
                exit_code: 0,
                stdout: b"ActiveState=failed\nExecMainStatus=1\nCannot open display\n".to_vec(),
                stderr: Vec::new(),
            }),
        );
        let editor = editor_diagnostics(
            Ok(GuestResult::Desktop {
                result: serde_json::json!({
                    "structuredContent":{"pid":42,"window_id":7,"elements_complete":false,
                        "truncated":true,"truncation_reason":"deadline","elements":[
                            {"role":"window","label":"Mousepad"}
                        ]}
                }),
            }),
            "Gbot-setup-test",
        )
        .unwrap();
        issue
            .message
            .push_str(&format!("\nEditor accessibility: {editor}"));
        assert!(issue.message.contains("\"elements_complete\":false"));
        assert_eq!(issue.code, "desktop_not_ready");
        record.issue = Some(issue.clone());
        setup.save(record.clone()).await.unwrap();
        drop(setup);
        setup = KvmSetup::open(
            root.path().to_owned(),
            service.clone(),
            vault.clone(),
            Weak::new(),
        )
        .await
        .unwrap();
        let saved = setup.status().await;
        assert_eq!(saved[0].stage, SetupStage::TestingDesktop);
        assert_eq!(saved[0].issue, Some(issue));
        let runtime = WorkspaceRuntime::new(service, vault);
        let issue = setup
            .guest(
                &runtime,
                &record,
                GuestOperationKind::Desktop {
                    tool: "list_windows".into(),
                    arguments: serde_json::json!({}),
                },
            )
            .await
            .unwrap_err();
        assert!(issue.message.starts_with("Readiness list_windows failed: "));
        assert_eq!(issue.code, "guest_not_ready");
        assert!(matches!(readiness_result("read", GuestOutcome::Success {
            result: GuestResult::Read { data: b"ready".to_vec() },
        }).unwrap(), GuestResult::Read { data } if data == b"ready"));
    }
    #[test]
    fn readiness_editor_isolates_crash_recovery_per_setup() {
        let first = WorkspaceId::new();
        let second = WorkspaceId::new();
        for id in [first, second] {
            let path = GuestPath(format!("/home/gbot/Gbot-setup-{}.txt", id.as_uuid()));
            let command = readiness_editor_command(id, &path);
            let unit = format!("gbot-setup-{}", id.as_uuid());
            assert!(command.contains(&format!(
                "--unit={unit} --property=RuntimeDirectory={unit} "
            )));
            assert!(command.contains("--property=RuntimeDirectoryMode=0700"));
            assert!(command.contains("--property=RuntimeDirectoryPreserve=no"));
            assert!(command.contains(": \"${RUNTIME_DIRECTORY:?}\""));
            assert!(command.contains("export GSETTINGS_BACKEND=memory "));
            for (variable, directory) in [
                ("XDG_CONFIG_HOME", "config"),
                ("XDG_DATA_HOME", "data"),
                ("XDG_CACHE_HOME", "cache"),
                ("XDG_STATE_HOME", "state"),
            ] {
                assert!(command.contains(&format!("{variable}=\"$RUNTIME_DIRECTORY/{directory}\"")));
            }
            assert!(command.contains("/usr/local/bin/gbot-in-session /bin/sh -c 'set -eu;"));
            assert!(command.ends_with(&format!(
                "exec mousepad --disable-server \"$1\"' sh {}",
                path.0
            )));
            let other = if id == first { second } else { first };
            assert!(!command.contains(&other.as_uuid().to_string()));
        }
    }
    #[test]
    fn window_diagnostics_retains_actual_values_and_full_title_matches() {
        let title = "Gbot-setup-test.txt — Mousepad\n\u{1b}";
        let app_name = "Mousepad\teditor";
        let raw = serde_json::json!({"structuredContent":{"windows":[
            {"title":title,"app_name":app_name,"pid":1661,"window_id":27262979},
            {"title":format!("{}Gbot-setup-test", "x".repeat(200)),"app_name":42},
            {"title":null}
        ]}});
        let windows = window_diagnostics(&raw, "Gbot-setup-test");
        assert_eq!(
            windows["windows"][0],
            serde_json::json!({
                "title":title,"app_name":app_name,"title_matches":true,
                "pid":1661,"window_id":27262979
            })
        );
        assert_eq!(windows["windows"][1]["title"], "x".repeat(160));
        assert_eq!(windows["windows"][1]["title_matches"], true);
        assert_eq!(windows["windows"][1]["app_name"], serde_json::Value::Null);
        assert_eq!(
            windows["windows"][2]["title_matches"],
            serde_json::Value::Null
        );
        let issue = window_failure_issue(
            windows,
            Ok(GuestResult::ExecFinished {
                exit_code: 0,
                stdout: b"MainPID=1661\nActiveState=active\n".to_vec(),
                stderr: Vec::new(),
            }),
        );
        assert_eq!(issue.code, "desktop_not_ready");
        assert!(issue.message.contains("MainPID=1661"));
        assert!(issue.message.contains("Mousepad\\n\\u001b"));
        assert!(issue.message.contains("Mousepad\\teditor"));
        assert!(!issue.message.contains('\u{1b}'));
        let command = window_diagnostic_command(WorkspaceId::new(), Some(Duration::from_secs(123)));
        assert!(command.contains("Result,MainPID,ExecMainCode"));
        assert!(command.contains("--since=@123 --lines=12"));
        assert!(command.contains("editor-argv-hex-prefix(max256B)="));
        assert!(command.contains("editor-stat-exit=%s"));
        assert!(command.contains("editor-wchan-exit=%s"));
        assert!(command.contains("mousepad-version-exit=%s"));
        assert!(command.ends_with("| head -c 3072"));
    }
    #[test]
    fn editor_diagnostics_target_only_the_confirmed_unambiguous_unit_window() {
        let raw = serde_json::json!({"structuredContent":{"windows":[
            {"title":"Mousepad","pid":1199,"window_id":27262979},
            {"title":"Terminal","pid":700,"window_id":12}
        ]}});
        let windows = window_diagnostics(&raw, "Gbot-setup-test");
        let completion = |text: &str| {
            Ok(GuestResult::ExecFinished {
                exit_code: 0,
                stdout: text.as_bytes().to_vec(),
                stderr: Vec::new(),
            })
        };
        let status = "ActiveState=active\nMainPID=1199\nunit-status-exit=0\n";
        let target = editor_diagnostic_target(&windows, &completion(status)).unwrap();
        assert_eq!(target["pid"], 1199);
        assert_eq!(target["window_id"], 27262979u64);
        assert_eq!(target["include_screenshot"], false);
        assert_eq!(target["include_accessibility_tree"], true);
        assert_eq!(target["max_elements"], 80);
        assert_eq!(target["max_depth"], 8);
        assert_eq!(target["timeout_ms"], 2000);
        // Pinned Cua rejects display_only with an AX tree. No input or capture fields.
        for field in [
            "display_only",
            "screenshot_out_file",
            "element_token",
            "text",
            "key",
        ] {
            assert!(target.get(field).is_none());
        }
        for invalid in [
            "MainPID=0\nunit-status-exit=0\n",
            "MainPID=1199\nunit-status-exit=1\n",
            "MainPID=1199\nunit-status-exit=",
            "MainPID=1199\nMainPID=700\nunit-status-exit=0\n",
            "MainPID=4000\nunit-status-exit=0\n",
            "MainPID=1199;echo unsafe\nunit-status-exit=0\n",
        ] {
            assert!(editor_diagnostic_target(&windows, &completion(invalid)).is_none());
        }
        let ambiguous = serde_json::json!({"count":2,"windows":[
            {"pid":1199,"window_id":1},{"pid":1199,"window_id":2}
        ]});
        let truncated = serde_json::json!({"count":7,"windows":[
            {"pid":1199,"window_id":1}
        ]});
        for unknown in [ambiguous, truncated, serde_json::Value::Null] {
            assert!(editor_diagnostic_target(&unknown, &completion(status)).is_none());
        }
        assert!(editor_diagnostic_target(
            &windows,
            &Err(SetupIssue::new(
                "guest_not_ready",
                "Transport error",
                "Retry same setup"
            ))
        )
        .is_none());
    }
    #[test]
    fn editor_diagnostics_bound_text_and_keep_partial_observations_explicit() {
        let result = serde_json::json!({
            "isError":false,"content":[{"type":"image","data":"excluded image"}],
            "structuredContent":{
                "pid":1199,"window_id":27262979u64,"elements_complete":false,
                "truncated":true,"truncation_reason":"deadline","nodes_pending":4,
                "tree_markdown":format!("{}Gbot-setup-test", "é\u{1b}".repeat(500)),"snapshot_id":"excluded snapshot",
                "elements":(0..80).map(|n| serde_json::json!({
                    "role":"text","label":format!("{}Gbot-setup-test", "é\u{1b}".repeat(200)),
                    "value":"v".repeat(2000),"depth":2,"parent_index":0,"element_token":format!("excluded token{n}")
                })).collect::<Vec<_>>()
            }
        });
        let projection =
            editor_diagnostics(Ok(GuestResult::Desktop { result }), "Gbot-setup-test").unwrap();
        assert_eq!(projection["observed_document_match"], true);
        assert_eq!(projection["elements_complete"], false);
        assert_eq!(projection["truncation_reason"], "deadline");
        assert_eq!(projection["nodes_pending"], 4);
        assert_eq!(projection["elements"].as_array().unwrap().len(), 20);
        assert_eq!(projection["retained_elements_truncated"], true);
        assert_eq!(projection["retained_tree_truncated"], true);
        assert!(projection["tree_markdown"].to_string().len() <= 770);
        assert_eq!(projection["elements"][0]["depth"], 2);
        assert_eq!(projection["elements"][0]["parent_index"], 0);
        let serialized = projection.to_string();
        assert!(serialized.len() < 8500);
        assert!(!serialized.contains("excluded"));
        assert!(!serialized.contains('\u{1b}'));
        for element in projection["elements"].as_array().unwrap() {
            assert!(element["label"].to_string().len() <= 98);
            assert!(element["value"].to_string().len() <= 98);
        }
        let absent = editor_diagnostics(
            Ok(GuestResult::Desktop {
                result: serde_json::json!({"structuredContent":{}}),
            }),
            "Gbot-setup-test",
        )
        .unwrap();
        assert_eq!(absent["observed_document_match"], serde_json::Value::Null);
        assert_eq!(absent["elements_complete"], serde_json::Value::Null);
        let tree_only = editor_diagnostics(Ok(GuestResult::Desktop {
            result: serde_json::json!({"structuredContent":{"tree_markdown":"Tab: Gbot-setup-test"}})
        }), "Gbot-setup-test").unwrap();
        assert_eq!(tree_only["observed_document_match"], true);
        let tool_error = editor_diagnostics(
            Ok(GuestResult::Desktop {
                result: serde_json::json!({"isError":true,"content":[
                    {"type":"text","text":"Accessibility unavailable"},
                    {"type":"text","text":"x".repeat(500)},
                    {"type":"text","text":"excluded extra error"},
                    {"type":"image","data":"excluded image"}
                ]}),
            }),
            "Gbot-setup-test",
        )
        .unwrap();
        assert_eq!(tool_error["error_text"][0], "Accessibility unavailable");
        assert_eq!(tool_error["error_text"].as_array().unwrap().len(), 2);
        assert!(tool_error["error_text"][1].to_string().len() <= 194);
        assert!(!tool_error.to_string().contains("excluded"));
        let unavailable = editor_diagnostics(
            Err(SetupIssue::new(
                "guest_not_ready",
                "Window is stale",
                "Retry same setup",
            )),
            "Gbot-setup-test",
        )
        .unwrap();
        assert_eq!(unavailable["unavailable"], "Window is stale");
        let cancelled = SetupIssue::new("setup_cancelled", "Cancelled", "Resume same setup");
        assert_eq!(
            editor_diagnostics(Err(cancelled.clone()), "Gbot-setup-test"),
            Err(cancelled)
        );
    }
    #[test]
    fn window_failure_retains_only_bounded_metadata_and_diagnostics() {
        let raw = serde_json::json!({
            "content":[{"type":"image", "data":"excluded screenshot"}],
            "structuredContent":{"windows":(0..20).map(|n| serde_json::json!({
                "title":format!("Editor\u{1b}{}", "é".repeat(200)),
                "app_name":format!("Mousepad\t{}", "\u{1b}".repeat(200)),
                "pid":n, "window_id":n + 1,
                "private":"excluded raw window fields"
            })).collect::<Vec<_>>()}
        });
        let windows = window_diagnostics(&raw, "Gbot-setup-test");
        assert_eq!(windows["count"], 20);
        assert_eq!(windows["windows"].as_array().unwrap().len(), 6);
        assert_eq!(windows["windows"][0]["title_matches"], false);
        assert_eq!(
            windows["windows"][0]["title"],
            format!("Editor\u{1b}{}", "é".repeat(74))
        );
        assert_eq!(
            windows["windows"][0]["app_name"],
            format!("Mousepad\t{}", "\u{1b}".repeat(9))
        );
        for window in windows["windows"].as_array().unwrap() {
            assert!(window["title"].to_string().len() <= 162);
            assert!(window["app_name"].to_string().len() <= 66);
        }
        let issue = window_failure_issue(
            windows,
            Ok(GuestResult::ExecFinished {
                exit_code: 0,
                stdout: "x".repeat(10000).into_bytes(),
                stderr: Vec::new(),
            }),
        );
        assert_eq!(issue.code, "desktop_not_ready");
        assert!(issue
            .message
            .contains("Unit diagnostic collection (exit 0)"));
        assert!(issue.message.len() < 5000);
        assert!(!issue.message.contains("excluded"));
        assert!(!issue.message.contains('\u{1b}'));
        assert_eq!(
            window_diagnostics(
                &serde_json::json!({"structuredContent":{}}),
                "Gbot-setup-test"
            ),
            serde_json::json!({"windows":"missing or not an array"})
        );
        let unavailable = window_failure_issue(
            serde_json::Value::Null,
            Err(SetupIssue::new(
                "guest_not_ready",
                "Transport unavailable",
                "Repair the guest",
            )),
        );
        assert_eq!(unavailable.code, "desktop_not_ready");
        assert!(unavailable.message.contains("Transport unavailable"));
        let cancelled = SetupIssue::new("setup_cancelled", "Cancelled", "Resume same setup");
        assert_eq!(
            window_failure_issue(serde_json::Value::Null, Err(cancelled.clone())),
            cancelled
        );
    }
    #[tokio::test]
    async fn missing_assets_refuse_without_credentials_and_resume_same_owned_id() {
        let root = tempfile::tempdir().unwrap();
        let service = Arc::new(Service::open(root.path().join("state.json")).await.unwrap());
        let vault = Arc::new(MemoryVault::default());
        let setup = Arc::new(
            KvmSetup::open(
                root.path().to_owned(),
                service.clone(),
                vault.clone(),
                Weak::new(),
            )
            .await
            .unwrap(),
        );
        let preflight = setup.preflight().await;
        assert!(!preflight.ready);
        assert_eq!(
            preflight
                .issues
                .iter()
                .filter(|issue| issue.code == "asset_missing")
                .count(),
            3
        );
        assert!(preflight
            .issues
            .iter()
            .all(|issue| !issue.next_action.is_empty()));
        let id = WorkspaceId::new();
        let initial = setup
            .start(StartSetup {
                id,
                name: "Writer".into(),
            })
            .await
            .unwrap();
        settled(&setup).await;
        assert!(setup.status().await[0].issue.is_some());
        assert!(vault.0.lock().await.is_empty());
        assert!(service.snapshot().await.workspaces.is_empty());
        assert!(!setup.root.join(id.as_uuid().to_string()).exists());
        // A persisted historical success must not advertise current runtime readiness.
        let mut historical = setup.status().await[0].clone();
        historical.stage = SetupStage::Ready;
        historical.issue = None;
        setup.save(historical).await.unwrap();
        drop(setup);
        let setup = Arc::new(
            KvmSetup::open(root.path().to_owned(), service, vault, Weak::new())
                .await
                .unwrap(),
        );
        assert_eq!(setup.status().await[0].stage, SetupStage::CheckingPc);
        assert_eq!(
            setup.status().await[0].issue.as_ref().unwrap().code,
            "computer_reconnecting"
        );
        let retry = setup
            .start(StartSetup {
                id,
                name: "Writer".into(),
            })
            .await
            .unwrap();
        assert_eq!(initial.credential_ref, retry.credential_ref);
        assert_eq!(initial.identity, retry.identity);
        settled(&setup).await;
        assert_eq!(setup.status().await.len(), 1);
        assert_eq!(
            setup
                .start(StartSetup {
                    id,
                    name: "Other".into()
                })
                .await
                .unwrap_err()
                .code,
            "setup_conflict"
        );
    }
    #[tokio::test]
    async fn removal_refusal_preserves_ready_setup_and_live_session() {
        let root = tempfile::tempdir().unwrap();
        let service = Arc::new(Service::open(root.path().join("state.json")).await.unwrap());
        let vault = Arc::new(MemoryVault::default());
        let setup = Arc::new(
            KvmSetup::open(
                root.path().to_owned(),
                service.clone(),
                vault.clone(),
                Weak::new(),
            )
            .await
            .unwrap(),
        );
        let id = WorkspaceId::new();
        let record = SetupRecord {
            id,
            name: "Ready bot".into(),
            service_id: service.snapshot().await.service_id,
            credential_ref: VaultCredentialRef::new(),
            pending_model_credential: None,
            identity: SessionIdentity {
                workspace_id: id,
                session_id: SessionId::new(),
            },
            stage: SetupStage::Ready,
            issue: None,
            resume_on_start: true,
            spec: None,
            pinned_host_key: None,
        };
        setup.save(record.clone()).await.unwrap();
        service
            .register_workspace(WorkspaceConfig {
                id,
                name: record.name.clone(),
                service_pc: ServicePc::Local,
                bot_pc: BotPc::LocalVm {
                    host_id: record.service_id,
                    vm_id: id.as_uuid().to_string(),
                    hypervisor: Hypervisor::Kvm,
                },
                connection: WorkspaceConnection::Ssh(SshConnection {
                    endpoint: SshEndpoint {
                        hostname: "127.0.0.1".into(),
                        port: 2222,
                        user: "gbot".into(),
                    },
                    pinned_host_key: SshHostPublicKey {
                        algorithm: "ssh-ed25519".into(),
                        public_key: "AAAA".into(),
                    },
                    credential_ref: record.credential_ref,
                }),
            })
            .await
            .unwrap();
        let brain = crate::service::ModelAssignment {
            workspace_id: id,
            connection: crate::inference::ModelConnection::Endpoint {
                api_base: "http://fixture/v1".into(),
            },
            model: "fixture".into(),
            context_tokens: 131072,
            credential_ref: None,
        };
        service.save_model_assignment(brain.clone()).await.unwrap();
        let hello = GuestHello {
            protocol_version: GUEST_PROTOCOL_VERSION,
            identity: record.identity,
            capabilities: [
                GuestCapability::Exec,
                GuestCapability::Read,
                GuestCapability::Write,
                GuestCapability::Status,
                GuestCapability::Cancel,
            ]
            .into(),
            view: None,
        };
        service
            .register_session(record.identity, hello)
            .await
            .unwrap();
        assert_eq!(setup.remove(id).await.unwrap_err().code, "workspace_in_use");
        let saved = setup
            .status()
            .await
            .into_iter()
            .find(|item| item.id == id)
            .unwrap();
        assert_eq!(saved.stage, SetupStage::Ready);
        assert_eq!(service.model_assignment(id).await.unwrap(), Some(brain));
        // A live operation can still be admitted through the original session.
        service
            .begin_operation(&GuestRequest {
                identity: record.identity,
                operation_id: OperationId::new(),
                operation: GuestOperationKind::Exec {
                    program: "fixture".into(),
                    args: vec![],
                    cwd: GuestPath("/tmp".into()),
                    env: BTreeMap::new(),
                },
            })
            .await
            .unwrap();
        let durable = setup
            .store
            .load::<Vec<SetupRecord>>()
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            durable
                .into_iter()
                .find(|item| item.id == id)
                .unwrap()
                .stage,
            SetupStage::Ready
        );
    }

    #[tokio::test]
    async fn removal_preserves_brain_on_failure_and_retries_credential_cleanup() {
        let root = tempfile::tempdir().unwrap();
        let service = Arc::new(Service::open(root.path().join("state.json")).await.unwrap());
        let vault = Arc::new(MemoryVault::default());
        let mut owner = KvmSetup::open(
            root.path().to_owned(),
            service.clone(),
            vault.clone(),
            Weak::new(),
        )
        .await
        .unwrap();
        let virsh = root.path().join("virsh");
        fs::write(&virsh, "#!/bin/sh\nexit 0\n").await.unwrap();
        fs::set_permissions(&virsh, std::fs::Permissions::from_mode(0o755))
            .await
            .unwrap();
        owner.tools.virsh = virsh.clone();
        let setup = Arc::new(owner);
        let id = WorkspaceId::new();
        let record = setup
            .start(StartSetup {
                id,
                name: "Writer".into(),
            })
            .await
            .unwrap();
        settled(&setup).await;
        service
            .register_workspace(WorkspaceConfig {
                id,
                name: record.name.clone(),
                service_pc: ServicePc::Local,
                bot_pc: BotPc::LocalVm {
                    host_id: record.service_id,
                    vm_id: id.as_uuid().to_string(),
                    hypervisor: Hypervisor::Kvm,
                },
                connection: WorkspaceConnection::Ssh(SshConnection {
                    endpoint: SshEndpoint {
                        hostname: "127.0.0.1".into(),
                        port: 2222,
                        user: "gbot".into(),
                    },
                    pinned_host_key: SshHostPublicKey {
                        algorithm: "ssh-ed25519".into(),
                        public_key: "AAAA".into(),
                    },
                    credential_ref: record.credential_ref,
                }),
            })
            .await
            .unwrap();
        let brain_key = VaultCredentialRef::new();
        let assignment = crate::service::ModelAssignment {
            workspace_id: id,
            connection: crate::inference::ModelConnection::Endpoint {
                api_base: "http://fixture/v1".into(),
            },
            model: "fixture".into(),
            context_tokens: 131072,
            credential_ref: Some(brain_key),
        };
        service
            .save_model_assignment(assignment.clone())
            .await
            .unwrap();
        vault
            .put(brain_key.as_uuid(), Secret::new(b"brain key".to_vec()))
            .await
            .unwrap();
        let directory = setup.root.join(id.as_uuid().to_string());
        fs::create_dir(&directory).await.unwrap();
        fs::write(directory.join("partial.img"), "owned interrupted disk")
            .await
            .unwrap();
        vault
            .put(
                record.credential_ref.as_uuid(),
                Secret::new(b"owned key".to_vec()),
            )
            .await
            .unwrap();
        let unrelated = setup.root.join(Uuid::new_v4().to_string());
        fs::create_dir(&unrelated).await.unwrap();
        assert_eq!(
            setup.remove(WorkspaceId::new()).await.unwrap_err().code,
            "setup_missing"
        );
        fs::write(&virsh, "#!/bin/sh\nexit 1\n").await.unwrap();
        assert_eq!(
            setup.remove(id).await.unwrap_err().code,
            "removal_unconfirmed"
        );
        assert_eq!(
            service.model_assignment(id).await.unwrap(),
            Some(assignment)
        );
        assert!(directory.exists());
        fs::write(&virsh, "#!/bin/sh\nexit 0\n").await.unwrap();
        *vault.1.lock().await = Some(brain_key.as_uuid());
        assert_eq!(
            setup.remove(id).await.unwrap_err().code,
            "credential_cleanup"
        );
        assert!(service.snapshot().await.assignments.is_empty());
        assert!(!directory.exists());
        let saved = setup
            .store
            .load::<Vec<SetupRecord>>()
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            saved
                .iter()
                .find(|record| record.id == id)
                .unwrap()
                .pending_model_credential,
            Some(brain_key)
        );
        drop(setup);
        *vault.1.lock().await = None;
        let mut owner = KvmSetup::open(
            root.path().to_owned(),
            service.clone(),
            vault.clone(),
            Weak::new(),
        )
        .await
        .unwrap();
        owner.tools.virsh = virsh;
        let setup = Arc::new(owner);
        assert_eq!(setup.remove(id).await.unwrap().stage, SetupStage::Removed);
        assert_eq!(setup.remove(id).await.unwrap().stage, SetupStage::Removed);
        assert!(vault.get(brain_key.as_uuid()).await.unwrap().is_none());
        assert!(!directory.exists());
        assert!(unrelated.exists());
        assert!(vault
            .get(record.credential_ref.as_uuid())
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            setup
                .start(StartSetup {
                    id,
                    name: "Writer".into()
                })
                .await
                .unwrap_err()
                .code,
            "setup_conflict"
        );
    }
}
