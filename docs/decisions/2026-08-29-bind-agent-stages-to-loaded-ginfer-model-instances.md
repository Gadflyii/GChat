---
date: 2026-08-29
title: "Bind Agent stages to loaded GInfer model instances"
---

# 2026-08-29 — Bind Agent stages to loaded GInfer model instances

- **Context:** Agent Studio initially routed every stage through the chat's active model. That prevented an evaluator, specialist, synthesizer, or workflow node from using a better-suited model even when several GInfer sessions were already resident.
- **Decision:** Agent definition schema version 2 has an optional default model-instance binding and optional evaluator, synthesizer, worker, and workflow-node overrides. An inherited binding resolves to the active chat model at run start. GChat preflights every distinct assigned instance before executing any stage, creates one client and model profile per instance, and records the resolved assignment in live and saved stage traces. Because the current GInfer loader permits at most one live process per registered model ID, definitions persist that stable registered ID; PIDs, ports, and API keys remain runtime-only values.
- **Consequences:** A composition may deliberately mix loaded models without creating another executor or weakening parent cancellation, approval, workspace, or failure semantics. A pinned but unloaded instance fails the run before any stage starts. Multiple simultaneous instances of the same registered model remain unsupported until the model registry owns durable instance aliases rather than ephemeral process identifiers.
- **Owner:** team
- **Links:** `src-tauri/src/core/agent/definitions.rs`, `src-tauri/src/core/agent/commands.rs`, `src-tauri/src/core/agent/orchestrator.rs`, `web-app/src/routes/agents/index.tsx`

<!--
Supersedes in part: 2026-08-29-build-agent-studio-on-one-versioned-orchestration-runtime.md
-->
