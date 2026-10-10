---
date: 2026-10-10
title: "Prefer the validated current-user NSIS installation"
---

# 2026-10-10 — Prefer the validated current-user NSIS installation

- **Context:** Tauri CLI 2.10.1 scans machine MSI registrations before the current-user NSIS record and chooses WiX migration before `/UPDATE`. Actual GChat has both a valid HKCU64 NSIS installation and a genuine HKLM MSI registration pointing to the same directory. The protected installer invocation refused this route before stopping apps or launching an installer.
- **Decision:** Use the supported custom NSIS template, pinned to CLI 2.10.1. For `currentUser`, prefer NSIS only when its product directory, binary name, publisher, product name, quoted install location and quoted uninstaller match the selected installation and both executable files exist. Otherwise retain the stock MSI detection and migration behavior. Keep the existing hooks and update/data-deletion behavior.
- **Consequences:** The validated NSIS `/S /UPDATE` route avoids both the old NSIS uninstaller and MSI migration. A coexisting MSI registration remains genuine: later MSI repair or uninstall could affect the shared files. This change does not reconcile that registration or authorize invoking MSI. Package regeneration and actual preservation verification remain pending; accepted Rust and ConPTY evidence is unchanged.
- **Owner:** @Gadflyii.
- **Links:** [Current acceptance](../agent-runtime/remaining-acceptance.md), [NSIS owner proof](/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/nsis-owner-proof-341.stdout), [MSI registration proof](/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/msi-precedence-registry-341.stdout), [Pinned upstream template](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.10.1/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi).
