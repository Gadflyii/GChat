# GInfer Server Manager

Repository: GChat. Owner: GChat coordinator. Subject: `docs/ginfer-manager/`.
Open defects and TODOs belong in the [master list](../open-work.md); this record
retains Manager decisions, implementation and evidence. The fixed-pool startup
issue is OI-066; remaining acceptance is OI-056 and OI-068 through OI-072.
Accepted runtime source: `ce6a6c0e6` for Windows; `2a6e21ff2` for the retained
Linux package. Packages and native proof live in `/ai/gchat/out/ginfer-manager/`.
Documentation-only handoffs do not rebuild accepted binaries.

## Outcome and acceptance

The standalone Manager requested in
`/ai/faceless-video/tmp/briefs/ginfer-server-manager-gchat.md` is delivered:
Windows tray and Linux X11 window, local/paired model start/stop/reload,
models/downloads, sharing, pairing, client grants and shared fleet work pools.
The [design](../ginfer-manager.md),
[decision](../decisions/2026-10-08-share-host-management-and-fleet-pools.md)
and [operator guide](guide.md) define its behavior.

The latest correction exposes automatic or exact GPU KV budgets in custom
launch/reload. Acceptance covers explicit null/fixed byte payloads, preserving
context/concurrency/headroom, unchanged saved-profile selection, independent
review, required source checks and the installed Windows control. Engine changes,
profile requalification, full-context/model qualification and Server 2 work are
excluded. The earlier neutral per-host Offline/Online fix remains delivered.

## Current decision and next action

### Current Engine profile repair — OI-072

The installed Engine is now native `2ef56a52a`. The original fixed-pool profile
remains saved exactly and stopped. OI-072 must deliver Muse TP1, C4/131,072,
NVFP4 long KV and native NVFP4 DFlash, 1,024-token prefill, graphs enabled and
Vision disabled through the public prefix-enabled serving route. Context,
concurrency, the 300 MiB guard and sampling behavior are not reduced. Engine
memory admission remains the authority; the earlier fixed-pool rejection is
retained evidence, not a reason to weaken that guard.

The source candidate keeps the September fixed profile unchanged and adds a
distinct automatic-pool profile, initially `calculated-pending-validation`.
Automatic sizing uses current post-startup availability minus the same guard;
it maximizes the shared arena instead of reserving yesterday's unused capacity.
GChat already forwards and persists null/omitted versus positive fixed arena
bytes correctly. Catalogs are owned by GInfer's `config/launch-profiles/`.
The candidate is not installed and does not rewrite live `host.json`.

Frozen `2ef56a52a` source selects a 2,208-token native tail containing
8,366,592 bytes, including 256-byte plane alignment and the 15-token BF16 V
microtail. The startup minimum is only four such capture tails (33,466,368
bytes); reaching Ready with automatic sizing cannot establish C4 full-context
capacity. The September placement harness disabled prefix reuse. Its exact
2,139,451,392 measured arena bytes are reproduced by 63 full tails and one
2,048-token tail per lane, and exclude public-serving checkpoint reservations.
Those histories left 9,858,355,200 of the fixed arena's bytes unused.

For the public route, one Muse compound checkpoint reserves 85,406,720 bytes
per lane: 43,450,368 sliding INT8 bytes, 41,943,040 draft BF16 bytes and 13,312
BF16 continuation-hidden bytes. Sliding/draft live rings and pending state are
fixed allocations made before the final arena, while this checkpoint image
belongs inside it. Publishing a prompt checkpoint seals its terminal tail, so
output requires another tail. A conservative cold full-context C4 calculation
uses 64 preferred tails per lane, one extra tail for that seal, one largest
atomic-growth tail and one compound checkpoint: 2,550,407,168 arena bytes and
268 segment slots. This is a calculated bound for four independent cold text
requests; retained fragmented histories and physical allocator state are checked
by the Engine's reservation transactions. It is not a fixed pool cap or a
current measured available budget.

Next: the coordinator books actual Host automatic-profile Start/Stop, checking
the exact effective C4/131,072 settings and unchanged 300 MiB guard. After that
Host instance stops, a separately labeled direct loopback public-Engine capacity
check uses the same native binary/artifact/settings and existing supported
`--request-log-jsonl` flag. That log supplies exact resolved arena bytes/slots,
scheduler and batch counters that Host metadata and normal logs do not expose.
It is not Host telemetry proof. Record graph-enabled startup, without inventing
graph/eager numerical qualification. Preserve public prefix reuse and sample
device-wide free memory throughout. Ready/restart/stop and original-profile
restoration remain separate supported Host lifecycle checks.
Use four distinct inputs counted at exactly 131,009 tokens through the loaded
public frontend. The retained 63-decode-input qualification workload may serve
as the matched control (64 returned outputs, 63 decode inputs); it does not change
a product output limit. Early EOS leaves this matched-wave evidence incomplete;
it does not establish a product bug or authorize changing stop/sampling defaults
or retries to force a chosen result. Capture both
the Engine scheduler's four admitted lanes and batch-four decode counters;
four active Host HTTP requests alone cannot prove the requested concurrency.
The existing startup and 32K functional screens do not satisfy this acceptance.
Preserve the original profile and stopped state after the check. No GPU run,
native build, server change or remote administration is authorized in this
source phase. Historical residency attribution remains separately unresolved
under OI-066 and is not a prerequisite for correcting the excessive fixed
reservation.

Owned source candidates are `/ai/gchat-worktrees/oi072-current-profiles` from
`104d4ec6e` and `/ai/ginfer-worktrees/gchat-oi072-catalog` from origin/dev/next
`a6dc193fb`. Retain source/evidence until reviewed integration; no model copy,
build or live job is owned by this item. The accepted installed `2ef56a52a`
payload is reused. Required physical acceptance remains open.

The existing `/ai/gchat/out/oi056-current-engine/host-request.ps1` is adapted
into `scripts/ginfer-host-request.ps1` for four distinct bodies, exact
public counts, a 600-second wave deadline (the retained wave took 199.45
seconds), direct loopback transport and JSONL evidence. The retained qualification
source bank is recovered from `922e5a8:tools/bench/make_bench_corpus.py`; its
5,815 UTF-8 bytes match the retained manifest's `source_bank.sha256` exactly.
The adaptation tiles that text with an early lane marker and counts the full
`role=user` request with reasoning and sampling fields omitted. It establishes
capacity/lifecycle evidence, not new model-quality evidence. Source preparation
creates no native/GPU job; actual execution and exact process ownership/cleanup
belong to the coordinator's booked window.

The direct command uses the exact retained native `2ef56a52a` executable and
the original profile's artifact. The coordinator supplies the booked port and
new diagnostic path; its reviewed argument vector is:

```powershell
$serveArgs = @($artifact, '--host', '127.0.0.1', '--port', $port,
  '--model-id', 'muse-glimmer-30b/nvfp4-dflash-nvfp4',
  '--tp', '1', '--max-context', '131072', '--max-concurrency', '4',
  '--spec', 'dflash', '--draft-policy', 'auto', '--draft-tokens', '4',
  '--draft-tp', '1', '--kv-dtype', 'nvfp4',
  '--kv-arena-headroom-bytes', '314572800', '--prefill-chunk', '1024',
  '--request-log-jsonl', $requestLog)
# Same UUID as Host; same runtime directory/dependency environment.
$env:CUDA_VISIBLE_DEVICES = 'GPU-92a61cb1-6b5e-cc7b-b669-72b2662d9d6e'
```

Omit fixed-arena, Vision, graph-disable, reasoning, sampling and stop overrides.
The direct public model ID is explicit and distinct from Host alias ownership.
The helper does not launch a process. The caller retains its exact PID, creation
time and image, wraps launch/preparation/run in `finally` cleanup, and stops that
owned direct process before restoring the Host profile. Host lifecycle calls
carry `expected_session_id` and have a 600-second transport deadline because
the retained original-artifact hash exceeded 30 seconds. Snapshot calls remain
bounded to 30 seconds; no automatic retry or duplicate launch is introduced.

Use helper `PrepareC4` with the direct origin and owned output directory, then
`RunC4` with its four `c4-lane-0.json` through `c4-lane-3.json` bodies, that
origin, `RequestLogJsonl`, `EngineProcessId`, and `ExpectedEnginePath`.
Preparation is bounded to 96 exact-count calls per lane and 600 seconds in
total. Wave failure aborts its HTTP requests and stops only that unchanged
caller-owned PID; earlier preflight failure and normal cleanup remain the
caller's responsibility. Keep raw JSONL and the helper's input/result/event
receipts in the booked output. `server_start.memory` supplies the measured
arena and descriptor capacity; `throughput.scheduler.running` must show four
admitted lanes, and `decode_batch.rounds_by_batch[3]` /
`committed_tokens_by_batch[3]` must show actual B4 work. Require four 64-token
responses and 252 committed decode inputs total, with zero prefix-hit credit.

Frozen Muse AUTO resolution is preserved: requested `auto`/four draft tokens
can resolve to adaptive/15 or calibrated fixed families. The helper checks
requested CLI arguments separately from JSONL's resolved policy/window and
records both. The 85,406,720-byte checkpoint uses fixed 2,048-token cyclic
rings plus continuation hidden; the native tail's 15-value microtail belongs
to the KV codec, independent of draft width. At most 16 staged tokens fit well
below the 2,208-token preferred tail, so one such tail still bounds atomic
growth. Independent review confirms the calculated 2,550,407,168-byte / 268-slot
cold-cohort requirement remains valid. Runtime width-dependent pending state,
workspace and graphs precede automatic arena sizing; their actual residency
is measured by the physical check, not assumed from this KV calculation.
Independent source pressure review found no remaining definite helper blocker
after correcting the JSONL `auto_max` spelling, requested/resolved AUTO distinction,
explicit direct model ID and Host lifecycle deadline. The native PowerShell
parser passes without executing the script body. Embedded transport compilation,
API calls and physical execution remain untested until the booked native run.

Source verification: nineteen Manager DOM tests and sixteen focused desktop
picker/benchmark tests pass, with product ESLint, release `tsc -b` and both
repository diff checks. The catalog's original eight entries compare exactly
with its base; independent integer layout arithmetic reproduces the retained
wave and the new pending requirement. The focused offline Host gate passed
13 catalog tests and three launcher tests under the canonical build and GPU
locks in 6.69 seconds, reusing `/ai/gchat/src-tauri/target`. The real
`ProfileCatalog::read` accepted the exact nine-entry GInfer candidate with
the pending automatic policy and evidence intact. Receipt:
`/ai/gchat/out/oi072-current-profiles/focused-host-gate.log`; its disposable
validator source and binary were removed. Independent review found no blocker
in the evidence-label changes. Required `make verify` remains with the
coordinator's composed integration gate. The two
source trees occupy 264 MiB and 240 MiB; dependency links reuse existing shared
caches. No disposable model, build or GPU output was created.

### Retained startup diagnosis — OI-066

The October 9 measurement establishes the OI-066 startup admission rejection.
The owner of the baseline difference and its reclaimability remain unresolved. The
saved tested profile and Host command match: Muse native-NVFP4 text, TP1,
C4/131,072, DFlash K4, NVFP4 KV, 1,024-token prefill, CUDA graphs enabled,
Vision disabled, 11,997,806,592 fixed arena bytes and 314,572,800 headroom bytes.
The catalog records engine `922e5a8`; the installed executable is `6138913f`.
No `--structured-outputs` flag is passed and its installed default is false.
Disk/NUMA warnings are nonfatal. The actual rejected reservation is the whole
fixed pool; it is separate from the memory needed by four 128K requests.

One bounded native startup reproduced the exact failure without changing saved
options or sending an inference request. The original qualification used the
same RTX 5090 UUID, artifact, fixed arena, headroom and C4/context/KV settings.
Its retained telemetry distinguishes physical NVML availability from the old
benchmark's CUDA-only startup counter:

| Physical GPU free memory / reservation | Passing September test | October 9 retry |
| --- | ---: | ---: |
| Before engine startup | 30,963 MiB | 30,104 MiB |
| Last observed before pool allocation / failure cleanup | 11,831 MiB | 10,983 MiB |
| Fixed arena | 11,442 MiB | 11,442 MiB |
| Required safety margin | 300 MiB | 300 MiB |
| Free required for arena plus margin | 11,742 MiB | 11,742 MiB |
| Spare above requirement / shortfall | +89 MiB | −759 MiB |
| Startup consumption between those phases | 19,132 MiB | 19,121 MiB |

The current GPU already had 859 MiB less free memory before loading. The
pre-pool difference is 848 MiB; these samples show essentially unchanged startup
consumption, not a new 1 GiB Engine allocation. The failed process exited and
free memory returned to its 30,104 MiB starting level. A later read-only check
found no engine and 30,092 MiB free. The extra baseline usage remains after
Engine cleanup. The old GPU-client list has no per-client memory amounts, and
current Windows process memory counters do not reconcile with physical NVML
usage, so a particular application cannot be named as the owner of that delta.

The user requested attribution of the additional VRAM. A subsequent read-only
Windows query of the same 5090's local memory segment reports 1,185,017,856
Allocated bytes (1,130.121 MiB), 840,577,024 Modified bytes (801.637 MiB), and
no Zero or Standby bytes. Allocated plus Modified approximately matches nearby
NVML 1,918 MiB Used, with asynchronous changes between queries. This is a
specific OS-managed residency bucket worth investigating; it does not establish
that this bucket grew by the historical 859 MiB. The original test did not record
these buckets. Direct process queries also differ substantially from the normal
performance counters. Protected DWM/csrss/System/vmwp inspection is access-denied
without elevation; no applications were closed and no UAC prompt was raised.

The installed SDK defines `ModifiedBytes` separately but does not define its
reclamation contract. Microsoft documents dynamic WDDM residency budgets and
trimming; NVIDIA distinguishes WDDM OS management from Linux/TCC channel
accounting. Neither guarantees that these specific local Modified pages are
recoverable for this arena. Conversely, current NVML free alone does not prove
an irreducible allocation shortage. `src/runtime/engine/kv_arena_capacity.cpp`
rejects before attempting the final CUDA arena allocation. The demonstrated
cause is the admission policy's free-memory comparison; whether that policy
rejects recoverable residency without host spill remains an unproven hypothesis.
The failed engine returned memory to its baseline, but that observation does not
prove Windows cannot reclaim the remaining pages later.

At the user's shutdown drain request, finer attribution and the reclamation
question are parked in OI-066. Resume from these retained measurements after the
RAM installation; do not repeat qualification to recover missing context.
Evidence: `gpu-direct-process-memory-20261009.json` and
`gpu-protected-process-memory-20261009.json` beside the measured startup trace.
Relevant primary contracts: [NVIDIA NVML memory queries](https://docs.nvidia.com/deploy/nvml-api/latest/api/group__nvmlDeviceQueries.html),
[Microsoft residency budgets](https://learn.microsoft.com/en-us/windows-hardware/drivers/display/process-residency-budgets),
and [the reserved statistics interface](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/d3dkmthk/ne-d3dkmthk-d3dkmt_querystatistics_type).

In `6138913f`, `registry.cpp` releases the temporary capture arena before
querying memory and resolving pool capacity. The four native NVFP4 capture
tails total 33,466,368 bytes (31.916 MiB); even crediting the entire payload again
after the last 10,983 MiB sample leaves a 727.084 MiB shortfall. Capture release
also destroys 64 CUDA events whose driver-owned bytes are not quantified.
The final error is after release, so temporary capture storage does not explain
away the physical shortage. Requested sampling is 50 ms, effective roughly
64 ms: the 759 MiB shortfall is a nearby observation, not the exact private
CUDA/NVML pair at the check.

Commit `32cf870caa` changed the final query from CUDA-only free bytes to the
minimum of CUDA process and NVML device-wide free bytes. The original
qualification reported 12,295 MiB CUDA-free at startup while nearby physical
telemetry had 11,831 MiB free, a 464 MiB difference. Its apparent CUDA surplus
of 553 MiB was only 89 MiB of physically observed spare above the required
reservation. Both the ambient baseline and accounting changed; query change
alone is not demonstrated as the cause. Source comparison also finds a smaller
dominant prefill workspace, not the material allocation growth previously
suspected. HTTP queue settings are host-side and warmup follows construction.

The profile was tested and passed. Its fixed whole-pool reservation has little
physical tolerance for a busier Windows desktop. OI-066 is parked for the shutdown drain. Resolve attribution and reclaimability
before the owning Host/profile/engine decision on current-memory pool sizing, preserving
the user's C4/131,072/NVFP4 workload. No catalog, installed binary, headroom or
saved settings were changed by this diagnosis. Automatic sizing is exposed by
the installed Manager control from `ce6a6c0e6`; it is a workaround, not proof of
current full-context qualification or a completed profile fix. Server 2 was
untouched.

Measured evidence: `/ai/gchat/out/manager-kv-startup-20261008/` contains
`c4-startup-measured.json`, `c4-startup-gpu.csv`, `c4-diagnosis-summary.json`,
the pinned repeat snapshot and the redacted effective command. The matched old
qualification is
`/mnt/nas/AltaStratusAI/GInfer/qualification/launch-profile-qualification-20260909/profiles/windows-sm120a/rtx5090/muse-native-nvfp4-c4-ctx131072-explicit-margin300m-fit/`.
Its benchmark, physical telemetry and resource observation remain unchanged.
The local GPU booking was released at the run's actual end; no owned GPU job
or lock remains. Available system RAM stayed above 8 GiB throughout the retry.

### C1 and C4 VRAM arithmetic

Read-only calculation: `/ai/gchat/out/manager-kv-startup-20261008/kv-math.py`
and `kv-math.json`, using Python 3.11. Only the installed artifact's 273,074-byte
directory and 16-byte header were read; no weight payload was copied or changed.
Muse has 13 full-attention layers, two KV heads and 128 dimensions. NVFP4 stores
one byte per two values plus one byte of scale per sixteen values:

`13 × 2 × 128 × 2 (K/V) × (1/2 + 1/16) = 3,744 bytes/token`.

At C1/131,072, full-history payload is 490,733,568 bytes (468 MiB). The 39
2,048-token INT8 sliding rings, FP16 scales and BF16 open V groups add
43,450,368 bytes (41.4375 MiB). Five 2,048-token BF16 draft rings with eight KV
heads add 41,943,040 bytes (40 MiB). Combined cache payload is 576,126,976 bytes
(549.4375 MiB / 0.537 GiB) for C1 and 2,304,507,904 bytes
(2,197.75 MiB / 2.146 GiB) for C4. Segmented allocation overhead, retained
prefixes, pending state, workspaces, graphs and driver allocations are additional;
these payloads are not exact physical arena minima or launch qualification.

The installed artifact has 627 Text weights, two FP32 KV normalization arrays
and 81 draft tensors. Their 256-byte-aligned device residency upper bound is
18,575,123,200 bytes (17.299 GiB); the old benchmark reports 18,575,122,948 bytes,
252 bytes lower from the last allocation's unused tail padding. Vision, disabled
in this failure, would add 3,843,814,400 weight bytes (3.580 GiB) and workspaces.
Native NVFP4 weights still include W8 vocabulary and BF16 tensors; sliding and
draft KV formats are separate from the full-attention NVFP4 cache.

The earlier October 8 C1 failure requested a different 12,467,568,640-byte
(11.611 GiB) pool with the same 300 MiB headroom. Its post-failure free memory
was 30,021 MiB, not a failure-time measurement; that evidence did not establish
a changed startup allocation. The October 9 matched C4 measurement above now
establishes whole-pool fit under the actual current device-wide memory state.

At 16,384 tokens, C1 combined cache payload is 139.9375 MiB. Hypothetical
162,000- and 165,888-token payloads are 659.868 and 673.75 MiB respectively;
both exceed Muse's supported 131,072-token context and are only arithmetic
comparisons. The user's repeated launch was C4/131,072, not either larger value.

## Ownership and fleet contract

Manager shares GChat's locked registry and native credential vault. The Host owns
launch, downloads, grants and sharing. Opening Manager does not start a model or
replace another owner's Host. Closing/exiting Manager leaves hosts running.

One selected coordinator owns durable revision/CAS pools and client assignments.
Paired clients resolve its pinned locator through fleet members. Hosts receive
read-only projections of their own membership. Studio browses the full catalog;
assignments constrain runnable placement. Runs freeze their validated catalog
and instance/session affinity. Offline catalogs are read-only and cannot start
new pooled work. Exact migration receipts prevent deleted pools returning;
canonical physical identity preserves overlapping worker limits.

## Verification and limits

Required source checks pass at `ce6a6c0e6`: lint/typecheck, contract/assets,
2,067 frontend tests (six skipped), 102 extension tests, nineteen Manager DOM tests,
all six critical coverage floors and supported Rust suites, including 547 desktop
tests (seven ignored), 62 Host units and eight real TLS/Host-client checks.
`make verify` initially stopped on missing candidate extension dependencies;
its missing coverage/Rust targets passed after linking the existing caches. A real ten-second credential-stall regression retains an
actual cached pool, reports an actionable coordinator issue and verifies recovery.
Earlier unchanged Rust source passed separate GChat and Host/Manager Clippy with
warnings denied; the current change is UI/documentation only and native compilation
emitted no warnings. All five
code-session tests pass after a test-only lint correction. Independent source
review findings were implemented; root reviewed the actual changes and receipts.

Windows package:
`/ai/gchat/out/ginfer-manager/windows/ginfer-manager-windows-x64.zip`.
Current native Rust/MSVC compilation took 1m37s with one Cargo job and the standard
release profile. Source staging, four archive members, current guide and hashes
pass. The installed normal window and original pinned HTTPS identity/grant pass.
The native memory guard stayed above its 4 GiB floor after the unchanged 8 GiB
start preflight; minimum available RAM was
6,689,947,648 bytes. Shared compiler/dependency caches were preserved.

Earlier native tray, pairing/vault, Scan, saved-pair restart, no-tray and LAN-port
proof is retained in the Windows package's `native-smoke/` and
`native-smoke-status/`. This is baseline evidence, not replay of the current PE.
Private fixtures and superseded native source/output were retired. The current
acceptance does not claim inference/GPU qualification.

Linux package:
`/ai/gchat/out/ginfer-manager/linux/ginfer-manager-linux-x64.tar.gz`.
Its accepted `2a6e21ff2` assembly and pinned HTTPS/sharing checks remain valid
baseline evidence. Both ELFs require at most GLIBC 2.39. GTK3, WebKit2GTK 4.1 and
Soup3 are prerequisites. Earlier X11 checks cover default dark, Models Scan and
window exit preserving the empty Host. This desktop has no tray watcher or
Secret Service provider, so native Linux tray/vault pairing remains unqualified.
Server 2's matching ABI was a screen, not deployment. The offline-panel fix was
not rebuilt into this retained Linux archive.

Both packages contain Manager, matching Host, guide and font license. They
contain no inference engine or models. Registered service/Desktop ownership
continues to select the actual Host and engine independently of these companions.

## Execution corrections

Fresh candidates need existing root/core/web and extension workspace dependency
links before checking. Two early gate attempts lacked the extension state/package
links; restoring them, without installation, produced passing extension coverage
and all remaining Rust checks. Future candidate preparation includes these links.

The first updater correctly refused a remembered Host PID before changing files.
Actual inspection found all apps closed, not a replacement Host process. The update
uses the verified current process inventory; normal Manager startup owns a new
registered Host process while retaining its identity. Native number inputs report
as UIAutomation Spinners. Do not use numeric ValuePattern editing in a live launch
form during user testing: the 21:37:59 Reload attribution remains unresolved, and
such automation has stopped. Use DOM payload regressions and read-only native
control inspection; no successful automated native clearing claim is retained.

The final review corrected an inaccurate eight-second baseline claim by checking
the original code and preserving its ten-second deadline. Credential preparation
and network timeout classification now differ before errors become text. The
shared transport implementation removes the divergent snapshot route. Regression
checks protect cached pools, recovery and blocking unknown-host legacy migration.

Direct Cargo checks require the public resource-stub target. Typed errors are
mapped at existing String IPC boundaries. A live membership fixture releases its
data lock before awaiting delivery. A pre-existing test-only clone warning uses a
borrowed slice; its focused tests and warning check pass.

Combined GChat test-tauri/Manager feature unification was an invalid check
configuration; separate product Clippy commands are authoritative. Native scripts
use actual `wslpath` output and the verified Ubuntu distribution. Guarded native
startup waits for actual Windows headroom after WSL file-page advice; one refused
preflight started no compiler. Shared cache files, toolchains, release profiles and guard
floors were preserved. Earlier low-headroom compiles stopped only their owned
Cargo trees; pinned Process handles retain the real PowerShell 5.1 exit status.

## Owned inventory

| Owner / host | Exact path | Purpose and retention |
| --- | --- | --- |
| GChat / RON-9950X3D2 | `/ai/gchat` | Stable main delivery checkout |
| Diagnosis clarification | `/ai/gchat-worktrees/manager-kv-diagnosis` | Documentation-only correction on `6ea7dc9d4`; source in Git and checkout retirement in task `diagnosis-cleanup.json` |
| C4 startup diagnosis | `/ai/gchat-worktrees/manager-kv-math` | Documentation branch from `fbe10c93d`; attribution follow-up retained beside existing KV evidence, checkout retirement in `math-worktree-cleanup.json` |
| KV budget candidate | `/ai/gchat-worktrees/manager-kv-budget` | Accepted `ce6a6c0e6` retained in Git; checkout disposition in task `worktree-cleanup.json` |
| KV budget evidence | `/ai/gchat/out/manager-kv-startup-20261008/` | Pinned public snapshot/catalogs, review and source/native checks; no credentials or model copy |
| KV native candidate | `C:\Users\Ron\AppData\Local\GChat\windows-build\manager-kv-startup-20261008` | Retired after accepted Windows package/install; shared cache junction detached first |
| Offline source candidate | `/ai/gchat-worktrees/manager-offline-status` | Reviewed source retained in Git; checkout disposition in task `worktree-cleanup.json` |
| Windows accepted package/proof | `/ai/gchat/out/ginfer-manager/windows/` | Current archive/guide/hashes and earlier public native proof |
| Linux accepted package/proof | `/ai/gchat/out/ginfer-manager/linux/` | Retained `2a6e21ff2` archive and native evidence |
| Offline task evidence | `/ai/gchat/out/manager-offline-status-20261008/` | Required gate, Clippy, native build, installed UI/identity, cleanup receipts |
| Native task mirror | `C:\Users\Ron\AppData\Local\GChat\windows-build\manager-offline-status-20261008` | Retired after package/install acceptance; detached shared-cache junction first |
| Superseded native baseline | `C:\Users\Ron\AppData\Local\GChat\windows-build\ginfer-manager` | Retired; public proof preserved beside accepted Windows package |
| Shared caches | `/ai/gchat/node_modules`, `/ai/gchat/src-tauri/target`, native `windows-build/source/src-tauri/target` | Preserved dependencies/compiler cache |
| Earlier source candidates | `/ai/gchat-worktrees/ginfer-manager`, `/ai/gchat-worktrees/unified-sessions`, `/ai/gchat-worktrees/local-update-20261008` | Retired; source commits and accepted evidence retained |

Earlier Manager-specific Linux/Windows compiler targets were retired after their
acceptance. The October 9 shutdown drain also retired duplicate Windows staging
artifacts and the parked documentation checkout. Six other owners' unmerged
worktrees, shared caches, installed apps/data, engine artifacts and evidence remain.
The scoped read-only GChat survey reached S1, Ada, S2 and the laptop; no remote
deletions or fleet-wide cleanliness claim are made. The retained-path list and
cleanup receipts are in `/ai/gchat/out/manager-kv-startup-20261008/`, including
`drain-hygiene-not-deleted.md` and `drain-cleanup-result.json`.
GInfer's separate operations-manual handoff is tracked in
[Agent runtime](../agent-runtime/README.md).
