---
date: 2026-08-30
title: "Default GInfer reasoning to high"
---

# 2026-08-30 — Default GInfer reasoning to high

- **Context:** Fresh Chat sessions disabled reasoning and Agent definitions without an explicit
  effort inherited no value. That made the initial GInfer experience use direct or artifact-
  dependent behavior even though GChat's agentic workflows are designed around deliberate local
  reasoning.
- **Decision:** Fresh and pre-decision GChat settings enable reasoning at `high`. Built-in Agent
  definitions and orchestration stages with no explicit effort also resolve to `high`; an explicit
  per-chat or per-role choice, including `none`, remains authoritative.
- **Consequences:** New/default work spends the latency and tokens associated with high reasoning.
  Users can still lower or disable reasoning, and saved explicit Agent role assignments remain
  intact.
- **Owner:** team
- **Links:** `web-app/src/hooks/useGeneralSetting.ts`,
  `src-tauri/src/core/agent/definitions.rs`, `src-tauri/src/core/agent/orchestrator.rs`,
  `src-tauri/src/core/agent/runner.rs`.

<!--
Extends: 2026-08-29-route-agent-inference-through-ginfer-native-openai-contract.md
-->
