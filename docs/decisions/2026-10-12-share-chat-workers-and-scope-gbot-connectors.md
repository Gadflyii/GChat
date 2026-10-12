---
date: 2026-10-12
title: "Share Chat workers and scope Gbot connector accounts"
---

# 2026-10-12 — Share Chat workers and scope Gbot connector accounts

- **Context:** Chat needs independent delegated workers, and bots need their own accounts without inheriting the user's selected connector account.
- **Decision:** Chat dispatches asynchronously through the existing General Agent runner. Each worker has a saved session and parent identifiers, inherits caller permissions and placement, and can be collected or canceled independently. Gbot links explicit account IDs to each workspace and calls the existing native connector/vault owner. Resolve the account before approval and recheck it at admission. Persist connector effect receipts in the bot task; an ambiguous prior effect requires review rather than resending it.
- **Consequences:** Shared definitions, providers and permissions remain the authority. New bots have no linked accounts. App exit cancels and joins ordinary Chat workers; independent Gbot service lifetime remains separate work. Focused lifecycle and account-isolation cases pass; live OAuth and installed model-backed delegation remain unqualified.
- **Owner:** GChat.
- **Links:** [Gbot current record](../gbot/README.md#current-record-and-inventory), [acceptance plan](../agent-runtime/remaining-acceptance.md), [connector contract](../workspace-connectors/README.md).
