---
date: 2026-10-15
title: "Expose retained bundled resource readiness"
---

# 2026-10-15 — Expose retained bundled resource readiness

- **Context:** Gbot service selection and snapshots wait for bundled resource
  validation and installation. The UI previously showed only Saving or assumed
  an empty bot list during that wait, obscuring preparation and saved identity.
- **Decision:** Expose the existing retained watch result through the read-only
  desktop command `bundled_resources_ready`: pending returns `false`, successful
  completion returns `true`, and failure rejects with the retained cause.
  Publish `bundled-resources-update` after completion is recorded; clients
  subscribe before reading the snapshot and reread on its empty payload.
- **Consequences:** Setup and the companion can distinguish preparation from
  service connection/loading without a second installer or persistent schema.
  Pending status supplies no percentage or stage estimate. Fatal resource errors
  require restarting GChat to attempt installation again; connection retry does
  not retry installation. Readiness still means only the shared resource gate
  passed. Startup ordering, validation, atomic publication, optional guest-asset
  handling and service authority remain unchanged. The companion retains known
  same-service identity during refresh and waits for a successful snapshot before
  offering missing-configuration guidance.
- **Owner:** team.
- **Links:** [Gbot workflow](../gbot/README.md),
  [retained gate](../../src-tauri/src/core/setup.rs),
  [desktop commands](../../src-tauri/src/lib.rs),
  [Gbot connection owner](../../src-tauri/src/core/gbot.rs).
