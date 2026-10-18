//! Owned Hyper-V guests. PowerShell is a transport, never a host installer.
use crate::{
    kvm::{GuestBinary, KvmSpec, VmState},
    kvm_setup::SetupIssue,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::File,
    io,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::{
    fs,
    io::AsyncWriteExt,
    net::{TcpListener, TcpStream},
    process::Command,
    task::{JoinHandle, JoinSet},
};
use uuid::Uuid;

const SCRIPT: &str = include_str!("hyperv.ps1");

#[derive(Clone, Debug)]
pub struct HypervTools {
    pub powershell: PathBuf,
}
impl Default for HypervTools {
    fn default() -> Self {
        Self {
            powershell: "powershell.exe".into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StorageCandidate {
    pub root: PathBuf,
    pub free_bytes: u64,
    pub system: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Detection {
    pub issues: Vec<SetupIssue>,
    pub storage_candidates: Vec<StorageCandidate>,
    pub preferred_root: Option<PathBuf>,
    pub cpus: u16,
    pub memory_mib: u32,
}

pub async fn detect(root: &Path) -> io::Result<Detection> {
    detect_with_tools(root, &HypervTools::default()).await
}

pub async fn detect_with_tools(root: &Path, tools: &HypervTools) -> io::Result<Detection> {
    request(tools, json!({"action": "detect", "directory": root})).await
}

/// Validate the persisted storage choice without moving an existing guest.
pub async fn detect_saved_root(root: &Path, tools: &HypervTools) -> io::Result<Detection> {
    request(tools, json!({"action": "detect", "saved_root": root})).await
}

/// Use Windows' built-in checksum provider; never substitute an unpinned asset.
pub async fn validate_assets(
    tools: &HypervTools,
    assets: &[(PathBuf, String, Option<u64>)],
) -> io::Result<()> {
    for (path, digest, bytes) in assets {
        let metadata = fs::metadata(path).await?;
        if !metadata.is_file() || bytes.is_some_and(|expected| metadata.len() != expected) {
            return Err(invalid(
                "guest asset size does not match the accepted artifact",
            ));
        }
        if !matches!(digest.len(), 64 | 128) || !digest.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(invalid("guest assets require SHA-256 or SHA-512 digests"));
        }
        let result: Value = request(
            tools,
            json!({"action": "hash", "path": path, "digest": digest}),
        )
        .await?;
        if result["matches"] != true {
            return Err(io::Error::other(format!(
                "{} does not match the accepted guest asset digest",
                path.display()
            )));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedVm {
    pub directory: PathBuf,
    pub spec: KvmSpec,
    #[serde(default)]
    registered_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct Registration {
    registered: bool,
    vm_id: Option<Uuid>,
}

pub async fn inspect_registered(
    tools: &HypervTools,
    id: Uuid,
    directory: &Path,
) -> io::Result<bool> {
    let directory = local_path(directory);
    validate_directory(&directory, id)?;
    match fs::symlink_metadata(&directory).await {
        Ok(metadata) => {
            if !metadata.is_dir() || canonical_local(&directory).await? != directory {
                return Err(invalid(
                    "VM directory must not redirect to another directory",
                ));
            }
            reject_redirects(&directory).await?;
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let registration: Registration = request(
        tools,
        json!({"action": "inspect", "id": id, "directory": directory}),
    )
    .await?;
    Ok(registration.registered)
}

impl PreparedVm {
    pub async fn prepare(
        root: &Path,
        cloud_image: &Path,
        mut spec: KvmSpec,
        tools: &HypervTools,
    ) -> io::Result<Self> {
        let root = canonical_local(root).await?;
        let image = canonical_local(cloud_image).await?;
        // The setup owner validates the pinned image at its service asset root;
        // guest disks can live on a different, non-system drive.
        let directory = root.join(spec.id.to_string());
        match fs::create_dir(&directory).await {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
        if canonical_local(&directory).await? != directory {
            return Err(invalid(
                "VM directory must not redirect to another directory",
            ));
        }
        validate_directory(&directory, spec.id)?;
        reject_redirects(&directory).await?;
        let _lease = lease(&directory).await?;
        let saved = match fs::read(directory.join("setup.json")).await {
            Ok(bytes) => Some(serde_json::from_slice::<Self>(&bytes)?),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let mut entries = fs::read_dir(&directory).await?;
                while let Some(entry) = entries.next_entry().await? {
                    let name = entry.file_name();
                    let name = name.to_string_lossy();
                    if name != "owner.lock"
                        && name != "setup.lock"
                        && !(name.starts_with("setup.json.") && name.ends_with(".tmp"))
                    {
                        return Err(invalid("VM directory has no owned setup claim"));
                    }
                }
                None
            }
            Err(error) => return Err(error),
        };
        if spec.ssh_port == 0 {
            spec.ssh_port = match &saved {
                Some(saved) => saved.spec.ssh_port,
                None => std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?
                    .local_addr()?
                    .port(),
            };
        }
        spec.validate()?;
        let mut vm = match saved {
            Some(saved)
                if saved.directory == directory
                    && serde_json::to_value(&saved.spec)? == serde_json::to_value(&spec)? =>
            {
                saved
            }
            Some(_) => return Err(invalid("owned VM differs from the saved setup request")),
            None => Self {
                directory,
                spec,
                registered_id: None,
            },
        };
        let store = Arc::new(
            crate::store::Store::open(vm.directory.join("setup.json"))
                .await
                .map_err(io::Error::other)?,
        );
        store.save(&vm).await.map_err(io::Error::other)?;
        if vm.directory.join("prepared").is_file() {
            let registration: Registration = vm.call(tools, "inspect").await?;
            if !registration.registered || registration.vm_id != vm.registered_id {
                return Err(invalid(
                    "saved Hyper-V guest is no longer registered as owned",
                ));
            }
            return Ok(vm);
        }
        let seed = vm.directory.join("seed");
        fs::create_dir_all(&seed).await?;
        fs::write(seed.join("user-data"), vm.spec.cloud_init()?).await?;
        fs::write(
            seed.join("meta-data"),
            format!("instance-id: {}\n", vm.spec.id),
        )
        .await?;
        for (name, binary) in [
            ("cua-driver.tar.gz", &vm.spec.driver),
            ("cua-media.tar.gz", &vm.spec.media),
        ] {
            if let GuestBinary::SeedArchive { path, sha256 } = binary {
                let path = canonical_local(path).await?;
                validate_assets(tools, &[(path.clone(), sha256.clone(), None)]).await?;
                fs::copy(path, seed.join(name)).await?;
            }
        }
        let mut operation = vm.operation("prepare");
        operation["image"] = json!(image);
        operation["cpus"] = json!(vm.spec.cpus);
        operation["memory_mib"] = json!(vm.spec.memory_mib);
        operation["disk_gib"] = json!(vm.spec.disk_gib);
        let result: Registration = request(tools, operation).await?;
        if !result.registered || result.vm_id.is_none_or(|id| id.is_nil()) {
            return Err(invalid("Hyper-V did not confirm the owned guest identity"));
        }
        vm.registered_id = result.vm_id;
        store.save(&vm).await.map_err(io::Error::other)?;
        fs::write(vm.directory.join("prepared"), b"1\n").await?;
        Ok(vm)
    }

    pub async fn open(directory: &Path) -> io::Result<Self> {
        let directory = canonical_local(directory).await?;
        let vm: Self = serde_json::from_slice(&fs::read(directory.join("setup.json")).await?)?;
        if vm.directory != directory || vm.registered_id.is_none_or(|id| id.is_nil()) {
            return Err(invalid(
                "saved Hyper-V preparation has no confirmed identity",
            ));
        }
        validate_directory(&directory, vm.spec.id)?;
        reject_redirects(&directory).await?;
        vm.spec.validate()?;
        fs::metadata(directory.join("prepared")).await?;
        Ok(vm)
    }

    fn operation(&self, action: &str) -> Value {
        json!({
            "action": action,
            "id": self.spec.id,
            "directory": self.directory,
            "vm_id": self.registered_id,
        })
    }

    async fn call<T: DeserializeOwned>(&self, tools: &HypervTools, action: &str) -> io::Result<T> {
        request(tools, self.operation(action)).await
    }

    pub async fn state(&self, tools: &HypervTools) -> io::Result<VmState> {
        let result: Value = self.call(tools, "state").await?;
        parse_state(&result)
    }

    async fn change(&self, tools: &HypervTools, action: &str) -> io::Result<VmState> {
        let _lease = lease(&self.directory).await?;
        let result: Value = self.call(tools, action).await?;
        parse_state(&result)
    }

    pub async fn start(&self, tools: &HypervTools) -> io::Result<VmState> {
        self.change(tools, "start").await
    }

    pub async fn stop(&self, tools: &HypervTools) -> io::Result<VmState> {
        self.change(tools, "stop").await
    }

    pub async fn shutdown(&self, tools: &HypervTools) -> io::Result<VmState> {
        self.stop(tools).await
    }

    pub async fn force_stop(&self, tools: &HypervTools) -> io::Result<VmState> {
        self.change(tools, "force_stop").await
    }

    pub async fn unregister(&self, tools: &HypervTools) -> io::Result<()> {
        let _lease = lease(&self.directory).await?;
        let result: Value = self.call(tools, "unregister").await?;
        if result["removed"] != true {
            return Err(io::Error::other("Hyper-V did not confirm removal"));
        }
        match fs::remove_file(self.directory.join("prepared")).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }

    pub async fn endpoint(&self, tools: &HypervTools) -> io::Result<SocketAddr> {
        #[derive(Deserialize)]
        struct Addresses {
            addresses: Vec<Ipv4Addr>,
        }
        let result: Addresses = self.call(tools, "endpoint").await?;
        let address = result
            .addresses
            .into_iter()
            .find(Ipv4Addr::is_private)
            .ok_or_else(|| io::Error::other("the owned guest has no private IPv4 address yet"))?;
        Ok(SocketAddr::new(IpAddr::V4(address), 22))
    }

    /// Retain this handle before first start and until this guest is stopped.
    /// A trusted host serial channel supplies the SSH key; no network TOFU.
    pub async fn capture_serial(&self, tools: &HypervTools) -> io::Result<SerialCapture> {
        self.state(tools).await?;
        serial_capture(self.clone(), tools.clone()).await
    }
}

fn parse_state(value: &Value) -> io::Result<VmState> {
    match value["state"].as_str() {
        Some("Running") => Ok(VmState::Running),
        Some("Off") => Ok(VmState::Stopped),
        Some("Paused" | "Saved") => Ok(VmState::Paused),
        Some("Critical" | "Other") => Ok(VmState::Crashed),
        Some("Starting" | "Stopping" | "Saving" | "Pausing" | "Resuming" | "Reset") => {
            Ok(VmState::Transitioning)
        }
        _ => Err(io::Error::other("Hyper-V guest state is unavailable")),
    }
}

fn validate_directory(directory: &Path, id: Uuid) -> io::Result<()> {
    let expected = id.to_string();
    if id.is_nil()
        || !directory.is_absolute()
        || directory.file_name().and_then(|name| name.to_str()) != Some(expected.as_str())
    {
        return Err(invalid(
            "Hyper-V guest directory does not match its owned identity",
        ));
    }
    Ok(())
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

async fn reject_redirects(directory: &Path) -> io::Result<()> {
    let mut directories = vec![directory.to_path_buf()];
    while let Some(directory) = directories.pop() {
        let mut entries = fs::read_dir(directory).await?;
        while let Some(entry) = entries.next_entry().await? {
            let metadata = fs::symlink_metadata(entry.path()).await?;
            let redirected = metadata.file_type().is_symlink();
            #[cfg(target_os = "windows")]
            let redirected = {
                use std::os::windows::fs::MetadataExt;
                redirected || metadata.file_attributes() & 0x400 != 0
            };
            if redirected {
                return Err(invalid(
                    "owned guest files must not contain links or junctions",
                ));
            }
            if metadata.is_dir() {
                directories.push(entry.path());
            }
        }
    }
    Ok(())
}

// Rust canonicalization adds a Windows verbatim prefix; PowerShell uses local
// drive paths. UNC paths remain unsupported by the production boundary.
fn local_path(path: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    if let Some(path) = path.to_str().and_then(|path| path.strip_prefix(r"\\?\")) {
        return PathBuf::from(path);
    }
    path.to_path_buf()
}

async fn canonical_local(path: &Path) -> io::Result<PathBuf> {
    Ok(local_path(&fs::canonicalize(path).await?))
}

async fn lease(directory: &Path) -> io::Result<File> {
    let path = directory.join("owner.lock");
    tokio::task::spawn_blocking(move || {
        let file = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)?;
        crate::store::try_lock_settled(&file).map_err(|_| {
            io::Error::new(
                io::ErrorKind::WouldBlock,
                "a guest lifecycle action is in progress",
            )
        })?;
        Ok(file)
    })
    .await
    .map_err(io::Error::other)?
}

async fn request<T: DeserializeOwned>(tools: &HypervTools, value: Value) -> io::Result<T> {
    let input = serde_json::to_vec(&value)?;
    let mut child = Command::new(&tools.powershell)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            SCRIPT,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            io::Error::new(
                error.kind(),
                format!("Windows PowerShell is unavailable: {error}"),
            )
        })?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| invalid("PowerShell input unavailable"))?;
    stdin.write_all(&input).await?;
    drop(stdin);
    // A timeout is uncertain, so callers retain the claim and inspect on retry.
    let output = tokio::time::timeout(Duration::from_secs(600), child.wait_with_output())
        .await
        .map_err(|_| {
            io::Error::new(
                io::ErrorKind::TimedOut,
                "Hyper-V operation timed out; retain this setup and retry to reconcile it",
            )
        })??;
    if !output.status.success() {
        return Err(io::Error::other(format!(
            "Hyper-V operation failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    serde_json::from_slice(&output.stdout).map_err(io::Error::other)
}

pub struct SerialCapture {
    task: JoinHandle<()>,
}
impl Drop for SerialCapture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[cfg(target_os = "windows")]
async fn serial_capture(vm: PreparedVm, tools: HypervTools) -> io::Result<SerialCapture> {
    use tokio::{io::AsyncReadExt, net::windows::named_pipe::ClientOptions};
    let path = vm.directory.join("serial.lock");
    let lock = tokio::task::spawn_blocking(move || {
        let file = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)?;
        crate::store::try_lock_settled(&file).map_err(io::Error::other)?;
        Ok::<_, io::Error>(file)
    })
    .await
    .map_err(io::Error::other)??;
    let mut log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(vm.directory.join("serial.log"))
        .await?;
    let pipe = format!(r"\\.\pipe\GChat-Gbot-{}", vm.spec.id);
    let (ready, listening) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        let _lock = lock;
        let mut ready = Some(ready);
        let mut written = log.metadata().await.map(|meta| meta.len()).unwrap_or(0);
        loop {
            // The owner validated this COM pipe before creating this reader.
            // Keep the first connection attempt active across VM startup; a
            // PowerShell subprocess on every poll could miss first-boot output.
            let connected = ClientOptions::new().read(true).write(false).open(&pipe);
            if let Some(ready) = ready.take() {
                let _ = ready.send(());
            }
            if let Ok(mut serial) = connected {
                let mut bytes = [0; 8192];
                loop {
                    match serial.read(&mut bytes).await {
                        Ok(0) | Err(_) => break,
                        Ok(count) => {
                            written += count as u64;
                            if written > 16 * 1024 * 1024
                                || log.write_all(&bytes[..count]).await.is_err()
                            {
                                return;
                            }
                            if log.flush().await.is_err() {
                                return;
                            }
                        }
                    }
                }
                // Revalidate ownership before reconnecting a previously open
                // channel. Parent drops this reader before any lifecycle stop.
                if vm.state(&tools).await.is_err() {
                    return;
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    });
    if listening.await.is_err() {
        task.abort();
        return Err(io::Error::other("the owned serial reader could not start"));
    }
    Ok(SerialCapture { task })
}

#[cfg(not(target_os = "windows"))]
async fn serial_capture(_: PreparedVm, _: HypervTools) -> io::Result<SerialCapture> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Hyper-V serial capture requires Windows",
    ))
}

/// Owns the loopback listener and every accepted forwarding connection.
pub struct SshRelay {
    task: JoinHandle<()>,
}
impl SshRelay {
    pub async fn start(vm: &PreparedVm, tools: &HypervTools) -> io::Result<Self> {
        if vm.state(tools).await? != VmState::Running {
            return Err(io::Error::other("the owned guest is not running"));
        }
        // DHCP can finish after first start. Resolve the owned guest address
        // when an SSH client actually connects, after trusted serial bootstrap.
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, vm.spec.ssh_port)).await?;
        let vm = vm.clone();
        let tools = tools.clone();
        let task = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let Ok((mut client, _)) = accepted else { break };
                        let vm = vm.clone();
                        let tools = tools.clone();
                        connections.spawn(async move {
                            let Ok(Ok(endpoint)) = tokio::time::timeout(Duration::from_secs(15), vm.endpoint(&tools)).await else { return };
                            let Ok(Ok(mut guest)) = tokio::time::timeout(Duration::from_secs(10), TcpStream::connect(endpoint)).await else { return };
                            let _ = tokio::io::copy_bidirectional(&mut client, &mut guest).await;
                        });
                    }
                    _ = connections.join_next(), if !connections.is_empty() => {}
                }
            }
            // JoinSet also aborts all connections if this outer task is aborted.
            connections.abort_all();
        });
        Ok(Self { task })
    }
}
impl Drop for SshRelay {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use crate::kvm::{CUA_DRIVER_REVISION, CUA_REVISION};
    use std::os::unix::fs::{symlink, PermissionsExt};

    // This executable checks the Rust JSON/process boundary only. It does not
    // execute or qualify hyperv.ps1; the separate module fake covers that code.
    const JSON_BOUNDARY: &str = r#"#!/usr/bin/env python3
import hashlib, json, pathlib, sys
assert sys.argv[1:5] == ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']
script = pathlib.Path(__file__)
request = json.load(sys.stdin)
with script.with_suffix('.requests').open('a') as output:
    output.write(json.dumps(request) + '\n')
if script.with_suffix('.reject').exists():
    sys.stderr.write('owned guest operation was not accepted')
    sys.exit(1)
state_path = script.with_suffix('.state')
state = json.loads(state_path.read_text())
action = request['action']
if action == 'detect':
    result = dict(issues=[], storage_candidates=[dict(root='F:\\', free_bytes=80 * 1024**3, system=False)],
                  preferred_root=request.get('saved_root', 'F:\\GChat\\vms'), cpus=8, memory_mib=32768)
elif action == 'hash':
    digest = hashlib.sha256 if len(request['digest']) == 64 else hashlib.sha512
    result = dict(matches=digest(pathlib.Path(request['path']).read_bytes()).hexdigest() == request['digest'].lower())
elif action in ('prepare', 'inspect'):
    if action == 'prepare':
        state['registered'] = True
    result = dict(registered=state['registered'], vm_id=state['vm_id'] if state['registered'] else None)
elif action == 'unregister':
    state['registered'] = False
    result = dict(removed=True)
elif action == 'endpoint':
    result = dict(addresses=['127.0.0.1', '172.22.1.8'])
else:
    if action == 'start':
        state['state'] = 'Running'
    elif action in ('stop', 'force_stop'):
        state['state'] = 'Off'
    result = dict(state=state['state'])
state_path.write_text(json.dumps(state))
json.dump(result, sys.stdout)
"#;

    struct Fixture {
        _root: tempfile::TempDir,
        directory: PathBuf,
        image: PathBuf,
        tools: HypervTools,
        registered_id: Uuid,
    }

    impl Fixture {
        fn new() -> Self {
            let root = tempfile::tempdir().unwrap();
            let directory = root.path().join("owned guests");
            std::fs::create_dir(&directory).unwrap();
            let image = root.path().join("pinned guest image.vhdx");
            std::fs::write(&image, b"accepted fixture").unwrap();
            let powershell = root.path().join("PowerShell boundary.py");
            std::fs::write(&powershell, JSON_BOUNDARY).unwrap();
            std::fs::set_permissions(&powershell, std::fs::Permissions::from_mode(0o700)).unwrap();
            let registered_id = Uuid::new_v4();
            std::fs::write(
                powershell.with_extension("state"),
                serde_json::to_vec(&json!({
                    "registered": false, "vm_id": registered_id, "state": "Off"
                }))
                .unwrap(),
            )
            .unwrap();
            Self {
                _root: root,
                directory,
                image,
                tools: HypervTools { powershell },
                registered_id,
            }
        }

        fn requests(&self) -> Vec<Value> {
            std::fs::read_to_string(self.tools.powershell.with_extension("requests"))
                .unwrap_or_default()
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect()
        }

        fn backend(&self, registered: bool, id: Uuid, state: &str) {
            std::fs::write(
                self.tools.powershell.with_extension("state"),
                serde_json::to_vec(&json!({
                    "registered": registered, "vm_id": id, "state": state
                }))
                .unwrap(),
            )
            .unwrap();
        }

        async fn prepare(&self, spec: KvmSpec) -> io::Result<PreparedVm> {
            PreparedVm::prepare(&self.directory, &self.image, spec, &self.tools).await
        }
    }

    fn spec() -> KvmSpec {
        let key = russh::keys::PrivateKey::random(
            &mut russh::keys::key::safe_rng(),
            russh::keys::Algorithm::Ed25519,
        )
        .unwrap();
        let binary = GuestBinary::Download {
            url: "https://example.test/accepted-guest-binary".into(),
            sha256: "a".repeat(64),
        };
        KvmSpec {
            id: Uuid::new_v4(),
            cpus: 2,
            host_cpus: Vec::new(),
            memory_mib: 4096,
            disk_gib: 40,
            ssh_port: 0,
            ssh_public_key: key.public_key().to_openssh().unwrap(),
            browser_package: "firefox-esr".into(),
            driver: binary.clone(),
            driver_revision: CUA_DRIVER_REVISION.into(),
            media: binary,
            media_revision: CUA_REVISION.into(),
        }
    }

    #[tokio::test]
    async fn json_boundary_distinguishes_new_storage_selection_from_saved_root_validation() {
        let fixture = Fixture::new();
        let service_root = fixture.directory.join("not-created-by-detection");
        let report = detect_with_tools(&service_root, &fixture.tools)
            .await
            .unwrap();
        assert_eq!(report.preferred_root, Some(PathBuf::from(r"F:\GChat\vms")));
        assert_eq!(report.cpus, 8);
        assert!(report.issues.is_empty());
        assert!(!service_root.exists());
        let saved = Path::new(r"D:\original volume\vms");
        let report = detect_saved_root(saved, &fixture.tools).await.unwrap();
        assert_eq!(report.preferred_root.as_deref(), Some(saved));
        let requests = fixture.requests();
        assert_eq!(requests.len(), 2);
        assert_eq!(
            requests[0],
            json!({
                "action": "detect", "directory": service_root
            })
        );
        assert_eq!(
            requests[1],
            json!({
                "action": "detect", "saved_root": saved
            })
        );
    }

    #[tokio::test]
    async fn json_boundary_requires_pinned_digests_and_refuses_changed_assets() {
        let fixture = Fixture::new();
        let asset = fixture.directory.join("empty accepted asset");
        std::fs::write(&asset, b"").unwrap();
        let sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let sha512 = concat!(
            "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce",
            "47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e"
        );
        validate_assets(
            &fixture.tools,
            &[
                (asset.clone(), sha256.into(), Some(0)),
                (asset.clone(), sha512.into(), Some(0)),
            ],
        )
        .await
        .unwrap();
        std::fs::write(&asset, b"changed").unwrap();
        let before_size_refusal = fixture.requests().len();
        assert!(
            validate_assets(&fixture.tools, &[(asset.clone(), sha256.into(), Some(0))])
                .await
                .is_err()
        );
        assert_eq!(fixture.requests().len(), before_size_refusal);
        assert!(
            validate_assets(&fixture.tools, &[(asset.clone(), sha256.into(), Some(7))])
                .await
                .is_err()
        );
        assert_eq!(fixture.requests().len(), before_size_refusal + 1);
        assert_eq!(std::fs::read(&asset).unwrap(), b"changed");
        let count = fixture.requests().len();
        for invalid_digest in ["a".repeat(40), "z".repeat(64)] {
            assert_eq!(
                validate_assets(&fixture.tools, &[(asset.clone(), invalid_digest, None)])
                    .await
                    .unwrap_err()
                    .kind(),
                io::ErrorKind::InvalidData
            );
        }
        assert_eq!(fixture.requests().len(), count);
    }

    #[tokio::test]
    async fn json_boundary_prepare_is_idempotent_and_keeps_both_owned_identities() {
        let fixture = Fixture::new();
        let requested = spec();
        let vm = fixture.prepare(requested.clone()).await.unwrap();
        assert_ne!(vm.spec.ssh_port, 0);
        assert_eq!(vm.spec.id, requested.id);
        assert_eq!(vm.registered_id, Some(fixture.registered_id));
        let reopened = PreparedVm::open(&vm.directory).await.unwrap();
        let retried = fixture.prepare(requested.clone()).await.unwrap();
        assert_eq!(retried.spec.ssh_port, reopened.spec.ssh_port);
        assert_eq!(retried.registered_id, reopened.registered_id);
        let requests = fixture.requests();
        assert_eq!(
            requests
                .iter()
                .filter(|request| request["action"] == "prepare")
                .count(),
            1
        );
        let prepare = &requests[0];
        assert_eq!(prepare["id"], json!(requested.id));
        assert_eq!(prepare["vm_id"], Value::Null);
        assert_eq!(prepare["directory"], json!(vm.directory));
        assert_eq!(prepare["image"], json!(fixture.image));
        assert!(prepare.get("image_tool").is_none());
        assert_eq!(prepare["disk_gib"], 40);
        assert_eq!(requests[1]["vm_id"], json!(fixture.registered_id));
        let mut changed = requested.clone();
        changed.memory_mib *= 2;
        assert!(fixture.prepare(changed).await.is_err());
        assert_eq!(fixture.requests().len(), requests.len());
        fixture.backend(true, Uuid::new_v4(), "Off");
        assert!(fixture.prepare(requested).await.is_err());
        assert_eq!(
            PreparedVm::open(&vm.directory).await.unwrap().registered_id,
            Some(fixture.registered_id)
        );
        assert!(vm.directory.join("prepared").exists());
    }

    #[tokio::test]
    async fn json_boundary_refuses_foreign_files_redirects_and_changed_claim_paths() {
        let fixture = Fixture::new();
        let requested = spec();
        let directory = fixture.directory.join(requested.id.to_string());
        std::fs::create_dir(&directory).unwrap();
        let foreign = directory.join("keep-this-file");
        std::fs::write(&foreign, b"foreign data").unwrap();
        assert!(fixture.prepare(requested).await.is_err());
        assert_eq!(std::fs::read(&foreign).unwrap(), b"foreign data");
        let redirected = spec();
        symlink(
            &directory,
            fixture.directory.join(redirected.id.to_string()),
        )
        .unwrap();
        assert!(fixture.prepare(redirected.clone()).await.is_err());
        assert!(inspect_registered(
            &fixture.tools,
            redirected.id,
            &fixture.directory.join(redirected.id.to_string())
        )
        .await
        .is_err());
        assert!(fixture.requests().is_empty());
        let vm = fixture.prepare(spec()).await.unwrap();
        let mut claim: Value =
            serde_json::from_slice(&std::fs::read(vm.directory.join("setup.json")).unwrap())
                .unwrap();
        claim["directory"] = json!(fixture.directory);
        std::fs::write(
            vm.directory.join("setup.json"),
            serde_json::to_vec(&claim).unwrap(),
        )
        .unwrap();
        assert!(PreparedVm::open(&vm.directory).await.is_err());
        assert_eq!(std::fs::read(&foreign).unwrap(), b"foreign data");
    }

    #[tokio::test]
    async fn json_boundary_uncertain_preparation_retains_claim_and_reuses_reserved_port() {
        let fixture = Fixture::new();
        let requested = spec();
        fixture.backend(false, Uuid::nil(), "Off");
        assert!(fixture.prepare(requested.clone()).await.is_err());
        let directory = fixture.directory.join(requested.id.to_string());
        let claim: PreparedVm =
            serde_json::from_slice(&std::fs::read(directory.join("setup.json")).unwrap()).unwrap();
        assert_ne!(claim.spec.ssh_port, 0);
        assert_eq!(claim.registered_id, None);
        assert!(!directory.join("prepared").exists());
        fixture.backend(false, fixture.registered_id, "Off");
        let vm = fixture.prepare(requested).await.unwrap();
        assert_eq!(vm.spec.ssh_port, claim.spec.ssh_port);
        assert_eq!(vm.spec.id, claim.spec.id);
        assert_eq!(vm.registered_id, Some(fixture.registered_id));
    }

    #[tokio::test]
    async fn json_boundary_lifecycle_targets_exact_guest_and_requires_confirmed_state() {
        let fixture = Fixture::new();
        let vm = fixture.prepare(spec()).await.unwrap();
        assert_eq!(vm.state(&fixture.tools).await.unwrap(), VmState::Stopped);
        assert_eq!(vm.start(&fixture.tools).await.unwrap(), VmState::Running);
        assert_eq!(
            vm.endpoint(&fixture.tools).await.unwrap(),
            "172.22.1.8:22".parse::<SocketAddr>().unwrap()
        );
        assert_eq!(vm.stop(&fixture.tools).await.unwrap(), VmState::Stopped);
        assert_eq!(vm.start(&fixture.tools).await.unwrap(), VmState::Running);
        assert_eq!(
            vm.force_stop(&fixture.tools).await.unwrap(),
            VmState::Stopped
        );
        let reject = fixture.tools.powershell.with_extension("reject");
        std::fs::write(&reject, b"reject lifecycle request").unwrap();
        let failure = vm.start(&fixture.tools).await.unwrap_err();
        assert!(failure
            .to_string()
            .contains("owned guest operation was not accepted"));
        assert!(vm.directory.join("prepared").exists());
        std::fs::remove_file(reject).unwrap();
        fixture.backend(true, fixture.registered_id, "unrecognized-state");
        assert!(vm.state(&fixture.tools).await.is_err());
        fixture.backend(true, fixture.registered_id, "Off");
        vm.unregister(&fixture.tools).await.unwrap();
        assert!(!vm.directory.join("prepared").exists());
        assert!(vm.directory.join("setup.json").exists());
        let requests = fixture.requests();
        let actions: Vec<_> = requests
            .iter()
            .map(|request| request["action"].as_str().unwrap())
            .collect();
        assert_eq!(
            actions,
            [
                "prepare",
                "state",
                "start",
                "endpoint",
                "stop",
                "start",
                "force_stop",
                "start",
                "state",
                "unregister"
            ]
        );
        for request in requests.iter().skip(1) {
            assert_eq!(request["id"], json!(vm.spec.id));
            assert_eq!(request["directory"], json!(vm.directory));
            assert_eq!(request["vm_id"], json!(fixture.registered_id));
        }
    }
}
