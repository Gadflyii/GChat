---
date: 2026-10-12
title: "Persist Gbot human assistance in its task channel"
---

# 2026-10-12 — Persist Gbot human assistance in its task channel

- **Context:** Cua's human completion queue is in-memory and its standalone UI/server adds dependencies. GChat already owns durable tasks, channels and action approvals.
- **Decision:** Borrow Cua's question/completion shape through `ask_human`. Save the request and reply with the task; release executor children while waiting. Reply or decline continues through the existing saved assignment and session. Stop or takeover cancels outstanding questions.
- **Consequences:** Restart preserves unanswered questions and saved replies. Reply does not authorize an action or transfer desktop control. Failed reconnect retains the reply and leaves Resume available. No human-tool server or dependency is added.
- **Owner:** @Gadflyii
- **Links:** [Gbot design](../gbot/README.md), [Cua adoption](../gbot/cua-map.md#human-assistance-is-separate-from-desktop-ownership).
