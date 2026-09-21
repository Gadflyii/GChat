---
date: 2026-09-21
title: "Select host runtimes by GPU architecture"
---

# 2026-09-21 — Select host runtimes by GPU architecture

- **Context:** Server 2 combines SM80 CMP cards and an SM86 RTX 3090. A single architecture-specific executable cannot serve both GPU types correctly.
- **Decision:** The host accepts an explicit compute-capability-to-executable map via repeated `--engine-runtime SM=PATH` arguments. Desktop locators persist this map as `engine_runtimes` and pass it when bootstrapping the owner. When the map is present, every selected GPU must resolve to one declared architecture/runtime; no default-executable fallback is used. Single-runtime installations retain `--engine`.
- **Consequences:** Separate instances may use different runtime images on exclusive GPU groups. Each instance still uses one homogeneous architecture and one fixed TP group. Runtime lookup occurs for every start/restart, with libraries resolved beside the selected binary. Changing assignments requires stopping the affected host. The model/GPU/profile selectors expose physical allocation separately; only declared compatible profile groups are offered. Catalog qualification labels remain intact and runtime routing does not establish Vision or TP qualification.
- **Owner:** team.
- **Links:** [LAN host setup](../lan-host-setup.md).
