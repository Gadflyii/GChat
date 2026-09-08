---
date: 2026-09-08
title: "Guide desktop credential storage setup before LAN pairing"
---

# 2026-09-08 — Guide desktop credential storage setup before LAN pairing

- **Context:** Linux GChat could discover hosts but fail while saving a pairing grant when no unlocked Secret Service provider was available.
- **Decision:** First-run network intake and Engines check the native vault using a uniquely named temporary write/read/delete probe. Native pairing rechecks before consuming a pairing code. Provide setup, retry, and skip controls. On supported Linux distributions, explicit setup requests install GNOME Keyring through fixed package-manager arguments and `pkexec` OS administrator approval. No arbitrary shell, package, or administrator password comes from the frontend.
- **Consequences:** Existing providers need no installation. Setup can be one click plus OS approval, but unlocking or a new login may still be necessary. Unsupported systems receive manual guidance. Skipping preserves local use without enabling pairing. No installation at launch, no plaintext fallback, and no desktop-vault requirement on headless inference hosts.
- **Owner:** team.
- **Links:** [Host setup](../lan-host-setup.md).
