---
date: 2026-10-12
title: "Wrap Cua media in Gbot control leases"
---

# 2026-10-12 — Wrap Cua media in Gbot control leases

- **Context:** Gbot needs an embedded desktop view and human takeover. Raw VNC forwarding does not provide browser media, audio or a scoped input grant. Ron selected Cua native media for GChat's first release.
- **Decision:** Pin Cua Spaces/media at `0c69d9a2c8`. The service retains guest RPC credentials through vault-backed SSH and exposes only the selected media-session WebSocket. Default to view-only. Interactive opens require the current Human owner; media reconnection preserves Human ownership; explicit hand-back revokes the stream before resuming the bot.
- **Consequences:** Keep the dedicated Xvnc/XFCE desktop, durable tasks and control owner. Add the daemon/native closure and browser media core with their FSL-1.1-MIT notices for GChat only; paid Arbitor needs a separate license decision. Physical capture/audio and Windows/M365 qualification are still owed. Use Ron's supplied animated avatar.
- **Owner:** GChat.
- **Links:** [Current implementation and gates](../gbot/README.md), [closure and notices](../gbot/cua-map.md#pinned-media-packaging), `src-tauri/gbot-service/src/media.rs`, `web-app/src/components/GbotDesktopView/`.
