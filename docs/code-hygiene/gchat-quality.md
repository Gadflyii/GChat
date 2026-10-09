# GChat code quality review

Repository: GChat. Subject authority: [README](README.md). The
[master issue list](../open-work.md) owns defects and performance work.

## Deliverable and acceptance

Review Host/Manager and frontend/agent runtime paths for dead or redundant code,
current comments, CPU/RAM costs, polling and threading. Keep proven cleanup
separate from runtime improvements. Preserve host trust, credentials, session
guards, action behavior and offline/fleet semantics. Focused contract checks and
the coordinator's composed `make verify` gate support acceptance. Native idle CPU
or memory improvements require native measurements; JSDOM screens do not supply
them. GPU/model operations, deployment, remote hosts, Server 2, dependencies,
framework/platform changes and speculative SIMD are excluded.

## Current candidate

Baseline is main `104d4ec6e`. Owned candidate is
`/ai/gchat-worktrees/review-quality-104d4ec6`, branch
`review/gchat-quality-104d4ec6`. Initial cleanup changes four files:

- `ginfer-manager/ui/manager.js`: remove discovered-host fallbacks after the
  discovered pairing branch always returns.
- `ginfer-host/src/client.rs`: make the service metadata comment current.
- `ginfer-host/src/engine_host.rs`: replace the obsolete future drain-handler
  comment with its current caller requirement.
- `web-app/src/hooks/useTokensCount.ts`: remove the private false ref that is
  never assigned and its unreachable guard; remove redundant comments.

The original ref has exactly its initialization and guarded read in tracked
source, with no escape or assignment. A tracked-source identifier survey found
no production Host/Manager function referenced only by its definition; trait
hooks and test entry points remain. This establishes the bounded survey, not
proof that every repository path is free of dead code.

Existing Manager UI tests pass 19/19 and `git diff --check` passes. No Rust or
TypeScript compilation has started while the coordinator's model job is active.
The coordinator will run the final composed gate once the candidates are ready.

## Review evidence and selected next action

Source inspection identifies serial Manager host reads, unconditional durable
scan writes, per-request TLS clients and complete Manager DOM replacement.
The coordinator owns recording and assigning these findings in the master.

The existing two-host Manager fixture was exercised with 100 identical snapshot
updates under Node 22.22.1/JSDOM. Each update replaced the 145-node window tree,
producing 100 root mutations and losing button focus. Visible median apply time
was 1.283 ms, p95 4.425 ms; the Node process used 385.942 ms CPU. With the document
marked hidden, median was 1.180 ms and CPU was 279.032 ms. These are a bounded DOM
screen and deterministic replacement evidence, not native desktop measurements.

Selected next steps, sent to the coordinator before implementation:

1. Preserve registration order and previous offline data while reading independent
   Manager snapshots concurrently. Fleet discovery/enrollment remains afterward.
2. Retain every latest snapshot in Manager state, suppress duplicate unchanged
   rendering, and defer hidden rendering until visibility resumes. Action status
   and dialogs preserve their explicit state transitions.
3. Skip unchanged scan persistence while preserving retry after a failed durable
   write and detecting new model mappings/changed metadata.
4. Reuse host/certificate-owned TLS connection pools while retrieving current
   credentials for each operation. Forget, changed identity/pin and registry
   replacement retire the applicable pool; mutations are never retried.

Only the first two are next implementation candidates while the Rust compile
window is unavailable. Performance edits will have separate commits from cleanup.

## Owned disk and jobs

| Owner / host | Exact path | Status / retention |
| --- | --- | --- |
| GChat review / local Linux | `/ai/gchat-worktrees/review-quality-104d4ec6` | Candidate source; retain until coordinator integration |
| GChat review / local Linux | `/ai/gchat/out/code-hygiene-20261009/review-quality-104d4ec6/` | Bounded Manager screen script and baseline result; retain evidence |
| Shared dependency/compiler cache | `/ai/gchat/node_modules`, `/ai/gchat/src-tauri/target` | Reuse only; not owned disposable outputs |

No owned compiler, GPU/model, deployment or remote job is live. An initial
inefficient reference survey was stopped; the corrected survey tokenizes only
tracked text once and completed in 28 ms. No model/build payload was allocated.
