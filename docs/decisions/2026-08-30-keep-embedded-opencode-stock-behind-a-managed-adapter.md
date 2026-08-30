---
date: 2026-08-30
title: "Keep embedded OpenCode stock behind a managed adapter"
---

# 2026-08-30 — Keep embedded OpenCode stock behind a managed adapter

- **Context:** The embedded Code tab must follow GChat's selected workspace, model context, and visual controls, but maintaining an OpenCode fork would couple GChat releases to upstream TUI internals. Launching the npm Windows `.cmd` shim from a verbatim PowerShell path also caused CMD to fall back to `C:\Windows`; the generated custom-provider entry omitted the live context limit, leaving OpenCode's Context percentage at zero.
- **Decision:** Keep OpenCode unmodified. GChat owns a narrow adapter that passes the selected workspace as OpenCode's explicit project argument, refreshes the managed GChat provider from the live GInfer `/models` metadata, and translates GChat chrome actions into OpenCode's documented keybindings. The embedded theme remains a managed process-local configuration; teal is the general accent while yellow remains reserved for semantic warnings.
- **Consequences:** Stock OpenCode upgrades remain possible without rebasing product patches. The embedded session opens on the actual Agent workspace, its Context meter uses the startup-fixed GInfer limit, and GChat can expose controls such as the collapsible token sidebar without owning OpenCode state. Changes to OpenCode's public configuration or keybinding contracts must be updated in this adapter and its focused tests.
- **Owner:** Sectile Research Laboratories
- **Links:** `src-tauri/src/core/terminal.rs`, `src-tauri/src/core/system/commands.rs`, `src-tauri/src/core/server/proxy.rs`, `web-app/src/containers/CodeTerminalHost.tsx`, `src-tauri/resources/opencode/gchat.json`.
