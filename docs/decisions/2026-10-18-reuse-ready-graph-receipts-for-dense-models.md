---
date: 2026-10-18
title: "Reuse Ready graph receipts for dense models"
---

# 2026-10-18 — Reuse Ready graph receipts for dense models

- **Context:** Dense Qwen/Muse startup quotes cannot know measured graph residency before the first matching Engine reaches Ready. Flash already saves a Ready-bound graph receipt.
- **Decision:** Collect both Dense and Flash per-rank graph-capacity records through the existing receipt path. Save the maximum only after Ready and complete rank coverage. Reuse requires the same artifact/runtime/profile file stamps, launch settings, ordered GPU identities and compute capabilities, NVIDIA driver version from the existing NVML-backed inventory, and OS/architecture. An unavailable driver version prevents saving or reusing graph receipts. A first solo Automatic launch may proceed with unknown graph cost; sharing requires its matching saved receipt. Catalogs carry no graph byte field.
- **Consequences:** Failed startup cannot authorize sharing. Each actual Start logs the accepted quote's per-rank graph allowance source and bytes with its instance and model identity to Host stderr. Optional `GINFER_HOST_REQUEST_LOG_JSONL` names an absolute private output file and forwards the existing Engine flag only at spawn. It does not change quotes or receipt keys. Set it before starting the private Host and retain full Host stderr alongside JSONL.
- **Owner:** Gchat 3; architecture decisions claude-arch 2026-10-18 20:45:46Z and driver binding 21:25Z.
- **Links:** [Installer and physical acceptance state](../installer-refresh/README.md), [Host process ownership](../../src-tauri/ginfer-host/src/engine_host.rs).
