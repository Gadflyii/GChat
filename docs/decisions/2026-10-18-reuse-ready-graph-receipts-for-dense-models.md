---
date: 2026-10-18
title: "Reuse Ready graph receipts for dense models"
---

# 2026-10-18 — Reuse Ready graph receipts for dense models

- **Context:** Dense Qwen/Muse startup quotes cannot know measured graph residency before the first matching Engine reaches Ready. Flash already saves a Ready-bound graph receipt.
- **Decision:** Collect both Dense and Flash per-rank graph-capacity records through the existing receipt path. Save the maximum only after Ready and complete rank coverage. Reuse requires the same artifact/runtime/profile file stamps, launch settings, ordered GPU identities and compute capabilities, and OS/architecture. A first solo Automatic launch may proceed with unknown graph cost; sharing requires its matching saved receipt. Catalogs carry no graph byte field.
- **Consequences:** Failed startup cannot authorize sharing. Optional `GINFER_HOST_REQUEST_LOG_JSONL` names an absolute private output file and forwards the existing Engine flag only at spawn. It does not change quotes or receipt keys. Set it before starting the private Host and retain full Host stderr alongside JSONL.
- **Owner:** Gchat 3; architecture decision claude-arch 2026-10-18 20:45:46Z.
- **Links:** [Installer and physical acceptance state](../installer-refresh/README.md), [Host process ownership](../../src-tauri/ginfer-host/src/engine_host.rs).
