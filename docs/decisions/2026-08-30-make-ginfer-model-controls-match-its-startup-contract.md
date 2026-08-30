---
date: 2026-08-30
title: "Make GInfer model controls match its startup contract"
---

# 2026-08-30 — Make GInfer model controls match its startup contract

- **Context:** GChat still derived every local model's controls from a generic llama.cpp profile.
  It displayed GPU-layer offload, translated `ctx_len` to the ignored `ctx_size` key, seeded 16,384
  tokens regardless of the registered artifact, and passed a model ID to an unload method that
  interpreted it as a process ID. The UI therefore could disagree with the running server, context
  changes did not take effect, and Stop could report success without stopping anything.
- **Decision:** Registered GInfer families declare their model-native logical context limit in the
  provider extension. GChat exposes only the per-model context controls, passes `ctx_len` as
  GInfer's startup-fixed `max_context`, reads the authenticated running value from `/v1/models`,
  and reloads an active model when that value changes. Stop resolves the model ID to its owned
  process before unloading, and the provider page offers an explicit reload action. Generic GPU
  offload and llama.cpp model settings are not part of the GInfer UI or load request.
- **Consequences:** The context slider cannot exceed the registered model limit and distinguishes
  the saved next-start value from the value currently loaded. Context changes briefly interrupt
  service because they require a process reload. Selecting the native logical ceiling does not
  reserve that many tokens of KV memory: GInfer independently sizes its physical KV arena from
  available device memory.
- **Owner:** team
- **Links:** `extensions/ginfer-extension/src/model-profile.ts`,
  `extensions/ginfer-extension/src/index.ts`, `web-app/src/containers/ContextSizeControl.tsx`,
  `web-app/src/services/models/default.ts`, `Gadflyii/ginfer/docs/serving.md`.

<!--
Supersedes in part: 2026-07-27-replace-advanced-model-settings-with-a-focused-context-control.md
Extends: 2026-08-28-align-the-bundled-ginfer-profile-with-ginfer-serve.md
-->
