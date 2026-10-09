---
date: 2026-10-09
title: "Load capability schemas on demand"
---

# 2026-10-09 — Load capability schemas on demand

- **Context:** the installed Muse Chat request included the complete native and
  connected MCP tool schemas and failed preflight at 40,666 tokens against its
  32,768-token Engine context. The selected instance and model metadata agreed
  on the context capacity. The shared catalog and execution policy remain the
  product contract.
- **Decision:** retain the complete catalog, but send compact discovery,
  exact-schema lookup and exact-target invocation tools to Chat and Code. Agent
  requests send frequent native schemas and rare native schemas loaded through
  `tool.view`; MCP access uses compact search/read tools and an approval-gated
  call that identifies the exact connector target. Existing dispatchers
  recheck disabled tools, workspace policy, approvals and cancellation at
  execution. Agent Builder keeps its existing narrow Studio-only schema set.
- **Consequences:** ordinary prompts no longer carry every tool schema. Skills,
  saved agents, worker pools and configured connectors remain available through
  their owning runtimes. Search results expose matching names and descriptions;
  the model loads the selected schema before invocation. Model and profile
  context limits and execution permissions are unchanged.
- **Owner:** team.
- **Links:** [current state](../agent-runtime/README.md),
  [Agent architecture](../../src-tauri/src/core/agent/ARCHITECTURE.md),
  [Chat and Agent capability contract](2026-10-01-share-chat-and-agent-capabilities.md).

Supersedes the full-schema advertisement consequence in
[Share Chat and Agent capabilities](2026-10-01-share-chat-and-agent-capabilities.md).
