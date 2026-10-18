---
date: 2026-10-18
title: "Bundle the accepted Cua runtime on Windows"
---

# 2026-10-18 — Bundle the accepted Cua runtime on Windows

- **Context:** The merged Hyper-V adapter can provision a dedicated Bot computer,
  but ordinary Windows launches lack the Cua executor already bundled on Linux.
- **Decision:** Ship the official private CPython 3.12.3 AMD64 embeddable runtime,
  the accepted Cua SDK/agent pins, 44 unchanged portable distributions, 17 exact
  Windows native replacements and marker-selected Colorama 0.4.6. Use the absolute
  bundled Python with isolated `._pth` import paths and the existing Bun context
  preparer. Ignore `PYTHON*` variables and user site-packages; never fall back to
  system Python. The service owns
  packaged process discovery on both platforms; Windows release builds require
  and verify this runtime input before staging it as an application resource.
  Arch signed these startup requirements on October 18. A missing or corrupt
  Windows bundle reports typed **Bot unavailable** with reinstall guidance;
  GChat starts and serves ordinary chat independently.
- **Consequences:** No user Python installation or second executor is needed.
  Retain Python/Microsoft notices and every package notice. Bubbs approved
  Colorama, unchanged certifi/tqdm MPL files and the vendor redistributables on
  October 18; GPL-3.0 and AGPL remain excluded. Native relocation and isolation
  checks passed; the real model-driven Hyper-V guest task remains a pending
  release acceptance gate. Implemented Windows packaging is not yet qualified
  by offline manifest verification or the startup sign-off.
- **Owner:** GChat / Codex 7; Gchat 2 owns Gbot and the Hyper-V lifecycle.
- **Links:** [Current implementation and acceptance](../gbot/README.md#windows-cua-runtime-packaging--codex-7),
  [Cua ownership](../gbot/cua-map.md),
  [Runtime packager](../../scripts/package-gbot-runtime.py),
  [Windows release builder](../../scripts/build-windows-release.ps1).
