---
date: 2026-10-19
title: "Dispatch Chat sub-agents through spawn and wait"
---

# 2026-10-19 — Dispatch Chat sub-agents through spawn and wait

- **Context:** Ron (10-19): when he tells Chat to dispatch agents, the model
  must do it and the agents must be visible as sub-agents in the main chat
  window. Chat already had `agent_spawn`/`agent_wait`, but a local model had to
  issue 2N separate tool calls in the right order, and a worker showed only a
  collapsed "Working..." activity without its task, progress or result.
  Earlier acceptance prompts spelled out the spawn/wait mechanics by hand.
- **Decision:** Chat gets one `agent_dispatch` tool taking 1–8 `{title, task}`
  briefs. The Chat runtime starts every brief at once through the existing
  `agent_spawn` capability, waits for each through `agent_wait`, and returns
  `{agents: [{title, runId, status, result, error, note}]}` to the parent
  model in brief order; a stopped entry notes that the user stopped it. The
  tool is offered only while both `agent_spawn` and `agent_wait` are enabled,
  so per-conversation tool switches still apply.
  Each worker carries a `subAgent` attribution (dispatch tool call, index,
  title, task) and renders as a sub-agent card inside the dispatching message.
- **Why this shape:** No Rust, service or event change. Workers keep the
  existing General Agent runtime, inherited permissions/folders/tools,
  per-worker approval dialogs, durable run records, the shared native
  allocator (Host-admitted concurrency, cancellable queue) and normal-exit
  shutdown. One tool call is far more reliable for a local model than an
  ordered spawn/wait sequence. The 8-brief cap bounds a runaway call; the
  allocator, not the cap, decides how many run at once.
- **Consequences:** A failed or stopped sub-agent reports that outcome and
  never stops its siblings; parent Stop cancels every worker and the waits.
  Results are saved in the tool output, so cards reopen with their outcome
  and result after reload or restart. A dispatch interrupted before its
  results were saved reopens as "Did not finish"; the durable run records
  remain in Agent Studio. Native agents and workers do not get the tool, so
  sub-agents cannot nest. `agent_spawn`/`agent_wait` remain for explicit use.
- **Owner:** GChat coordinator.
- **Links:** [Chat sub-agents](../agent-runtime/README.md#chat-sub-agents--october-19),
  `web-app/src/lib/sub-agents.ts`, `web-app/src/lib/execute-chat-capability.ts`,
  `web-app/src/containers/SubAgentCards.tsx`.
