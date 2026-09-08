---
date: 2026-09-01
title: "Enable and provision embedded agents by default"
---

# 2026-09-01 — Enable and provision embedded agents by default

- **Context:** OpenCode was provisioned only when its tab was opened, while
  Hermes was disabled and absent from navigation until a separate settings
  route was found and completed. That made the two built-in terminal surfaces
  behave like optional expert integrations instead of installed parts of
  GChat, and the Hermes settings route was not visible in the Settings menu.
- **Decision:** Default both embedded integrations on and provision them from
  the desktop application at startup, independently of opening either tab.
  Expose compact persistent OpenCode and Hermes switches in the main Settings
  menu. Reuse a native installation when detected; otherwise run the existing
  managed installer sequentially. Install immediately and refresh the managed
  local-GInfer configuration once a model is available.
- **Consequences:** A clean GChat installation acquires both agents on first
  launch without extra navigation. Existing native installations are not
  replaced, unrelated configuration and agent data remain owned by the
  upstream tool, and a WSL-only binary does not satisfy a Windows-native
  integration. Disabling a switch hides and stops the embedded terminal but
  neither uninstalls the tool nor deletes its data. First launch requires
  network access for an agent not already installed; a failed background setup
  is retried by a later startup or by opening the enabled terminal.
- **Owner:** team
- **Links:** `web-app/src/containers/EmbeddedIntegrationProvisioner.tsx`,
  `web-app/src/containers/SettingsMenu.tsx`,
  `web-app/src/stores/code-terminal-store.ts`,
  `web-app/src/stores/hermes-agent-store.ts`

<!--
Supersedes the conditional-enable and lazy-provision portions of
2026-08-30-embed-hermes-as-an-independent-managed-terminal.md. Its independent
PTY, ownership, and unmodified-upstream decisions remain active.
-->
