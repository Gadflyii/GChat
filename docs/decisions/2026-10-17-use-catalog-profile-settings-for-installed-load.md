---
date: 2026-10-17
title: "Use catalog profile settings for Installed Load"
---

# 2026-10-17 — Use catalog profile settings for Installed Load

- **Context:** Installed Load exposes GPU selection but no context or Vision controls. Model-library defaults (Flash Next: 262144 context, Vision on) excluded the screened RTX PRO 6000 profile (131072 context, C8, Vision off), rejecting Load before Start.
- **Decision:** Installed Load explicitly requests the Host catalog profile's complete settings while retaining the user's GPU selection and CUDA visibility constraints. It reuses a resident only when those settings match, and fails closed when no eligible catalog profile exists. Other callers retain custom model and engine settings.
- **Consequences:** The screened profile's context cap, concurrency, options and qualification are preserved. No full-context qualification is implied, and saved custom settings are not overwritten.
- **Owner:** team.
- **Links:** `web-app/src/containers/ModelManagement.tsx`, `src-tauri/plugins/tauri-plugin-ginfer/src/managed.rs`.
