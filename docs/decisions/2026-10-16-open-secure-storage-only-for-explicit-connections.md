---
date: 2026-10-16
title: "Open secure storage only for explicit connections"
---

# 2026-10-16 — Open secure storage only for explicit connections

- **Context:** Plain GChat launch could unlock Secret Service through the secure-storage readiness probe, saved-host snapshot polling, or automatic Gbot/account-service restoration. The October 13 credential-tier change addressed missing providers and encrypted fallback storage; its native readiness probe still wrote/read/deleted a test entry. The later companion refresh added another automatic service connection. Locked desktop startup was not qualified by those earlier gates.
- **Decision:** Startup and passive status/catalog/snapshot refresh never read, write or delete native secrets. Provider presence is reported as unchecked, not as unlocked or ready. A user must explicitly connect a saved remote host, Gbot service or workspace account service in each GUI session; credential checks and real authenticated requests may then access storage. Remote host tokens are retained only in process memory and bound to the saved host/client/pin identity. Local Host control continues to use its existing private control credentials.
- **Consequences:** A locked login keyring stays locked at plain launch. Explicit connection can still prompt or fail with an actionable storage error. Saving a host or enabling Gbot does not authorize automatic reconnection in a new GUI session. Shutdown only closes retained service clients and never opens storage to rediscover a connection. Existing credential tiers, migration rules, service names and encrypted records are preserved.
- **Owner:** GChat.
- **Links:** [Credential-store tiers](2026-10-13-credential-store-tiers.md); `GCHAT-KEYRING-PROMPT-AT-LAUNCH` in the maintainer work queue.
