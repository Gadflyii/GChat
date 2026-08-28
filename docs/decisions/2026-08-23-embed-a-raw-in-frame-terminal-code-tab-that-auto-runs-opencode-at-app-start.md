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
  - Rust: new desktop-only `core/terminal/` module on `portable-pty`
    (forkpty on Linux, ConPTY on Windows). A separately managed
    `TerminalState` owns exactly one generation-tagged PTY session; it is not
    folded into the unrelated application state. Commands attach an ordered
    Tauri IPC `Channel`, spawn, write, resize, apply output flow control,
    report status, and stop/restart the session. The shell is PowerShell on
    Windows and `$SHELL`/bash on Linux; OpenCode is the default command within
    that shell. App exit kills the child, closes the PTY, and waits for the
    session threads so no coding-agent process is orphaned.
  - Transport: PTY output is sent as generation- and sequence-tagged byte
    frames over the ordered channel, not global Tauri events. The frontend
    acknowledges parsed output at high/low watermarks so the bounded reader
    queue propagates backpressure to the OS PTY. A bounded backend replay log
    covers attachment races only. If that log has truncated, the backend says
    that exact reconstruction is unavailable instead of replaying a byte tail
    that may begin inside an ANSI escape sequence.
  - Web: `@xterm/xterm` + `@xterm/addon-fit` render a persistent terminal host
    owned by the root application layout, with `/code/` controlling its
    visibility. `xterm.onData → terminal_write`, ordered channel frames →
    `xterm.write`, and fit/resize → `terminal_resize`. The xterm instance stays
    mounted while the user navigates, so its parser, alternate-screen, cursor,
    and scrollback state remain intact without reconstructing a curses screen
    from a truncated byte ring.
  - Workspace: the PTY always receives an explicit canonical working
    directory. It defaults to GChat's existing Agent workspace and the Code
    header can select and persist another directory. Changing it requires an
    explicit session restart; a live OpenCode process is never silently moved
    between repositories.
  - **Auto-start:** after the frontend channel is attached and a fresh
    supported-hardware result is available, one root-level bootstrap owner
    checks for a native OpenCode executable. When it is absent (including the
    Windows case where only a WSL copy exists), that owner runs GChat's existing
    hardened OpenCode installer asynchronously, without opening an external
    console. On Windows the installer may first bootstrap native Node.js/npm via
    winget. It then writes `provider.gchat` through the existing
    `configure_opencode` owner, verifies the resulting effective JSON/JSONC
    configuration, and starts OpenCode. The operation is single-flight under
    React StrictMode so startup cannot launch competing installers. A missing
    model selection does not prevent acquisition; configuration and launch
    continue automatically as soon as a local API model is selected.
  - First-run wiring reuses `configure_opencode` (provider → loaded GChat
    model + `:1337/v1` + API key). Model load is not a prerequisite for
    the terminal itself; requests simply fail until a model is up.
- **Consequences:** the agent's UI is always upstream-correct (we embed
  the real TUI; xterm.js renders it) and multi-client stays possible
  (terminal, TUI-in-its-own-window, and API all hit the same engine).
  Costs: two new runtime dependencies (`portable-pty`, `@xterm/*`), a
  Windows ConPTY test matrix, and a PTY that outlives view navigation
  (killed on app exit). OpenCode is not bundled in the installer; first use
  acquires the official npm package through the same audited installer used by
  Integrations. A user who
  types directly in the frame gets a plain shell: the terminal is a
  generic feature, OpenCode is its default payload. Runtime dependencies are
  `portable-pty` 0.9, `@xterm/xterm` 6.0, and `@xterm/addon-fit` 0.11; no
  serializer or second agent UI is introduced.
- **Owner:** @Gadflyii
- **Links:** `2026-08-21-use-ginfer-as-the-sole-inference-backend-in-the-gchat-fork.md`,
  `2026-08-21-ginfer-sessions-route-through-the-1337-proxy.md`,
  opencode CLI docs (`opencode` / `opencode serve`),
  `src-tauri/src/core/terminal/`, `web-app/src/routes/code.tsx`.
