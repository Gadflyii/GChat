---
date: 2026-08-30
title: "Bundle the producer-final GInfer runtime in Windows installers"
---

# 2026-08-30 — Bundle the producer-final GInfer runtime in Windows installers

- **Context:** GChat is an all-in-one local client whose only inference backend is
  GInfer, but the Windows builder still emitted installers without an engine. The
  native GInfer port produces closed Windows x64 / `sm_86`, `sm_89` and `sm_120a`
  runtime archives with their servers, dependent DLLs, licenses, hashes and build
  provenance. Building GInfer inside GChat would blur repository ownership, while downloading it after
  install would make the Windows package incomplete and could decouple the client
  from the engine revision it was tested with.
- **Decision:** The Windows release builder requires all three producer-final GInfer
  runtime archives from the same clean Engine commit, verifies their exact
  platform, CUDA architectures, byte sizes and SHA-256 manifests, smoke-tests
  each `ginfer-serve.exe`, and bundles them as Tauri resources. Its explicit
  `-GinferRuntimeArchives` input is three archive paths separated by semicolons.
  `-ValidateInputsOnly` verifies the same complete inputs without staging or
  building. The `resources/ginfer/windows/runtime-set.json` descriptor uses
  `ginfer-windows-runtime-set-v1`, platform `windows-x64`, the Engine commit and
  the exact mapping `8.6: sm86`, `8.9: sm89`, `12.0: sm120a`; each directory holds
  its producer-final `ginfer-windows-runtime-v1` payload. On application startup
  GChat installs the runtime set under `<data>/ginfer/windows/` before any engine
  can start, then selects the matching graphics architecture. Each engine runs
  from its own `{sm86,sm89,sm120a}/bin` directory; the GChat-owned Host executable
  remains separate under `<data>/ginfer/bin`. Staged installation preserves
  `<data>/ginfer/models` and skips file work when the installed manifests are
  already current. Generated runtime binaries remain ignored and are never
  committed to GChat.
- **Consequences:** NSIS and MSI are self-contained and the desktop application and
  `gchat-cli` resolve the same matched `ginfer-serve.exe`. The installer is larger
  and three matched GInfer archives are required Windows release inputs. A GInfer
  update requires rebuilding GChat, which keeps release qualification tied to an exact
  engine payload instead of a mutable post-install download.
- **Owner:** @Gadflyii
- **Links:** `scripts/build-windows-release.ps1`,
  `src-tauri/src/core/setup.rs`, `src-tauri/tauri.windows.conf.json`,
  `Gadflyii/ginfer/packaging/windows/build.ps1`.

<!--
Supersedes the Windows-gating consequence in
2026-08-21-use-ginfer-as-the-sole-inference-backend-in-the-gchat-fork.md.
-->
