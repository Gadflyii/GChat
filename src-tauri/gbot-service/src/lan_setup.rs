//! Staged installation for an explicitly selected, dedicated Debian computer.
use russh::keys::ssh_key::sha2::{Digest, Sha256};
use serde::Serialize;
use std::{
    io,
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct Preparation {
    pub command: Option<String>,
    pub installed: bool,
    pub issue: Option<String>,
}

pub(crate) struct Bundle {
    pub id: Uuid,
    pub installer: Vec<u8>,
    pub archives: Vec<(PathBuf, String, String)>,
}

pub(crate) fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

impl Bundle {
    pub fn new(root: &Path, id: Uuid, user: String) -> io::Result<Self> {
        let assets = crate::guest_assets::accepted();
        let archives = assets[1..].iter().map(|asset| {
            let path = root.join(&asset.filename);
            if !path.is_file() { return Err(io::Error::other(format!("Install the GChat package containing the pinned guest tools; {} is missing.", path.display()))); }
            Ok((path, asset.filename.clone(), asset.digest.clone()))
        }).collect::<io::Result<Vec<_>>>()?;
        let installer = installer(id, &user, &archives)?;
        Ok(Self {
            id,
            installer: installer.into_bytes(),
            archives,
        })
    }

    pub fn directory(&self) -> String {
        format!("$HOME/.local/share/gbot/setup/{}", self.id)
    }
    pub fn command(&self) -> String {
        format!("sudo -- sh \"{}/install.sh\"", self.directory())
    }
    pub fn installer_digest(&self) -> String {
        Sha256::digest(&self.installer)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}

fn installer(id: Uuid, user: &str, archives: &[(PathBuf, String, String)]) -> io::Result<String> {
    let config = crate::guest_assets::desktop_config("chromium")?;
    let files = config["write_files"]
        .as_array()
        .ok_or_else(|| io::Error::other("guest files missing"))?;
    let mut script = format!(
        "#!/bin/sh\nset -eu\nbot_user={}\nworkspace={}\n",
        quote(user),
        quote(&id.to_string())
    );
    script.push_str(include_str!("../guest/lan-install-header.sh"));
    let mut writes = String::new();
    for (index, file) in files.iter().enumerate() {
        let path = file["path"]
            .as_str()
            .ok_or_else(|| io::Error::other("guest file path missing"))?;
        if path.starts_with("/etc/ssh/") || path == "/usr/local/sbin/gbot-install-driver" {
            continue;
        }
        let target = if let Some(name) = path.strip_prefix("/etc/xdg/autostart/") {
            format!("\"$bot_home/.config/autostart/{name}\"")
        } else {
            quote(path)
        };
        script.push_str(&format!("check_owned {target}\n"));
        let mode = file["permissions"]
            .as_str()
            .ok_or_else(|| io::Error::other("guest file mode missing"))?;
        let content = file["content"]
            .as_str()
            .ok_or_else(|| io::Error::other("guest file content missing"))?;
        let delimiter = format!("GBOT_FILE_{}_{}", id.simple(), index);
        writes.push_str(&format!("target={target}\ninstall -d -m 755 \"$(dirname \"$target\")\"\ncat > \"$target\" <<'{delimiter}'\n{content}\n{delimiter}\nchmod {mode} \"$target\"\n"));
        if path.starts_with("/etc/xdg/autostart/") {
            writes.push_str("chown \"$bot_user:$bot_group\" \"$bot_home/.config\" \"$bot_home/.config/autostart\"\nchown \"$bot_user:$bot_group\" \"$target\"\n");
        }
    }
    for (_, name, digest) in archives {
        script.push_str(&format!("printf '%s  %s\\n' {} \"$bundle/{name}\" | sha256sum --check --status || fail 'Guest archive checksum failed. Upload the tools again.'\n", quote(digest)));
    }
    let packages = config["packages"]
        .as_array()
        .ok_or_else(|| io::Error::other("guest packages missing"))?
        .iter()
        .filter_map(|p| p.as_str())
        .filter(|p| !matches!(*p, "openssh-server" | "ufw"))
        .map(quote)
        .collect::<Vec<_>>()
        .join(" ");
    script.push_str(&format!("install -d -m 755 /var/lib/gbot /opt/gbot/bin\nprintf '%s\\n' \"$workspace:$bot_user\" > /var/lib/gbot/lan-owner\nexport DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install --no-install-recommends -y {packages}\n"));
    script.push_str(&writes);
    script.push_str(&format!("tar -xzf \"$bundle/{}\" -C /opt/gbot/bin cua-driver cua-cursor-theme\ntar -xzf \"$bundle/{}\" -C /opt/gbot\nchmod 755 /opt/gbot/bin/cua-driver /opt/gbot/bin/cua-cursor-theme /opt/gbot/bin/cua-spacesd\n", archives[0].1, archives[1].1));
    script.push_str("touch /var/lib/gbot/installed\nloginctl enable-linger \"$bot_user\"\nsystemctl start \"user@$bot_uid.service\"\nrunuser -u \"$bot_user\" -- env XDG_RUNTIME_DIR=\"/run/user/$bot_uid\" DBUS_SESSION_BUS_ADDRESS=\"unix:path=/run/user/$bot_uid/bus\" systemctl --user daemon-reload\nrunuser -u \"$bot_user\" -- env XDG_RUNTIME_DIR=\"/run/user/$bot_uid\" DBUS_SESSION_BUS_ADDRESS=\"unix:path=/run/user/$bot_uid/bus\" systemctl --user enable --now gbot-desktop.service gbot-media.service\nprintf '%s\\n' 'Gbot tools installed. Return to GChat and check the tools.'\n");
    Ok(script)
}

pub(crate) fn preflight() -> &'static str {
    "set -eu; . /etc/os-release; [ \"$ID:$VERSION_ID\" = debian:13 ] || { echo 'This setup supports a dedicated Debian 13 computer. Use an already prepared computer for another OS.'; exit 1; }; command -v sha256sum >/dev/null; command -v loginctl >/dev/null; for s in $(loginctl list-sessions --no-legend | awk '{print $1}'); do type=$(loginctl show-session \"$s\" -p Type --value); case $type in x11|wayland) echo 'A person may be using this desktop. Sign out of graphical sessions before preparing the bot computer.'; exit 1;; esac; done"
}

pub(crate) fn check_command() -> &'static str {
    "set -eu; for p in /usr/local/bin/gbot-operation /usr/local/bin/gbot-cua /opt/gbot/bin/cua-driver /opt/gbot/bin/cua-spacesd; do [ -x \"$p\" ] || { echo 'Gbot tools are not installed. Run the displayed administrator command on the bot computer, then check again.'; exit 1; }; done; [ -e /var/lib/gbot/installed ]; export XDG_RUNTIME_DIR=\"/run/user/$(id -u)\"; export DBUS_SESSION_BUS_ADDRESS=\"unix:path=$XDG_RUNTIME_DIR/bus\"; systemctl --user is-active --quiet gbot-desktop.service gbot-media.service || { echo 'The bot desktop or media service is stopped. Re-run the installer and check again.'; exit 1; }; echo 'Gbot tools installed; connect to check the desktop.'"
}
