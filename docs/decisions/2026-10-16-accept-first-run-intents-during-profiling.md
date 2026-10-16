---
date: 2026-10-16
title: "Accept first-run choices during native profiling"
---

# 2026-10-16 — Accept first-run choices during native profiling

- **Context:** A fresh native hardware profile can take tens of minutes. The first-run wizard previously withheld storage and model choices until profiling completed, and its static duration range could not explain progress. Package upgrades must retain accepted profiles and resumable jobs without treating an old runtime path as proof that the native measurements are obsolete.
- **Decision:** Save explicit storage and published-model choices in Host's existing durable first-run state while the selected GPU group is profiling. Apply storage eligibility, live capacity and download admission checks only after that group's complete native profile is available. Keep admission blocked during calibration. Preserve the canonical per-group profile across upgrades and give it to the current Engine as a validation seed; the Engine remains the authority for fingerprint, completeness and refresh decisions. Report elapsed time and observed phase diagnostics, and label estimates derived from a prior successful full measurement as historical rather than guaranteed.
- **Consequences:** Closing or reopening the wizard retains queued choices and profiling continues in Host. Invalid choices and post-profile admission failures remain explicit and retryable. No inferred percentage or model-specific calibration completeness is introduced. Engine work to prioritize the selected model's formats is separate. This change is outside the October 16 release-candidate refresh.
- **Owner:** team.
- **Links:** [First-run workflow](../ginfer-manager/README.md#shared-first-run-setup--october-15), [Host-owned setup](2026-10-15-own-first-run-setup-and-measured-model-storage-in-host.md), [Host-owned profiling](2026-10-11-own-hardware-profile-installation-in-host.md).
