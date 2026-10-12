---
date: 2026-10-12
title: "Own Gbot schedule occurrences in the service"
---

# 2026-10-12 — Own Gbot schedule occurrences in the service

- **Context:** Existing Cua tasks and connector receipts are durable, but the GChat native bridge still owns the local service lifetime. Scheduling must not invent another executor or replay unknown desktop/connector effects after restart.
- **Decision:** The service owns a UTC once/interval schedule journal alongside task journals. It saves a stable task ID, prompt and explicit bot model assignment before dispatch through the existing TaskRunner. Each schedule keeps at most one unfinished occurrence. `run_latest` coalesces missed intervals; `skip_missed` skips pre-restart/pre-enable and multi-interval backlogs. Recovery attaches saved tasks and never automatically resumes interrupted or unknown dispatches; those hold future occurrences for review.
- **Consequences:** Users can create, list and disable schedules while the service runs, preserving normal approval, connector scope, takeover and Stop behavior. Disabling skips queued work and leaves running tasks under normal controls. Connection/readiness failures persist a 30-second retry deadline across restart. Scheduler errors and uncertain journal publication appear in schedule listing and a persistent UI stopped notice. Credentials stay in the native vault. The persistent UI notice states that tasks run while GChat is open; independent OS/service lifetime and client-exit/sleep continuity remain unfinished. No service installation, new dependency or alternate executor is introduced.
- **Owner:** GChat.
- **Links:** [Gbot current authority](../gbot/README.md), [remaining acceptance](../agent-runtime/remaining-acceptance.md), `src-tauri/gbot-service/src/schedules.rs`.
