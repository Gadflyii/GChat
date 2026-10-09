# GChat remediation and code hygiene

Repository: `/ai/gchat`. Subject: `docs/code-hygiene/`. Owner: GChat coordinator.
Published main code is `e239eac023`, fast-forwarded from `104d4ec6e` and pushed.
Integration `dev/gchat-remediation-104d4ec6` remains at
`/ai/gchat-worktrees/remediation-integration`.

## Outcome and acceptance

Deliver coherent shared tool discovery/execution, accurate incomplete agent
outcomes, current profile evidence, frontend loading improvements and reviewed
Host/Manager cleanup. Preserve skills, connectors, permissions, cancellation,
context semantics, host identity, saved history, models and supported protocols.
Pass composed `make verify` and the relevant strict Clippy checks, update the
local Windows apps, refresh Linux packages, verify the affected installed
behavior, merge/push and retire owned disposable outputs.

Ron approved controlled React/parser/Vitest dependency alignment (OI-105).
Other dependency/platform changes, Server 2 administration, reduced sampling,
context/concurrency or physical guards, model/user-data deletion and unrelated
Engine speed work are excluded. The sole issue authority is GInfer
`docs/maintainer/open-work.md`; [remaining acceptance](../agent-runtime/remaining-acceptance.md)
records unavailable physical prerequisites without making a second issue list.

## Current state and next action

All reviewed source fixes are merged and pushed on main `e239eac023`;
`origin/main` equality is verified at 22:01 UTC. Only subject metadata/docs
follow installed Windows product source `0f06ba433`, whose code is unchanged.
Its composed `make verify` gate passes at 21:17 UTC: 2,112 frontend/core tests, 102 extension tests, all six
coverage floors and supported Rust suites. The reviewed OI-106 winner
`68315e6a3` also passes 85 focused cases, noEmit, production lint and independent
review. Native Windows build PID 38512 terminates with exit 0 at 21:30 UTC;
independent package verification passes at 21:34 UTC. The 125-payload Engine
runtime, 104 profiles including all 103 unchanged original entries, and retained
Manager `43c8d71cf` producer inputs verify. Evidence:
`out/oi106-final-update-20261009/{composed-final-gate.json,package-verification.json}`.
Installed source `0f06ba433` now passes payload and preservation checks, retaining
seven original threads, all models/profiles, credentials and Host identity.
Actual continued Chat saves `QXr1fqK7RSTetk3Y` as ready with `finishReason=stop`
and output 30,000 after compaction from 26,366 to 1,705 tokens; the UI is idle.
Real sidebar Stop leaves the Host stopped with zero Engines/API listeners and
stays stopped on a later observation. Start reaches Ready with fresh session
`11ba8c36-0426-4912-a089-083cfca2b86f`, one Engine/API listener, selected alias
and Server running. Reload reaches fresh Ready session
`3b3bf837-f98b-400b-bf19-b9c05c334d21` while retaining selection/status. Final
GUI Stop returns to zero Engines/API listeners. The original profile is restored
exactly through supported Reload/Stop, and normal apps are restored without debug
listeners. Receipts: `out/oi106-final-update-20261009/installed-verification.json`
and `installed-lifecycle-acceptance.json`. This is Muse C4/32K functional
acceptance; the saved fixed-arena 128K startup failure remains unchanged.

Earlier installed source `7d9eb55f9`, Manager `43c8d71cf` and Engine `2ef56a52a`
passed package/payload and user-state preservation checks. Continued Chat returned
30,000 with `stop` and idle UI after automatic compaction from 26,285 to 2,159
tokens. The original 45-step Coordinator history displayed incomplete with its
output, limiting stages and metrics preserved. Sidebar Stop unloaded the local
Host; explicit Start reached Ready/API serving but left selection/status stale.
This failed Start is retained evidence, not the current correction's acceptance.

The integrated correction preserves Ready Host aliases, ignores stale picker
initialization, shares native facade startup across sidebar, Host readiness and
persisted provider hydration, and uses the existing Stop reservation sequence to
invalidate delayed local or paired intake. Stop waits for an already dispatched
native start before shutting down the singleton. Windows acceptance is complete.
Linux preparation found the retained `05a286ba` runtime contains only its README,
so it cannot satisfy the six-entry offline operator-manual check. The current
item adds separately staged docs matched to that exact engine; six hashes, local
links, wrong-source rejection and actual staging/producer equality pass. four-image
Engine bytes and manifests stay unchanged. The selected docs input is
`out/oi070-linux-refresh/operator-docs` in the frontend/packages tree.
Next: assemble and inspect Linux packages, then verify local X11 windows under
booking 287, 22:21–23:15Z. Completed OI-106 and profile source trees are retired; branches and
external evidence remain.

The temporary read-only tool restriction is removed. C2 stopped its sole Linux
Muse repro at 21:08:45Z. At that check PID 826631 is absent and the RTX 5090
reports 31,015 MiB free.
That diagnostic lost its controller and inherited guard FDs; completion evidence
is invalid, and C2 owns the follow-up. Windows verification/build/acceptance
used the canonical GPU/build guards at WSL PIDs 838489/847974 under booking
284, 21:00–22:00Z. Installed acceptance ends at 21:40:55Z with the exact
original profile stopped and zero Engines/API listeners. Normal GChat PID 40160,
Manager PID 15224 and unchanged Host PID 23052 are restored without debug ports.
Both canonical guard sessions are terminated/released and booking 284 is
canceled after actual END; the direct result is delivered to C3 at 21:41Z.
Linux assembly/X11 acceptance remains pending under booking 287, 22:21–23:15Z, 22:21–23:15Z. Source publication
is complete. Completed OI-106 and profile source trees are retired after
postmerge and fresh live-use checks; Linux package work remains.

## Implementation and verification

The [quality review](gchat-quality.md) records the accepted source changes and
measured fixture work. Compact discovery keeps the full tool catalog and routes
exact invocation through the existing permission runtime. Agent outcomes retain
incomplete workers through synthesis and correct explicit limiting saved history
at read time. Local Host aliases use the registered local identity and fresh
expected sessions; paired remote aliases receive no native model mutation.
Manager reads independent snapshots concurrently, filters displayed heartbeat
noise, preserves dirty persistence until successful writes and reuses pinned
client pools. Host startup HTTP executes outside process ownership. Immutable
saved-history preparation is reused while typing. No native CPU/RAM gain is
claimed from source fixtures or the single idle observation.

The current composed `make verify` at `0f06ba433` passes 2,112 frontend/core
tests (six skipped), 102 GInfer extension tests, all six coverage floors,
553 desktop, 86 Host, six managed-adapter, 12 hardware and 29 utility tests.
Its receipt is `out/oi106-final-update-20261009/composed-final-gate.json`.
The earlier `c9428c456` gate remains historical evidence for installed `7d9eb55f9`.
Strict desktop, Host and Manager Clippy plus supported CLI compilation already
pass at `01d3b05b5`; unchanged Rust retains that evidence. The new OI-106 source
gate, package verification and actual installed Windows acceptance are complete.

Approved alignment retains React/DOM 19.2.8, TypeScript 5.9.2, ESLint 9.25.1
and compatible TypeScript ESLint 8.44.1; extension Vitest UI/runner are 3.2.4.
All project-owned peers pass. Three upstream CJK metadata peers remain and are
reported without widening peer ranges or suppressing warnings. Production output
retains lazy terminal/emoji/highlighter/Mermaid/locale loading, all 250 grammar
assets and the WASM. Final native compilation has no compiler/linker warning;
Yarn still reports the known upstream peer metadata gaps.

Original Muse C4/131072/NVFP4 fixed-arena startup rejects before Ready. The
separate automatic candidate reaches Ready and prepares four distinct exact
131,009-token inputs, but long prefill crosses the unchanged 300 MiB free-memory
guard at 292 MiB. No decode completes and no capacity pass is claimed. Exact
original-profile restoration and zero-Engine cleanup pass. Allocation ownership
remains OI-072-RUNTIME with C2; KV full-touch did not change CUDA/NVML free memory.
No margin, context, concurrency or profile promotion is justified by that result.

## Evidence and owned disk inventory

| Owner / host | Path | Purpose and retention |
| --- | --- | --- |
| Coordinator / local Linux | `/ai/gchat-worktrees/remediation-integration` | Source matches published main `e239eac023`; subject metadata edits await coordinator review, retain through Linux acceptance |
| OI-106 / local Linux | `/ai/gchat-worktrees/oi106-selection-facade-7d9eb55` | Retired after published main and fresh live-use checks; exact local/remote source branches and external evidence retained |
| Frontend/packages / local Linux | `/ai/gchat-worktrees/oi074-frontend-packages` | Approved physical dependency graph and prepared Linux runner; needed for final packages |
| Profiles / local Linux | `/ai/gchat-worktrees/oi072-current-profiles` | Retired; `e0112d2fc` retained on local/remote branches, content represented in published main and external evidence kept |
| Coordinator / local Linux | `/ai/gchat/out/oi106-final-update-20261009` | Frozen source `0f06ba433`, Passing source/build/package/installed Windows acceptance; retained Manager `43c8d71cf` producer and exact original-profile restoration; Linux refresh pending; code merged/pushed on main `e239eac023` |
| Accepted Windows evidence | `/ai/gchat/out/remediation-final-20261009`, `/ai/gchat/out/remediation-native-correction-20261009` | Installed source7d, original history, Chat, Stop and failed Start observations; retain concise evidence through promotion |
| Native caches / Windows | `%LOCALAPPDATA%/GChat/windows-build/source`, `%LOCALAPPDATA%/GChat/release-output` | Existing app compiler/dependency cache and accepted packages; reuse |
| Native Engine baseline / Windows | `%LOCALAPPDATA%/GInfer/gchat-oi056-f9af4/output/ginfer-windows-x64-sm120a.zip` | Tested closed 125-payload `2ef56a52a` Engine; retain without rebuilding |
| Linux inputs | `/ai/ginfer/out/linux-installer-20260930/runtime-set` | Retained `05a286ba` four 167-payload Qwen/Muse images, glibc2.39; no Flash/current-engine qualification claim |
| Shared state | `/ai/gchat/src-tauri/target`, `/ai/gchat/node_modules` | Shared compiler/dependency caches; outside disposable cleanup scope |

The OI-056 source trees and generated-only compact directory are retired after
source preservation, reclaiming 2.479 GB net allocation. The OI-067 tree and five
completed review/acceptance trees are also retired; branches and external results
remain. Review retirement reclaimed 1.386 GB, plus 277,282,816 B for OI-067.
Retain cleanup receipts under `out/code-hygiene-20261009/` and
`out/oi056-current-engine/`. October 9 final retirement removes nine verified
own stale Engine/app build and source-copy paths, recovering 3,124,961,280 B
net Windows allocation after debug retention and 5,187,133,440 B in WSL.
The selected Engine ZIP, current installers, reused Manager/catalog inputs and
63 verified debug/evidence files remain. Current receipt:
`out/oi106-final-update-20261009/cleanup-stale-builds.json`. Other owners' work, models/profiles, saved evidence
and Tessera are excluded; unchecked/shared paths remain in the not-deleted list.
The final two completed source trees are also retired with `git worktree remove`,
releasing 553,762,816 B of owned WSL allocation. Their local/remote branches,
shared dependency targets and external evidence remain. Receipt:
`out/oi106-final-update-20261009/cleanup-completed-worktrees.json`.
No whole-fleet cleanup claim is made.

Physical results: [installer refresh](../installer-refresh/README.md),
[Agent/Chat runtime](../agent-runtime/README.md), and
`out/code-hygiene-20261009/integration/`. Windows idle sampling is retained in
`out/remaining-acceptance-20261009/idle-sample.json`; it does not measure long-chat
rendering or establish a before/after CPU improvement.
