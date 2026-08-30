---
date: 2026-08-30
title: "Accept Muse ATEM Agent tool calls"
---

# 2026-08-30 — Accept Muse ATEM Agent tool calls

- **Context:** Muse Glimmer can emit its native ATEM function-call markup in the OpenAI response content instead of populating `message.tool_calls`. The Agent runtime accepted only native OpenAI calls and JSON call arrays. Its one-shot repair fallback then misclassified ATEM markup as a terminal plain-text reply, exposing the markup in the run monitor without executing the requested tool.
- **Decision:** Normalize complete ATEM function-call blocks at the GInfer Agent completion boundary alongside native OpenAI calls and JSON call arrays. Preserve batch calls, map wire aliases to canonical Agent tools, decode parameter entities and represented JSON values, and reject malformed ATEM markup rather than publishing it as a reply.
- **Consequences:** Muse and Qwen Agent stages execute the same bounded tool runtime regardless of which supported call representation GInfer returns. Tool authorization, path policy, batching, observations, and loop protection remain downstream of one normalized `ToolCallPayload` contract.
- **Owner:** team
- **Links:** `src-tauri/src/core/agent/ginfer_client.rs`, `src-tauri/src/core/agent/runner.rs`, `src-tauri/src/core/agent/runner_tests.rs`
