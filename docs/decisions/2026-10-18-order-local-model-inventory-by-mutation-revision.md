---
date: 2026-10-18
title: "Order local model inventory by mutation revision"
---

# 2026-10-18 — Order local model inventory by mutation revision

- **Context:** inventory refreshes overlap accepted deletions and later installs.
  A permanent deleted-ID filter hides legitimate re-adds; retiring deletion
  identities after acknowledgement lets an older inventory erase those re-adds.
- **Decision:** the provider store owns a session-local monotonic revision and
  each model's last local mutation. Accepted deletion and completed
  download/import/re-add advance that revision. Every inventory read captures
  its starting revision; publication retains current models mutated after it
  and excludes deleted models until an installation supersedes their deletion.
- **Consequences:** all publication paths share one ordering rule. Recovery
  remains read-only, selection follows the reconciled inventory, and pending
  revisions are excluded from persisted state. The `deletedModels` list and
  deletion-helper identity bookkeeping are removed.
- **Owner:** Codex 7.
- **Links:** [Current implementation and acceptance](../host-ui/README.md),
  [provider store](../../web-app/src/hooks/useModelProvider.ts).
