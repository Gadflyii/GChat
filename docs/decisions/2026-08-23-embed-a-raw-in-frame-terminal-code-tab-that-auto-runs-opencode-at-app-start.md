---
date: 2026-08-23
title: "Embed a raw in-frame terminal (Code tab) that auto-runs OpenCode at app start"
---

# 2026-08-23 — Embed a raw in-frame terminal (Code tab) that auto-runs OpenCode at app start

- **Context:** GChat serves local models through ginfer and exposes the
  OpenAI-compatible `localhost:1337/v1` API, which external coding agents
  (OpenCode, Codex, …) already consume (Launch page,
  `configure_opencode`). Launching OpenCode today opens a separate
  terminal window (`open_agent_terminal`). OpenCode itself offers a web
  UI (`opencode web`), a headless HTTP server (`opencode serve`), and an
  ACP protocol — each of which would force GChat to host, re-implement, or
  track a second UI surface for the agent.
- **Decision:** add a **Code** tab to the left menu that renders an
  in-frame terminal. It *looks* like part of the app but *is* a raw PTY
  running the user's shell — GChat does not parse, host, or mediate the
  agent's UI. OpenCode is just a process inside it.
  - Rust: new `core/terminal/` module on `portable-pty` (forkpty on Linux,
    ConPTY on Windows). One PTY session held in app state with a bounded
    ring buffer. Commands: `terminal_spawn(cols, rows, command?)`,
    `terminal_write`, `terminal_resize`, `terminal_kill`,
    `terminal_status` (running + buffered bytes); events:
    `terminal_data`, `terminal_exited`. The shell is PowerShell on Windows
    and `$SHELL`/bash on Linux; a command (e.g. `opencode`) is run inside
    it.
  - Web: `@xterm/xterm` + `@xterm/addon-fit` behind the Code tab
    (`routes/code.tsx`). `xterm.onData → terminal_write`,
    `terminal_data → xterm.write`, fit → `terminal_resize`. Navigating
    away unmounts the view but the PTY keeps running; returning
    re-attaches by reserializing the ring buffer.
  - **Auto-start:** at app startup (web side, after the hardware gate
    passes and OpenCode is installed + configured per the Launch page
    state) the app calls `terminal_spawn` with `opencode` — the agent is
    warm before the user ever opens the tab. No gate, no install, or no
    config → no auto-spawn; the tab shows the setup state instead.
  - First-run wiring reuses `configure_opencode` (provider → loaded GChat
    model + `:1337/v1` + API key). Model load is not a prerequisite for
    the terminal itself; requests simply fail until a model is up.
- **Consequences:** the agent's UI is always upstream-correct (we embed
  the real TUI; xterm.js renders it) and multi-client stays possible
  (terminal, TUI-in-its-own-window, and API all hit the same engine).
  Costs: two new runtime dependencies (`portable-pty`, `@xterm/*`), a
  Windows ConPTY test matrix, and a PTY that outlives view navigation
  (killed on app exit). OpenCode is not bundled in the installer in this
  phase — the Launch page install remains the acquisition path (bundling
  the binary is a later, supply-chain-reviewed decision). A user who
  types directly in the frame gets a plain shell: the terminal is a
  generic feature, OpenCode is its default payload.
- **Owner:** @Gadflyii
- **Links:** `2026-08-21-use-ginfer-as-the-sole-inference-backend-in-the-gchat-fork.md`,
  `2026-08-21-ginfer-sessions-route-through-the-1337-proxy.md`,
  opencode CLI docs (`opencode` / `opencode serve`),
  `src-tauri/src/core/terminal/`, `web-app/src/routes/code.tsx`.
