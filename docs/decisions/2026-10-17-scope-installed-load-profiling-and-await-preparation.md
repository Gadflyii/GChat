---
date: 2026-10-17
title: "Scope Installed Load hardware profiling to its model"
---

# 2026-10-17 — Scope Installed Load hardware profiling to its model

- **Context:** Installing the bundled runtime launched an all-formats hardware Ensure before a model was selected. Installed Load therefore waited for unrelated format calibration instead of preparing only the selected artifact's formats, as first run already does.
- **Decision:** Runtime installation alone does not begin calibration. Host placement verifies the artifact and runs the existing model-scoped Ensure with the selected launch intent before quoting or spawning the Engine. Native acceptance from this Host process is required; an accepted matching intent is reused.
- **Consequences:** Unrelated foreground calibration remains an explicit conflict, and profile failure prevents launch. The existing verification authority and post-start idle completion policy remain in effect. Explicit administrator hardware-profile commands still support full calibration. The separate timeout, progress and cancellation change is owned by Gchat 3.
- **Owner:** team.
- **Links:** [Host-owned profiling](2026-10-11-own-hardware-profile-installation-in-host.md), [First-run workflow](../ginfer-manager/README.md).
