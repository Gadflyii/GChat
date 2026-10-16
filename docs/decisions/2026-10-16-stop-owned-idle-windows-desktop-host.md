---
date: 2026-10-16
title: "Stop the owned idle Windows desktop Host normally"
---

# 2026-10-16 — Stop the owned idle Windows desktop Host normally

- **Context:** Windows desktop Hosts are detached from the launching application.
  Unlike the Linux stdin lifetime, closing the desktop did not provide a normal
  shutdown path. Stopping an arbitrary listener or terminating a busy Host would
  risk another installation's work or interrupt a model load.
- **Decision:** Only Windows desktop-managed Hosts enable authenticated normal
  Stop. The client uses its already attached desktop owner, pinned certificate,
  Host UUID, boot UUID and canonical data root/platform identity. The Host closes
  admission atomically after proving it has no active model, load, profiling,
  calibration, download or setup transaction, then drains its Stop response and
  exits normally. GChat and Manager request this on Quit; **Stop Host and Quit**
  keeps the application open on refusal. The client suppresses passive bootstrap
  after acceptance.
- **Consequences:** Busy Hosts remain running and no forced termination is used.
  Stop does not discover an owner, create storage, unlock saved credentials or
  start a missing Host. Linux, Windows services and remote Hosts retain their
  existing lifecycle. Linux seam regressions cover ownership, busy refusal and
  admission; the Windows release gate owns native qualification.
- **Owner:** team.
- **Links:** [Host lifecycle](../../src-tauri/ginfer-host/src/main.rs),
  [Host service](../../src-tauri/ginfer-host/src/service.rs),
  [Manager guide](../ginfer-manager/guide.md).
