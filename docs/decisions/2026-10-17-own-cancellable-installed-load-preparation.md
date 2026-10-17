---
date: 2026-10-17
title: "Own cancellable Installed Load preparation"
---

# 2026-10-17 — Own cancellable Installed Load preparation

- **Context:** A legitimate first Installed Load can spend more than 600 seconds verifying a large artifact and preparing its hardware profile. The LocalControl HTTP deadline could fail the route while hashing or profiling continued without a visible owner.
- **Decision:** Give each Installed Load an operation UUID carried through the desktop, plugin and Host, expose its preparation phase and actual verification byte progress, and await preparation without the generic 600-second LocalControl deadline. Explicit Cancel and route unmount cancel that operation: payload verification checks cancellation at each 1 MiB read boundary and before returning a receipt, while profiling cancellation signals and awaits reaping of only the exact job UUID owned by the operation.
- **Consequences:** Cached verification also honors cancellation before returning success; cancellation cannot publish a successful verification receipt. An unrelated profile job or later load is never cancelled globally. Cancellation covers preparation and does not interrupt an Engine model load that has already started; a completed Ready result remains authoritative. Existing Engine startup/readiness policy and file-identity verification remain in force.
- **Owner:** team.
- **Links:** [Model-scoped Installed Load preparation](2026-10-17-scope-installed-load-profiling-and-await-preparation.md), [Verified payload identity](2026-10-17-reuse-verified-model-payloads-with-file-identity.md), [Host operation ownership](../../src-tauri/ginfer-host/src/service.rs), [Payload verification](../../src-tauri/ginfer-host/src/payload_verification.rs), [Profile job ownership](../../src-tauri/ginfer-host/src/hardware_profile.rs), [Desktop load lifetime](../../web-app/src/utils/switchModel.ts).
