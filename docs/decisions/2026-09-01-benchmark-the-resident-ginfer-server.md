---
date: 2026-09-01
title: "Benchmark the resident GInfer server"
---

# 2026-09-01 — Benchmark the resident GInfer server

- **Context:** GChat needs a user-facing benchmark with presets, graphs, and durable result tables. A separate benchmark executable or model load would measure a different process and configuration from the server the user is actually running.
- **Decision:** The Benchmark page drives the already-loaded `ginfer-serve` session through its authenticated OpenAI Chat Completions and token-count endpoints. The GInfer Tauri plugin owns request concurrency, cancellation, progress, and aggregation from native `x_ginfer` metrics; it never starts, stops, reloads, or repacks a model. Results retain the resident startup configuration, actual token counts, cache hits, and finish reasons, and the UI persists the latest 20 completed runs locally.
- **Consequences:** Results represent the exact resident model and startup-fixed concurrency/KV/speculative settings. Concurrency points cannot exceed the loaded server's capacity, changing engine settings requires an explicit model reload before benchmarking, and cached tokens or early stops remain visible rather than being normalized away.
- **Owner:** team
- **Links:** `web-app/src/routes/benchmark/index.tsx`, `src-tauri/plugins/tauri-plugin-ginfer/src/benchmark.rs`, `docs/serving.md` in `Gadflyii/ginfer`
