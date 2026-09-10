---
date: 2026-09-10
title: "Prefer available Vision launch profiles"
---

# 2026-09-10 — Prefer available Vision launch profiles

- **Context:** Vision is the desired default capability, while text-only profiles
  remain useful explicit choices and some hardware/model combinations lack a
  checked Vision profile.
- **Decision:** Sort actual compatible Vision profiles first, then by concurrency.
  Preselect the first Vision profile for new GChat instances without starting it.
  The text launcher offers Enter for that choice. Label text-only alternatives;
  replacing an existing instance remains explicit.
- **Consequences:** Defaults follow producer-tested profile capabilities, not
  inferred model support. They never change Vision/DFlash runtime options or
  manufacture missing profiles. No available Vision profile means no automatic
  substitute is selected.
- **Owner:** Sectile Research Labs.
- **Links:** [Profile selection](../model-management.md).
