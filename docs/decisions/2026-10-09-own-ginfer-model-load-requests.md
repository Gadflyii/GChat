---
date: 2026-10-09
title: "Own GInfer model load requests"
---

# 2026-10-09 — Own GInfer model load requests

- **Context:** the desktop command, CLI adapter and private Host loader passed
  the same paths/model/launch settings as eight to ten positional arguments.
- **Decision:** carry those settings in one `GinferLoadRequest`. The internal
  Tauri command receives `{ request }` with camelCase request fields; the
  existing nested `GinferConfig` keeps its snake_case fields and normalization.
  CLI facade port/auth settings belong to a separate `CliEndpointSettings`.
- **Consequences:** all desktop, guest and CLI callers use named fields.
  Rust requires the load fields; the guest retains false/600-second defaults.
  Host startup still rejects embedding requests, and supported HTTP protocols,
  model/profile selection and Engine launch settings retain their behavior.
  Windows Host/Engine paths remain JSON strings deserialized to owned `PathBuf`.
- **Owner:** GChat coordinator.
- **Links:** [plugin commands](../../src-tauri/plugins/tauri-plugin-ginfer/src/commands.rs),
  [guest API](../../src-tauri/plugins/tauri-plugin-ginfer/guest-js/index.ts).
