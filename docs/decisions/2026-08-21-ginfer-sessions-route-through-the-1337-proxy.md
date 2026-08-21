---
date: 2026-08-21
title: "Route ginfer sessions through the 1337 proxy like the other local backends"
---

# 2026-08-21 — Route ginfer sessions through the 1337 proxy like the other local backends

- **Context:** the ginfer backend (`extensions/ginfer-extension/` +
  `src-tauri/plugins/tauri-plugin-ginfer/`) spawns one `ginfer-serve`
  process per loaded model, each serving an OpenAI-compatible
  `/v1` on a random loopback port with a per-session bearer key
  (`SessionInfo { pid, port, model_id, model_path, is_embedding, api_key }`).
  The `localhost:1337` OpenAI facade (`src-tauri/src/core/server/proxy.rs`)
  dispatches every request by model name against the in-process session
  maps of the local backends, so a ginfer model must be discoverable and
  routable there like a llama.cpp / MLX session.
- **Decision:** the proxy treats `ginfer` as a first-class local backend:
  - `POST /v1/chat/completions`, `/v1/completions`, `/v1/embeddings`,
    `/v1/messages/count_tokens` and the Anthropic `POST /v1/messages`
    fallback chain look up the `ginfer_sessions` map after the llama.cpp /
    MLX maps and forward to `http://127.0.0.1:<port>/v1…` with the
    session's bearer key.
  - `GET /v1/models` lists live ginfer sessions (`owned_by: "ginfer"`).
  - `GET /v1/metrics` stays llama.cpp-only: `ginfer-serve` exposes no
    Prometheus endpoint (only `/health`).
  - `POST /v1/responses` (Codex-style clients) resolves ginfer sessions and
    bridges them through `responses_shim` to `/v1/chat/completions`
    (`Target::Translate`, same as llama.cpp) — `ginfer-serve` does not serve
    the Responses API, unlike the MLX sidecar, which keeps
    `Target::Passthrough`.
  - The auto-increase-context retry (`maybe_auto_increase_and_retry`)
    deliberately excludes `ginfer`: the ginfer extension has no
    `local_backend://auto_increase_ctx` handler, so a ginfer session would
    time out the 60 s coordination wait on every context-limit error.
    `is_embedding_session` / `resolve_local_session` do carry ginfer
    branches for completeness; they are unreachable while the gate above
    stands.
  - Frontend: `ModelFactory.resolveLocalSession` / `prewarmSession` /
    `createModel` use `plugin:ginfer|find_session_by_model` and the shared
    `createLocalStreamingFetch` SSE path; `ginfer` is in the local-provider
    lists of `services/models/default.ts`, `custom-chat-transport.ts`
    (`LOCAL_INFERENCE_PROVIDERS`), `utils/switchModel.ts` and
    `utils/registerRemoteProvider.ts`, so `startModel` / `stopModel`, the
    system-prompt folding and the tool-result image handling apply to it.
- **Consequences:** any OpenAI-compatible client pointed at `localhost:1337`
  can target a loaded ginfer model by name; `ginfer-serve` only speaks Chat
  Completions, so responses-API clients get the shim (correct but one
  conversion hop deeper than MLX). Context-overflow responses from ginfer
  are surfaced as plain errors — auto-growing context is a later phase,
  together with the ginfer extension handling the increase event.
  Embedding sessions keep the `is_embedding` flag in `SessionInfo`; once
  ginfer ships embeddings the proxy branch already honors it.
- **Owner:** @Gadflyii
- **Links:** `2026-08-21-use-ginfer-as-the-sole-inference-backend-in-the-gchat-fork.md`,
  `Gadflyii/ginfer` (`docs/serving.md` for the `ginfer-serve` contract),
  `src-tauri/src/core/server/proxy.rs`.
