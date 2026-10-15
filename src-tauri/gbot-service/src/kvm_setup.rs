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
    time::Duration,
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
        let hello = runtime.connect_for_setup(record.identity).await.map_err(|error| SetupIssue::new("guest_not_ready", error.to_string(), "Wait for guest cloud-init and the desktop session to complete, then retry this same setup."))?;
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
        let unit = format!("gbot-setup-{}", record.id.as_uuid());
        let command = format!("systemctl --user stop {unit}.service 2>/dev/null; systemctl --user reset-failed {unit}.service 2>/dev/null; systemd-run --user --collect --unit={unit} /usr/local/bin/gbot-in-session mousepad --disable-server {}", path.0);
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
        let window = window.ok_or_else(|| {
            SetupIssue::new(
                "desktop_not_ready",
                "Readiness list_windows did not observe the dedicated guest document window.",
                action,
            )
        })?;
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
