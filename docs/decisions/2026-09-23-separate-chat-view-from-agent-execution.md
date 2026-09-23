---
date: 2026-09-23
title: "Separate Chat view selection from Agent execution"
---

# 2026-09-23 — Separate Chat view selection from Agent execution

- **Context:** A Chat thread can invoke a skill through the Agent worker while
  remaining an ordinary Chat thread. Treating tool execution as workspace mode
  changes sidebar history and the behavior of subsequent new-thread actions.
- **Decision:** The Chat/Agent sidebar view follows the thread's explicit
  `agentThreads` mode. `activeSkills` and `usesAgentTools` select execution
  behavior only; a skill invocation does not change the selected workspace view.
- **Consequences:** Chat skill threads stay in Chat history and retain Chat
  navigation while using the skill worker. Opening a thread must not infer its
  sidebar view from the execution route.
- **Owner:** team.
- **Links:** [`2026-09-17-chat-skills-and-agent-authoring.md`](2026-09-17-chat-skills-and-agent-authoring.md),
  [`web-app/src/routes/threads/$threadId.tsx`](../../../web-app/src/routes/threads/$threadId.tsx),
  [`web-app/src/hooks/useAgentMode.ts`](../../../web-app/src/hooks/useAgentMode.ts).

<!--
Supersedes: none
-->
