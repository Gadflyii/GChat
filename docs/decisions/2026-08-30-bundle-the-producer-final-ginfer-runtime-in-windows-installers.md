---
date: 2026-08-30
title: "Bundle the producer-final GInfer runtime in Windows installers"
---

# 2026-08-30 — Bundle the producer-final GInfer runtime in Windows installers

- **Context:** GChat is an all-in-one local client whose only inference backend is
  GInfer, but the Windows builder still emitted installers without an engine. The
  native GInfer port now produces a closed Windows x64 / `sm_120a` runtime archive
  with its server, dependent DLLs, licenses, hashes, and build provenance. Building
  GInfer inside GChat would blur repository ownership, while downloading it after
  install would make the Windows package incomplete and could decouple the client
  from the engine revision it was tested with.
- **Decision:** The Windows release builder requires a producer-final GInfer runtime
  archive, verifies its platform, CUDA architecture, byte sizes, and SHA-256
  manifest, smoke-tests `ginfer-serve.exe`, and bundles the verified runtime as a
  Tauri resource. On application startup GChat installs a changed runtime under
  `<data>/ginfer/bin` before any engine can start, using a staged directory and a
  binary-directory swap that restores the previous binary set if activation fails.
  The install preserves
  `<data>/ginfer/models` and skips all file work when the installed manifest is
  already current. Generated runtime binaries remain ignored and are never
  committed to GChat.
- **Consequences:** NSIS and MSI are self-contained and the desktop application and
  `gchat-cli` resolve the same matched `ginfer-serve.exe`. The installer is larger
  and a GInfer archive is now a required Windows release input. A GInfer update
  requires rebuilding GChat, which keeps release qualification tied to an exact
  engine payload instead of a mutable post-install download.
- **Owner:** @Gadflyii
- **Links:** `scripts/build-windows-release.ps1`,
  `src-tauri/src/core/setup.rs`, `src-tauri/tauri.windows.conf.json`,
  `Gadflyii/ginfer/packaging/windows/build.ps1`.

<!--
Supersedes the Windows-gating consequence in
2026-08-21-use-ginfer-as-the-sole-inference-backend-in-the-gchat-fork.md.
-->
