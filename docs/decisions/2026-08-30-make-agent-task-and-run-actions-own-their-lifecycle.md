---
date: 2026-08-30
title: "Make Agent task and run actions own their lifecycle"
---

# 2026-08-30 — Make Agent task and run actions own their lifecycle

- **Context:** Agent mode reused `temporary-chat` as a durable Rust session. The sidebar's New task action only navigated to the already-open home route, so prior session turns, run state, drafts, and attachments survived. Run history also lacked the source task and provided no way to repeat or remove a recorded run.
- **Decision:** New task is an explicit lifecycle boundary. It cancels an active temporary run, waits on the per-session lock, deletes only that session's `agent-session.json`, then clears the temporary frontend draft, attachments, messages, and run trace. Run records retain their bounded source task. Re-run starts that task as a fresh temporary Agent session with the recorded definition; Delete atomically removes the selected history record and its run workspace.
- **Consequences:** New task visibly and semantically starts clean without deleting chat data or unrelated workspaces. Newly recorded runs can be repeated from the same prompt and definition, while legacy records without a stored prompt remain inspectable but cannot be re-run. Run deletion is exact and recoverability is intentionally not promised for this user-requested history action.
- **Owner:** Sectile Research Laboratories
- **Links:** `src-tauri/src/core/agent/session.rs`, `src-tauri/src/core/agent/runs.rs`, `web-app/src/components/left-sidebar/NavMain.tsx`, `web-app/src/routes/agents/index.tsx`.
