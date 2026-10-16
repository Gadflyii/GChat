---
date: 2026-10-16
title: "Overlap catalog-format profiling with model downloads"
---

# 2026-10-16 — Overlap catalog-format profiling with model downloads

- **Context:** Artifact-scoped Ensure requires a verified local package. Waiting for download before preparing its CPU formats adds avoidable first-run time. Engine's separate declared-format input can prepare measurements before the artifact exists.
- **Decision:** Accept optional `cpu_expert_formats` beside each release's immutable package SHA under the existing configured HTTPS catalog trust. When every selected release declares the field, run the canonical union through Engine's declared-format Ensure alongside the admitted downloads. An absent field retains sequential setup; an empty array explicitly requests base-only measurements. After download verification and the early worker's terminal cleanup, always run actual-artifact `--model` Ensure with the intended startup settings before admission.
- **Consequences:** Catalog hints cannot authorize a model, skip missing-format calibration or supply artifact identity. Incorrect hints can add work but cannot replace native artifact validation. First-run retains exact ownership of the early job and explicit Resume after interruption; unrelated manual calibration stays separate. The release publisher derives hints with native Engine scoping. No catalog signer, producer or publication system is added to GChat.
- **Owner:** Gchat 2.
- **Links:** [First-run workflow](../ginfer-manager/README.md#catalog-format-hints-and-download-overlap); [artifact-scoped admission](2026-10-16-profile-selected-artifact-before-idle-format-completion.md); GInfer format-list contract, `docs/hardware-profile/README.md`.
