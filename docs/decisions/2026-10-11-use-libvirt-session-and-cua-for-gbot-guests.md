---
date: 2026-10-11
title: "Use libvirt session and Cua for dedicated Gbot guests"
---

# 2026-10-11 — Use libvirt session and Cua for dedicated Gbot guests

- **Context:** Gbot needs a dedicated computer that survives service updates without controlling a user's desktop. Ron approved the S1 host packages, Debian 13 guest and settled session stack.
- **Decision:** Own Linux guests through `qemu:///session` on KVM with passt user networking and loopback SSH forwarding. Use shared cloud-init, TigerVNC Xvnc and XFCE in systemd user units. Expose one desktop environment file; run pinned Cua Driver MCP through SSH, with commands/files on SSH channels. No new native guest-worker binary or system libvirt daemon.
- **Consequences:** Stop before unregistering; undefine before removing owned disks. The existing JSON-worker assumption must be replaced in the service owner before claiming integrated readiness. Windows/Hyper-V and Vision remain separate qualification work.
- **Owner:** GChat.
- **Links:** [Current design and evidence](../gbot/README.md#current-kvm-and-linux-desktop-preparation); approved [S1 plan](/ai/coordination/gbot-vm-plan-20261011.md).
