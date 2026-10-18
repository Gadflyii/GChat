---
date: 2026-10-18
title: "Preserve confirmed model Stop during status recovery"
---

# 2026-10-18 — Preserve confirmed model Stop during status recovery

- **Context:** desktop and local Host Stop can succeed before their running-model
  read fails. Reporting that read as a failed Stop invites a duplicate mutation.
- **Decision:** publish confirmed Stop immediately by removing only its active
  session ID. Keep subsequent inventory reads separate, refresh the local Host
  snapshot before merging ready aliases, and offer read-only status recovery.
  Local Load/Stop controls wait until that read succeeds; rejected Stop retains
  an explicit retry. Download inventory does not determine Stop success.
- **Consequences:** an accepted Stop is never replayed during recovery. Unrelated
  active models remain, and file-path aliases await fresh status rather than
  being treated as the stopped session.
- **Owner:** Codex 7.
- **Links:** [Current implementation and acceptance](../host-ui/README.md),
  [Models controls](../../web-app/src/containers/ModelManagement.tsx).
