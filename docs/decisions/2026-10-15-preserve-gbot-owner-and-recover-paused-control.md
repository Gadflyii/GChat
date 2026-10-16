---
date: 2026-10-15
title: 'Preserve Gbot owner and recover paused control'
---

# 2026-10-15 — Preserve Gbot owner and recover paused control

- **Context:** The GUI stored its control owner only in session storage. A fresh
  app session after an upgrade could create a different owner while the service
  retained a paused bot and its previous owner, preventing ordinary Hand back.
- **Decision:** Persist the GUI owner in the existing per-user webview local
  storage. Migrate the current session owner only when no durable owner exists;
  retain the durable value across launches and upgrades. Refuse to grant a new
  transient identity if durable storage fails.
  For already orphaned controls, expose an explicit, confirmed **Recover control**
  action only through the local service. Eligibility is an exact paused control
  loaded at service startup, with its previous owner and session fenced. Active
  human controls and controls paused in the current service process are excluded.
  Retire media successfully before transferring ownership, keeping control paused.
  Normal **Hand back** still requires a fresh observation; unfinished setup still
  requires an explicit **Resume setup**. Recovery never resumes tasks or setup.
- **Consequences:** Upgrades preserve the owner's identity for the same user
  profile. Recovery is a local administrator action and is not added to paired
  Host forwarding. Old-owner activity withdraws recovery eligibility. Failed
  media close or stale identity/owner leaves the previous owner in place. A
  changed or erased user profile needs the explicit recovery path.
- **Owner:** team.
- **Links:** `web-app/src/services/gbot.ts`, `web-app/src/routes/gbot/index.tsx`,
  `src-tauri/gbot-service/src/{service,workspace,api}.rs`,
  `src-tauri/src/core/gbot.rs`. Approved by Ron through Bubbs, 2026-10-15.
