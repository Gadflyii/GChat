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
`review/gchat-quality-104d4ec6`. Initial cleanup changes four production files:

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

Cleanup commit is `7e80fa7ae`. Runtime changes are separate commits:
`2ff833a3a` (Manager rendering), `9bf2e3724` (inventory persistence),
`de458c468` (ordered parallel observations), and `eeb7fc837` (pinned transports). The focused gates below pass. The coordinator's composed
`make verify`, native GChat adapter build and installed acceptance remain the
next integration actions.

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

All four are implemented. Manager uses the shared Client's ordered
concurrent observation operation; its TLS-barrier regression passes. The UI tests pass 21/21, including heartbeat-only DOM/focus (Host revision and
nonrendered usage), visible client timestamp/request changes, fresh instance
session guards, hidden latest state, visibility return and disposal. In the same
identical-snapshot screen, replacement
mutations drop from 100 to zero and focus is retained; visible median apply time
is 0.044 ms. A changing-snapshot screen preserves 100 visible renders while hidden
renders drop from 100 to zero. This demonstrates the intended DOM work removal.

Before the remaining changes, write-failure pressure testing identified that a
new-ID comparison alone would miss a retry after the ID enters memory but the
write fails. The selected Host-owned dirty flag remains set until successful
state persistence. TLS pools belong to the shared Client's registered host/pin/
grant; changed registration invalidates them, and credentials remain per-request.
Already superseded request metadata may use an uncached pin client, preserving
existing in-flight behavior without reinserting a stale pool. The coordinator
has these designs; no external protocol or model behavior changes are proposed.

The coordinator's native Windows idle observation is retained in
`/ai/gchat/out/remaining-acceptance-20261009/idle-sample.json`. At zero model
processes, the 30.09-second aggregate CPU sample was 3.84% of one logical core for
GChat, 0.363% for Manager and 0.208% for Host. It covers the untouched current view,
not a long conversation or an attribution to a specific renderer. Working-set
sums can double-count shared pages; private bytes measure commit, not residency.

The first focused Rust gate ran after the coordinator released the model/other
compiler work, under the canonical build/GPU locks and an eight-minute command
limit. Six of ten client tests passed. The two added fixtures initially omitted
the explicit sharing setup; existing stopped-host/fleet checks also exposed
pooled TLS EOF classified as a configuration problem. Fixtures now own accepted
connections so aborting a server actually stops them. The first correction
incorrectly limited that cause to connection establishment.
Cached reqwest/hyper source distinguishes established I/O from connection setup.
The final source traverses the actual error chain and classifies typed
`UnexpectedEof` only during request/connect phases as unavailable; decoded
HTTP/schema, identity, protocol, authentication and certificate errors remain
problems. Mutations are not retried. The added TLS regression checks those
boundaries, ten warm read connections, changed credentials/pins and forget/re-pair.
Inventory checks cover unchanged durable bytes with changed artifact metadata,
failed durable-write retry, and stable IDs after restart. The final bounded Rust
gate passes: both existing stopped-host/fleet cases,
both new TLS regressions, four target/admission and inventory checks, and the
Manager compile check. The six remaining client cases passed in earlier runs;
there is no remaining focused client failure. Receipts are
`/ai/gchat/out/code-hygiene-20261009/review-quality-104d4ec6/rust-focused*.log`.
Only offline cached Host/Manager Rust checks ran under the canonical build/GPU
locks. The native GChat inference adapter preserves its session/header/credential
checks in source and awaits the coordinator's composed compile/integration gate.

The heartbeat screen changes Host revisions, local-administrator last-seen data,
and client timestamp milliseconds within the displayed second on 100 updates.
The baseline replaces the tree 100 times and loses focus; the candidate makes
zero DOM mutations and retains focus. Visible median apply time is 1.378 ms
before and 0.041 ms after in Node/JSDOM. Actual displayed client timestamps,
request counts, fleet revisions and instance sessions continue to trigger updates;
changing visible data can still rebuild the tree. No native CPU/RAM reduction
is claimed from these screens.

## Bounded review conclusions

The coordinator records findings in the sole master; OI-092 through OI-095 map
to the implemented runtime changes above. Source opportunities remain distinct
from measured gains. Follow-up candidates for startup lock ownership and typing
preparation are recorded below as OI-100 and OI-101. The all-message DOM and
attachment-reference projections belong to existing OI-075 acceptance.

Qualified launch/reload retains full artifact SHA256 verification in
`spawn_blocking`, before stopping the current session. Existing writers provide
no unchanged-content proof that would justify a digest cache; file stamps alone
cannot preserve exact artifact identity. The modified-payload regression remains
the guard for this behavior. No hash cache or timing claim is added.

Studio catalog polling already deduplicates requests, compares unchanged data,
and stops while hidden. Engine host polling guards overlap and uses concurrent
host observations. Queued worker allocation waits on notifications or a two-second
refresh; it is not a busy spin. Current native thread/working-set totals do not
establish a thread leak. No supported SIMD hot path was established.

Independent read-only reviews found no blocking defect in the actual OI-067
outcome/status correction or OI-072 recorded-Engine evidence-label patch. Their
own focused evidence remains owned by those candidates; this branch does not
copy their implementations or rerun their gates.

Runtime improvements are separate commits from the behavior-identical cleanup.

## OI-100 startup observation candidate

The follow-up candidate starts from integrated `bc221f048`. Process exit,
startup timeout, child reaping, log-reader drain and GPU reservation remain owned
by `HostProcesses` under its mutex. `Host::refresh_processes` takes immutable
session-scoped probes, awaits independent health/authenticated model reads
concurrently outside that mutex, then publishes only for the same instance and
session still Starting with an owned child not observed exited. The existing
one-second HTTP timeout, startup deadline, model-ID match and lifecycle defaults
remain unchanged. Stop/reload/shutdown retain their existing child ownership;
probes never own children or spawn background jobs.

The existing lifecycle fixture now gates two independent health/model endpoints.
It checks parallel health arrival, snapshot and expected-session stop while
health reads wait, expected-session reload while model reads wait, and rejection
of delayed metadata for stopped/replaced sessions. The owned-child timeout and
real ready/inference fixtures call the updated owner method. Kill and log-drain
waits remain inside the process lock; this change addresses health HTTP waits.

Exact source `d05f3712f` passes owning all-target Cargo check, all-target Clippy
with warnings denied and 86 Host tests (three explicit live tests remain ignored).
The gated lifecycle case passes its 500 ms observation/action bounds before
response release, including both model probes and stale-session rejection.
The offline cached gate ran from this owned tree at 18:01:42–18:02:09Z under
canonical build then GPU locks, bounded to 300 seconds with six Cargo jobs.
Both guards released; no job remains. Receipt and wrapper are retained as
`oi100-focused-gate.log`/`.sh` in the owned evidence directory. Diff inspection
and `git diff --check` pass. Native desktop integration belongs to the
coordinator; this fixture establishes no native latency, CPU or RAM improvement.

## OI-101 typing preparation candidate

The follow-up candidate starts from integrated `503fa3f7e`. Token-count
preparation now normalizes immutable saved history only when its message array
changes, then normalizes the synthetic draft separately. The saved-message store
publishes new arrays for additions, edits and deletion. Existing attachment
ordering/text, reasoning removal, images, draft timestamps, count scheduling and
model-capacity semantics remain unchanged.

The existing prompt suite passes 8/8 with an observable token-service input
regression for saved history, inline files, images, draft changes, edited history
and changed model/capacity. Production ESLint and TypeScript build checks pass.
The retained `token-draft-screen.mjs`/JSON screen uses the actual transpiled hook
with a Node memo/effect fixture: 500 saved messages and 100 keystrokes produce
100/100 exactly equal count inputs before/after. Text transforms fall from 50,100
to 600; distinct saved-message objects from 50,000 to 500 and content-block
objects from 60,000 to 600. Preparation time is 37.08 ms before and 2.80 ms after
in that fixture. These measure fixture work/allocation, not native CPU or RAM.
The coordinator owns acceptance/integration and the remaining composed gate.
All JS checks ended before the coordinator's subsequent timing-window restriction;
no job remains. This does not establish the other owner's actual run start time.

## Owned disk and jobs

| Owner / host | Exact path | Status / retention |
| --- | --- | --- |
| GChat review / local Linux | `/ai/gchat-worktrees/review-quality-104d4ec6` | Candidate source; retain until coordinator integration |
| GChat review / local Linux | `/ai/gchat/out/code-hygiene-20261009/review-quality-104d4ec6/` | Bounded DOM screens and focused Rust receipts, including contrary failures; retain evidence |
| Shared dependency/compiler cache | `/ai/gchat/node_modules`, `/ai/gchat/src-tauri/target` | Reuse only; not owned disposable outputs |

No owned compiler, GPU/model, deployment or remote job is live. The candidate
source tree occupies 265 MiB; small review receipts occupy 72 KiB. The
node_modules symlink and shared target cache are reused, not duplicate allocations.
An initial
inefficient reference survey was stopped; the corrected survey tokenizes only
tracked text once and completed in 28 ms. No duplicate model or build directory was allocated.
