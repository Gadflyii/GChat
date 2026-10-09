---
date: 2026-10-09
title: "Preserve Agent stage outcomes through final output"
---

# 2026-10-09 — Preserve Agent stage outcomes through final output

- **Context:** Coordinator copied its synthesis reason to the run, hiding workers
  and planning stages that exhausted their step limits. The loop breaker returned
  a fallback with `reply`, falsely reporting completion. Workflow also dropped
  upstream outcomes; Goal Loop could evaluate a fallback as completed work.
- **Decision:** Keep final output independent from terminal completion reason.
  `loop_detected` records an incomplete stage. Coordinator and Workflow retain
  the first limiting stage reason while failed and cancelled outcomes override
  incomplete ones. Goal Loop stops on an executor fallback and preserves the
  executor's output when its evaluator cannot complete. Persistence, delegated
  results and the frontend use the same terminal status policy: only `reply`
  and `finish` mean finished. History reads also correct finished Coordinator
  and Workflow records when stored stage outcomes prove an incomplete, failed
  or cancelled run; the original saved file bytes remain unchanged. Missing
  outcomes and recovered Goal Loop cycles do not justify a correction.
- **Consequences:** Successful synthesis stays visible even when the overall run
  is incomplete. Individual stage outcomes remain distinct, and run history and
  Chat explain incomplete results. Step budgets, permissions, sampling and model
  execution are unchanged.
- **Owner:** GChat maintainers.
- **Links:** [Current record](../agent-runtime/README.md),
  [Orchestration](../../src-tauri/src/core/agent/orchestrator.rs),
  [Runtime contract](../../src-tauri/src/core/agent/ARCHITECTURE.md).
