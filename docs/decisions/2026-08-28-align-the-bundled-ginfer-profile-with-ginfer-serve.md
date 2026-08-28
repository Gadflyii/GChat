---
date: 2026-08-28
title: "Align the bundled GInfer profile with ginfer-serve"
---

# 2026-08-28 — Align the bundled GInfer profile with ginfer-serve

- **Context:** GChat's bundled GInfer provider predated the current native
  server CLI. It exposed retired MTP, LM-head-draft, and token-valued
  KV-capacity controls; omitted NVFP4 KV and DFlash2 placement; represented
  automatic settings with ambiguous empty values; and placed the model after
  the options even though `ginfer-serve` requires the artifact as its first
  argument.
- **Decision:** The bundled profile follows the current `ginfer-serve`
  startup contract. Vision is enabled by default. Automatic speculative, KV
  dtype, draft placement, and KV-arena choices omit their corresponding CLI
  overrides so GInfer owns selection. The UI exposes only DFlash2, TP1/TP2/TP4
  draft placement, and BF16/INT8/NVFP4 KV choices; retired controls are
  removed. The process launcher emits the artifact first and rejects values
  outside the native contract before spawning the server.
- **Consequences:** Fresh installs start multimodal registered packages with
  engine-owned automatic defaults. Existing saved values for removed setting
  keys are inert. Changes to the GInfer CLI must update the provider schema,
  guest type, Rust argument builder, and its argument-contract tests together.
- **Owner:** @Gadflyii
- **Links:** `extensions/ginfer-extension/settings.json`,
  `src-tauri/plugins/tauri-plugin-ginfer/src/commands.rs`,
  `Gadflyii/ginfer/docs/serving.md`.
