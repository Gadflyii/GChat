---
date: 2026-10-18
title: "Refresh desktop Host registration from current runtime"
---

# 2026-10-18 — Refresh desktop Host registration from current runtime

- **Context:** A reset or runtime replacement can remove the files named by a
  saved desktop Host locator while the desktop has a valid current runtime set.
  Registry selection validated those obsolete files before considering the
  current desktop seed. A successfully connected owner could also fail its
  metadata refresh, which validated the obsolete saved paths.
- **Decision:** Separate strict locator JSON/schema decoding from saved-runtime
  usability. Under the existing registration lock, a fully validated explicit
  desktop seed supplies the current configured root and installed paths; a
  matching root retains its saved management port and the resulting seed is
  validated before publication. After connection has validated and authenticated
  a desktop owner, refresh publishes identity/endpoint metadata only if the
  locked locator still names the same root. Keep the latest registered paths
  so an older connected client cannot undo a newer same-root seed. Preserve a
  concurrent different-root or service registration. Discovery without an
  explicit desktop seed continues to validate all saved runtime paths. Corrupt records, unsupported schemas,
  unknown fields, invalid replacement seeds and invalid service records remain
  errors.
- **Consequences:** An obsolete desktop runtime registration no longer blocks a
  valid current installation. Registration does not move data, stop processes,
  bootstrap the previous root or repair runtime files. A later discovery still
  refuses missing current runtimes; a connected metadata refresh is not a second
  bootstrap check. Existing service first-owner semantics, management identity
  publication and registration locking remain in place. No locator schema or
  Engine validation contract changes.
- **Owner:** team.
- **Links:** `GUI-HOST-LOCATOR-DELETED-RUNTIME`;
  [Current evidence and acceptance](../host-ui/README.md);
  [Local Host registry](../../src-tauri/ginfer-host/src/local_host_registry.rs);
  [Runtime installation](2026-09-30-bundle-linux-ginfer-runtimes-by-gpu-architecture.md);
  [App Data ownership handoff](2026-10-16-handoff-owned-host-during-app-data-move.md).
