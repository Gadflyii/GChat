# GChat remediation and code hygiene

Repository: `/ai/gchat`. Subject: `docs/code-hygiene/`. Owner: GChat coordinator.
Reviewed Windows product `0f06ba433` is published on main; Linux packaging
source is `02d369e8a`, with native/frontend compilation at `54c931c68`.
Retired integration branch `dev/gchat-remediation-104d4ec6` remains committed
and pushed; current candidate inventory is below.

## Accepted Linux native CPU attribution correction

The accepted Linux package `7e33222e8` was still verifying and copying bundled
VM/runtime resources during the earlier OI-075 99.8457% native CPU observation.
File descriptors and rising read counters identify this finite work in
`gbot_assets::install_from` and `setup::install_linux_runtimes_from`, also present
in inspected source `e971730fd`. No idle-loop code defect was demonstrated.

Installation completed after 82 seconds. The final six five-second desktop
thread samples averaged 0.2% of one core, maximum 0.4%. This empty-history
follow-up excludes separate Host/Gbot services; it is not a repeated many-message
sample, current-main package qualification, cross-OS comparison or gain claim.
Original raw counters and rendering/traversal evidence remain unchanged.
Wait for installation completion before labelling native counters idle, and
report installation latency separately.

Evidence: `/ai/gchat/out/native-idle-20261014/result.json` and `summary.md`.
Owner GChat; candidate `/ai/gchat-worktrees/native-idle-20261014`, branch
`fix/gchat-native-idle-e971`. The private desktop, Host and Gbot processes are
absent; generated vault entry and extracted resources/state are retired.
Accepted installers remain. No GPU/model, Windows, user history or new dependency.

## Accepted Host, Manager and Chat engineering hygiene (merged 165353e58)

Baseline main `8ca43a14a`; candidate `chore/gchat-engineering-hygiene-20261014`
at `/ai/gchat-worktrees/engineering-hygiene-20261014`. Remove proven unused
direct dependencies and dead assignments, and fix compiler/Clippy warnings
without changing behavior. Check platform-specific uses before removal.
Acceptance: strict Clippy for the three crates and existing affected tests.
CPU only, shared `/ai/gchat/src-tauri/target`; no new dependencies, GPU,
native Windows build, release, signing or publication.
Source ready: removed unused direct dependencies, unreachable proxy fallback,
redundant copies/cfg attributes and historical comments; scoped the test mutex
lexically. Strict Host/Manager all-target and Chat desktop/CLI production Clippy
PASS; existing proxy44 and process-cleanup2 cases PASS. Chat default-feature
all-target check hits the existing CLI-feature fixture error (pending bab6541bf).
The existing worker mock lacks GbotState and cannot bootstrap a real service;
no runtime change or mock-bootstrap workaround is included. Evidence and exact
limitations: `/ai/gchat/out/engineering-hygiene-20261014/result.json`.

## Accepted OI-116 catalog/download resources (merged 8ca43a14a)

Baseline main `7e33222e8`; candidate `fix/gchat-catalog-resources-7e332` at
`/ai/gchat-worktrees/catalog-resources-7e332`. The Host borrows its catalog and
reuses GPU combinations within one snapshot, keyed by platform, GPU name,
compute capability, minimum memory and TP. Reservation changes and catalog
replacement remain fresh; the catalog guard drops before later awaits.

One existing 174-profile/four-CPU-instance snapshot: allocations 29,755→25,632
(13.9% fewer), requested bytes 2,622,891→2,448,907 and peak above initial
2,542,610→2,430,134. Final live bytes are unchanged. Instrumented elapsed
5.527→4.662 ms is one sample, not an established latency or native RSS gain.
Exact catalog/reservations, all GPU eligibility filters, TP1/2/4 choices,
reservation release and catalog replacement PASS; strict Host all-target Clippy
PASS. The focused measurements ran under one second each; no dependency change,
new harness, GPU or native Windows run. Full package hashes and ordered download
journaling retain their accepted source behavior.

Evidence: `/ai/gchat/out/oi116-catalog-20261014/result.json`. Merged clean source
tree is retired; evidence and shared Cargo target `/ai/gchat/src-tauri/target`
remain. No live jobs or model copies.
Source merged; Windows/NAS release qualification remains owed.

## Accepted OI-118 — snapshot ownership (merged f0db75362)

Three owned JSON arrays now move into the final snapshot. Same 174-profile/four-
CPU-instance fixture allocations55,115→29,754; requested peak above initial
4,944,642→2,542,586. One instrumented elapsed12.476→5.599ms, not RSS or concurrency
throughput. Exact catalog/models/reservations/instances and strict Clippy PASS.
Evidence `/ai/gchat/out/oi118-host-idle-20261013/result.json`. Default workers kept;
physical Windows SCM qualification remains owed to the release gate.
The clean/pushed merged source tree is retired; evidence and shared targets remain.

## OI-119 — limited native Linux observation

Accepted source0705f31a6 includes the merged projection/UI fix2ad018261.
One isolated local Host/client, no models/profiles:30s Manager idle0.13% of one
core, privateRSS306.27MiB (WebKit content226.26MiB); Host0.00%,4.52MiB.
This is Linux/WSLg, not a before/after gain or Windows private-commit result.
Source merged `2ad018261`; larger-fleet/remote qualification is release-gated.
Own processes and
private state are retired; accepted binaries remain. No rebuild/model/GPU run.
Evidence: `/ai/gchat/out/oi119-native-idle-20261013/result.json`.

## Accepted OI-116 and OI-118 lifecycle review

Repository `/ai/gchat`, subject `docs/code-hygiene/`, owner GChat coordinator.
Candidate `/ai/gchat-worktrees/review-remaining-712d5718`, branch
`fix/gchat-review-remaining-712d5718`, from merged main `712d57180`.

Deliverable: finish the remaining catalog/download and Host lifecycle review
work together. Preserve the accepted ordered journal, complete package hashes,
fresh all-rank inventory, per-path errors, current credentials and final process
diagnostics. Retain Tokio's default worker count; measure the representative
concurrent control/scan/journal workload before considering a count change.

Acceptance assigned October 11: focused owning cases, strict Clippy and the
OI-118 named representative measurement, due 09:00 UTC. Reuse accepted resource
and native Linux statvfs evidence; do not repeat passing unchanged checks. CPU
only; no GPU/model, native Windows build/run, calibration, release, signing or
publication. Windows SCM and UNC/extended-path physical acceptance belongs to
the scheduled Windows gate and cannot be claimed from Linux evidence.

Selected design: HostProcesses owns activity notification. Register a wait before
checking live-child/pending-exit eligibility under its mutex. Drop the monitor's
timer while inactive, including retained stopped/failed records; successful spawn
wakes it before profile persistence. Active monitoring keeps the existing one-second
cadence and final output/readiness semantics. The separate 30-second inventory
refresh remains unchanged. Suppressing unchanged stopped-record revisions removes
idle snapshot traffic, without suppressing action or final-observation publication.

OI-116 adds an explicitly scan-local canonical payload observation. Descriptor
and direct-entry visibility currently repeat that same header read. One fresh
pass reuses it while independently validating every descriptor declaration;
no metadata cache survives a scan or launch preparation. Actual successful reader
opens/header bytes and exact fresh all-rank output establish the effect. Existing
full-SHA preparation and ordered durability are not replaced.

The ONE representative Linux default-worker measurement overlaps authenticated
snapshot/download/control/Scan/Stop with a durable 100-job Pause write. Its
filtered process uses System allocation with one atomic mode dispatch and no
allocation-accounting spinlock; this avoids distorting management concurrency.
Other allocator fixtures retain their existing tracking in separate processes.
Setup uses synthetic nongpu children; hardware admission and calibration are
outside the measured interval. The production Host hardware owner remains
attached for measured Scan. Socket/TLS transport and daemon maintenance are
excluded. The native counters describe this Linux test process, not Windows SCM
or an installed daemon. Default workers remain unchanged; one observation does
not establish an optimal count.

Product `a7b653a89`, with fixture corrections `f5d88db2f` and `9ff45a2f3`, is
independently reviewed and passes the assigned gate on Ubuntu 24/Rust 1.98:

| Evidence | Result and scope |
| --- | --- |
| Fresh inventory and complete SHA control | PASS; descriptor declarations, rank provenance, missing members and same-size payload corruption remain checked |
| TP1/2/4 shared-header observation | Successful reader opens 7→4, returned header bytes 4,937→2,847, read calls 14→8; identical metadata. CPU ticks were zero at this resolution; no CPU gain claim |
| Actual Host Scan | PASS; per-path errors, stable UUIDs, calibration removal/restoration, descriptor repair and a fresh second pass |
| Launch/readiness/Stop/restart/final diagnostic | PASS; reaped exit7 retains its exact final diagnostic and parks after drain |
| Inactive monitor, 2.201s | Previous timer future polls 4→1 initial poll; no periodic monitor timer while inactive. This is wake/poll evidence, not a native CPU/RSS comparison |
| One concurrent default-worker workload | 198 authenticated routes in 0.979s (202.18 mixed requests/s); observed Scan/read and Pause/read overlap; exact one-write 100-job, 65,001-byte journal and reopened state |
| Strict Host all-target Clippy | PASS, warnings denied |

The scan comparison uses process-wide requested Rust layouts: allocations
172→122 and requested bytes 70,370→42,292, but peak bytes above the initial live
set rise 11,354→12,606. Shared metadata ownership trades a small retained cache
for fewer reads; this does not establish a total memory reduction. Reader
counters measure successful file opens and returned bytes below buffering,
not storage-cache misses or full-payload hashes.

The concurrent fixture uses the production default of 32 Tokio workers,
174 catalog profiles and four public-process-owner CPU children. Of its 198
routes, 64 each read snapshots, download jobs and clients; four Scan, one Pause
and one Stop complete. Snapshot median/sample-p95 are 48.47/67.14ms; download
read 1.869/1.942ms; client read 0.0505/0.0561ms; Scan 68.40/70.33ms. The singleton
Pause takes 5.156ms and Stop 69.824ms; no percentile is inferred from either.
Durations include response-body consumption and exclude request construction
and response JSON decoding. Mixed throughput includes harness/counter work and
is not isolated route capacity or a before/after worker-count comparison.

Native `/proc` samples show 35→36 process threads and private resident bytes
23,920,640→34,959,360 during the workload; user ticks increase by133 and system
ticks by0. The separate two-second loaded-fixture quiescent interval has zero
CPU-tick change, four voluntary context switches across the same35 TIDs and
stable23,646,208 private resident bytes. Active matched35 TIDs add89 voluntary
and3 involuntary switches; one new TID is reported separately. These are
endpoint samples, excluding child memory and peak/private-commit claims.

Evidence and inventory: `/ai/gchat/out/review-remaining-20261011/` contains
`result.json`, owning logs, `concurrent-summary.json`, accepted
`ginfer_host-tests-9ff45a2f3` and resource-return proof. The four passing cases
on `f5d88db2f` are reused after the native-fixture-only setup correction; only
the previously unrun measurement and strict Clippy execute on `9ff45a2f3`.
Shared Cargo caches and prior accepted resource/statvfs evidence remain.
The accepted candidate is merged and its working tree retired.
The gate ends06:54:20 UTC; its container is absent, the canonical build guard
is reacquired/released and CPU446 canceled06:56:53. No model, job, booking or
guard remains. Private fixture state and CPU children end with the passing case.

Two runner preflights stopped before compilation on absent Git metadata and
container/worktree ownership. Read-only owning mounts and a command-local
trusted alias correct both without global Git changes. The first compile
stopped on an ambiguous slice index and an unused retained TempDir binding;
explicit `usize` and `_dir` fix those. The initial native fixture then stopped
before measurement because its CPU child lacked a native profiling CLI.
Its setup now creates the synthetic public process owner separately from
hardware admission and reattaches the actual hardware owner before measured
Scan. Production admission is unchanged. Failure logs remain alongside accepted
results; no failed setup is counted as measurement or qualification.

Physical Windows
SCM/worker/UNC-path acceptance and prior OI-121 slow-NAS launch/hash latency
remain release-gate obligations. No additional model qualification or count
change follows from this Linux gate.

## Accepted WSL model placement

Repository `/ai/gchat`, subject `docs/code-hygiene/`, owner GChat coordinator.
Candidate `/ai/gchat-worktrees/wsl-model-placement-c4ddb0`, branch
`fix/gchat-wsl-model-placement-c4ddb0`, from merged main `c4ddb0a6d`.

Deliverable: installer/downloader place managed model artifacts on the Linux
filesystem under WSL, with coherent model discovery and launch paths. The
retained OI-144-9P same-engine/artifact/profile comparison is 42.259s Ready from
ext4 versus 237.278s from E:9p. Approximately 94% of that gap is attributed to
nonoverlapping materialization stages; no engine reader change is selected.
The current task owns storage placement, not a new performance campaign.

Acceptance assigned by bubbs: focused placement/installer/downloader fixtures
and one actual Linux run; deadline 08:00 UTC. No model/GPU, native Windows
build/run, full calibration, release, signing or publication. Preserve existing
model data and user configuration; do not silently copy or delete large existing
artifacts. Before source changes, read the master rows for actual downloader,
installer and model-root files and fold overlapping review findings. Selected design: one Host-owned resolver detects WSL and the actual filesystem
of the requested root. Implicit 9p roots redirect new managed writes to a native
XDG/HOME root namespaced by the canonical original root. Explicit Windows-backed
storage and resuming its old jobs refuse with an actionable message. Existing
artifacts, journals and partials remain unchanged. New manifests stay beside their
artifacts and use absolute paths outside the saved app data folder. A shared native
catalog supplies desktop and CLI discovery across selected, original and installed
job roots; Host scanning includes them. Ordinary download containment remains intact.

Verification: product `e05195afe` passes 14 focused extension cases and 10 Rust
cases (two Host, two catalog/import, five downloader and one CLI transfer), plus
the extension bundle and strict Host Clippy. `b65e8eb03` removes the one needless
borrow caught by strict app Clippy; that failed check and the pending CLI build
then pass. Behavior-identical code keeps the previous passing fixture evidence;
no passing case is rerun. The first runner stop was an incorrect cached bundler
entrypoint, corrected from its installed package manifest before native work.

The admitted transfer uses an actual private Windows-mounted 9p data folder and
native Linux XDG root. A 24-byte loopback payload, its partial and its manifest
land on native storage. The compiled CLI lists that model and the retained
legacy model together, preserving the original partial, artifact and saved
custom-folder settings. This tests placement/discovery; it makes no new engine
startup-performance or model/hardware qualification claim. No GPU/model or
native Windows work runs. Windows runtime acceptance belongs to its release gate.

Evidence and owned inventory: `/ai/gchat/out/wsl-model-placement-20261011/`
contains `result.json`, focused/bundle/Clippy logs, the accepted
`gchat-cli-b65e8eb03`, extension bundle and resource-return/fixture-cleanup
receipts. Only the tiny private fixture folders are removed after zero live
references; 12,288 native allocated bytes are reclaimed. Existing user models,
profiles, state and shared caches are untouched. CPU booking441 is canceled at
actual completion06:27 UTC; the canonical build guard is reacquired/released and
the owned container is absent. The source branch is committed and pushed;
source is merged on main `712d57180`. The clean, pushed candidate is retired
after ancestry and zero-live-reference checks; 278,093,824 allocated source
bytes are reclaimed and shared caches preserved (`worktree-retirement.json`).

Master overlap audit: OI-116 journal/hash/free-space and managed-root dedup,
OI-118 Host lifecycle and OI-102 full-hash preparation remain intact. The current
GCHAT-WSL-MODEL-PLACEMENT row holds this source/gate result; the independently
closed OI-144-9P loader disposition is not reopened. Its retained evidence is
`/ai/kernel-agent/run_workdir/local/direct-read-wake-670d1c68a/evidence/oi144-9p/README.md`.

Completed: reviewed main integration and candidate retirement. Accepted binaries
and evidence are retained. No release,
signing, publication, existing-model relocation or further qualification is owed
to this assigned item.

## Accepted CLI configuration selection

Deliverable: generic CLI commands use the same desktop/installer configuration
selector and saved data folder. Reading configuration creates no competing
`gchat` root. Existing desktop precedence, valid custom folders and default
fallback stay intact on Linux and Windows. Models, model lookup, runtime
discovery, downloads and server-state paths all consume that one resolver.

Candidate `/ai/gchat-worktrees/cli-config-selection-b55`, branch
`fix/gchat-cli-config-b55`, from merged main `b55f1f73f`. Product source
`8d4602951` is committed/pushed and independently accepted. The build script
emits the owning bundle identifier, including an explicit Tauri override;
headless callers delegate to the existing desktop/installer selector. The
superseded root creation and internal legacy resolver names are removed.
Master CLI/resolver and OI115–119 rows were read before implementation: the
latter concern Host/Manager owners and do not overlap these app/CLI modules.

The assigned gate passes on Linux, actual 05:48:54–05:50:05 UTC:

- Exact CLI/resolver fixture: 1/1 PASS, 598 cases unselected; 0.01s execution.
  Current custom storage, actual model/runtime discovery and server-state paths,
  existing XDG-config selection, malformed-config fallback, saved bytes and
  absent competing roots are covered in an isolated subprocess.
- CLI build: PASS; 14.96s after the 54.95s fixture build; no emitted warnings/errors.
- One native `models list --json` against private custom-folder metadata: PASS.
  The expected fixture model is returned, saved configuration bytes are unchanged
  and neither competing legacy root is created. No model is loaded.

Evidence: `/ai/gchat/out/cli-config-selection-20261011/` (`gate.log`,
`result.json`, `custom-folder.stdout/stderr`). The tested binary
`gchat-cli-8d4602951` is retained as the accepted CLI baseline; private fixture
metadata is disposable. Source is merged and pushed on main `c4ddb0a6d`; the clean/pushed CLI
worktree is retired after its accepted ancestry and zero live consumers are verified. Shared Cargo/toolchain caches are retained. No native Windows build/run,
GPU/model, release, signing or publication was part of this gate.

The local disk hold deferred waiting schedulers before any compiler/test ran.
One early handoff preflight was blocked by another already-active compile;
canonical fd/inode proof identified its owner, which returned a finite actual
END. These are resource deferrals, not code/test failures. The sole executing
gate then passed; its container is absent, canonical build guard reacquired
and released, and booking 435 canceled at actual completion. Waiting receipts
are preserved, and future execution verifies the live guard rather than relying
on an earlier release notice. No passing check was repeated.

## Accepted OI-076 warning diagnostics

Deliverable: make the existing context/format warning self-diagnosing without
changing admission, classification, message conversion or UI behavior. The
October 11 decision authorizes existing app.log records with the exact trigger,
context/token counts and format decision, plus one focused fixture. No new
logging mechanism, dependency, model run or retrospective cause claim.

Baseline main `d9b802e4c`; source candidate
`/ai/gchat-worktrees/oi076-evidence-d9b`, branch
`fix/gchat-oi076-diagnostics-d9b`, retains docs-only audit `3c75ba505`.
Existing evidence remains in `/ai/gchat/out/agent-recovery-20261001/`.
[Diagnostic preservation](../agent-runtime/remaining-acceptance.md#original-diagnostic-preservation)
owns the missing original event and bounded source audit. Product `49759ad5b`,
IPC fixture correction `fb43a1734` and original-error hook `6a9fd25e0` now log
completion, request-context and message-format decisions through the existing
native app.log target. Input/output counts are current or null; request policy
and loaded capacity are recorded when available. Completion records keep the
actual comparison capacity and current usage; unavailable loaded/reserve counts
remain null rather than using earlier request metadata. Arbitrary error bodies,
prompt and tool contents are excluded from the added record.

The one named transport fixture passes 1/1, with 21 cases unselected, in 0.912s
on the final source. It exercises unchanged structured/raw returned errors,
real SDK ModelMessage rejection, fresh versus unavailable token counts, exact
completion triggers and error-content omission. Evidence:
`/ai/gchat/out/oi076-warning-diagnostics-20261011/fixture-owner-hook.log`.
Source review accepts unchanged warning/stream behavior. No model, native build,
installed replay or broad suite ran; this is diagnostic verification.

The first fixture stopped at an unsupported ESM export spy; it now uses the
existing Tauri IPC mock. The corrected attempt found that the SDK replays the
UI error formatter. Logging moved to its original failure event, preserving
the SDK's console output and formatter. Both failed logs remain in the same
evidence folder; neither passing check was repeated. The injected SDK failures
still produce expected console errors, including test sentinels; the new native
records omit them. OI-076 diagnostics are merged on main `36ac89441`, waiting for the next
occurrence. The source tree was retired; Git and saved evidence are retained.

## Accepted short formatted Chat replies

Deliverable: remove the renderer's under32-character plain-text bypass so short
formatted replies use the same supported Markdown/plugin path as long replies.
Baseline is accepted main `8a0e89a3a`; OI105 and native Linux free space are merged.
Acceptance named by coordinator: one focused real-renderer regression and one
visible browser rendering check, CPU only, deadline06:00 UTC. No native package,
model/GPU, release, signing or publication.

Implemented in `f6f9dccc6`: remove the24-line bypass and its unused math
predicate. Short replies use the same normalized Markdown/plugin path as long
replies; plain short text also follows its paragraph/whitespace semantics. The
exact CJK reproducer passes1/1 (23cases unselected). One native Edge browser
render of the actual source component passes exact DOM checks and visual image
inspection, GPU disabled. The screenshot shows bold and struck-out text with
no literal formatting markers. Evidence: /ai/gchat/out/short-markdown-20261011/
{fixture.log,render.png,browser.stdout.log,launch.json}.

PowerShell's Process.ExitCode was null, so the wrapper reported failure even
though completed DOM/screenshot were PASS. No zero exit code is claimed; the
future capture checks actual output and only a known nonzero exit code. Edge
internals emitted task-manager/page-metrics stderr diagnostics; this is not a
GChat console-clean claim. A quoted CIM query failed before reading; corrected
owned-profile filtering verifies browser absence. The server is stopped and
disposable browser profile removed; logs/image remain. Vite's stale
baseline-browser-mapping warning is recorded separately without upgrading an
unrelated dependency. No unchanged passing gate was repeated.

Merged on main `d9b802e4c`. Preserve the
accepted dependencies and all plugin capabilities. Owned candidate
`/ai/gchat-worktrees/short-markdown-8a0`, branch `fix/gchat-short-markdown-8a0`,
no live job. Reuse source-identical core output and the accepted physical graph
from `/ai/gchat-worktrees/oi105-cjk-metadata-2ad` as a read-only baseline.

The superseded resource candidate, original test control and OI116 source trees
were removed through matching-owner no-force Git after clean/pushed/no-consumer
checks and accepted OI105 merge:833,568,768 allocated source bytes removed.
Branch refs and evidence stay retained; shared caches are untouched. See
`/ai/gchat/out/review-resources-20261011/disk-resource-lifecycle-review.md`.


## Accepted OI-105 dependency graph

Deliverable: complete the release dependency graph from accepted GChat main
`2ad018261`, retaining the accepted React/SDK/parser/Vitest alignment and CJK
rendering. Correct missing dependencies at the external package that consumes
them; peer validation must remain active. Acceptance is a clean actual root peer
graph, an offline immutable install of the changed graph, and one representative
CJK rendering check. Reuse earlier extension/UI/alignment evidence for unchanged
packages; no release build, native installation, GPU, signing or publication.

The package and cached Yarn4.5.3 audit confirms exact-selector dependency
extensions add the missing providers without changing peer declarations. The
children require unified^11 and micromark^4, already locked to11.0.5/4.0.2. This
corrects provider metadata; it is not evidence of a runtime import failure.
Source `8138349f9` supplies the three missing providers through the existing
`.yarnrc.yml`; fixture correction `598a8c59f` exercises the real full Chat
renderer. The actual root graph passes all368 peer groups (previously3 unmet).
Offline immutable installation succeeds in18s with no peer warning; both
lockfiles, all versions/checksums and package manifests remain unchanged. The
real CJK punctuation-adjacent emphasis/strikethrough case passes1/1 (23cases
unselected), and explicit test-file ESLint passes with zero warnings. Existing
React/SDK/parser/Vitest and unchanged extension-graph acceptance is retained.

The first rendering attempt lacked generated core output. Core source is
identical to the accepted oi074 source, so its accepted generated package was
reused rather than rebuilt. The first short input bypassed parsing below32
characters and the default strong renderer uses a styled span; the fixture now
uses a representative longer reply and its real output. The short-message
formatting defect is separately listed as GCHAT-SHORT-MARKDOWN-BYPASS. Normal
ESLint ignores tests; the corrected explicit --no-ignore invocation checks the
file, without suppressing warnings. Earlier failed/setup logs remain evidence.

Normal Windows source staging copies this root config and Linux runs its root
immutable install. The retained OI070 custom runner skips installs and mounts an
older physical graph: it must use a graph qualified against this config before
its next build. No native packaging is claimed. Merged on main `8a0e89a3a`.

Owned candidate: `/ai/gchat-worktrees/oi105-cjk-metadata-2ad`, branch
`fix/gchat-oi105-cjk-metadata-2ad`, baseline `2ad018261`, no live job. Retain the
accepted physical graph and previous receipts in
`/ai/gchat-worktrees/oi074-frontend-packages` for reuse; do not relink shared state.
New concise evidence belongs in `/ai/gchat/out/oi105-cjk-metadata-20261011/`.



## Accepted OI-116 Linux available disk space

GChat main `2ad018261` contains the accepted resource review. The coordinator
approved Linux-only rustix 1.1.4 statvfs on October 11: preserve raw path/error
behavior, isolate the blocking query, check available-byte multiplication, and
remove the subprocess. This uses an already locked/cached crate; Windows and
other supported OS behavior remain unchanged. Acceptance is the focused
available-space regression and Host strict Clippy, CPU only. No native app, GPU,
release, signing or publication.

Implemented in `da85b9adf`. The focused raw-path/symlink/missing/NUL/empty-path
fixture passes (1/1), and Host all-target strict Clippy passes with zero warnings
on the offline Ubuntu 24/Rust 1.98 toolchain. Evidence:
`/ai/gchat/out/review-resources-20261011/oi116-native-space/{path-fixture,clippy}.log`.
No new crate version or package download was required. Source is incorporated
in accepted main `8a0e89a3a`. The clean/pushed source tree
`/ai/gchat-worktrees/oi116-native-space-2ad` is retired; its branch,
`fix/gchat-oi116-native-space-2ad`, target cache and concise evidence remain.
The current OI-118 section above records the completed representative workload
and unchanged default workers.


## Current outcome and acceptance

The active October 11 work below supersedes the completed remediation gates.
The sole issue authority is GInfer `docs/maintainer/open-work.md`;
[remaining acceptance](../agent-runtime/remaining-acceptance.md) records physical
prerequisites. Preserve skills, permissions, cancellation, context semantics,
host identity, user state, models and supported protocols.

## Accepted serving and Host/Manager resource fixes — October 11

Ron/bubbs assigned OI-115–119 and C1-CORE-021 at 01:11 UTC, due 04:00 UTC.
Deliver clear ownership improvements and one focused before/after request or
catalog-pass measurement for each changed behavior. Preserve exact stream/tail
output, model/session identity, limits, constant-time authentication, complete
hashes, journal durability and cross-client freshness. No model/GPU, native
Windows build, installer, release, signing or policy/limit change is in this
GChat gate. Dependency changes require a separate decision.

Candidate `/ai/gchat-worktrees/review-resources-72cd`, branch
`perf/gchat-review-resources-72cd`, baseline main `72cd661bf`. Production fixes
are in `d3463459d`, warning fixes in `fed89a83f`, test-only heap attribution in
`5aae3604d`, and the final forwarding simplification in `f51816632`. Root owns
integration, measurements and master updates; all eight disjoint owners are
frozen. Independent reviews accept the stream, credential, registry, inventory,
lifecycle, service, native Manager and UI changes, including per-path inventory
errors and Stop-during-exit-drain diagnostic ownership.

Original-source fixtures at
`/ai/gchat-worktrees/review-resources-baseline-72cd`, branch
`test/gchat-review-resources-baseline-72cd`, retain original main production with
test additions and extraction-only helpers called by production. Measurements
use original `da3cf4cd9` and candidate `fed89a83f`, the same Rust 1.98/debug
profile and accepted offline Ubuntu 24 toolchain, CPU16–31. Retain both sources
through acceptance (now retired), keeping shared Cargo/frontend caches and evidence at
`/ai/gchat/out/review-resources-20261011/gate400/`. No model copies or separate
build directories were allocated.

### Measured scope

Each row is one owning CPU fixture, not a model-throughput or native idle claim.
Allocation bytes are requested Rust allocator bytes, not RSS/private memory.

| Owning operation | Original → candidate | Observable control |
| --- | --- | --- |
| 8 KiB SSE in one-byte fragments | 352 → 0.669 ms; 50 → 34 allocations | Exact events and malformed-frame errors |
| Snapshot action during 500 ms exit-reader gate | 501 → 0.121 ms | Final diagnostics, cancellation and replacement session |
| Noisy 65,537-byte child tail | 173,096 → 128,704 requested bytes | Exact retained 16 KiB and echo behavior |
| Four-field response handle | 3 → 2 allocations; 88 → 24 requested bytes | Handle shape and identity |
| Whole authenticated loopback request | 64 → 64 allocations; 173 → 171 microseconds | No demonstrated gain; constant-time/session/CORS controls retained |
| One fresh managed scan with duplicate paths | 194 → 143 allocations; 73,417 → 30,217 requested bytes | Fresh inventory and distinct raw-path errors |
| 174-profile/4-instance snapshot | 54,582 → 52,304 allocations; 8.57 → 8.61 ms | Exact profiles/reservations; no wall-time gain |
| Two withheld request streams | 7 → 3 drain polls; final release 14.6 → 0.556 ms | Same force behavior and 30-second deadline |
| One journal write plus complete 4,194,335-byte SHA | Unrelated task's maximum gap 12.9 → 2.13 ms; requested bytes 2,110,481 → 1,060,276 | Same full SHA, durable 603-byte journal and retry/cancellation controls |
| Fresh 174-profile/8-GPU catalog pass | 219,078 → 207,887 allocations; thread CPU 239 → 216 ms | Identical 6,148 choices; read bytes/calls unchanged; opens unmeasured |
| Unchanged real TLS catalog read | 1 → 0 atomic registry replacements; 1,293 → 0 published bytes | Fresh durable comparison, pins and failed-write retry |
| 174-profile launcher availability | 979 → 33.8 microseconds | Exact occupied-GPU availability |
| Five delayed bootstrap attempts | 5 → 1 client constructions/TLS connections; state opens remain 5 | Fresh authority rotation and existing retry bounds |
| One empty-host monitor pass | Revision changes 1 → 0 | Timer still wakes each second; no eliminated-wakeup claim |
| Native Manager projection, 8 hosts × 174 profiles | 71,051 → 16,026 allocations; thread CPU 18.5 → 12.9 ms; requested bytes 10,121,110 → 3,904,775 | Exactly equal 313,340-byte serialized snapshot |
| Paired-client UI activity refresh in JSDOM | 134 → 0 created elements; 1 → 0 root replacements/storage writes; 135 → 0 flatten calls | Current labels, latest action guards, focus and visibility |

The 1 MiB forwarding fixture passes a prepared Request directly to the Host
route and consumes the response. Its interval includes the same-process mock
upstream; inbound HTTP/request construction is excluded. With the identical new
live-allocation helper, original `4016165eb` versus final production `f51816632`
measures 170 → 171 allocations, 11,335,566 → 11,335,702 requested bytes, and
3,857,403 → 3,857,539 peak bytes above start: no demonstrated gain. The counter
covers process-wide requested Rust allocation layouts, excluding native memory,
allocator overhead and OS RSS; it does not isolate Host heap. The single-chunk
input also cannot demonstrate fragmented-body growth savings. Early raw-buffer
release remains explicit lifetime cleanup. Reqwest already synchronously owns
JSON serialization; the redundant manual path was removed.

### Verification and next action

Valid candidate gates: 16 resource fixtures, 60 focused correctness controls and
12 Manager UI cases pass. Original runs execute the corresponding 16 resource
fixtures and one original UI case; three candidate-only UI cases are explicitly
skipped. Host/Manager all-target check and strict Clippy, plus focused JavaScript
lint, pass with zero warnings at `fed89a83f`. Snapshot byte equality passes.
The final one-body fixture passes at `f51816632`, and Host/Manager all-target
strict Clippy passes again after the forwarding/helper changes, zero warnings.
Evidence: `candidate/{body-final,host-clippy-final,manager-clippy-final}.log`.
No full suite or installed/native Windows acceptance is claimed.

The first candidate attempt accidentally reused the original Cargo binary at a
shared absolute source alias. Its results are invalidated and retained only in
`candidate-stale-binary/`. Advancing the owning source timestamp forces rustc to
read the actual source on each switch; candidate compilation and its distinct
105-test inventory were verified before accepting measurements. Setup/fixture
failures are corrected in the owning scripts/source, without warning suppression.

CPU booking400 ended before 02:04 UTC and is cancelled. Early final admission
returned75 before any compile/test while C2 held the canonical build guard.
After that reservation cleared, ordinary CPU16–31 admission completed the final
fixture and lint by 02:33:31 UTC; its container exited0 and is absent. The unused
02:45–02:50 fallback booking404 is cancelled. No GChat job, guard holder or waiter
remains. This source merged to GChat main `2ad018261`; the C1-owned served
smoke remains scheduled. No passing unchanged check was repeated.

OI-116 now replaces Linux `df` with the approved locked rustix 1.1.4 native
query, as verified above. Windows uses its native API; the physical
UNC/extended-path check remains unrun. The coordinator kept default Tokio
workers for OI-118; the current section above completes the representative
concurrent control/scan/journal measurement without changing that count. Native SCM,
Manager idle/private bytes, media peak memory and slow-NAS qualification are not
established by this CPU gate. These limits remain explicit on the master rows.

C1-CORE-021 is signed/merged as GInfer dev/next `7af8f6114`. Strict original and
candidate owning tests pass; one near-capacity put allocations 21,228 → 16,
requested bytes 6,430,400 → 3,288 and total wall 4.832 ms → 3.330 microseconds.
The post-merge owning fixture passes on the source-identical accepted binary.
The served continuation chain is assigned to C1's post-merge smoke on merged
dev/next `9b7d10cdd` (contains `7af8f6114`), Ada4090 after 03:10 UTC. GChat takes
no additional live action or build; C1's result is pending. Its separate authority is
`/ai/ginfer-worktrees/response-store-review-20261011/docs/response-store/README.md`.

### Owned disk and job inventory

Retire superseded resource source/control trees after accepted main merges; keep
ResponseStore source and small accepted binaries,
shared build/dependency caches, every cited evidence packet, models, profiles,
user state and release artifacts. October 11 remote hygiene verified S1, S2,
Ada4090 and laptop reachable, with no own retirement candidate. Four clean,
merged and pushed local historical source trees are retired after exact live-use
and shared-cache checks: 1,154,691,072 allocated bytes removed. Their branch refs
and external evidence stay. Matching-owner no-force Git removal fixes the
root-output permission failures; no ignored shared-cache symlink is followed.
Receipts: `out/review-resources-20261011/disk-{local,remote}-survey.md` and the
coordinated `/ai/coordination/disk-hygiene-20261011/GChat.md`. No fleet-wide
cleanliness or current native artifact-size claim is made.

## Accepted Host/Manager bug fixes — October 10

The Host/Manager review was merged and pushed as main `0dd5d45ce`. The master
rows are merged in GInfer dev/next `c72edea85`. Ron's next instruction is to fix
OI-111–114 one at a time with short existing-fixture loops, then retire owned
disposable outputs. Deadline: October 10 02:00 UTC; OI-111–114 completed before
it. The repairs use
`fix/gchat-host-review-bugs-0dd5d45c` at
`/ai/gchat-worktrees/fix-host-review-bugs-0dd5d45c`, originally from main
`0dd5d45ce`, reusing each accepted baseline without recreating the tree.
OI-111 is fixed and published separately on main `839d247b0`. The owning
fixture reproduces saved stopped profiles after restart; marking persistence
dirty under the data mutex passes normal removal/restart and failed `host.json`
write/retry. Independent review accepts concurrency ordering and unrelated
profiles/UUID mappings. `make verify -o verify-fast` passes desktop553/adapter6/
Host87/Manager/hardware12/utility29; the unchanged accepted frontend gate is
reused. Strict Host all-target Clippy passes with warnings denied. Evidence:
`out/code-hygiene-20261009/host-review-bugs-0dd5d45c/oi111-{baseline,first-fix,verify-rust,clippy}.log`.
OI-112 baseline is reproduced: immediate reconciliation rejects a successfully
renamed snapshot because its revision did not advance. The candidate increments
revision only after successful publication while holding the data mutex. The
owning fixture passes both immediate successful reconciliation and failed-write
name/revision preservation; all three LAN tests, five registry tests and strict
Host all-target Clippy pass. Evidence: the same packet
`oi112-{baseline,lan-tests,registry-tests,clippy}.log`. Independent review
accepts the sharing/data lock order and failed publication rollback. This item
is merged/pushed separately on main `96ba41019`.
OI-113 baseline deterministically admits one HTTP request after successful
Pause. The candidate claims queued jobs under the jobs mutex before filesystem
waits and client construction; nonqueued jobs exit successfully without transfer,
so only admitted errors reach the existing worker failure completion. Independent
review rejected an unnecessary completion guard that hid failed installation
journal writes; it is removed, preserving the existing failure behavior. No extra admission write is needed:
queued/downloading both recover paused, while Pause and existing progress updates
already save their states. The owning no-HTTP regression, real worker Pause before/
after admission with retained bytes and Resume, and all 13 download tests pass.
Strict Host all-target Clippy passes on the corrected source. Independent
final review accepts admission/worker ownership, recovery and deterministic
fixture cleanup. Evidence: `oi113-baseline.log` and
`oi113-final-{download-tests,clippy}.log` in the same packet. This item is ready
and is merged/pushed separately on main `893682288`.
OI-114 baseline reproduces the post-commit error using two real TLS Hosts,
a paired Client/Vault and a gate on the member authority response. Canonical
snapshot and the durable local cache agree before invalidating only the owned
registry. The candidate contains the later registry-read failure, returns the
committed snapshot, and uses only fresh successful registrations for membership
delivery. Restoring the exact registry lets the next real read deliver the
missing membership at the committed revision. All three fleet-client tests and
strict Host all-target Clippy pass. Independent review accepts the boundary,
fresh pins, unchanged pre-commit/cache-save errors and fixture cleanup. Evidence:
`oi114-{baseline,fleet-client-tests,clippy}.log` in the same packet. The fix is
merged/pushed separately on main `43edbcf95`. The composed Rust gate passes at actual END00:55:22Z
(exit0, desktop553/adapter6/Host91/Manager/hardware12/utility29), with the
unchanged accepted frontend gate reused. Evidence: `oi114-verify-rust.log`.
The gate ran early after the preceding exclusive owner released its booking;
the unused 01:05–01:08 booking is cancelled and the build guard is released.
Owned hygiene finds no further safe stale removal. The same candidate served
ordered OI-120–122; source history, external evidence
and shared builds remain retained through candidate retirement.
No installed-app or package refresh is claimed for these source fixes.

Contrary review found three distinct baseline defects: closed-set aliases
survive raw-payload removal (OI-120); an invalidating rescan loses active alias
protection (OI-121); a download-journal failure after physical deletion skips
profile cleanup (OI-122). Ron approved separate rows and ordered fixes after
OI-112–114, before feature work. The original dependency and regression
proposals are retained in
`out/code-hygiene-20261009/host-review-bugs-0dd5d45c/`; all three now have
separate owning reproductions and verified fixes below. They are not covered by
the narrow OI-111 pass. OI-120 reproduces removal of
all TP1/TP2/TP4 descriptor aliases and rejection of an active alias using the
existing managed-download fixture, then fix and verify durable cleanup while
preserving unrelated/offline profiles and UUID mappings. Tests are prepared
against `43edbcf95`. Both owning cases reproduce the defect: live aliases remain
after deletion and a Starting alias permits deletion (HTTP200 instead of400).
Independent design review accepts canonical member paths captured during complete
closed-set validation, then exact descriptor-path/degree-ID closure for removal.
This avoids reading unrelated offline sets during deletion and preserves UUIDs.
The applied source is independently accepted; all 70 Host library tests and
strict Host all-target Clippy pass, including both owning regressions. Evidence:
`oi120-{baseline,host-lib-tests,clippy}.log` in the same packet. The final
composed Rust gate passes at actual END01:06:10Z (exit0,
desktop553/adapter6/Host93/Manager/hardware12/utility29); unchanged accepted
frontend evidence is reused. Evidence: `oi120-verify-rust.log`. The build guard
is released. This item is merged/pushed separately on main `d4303f976`.
OI-121 is fixed and independently accepted. Baseline `d4303f976` reproduces
lost active protection after missing-sibling rescan and descriptor rewrite
(3PASS/2FAIL, END01:21:55Z; `oi121-baseline.log`). Each launched process now
owns immutable canonical dependencies from one fresh complete validation;
selected metadata and qualification hash use that same result. Active profiles
survive unrelated deletion. Current model UUIDs govern stopped cleanup;
historical dependencies supplement it only for missing model UUIDs and a
successfully published launch generation. Failed replacement restores the old
profile without granting the new generation cleanup authority. Private facts
stay out of JSON; obsolete validation wrappers are removed.
Independent review caught a healthy stopped alias redirected A-to-B being pruned
by the first candidate. The owning control reproduces profile=null after removing
A (0PASS/1FAIL, END01:37:27Z; `oi121-stopped-rewrite-baseline.log`). Restricting
historical cleanup to missing model UUIDs fixes it. All 74 Host library tests,
strict all-target Clippy and final composed Rust checks pass (desktop553/
adapter6/Host97/Manager0/hardware12/utility29, existing desktop7/Host3 live tests
ignored), actual END01:40:08Z. Evidence: `oi121-final-{host-lib-tests,clippy,verify-rust}.log`;
unchanged accepted frontend evidence is reused. The rejected first gate is not
winner evidence. No check process or build guard remains.
C2's granted 01:30–01:40 startup interval was respected. Its actual early
END01:36:16Z, cancelled300, empty NVML list and free canonical guard permitted
the resumed CPU-only check. Booking294 covered the final CPU gates and is
cancelled at actual END01:50:05Z;
the proposed extension was not needed.
OI-121 is published on clean main/origin `155c61f34`. OI-122 is fixed and
independently accepted. Its owning managed 4 KiB package/descriptor fixture
reproduces physical
deletion and empty in-memory jobs with raw/alias profiles still saved
(0PASS/1FAIL, END01:43:24Z; `oi122-baseline.log`). The selected boundary returns
an explicit completed-deletion outcome with any journal error, then always runs
exact profile cleanup and Host persistence before reporting that error.
ModelDownloads owns a pending journal write, retried under its jobs mutex by
existing scans; successful persistence alone clears it. Host and download saves
are attempted independently, retaining both errors when both fail. Acceptance
requires immediate profile cleanup and repaired I/O plus scan/reopen to preserve
the deleted state. Exit before successful journal retry does not imply crash-
atomic journal durability. No blanket pruning of missing/offline state or new
serialized deletion intent is introduced. The corrected source passes all 75
Host library tests and strict all-target
Clippy at actual END01:48:23Z; the owning test also verifies immediate registry
reconciliation while the journal fault remains, then repaired scan/reopen
recovery. Independent production and fixture review accepts the winner. Final
composed
Rust verification passes at actual END01:50:05Z (exit0, desktop553/adapter6/
Host98/Manager0/hardware12/utility29; existing desktop7/Host3 live tests ignored),
reusing unchanged accepted frontend evidence. Evidence:
`oi122-{host-lib-tests,clippy,verify-rust}.log`. No owned check process, GPU/model
or build guard remains. Publish this source and master row, then retire the
completed owned candidate; its branch/history and external evidence remain.
OI-115–119 remain parked for speed work.
No user models/state, GPU/model run, installer rebuild, inference controls or
performance change is needed. Compile only in admitted quiet intervals. CPU-only booking291 was released
after focused checks; subsequent gates used admitted quiet intervals. All
owned checks and the canonical build guard ended at01:50:05Z; booking294 is
cancelled and no extension or GPU reservation is needed. OI-115–119 remain the unmeasured speed-phase list; OI-072
remains separate with C2. The candidate reuses nine dependency aliases from the
retained OI-074 physical graph and the shared `/ai/gchat/src-tauri/target`; no
new dependency installation or model copy is created.

## Accepted October 9 remediation state

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

## Web-test diagnostic fixtures

Current item: `GCHAT-WEB-TEST-DIAGNOSTICS` in the sole GInfer master list.
The owned `fix/gchat-web-warning-8440` candidate at
`/ai/gchat-worktrees/web-warning-8440` starts from main `8440b5f7a` and ports
the accepted test-only changes from `418d6d07d`. The current Engines fixture
keeps its newer structured-output and Host-KV cases. Outcome: settle actual
asynchronous publications, unmount before resetting subscriber dependencies,
and supply accessible dialog and file-local highlighter/native-preview
boundaries. Acceptance is the existing smallest changed-case selector with
observable assertions and captured diagnostics; no full-suite warning-free
claim follows from this focused check.

Historical baseline and source-review evidence remain in
`out/remaining-acceptance-20261009/oi068-windows-20261010/`, particularly
`web-test-hygiene-source-399b.json` and
`build-369-terminal-2684-r3/output/make-verify.log`. The retained gate passed
while emitting 118 React act, one dialog-description, one native-preview and
four Shiki URL diagnostics. The existing focused selector includes the five
formerly unattributed HtmlArtifact warnings and an unchanged deferred-highlight
cancellation control. Their current result is recorded below; historical
full-suite source-only Shiki attribution remains outside this focused evidence.

The first existing selector ran 26 cases (88 filtered) in 13 files: 24 passed,
two highlighter completion assertions failed. Its retained log is
`out/gchat-open-items-20261012/web-warning-focused.log`. The only diagnostics
were one Shiki invalid asset URL and five HtmlArtifact act warnings. A
pre-resolution attempt did not repair the lazy mock boundary; the disclosure
fixtures now mock the owning CodeBlock/highlightCode boundary directly, preserving
escaped source and asynchronous multiline publication. The independent real
CodeBlock cancellation case passed in the first selector. HtmlArtifact's real
initial about:blank iframe load publishes state asynchronously; its owning cases
now render with RTL's synchronous act and await that actual event inside async
act. An initial nested render deferred DOM commit and failed before the iframe
existed; the corrected fixture registers its listener after RTL's committed render.
Both failed logs remain retained; no failed attempt counts as acceptance.

The final affected-case rerun passes all seven cases in three files (four
filtered) in 1.24 seconds, with no stderr, act, dialog, IPC or Shiki diagnostics.
It ended October 12 at 20:06:31 UTC. Combined with the first run's unchanged
passing cases, all 26 assigned cases have passing evidence; the five HTML cases
were rerun because their fixture changed. Log:
`out/gchat-open-items-20261012/web-warning-focused-final.log`.
Both runs used Vitest 3.2.4/jsdom on Ron-9950X3D2, assigned CPUs 0–31,
`--maxWorkers=2 --minWorkers=1`, within coordinator booking 563. CPU and
shared-cache use are released. No build or live job exists. Shared dependencies
are symlinked from `/ai/gchat`; no installation or dependency change was needed.
No production changes, warning suppression, full-suite run, Windows/GPU/native
app actions or release occurred. This establishes focused fixture cleanup,
not a warning-free full suite or real Shiki WASM/browser qualification.
Next action: review the pushed branch for main integration. Handoff:
`out/gchat-open-items-20261012/web-warning-note.md`.
Candidate source (270 MiB) and new concise evidence remain retained through
reviewed merge; the earlier candidate and evidence are preserved.

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
Project-owned alignment remains accepted. The three CJK parent metadata gaps
are now corrected by exact-version dependency extensions; all368 root peer
groups pass, without widening peer ranges or suppressing warnings. Production output
retains lazy terminal/emoji/highlighter/Mermaid/locale loading, all 250 grammar
assets and the WASM. Final native compilation has no compiler/linker warning;
The corrected offline root install has no remaining peer warning.

Original Muse C4/131072/NVFP4 fixed-arena startup rejects before Ready. The
separate automatic candidate reaches Ready and prepares four distinct exact
131,009-token inputs, but long prefill crosses the unchanged 300 MiB free-memory
guard at 292 MiB. No decode completes and no capacity pass is claimed. Exact
original-profile restoration and zero-Engine cleanup pass. Allocation ownership
remains OI-072-RUNTIME with C2; KV full-touch did not change CUDA/NVML free memory.
No margin, context, concurrency or profile promotion is justified by that result.

## Evidence and owned disk inventory

The October 10 18:30–18:38 UTC GChat ownership survey reaches local, Ada4090
(.143), Server 2 (.112), Server 1 (.109) and laptop (.153). No additional verified
retired build or source candidate is found: **0 GB freed on each host**. The 19
recorded retired local paths remain absent; historical reclamation is not counted
again. Unmerged source, current Windows acceptance inputs, accepted packages,
shared caches, master-cited evidence, original state and the current S2 fixture
remain protected. All inspected filesystems have more than 2 GiB available.
Process visibility and bounded path scope are recorded in
`out/disk-hygiene-20261010/`; this does not establish whole-host cleanliness.

| Owner / host | Path | Purpose and retention |
| --- | --- | --- |
| Web warning fixtures / Ron-9950X3D2 Linux | `/ai/gchat-worktrees/web-warning-8440`, `fix/gchat-web-warning-8440` | Test-only port from `418d6d07d` onto `8440b5f7a`; focused check pending; shared node_modules symlinks, no build/live job; retain source and `out/gchat-open-items-20261012/web-warning-*` evidence through reviewed merge |
| Review coordinator / local Linux | `/ai/gchat-worktrees/review-host-manager-a7003488` | Retired after accepted main0dd5d45ce publication and fresh zero-reference checks; branch/build/evidence retained |
| Remediation coordinator / local Linux | `/ai/gchat-worktrees/fix-host-review-bugs-0dd5d45c` | Accepted OI-111–114/120–122 source candidate; local/remote branch and external logs stay. Filesystem retirement and protected paths are tracked in the existing `out/manager-kv-startup-20261008/drain-hygiene-not-deleted.md` |
| Coordinator / local Linux | `/ai/gchat-worktrees/remediation-integration` | Retired after committed/pushed ancestry and live-use checks; two unique coverage summaries retained externally |
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

The OI-111–114/120–122 hygiene check retains accepted packages and shared builds.
Current
Windows installers, tested Engine ZIP, reused Manager producer and compiler
cache remain; prior retired Engine source/build paths are still absent. The
reused dependency graph, shared Cargo targets and other coordinators' trees
remain protected; the completed candidate can retire after source publication.
This light metadata pass deletes 0 bytes;
remote hosts and full Windows live-use are not rechecked. Current retention
notes are in `out/manager-kv-startup-20261008/drain-hygiene-not-deleted.md`.

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

Review source retirement removes two verified own merged checkouts, recovering
2,585,649,152 B net after preserving both unique coverage summaries. Receipt:
`out/code-hygiene-20261009/review-host-manager-a7003488/cleanup-sources.json`.
Root-owned Linux staging required matching-owner residual cleanup after Git
unregistered the partially removed tree. Future retirement checks staging
ownership and registration/residual paths separately. Physical dependency
graphs, shared builds, packages/evidence, models and other owners remain.
