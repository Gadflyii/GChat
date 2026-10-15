---
date: 2026-10-15
title: "Preserve bounded Agent retrieval content"
---

# 2026-10-15 — Preserve bounded Agent retrieval content

- **Context:** The July 20 session-boundary compressor reduces a newly requested
  file excerpt to 400 characters and its last 12 nonblank lines before the next
  inference. The native eight-file review repeatedly lost source content even
  when rereading its full-result artifact, despite ample remaining context.
- **Decision:** Preserve successful `os.fs.read`, `os.fs.grep`,
  `os.fs.read_document` and `os.fs.archive.read_entry` observations verbatim in
  the session. These tools already bound their returned content: reads to
  16000 bytes, grep and archive reads to 16000 characters plus a truncation
  marker, and document extracts to at most 50000 characters plus that marker.
  Retain the existing compression and summary limits for other observations.
- **Consequences:** The next decision and saved session retain the requested
  excerpt, including tool-level truncation markers. Prompt input can grow
  faster; existing exact GInfer token budgeting and safe-boundary checkpoint
  compaction continue to bound inference context. Full result artifacts and
  activity events are unchanged. Previously compressed sessions cannot recover
  their lost content without a new read. This supersedes the July 20 decision
  only for successful bounded content retrieval.
- **Owner:** team.
- **Links:** [Previous compression decision](2026-07-20-compress-verbose-agent-observations-only-at-the-session-boundary.md),
  [session boundary](../../src-tauri/src/core/agent/session.rs),
  [runner regression](../../src-tauri/src/core/agent/runner_tests.rs),
  [context budgeting](../../src-tauri/src/core/agent/context.rs).
