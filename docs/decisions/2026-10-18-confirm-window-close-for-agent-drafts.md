---
date: 2026-10-18
title: "Confirm window close for unsaved agent drafts"
---

# 2026-10-18 — Confirm window close for unsaved agent drafts

- **Context:** Agent Studio already confirms navigation away from an edited definition, but native window close discarded the draft silently. The native close-request callback also closed agent-run admission before a renderer could cancel the request.
- **Decision:** Register a native close-request listener while Agent Studio is mounted. Await the existing discard confirmation for an edited draft, default to Cancel, and reject approval after a draft revision or unmount. Let the pinned Tauri SDK finish the original close after explicit approval. Grant its required `core:window:allow-destroy` permission through an inline capability in the existing Tauri configuration, restricted to local app content in the `main` webview on Linux and Windows. Omit remote URLs and window-wide grants so remote content and secondary webviews receive no new permission. Fence agent admission when the main window is destroyed instead of at the cancelable close request; keep the existing exit-request and exit fences.
- **Consequences:** Cancel preserves both the draft and agent admission. Clean or saved drafts close normally. This does not persist drafts across process loss or replace the separate application exit lifecycle. Native Linux acceptance covers window close; Windows still needs its platform acceptance.
- **Owner:** team.
- **Links:** `web-app/src/routes/agents/index.tsx`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`.
