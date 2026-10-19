---
date: 2026-10-19
title: "Dispatch Gbot sub-agents as child tasks"
---

# 2026-10-19 — Dispatch Gbot sub-agents as child tasks

- **Context:** Ron (10-19): Gbot must be able to dispatch sub-agents, visible
  to the user, like Chat. Chat's sub-agents are General Agent workers in the
  desktop runtime ([ADR](2026-10-19-dispatch-chat-sub-agents-through-spawn-and-wait.md)),
  but the Gbot service runs without the desktop and its brain is a Cua
  computer-use agent working on the bot's own computer.
- **Decision:** Bot tasks get the same `agent_dispatch` contract (name, 1–8
  `{title, task}` briefs, result shape, stopped-by-user note). The service
  starts one ordinary child task per brief through its task runner, with the
  parent's computer and tools minus `agent_dispatch`, a short sub-agent
  instruction, and a freshly resolved model assignment, so each child holds
  its own inference lease and the Host admits them within its concurrency.
  The parent waits for every child to settle and records the reply in its
  journal (`dispatches`); each child records `sub_agent` (parent, call,
  index, title). Gbot shows children as sub-agent cards inside their parent
  task using the Chat card view.
- **Why child tasks:** They keep every existing guarantee unchanged:
  approvals per action, `ask_human` questions, Stop through `tasks/cancel`,
  history, restart recovery, takeover pause and computer-removal guards. No
  new service, route or process type.
- **Consequences:** Sub-agents share the bot's single desktop and the service
  delivers native input in the foreground, so the tool and the child
  instruction tell each sub-agent to use only its own apps, windows and files
  and to observe before every action. Work that needs the same window at the
  same time should not be split. Cancelling a parent cancels its unfinished
  children; a resumed parent reattaches to the children it started and
  resumes interrupted ones; after a human takeover an unanswered dispatch is
  skipped like any other old proposal and its unfinished children stop.
  A child that waits for a person's answer keeps its parent waiting.
- **Owner:** GChat coordinator.
- **Links:** [Gbot sub-agents](../gbot/README.md#sub-agents--october-19),
  `src-tauri/gbot-service/src/sub_agents.rs`, `executor.rs` (`dispatch`),
  `tasks.rs` (`start_sub_agent`, `wait_sub_agent`, cascading `cancel`),
  `web-app/src/components/GbotSubAgents.tsx`.
