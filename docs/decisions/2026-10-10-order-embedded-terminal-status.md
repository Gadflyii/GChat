---
date: 2026-10-10
title: "Order embedded terminal status by native sequence"
---

# 2026-10-10 — Order embedded terminal status by native sequence

- **Context:** Code Stop can snapshot Stopping before the native waiter publishes
  Exited, then deliver that command reply after the exit Channel event. The
  frontend accepted both without ordering. Native Windows generation 1 exited
  with code 1 while the installed UI remained Stopping for 26 seconds.
- **Decision:** Status snapshots and lifecycle events carry the locked native
  Session status, including its existing per-generation sequence. A successful
  stop transition advances that sequence. The shared Code/Hermes hook accepts
  status by generation and sequence, with a separate cursor for output/replay
  delivery. It does not rank phases or infer process exit from an error message.
- **Consequences:** A delayed Stopping snapshot cannot replace a newer Exited
  status. Replay output remains available after a current snapshot, and a new
  generation resets event delivery even if its spawn reply arrives first.
  Reader errors retain native Running; waiter errors carry native Exited without
  inventing an exit code. Failed Windows termination preserves its existing error
  and ownership. Product and dependency versions, controls and permissions are
  unchanged; the in-tree IPC producer and consumer must update together.
- **Owner:** GChat.
- **Links:** [Current acceptance and evidence](../agent-runtime/remaining-acceptance.md#embedded-terminal-status-ordering),
  [Native terminal](../../src-tauri/src/core/terminal.rs),
  [Shared terminal hook](../../web-app/src/hooks/useEmbeddedTerminal.ts).
