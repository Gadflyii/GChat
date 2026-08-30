---
date: 2026-08-30
title: "Embed Hermes as an independent managed terminal"
---

# 2026-08-30 — Embed Hermes as an independent managed terminal

- **Context:** GChat could install and configure Hermes Agent, but using it still
  required leaving the product for an external terminal. The existing embedded
  Code surface also owned one singleton PTY, so reusing it directly would make
  OpenCode and Hermes overwrite or stop each other's process and screen state.
- **Decision:** Add Hermes as a conditional left-navigation surface after the
  integration is enabled. Run the unmodified upstream CLI through its supported
  `hermes --tui` entry point, with GChat owning install/readiness, the local
  GInfer provider configuration, workspace selection, terminal frame, and
  managed light/dark skins. Hermes continues to own its agent loop, sessions,
  memory, tools, and skills. Replace the singleton native PTY with fixed `code`
  and `hermes` sessions, and share the frontend terminal transport while keeping
  each process, replay log, flow control, generation, and workspace independent.
- **Consequences:** Code and Hermes can remain alive across navigation without
  interfering. GChat does not fork or patch Hermes, so upstream updates remain
  consumable. Selecting the embedded appearance updates Hermes' official
  `display.skin` setting and installs `gchat-dark` / `gchat-light` under the
  official skin directory; that selected skin is therefore also visible when
  Hermes is launched separately. Hermes configuration is considered ready only
  for the exact loopback GChat provider with its required 64K-or-larger context.
- **Owner:** team
- **Links:** `src-tauri/src/core/terminal.rs`,
  `web-app/src/containers/HermesTerminalHost.tsx`,
  `web-app/src/hooks/useEmbeddedTerminal.ts`,
  [Hermes CLI commands](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/cli-commands.md),
  [Hermes skins](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skins.md)
