---
date: 2026-10-16
title: "Profile the selected artifact before idle format completion"
---

# 2026-10-16 — Profile the selected artifact before idle format completion

- **Context:** First-run profiling measured all seven CPU expert formats before model selection. The Engine now supports an artifact-scoped Ensure and an explicit completion pass. Its signed contract requires an existing valid version-3 artifact; catalog metadata alone cannot authorize calibration.
- **Decision:** First-run accepts GPU, storage and model choices, verifies the model download, then profiles the validated local TP payload with the same TP and speculation intent as startup. Host binds the native result to the exact artifact directory identity and keeps any verified whole-package hash separate. Only native acceptance in the current Host process admits first-run startup. Compatible retained measurements remain seeds for native revalidation after reopening. Scanning models does not start all-format calibration.
- **Consequences:** The wizard may become ready with unrelated formats deferred. Host extends those formats only while no model, draft-width calibration, download or pending first-run setup needs it. Foreground profiling, startup quotes and serving cancel and reap idle completion before proceeding. Completion and freshness remain separate; neither a saved receipt nor structural completeness skips native startup checks. Progress and duration history retain the measured scope, so a full-profile duration is not advertised as the selected-model ETA. A future catalog-format input can overlap download and calibration after a separate Engine contract is approved.
- **Owner:** Gchat 2.
- **Links:** [Manager and first-run setup](../ginfer-manager/README.md); GInfer signed model-scoped hardware-profile contract at `16267858e`, `docs/hardware-profile/README.md`.
