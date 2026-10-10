---
date: 2026-10-10
title: "Draft Gbot shared runtime and Cua workspaces"
---

# Draft Gbot shared runtime and Cua workspaces

- **Status:** proposed design; no implementation or new dependency is adopted.
- **Context:** the user initially requested a Gbot design with a persistent local, LAN or
  cloud computer workspace, using Cua SDK and Driver as the prospective base.
  The user confirmed Gbot as an embedded feature of the open, LAN-only GChat
  release and part of paid Arbitor, which builds on all GChat work.
  Existing GChat execution stops with the desktop process and shares capabilities
  across Chat, Agent Studio and Code.
- **Decision:** maintain the initial proposal in [the Gbot design](../gbot-design/README.md).
  It separates a persistent service, shared agent runtime, inference assignments
  and computer workspace. SSH is the proposed first Linux transport; Cua Driver
  performs desktop capture/input and Cua SDK manages supported lifecycle actions.
  GChat supplies the front end, lightweight infrastructure management, agent
  builder/support, prebuilt skills/integrations and Gbot. Arbitor adds security,
  logging, cost management, rules engines and related paid layers through explicit
  extension boundaries; paid features remain outside the clean GChat base.
- **Consequences:** connecting existing machines is separate from provisioning.
  Provider and desktop-session compatibility, persistence and viewer integration
  require explicit selection and qualification. Runtime ownership remains unchanged
  until implementation is authorized. Historical cloud VM and Windows 365
  possibilities remain unassigned and outside current GChat LAN scope; this
  decision does not qualify them for Arbitor. Exact paid-feature details, limits,
  pricing, license and distribution remain unspecified. No separate Gbot
  application is selected. GInfer OI-145 CPU inference remains separate work.
- **Owner:** GChat coordinator.
- **Links:** [shared runtime authority](../../src-tauri/src/core/agent/ARCHITECTURE.md),
  [Cua SDK](https://github.com/trycua/cua/blob/main/libs/cua/README.md),
  [Cua Driver](https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md).
