---
date: 2026-10-17
title: "Move Linux Gbot sign-in registration with App Data"
---

# 2026-10-17 — Move Linux Gbot sign-in registration with App Data

- **Context:** The Linux desktop sign-in filename hashes the exact App Data path. A move left the old entry behind, so the next desktop sign-in could start Gbot against the retained old state. The move fenced the inference Host but allowed the independent Gbot service to keep writing the source tree.
- **Decision:** Transfer an existing Linux entry within the existing configuration/Host handoff transaction. Generate the destination command from the installed bootstrap, remove the previous entry, and restore its original bytes if committing fails. Preserve an inactive entry's absence and refuse to overwrite a destination registration. Keep the original configured path for rollback. Require the Gbot service to be stopped, reserve its source ownership lock through the handoff, and exclude that lock from the copy. Do not stop bot work automatically.
- **Consequences:** Successful moves leave one startup entry for the selected root. Failed moves retain the original entry and root selection. No new preference, credential, service startup or dependency is introduced. Tests use temporary desktop-entry directories; desktop sign-in is not qualified by those tests.
- **Owner:** Gchat 2.
- **Links:** [Background service](../gbot/background-service.md), [Host handoff](2026-10-16-handoff-owned-host-during-app-data-move.md).
