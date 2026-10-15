---
date: 2026-10-15
title: "Require explicit desktop CLI export"
---

# 2026-10-15 — Require explicit desktop CLI export

- **Context:** Desktop startup automatically exported CLI binaries, the profile catalog and launcher configuration into a shared installation directory when the app version changed. A fresh private desktop data directory also triggered this path and could redirect a shared launcher to its disposable provider.
- **Decision:** Export desktop CLI files only through the explicit Settings → General → GChat CLI → Install action. Remove the background startup exporter; retain the existing explicit installer and registered Host owner precedence.
- **Consequences:** Fresh and upgraded desktop sessions leave shared CLI installations untouched. Users replace an installed desktop CLI through Uninstall, then Install. Explicit installation still replaces the selected shared files and writes its current desktop provider configuration; this change does not restore previously overwritten files or alter endpoint discovery.
- **Owner:** team.
- **Links:** [CLI installation](../../README.md#command-line-client), [launcher behavior](../model-management.md#menu-usage).
