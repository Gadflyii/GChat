---
date: 2026-08-30
title: "Refresh bundled extensions by content"
---

# 2026-08-30 — Refresh bundled extensions by content

- **Context:** Desktop uninstall intentionally preserves `%APPDATA%/GChat`, including models, settings, and unpacked extensions. Reinstalling a rebuilt installer with the same application version therefore left an older GInfer extension active even though the installer contained corrected model metadata.
- **Decision:** Fingerprint the ordered bundled extension archives with SHA-256 and persist that fingerprint beside the installed extension registry. At startup, refresh the unpacked bundled extensions whenever their packaged content differs or the fingerprint is absent, independent of the application version.
- **Consequences:** Same-version development installers and normal upgrades load the extension code they actually ship without deleting models or settings. A changed bundle causes one extension refresh on the next launch; unchanged bundles keep the existing fast path.
- **Owner:** team
- **Links:** `src-tauri/src/core/setup.rs`, `extensions/ginfer-extension/package.json`, `src-tauri/tauri.conf.json`
