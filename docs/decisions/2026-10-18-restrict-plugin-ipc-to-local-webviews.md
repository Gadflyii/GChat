---
date: 2026-10-18
title: "Restrict plugin IPC to local app webviews"
---

# 2026-10-18 — Restrict plugin IPC to local app webviews

- **Context:** The main capability explicitly granted `http://*` remote origins
  access to its plugin commands, including shell spawning, storage, hardware,
  Host control and network requests. Window selectors also extend grants to
  other webviews sharing that window. The app has no intentional remote app
  webview: auxiliary windows use local routes; connector OAuth opens the system
  browser and receives a loopback callback; model/output links open externally.
- **Decision:** Remove remote-origin grants and set `local: true` with exact
  webview labels in the existing main and auxiliary capability files. Apply the
  same boundary to the alternative desktop/mobile capability definitions so
  selecting them cannot restore the wildcard. Preserve their existing command
  permissions and platform selections. The confirmed-close capability remains
  local and restricted to the main webview.
- **Consequences:** Local app webviews keep their plugin permissions. HTTP,
  HTTPS and loopback remote documents receive none of these grants, including
  when loaded in a named app webview. An unrelated webview in a named window
  gains no grant. Network-request URL scopes remain unchanged: those scopes
  constrain requests made by the local app, rather than identifying trusted
  documents. A non-CLI native regression resolves the actual generated Tauri
  authority to cover positive local access and remote/wrong-label denial.
  Tauri recognizes its configured development origin as local.
- **Limit:** This change scopes capability-controlled plugin IPC. The existing
  application-defined command handler has no application ACL manifest; pinned
  Tauri 2.10.3 does not apply plugin capability checks to those commands. This
  decision does not claim that narrowing plugin grants secures that separate
  command surface or blocks navigation. Application-command admission requires
  a separate design and regression.
- **Owner:** team (Gchat 1; Arch assignment GCHAT-REMOTE-CAPABILITY-SCOPE).
- **Links:** `src-tauri/capabilities/`,
  `src-tauri/src/test_support.rs`, `src-tauri/src/lib.rs`,
  `web-app/src/services/window/tauri.ts`,
  `src-tauri/src/core/connectors/mod.rs`,
  `src-tauri/src/core/connectors/accounts.rs`.
