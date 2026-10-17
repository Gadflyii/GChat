---
date: 2026-10-17
title: "Contain Gbot desktop keyboard input"
---

# 2026-10-17 — Contain Gbot desktop keyboard input

- **Context:** Keyboard events from the interactive desktop canvas reached GChat's window shortcut handlers. Ctrl+N opened a GChat conversation during remote desktop input.
- **Decision:** While the interactive canvas has focus, consume its keyboard events before they reach the app and forward supported keys to the guest. Reserve Ctrl+Alt+Shift+Escape to release held guest keys and focus the visible Return keyboard to GChat button. Clicking that button also leaves canvas focus. Ordinary Escape and Tab remain guest input.
- **Consequences:** The user can return to app shortcuts without closing the stream or handing control back to the bot. Canvas blur releases held guest keys, and later unmatched key releases are ignored. View-only sessions and keyboard input elsewhere retain their existing behavior. Browser or operating-system shortcuts intercepted before DOM delivery remain outside this routing.
- **Owner:** team.
- **Links:** [Gbot desktop](../../web-app/src/components/GbotDesktopView/index.tsx), [media input](../../web-app/src/vendor/cua-media/mediaSession.ts).
