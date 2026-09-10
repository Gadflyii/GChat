---
date: 2026-09-10
title: "Deliver calculated profiles with pending validation"
---

# 2026-09-10 — Deliver calculated profiles with pending validation

- **Context:** The user wants the complete profile set delivered before remaining
  engine implementation and hardware validation, including Vision+DFlash defaults.
- **Decision:** Add selectable `calculated-pending-validation` profiles. Require
  explicit planned arena and positive calculated KV demand, but prohibit measured
  free memory, startup budget or smoke counts. Warn that startup/inference are
  unverified and may require an engine update. Do not silently disable DFlash.
- **Consequences:** Catalog completeness no longer implies physical qualification.
  Existing tested evidence is preserved; pending entries cannot masquerade as
  startup-smoke or full-context tested profiles. Runtime checks still apply.
- **Owner:** Sectile Research Labs.
- **Links:** [Profile contract](../model-management.md).

Supersedes the prohibition on selectable calculation-only entries in
[evidence tiers](2026-09-10-distinguish-launch-profile-evidence-tiers.md).
