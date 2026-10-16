---
date: 2026-10-16
title: "Record Gbot task admission holders"
---

# 2026-10-16 — Record Gbot task admission holders

- **Context:** Saved setup can encounter the task admission mutex before task-state checks. Existing evidence records only a busy message, so it cannot distinguish a live holder from a stalled holder after the event.
- **Decision:** Label each existing TaskRunner acquisition with its operation and available workspace/task identity. On setup contention, write the holder, acquisition time and elapsed hold time to the service stderr log. A small metadata mutex serializes acquisition publication and guard release; the underlying Tokio mutex and its queued acquisition future remain authoritative.
- **Consequences:** Diagnostics contain no prompts, commands or credentials. The user-facing error, admission policy, task lifecycle and FIFO queue remain unchanged. RAII clears metadata on release, cancellation and error. This adds evidence for future contention; it does not establish the holder of the earlier uninstrumented run or authorize a native retry.
- **Owner:** team.
- **Links:** [Task admission](../../src-tauri/gbot-service/src/tasks.rs), [Gbot scope](../gbot/README.md).
