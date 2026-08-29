---
date: 2026-08-29
title: "Build Agent Studio on one versioned orchestration runtime"
---

# 2026-08-29 — Build Agent Studio on one versioned orchestration runtime

- **Context:** GChat already had a durable Rust tool loop, approvals, scoped workspaces, and reusable skills, but the Agent UI exposed only one general-purpose agent with one selected skill. Adding loops and multi-agent teams as unrelated execution paths would duplicate safety and state semantics.
- **Decision:** Agent Studio stores schema-versioned definitions for four compositions over the existing executor: Standard Agent, Goal Loop, Coordinator Team, and acyclic Workflow. The internal General Agent remains the unsurfaced runtime fallback and supplies new editable drafts; the library and task picker expose only saved user definitions. Built-in templates are immutable starting points, and saved definitions are validated before persistence. One GInfer model serves the composition, parallel roles are bounded by its supported concurrency, child stages have isolated session state, and parent cancellation and approval policy govern the entire run.
- **Consequences:** Users can build reusable agents, skills, evaluative loops, bounded teams, and workflows without creating a second tool runtime. Composite definitions add orchestration latency and must expose stage-level traces; they cannot promise independent per-role models while GChat owns one resident model.
- **Owner:** team
- **Links:** `src-tauri/src/core/agent/definitions.rs`, `src-tauri/src/core/agent/runner.rs`, `web-app/src/routes/agents/index.tsx`
