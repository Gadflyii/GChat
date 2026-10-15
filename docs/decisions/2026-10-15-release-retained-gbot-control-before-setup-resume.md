---
date: 2026-10-15
title: "Release retained Gbot control before setup resume"
---

# 2026-10-15 — Release retained Gbot control before setup resume

- **Context:** Linux service restart retains paused human ownership and rechecks a saved KVM computer before Ready. Setup cannot observe a human-controlled desktop; ordinary Hand back previously required setup Ready, creating a recovery cycle. The settings page also disabled Hand back with the other incomplete-setup controls.
- **Decision:** Permit only Hand back's internally constructed fresh desktop observation to run before setup Ready. Keep its lifecycle lock, exact live session and retained-owner admission, media revocation, operation reconciliation, completed observation journal and valid image geometry requirements. Show Hand back outside the disabled setup controls only when the saved setup, live session, control identity and local owner all match. Missing or foreign identity stays blocked.
- **Consequences:** The original owner can release control and explicitly Resume a failed setup using the same saved computer. Hand back does not itself restart setup, mark it Ready, resume tasks, permit other guest operations or transfer ownership. A readiness check already in progress may continue after control is released. Observation, transport or media errors leave recovery blocked for retry/reconciliation. No public readiness-bypass option is introduced.
- **Owner:** team.
- **Links:** [Gbot design](../gbot/README.md); `src-tauri/gbot-service/src/workspace.rs`; `src-tauri/gbot-service/tests/ssh_loopback.rs`; `web-app/src/routes/gbot/index.tsx`; open item `GBOT-LINUX-PAUSED-RESTART-SETUP-DEADLOCK-20261015`.
