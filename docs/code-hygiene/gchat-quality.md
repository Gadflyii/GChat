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

## Current review

The Host/Manager review is accepted from published baseline `a70034880`.
All 29 production source/assets/build files were assigned to six disjoint
writers, with separate independent review and coordinator diff inspection.
Host `116c6ac51` and Manager `4342ddedd` remove proven redundant validation,
state access and unused UI code/styles; 12 files change by +35/-71. Trait,
Serde, test and Windows hooks remain. Current ownership comments are short;
CLI-help documentation remains observable product behavior.

The new source passes all composed verification components and strict
Host/Manager all-target Clippy with warnings denied. Linux manual test-resource
stubbing is corrected separately in `62be0eb8a`. The quiet-window timeout ended
only utility compilation; resuming that remaining target passes without
repeating completed suites. Full scope and contrary failure are recorded in
`out/code-hygiene-20261009/review-host-manager-a7003488/gate-result.json`, with
the independent verdict in `independent-review.md`.

Four baseline bugs (OI-111–114) are source-demonstrated and remain outside behavior-identical
cleanup: removed-model profile persistence, rename without a revision,
queued-download Pause overwritten during admission, and a fleet edit reporting
failure after its canonical commit. Their fixture reproduction proposals and
all resource opportunities are on the sole master list (OI-115–119 and linked existing rows). No native CPU/RAM gain,
thread leak or SIMD opportunity is established. Separate behavioral fixes and
measured performance work must preserve their stated contracts.

Windows product `0f06ba433` remains accepted and installed with preserved user
state. Linux product compile `54c931c68` / packaging `02d369e8a` is accepted
and published in `out/linux/` and `out/ginfer-manager/linux/`; final proof is
`out/oi070-linux-refresh/`. Both X11 fixture Hosts/apps are stopped, guards
released, and temporary extracts/state/duplicate bundles retired. OI-072's
128K physical-memory cause remains open; this review changes no inference
controls. Existing composed verification and installed lifecycle proof remain
baseline evidence; the cleanup source passes its affected and composed
gates for main publication.

## Earlier accepted review

The accepted initial cleanup changes four production files:

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
`de458c468` (ordered parallel observations), and `eeb7fc837` (pinned transports).
The focused gates below and the composed gate above pass. Native package and
Chat and OI-106 lifecycle acceptance are recorded above and pass.

## Retained review evidence

Source inspection identifies serial Manager host reads, unconditional durable
scan writes, per-request TLS clients and complete Manager DOM replacement.
The coordinator owns recording and assigning these findings in the master.

The existing two-host Manager fixture was exercised with 100 identical snapshot
updates under Node 22.22.1/JSDOM. Each update replaced the 145-node window tree,
producing 100 root mutations and losing button focus. Visible median apply time
was 1.283 ms, p95 4.425 ms; the Node process used 385.942 ms CPU. With the document
marked hidden, median was 1.180 ms and CPU was 279.032 ms. These are a bounded DOM
screen and deterministic replacement evidence, not native desktop measurements.

The implemented design preserves these behaviors:

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
existing in-flight behavior without reinserting a stale pool. These accepted
changes preserve external protocols and model behavior.

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
checks; the composed compile/integration gate above passes.

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
from measured gains. Integrated startup lock ownership and typing
preparation changes are recorded below as OI-100 and OI-101. The all-message DOM and
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
focused evidence is retained and the composed gate includes their implementations;
no duplicate review gate is needed.

Runtime improvements are separate commits from the behavior-identical cleanup.

## OI-100 — integrated startup observation

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
and `git diff --check` pass. The composed desktop gate passes; this fixture
establishes no native latency, CPU or RAM improvement.

## OI-101 — integrated typing preparation

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
The composed frontend gate above passes with this integrated change.
All JS checks ended before the coordinator's subsequent timing-window restriction;
no job remains. This does not establish the other owner's actual run start time.

## OI-106 — installed lifecycle accepted

Actual installed `0a4e2b56c` sidebar Stop originally closed facade 1337 while
leaving the local Host Ready with one Engine. The reviewed source resolves
aliases against the registry's actual local Host ID and uses Host Stop/Start/
Restart with a fresh expected session. Paired aliases receive no Host mutation
from local facade Stop. Ready-only picker and active-model projections share
snapshot publication; delayed refresh preserves lifecycle snapshots published
since its reads began, without relying on revision/UUID chronology.

Focused sidebar/restart/Host-store checks passed 21 cases, production ESLint and
`tsc -b` passed, and the composed gate above passed. Installed `7d9eb55f9` Stop
now closes the facade and unloads the local Host. A subsequent explicit Start
reaches Ready and API serving, but its picker stays blank and sidebar status
stays stale. The earlier source expectation that restoring the selected alias
also proves complete Start behavior is invalidated by this installed observation.
Evidence is retained under `/ai/gchat/out/remediation-final-20261009/`.

Winner `68315e6a3`, integrated in `0f06ba433`, corrects shared-facade startup
for persisted `ginfer-lan` aliases/Ready transitions and invalidates delayed
automatic intake after explicit Stop. Its 85 focused checks, production lint,
noEmit and independent review pass. The composed gate, native build and package
verification and actual installed acceptance are complete. Real DOM sidebar
Stop closes the facade and unloads the Host, with zero Engines/API listeners on
both initial and later observations. Start reaches Ready in session
`11ba8c36-0426-4912-a089-083cfca2b86f`; Reload reaches Ready in distinct session
`3b3bf837-f98b-400b-bf19-b9c05c334d21`. Selection and Server running remain
visible with one Engine/API listener. Final GUI Stop returns to zero, and
supported Reload/Stop restores the original profile exactly. Normal apps are
restored without debug ports. This accepts the C4/32K functional route; the
original fixed-arena 128K startup failure remains OI-072. The old OI-106
Stop tree is retired; source branch and evidence remain. No runtime capacity promotion follows from this work.

## Owned disk and jobs

| Owner / host | Exact path | Status / retention |
| --- | --- | --- |
| GChat review / local Linux | `/ai/gchat-worktrees/review-quality-104d4ec6`, `/ai/gchat-worktrees/review-hardware-880ecb5c` | Retired owned source trees after integration and remote/tip/live-use checks; branches/evidence retained |
| Coordinator / local Linux | `/ai/gchat-worktrees/remediation-integration` | Current composed source; build/job inventory in subject README |
| GChat review / local Linux | `/ai/gchat/out/code-hygiene-20261009/review-quality-104d4ec6/` | Bounded DOM screens and focused Rust receipts, including contrary failures; retain evidence |
| Shared dependency/compiler cache | `/ai/gchat/node_modules`, `/ai/gchat/src-tauri/target` | Reuse only; not owned disposable outputs |

No delegated review job remains live. The retired review trees own no retained
compiler/model allocation. Small review receipts and shared compiler/dependency
caches remain; current native packages are retained under the integration
authority. No whole-fleet cleanup claim is made.
An initial
inefficient reference survey was stopped; the corrected survey tokenizes only
tracked text once and completed in 28 ms. No duplicate model or build directory was allocated.


## Accepted Linux refresh

Native/frontend compilation at `54c931c68` and cached AppImage packaging at
`02d369e8a` pass. DEB/AppImage/Manager payload verification covers 488 ELF
objects, GLIBC <= 2.39, four exact 167-payload images, 174 profiles and six
version-matched offline manuals. Final frontend fixture passes syntax,
Mermaid, localization and zero external content requests; largest JS is
499,377 bytes. Actual X11 windows start dark; Manager Scan and close/reopen
retain each shared Host with zero models/instances/requests. Evidence:
`out/oi070-linux-refresh/{package-verification.json,native-acceptance.json}`.
The isolated locator uses 17443 because Windows owns mirrored 7443/7444;
LAN/tray/vault and current Engine/Flash/capacity are outside this acceptance.
The package item and focused Host/Manager review are complete.

Owned Linux fixture/bundle retirement reclaims 17,405,161,472 B; accepted packages,
manual input and concise evidence remain. Shared compiler/dependency baselines
are retained. See `out/oi070-linux-refresh/cleanup-normal.json` and
`cleanup-root-bundle.json`.
