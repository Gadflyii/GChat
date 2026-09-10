---
date: 2026-09-10
title: "Distinguish launch-profile evidence tiers"
---

# 2026-09-10 — Distinguish launch-profile evidence tiers

- **Context:** Remaining profile qualification uses exact capacity calculations,
  actual startup inspection and short concurrent smoke requests rather than
  full-context campaigns. Existing completed full-context tests remain valid.
- **Decision:** Require `full-context-tested` or `calculated-startup-smoke` on
  each qualification. Validate tier-specific request counts and calculated
  capacity against the explicit arena and actual safe startup budget. Retain
  exact artifact matching and measured per-rank headroom. Show the tier in GChat
  and the command-line launcher; calculation alone is not a launchable profile.
- **Consequences:** Users can select lightweight-qualified profiles without an
  invented full-context claim. Producers migrate existing metadata explicitly;
  missing tiers are errors, not compatibility defaults. This supersedes the
  full-context-only admission requirement, not its stronger evidence records.
- **Owner:** Sectile Research Labs.
- **Links:** [Profile contract](../model-management.md).

Supersedes the full-context-only admission requirement in
[explicit profile headroom](2026-09-09-qualify-capacity-profiles-with-explicit-headroom.md).
