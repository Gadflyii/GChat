use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io,
    path::{Path, PathBuf},
    process::Stdio,
};
use tokio::{
    fs,
    process::{Child, Command},
    time::{timeout, Duration},
};
use uuid::Uuid;

pub const CUA_REVISION: &str = "0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc";
const CLOUD_INIT: &str = include_str!("../guest/cloud-init.json");

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GuestBinary {
    pub url: String,
    pub sha256: String,
}

impl GuestBinary {
    fn validate(&self) -> io::Result<()> {
        if !self.url.starts_with("https://")
            || self
                .url
                .bytes()
                .any(|b| b.is_ascii_control() || b == b'\'' || b == b' ')
            || self.sha256.len() != 64
            || !self.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "guest binaries need HTTPS URLs and SHA-256 digests",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KvmSpec {
    pub id: Uuid,
    pub cpus: u16,
    pub memory_mib: u32,
    pub disk_gib: u32,
    pub ssh_port: u16,
    pub ssh_public_key: String,
    pub worker: GuestBinary,
    pub driver: GuestBinary,
    pub driver_revision: String,
}

impl KvmSpec {
    pub fn validate(&self) -> io::Result<()> {
        let key =
            russh::keys::ssh_key::PublicKey::from_openssh(&self.ssh_public_key).map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidInput, "invalid guest SSH public key")
            })?;
        if self.id.is_nil()
            || self.cpus == 0
            || self.memory_mib < 2048
            || self.disk_gib == 0
            || self.ssh_port == 0
            || self.driver_revision != CUA_REVISION
            || key.comment().to_string().contains(['\r', '\n'])
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid KVM guest settings or unpinned Driver",
            ));
        }
        self.worker.validate()?;
        self.driver.validate()
    }

    pub fn cloud_init(&self) -> io::Result<String> {
        self.validate()?;
        let mut value: serde_json::Value = serde_json::from_str(CLOUD_INIT)?;
        value["hostname"] = format!("gbot-{}", self.id.simple()).into();
        value["users"][0]["ssh_authorized_keys"] = serde_json::json!([self.ssh_public_key]);
        let installer = value["write_files"]
            .as_array_mut()
            .ok_or_else(|| io::Error::other("guest setup is invalid"))?
            .iter_mut()
            .find(|f| f["path"] == "/usr/local/sbin/gbot-install-binaries")
            .ok_or_else(|| io::Error::other("guest installer is missing"))?;
        installer["content"] = format!("#!/bin/sh\nset -eu\ninstall -d -m 755 /opt/gbot/bin\n{}{}touch /var/lib/gbot/installed\n", install_binary("gbot-guest", &self.worker), install_binary("cua-driver", &self.driver)).into();
        Ok(format!(
            "#cloud-config\n{}\n",
            serde_json::to_string_pretty(&value)?
        ))
    }
}

fn install_binary(name: &str, binary: &GuestBinary) -> String {
    format!("curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 '{}' -o '/opt/gbot/bin/{}.part'\nprintf '%s  %s\\n' '{}' '/opt/gbot/bin/{}.part' | sha256sum --check --status\nchmod 755 '/opt/gbot/bin/{}.part'\nmv '/opt/gbot/bin/{}.part' '/opt/gbot/bin/{}'\n", binary.url, name, binary.sha256, name, name, name, name)
}

#[derive(Clone, Debug)]
pub struct KvmTools {
    pub qemu: PathBuf,
    pub image: PathBuf,
    pub cloud_localds: PathBuf,
}

impl Default for KvmTools {
    fn default() -> Self {
        Self {
            qemu: "qemu-system-x86_64".into(),
            image: "qemu-img".into(),
            cloud_localds: "cloud-localds".into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PreparedVm {
    pub directory: PathBuf,
    pub spec: KvmSpec,
}

fn qemu_path(path: &Path) -> io::Result<String> {
    let value = path
        .to_str()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "QEMU paths must be UTF-8"))?;
    if value.contains([',', '\r', '\n']) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "QEMU paths cannot contain commas or newlines",
        ));
    }
    Ok(value.into())
}

impl PreparedVm {
    pub async fn prepare(
        root: &Path,
        cloud_image: &Path,
        spec: KvmSpec,
        tools: &KvmTools,
    ) -> io::Result<Self> {
        spec.validate()?;
        let root = fs::canonicalize(root).await?;
        let image = fs::canonicalize(cloud_image).await?;
        if !image.starts_with(&root) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "base image must live under the owned VM root",
            ));
        }
        qemu_path(&image)?;
        let directory = root.join(spec.id.to_string());
        qemu_path(&directory)?;
        // Never reuse a partially created guest as a fresh setup.
        fs::create_dir(&directory).await?;
        let vm = Self { directory, spec };
        fs::write(
            vm.directory.join("setup.json"),
            serde_json::to_vec_pretty(&vm)?,
        )
        .await?;
        fs::write(vm.directory.join("user-data"), vm.spec.cloud_init()?).await?;
        fs::write(
            vm.directory.join("meta-data"),
            format!("instance-id: {}\n", vm.spec.id),
        )
        .await?;
        run_checked(
            Command::new(&tools.image)
                .args(["create", "-f", "qcow2", "-F", "qcow2", "-b"])
                .arg(&image)
                .arg(vm.directory.join("disk.qcow2"))
                .arg(format!("{}G", vm.spec.disk_gib)),
        )
        .await?;
        run_checked(
            Command::new(&tools.cloud_localds)
                .arg(vm.directory.join("seed.img"))
                .arg(vm.directory.join("user-data"))
                .arg(vm.directory.join("meta-data")),
        )
        .await?;
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

    pub fn args(&self) -> io::Result<Vec<String>> {
        self.spec.validate()?;
        let path = |name| qemu_path(&self.directory.join(name));
        let qmp = path("qmp.sock")?;
        if qmp.len() >= 104 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "VM directory is too long for its monitor socket",
            ));
        }
        Ok(vec![
            "-name".into(),
            format!("gbot-{}", self.spec.id),
            "-machine".into(),
            "q35,accel=kvm".into(),
            "-cpu".into(),
            "host".into(),
            "-smp".into(),
            self.spec.cpus.to_string(),
            "-m".into(),
            self.spec.memory_mib.to_string(),
            "-drive".into(),
            format!("file={},format=qcow2,if=virtio", path("disk.qcow2")?),
            "-drive".into(),
            format!(
                "file={},format=raw,if=virtio,readonly=on",
                path("seed.img")?
            ),
            "-netdev".into(),
            format!(
                "user,id=net0,hostfwd=tcp:127.0.0.1:{}-:22",
                self.spec.ssh_port
            ),
            "-device".into(),
            "virtio-net-pci,netdev=net0".into(),
            "-vga".into(),
            "qxl".into(),
            "-display".into(),
            "none".into(),
            "-monitor".into(),
            "none".into(),
            "-qmp".into(),
            format!("unix:{qmp},server=on,wait=off"),
            "-serial".into(),
            format!("file:{}", path("serial.log")?),
        ])
    }

    pub async fn start(&self, tools: &KvmTools) -> io::Result<RunningVm> {
        fs::metadata(self.directory.join("prepared")).await?;
        let lock = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.directory.join("owner.lock"))?;
        lock.try_lock().map_err(|_| {
            io::Error::new(io::ErrorKind::WouldBlock, "this VM already has an owner")
        })?;
        let output = File::options()
            .create(true)
            .append(true)
            .open(self.directory.join("qemu.log"))?;
        let child = Command::new(&tools.qemu)
            .args(self.args()?)
            .stdin(Stdio::null())
            .stdout(output.try_clone()?)
            .stderr(output)
            .kill_on_drop(true)
            .spawn()?;
        Ok(RunningVm::own(child, self.directory.clone(), lock))
    }
}

async fn run_checked(command: &mut Command) -> io::Result<()> {
    let status = command.kill_on_drop(true).status().await?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other(
            "guest preparation command failed; retain setup for inspection",
        ))
    }
}

enum VmControl {
    Stop(Duration, tokio::sync::oneshot::Sender<io::Result<()>>),
    Force(tokio::sync::oneshot::Sender<io::Result<()>>),
}

pub struct RunningVm {
    pid: u32,
    control: tokio::sync::mpsc::Sender<VmControl>,
    owner: tokio::task::JoinHandle<io::Result<std::process::ExitStatus>>,
}

impl RunningVm {
    fn own(mut child: Child, directory: PathBuf, lock: File) -> Self {
        let pid = child.id().expect("spawned child has a PID");
        let (control, mut receiver) = tokio::sync::mpsc::channel(1);
        let owner = tokio::spawn(async move {
            // Retain the lease until the owned process is reaped, including client loss.
            let _lease = lock;
            loop {
                tokio::select! {
                    result = child.wait() => return result,
                    message = receiver.recv() => match message {
                        Some(VmControl::Stop(grace, reply)) => {
                            let result = powerdown(&directory, &mut child, grace).await;
                            let stopped = result.is_ok();
                            let _ = reply.send(result);
                            if stopped { return child.wait().await; }
                        },
                        Some(VmControl::Force(reply)) => {
                            let result = child.kill().await;
                            let _ = reply.send(result);
                            return child.wait().await;
                        },
                        None => { child.kill().await?; return child.wait().await; }
                    }
                }
            }
        });
        Self {
            pid,
            control,
            owner,
        }
    }

    pub fn id(&self) -> u32 {
        self.pid
    }

    pub fn exited(&self) -> bool {
        self.owner.is_finished()
    }

    pub async fn stop(&self, grace: Duration) -> io::Result<()> {
        let (reply, result) = tokio::sync::oneshot::channel();
        self.control
            .send(VmControl::Stop(grace, reply))
            .await
            .map_err(|_| io::Error::other("VM owner has exited"))?;
        result
            .await
            .map_err(|_| io::Error::other("VM owner did not acknowledge shutdown"))?
    }

    pub async fn until_shutdown(self) -> io::Result<()> {
        let Self {
            control, mut owner, ..
        } = self;
        let result = tokio::select! {
            result = &mut owner => return result.map_err(io::Error::other)?.map(|_| ()),
            result = tokio::signal::ctrl_c() => result,
        };
        result?;
        // Foreground owner loss is an explicit stop of this guest, never a daemon.
        drop(control);
        owner.await.map_err(io::Error::other)??;
        Ok(())
    }

    pub async fn force_stop(self) -> io::Result<()> {
        let (reply, result) = tokio::sync::oneshot::channel();
        if self.control.send(VmControl::Force(reply)).await.is_ok() {
            result
                .await
                .map_err(|_| io::Error::other("VM owner did not acknowledge stop"))??;
        }
        self.owner.await.map_err(io::Error::other)??;
        Ok(())
    }
}

async fn powerdown(directory: &Path, child: &mut Child, grace: Duration) -> io::Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let shutdown = async {
        let stream = tokio::net::UnixStream::connect(directory.join("qmp.sock")).await?;
        let mut monitor = BufReader::new(stream);
        let mut line = String::new();
        monitor.read_line(&mut line).await?;
        if serde_json::from_str::<serde_json::Value>(&line)?["QMP"].is_null() {
            return Err(io::Error::other("invalid QEMU monitor greeting"));
        }
        for (id, command) in [("init", "qmp_capabilities"), ("stop", "system_powerdown")] {
            monitor
                .get_mut()
                .write_all(format!("{{\"execute\":\"{command}\",\"id\":\"{id}\"}}\n").as_bytes())
                .await?;
            loop {
                line.clear();
                if monitor.read_line(&mut line).await? == 0 {
                    return Err(io::Error::other(
                        "QEMU monitor closed before shutdown acknowledgement",
                    ));
                }
                let response: serde_json::Value = serde_json::from_str(&line)?;
                if response["id"] == id {
                    if response.get("error").is_some() {
                        return Err(io::Error::other("QEMU refused shutdown"));
                    }
                    break;
                }
            }
        }
        child.wait().await?;
        Ok(())
    };
    timeout(grace, shutdown).await.map_err(|_| {
        io::Error::new(
            io::ErrorKind::TimedOut,
            "guest has not powered down; explicit force stop required",
        )
    })?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> KvmSpec {
        let key = russh::keys::PrivateKey::random(
            &mut russh::keys::key::safe_rng(),
            russh::keys::Algorithm::Ed25519,
        )
        .unwrap();
        let binary = GuestBinary {
            url: "https://example.test/reviewed-binary".into(),
            sha256: "a".repeat(64),
        };
        KvmSpec {
            id: Uuid::new_v4(),
            cpus: 2,
            memory_mib: 4096,
            disk_gib: 40,
            ssh_port: 2222,
            ssh_public_key: key.public_key().to_openssh().unwrap(),
            worker: binary.clone(),
            driver: binary,
            driver_revision: CUA_REVISION.into(),
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
            "lightdm",
            "xserver-xorg",
            "dbus-x11",
            "at-spi2-core",
            "x11vnc",
        ] {
            assert!(packages.contains(&serde_json::json!(package)));
        }
        let files = data["write_files"].as_array().unwrap();
        let session = files
            .iter()
            .find(|v| v["path"] == "/usr/local/bin/gbot-desktop-session")
            .unwrap()["content"]
            .as_str()
            .unwrap();
        assert!(session.contains("dbus-update-activation-environment"));
        let vnc = files
            .iter()
            .find(|v| v["path"] == "/usr/local/bin/gbot-view")
            .unwrap()["content"]
            .as_str()
            .unwrap();
        assert!(vnc.contains("-localhost") && vnc.contains("-viewonly"));
        assert!(!vnc.contains("0.0.0.0"));
        let install = files
            .iter()
            .find(|v| v["path"] == "/usr/local/sbin/gbot-install-binaries")
            .unwrap()["content"]
            .as_str()
            .unwrap();
        assert!(install.contains("sha256sum --check --status"));
        assert!(!text.contains("PRIVATE KEY"));
        let mut unpinned = settings.clone();
        unpinned.driver_revision = "latest".into();
        assert!(unpinned.cloud_init().is_err());
        let mut bad = settings;
        bad.worker.url = "http://example.test/key'".into();
        assert!(bad.cloud_init().is_err());
    }

    #[tokio::test]
    async fn kvm_argv_and_owned_lifetime_need_no_hypervisor() {
        let root = tempfile::tempdir().unwrap();
        let vm = PreparedVm {
            directory: root.path().into(),
            spec: spec(),
        };
        fs::write(vm.directory.join("prepared"), "1").await.unwrap();
        let args = vm.args().unwrap();
        assert!(args.iter().any(|v| v == "q35,accel=kvm"));
        assert!(args
            .iter()
            .any(|v| v == "user,id=net0,hostfwd=tcp:127.0.0.1:2222-:22"));
        assert!(!args
            .iter()
            .any(|v| v.contains("bridge") || v.contains("vfio") || v.contains("vnc")));
        let tools = KvmTools {
            qemu: "/usr/bin/sleep".into(),
            ..KvmTools::default()
        };
        // A harmless child pins ownership without creating a VM.
        let lock = File::options()
            .read(true)
            .write(true)
            .create_new(true)
            .open(vm.directory.join("owner.lock"))
            .unwrap();
        lock.try_lock().unwrap();
        assert_eq!(
            vm.start(&tools).await.err().unwrap().kind(),
            io::ErrorKind::WouldBlock
        );
        drop(lock);
        let child = Command::new(&tools.qemu)
            .arg("30")
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let lease = File::options()
            .read(true)
            .write(true)
            .open(root.path().join("owner.lock"))
            .unwrap();
        lease.try_lock().unwrap();
        let running = RunningVm::own(child, vm.directory, lease);
        assert!(running.id() > 0);
        running.force_stop().await.unwrap();
        let lease = File::options()
            .read(true)
            .write(true)
            .open(root.path().join("owner.lock"))
            .unwrap();
        lease.try_lock().unwrap();
    }
}
