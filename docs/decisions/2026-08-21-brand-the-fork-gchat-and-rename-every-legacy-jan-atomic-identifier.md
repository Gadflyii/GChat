---
date: 2026-08-21
title: "Brand the fork GChat and rename every legacy jan / Atomic identifier"
---

# 2026-08-21 — Brand the fork GChat and rename every legacy jan / Atomic identifier

- **Context:** this fork pivots to the ginfer-only product (see
  [use ginfer as the sole inference backend](2026-08-21-use-ginfer-as-the-sole-inference-backend-in-the-gchat-fork.md)).
  Upstream forbids renaming legacy `jan*` / `atomic` identifiers because
  existing user installs migrate across bundle ids, APPDATA folders and
  pre-install tarball names. This fork has no upstream user base: installs
  are all new, so the migration constraint does not apply.
- **Decision:** the product is **GChat**. Clean-slate rename:
  | Surface | From | To |
  | --- | --- | --- |
  | Product name (UI, docs) | Atomic Chat | GChat |
  | Root `package.json` name | `jan-app` | `gchat` |
  | Workspaces | `@janhq/web-app`, `@janhq/core`, `@janhq/*-extension` | `@gchat/web-app`, `@gchat/core`, `@gchat/*-extension` |
  | Tauri CLI binary | `jan-cli` | `gchat-cli` |
  | Cargo crate | `Atomic-Chat` | `gchat` |
  | Tauri bundle id | `chat.atomic.app` | `app.gchat` |
  | Pre-install tarballs | `janhq-*-*.tgz` | `gchat-*-*.tgz` |
  | Data folder (all OS, incl. Windows APPDATA) | `Jan` (+ legacy folders) | `GChat` |
  | Ginfer model cache | — | `<data>/ginfer/models/` |
  Logo/icon: placeholder until the real asset ships. Upstream migration
  code (bundle-id/APPDATA redirects, pre-install name shims) is deleted, not
  ported.
- **Consequences:** one large mechanical rename across `package.json` files,
  Cargo manifests, Tauri config, Rust path constants and TS imports — do it
  as a single dedicated pass with `make verify-fast` as the gate, before or
  immediately after the backend strip (order: strip first, rename second, so
  the rename touches fewer files). No installer can upgrade an existing
  Atomic Chat install into GChat; that is intended.
- **Owner:** @Gadflyii
- **Links:** supersedes the rename-forbidden rule in upstream
  `AGENTS.md` §4 *for this fork only*.
