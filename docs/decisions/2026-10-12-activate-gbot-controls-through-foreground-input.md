---
date: 2026-10-12
title: "Activate Gbot controls through foreground input"
---

# 2026-10-12 — Activate Gbot controls through foreground input

- **Context:** Mousepad Save As enters `gtk_dialog_run` inside its AT-SPI D-Bus DoAction dispatch, blocking subsequent accessibility requests. Pinned Cua's element-click path can fall back to DoAction even with foreground delivery.
- **Decision:** Keep AT-SPI observations. Resolve a current visible element's geometry in Gbot and dispatch coordinate-only foreground clicks through Cua. Keyboard operations carry the window target, never an accessibility element. Hide accessibility mutation tools and invalidate observed tokens after input.
- **Consequences:** Dialogs open through the application's normal input loop. Hidden or disabled elements cannot be activated; inspect their visible menu or popup first. Raw replies and known refusals remain in durable task receipts. There is no timeout, prompt, or application workaround.
- **Owner:** GChat.
- **Links:** [Gbot current state and evidence](../gbot/README.md); `src-tauri/gbot-service/src/ssh/native.rs`; `src-tauri/gbot-service/tests/ssh_loopback.rs`.
