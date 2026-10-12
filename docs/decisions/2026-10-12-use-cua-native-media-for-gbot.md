---
date: 2026-10-12
title: "Use Cua native media for Gbot's first release"
---

# 2026-10-12 — Use Cua native media for Gbot's first release

- **Context:** The viewer comparison identified Cua's ticketed video/audio stack and Fleet's separate VNC browser route. Ron selected Cua after reviewing the work and trade-offs.
- **Decision:** Package the pinned Cua Spaces media endpoint in the dedicated guest and wrap its browser media core over SSH. GChat retains durable tasks, vault, session binding, approvals and exclusive takeover. Keep the Xvnc/XFCE desktop backend. Do not add noVNC/websockify.
- **UI direction:** Show Gbot above Work in the left menu only when enabled. Use a ChatGPT DOT/Grok-style bot experience and a small animated avatar. Detailed UI and avatar design await Ron's draft.
- **Consequences:** Cua supplies desktop video/audio; microphone input stays disabled. Endpoint, codecs, notices and control integration must be packaged and checked. Windows/M365 qualification and FSL use in paid Arbitor remain separate. Selection does not establish that the viewer is implemented.
- **Owner:** @Gadflyii
- **Links:** [Gbot design](../gbot/README.md), [Cua media stack](../gbot/cua-map.md#guest-endpoint-dependency-decision).
