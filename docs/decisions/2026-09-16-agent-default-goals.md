---
date: 2026-09-16
title: "Save default goals with agent definitions"
---

# 2026-09-16 — Save default goals with agent definitions

- **Context:** Save & run asked users to invent a task even for a purpose-built loop.
- **Decision:** Every composition exposes an optional `defaultGoal` in its definition. It describes what to accomplish, separately from operating instructions and output formatting. Run setup prefills it; per-run edits do not change the definition. Re-run and continuation tasks take precedence. Empty goals remain valid for general-purpose definitions, but a run still requires a task. Goals use the existing 24,000-character instruction limit.
- **Consequences:** The agent-builder skill supplies concrete goals when creating definitions and preserves them on unrelated edits. Existing saved agents can acquire a goal through the editor; no task is inferred from their names or instructions.
- **Owner:** team.
