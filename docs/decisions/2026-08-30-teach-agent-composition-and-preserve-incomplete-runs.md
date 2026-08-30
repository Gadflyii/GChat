---
date: 2026-08-30
title: "Teach Agent composition and preserve incomplete runs"
---

# 2026-08-30 — Teach Agent composition and preserve incomplete runs

- **Context:** Agent Studio exposed strategy fields without explaining their execution semantics or total budgets. A goal-loop stage that exhausted its model-step limit returned a generic limit sentence, which the orchestrator could submit to the evaluator as though it were a real deliverable; revision exhaustion was then reported as a normal reply. Run history did not retain the configured step and cycle limits needed to diagnose either outcome.
- **Decision:** Agent Studio teaches the selected composition in place and gives every shared, evaluator, specialist, and workflow field type-specific guidance and examples. A model step is presented as a think/act/observe round rather than a single tool call, and the inspector reports the complete strategy budget. Goal loops stop before evaluating a limit-exhausted executor, preserve the last usable executor result when evaluation or revision limits expire, and record those terminal states as incomplete with their configured budgets.
- **Consequences:** First-time users can construct Standard, Goal Loop, Coordinator, and Workflow definitions without knowing the orchestration implementation. Completed results, step-limit exhaustion, and revision-limit exhaustion are visibly distinct in live activity and run history. Existing history remains readable; newly recorded runs carry enough budget context for diagnosis.
- **Owner:** Sectile Research Laboratories
- **Links:** `src-tauri/src/core/agent/orchestrator.rs`, `src-tauri/src/core/agent/runs.rs`, `web-app/src/routes/agents/index.tsx`, `web-app/src/containers/MessageItem.tsx`.
