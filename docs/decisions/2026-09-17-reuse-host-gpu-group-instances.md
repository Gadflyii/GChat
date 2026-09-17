---
date: 2026-09-17
title: "Reuse server instances across launches"
---

# 2026-09-17 — Reuse server instances across launches

- **Context:** Unspecified instance IDs created a persistent record for every desktop
  model load. The host screen exposed this launch history as configured servers,
  confusing reusable hardware/model profiles with actual server instances.
- **Decision:** A host keeps one instance identity per exact GPU group. Launches
  without an ID reuse that group's existing identity; live replacement still
  requires explicit selection and confirmation. Model/profile changes replace
  settings on the selected instance. Additional groups remain independent servers.
  Each host card exposes Model and Hardware profile side by side, with separate
  lifecycle controls and an instance selector only when multiple groups exist.
- **Consequences:** On host startup, duplicate records for the same GPU group are
  consolidated deterministically (lowest existing UUID survives); removed settings
  are preserved in private `retired-instance-records.json` beside `host.json`.
  No models, profile catalogs, agent definitions, or run logs are deleted. References
  to retired instance IDs must be reassigned explicitly; they are never silently
  routed to a different instance. Running services are not edited on disk.
- **Owner:** team.
- **Links:** [Model management](../model-management.md).
