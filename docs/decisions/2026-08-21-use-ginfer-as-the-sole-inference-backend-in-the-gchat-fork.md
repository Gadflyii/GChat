---
date: 2026-08-21
title: "Use ginfer as the sole inference backend in the gchat fork"
---

# 2026-08-21 — Use ginfer as the sole inference backend in the gchat fork

- **Context:** this fork (`Gadflyii/gchat`, branched from Atomic Chat v2.0.23)
  is being turned into the interface for our own inference engine,
  [ginfer](https://github.com/Gadflyii/ginfer) (C++/CUDA, `.ginfer` model
  containers, `ginfer-serve` OpenAI-compatible HTTP server,
  Linux x86_64 + NVIDIA CUDA 13.1 / SM 86-89-120a; Windows port planned).
  The upstream app ships four inference backends (llamacpp turboquant fork,
  llamacpp-upstream, MLX, Apple Foundation Models) plus a GGUF model hub,
  none of which fit a closed-set custom-format engine.
- **Decision:** ginfer is the ONLY inference backend. Strip:
  `extensions/llamacpp-extension/`, `extensions/llamacpp-upstream-extension/`,
  `extensions/mlx-extension/`, `extensions/foundation-models-extension/`,
  their four Rust plugins under `src-tauri/plugins/`, the legacy
  `mlx-server/` + `foundation-models-server/` Swift sources, their
  pre-install tarballs and backend-download scripts, the multi-local-provider
  defaults/migrations, the GGUF-specific hub contents, the cloud/remote
  provider registry, and the local scan of Ollama/LM Studio/HF-cache folders
  (replaced by a scan of the local ginfer model cache directory).
  Add: `extensions/ginfer-extension/` (provider `ginfer`, extending
  `AIEngine`) + `src-tauri/plugins/tauri-plugin-ginfer/` owning
  `ginfer-serve` process lifecycle; ModelFactory + 1337-proxy arms for
  `ginfer`; `ginfer` as the default provider; the model catalog pre-populated
  with the first four published artifacts (Qwen3.8-27B int-autoround +
  NVFP4, Muse Glimmer 30B int-autoround + NVFP4) from a single collection on
  our Hugging Face account; `ginfer-serve` binary sourcing via download
  (Windows artifacts land when the port is done).
  Retain: the HF download pipeline (narrowed to `.ginfer`), the model catalog
  framework (future models/publishers), the `localhost:1337` OpenAI facade
  (now ginfer-only), and the rag / assistant / conversational / agent
  extensions. `rag-extension` stays wired but feature-disabled until ginfer
  ships an embeddings endpoint.
- **Consequences:** one backend to test, but the fork is locked to
  CUDA-13.1/NVIDIA hardware on Linux (Windows gated until the ginfer port
  ships) — the hardware gate must surface a clear "unsupported" state
  everywhere the app previously assumed llama.cpp. Model identity comes from
  the `.ginfer` artifact itself (closed registered set); anything outside it
  fails at server start, so catalog entries must track published artifacts
  1:1. RAG is a dead end feature until embeddings exist in ginfer. All
  upstream provider ADRs that reference the stripped backends describe
  history only.
- **Owner:** @Gadflyii
- **Links:** `Gadflyii/ginfer` (engine; `docs/serving.md` for the
  `ginfer-serve` contract), `Gadflyii/gchat` (this fork).
