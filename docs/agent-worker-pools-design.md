# Agent Studio worker pools

Implemented on `feat/agent-worker-pools`. Native dispatch tests use controlled
loopback GInfer sessions; physical multi-host inference and the Windows installer
remain manual integration checks.

## Outcome

Agent Studio owns Build, Run, and Monitor. Engines remains the host/model lifecycle
authority. A Worker Pools tab groups explicitly chosen local or paired instance IDs.
Run setup lists the saved definition's roles and permits current-model, exact-instance,
or named-pool assignment, with explicit Vision/context requirements. A prominent Run
action opens the live monitor. Normal chat never routes through a pool automatically.

The bundled Agent Builder skill creates and revises all four native compositions:
standard, goal loop (including evaluator), coordinator team, and acyclic workflow.
It discovers actual schemas, instances, pools, and run state through supported tools;
it proposes changes for approval and never gains filesystem or run authority merely
because a skill was selected.

## Ownership and execution

- Native Rust owns persisted pools, validation, role dispatch, capacity accounting,
  and observable execution state. UI stores are projections, not schedulers.
- Pool members reference registry identities, never URLs or model-name matching.
  Offline members remain editable. Discovery alone grants neither membership nor access.
- Each run snapshots its assignments and pool membership. A worker chooses a suitable
  ready instance before inference and keeps that exact session while executing.
  Capacity limits apply across this GChat process and overlapping pools, not merely
  one run. Other desktop clients and interactive requests remain engine-owned load;
  pool limits do not promise cluster-wide reservations.
- Available candidates must meet explicit Vision and minimum-context requirements.
  Unknown capability is not evidence of support. No model loading, silent migration,
  or rerouting after tools execute. Exhausted capacity queues cancellably with a reason.
- Release permits on completion, failure, and cancellation. Do not hold a parent
  permit while waiting for its children. Goal-loop cycles retain role affinity but
  release capacity between stages to prevent self-deadlock.
- GChat owns tools/workspaces regardless of which inference host is selected.
  Vision requirements do not themselves transfer image bytes: existing media/tool
  routes must deliver represented inputs and preserve access checks.

## UI

Use existing Geist, semantic colors, and theme components, with light/dark parity.
Worker Pools shows explicit membership, readiness/capabilities, and worker limits.
Run setup shows task, workspace/permissions, roles, requirements, and execution limits;
assignments are run-local unless explicitly saved as defaults. Monitor shows queued,
running, tool/approval activity, completed, cancelled, failed, and limit-reached states,
with exact instance labels and per-worker measured throughput. Deeper events and
results belong in a selected-worker panel. Never label aggregate instance rate as an
individual worker rate or show tools running as token generation.

## Pressure-test matrix and acceptance

| Case | Required behavior |
| --- | --- |
| Same model on two hosts | Distinct registry identities and worker assignments |
| Instance in two pools / simultaneous runs | Shared accounting prevents double capacity |
| All suitable slots occupied | Cancellable visible queue, no hidden reload |
| Missing Vision / insufficient context | No incompatible dispatch; clear reason |
| Offline member / session restart | No silent substitution for an executing worker |
| Coordinator and children share C1 | Parent releases its slot before children execute |
| Cancel while queued / failed tool / exception | Permit released, run preserved |
| Parallel workers emit tool events | Individually scoped live events, no lost approvals |
| Skill creates or operates agent | Same validation and approval path as UI |
| Light/dark, empty pool, first-run dialog | Readable themed UI and actionable empty states |

Verify scheduler semantics with deterministic concurrent tests, native command and
tool contracts, rendered UI interaction tests, existing run regressions, and `make
verify`. Real-host inference only if needed to resolve an integration question and
after coordinating host availability. Preserve pending secure-storage work. No commit,
push, package installation, or engine change is included without further instruction.

## Concurrency and memory

Independent workers execute concurrently, with shared native capacity accounting.
Definition/run/pool persistence and blocking hardware sampling run on background
workers. React rendering and state publication retain their owning thread.

Capacity polling excludes full definitions and run transcripts. Live monitor history
is bounded, completed history belongs to durable storage, and routine UI events are
batched for 40 ms. Approval and completion events flush immediately. Cancellation
retains accounting for completed stages. The obsolete eager model-routing path and
Studio context-expansion hook have been removed: dispatch never reloads an engine to
satisfy an assignment.
