---
date: 2026-10-17
title: "Allow an explicit private development model catalog"
---

# 2026-10-17 — Allow an explicit private development model catalog

- **Context:** The public model catalog is awaiting release publication. Bubbs
  authorized exercising real download, install and Load flows with current NAS
  packages and their actual hashes, in a private test build only.
- **Decision:** A development frontend and debug Host may use an explicitly
  configured HTTP catalog at `127.0.0.1`. Package URLs must share its exact
  origin. Private Host requests bypass proxies and cannot follow redirects.
  Release builds retain commit-pinned HTTPS Hugging Face package validation.
- **Consequences:** The existing catalog schema, hardware compatibility,
  launch-profile binding, byte count, SHA256, artifact identity and atomic
  publication checks still apply. No test catalog or NAS package is published;
  no release URL changes. Both compiled `VITE_MODEL_CATALOG_URL` and runtime
  `GINFER_MODEL_CATALOG_URL` must select the same local catalog for the private
  walkthrough. The private build uses an embedded development frontend and a
  fresh HOME/XDG, and is retired after the pass.
- **Owner:** Codex 7.
- **Links:** [Host UI walkthrough](../host-ui/README.md),
  `web-app/src/lib/model-release.ts`,
  `src-tauri/ginfer-host/src/model_downloads.rs`.
