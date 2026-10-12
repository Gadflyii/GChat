---
date: 2026-10-12
title: "Own SSH workspace creation in the Gbot service"
---

# 2026-10-12 — Own SSH workspace creation in the Gbot service

- **Context:** Guided setup imported a vault key and saved its workspace in two requests. A failed save orphaned the key; retry imported another.
- **Decision:** One service operation validates the connection, imports the key into the workspace's stable vault slot, and persists the workspace. The service retains the transaction after client disconnection. Identical retries resolve the same workspace; conflicting configuration is rejected.
- **Consequences:** Failure before workspace publication cleans the imported key. Failure to confirm durability after publication preserves the referenced key and reports the saved state explicitly. The native bridge admits this operation and the form retains its IDs across retries. Cross-store power-loss recovery and form recovery after webview reload are separate work.
- **Owner:** GChat.
- **Links:** [Gbot current record](../gbot/README.md#current-record-and-inventory), [acceptance plan](../agent-runtime/remaining-acceptance.md).
