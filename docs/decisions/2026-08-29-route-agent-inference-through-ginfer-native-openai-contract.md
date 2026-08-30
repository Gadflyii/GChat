---
date: 2026-08-29
title: "Route Agent inference through GInfer's native OpenAI contract"
---

# 2026-08-29 — Route Agent inference through GInfer's native OpenAI contract

- **Context:** Agent Studio could assign stages to loaded GInfer sessions, but its executor still spoke llama.cpp-specific `/props` and `/completion` contracts, supplied GBNF and slot fields, and estimated throughput from request behavior. Those assumptions bypassed GInfer's model discovery, native tools, reasoning controls, Vision route, and exact engine timing.
- **Decision:** Every Agent stage resolves its registered model through `GET /v1/models` and executes text, native function tools, and Vision through non-streaming `POST /v1/chat/completions` directly against the assigned `ginfer-serve` session. Definition schema version 3 exposes `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` reasoning effort at the definition and role levels with explicit inheritance. Stage and per-instance monitors aggregate GInfer's additive `x_ginfer` prefill/decode timing with the response token counts; they do not substitute HTTP wall time.
- **Consequences:** Agent execution has one GInfer-owned inference contract and no llama.cpp grammar, slot, or profile compatibility path. Dotted internal tool names are deterministically mapped to GInfer-safe wire names and mapped back before local validation. A run preflights every assigned model, propagates reasoning policy to repair and Vision requests, and retains exact resolved model, reasoning, and throughput facts in run history. This introduces a deliberate dependency on the GInfer `x_ginfer` response extension for exact performance telemetry.
- **Owner:** team
- **Links:** `src-tauri/src/core/agent/ginfer_client.rs`, `src-tauri/src/core/agent/orchestrator.rs`, `src-tauri/src/core/agent/runs.rs`, `web-app/src/lib/agent-metrics.ts`, `src/serve/openai_schema.cpp`

<!--
Supersedes in part: 2026-07-24-restrict-agent-mode-to-local-llama-cpp-providers.md
Supersedes in part: 2026-08-29-bind-agent-stages-to-loaded-ginfer-model-instances.md
-->
