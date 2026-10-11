---
date: 2026-10-11
title: "Park inactive Host monitoring and share scan reads"
---

# 2026-10-11 — Park inactive Host monitoring and share scan reads

- **Context:** OI-116 scans can read a payload header through direct and descriptor entries. OI-118 wakes the process monitor every second even after all children stop.
- **Decision:** A scan owns one canonical header observation; every descriptor still validates its own declarations. A later scan and launch preparation start fresh, and qualified launches retain full-payload SHA verification. HostProcesses owns lifecycle notifications. The monitor registers before checking child/pending-exit ownership, sleeps without a timer when inactive, and retains the active one-second cadence.
- **Consequences:** Shared headers are read once per scan and stopped/failed records cause no monitor polling or unchanged revisions. The independent inventory timer and diagnostic/session ownership remain intact. Keep Tokio's default workers; the Linux concurrent control/scan/journal measurement reports its actual process scope without selecting a new count or claiming Windows qualification.
- **Owner:** GChat.
- **Links:** [Current acceptance and evidence](../code-hygiene/README.md), GInfer master rows OI-116/OI-118.
