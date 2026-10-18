---
date: 2026-10-18
title: "Declare installed launcher runtime ownership"
---

# 2026-10-18 — Declare installed launcher runtime ownership

- **Context:** standalone setup registers one Engine image. Its later menu
  incorrectly required the desktop's multi-image manifest, stopping the real
  private first-run walk before GPU selection. Hardware preparation and menu
  bootstrap derived runtime ownership differently.
- **Decision:** require `desktop.runtime_set` in the existing installed launcher
  configuration. Standalone Linux/Windows setup writes `false`; the desktop
  writer writes `true`. Both preparation and menu obtain the runtime map from
  this declaration. An installed configuration and a direct `--runtime-set`
  override conflict. Existing Host registration ownership remains unchanged.
- **Consequences:** a single-image install needs no desktop manifest. A desktop
  install still fails on missing, invalid or incomplete manifests. There is no
  missing-manifest fallback or implicit migration: regenerate old launcher
  configurations with their owning installer. The shared reader names the setup
  commands and unused-path requirement, or GChat CLI reinstall, for invalid old
  configurations; preparation uses this same reader. Standalone setup is
  fresh-install only, while desktop install rewrites its configuration atomically.
  Engine execution is unchanged. Architecture accepted this startup contract at
  04:37:07Z; the actionable-error focused checks passed; native acceptance remains pending.
- **Owner:** team (Codex 4).
- **Links:** [current work](../installer-refresh/README.md),
  [installed owner contract](../lan-host-setup.md#shared-local-owner),
  blocked novice evidence `test/c4-cli-first-run-20261018` at `7f8e9a61e`.
