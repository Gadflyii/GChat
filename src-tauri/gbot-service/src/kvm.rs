use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io,
    path::{Path, PathBuf},
};
use tokio::{fs, process::Command};
use uuid::Uuid;

pub const CUA_REVISION: &str = "0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc";
pub const CUA_DRIVER_REVISION: &str = "c549ab4d7f31a08c339da1732700b6664af438a6";
const CLOUD_INIT: &str = include_str!("../guest/cloud-init.json");

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case", deny_unknown_fields)]
pub enum GuestBinary {
    Download { url: String, sha256: String },
    SeedArchive { path: PathBuf, sha256: String },
}

impl GuestBinary {
    fn validate(&self) -> io::Result<()> {
        let digest = self.sha256();
        if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "guest binaries need SHA-256 digests",
            ));
        }
        match self {
            Self::Download { url, .. } => {
                let uri: hyper::Uri = url.parse().map_err(|_| {
                    io::Error::new(io::ErrorKind::InvalidInput, "invalid guest binary URL")
                })?;
                if uri.scheme_str() != Some("https")
                    || uri.host().is_none()
                    || uri.query().is_some()
                    || url.contains(['@', '#'])
                    || url
                        .bytes()
                        .any(|b| b.is_ascii_control() || b == b'\'' || b == b' ')
                {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "guest binaries need HTTPS URLs",
                    ));
                }
            }
            Self::SeedArchive { path, .. } => {
                if !path.is_absolute() || !path.is_file() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "guest archive must be an existing absolute file",
                    ));
                }
            }
        }
        Ok(())
    }

    fn sha256(&self) -> &str {
        match self {
            Self::Download { sha256, .. } | Self::SeedArchive { sha256, .. } => sha256,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KvmSpec {
    pub id: Uuid,
    pub cpus: u16,
    #[serde(default)]
    pub host_cpus: Vec<u16>,
    pub memory_mib: u32,
    pub disk_gib: u32,
    pub ssh_port: u16,
    pub ssh_public_key: String,
    pub browser_package: String,
    pub driver: GuestBinary,
    pub driver_revision: String,
    pub media: GuestBinary,
    pub media_revision: String,
}

impl KvmSpec {
    pub fn validate(&self) -> io::Result<()> {
        let key =
            russh::keys::ssh_key::PublicKey::from_openssh(&self.ssh_public_key).map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidInput, "invalid guest SSH public key")
            })?;
        if self.id.is_nil()
            || self.cpus == 0
            || (!self.host_cpus.is_empty()
                && (self.host_cpus.len() < usize::from(self.cpus)
                    || self
                        .host_cpus
                        .iter()
                        .collect::<std::collections::BTreeSet<_>>()
                        .len()
                        != self.host_cpus.len()))
            || self.memory_mib < 2048
            || self.disk_gib == 0
            || self.ssh_port == 0
            || self.browser_package.is_empty()
            || !self
                .browser_package
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"+.-".contains(&b))
            || self.browser_package.starts_with('-')
            || self.media_revision != CUA_REVISION
            || self.driver_revision != CUA_DRIVER_REVISION
            || key.comment().to_string().contains(['\r', '\n'])
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid KVM guest settings or unpinned Driver",
            ));
        }
        self.driver.validate()?;
        self.media.validate()
    }

    pub fn cloud_init(&self) -> io::Result<String> {
        self.validate()?;
        let mut value: serde_json::Value = serde_json::from_str(CLOUD_INIT)?;
        value["packages"]
            .as_array_mut()
            .ok_or_else(|| io::Error::other("guest package list is invalid"))?
            .push(self.browser_package.clone().into());
        value["packages"]
            .as_array_mut()
            .ok_or_else(|| io::Error::other("guest package list is invalid"))?
            .push("mousepad".into());
        value["write_files"].as_array_mut().ok_or_else(|| io::Error::other("guest setup is invalid"))?.push(serde_json::json!({
            "path": "/usr/local/bin/gbot-operation", "owner": "root:root", "permissions": "0755",
            "content": include_str!("../guest/operation.sh")
        }));
        value["hostname"] = format!("gbot-{}", self.id.simple()).into();
        value["users"][0]["ssh_authorized_keys"] = serde_json::json!([self.ssh_public_key]);
        let installer = value["write_files"]
            .as_array_mut()
            .ok_or_else(|| io::Error::other("guest setup is invalid"))?
            .iter_mut()
            .find(|f| f["path"] == "/usr/local/sbin/gbot-install-driver")
            .ok_or_else(|| io::Error::other("guest installer is missing"))?;
        let seed_mount = if matches!(self.driver, GuestBinary::SeedArchive { .. })
            || matches!(self.media, GuestBinary::SeedArchive { .. })
        {
            "gbot_seed=$(mktemp -d /run/gbot-seed.XXXXXX)\ntrap 'umount \"$gbot_seed\"; rmdir \"$gbot_seed\"' EXIT\nmount -o ro /dev/disk/by-label/cidata \"$gbot_seed\"\n"
        } else {
            ""
        };
        installer["content"] = format!("#!/bin/sh\nset -eu\ninstall -d -m 755 /opt/gbot/bin\n{seed_mount}{}{}touch /var/lib/gbot/installed\n", install_driver(&self.driver), install_media(&self.media)).into();
        Ok(format!(
            "#cloud-config\n{}\n",
            serde_json::to_string_pretty(&value)?
        ))
    }
}

fn install_driver(binary: &GuestBinary) -> String {
    let (download, archive, cleanup) = match binary {
        GuestBinary::Download { url, .. } => (format!("curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 '{url}' -o /opt/gbot/cua-driver.tar.gz\n"), "/opt/gbot/cua-driver.tar.gz", "rm /opt/gbot/cua-driver.tar.gz\n"),
        GuestBinary::SeedArchive { .. } => (String::new(), "$gbot_seed/cua-driver.tar.gz", ""),
    };
    format!("{download}printf '%s  %s\\n' '{}' \"{archive}\" | sha256sum --check --status\ntar -xzf \"{archive}\" -C /opt/gbot/bin cua-driver cua-cursor-theme\nchmod 755 /opt/gbot/bin/cua-driver /opt/gbot/bin/cua-cursor-theme\n{cleanup}", binary.sha256())
}

fn install_media(binary: &GuestBinary) -> String {
    let (download, archive, cleanup) = match binary {
        GuestBinary::Download { url, .. } => (format!("curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 '{url}' -o /opt/gbot/cua-media.tar.gz\n"), "/opt/gbot/cua-media.tar.gz", "rm /opt/gbot/cua-media.tar.gz\n"),
        GuestBinary::SeedArchive { .. } => (String::new(), "$gbot_seed/cua-media.tar.gz", ""),
    };
    format!("{download}printf '%s  %s\\n' '{}' \"{archive}\" | sha256sum --check --status\ntar -xzf \"{archive}\" -C /opt/gbot\nchmod 755 /opt/gbot/bin/cua-spacesd\n{cleanup}", binary.sha256())
}

fn seed_graft(name: &str, path: &Path) -> io::Result<String> {
    let path = path
        .to_str()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "seed paths must be UTF-8"))?;
    Ok(format!(
        "{name}={}",
        path.replace('\\', "\\\\").replace('=', "\\=")
    ))
}

#[derive(Clone, Debug)]
pub struct KvmTools {
    pub virsh: PathBuf,
    pub image: PathBuf,
    pub seed_iso: PathBuf,
}

impl Default for KvmTools {
    fn default() -> Self {
        Self {
            virsh: "virsh".into(),
            image: "qemu-img".into(),
            seed_iso: "genisoimage".into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PreparedVm {
    pub directory: PathBuf,
    pub spec: KvmSpec,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VmState {
    Running,
    Paused,
    Stopped,
    Crashed,
    Transitioning,
}

fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\"', "&quot;")
        .replace('\'', "&apos;")
}

impl PreparedVm {
    pub async fn prepare(
        root: &Path,
        cloud_image: &Path,
        mut spec: KvmSpec,
        tools: &KvmTools,
    ) -> io::Result<Self> {
        if spec.ssh_port == 0 && root.join(spec.id.to_string()).join("setup.json").is_file() {
            let saved: Self = serde_json::from_slice(
                &fs::read(root.join(spec.id.to_string()).join("setup.json")).await?,
            )?;
            spec.ssh_port = saved.spec.ssh_port;
        }
        if spec.ssh_port == 0 {
            spec.ssh_port = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?
                .local_addr()?
                .port();
        }
        spec.validate()?;
        let root = fs::canonicalize(root).await?;
        let image = fs::canonicalize(cloud_image).await?;
        if !image.starts_with(&root) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "base image must live under the owned VM root",
            ));
        }
        let directory = root.join(spec.id.to_string());
        // Reconcile the exact saved identity before retrying an interrupted preparation.
        // A different request must never adopt an existing directory or registered guest.
        let vm = match fs::create_dir(&directory).await {
            Ok(()) => Self { directory, spec },
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let saved: Self = match fs::read(directory.join("setup.json")).await {
                    Ok(bytes) => serde_json::from_slice(&bytes)?,
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {
                        // A crash before publishing the claim can leave only its lock/temp files.
                        let mut entries = fs::read_dir(&directory).await?;
                        while let Some(entry) = entries.next_entry().await? {
                            let name = entry.file_name();
                            let name = name.to_string_lossy();
                            if name != "setup.lock"
                                && !(name.starts_with("setup.json.") && name.ends_with(".tmp"))
                            {
                                return Err(io::Error::new(
                                    io::ErrorKind::AlreadyExists,
                                    "VM directory has no owned setup claim",
                                ));
                            }
                        }
                        Self {
                            directory: directory.clone(),
                            spec: spec.clone(),
                        }
                    }
                    Err(error) => return Err(error),
                };
                if saved.directory != directory
                    || serde_json::to_value(&saved.spec)? != serde_json::to_value(&spec)?
                {
                    return Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        "owned VM preparation differs from the saved request",
                    ));
                }
                if directory.join("prepared").is_file() {
                    return Self::open(&directory).await;
                }
                saved
            }
            Err(error) => return Err(error),
        };
        let claim = std::sync::Arc::new(
            crate::store::Store::open(vm.directory.join("setup.json"))
                .await
                .map_err(io::Error::other)?,
        );
        claim.save(&vm).await.map_err(io::Error::other)?;
        drop(claim);
        fs::write(vm.directory.join("user-data"), vm.spec.cloud_init()?).await?;
        fs::write(
            vm.directory.join("meta-data"),
            format!("instance-id: {}\n", vm.spec.id),
        )
        .await?;
        let registered = session_command(tools, "list")
            .args(["--all", "--uuid"])
            .output()
            .await?;
        if !registered.status.success() {
            return Err(io::Error::other(
                "cannot inspect the user's libvirt session",
            ));
        }
        if String::from_utf8_lossy(&registered.stdout)
            .lines()
            .any(|id| id.trim() == vm.spec.id.to_string())
        {
            let identity = session_command(tools, "domuuid")
                .arg(format!("gbot-{}", vm.spec.id))
                .output()
                .await?;
            if !identity.status.success()
                || String::from_utf8_lossy(&identity.stdout).trim() != vm.spec.id.to_string()
                || fs::read_to_string(vm.directory.join("domain.xml")).await? != vm.domain_xml()?
            {
                return Err(io::Error::other(
                    "registered VM does not match the owned preparation",
                ));
            }
            fs::write(vm.directory.join("prepared"), b"1\n").await?;
            return Ok(vm);
        }
        // No domain is registered: these files belong only to this unfinished request.
        // Regenerate a possibly interrupted disk/seed instead of adopting partial output.
        for name in ["disk.qcow2", "seed.img"] {
            match fs::remove_file(vm.directory.join(name)).await {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        run_checked(
            Command::new(&tools.image)
                .args(["create", "-f", "qcow2", "-F", "qcow2", "-b"])
                .arg(image)
                .arg(vm.directory.join("disk.qcow2"))
                .arg(format!("{}G", vm.spec.disk_gib)),
        )
        .await?;
        let mut seed = Command::new(&tools.seed_iso);
        seed.args(["-quiet", "-output"])
            .arg(vm.directory.join("seed.img"))
            .args(["-volid", "cidata", "-joliet", "-rock", "-graft-points"])
            .arg(seed_graft("user-data", &vm.directory.join("user-data"))?)
            .arg(seed_graft("meta-data", &vm.directory.join("meta-data"))?);
        for (name, binary) in [
            ("cua-driver.tar.gz", &vm.spec.driver),
            ("cua-media.tar.gz", &vm.spec.media),
        ] {
            if let GuestBinary::SeedArchive { path, .. } = binary {
                seed.arg(seed_graft(name, path)?);
            }
        }
        run_checked(&mut seed).await?;
        let domain = vm.directory.join("domain.xml");
        fs::write(&domain, vm.domain_xml()?).await?;
        run_checked(session_command(tools, "define").arg(domain)).await?;
        fs::write(vm.directory.join("prepared"), b"1\n").await?;
        Ok(vm)
    }

    pub async fn open(directory: &Path) -> io::Result<Self> {
        let canonical = fs::canonicalize(directory).await?;
        let vm: Self = serde_json::from_slice(&fs::read(canonical.join("setup.json")).await?)?;
        if vm.directory != canonical {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "VM record belongs to a different directory",
            ));
        }
        vm.spec.validate()?;
        fs::metadata(canonical.join("prepared")).await?;
        Ok(vm)
    }

    pub fn domain_xml(&self) -> io::Result<String> {
        self.spec.validate()?;
        let path = |name| -> io::Result<String> {
            Ok(xml(self.directory.join(name).to_str().ok_or_else(
                || io::Error::new(io::ErrorKind::InvalidInput, "VM paths must be UTF-8"),
            )?))
        };
        let pinning = if self.spec.host_cpus.is_empty() {
            String::new()
        } else {
            let set = self
                .spec
                .host_cpus
                .iter()
                .map(u16::to_string)
                .collect::<Vec<_>>()
                .join(",");
            let vcpus = self
                .spec
                .host_cpus
                .iter()
                .take(usize::from(self.spec.cpus))
                .enumerate()
                .map(|(vcpu, cpu)| format!("<vcpupin vcpu='{vcpu}' cpuset='{cpu}'/>"))
                .collect::<String>();
            format!("<cputune>{vcpus}<emulatorpin cpuset='{set}'/></cputune>")
        };
        // Queue the NIC after libvirt's JSON PCI controllers.
        let nic = xml(r#"{"driver":"virtio-net-pci","netdev":"gbot-ssh","id":"gbot-net"}"#);
        Ok(format!("<domain type='kvm' xmlns:qemu='http://libvirt.org/schemas/domain/qemu/1.0'><name>gbot-{id}</name><uuid>{id}</uuid><memory unit='MiB'>{memory}</memory><vcpu>{cpus}</vcpu>{pinning}<os><type arch='x86_64' machine='q35'>hvm</type></os><cpu mode='host-passthrough'/><features><acpi/></features><on_poweroff>destroy</on_poweroff><on_reboot>restart</on_reboot><on_crash>preserve</on_crash><devices><disk type='file' device='disk'><driver name='qemu' type='qcow2'/><source file='{disk}'/><target dev='vda' bus='virtio'/></disk><disk type='file' device='disk'><driver name='qemu' type='raw'/><source file='{seed}'/><target dev='vdb' bus='virtio'/><readonly/></disk><video><model type='vga'/></video><serial type='pty'><log file='{serial}' append='on'/><target port='0'/></serial><console type='pty'><target type='serial' port='0'/></console></devices><qemu:commandline><qemu:arg value='-netdev'/><qemu:arg value='user,id=gbot-ssh,hostfwd=tcp:127.0.0.1:{port}-:22'/><qemu:arg value='-device'/><qemu:arg value='{nic}'/></qemu:commandline></domain>\n", id=self.spec.id, memory=self.spec.memory_mib, cpus=self.spec.cpus, disk=path("disk.qcow2")?, seed=path("seed.img")?, serial=path("serial.log")?, port=self.spec.ssh_port))
    }

    async fn lease(&self) -> io::Result<File> {
        fs::metadata(self.directory.join("prepared")).await?;
        let path = self.directory.join("owner.lock");
        tokio::task::spawn_blocking(move || {
            let lock = File::options()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(path)?;
            lock.try_lock().map_err(|_| {
                io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "VM lifecycle action is already in progress",
                )
            })?;
            Ok(lock)
        })
        .await
        .map_err(io::Error::other)?
    }

    async fn command(&self, tools: &KvmTools, action: &str) -> io::Result<String> {
        let identity = session_command(tools, "domuuid")
            .arg(format!("gbot-{}", self.spec.id))
            .output()
            .await?;
        if !identity.status.success()
            || String::from_utf8_lossy(&identity.stdout).trim() != self.spec.id.to_string()
        {
            return Err(io::Error::other(format!(
                "owned VM identity lookup failed: {}",
                String::from_utf8_lossy(&identity.stderr).trim()
            )));
        }
        let output = session_command(tools, action)
            .arg(self.spec.id.to_string())
            .kill_on_drop(true)
            .output()
            .await?;
        if !output.status.success() {
            return Err(io::Error::other(format!(
                "libvirt {action} failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        String::from_utf8(output.stdout)
            .map_err(|_| io::Error::other("libvirt returned invalid output"))
    }

    pub async fn state(&self, tools: &KvmTools) -> io::Result<VmState> {
        match self.command(tools, "domstate").await?.trim() {
            "running" | "idle" => Ok(VmState::Running),
            "paused" | "pmsuspended" => Ok(VmState::Paused),
            "shut off" => Ok(VmState::Stopped),
            "crashed" => Ok(VmState::Crashed),
            "in shutdown" => Ok(VmState::Transitioning),
            _ => Err(io::Error::other("VM state is unavailable")),
        }
    }

    pub async fn start(&self, tools: &KvmTools) -> io::Result<VmState> {
        let _lease = self.lease().await?;
        match self.state(tools).await? {
            VmState::Running => return Ok(VmState::Running),
            VmState::Stopped => {}
            _ => {
                return Err(io::Error::other(
                    "VM is not stopped; reconcile before starting",
                ))
            }
        }
        self.command(tools, "start").await?;
        self.state(tools).await
    }

    pub async fn shutdown(&self, tools: &KvmTools) -> io::Result<VmState> {
        let _lease = self.lease().await?;
        if self.state(tools).await? == VmState::Stopped {
            return Ok(VmState::Stopped);
        }
        self.command(tools, "shutdown").await?;
        // Acknowledged ACPI shutdown is not proof the guest has stopped.
        self.state(tools).await
    }

    pub async fn force_stop(&self, tools: &KvmTools) -> io::Result<VmState> {
        let _lease = self.lease().await?;
        if self.state(tools).await? != VmState::Stopped {
            self.command(tools, "destroy").await?;
        }
        self.state(tools).await
    }

    pub async fn unregister(&self, tools: &KvmTools) -> io::Result<()> {
        let _lease = self.lease().await?;
        if self.state(tools).await? != VmState::Stopped {
            return Err(io::Error::other(
                "stop the owned VM before unregistering it",
            ));
        }
        self.command(tools, "undefine").await?;
        fs::remove_file(self.directory.join("prepared")).await
    }
}

fn session_command(tools: &KvmTools, action: &str) -> Command {
    let mut command = Command::new(&tools.virsh);
    command
        .args(["--connect", "qemu:///session", action])
        .env("LC_ALL", "C")
        .kill_on_drop(true);
    command
}

async fn run_checked(command: &mut Command) -> io::Result<()> {
    if command.kill_on_drop(true).status().await?.success() {
        Ok(())
    } else {
        Err(io::Error::other(
            "guest preparation command failed; retain setup for inspection",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn spec() -> KvmSpec {
        let key = russh::keys::PrivateKey::random(
            &mut russh::keys::key::safe_rng(),
            russh::keys::Algorithm::Ed25519,
        )
        .unwrap();
        let binary = GuestBinary::Download {
            url: "https://example.test/reviewed-binary".into(),
            sha256: "a".repeat(64),
        };
        KvmSpec {
            id: Uuid::new_v4(),
            cpus: 2,
            host_cpus: vec![112, 113],
            memory_mib: 4096,
            disk_gib: 40,
            ssh_port: 2222,
            ssh_public_key: key.public_key().to_openssh().unwrap(),
            browser_package: "firefox-esr".into(),
            media: binary.clone(),
            media_revision: CUA_REVISION.into(),
            driver: binary,
            driver_revision: CUA_DRIVER_REVISION.into(),
        }
    }

    #[test]
    fn session_declares_xfce_x11_before_starting_desktop() {
        let cloud = spec().cloud_init().unwrap();
        let data: serde_json::Value =
            serde_json::from_str(cloud.strip_prefix("#cloud-config\n").unwrap()).unwrap();
        let script = data["write_files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["path"] == "/usr/local/bin/gbot-desktop-session")
            .unwrap()["content"]
            .as_str()
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let session = dir.path().join("session");
        std::fs::write(&session, script).unwrap();
        let xauth = dir.path().join("xauth");
        std::fs::write(&xauth, "#!/bin/sh\n/usr/bin/env\nexit 42\n").unwrap();
        std::fs::set_permissions(&xauth, std::fs::Permissions::from_mode(0o700)).unwrap();
        let output = std::process::Command::new("bash")
            .arg(session)
            .env("GBOT_DESKTOP_NOTIFY_SOCKET", "fixture")
            .env("XDG_RUNTIME_DIR", dir.path())
            .env("PATH", format!("{}:/usr/bin:/bin", dir.path().display()))
            .env("XDG_CURRENT_DESKTOP", "KDE")
            .env("XDG_SESSION_DESKTOP", "plasma")
            .env("XDG_SESSION_TYPE", "wayland")
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(42));
        let env = String::from_utf8(output.stdout).unwrap();
        for value in [
            "DISPLAY=:1",
            "XDG_CURRENT_DESKTOP=XFCE",
            "XDG_SESSION_DESKTOP=xfce",
            "XDG_SESSION_TYPE=x11",
            "GTK_MODULES=atk-bridge",
            "QT_ACCESSIBILITY=1",
            "NO_AT_BRIDGE=0",
        ] {
            assert!(env.lines().any(|line| line == value), "missing {value}");
        }
    }

    #[test]
    fn shared_first_boot_is_dedicated_xfce_with_private_view() {
        let settings = spec();
        let text = settings.cloud_init().unwrap();
        let data: serde_json::Value =
            serde_json::from_str(text.strip_prefix("#cloud-config\n").unwrap()).unwrap();
        assert_eq!(data["users"][0]["name"], "gbot");
        assert_eq!(data["ssh_pwauth"], false);
        assert_eq!(data["disable_root"], true);
        let packages = data["packages"].as_array().unwrap();
        for package in [
            "xfce4",
            "tigervnc-standalone-server",
            "dbus-x11",
            "dbus-user-session",
            "gvfs",
            "xdg-user-dirs",
            "at-spi2-core",
            "mousepad",
        ] {
            assert!(packages.contains(&serde_json::json!(package)));
        }
        assert!(!packages.contains(&serde_json::json!("x11vnc")));
        let files = data["write_files"].as_array().unwrap();
        let operation = files
            .iter()
            .find(|v| v["path"] == "/usr/local/bin/gbot-operation")
            .unwrap();
        assert_eq!(operation["permissions"], "0755");
        assert!(!operation["content"].as_str().unwrap().is_empty());
        let session = files
            .iter()
            .find(|v| v["path"] == "/usr/local/bin/gbot-desktop-session")
            .unwrap()["content"]
            .as_str()
            .unwrap();
        assert!(session.contains("-geometry 1920x1080"));
        assert!(session.contains("dbus-update-activation-environment"));
        assert!(
            session.find("desktop.env").unwrap() < session.find("systemd-notify --ready").unwrap()
        );
        let unit = files
            .iter()
            .find(|v| v["path"] == "/etc/systemd/user/gbot-desktop.service")
            .unwrap()["content"]
            .as_str()
            .unwrap();
        assert!(unit.contains("Type=notify") && unit.contains("NotifyAccess=all"));
        assert!(unit.contains("ExecStart=/usr/local/bin/gbot-desktop-session"));
        assert!(
            session.find("unset NOTIFY_SOCKET").unwrap()
                < session.find("exec dbus-run-session").unwrap()
        );
        let startup = data["runcmd"].as_array().unwrap().last().unwrap()[2]
            .as_str()
            .unwrap();
        assert!(startup.contains("systemctl start user@$uid.service"));
        assert!(startup.contains("is-active --quiet gbot-desktop.service"));
        assert!(startup.find("is-active").unwrap() < startup.find("GBOT_READY_KEY").unwrap());
        assert!(
            session.contains("-localhost yes")
                && session.contains("-AcceptKeyEvents=0")
                && session.contains("-AcceptPointerEvents=0")
        );
        assert!(!session.contains("0.0.0.0"));
        let install = files
            .iter()
            .find(|v| v["path"] == "/usr/local/sbin/gbot-install-driver")
            .unwrap()["content"]
            .as_str()
            .unwrap();
        assert!(install.contains("sha256sum --check --status"));
        assert!(!text.contains("PRIVATE KEY"));
        let mut unpinned = settings.clone();
        unpinned.driver_revision = "latest".into();
        assert!(unpinned.cloud_init().is_err());
        let mut bad = settings;
        bad.driver = GuestBinary::Download {
            url: "http://example.test/key'".into(),
            sha256: "a".repeat(64),
        };
        assert!(bad.cloud_init().is_err());
        bad.driver = GuestBinary::Download {
            url: "https://example.test/worker?token=private".into(),
            sha256: "a".repeat(64),
        };
        assert!(bad.cloud_init().is_err());
    }

    #[test]
    fn seed_driver_installs_only_after_digest_verification() {
        let root = tempfile::tempdir().unwrap();
        for name in ["cua-driver", "cua-cursor-theme"] {
            std::fs::write(root.path().join(name), format!("fixture-{name}\n")).unwrap();
        }
        let archive = root.path().join("cua-driver.tar.gz");
        assert!(std::process::Command::new("tar")
            .args(["-czf"])
            .arg(&archive)
            .arg("-C")
            .arg(root.path())
            .args(["cua-driver", "cua-cursor-theme"])
            .status()
            .unwrap()
            .success());
        let digest = std::process::Command::new("sha256sum")
            .arg(&archive)
            .output()
            .unwrap();
        assert!(digest.status.success());
        let digest = String::from_utf8(digest.stdout)
            .unwrap()
            .split_whitespace()
            .next()
            .unwrap()
            .to_string();
        let mut settings = spec();
        settings.driver = GuestBinary::SeedArchive {
            path: archive.clone(),
            sha256: digest,
        };
        let cloud = settings.cloud_init().unwrap();
        let data: serde_json::Value =
            serde_json::from_str(cloud.strip_prefix("#cloud-config\n").unwrap()).unwrap();
        assert!(data["write_files"]
            .as_array()
            .unwrap()
            .iter()
            .all(|file| file["path"] != "/opt/gbot/cua-driver.tar.gz"));
        let seed_path = root.path().to_str().unwrap();
        let destination = root.path().join("installed");
        std::fs::create_dir_all(destination.join("bin")).unwrap();
        let run = |binary: &GuestBinary| {
            let script = format!(
                "set -eu\ngbot_seed='{seed_path}'\n{}",
                install_driver(binary)
            )
            .replace("/opt/gbot", destination.to_str().unwrap());
            std::process::Command::new("sh")
                .args(["-c", &script])
                .output()
                .unwrap()
        };
        let mut corrupt = settings.driver.clone();
        if let GuestBinary::SeedArchive { sha256, .. } = &mut corrupt {
            *sha256 = "0".repeat(64);
        }
        assert!(!run(&corrupt).status.success());
        assert!(!destination.join("bin/cua-driver").exists());
        assert!(run(&settings.driver).status.success());
        assert_eq!(
            std::fs::read_to_string(destination.join("bin/cua-driver")).unwrap(),
            "fixture-cua-driver\n"
        );
        assert_eq!(
            std::fs::read_to_string(destination.join("bin/cua-cursor-theme")).unwrap(),
            "fixture-cua-cursor-theme\n"
        );
        assert!(archive.exists());
    }

    #[test]
    fn media_archive_is_verified_before_installing_its_native_closure() {
        let root = tempfile::tempdir().unwrap();
        for (name, content) in [
            ("bin/cua-spacesd", "daemon"),
            ("lib/native.so", "library"),
            ("licenses/MIT", "notice"),
        ] {
            let path = root.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, content).unwrap();
        }
        let archive = root.path().join("cua-media.tar.gz");
        assert!(std::process::Command::new("tar")
            .args(["-czf"])
            .arg(&archive)
            .arg("-C")
            .arg(root.path())
            .args(["bin", "lib", "licenses"])
            .status()
            .unwrap()
            .success());
        let digest = std::process::Command::new("sha256sum")
            .arg(&archive)
            .output()
            .unwrap();
        assert!(digest.status.success());
        let mut settings = spec();
        settings.media = GuestBinary::SeedArchive {
            path: archive.clone(),
            sha256: String::from_utf8(digest.stdout)
                .unwrap()
                .split_whitespace()
                .next()
                .unwrap()
                .into(),
        };
        let cloud = settings.cloud_init().unwrap();
        let data: serde_json::Value =
            serde_json::from_str(cloud.strip_prefix("#cloud-config\n").unwrap()).unwrap();
        assert!(data["write_files"]
            .as_array()
            .unwrap()
            .iter()
            .all(|file| file["path"] != "/opt/gbot/cua-media.tar.gz"));
        let seed_path = root.path().to_str().unwrap();
        let destination = root.path().join("installed");
        std::fs::create_dir_all(&destination).unwrap();
        let run = |binary: &GuestBinary| {
            let script = format!(
                "set -eu\ngbot_seed='{seed_path}'\n{}",
                install_media(binary)
            )
            .replace("/opt/gbot", destination.to_str().unwrap());
            std::process::Command::new("sh")
                .args(["-c", &script])
                .output()
                .unwrap()
        };
        let mut corrupt = settings.media.clone();
        if let GuestBinary::SeedArchive { sha256, .. } = &mut corrupt {
            *sha256 = "0".repeat(64);
        }
        assert!(!run(&corrupt).status.success());
        assert!(!destination.join("bin/cua-spacesd").exists());
        assert!(run(&settings.media).status.success());
        for (name, content) in [
            ("bin/cua-spacesd", "daemon"),
            ("lib/native.so", "library"),
            ("licenses/MIT", "notice"),
        ] {
            assert_eq!(
                std::fs::read_to_string(destination.join(name)).unwrap(),
                content
            );
        }
        assert!(archive.exists());
    }

    #[test]
    fn large_archives_stay_out_of_cloud_init_metadata() {
        let root = tempfile::tempdir().unwrap();
        let archive = root.path().join("large.tar.gz");
        File::create(&archive)
            .unwrap()
            .set_len(256 * 1024 * 1024)
            .unwrap();
        let mut settings = spec();
        settings.driver = GuestBinary::SeedArchive {
            path: archive.clone(),
            sha256: "a".repeat(64),
        };
        settings.media = settings.driver.clone();
        let cloud = settings.cloud_init().unwrap();
        assert!(cloud.len() < 64 * 1024);
        let data: serde_json::Value =
            serde_json::from_str(cloud.strip_prefix("#cloud-config\n").unwrap()).unwrap();
        let install = data["write_files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["path"] == "/usr/local/sbin/gbot-install-driver")
            .unwrap()["content"]
            .as_str()
            .unwrap();
        assert!(install.contains("mount -o ro /dev/disk/by-label/cidata"));
        assert_eq!(
            seed_graft("cua-driver.tar.gz", Path::new("/tmp/key=archive.tar.gz")).unwrap(),
            "cua-driver.tar.gz=/tmp/key\\=archive.tar.gz"
        );
    }

    #[tokio::test]
    async fn kvm_xml_and_owned_lifecycle_need_no_hypervisor() {
        let root = tempfile::tempdir().unwrap();
        let vm = PreparedVm {
            directory: root.path().into(),
            spec: spec(),
        };
        fs::write(vm.directory.join("prepared"), "1").await.unwrap();
        let domain = vm.domain_xml().unwrap();
        assert!(domain.contains(
            "<domain type='kvm' xmlns:qemu='http://libvirt.org/schemas/domain/qemu/1.0'>"
        ));
        assert!(domain.contains("<vcpupin vcpu='0' cpuset='112'/><vcpupin vcpu='1' cpuset='113'/><emulatorpin cpuset='112,113'/></cputune>"));
        assert!(domain.contains("user,id=gbot-ssh,hostfwd=tcp:127.0.0.1:2222-:22"));
        assert!(domain.contains("&quot;driver&quot;:&quot;virtio-net-pci&quot;"));
        assert!(domain.contains("<video><model type='vga'/></video>"));
        assert!(!domain.contains("<backend type='passt'") && !domain.contains("<interface"));
        assert!(
            !domain.contains("bridge")
                && !domain.contains("hostdev")
                && !domain.contains("graphics")
        );
        let virsh = root.path().join("virsh");
        let state = root.path().join("state");
        fs::write(&state, "shut off\n").await.unwrap();
        fs::write(&virsh, format!("#!/bin/sh\nset -eu\ntest \"$1\" = --connect\ntest \"$2\" = qemu:///session\ncase \"$3\" in\n domuuid) test \"$4\" = gbot-{}; printf '%s\\n' {};;\n domstate) cat '{}';;\n start) printf 'running\\n' > '{}';;\n shutdown|destroy) printf 'shut off\\n' > '{}';;\n undefine) :;;\n *) exit 2;;\nesac\n", vm.spec.id, vm.spec.id, state.display(), state.display(), state.display())).await.unwrap();
        fs::set_permissions(&virsh, std::fs::Permissions::from_mode(0o755))
            .await
            .unwrap();
        let tools = KvmTools {
            virsh,
            ..KvmTools::default()
        };
        assert_eq!(vm.start(&tools).await.unwrap(), VmState::Running);
        assert_eq!(vm.start(&tools).await.unwrap(), VmState::Running);
        // Reopen after service loss without stopping or spawning a second guest.
        let reopened = vm.clone();
        assert_eq!(reopened.state(&tools).await.unwrap(), VmState::Running);
        assert_eq!(reopened.shutdown(&tools).await.unwrap(), VmState::Stopped);
        vm.unregister(&tools).await.unwrap();
        assert!(!root.path().join("prepared").exists());
    }
    #[tokio::test]
    async fn prepare_records_selected_loopback_port_and_reuses_it() {
        let root = tempfile::tempdir().unwrap();
        let image = root.path().join("base.qcow2");
        fs::write(&image, "fixture").await.unwrap();
        let tool = root.path().join("tool");
        fs::write(&tool, "#!/bin/sh\nexit 0\n").await.unwrap();
        fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755))
            .await
            .unwrap();
        let tools = KvmTools {
            virsh: tool.clone(),
            image: tool.clone(),
            seed_iso: tool,
        };
        let mut settings = spec();
        settings.ssh_port = 0;
        let vm = PreparedVm::prepare(root.path(), &image, settings, &tools)
            .await
            .unwrap();
        assert_ne!(vm.spec.ssh_port, 0);
        let recorded = PreparedVm::open(&vm.directory).await.unwrap();
        assert_eq!(recorded.spec.ssh_port, vm.spec.ssh_port);
        assert!(recorded
            .domain_xml()
            .unwrap()
            .contains(&format!("hostfwd=tcp:127.0.0.1:{}-:22", vm.spec.ssh_port)));
    }
    #[tokio::test]
    async fn interrupted_prepare_resumes_same_identity_and_refuses_changed_spec() {
        let root = tempfile::tempdir().unwrap();
        let image = root.path().join("base.qcow2");
        fs::write(&image, "fixture").await.unwrap();
        let tool = root.path().join("tool");
        let broken = root.path().join("broken");
        fs::write(&tool, "#!/bin/sh\nexit 0\n").await.unwrap();
        fs::write(&broken, "#!/bin/sh\nexit 1\n").await.unwrap();
        for path in [&tool, &broken] {
            fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
                .await
                .unwrap();
        }
        let tools = KvmTools {
            virsh: tool.clone(),
            image: broken,
            seed_iso: tool.clone(),
        };
        let mut settings = spec();
        settings.ssh_port = 0;
        assert!(
            PreparedVm::prepare(root.path(), &image, settings.clone(), &tools)
                .await
                .is_err()
        );
        let directory = root.path().join(settings.id.to_string());
        let saved: PreparedVm =
            serde_json::from_slice(&fs::read(directory.join("setup.json")).await.unwrap()).unwrap();
        assert!(!directory.join("prepared").exists());
        let tools = KvmTools {
            virsh: tool.clone(),
            image: tool.clone(),
            seed_iso: tool,
        };
        let resumed = PreparedVm::prepare(root.path(), &image, settings.clone(), &tools)
            .await
            .unwrap();
        assert_eq!(resumed.spec.id, settings.id);
        assert_eq!(resumed.spec.ssh_port, saved.spec.ssh_port);
        assert_eq!(
            PreparedVm::prepare(root.path(), &image, settings.clone(), &tools)
                .await
                .unwrap()
                .spec
                .ssh_port,
            saved.spec.ssh_port
        );
        settings.memory_mib += 1024;
        assert_eq!(
            PreparedVm::prepare(root.path(), &image, settings, &tools)
                .await
                .unwrap_err()
                .kind(),
            io::ErrorKind::AlreadyExists
        );
        assert!(directory.join("prepared").exists());
    }
}
