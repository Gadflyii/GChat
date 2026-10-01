---
date: 2026-10-01
title: "Own chat tool lifecycle per session"
---

# 2026-10-01 — Own chat tool lifecycle per session

- **Context:** Installed Windows testing produced a saved, complete assistant
  answer while the conversation still displayed Working. The view maintained
  an independent busy flag, although its Chat instance and completion callbacks
  were cached across navigation. Tool calls also shared a route-level abort
  controller and remained in a mutable queue during asynchronous execution.
- **Decision:** Use SDK request status and session-owned pending tool batches as
  the busy state. Claim calls synchronously, settle each batch by identity, and
  keep its abort controller in the session. Await SDK tool-output admission before
  releasing the batch so automatic follow-ups retain continuous activity.
- **Consequences:** Remounted views observe the cached request's actual state.
  Stopping one conversation cannot abort another, and late cleanup cannot settle
  a newer batch. This changes no engine capacity, step limits or approval policy.
- **Owner:** team.
- **Links:** [Current evidence and acceptance](../agent-runtime/README.md),
  [chat session store](../../web-app/src/stores/chat-session-store.ts),
  [tool executor](../../web-app/src/lib/execute-chat-tool-calls.ts).
