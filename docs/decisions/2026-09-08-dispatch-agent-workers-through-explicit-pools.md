---
date: 2026-09-08
title: "Dispatch Agent Studio workers through explicit instance pools"
---

# 2026-09-08 — Dispatch Agent Studio workers through explicit instance pools

- **Context:** Registered LAN instances can serve independent agent workers, but model selection lacked a run setup dialog, shared pool accounting, and live worker events.
- **Decision:** Native Studio owns persisted explicit pools, run-local role overrides, capability/context admission, cancellable capacity waits, and session-pinned assignments. The lowest configured pool limit for an instance bounds this GChat's workers; engine concurrency is a hard upper bound. Roles release permits between stages, retain affinity across goal-loop cycles, and never reload or substitute a session after execution starts. Tools/workspaces remain local to GChat. Add Worker Pools, role-aware Run setup, and live monitoring using existing theme tokens. Ship the Agent Builder skill with native inspect and approval-gated management tools; starting a run remains an explicit GUI action.
- **Consequences:** Multiple pools/runs share slot accounting, not separate per-pool capacity claims. Other clients can still consume engine capacity; this is not a cluster-wide reservation service. Detailed worker events are surfaced without replaying tools. Definition defaults, per-run assignments, and completion/limit/failure states remain distinguishable. Normal chat routing is unchanged. Agent runs use explicit context requirements rather than silently reloading the instance for a larger context.
- **Owner:** team.
- **Links:** [Design and pressure tests](../agent-worker-pools-design.md), [Original orchestration runtime](2026-08-29-build-agent-studio-on-one-versioned-orchestration-runtime.md).
