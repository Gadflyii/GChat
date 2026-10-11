---
date: 2026-10-11
title: "Preserve logical assignment in desktop bundles"
---

# 2026-10-11 — Preserve logical assignment in desktop bundles

- **Context:** stock OpenCode triggers terminal-mode queries immediately. The
  shipped xterm 6.0.0 ESM is valid, but esbuild 0.25.9 lowering plus minification
  removes its local enum binding. The query throws and stops the output queue.
  One isolated Linux/WSLg reproduction confirms native PTY input and ANSI output
  still work while xterm drawing stops.
- **Decision:** the existing Vite esbuild configuration declares logical
  assignment supported. Ubuntu 24.04+ WebKitGTK and evergreen Windows WebView2
  support that syntax; the current Linux webview executes it directly. Keep the
  remaining target transforms, minification and dependency versions.
- **Consequences:** terminal-mode queries retain their actual xterm semantics.
  No parser interception, forged capability reply or PTY change is introduced.
  A focused fixture exercises the production-bundled terminal's exact replies
  and continued output after the query. The live Linux gate uses typed input.
- **Owner:** GChat.
- **Links:** [esbuild defect](https://github.com/evanw/esbuild/issues/4508),
  [current acceptance](../agent-runtime/remaining-acceptance.md#current-linux-code-tui-correction),
  [build configuration](../../web-app/vite.config.ts).
