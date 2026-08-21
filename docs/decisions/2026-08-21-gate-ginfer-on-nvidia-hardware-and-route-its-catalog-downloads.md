---
date: 2026-08-21
title: "Gate ginfer on NVIDIA hardware and route its catalog downloads to the ginfer engine"
---

# 2026-08-21 — Gate ginfer on NVIDIA hardware and route its catalog downloads to the ginfer engine

- **Context:** the fork decision to make ginfer the sole inference backend
  (see the parent record) requires three concrete behaviors the app did not
  previously have: a hardware gate that surfaces a clear "unsupported" state
  where the app once assumed llama.cpp; the first four published `.ginfer`
  artifacts in the bundled catalog; and a way to point a catalog download at
  the `ginfer` engine rather than the default llama.cpp engine.
- **Decision:**
  - **Hardware gate.** `extensions/ginfer-extension` probes
    `tauri-plugin-hardware` (`get_system_info`) in a new `src/hardware.ts`.
    A machine is eligible when `os_type` is `linux` or `windows` AND at least
    one GPU reports vendor `NVIDIA`. When an NVIDIA GPU reports a compute
    capability, it must be one of `8.6` / `8.9` / `12.0` (SM 86 / 89 / 120a);
    a GPU whose capability is unreadable (NVML unavailable) is **let through**
    so the engine can surface any real SM mismatch at load time rather than
    being blocked by a missing probe. The gate runs in `load()` (after an
    existing-session reuse check) and in `import()` **before any bytes move**,
    so an unsupported machine gets a clear toast instead of a wasted
    16-23 GiB download. The extension also declares `compatibility()` as
    `{ platform: ['linux','windows'] }`.
  - **Catalog entries.** `BASELINE_MODEL_CATALOG` gains the four artifacts
    (Qwen3.8-27B int-autoround / NVFP4, Muse Glimmer 30B int-autoround /
    NVFP4) via a `ginferEntry()` helper. Each has `library_name: 'ginfer'`, a
    single `quants[]` row whose `path` is the HF `resolve/main/model.ginfer`
    URL, and `file_size: ''`. Size/SHA are deliberately omitted so the
    download defers to the live HF repo at download time (mirroring GGUF
    deferral); an unpublished repo degrades to a clean download error, not a
    crash. A cosmetic `name?` field is added to `CatalogModel` for the curated
    display name (the Hub prefers it over the derived repo name).
  - **Download routing.** Rather than a dedicated ginfer download component
    (the MLX shape), `ModelsService.pullModel` / `pullModelWithMetadata` gain
    a trailing optional `provider` argument that selects the target engine
    (`undefined` = platform-default llama.cpp). `ModelDownloadAction` passes
    `'ginfer'` for `library_name === 'ginfer'` entries and routes install
    detection + the post-download "New chat" action to the `ginfer` provider.
    `hub-installed` registers `GINFER_PROVIDER` in `LOCAL_PROVIDERS` and the
    installed-model collector. The resume path carries `provider` through
    `useDownloadStore` resume params.
  - **Default provider.** `useModelProvider` fresh-install initial state sets
    `selectedProvider` to `'ginfer'` (existing persisted installs are
    untouched — the migrations never rewrite it).
- **Consequences:** unsupported machines (no NVIDIA GPU / wrong OS) still see
  the ginfer provider and its catalog rows, but loading or importing a model
  fails fast with an actionable message — the same "listed but clearly
  unsupported" treatment mlx gets on an unsupported Mac. The `provider`
  argument is purely additive (every prior call site still compiles). The
  unknown-SM leniency means a rare NVML-less NVIDIA box may attempt a load and
  get the engine's own error rather than the gate's; that is preferred over
  false-blocking a valid GPU. Catalog `file_size` stays empty until the
  artifacts publish, so Hub fit-dots read "maybe" for those rows until then.
- **Owner:** @Gadflyii
- **Links:** parent — `2026-08-21-use-ginfer-as-the-sole-inference-backend-in-the-gchat-fork.md`;
  `extensions/ginfer-extension/src/hardware.ts`,
  `extensions/ginfer-extension/src/index.ts` (`compatibility`, `assertHardware`),
  `web-app/src/services/models/default.ts` (`pullModel`/`pullModelWithMetadata`),
  `web-app/src/containers/ModelDownloadAction.tsx`,
  `web-app/src/lib/hub-installed.ts`, `web-app/src/hooks/useModelProvider.ts`,
  `web-app/src/constants/models.ts` (`ginferEntry`).
