---
date: 2026-10-16
title: "Bind managed Host identity and ports to its data root"
---

# 2026-10-16 — Bind managed Host identity and ports to its data root

- **Context:** Desktop bootstrap could follow another installation's per-user locator or collide with a Host on the default management/LAN ports. WSL and Windows can share loopback ports while using separate storage. Checking model-storage paths also confused storage configuration with process ownership.
- **Decision:** Linux and Windows desktop bootstrap select the configured Host state directory. Connections require its canonical directory and platform, plus the existing pinned certificate and Host UUID. The discovery locator records that identity and current endpoint; open clients retain their selected owner. Installed Manager CLI launcher configuration takes precedence over discovery. Managed listeners retain an atomically bound free port when their preferred port is occupied and persist it in that root's existing state. The GChat Manager panel displays the resulting notice.
- **Consequences:** Separate installations can run without attaching to or stopping one another. Existing model locations and current-user installer hooks are preserved. Older running Hosts need a normal restart to report their identity. Explicit standalone listener addresses retain their fixed-port behavior. Optional fields extend the existing locator and Host state; credentials remain private to their original stores.
- **Owner:** team.
- **Links:** `GCHAT-CROSS-OS-HOST-PORT-COLLISION-20261016`; [Custom data folder](../../DEVELOP.md#custom-data-folder); `src-tauri/ginfer-host/src/local_host.rs`; `src-tauri/ginfer-host/src/local_host_registry.rs`.
