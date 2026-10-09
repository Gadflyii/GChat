# GChat remediation and code hygiene

Repository: `/ai/gchat`. Subject: `docs/code-hygiene/`. Owner: GChat coordinator.
Reviewed Windows product `0f06ba433` is published on main; Linux packaging
source is `02d369e8a`, with native/frontend compilation at `54c931c68`.
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

Windows installation and actual continued Chat/sidebar Stop/Start/Reload pass.
Original history, models, profiles, credentials and Host identity are preserved;
normal Windows apps remain open with the original profile stopped and zero
Engines. Product `0f06ba433` passes composed `make verify` and installed lifecycle
checks in `out/oi106-final-update-20261009/`. This is C4/32K functional acceptance;
OI-072's original fixed-arena 128K failure remains open.

Linux DEB, AppImage and Manager are refreshed and accepted. Compilation uses
`54c931c68`; `02d369e8a` adds only cached offline AppImage runtime selection.
Independent verification covers exact four 167-payload runtime images, 174
profiles, six version-matched offline manuals, companions and GLIBC <= 2.39.
Both real X11 clients start dark; Manager Scan works and close/reopen preserves
the shared Host. Zero models, instances and requests are used. All fixture
processes stop and both canonical guards are released. Packages are in
`out/linux/` and `out/ginfer-manager/linux/`; evidence is retained in
`out/oi070-linux-refresh/`. Default Windows-owned mirrored ports require an
isolated 17443 test locator. LAN/tray/vault, Flash, current-Engine capacity and
Server 2 are not qualified by this check. The actual frontend offline fixture
passes with a largest JS chunk of 499,377 bytes.

The focused Host/Manager review is accepted. Starting from published main
`a70034880`, six disjoint writers and an independent reviewer examined all 29
production source/assets/build files. Cleanup commits `116c6ac51` (Host) and
`4342ddedd` (Manager) change 12 files, adding 35 and removing 71 lines. Proven
redundant guards, private accessors/derive, SSE wrappers, unused UI branches and
selectors are removed; current ownership comments are shortened. Behavior,
protocols, credentials, session/lifecycle guards and Windows/CMP/laptop paths
are preserved. Source-supported CPU/RAM/loop findings and four unchanged
baseline defects belong to the master list, with measurement or reproduction
proposals; none supplies a measured native performance gain.

The composed checks pass at `62be0eb8a`, including independent review,
frontend/core 2,112 tests, extension 102, Manager UI 21, six coverage floors,
desktop 553, Host 86, managed adapter six, hardware 12 and utility 29. Strict
Host/Manager all-target Clippy passes with warnings denied. Existing live tests
remain explicitly ignored. The first Rust gate exposed a missing inert test
resource for the new Linux manual glob; `62be0eb8a` corrects the existing
stubber without touching real manuals. A quiet-window timeout interrupted only
utility compilation; that remaining target and Clippy were resumed, with no
rerun of already passing suites. Evidence is
`out/code-hygiene-20261009/review-host-manager-a7003488/gate-result.json`.
No GPU/model or installer rebuild was needed for this behavior-identical review.
Canonical build guards are released; all owned check processes ended before
23:15 UTC. Main integration and owned source retirement complete this review;
new defect fixes and measured performance changes use separate master-list
items and branches.

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
| Review coordinator / local Linux | `/ai/gchat-worktrees/review-host-manager-a7003488` | Accepted candidate from main a70034880; checks complete, no live job/model; retire after main publication |
| Coordinator / local Linux | `/ai/gchat-worktrees/remediation-integration` | Accepted main a70034880 source; eligible owned retirement after review publication; preserve unique evidence first |
| Coordinator / local Linux | `/ai/gchat/out/oi070-linux-refresh` | Accepted Linux package/native proof, six-doc inputs and runner; old packet path is a stable symlink, temporary extracts/state retired after final checks; published packages retained |
| OI-106 / local Linux | `/ai/gchat-worktrees/oi106-selection-facade-7d9eb55` | Retired after published main and fresh live-use checks; exact local/remote source branches and external evidence retained |
| Frontend/packages / local Linux | `/ai/gchat-worktrees/oi074-frontend-packages` | Approved physical dependency graph and retained Linux runner; still reused by source checks, shared dependents preserved |
| Profiles / local Linux | `/ai/gchat-worktrees/oi072-current-profiles` | Retired; `e0112d2fc` retained on local/remote branches, content represented in published main and external evidence kept |
| Coordinator / local Linux | `/ai/gchat/out/oi106-final-update-20261009` | Frozen source `0f06ba433`, Passing source/build/package/installed Windows acceptance; retained Manager `43c8d71cf` producer and exact original-profile restoration; Linux refresh accepted/published; source included in main a70034880 |
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
Linux item retirement removes both package extracts, both empty native fixtures,
new fixture-installed CLI companions and exact owned bundle copies. Accepted
packages, manuals, source and concise evidence remain. The explicit AppImage
temporary extraction plus normal/root cleanup receipts account for 17,405,161,472 B
of reclaimed local allocation; shared native compiler/dependency baselines stay.
Receipts: `out/oi070-linux-refresh/{cleanup-normal.json,cleanup-root-bundle.json}`.
The two owned frontend Edge fixture profiles are also retired after process/open-file and evidence checks, freeing 23,179,264 allocated B; receipt is `out/oi070-linux-refresh/evidence/frontend-fixture/cleanup.json`. No whole-fleet cleanup claim is made.

Physical results: [installer refresh](../installer-refresh/README.md),
[Agent/Chat runtime](../agent-runtime/README.md), and
`out/code-hygiene-20261009/integration/`. Windows idle sampling is retained in
`out/remaining-acceptance-20261009/idle-sample.json`; it does not measure long-chat
rendering or establish a before/after CPU improvement.
