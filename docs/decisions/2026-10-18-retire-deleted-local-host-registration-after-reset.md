---
date: 2026-10-18
title: "Retire the deleted local Host registration after reset"
---

# 2026-10-18 — Retire the deleted local Host registration after reset

- **Context:** factory reset deletes the selected local Host identity inside App Data. The shared saved Host registry lives outside that folder and keeps the old UUID/certificate. The replacement local Host is therefore listed beside an unusable old connection.
- **Decision:** the existing local reset reservation captures the selected identity after obtaining exclusive Host ownership. After deletion it retires only that UUID and certificate under the shared registry's lock, reloading concurrent changes before writing. Completion also clears that identity's in-memory routes and credentials. It does not guess from the endpoint or erase paired remote Hosts. Missing identity produces no registry operation; retained identity prevents retirement.
- **Consequences:** normal reset/restart publishes one replacement local Host. Refused or incomplete deletion preserves its old registration; shared registry failures are reported. Existing Agent/Engine shutdown and root-selection fences remain authoritative. Old orphan records lacking a provable local identity remain user-removable; this change does not invent a destructive migration.
- **Owner:** Codex 3.
- **Links:** [current state](../host-ui/README.md), `src-tauri/ginfer-host/src/client.rs`, `src-tauri/src/core/system/commands.rs`.
