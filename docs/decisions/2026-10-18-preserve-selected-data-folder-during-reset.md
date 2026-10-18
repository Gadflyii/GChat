---
date: 2026-10-18
title: "Preserve the selected App Data folder during reset"
---

# 2026-10-18 — Preserve the selected App Data folder during reset

- **Context:** App Data relocation deliberately retains the old copy. Factory
  reset cleared the selected folder, then rewrote installation configuration to
  use the default folder. If that default was a retained relocation source,
  restart exposed its old chats and models again. Ignoring the configuration
  write result also made reset's final location uncertain.
- **Decision:** Reset clears the selected folder's existing reset-owned contents
  without rewriting installation configuration. Resolve the saved selection
  under the same write fence used by relocation, after Agent drain and before
  Host shutdown and deletion. Share configuration parsing with the ordinary
  desktop/CLI folder resolver. A missing settings file selects the normal
  default folder; an unreadable, malformed or unsafe saved selection aborts
  reset before Host shutdown, window hiding or data deletion.
- **Consequences:** The cleared location and startup preference survive restart;
  unselected retained copies are neither selected nor deleted. Existing Agent
  admission/drain, authenticated Host teardown, dependency shutdown and Engine
  binary preservation remain unchanged. Ordinary non-destructive folder
  resolution retains its existing fallback on configuration errors. Reset does
  not expand its deletion list or change external absolute artifact paths.
- **Owner:** team.
- **Links:** `GUI-RESET-RELOCATED-DATA-RESURRECTION`;
  [Custom data folder](../../DEVELOP.md#custom-data-folder);
  [Reset lifecycle](../../src-tauri/src/core/system/commands.rs);
  [Shared folder reader](../../src-tauri/src/core/app/commands.rs);
  [Relocation ownership](2026-10-16-handoff-owned-host-during-app-data-move.md).
