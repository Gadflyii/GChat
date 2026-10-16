---
date: 2026-10-16
title: "Renew idle Gbot setup after a proven desktop restart"
---

# 2026-10-16 — Renew idle Gbot setup after a proven desktop restart

- **Context:** Saved KVM setup retains its session across guest boots. The guest correctly binds each session to one desktop service invocation, so a later invocation rejects the old session before the setup document can open.
- **Decision:** Only an authenticated check proving distinct saved and active desktop invocation IDs may renew the saved setup session. Hold workspace lifecycle, task admission and service ownership/operation fences through cleanup, persistence and reconnect. Permit renewal only for the exact idle bot session, with no human owner, unfinished task or unresolved operation. Load the task journal before automatically resuming saved setup. Revalidate cached setup transports before journaling work.
- **Consequences:** Workspace and guest identities, pinned SSH credentials, completed history, tasks and assignments remain intact. Persist the new session before reconnecting so retries retain it. Cleanup failures, incomplete proof, human/paused control and unresolved work fail closed. The guest desktop binding and normal explicit control recovery remain unchanged.
- **Owner:** team.
- **Links:** `src-tauri/gbot-service/src/{api.rs,tasks.rs,kvm_setup.rs,workspace.rs,service.rs,ssh.rs,ssh/guest.rs}`, `src-tauri/gbot-service/tests/ssh_loopback.rs`.
