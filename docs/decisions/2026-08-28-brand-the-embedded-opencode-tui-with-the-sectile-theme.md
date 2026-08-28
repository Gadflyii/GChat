---
date: 2026-08-28
title: "Brand the embedded OpenCode TUI with the Sectile theme"
---

# 2026-08-28 — Brand the embedded OpenCode TUI with the Sectile theme

- **Context:** The Code tab already gives its terminal frame GChat surfaces, Geist Mono, and the
  Sectile palette, but OpenCode's own semantic TUI colors still came from the user's selected or
  built-in theme. Selecting a theme through OpenCode's normal global `tui.json` would also change
  standalone OpenCode sessions. OpenCode discovers custom theme definitions in its global
  `themes` directory, while `OPENCODE_TUI_CONFIG` can select a separate TUI configuration for one
  launched process.
- **Decision:** GChat bundles and owns a complete `gchat` OpenCode theme with matching dark and
  light Sectile palettes. Before launching the embedded OpenCode session, GChat installs or repairs
  that definition in OpenCode's global theme directory and writes a separate GChat-owned TUI
  selector. Only the Code-tab process receives `OPENCODE_TUI_CONFIG` pointing at that selector.
  GChat does not create or modify the user's normal `tui.json`, and a project-specific OpenCode TUI
  configuration retains OpenCode's normal override behavior. A generic Code-tab shell also remains
  unmodified.
- **Consequences:** OpenCode and its terminal frame present one coherent GChat visual system,
  including meaningful success, warning, error, diff, Markdown, and syntax colors. Standalone
  OpenCode preserves the user's theme selection. GChat refreshes its owned assets when an embedded
  session starts, so changes to OpenCode's supported theme contract require updating the bundled
  theme and its completeness test together.
- **Owner:** Sectile Research Laboratories
- **Links:** `2026-08-28-adopt-the-sectile-prism-visual-identity.md`,
  `2026-08-23-embed-a-raw-in-frame-terminal-code-tab-that-auto-runs-opencode-at-app-start.md`,
  `src-tauri/src/core/terminal.rs`, `src-tauri/resources/opencode/gchat.json`,
  `src-tauri/resources/opencode/gchat-tui.json`.
