---
date: 2026-10-16
title: "Hand off the owned Host during an App Data move"
---

# 2026-10-16 — Hand off the owned Host during an App Data move

- **Context:** Changing App Data copied files and updated configuration while the
  desktop-managed Host could still own the old root. The UI also stopped models
  before copying. A competing bootstrap, copied lock file or foreign discovery
  owner could make the new configuration refer to the wrong running process.
- **Decision:** Settings → General drives one native move transaction. Validate a
  separate empty destination, serialize desktop bootstrap, and reserve both Host
  roots. If the old root has a running Host, authenticate its saved endpoint using
  its pinned certificate, Host/boot UUIDs and canonical root/platform identity,
  request idle Stop and wait for actual ownership release. Busy work refuses the
  move without a model unload or forced termination. Linux desktop-managed Hosts
  allow this relocation-only Stop; ordinary Linux Quit and Stop controls keep
  their existing behavior. Copy with the existing generated-cache exclusions,
  excluding the exact `ginfer/host/host.lock` file. Verify the copied Host UUID
  and certificate, save the new App Data configuration, then compare-and-switch
  discovery only while it still names the old desktop owner. Preserve a foreign
  desktop or service registration. On Windows, move this root's existing Gbot
  sign-in entry under the same fence: verify the new entry before removing the
  old one, then commit configuration and discovery. Restore both entries if any
  part of that handoff fails. A disabled entry stays disabled, and an occupied
  destination entry refuses the move. Release both roots before any restart.
- **Consequences:** A precommit copy/configuration/registration failure keeps or
  restores the old selection and restarts the old Host only if this transaction
  stopped it. Rollback or recovery failures are explicit. Once committed, a Host
  restart failure leaves the new selection saved; Settings displays that path
  and the error without relaunching. A successful move relaunches GChat; a
  previously running Host restarts at the new root, while an unused Host is not
  started by the move. Old data and any partial destination are retained.
  Existing absolute model, download and artifact paths remain exactly as stored;
  their referenced external files are not moved or rewritten by this operation.
  The old files needed by those paths must remain available. Native Windows
  qualification remains a separate release gate.
- **Owner:** team.
- **Links:** `GCHAT-WINDOWS-APP-DATA-MOVE-HOST-ROOT-20261016`;
  [Custom data folder](../../DEVELOP.md#custom-data-folder);
  [Move transaction](../../src-tauri/src/core/engine_hosts.rs);
  [Client ownership guard](../../src-tauri/ginfer-host/src/client.rs);
  [Discovery handoff](../../src-tauri/ginfer-host/src/local_host_registry.rs);
  [Ordinary Windows Stop](2026-10-16-stop-owned-idle-windows-desktop-host.md).
