---
date: 2026-09-16
title: "Manage worker context at completed tool boundaries"
---

# 2026-09-16 — Manage worker context at completed tool boundaries

- **Context:** Agent compaction could only remove whole older user turns. A single long Studio task therefore failed instead of compacting. Saved stage summaries were not a complete execution archive.
- **Decision:** All native worker roles share an exact-count context manager. It counts the complete inference payload, including tool schemas, through the assigned engine's token-count endpoint. It reserves a response budget and working headroom, retaining the original task and role instructions separately from checkpointed history. Compaction cuts only after completed calls/results or replies, retains recent exchanges, chunks checkpoint requests to fit the same model, and verifies the resulting request before replacing working history. Manual worker requests wait for the next safe boundary; chat `/compact` uses the same manager for agent sessions.
- **Consequences:** No fixed 32K conversation ceiling, token-estimation fallback, model reload, tool replay, or budget reset. Each run's stage context directory owns an append-only transcript, full tool-result artifacts, and an atomic working-state snapshot. Prompt summaries reference those artifacts; workflow handoffs reference full saved stage results. Archived data contains the original task, tool arguments, results, and model reasoning, so it is local user data and is deleted with its run history. Stage context metrics and a Compact button appear in Live Runs. A failed or ineffective automatic checkpoint leaves the prior working history and archived evidence available and stops the run with a context error; it does not silently restart execution.
- **Owner:** team.
- **Supersedes:** the agent-specific estimated budgeting and user-turn-only boundary in [2026-08-30](2026-08-30-own-context-compaction-in-gchat.md). Normal chat and external terminal agents retain their respective context managers.
