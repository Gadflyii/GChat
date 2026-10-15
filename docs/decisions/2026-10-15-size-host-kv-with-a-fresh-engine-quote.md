---
date: 2026-10-15
title: "Size Host KV with a fresh Engine quote"
---

# 2026-10-15 — Size Host KV with a fresh Engine quote

- **Context:** A catalog arena qualified on older startup settings exceeded the current Engine's available memory after Host enabled structured outputs. Single starts and saved-instance starts bypassed placement quoting.
- **Decision:** Quote the selected Engine immediately before each serving spawn with the final launch options, after stopping a replaced instance. Discard historical catalog KV sizing. Keep Automatic in saved requests and apply the fresh derived arena only to the effective launch; retain and validate exact positive user overrides. First-run recommendations follow the same rule. A first solo automatic Flash start may retain Engine AUTO when graph cost is unknown; sharing and explicit arenas require known graph cost.
- **Consequences:** Runtime/settings changes cannot reuse an automatic allocation. Older saved positive values without provenance are validated and refused if oversized; clearing the override selects Automatic. Quotes sample availability and allowances and do not reserve memory or qualify context capacity.
- **Owner:** team.
- **Links:** [Manager behavior and acceptance](../ginfer-manager/README.md#fresh-startup-quotes--october-15), `src-tauri/ginfer-host/src/service.rs`, `src-tauri/ginfer-host/src/engine_host.rs`, `src-tauri/ginfer-host/src/first_run.rs`.
