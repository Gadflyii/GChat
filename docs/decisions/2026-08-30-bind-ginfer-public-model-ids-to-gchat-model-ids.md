---
date: 2026-08-30
title: "Bind GInfer public model IDs to GChat model IDs"
---

# 2026-08-30 — Bind GInfer public model IDs to GChat model IDs

- **Context:** GChat registers local artifacts by their cache-directory ID, while a `.ginfer`
  artifact has a family identity such as `muse-glimmer-30b`. GInfer rejects OpenAI requests whose
  `model` field does not equal the server's public model ID. Discovering that ID after startup was
  session-local and failed when the authenticated `/v1/models` endpoint was queried without the
  session key, leaving a healthy server that rejected GChat's requests.
- **Decision:** Every GChat-owned `ginfer-serve` process starts with
  `--model-id <GChat model ID>`. The process session, `/v1/models`, Chat Completions, Responses, and
  Agent clients therefore share one stable registry identity without a post-start translation
  cache. The artifact identity continues to select and validate the native GInfer target.
- **Consequences:** Imported and downloaded artifacts can use distinct GChat IDs without exposing
  their filename or internal family identity on the API. A model must be restarted after its GChat
  ID changes. Direct `ginfer-serve` launches outside GChat continue to use the artifact identity by
  default.
- **Owner:** team
- **Links:** `src-tauri/plugins/tauri-plugin-ginfer/src/commands.rs`,
  `extensions/ginfer-extension/src/index.ts`, `Gadflyii/ginfer/docs/serving.md`
