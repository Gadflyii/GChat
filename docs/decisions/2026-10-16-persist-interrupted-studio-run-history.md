---
date: 2026-10-16
title: "Persist interrupted Studio run history"
---

# 2026-10-16 — Persist interrupted Studio run history

- **Context:** Agent Studio previously wrote its history record after execution
  returned. Losing an invocation before that write could leave archived tool
  output without a discoverable run, even though normal app shutdown already
  cancels and waits for active workers to persist.
- **Decision:** After preflight and session loading, persist an admission record
  before model or tool execution, using the existing run-history schema 3. It
  records the task, workspace and archive location as `incomplete`, with an empty
  finish reason and zero finish time. Completion replaces that same storage ID.
  Public history, deletion and retention consult the actual active-run registry;
  an active record stays hidden from saved history and protected from deletion
  and archive pruning through final persistence and cleanup. Retain the newest
  100 inactive records in addition to every active record.
- **Consequences:** Fresh application state exposes an unfinished admission as
  incomplete history, with an explicit warning to inspect saved files and verify
  completed work before continuing as a new run. The recorded archive location
  gives access to any outputs saved before interruption; it does not guarantee
  that every side effect has a corresponding observation. There is no automatic
  replay, pending-approval restoration or import of interrupted session working
  state. The existing Continue as new run action creates fresh run and session
  identities and keeps the verify-before-acting warning.
- **Verification scope:** The pending model-free regression drops a scripted
  invocation after a completed file read and an unapproved shell request, then
  reopens the same data with fresh application state. This targets invocation
  loss and history discoverability. Native unexpected-process exit and power-loss
  recovery remain unqualified; existing native normal-close acceptance is
  unchanged.
- **Owner:** team.
- **Links:** [Runtime architecture](../../src-tauri/src/core/agent/ARCHITECTURE.md#durable-admission-and-interrupted-history),
  [runtime guide](../agent-runtime/README.md#interrupted-studio-run-history--october-16),
  `src-tauri/src/core/agent/commands.rs`, `src-tauri/src/core/agent/runs.rs`.
