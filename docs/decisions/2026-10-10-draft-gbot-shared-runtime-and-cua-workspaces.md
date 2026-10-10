---
date: 2026-10-10
title: "Draft Gbot shared runtime and Cua workspaces"
---

# Draft Gbot shared runtime and Cua workspaces

- **Status:** proposed design; no implementation or new dependency is adopted.
- **Context:** the user requested a Gbot design with a persistent local, LAN or
  cloud computer workspace, using Cua SDK and Driver as the prospective base.
  Existing GChat execution stops with the desktop process and shares capabilities
  across Chat, Agent Studio and Code.
- **Decision:** maintain the initial proposal in [the Gbot design](../gbot/README.md).
  It separates a persistent service, shared agent runtime, inference assignments
  and computer workspace. SSH is the proposed first Linux transport; Cua Driver
  performs desktop capture/input and Cua SDK manages supported lifecycle actions.
- **Consequences:** connecting existing machines is separate from provisioning.
  Provider and desktop-session compatibility, persistence and viewer integration
  require explicit selection and qualification. Runtime ownership remains unchanged
  until implementation is authorized. Windows 365 is a conditional candidate.
- **Owner:** GChat coordinator.
- **Links:** [shared runtime authority](../../src-tauri/src/core/agent/ARCHITECTURE.md),
  [Cua SDK](https://github.com/trycua/cua/blob/main/libs/cua/README.md),
  [Cua Driver](https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md).
