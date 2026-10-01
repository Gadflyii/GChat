---
date: 2026-10-01
title: "Share Chat and Agent capabilities"
---

# 2026-10-01 — Share Chat and Agent capabilities

- **Context:** ordinary Chat advertised only MCP tools and used a separate
  approval store. Selecting a skill changed its execution route. A custom
  assistant prompt could mention Agent Builder without exposing any callable
  builder, saved-agent or worker-pool tools.
- **Decision:** Rust owns the native/MCP capability catalog and execution policy.
  Streaming Chat advertises that catalog and calls its IPC executor. Skill and
  saved-agent delegation reuse the existing bounded Agent orchestrator; Chat,
  Studio and Code share native tools, skills, workspace rules, approvals and
  cancellation. Slash commands select the same capability without changing view.
- **Consequences:** native tools and MCP tools appear together in Chat's tool
  controls. Per-conversation approval mode and connected folders apply to both;
  saved-definition denials and disabled-tool denials retain precedence. Builder
  authoring retains its restricted tools and explicit save confirmation. A remote
  Chat can delegate to an explicitly assigned ready GInfer instance or the sole
  ready instance. It fails clearly when native inference placement is ambiguous.
  Each Chat invocation owns a cancellable run ID; delegated continuation uses a
  stable session per conversation and definition/skill. Task output retains
  inline activity while normal Chat replies continue through the streaming SDK.
  GInfer receives actual system messages, removing the obsolete Gemma-specific
  instruction fold. Engine context capacity and task step budgets are unchanged.
- **Owner:** team.
- **Links:** [current state](../agent-runtime/README.md),
  [Agent architecture](../../src-tauri/src/core/agent/ARCHITECTURE.md).

Supersedes the ordinary-Chat skill-routing portions of
[Chat skills and focused agent authoring](2026-09-17-chat-skills-and-agent-authoring.md)
and [Separate Chat view selection from Agent execution](2026-09-23-separate-chat-view-from-agent-execution.md).
Their builder restrictions and view-selection rules remain applicable.
