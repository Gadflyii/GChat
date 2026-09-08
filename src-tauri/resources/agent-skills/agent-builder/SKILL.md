---
name: agent-builder
description: Design, validate, and revise GChat Agent Studio agents, goal loops, coordinator teams, workflows, and worker pools; inspect and explain their execution and monitoring.
version: 1.0.0
requires_tools:
  - studio.inspect
  - studio.manage
dangerous: false
platforms:
  - linux
  - win32
---

# Agent Builder

Help the user turn an outcome into a runnable, understandable Agent Studio
definition. Use the actual Studio contracts, not generated files in the workspace.
Load `tool.view` for `studio.inspect` and `studio.manage` before using them.

## Design and validate

Call `studio.inspect` with `action: "catalog"` to obtain current native templates,
saved definitions, pools, instance IDs/capabilities, and role-key conventions.
Use a returned template as the schema source. Preserve every required field;
use schemaVersion 3, builtIn false, and a new lowercase hyphenated ID for a new
definition. For editing, retrieve the exact saved definition with
`get_definition`, `args: {"id":"..."}` and retain its identity.

Choose the composition that fits the task:

- **Standard:** one worker carries a task through its tool loop.
- **Goal loop:** an executor revises against an evaluator's explicit success
  criteria. Specify what PASS means and useful REVISE feedback.
- **Coordinator:** a planner distributes independent specialist tasks and a
  synthesizer assembles their results. Set bounded parallelism; avoid overlapping
  write responsibilities.
- **Workflow:** explicit acyclic dependencies and one final result stage. Isolated
  workers produce handoffs; shared-workspace stages need deliberate sequencing.

Ask only for missing information that materially changes the definition: the
desired result, completion conditions, input locations, tool permissions, or
execution budget. Explain maximum tool steps and loop cycles separately. Hitting
a limit is incomplete, not success; do not simply raise limits to hide a bad loop.

Define instructions, output contract, skills, limits, and evaluator behavior in
plain language. Preview the proposal and its role assignments before saving.
Use `validate_definition` with the entire definition in `args`, correct reported
errors, then use approval-gated `studio.manage` / `save_definition` only when the
user authorizes saving. Never write agent-definitions.json or bypass validation.

## Placement and multimodal tasks

Use `roleAssignments` keyed by the catalog's role IDs. Each entry contains:

```json
{"target":{"kind":"pool","id":"exact-pool-id"},"vision":true,"minimumContext":8192}
```

Other targets are `{"kind":"current"}` and
`{"kind":"instance","id":"exact-registry-instance-id"}`. Do not derive IDs
from a display name, URL, or model filename. Pool membership is explicit, never all
discovered hosts. Use `save_pool` only after the user approves its members/limits.
Pool args contain `id` (empty for new), `name`, and `members`, each with
`instanceId` and `workerLimit`.

For image/video analysis, require Vision for the roles that actually inspect
media and explain how their inputs reach `vision.describe` through permitted
workspace paths. Declaring Vision does not transfer files or grant file access.
Text-only evaluators may consume a visual worker's textual report. Audio needs
an explicit supported preprocessing skill; do not label Vision as audio support.

Check readiness, Vision, context, and configured concurrency. Unknown support is
not support. Keep the coordinator or evaluator on an explicit model when the user
needs predictable judgment; pool independent workers when parallelism is useful.
An instance's lowest pool limit applies across this GChat's pools. Other clients
can still consume engine capacity. Tools run on the GChat computer, not the GPU host.

## Run and monitor

After saving, guide the user to **Agent Studio → saved agent → Save & run**.
Run setup supplies the task, workspace, role overrides, and optional saved
defaults. The user clicks **Run** to start; these tools do not silently launch
background agents or change normal chat routing.

Use `studio.inspect` / `monitor` for active worker events and completed records,
or `runs` for preserved results. Explain queued vs running vs tool/approval waits,
exact host/model assignments, measured generation tokens/sec, and stop reasons.
Rate is worker-specific generation time, not aggregate host throughput or total
wall time. A queued Vision role may need a suitable instance, not a larger budget.

Assignments stay pinned once work starts. No automatic model loading, session
substitution, or tool replay after failure. For a lost session, preserve the run
and review side effects before proposing a new run. On explicit user request,
approval-gated `studio.manage` / `stop_run` takes `args: {"id":"run-id"}`.
Read monitoring again to verify the outcome. Do not infer permission to stop
another run or modify a pool merely from a request for status.
