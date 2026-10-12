---
date: 2026-10-12
title: "Install Linux resources asynchronously before local admission"
---

# 2026-10-12 — Install Linux resources asynchronously before local admission

- **Context:** copying and hashing bundled VM/runtime files in Tauri setup held
  the main thread and prevented the installed Linux window from rendering.
- **Decision:** keep the existing verified installer on one blocking worker.
  Retain its result in shared desktop readiness state. Host initialization,
  hardware preparation, model loading and Gbot connection await that state.
  Inject the model plugin's preparation hook from the desktop owner.
- **Consequences:** the window can render during installation; dependent commands
  wait asynchronously and receive installation failures. Canceling a waiting
  command cannot cancel or duplicate the installer. Headless installation and
  synchronous Windows installation retain their existing ownership.
- **Owner:** GChat.
- **Links:** [Current work and evidence](../gbot/README.md),
  `GCHAT-LINUX-RESOURCE-INSTALL-UI-BLOCK` in the GInfer master issue list.
