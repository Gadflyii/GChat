---
date: 2026-10-15
title: "Treat expired Gbot media as closed"
---

# 2026-10-15 — Treat expired Gbot media as closed

- **Context:** The pinned guest daemon expires media sessions without an attached viewer. Closing such a session returns gRPC `NOT_FOUND`. Treating that response as a revocation failure can block Hand back after the local viewer gateway has already stopped.
- **Decision:** After stopping its local gateway, a media lease accepts `NOT_FOUND` from the authenticated guest's `CloseMedia` request for that lease's exact media session ID as successful cleanup. Every other guest failure remains an error. Repeated cleanup uses the same session ID.
- **Consequences:** An expired viewer no longer prevents the subsequent hand-back checks. Authentication, permission, transport and deadline failures still block hand-back. Existing owner checks and a fresh desktop observation remain required before returning control; cleanup alone never resumes a task. This source correction does not establish the cause of the unclassified installed hand-back failure.
- **Owner:** team.
- **Links:** [Media lease](../../src-tauri/gbot-service/src/media.rs), [regressions](../../src-tauri/gbot-service/tests/media.rs), [original lease decision](2026-10-12-wrap-cua-media-in-gbot-control-leases.md).
