---
date: 2026-10-08
title: "Share host management and fleet pools"
---

# 2026-10-08 — Share host management and fleet pools

- **Context:** GChat owned paired-host connection metadata and local worker pools. A standalone server manager and a second workstation must see the same host controls and pool definitions.
- **Decision:** Add a thin `ginfer-manager` Tauri workspace member over `ginfer-host`. GChat and Manager use one portable client and per-user registry with locked disk reconciliation and native vault credentials. One explicitly chosen host owns the durable fleet catalog with revision-checked edits; member hosts retain only their locator and derived membership report.
- **Consequences:** Closing Manager leaves inference running. Paired clients resolve the existing coordinator and browse the same pools. Client assignments control usable placements; GChat still owns agent execution. An unavailable coordinator makes cached fleet state read-only. Exact legacy pool imports retain IDs and receipts, and local instance accounting uses the same host/instance/session identity as fleet placements.
- **Owner:** GChat.
- **Links:** [Design and contracts](../ginfer-manager.md), [implementation status and evidence](../ginfer-manager/README.md), [operator guide](../ginfer-manager/guide.md).
