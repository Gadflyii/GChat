# GInfer Server Manager

Repository: GChat. Owner: GChat coordinator. Subject: `docs/ginfer-manager/`.
Open defects and TODOs belong in the [master list](../open-work.md); this record
retains Manager decisions, implementation and evidence. The fixed-pool startup
issue is OI-066; remaining acceptance is OI-056 and OI-068 through OI-072.
Installed Windows Manager producer is `43c8d71cf`. The refreshed Linux
Manager/Host is compiled from `54c931c68` and assembled at `02d369e8a`;
independent package and native X11 acceptance pass. The older `2a6e21ff2`
Linux proof remains historical evidence. Package paths and proof are recorded below.
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

### Retained instance diagnostics — GCHAT-MANAGER-STOPPED-ERROR-ALERT

The October 10 public Host snapshot reports the saved instance stopped with zero
active requests while retaining its October 9 startup error. Manager rendered
that entire saved diagnostic as a current red error. Source now keeps stopped
and other historical diagnostics in neutral, collapsed **Previous startup
error** details. An online failed instance keeps a short visible failure alert
and collapsed **Startup or runtime error details**. The complete diagnostic
remains available in a bounded, scrollable text area; no Host error, cached
snapshot, model profile or stored data is cleared or changed.

Acceptance requires the existing Manager DOM harness to show stopped versus
failed presentation, offline cached diagnostics, full retained text and the failed-to-stopped
transition, followed by the coordinator's source gate and rebuilt installed
Manager acceptance. Two focused DOM regressions are prepared but unrun during
the October 10 10:20–11:00 UTC quiet window. Root executes admitted checks and
integrates the reviewed branch with the installer correction after 11:00 UTC.
This source preparation does not qualify the installed Manager or fix the
separate Engine profile/startup issue.

Evidence: `/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/host-current-error-341.json`
records `stopped`, zero active requests and the retained 9,009-byte diagnostic.
The source branch is `fix/gchat-manager-stopped-error-7d9`, based on exact
`7d9a8f689d5cef0c31f910872cd588941d0d674f`. Next run
`node --test tests/ginfer-manager-ui.test.mjs` using the retained dependency
graph, then the applicable composed source gate and installed UI acceptance.

Installed Windows client `0f06ba433` passes with retained Manager producer
`43c8d71cf` and clean Engine `2ef56a52a`. Composed `make verify`, native build,
package verification and installed payload/user-state preservation pass.
Seven original threads, all models/profiles, credentials and Host identity are
preserved. Actual sidebar Stop stays stopped with zero Engines/API listeners;
Start and Reload reach distinct Ready sessions with selected alias/Server
running retained. Continued Chat returns 30,000 ready/stop after compaction
from 26,366 to 1,705 tokens; final GUI Stop returns to zero. Supported
Reload/Stop restores the original profile exactly and normal apps are restored
without debug ports. Evidence:
`/ai/gchat/out/oi106-final-update-20261009/installed-verification.json` and
`installed-lifecycle-acceptance.json`. Reviewed code is merged and pushed on
Windows main `e2521e33`; installed product remains `0f06ba433`. Linux
assembly, both-format independent package verification and actual native X11
lifecycle acceptance pass at `02d369e8a`, as recorded below. Completed OI-106 and profile
source trees are retired; source branches and evidence remain. This C4/32K
functional acceptance leaves the original fixed-arena
128K startup failure and physical qualification requirements below unchanged.

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
The 104-profile Windows catalog is installed with the distinct automatic entry
still calculated/pending; original 103 profile values are retained exactly.
Supported lifecycle tests restore the original saved profile. No private
`host.json` edit or capacity promotion is used.

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

Actual October 9, 19:40–19:41 UTC Host automatic Reload/Ready/Stop passes with
the exact C4/131,072 settings and 300 MiB guard. The separate direct Engine
also reaches Ready: JSONL records an automatic 10,400,743,424-byte arena and
9,198 slots, adaptive/15, prefix reuse and graphs enabled. Its sole event is
`server_start`; no inference ran. Preparation doubled the retained text past
the frontend's capacity and received typed HTTP 400 `context_length_exceeded`
for a 152,381-token prompt. The helper incorrectly aborted that expected upper
bracket. Supported cleanup restores the exact original stopped profile and
zero native Engines, with no cleanup error. Evidence:
`/ai/gchat/out/code-hygiene-20261009/integration/native-c4-128k-20261009/`.

The correction preserves HTTP status and JSON body in a typed transport failure.
Only preparation opts into recognizing HTTP 400 with a valid error object,
string `context_length_exceeded` / `invalid_request_error` / `messages` fields
and a nonempty string message as an above-target sentinel. It never parses a
token count from prose or records the sentinel as a measured count. All other
errors and `RunC4` exact-count validation still fail. All three preparation
count paths keep 96 calls per lane / 600 seconds total, four distinct early
markers, exact 131,009-token acceptance, 64 requested outputs and omitted
public defaults.
Native PowerShell 5.1 parser/Add-Type and ten bounded component cases pass,
including actual HTTP/PS exception wrapping, wrong status/code/type/parameter,
malformed JSON/object fields and default exact-validation rejection. The fixture
uses an opaque message without token numbers. It executes extracted production
transport/count code only; no Host, Engine or GPU execution. Receipt:
`/ai/gchat/out/oi072-current-profiles/count-upper-bound-component.json`;
its sibling fixture source is retained for this reproduced regression.

The corrected October 9, 19:56–19:57 UTC execution passes Host automatic
Reload/Ready/Stop again. Its separate direct Engine records a new automatic
10,638,176,256-byte arena (9.91 GiB) and 9,198 slots, with the same adaptive/15,
graphs and prefix reuse. Preparation succeeds for all four distinct inputs at
exactly 131,009 tokens: 24 public count calls per lane, 2.035 seconds total.
Each body requests 64 outputs for the retained 63-decode-input control; no
outputs were returned.

The actual wave is stopped after 13.537 seconds by the helper's unchanged
300 MiB physical-free-memory guard: the device-wide samples start at 410 MiB
and end at 292 MiB, with intervening variation up to 436 MiB. JSONL contains
four `request_start` and three `throughput` events. Its last scheduler sample
shows four running/prefilling lanes, zero waiting/decode-ready lanes and
524,036 logical input tokens. Aggregate represented prefill is 96,564 tokens,
including 96,507 computed prefill tokens; complete histories are not reached.
All decode/B4 counters are zero, there are no responses, and no Engine error,
completion, OOM or admission error is recorded. Supported cleanup restores the
exact original stopped configuration, with no native Engine or cleanup error.
Evidence: `/ai/gchat/out/code-hygiene-20261009/integration/native-c4-128k-corrected-20261009/`.

The current decision is to retain `calculated-pending-validation`: automatic
startup and exact preparation pass, but full C4 capacity has not passed the
physical guard. No retry, margin change or profile promotion is authorized.
The device-wide free-memory change during prefill does not establish the
allocating owner, Engine payload growth, Windows residency/spill or an external
client cause. The saved receipts lack paired live Engine allocation/CUDA-free,
Engine PID local committed/resident and other-client counters. Runtime
attribution is handed to the native owner under master OI-072-RUNTIME; these
missing observations are the next unresolved evidence. The direct JSONL is
separate Engine evidence and does not prove Host telemetry or model quality.

Remaining physical acceptance uses four distinct inputs counted at exactly
131,009 tokens through the loaded public frontend. The retained 63-decode-input
qualification workload may serve
as the matched control (64 returned outputs, 63 decode inputs); it does not change
a product output limit. Early EOS leaves this matched-wave evidence incomplete;
it does not establish a product bug or authorize changing stop/sampling defaults
or retries to force a chosen result. Capture both
the Engine scheduler's four admitted lanes and batch-four decode counters;
four active Host HTTP requests alone cannot prove the requested concurrency.
The existing startup and 32K functional screens do not satisfy this acceptance.
Preserve the original profile and stopped state after the check. No additional
GPU run, native build, server change or remote administration is authorized in
this documentation handoff. Historical residency attribution remains separately
unresolved under OI-066 and is not a prerequisite for correcting the excessive
fixed reservation.

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
Earlier source pressure review corrected the JSONL `auto_max` spelling,
requested/resolved AUTO distinction, explicit direct model ID and lifecycle
deadline. Actual preparation exposed the upper-bracket failure above; source
review and startup alone did not establish the full helper or capacity result.
The measured adaptive/15 startup does not change the calculated bound. The
corrected wave demonstrates four admitted prefill lanes; full-context completion
and B4 decode evidence remain unachieved after the physical guard abort.

The coordinator's owned execution adapter is
`/ai/gchat/out/code-hygiene-20261009/integration/c4-profile-capacity.ps1`.
It references the committed helper/bank and retained
`original-profile-public.json`, checks the live booking and coordinator-owned
canonical locks, and inspects the installed native manifest/version, GPU and
actual Host child arguments. It performs automatic custom-profile Reload
(which already starts the instance), Ready and Stop, then owns the separate
direct process on `127.0.0.1:9537`. Credentials remain in memory; the direct
process reuses the Host-generated Engine key and native public model label,
with separate alias ownership. Its approved lifecycle difference omits the
Host-only `--exit-on-stdin-close`; exact PID, creation time and image checks
govern direct cleanup. Engine inference parameters remain the same, with the
new JSONL diagnostics recorded explicitly.

The adapter's `finally` covers earlier API/preparation/preflight failures and
successful waves, stops the exact direct process, and restores the exact saved
flat original configuration through supported Reload/Stop. It checks stopped
idle state, original identity/certificate and absence of native Engines. The
coordinator supplies the existing outer RAM/hard-deadline guard. Native `2ef`
uses `%LOCALAPPDATA%\GInfer\hardware.json` with no Host profile override;
startup can refresh stale NUMA facts, so the adapter compares that same existing
path/hash after each startup and stops the same-settings comparison if it
changes. It does not copy that profile or introduce `--no-profile`.
The actual first capacity attempt used local5090 booking 279, October 9,
19:30–20:30 UTC, owned by GChat. The adapter requires fresh bounds and line/PID
parameters for any later coordinator run. It is a retained execution artifact;
the startup/lifecycle evidence above does not complete physical capacity.
Independent source pressure review found no concrete blocker in the composed
adapter/helper/bank and confirmed that the actual Host public label comes from
the artifact identity/weights, while the saved UUID is only its inventory lookup.
The final receipt is written only to a directory created by this invocation;
rejecting a reused output directory cannot overwrite retained evidence.

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
in the evidence-label changes. The composed `make verify` at `0f06ba433` now
passes; source verification does not qualify full-context capacity. Candidate
source is represented in published main and its completed tree is retired
after fresh live-use checks; source branches and external evidence remain. No disposable model,
build or GPU output was created by this source-preparation work.

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

Linux refresh packet:
`/ai/gchat-worktrees/oi074-frontend-packages/out/oi070-linux-refresh/`.
Its `manager/ginfer-manager-linux-x64.tar.gz` contains the Manager and matching
Host compiled from `54c931c68`; accepted assembly source `02d369e8a` only
changes the cached AppImage runtime environment. Ubuntu 24.04 native compilation
and both client package formats pass. The outer archive postcopy's ownership
failure was recovered with unique temporary archive/checksum files and atomic
replacement, terminal 0; see `assembly-final-status.json`.
Root promotes the accepted Manager archive/guide/checksums to
`/ai/gchat/out/ginfer-manager/linux/` and retains the evidence packet at
`/ai/gchat/out/oi070-linux-refresh/`, with the old packet path as a stable
symlink to the same files. The earlier `2a6e21ff2` pinned HTTPS/sharing proof
remains historical evidence rather than a replay of this binary.

Independent DEB and AppImage package closure/ABI, companion and Manager
archive verification pass in `package-verification.json`. Actual dark X11
startup, four installed-runtime verification, Models Scan showing Inventory
refreshed, and Manager close/reopen pass for both formats. `WM_DELETE_WINDOW`
exits Manager; its new process returns online with the same shared Host
PID/UUID. DEB uses Host 1055553 / `726abf22-f807-483f-9098-d067f84ef9f9`;
AppImage's actual wrapper 1061283 launches desktop 1061355 and Host 1065499 /
`38674ad7-0bb9-4148-9a6b-fe048702e729`. Each has zero models, instances and
requests; see `native-acceptance.json` and `evidence/native/`.

The fixture uses public locator `127.0.0.1:17443` because mirrored Windows
Host PID 23052 owns 7443/7444 and native default binding returns `EADDRINUSE`.
This does not qualify default-port coexistence or LAN sharing. All owned native
app/Manager/Host/wrapper processes are absent after shutdown and port 17443 is
free. Original Windows PIDs 40160/15224/23052 remain unchanged, with zero
Engines. The leftover 2,117,107,712-byte AppImage extraction was explicitly
retired after a privileged live-use scan found no references or uninspectable
processes. Canonical guard 1043205 terminated/released; booking 287 was canceled
at actual END 22:57 UTC.

The Ubuntu 24.04 build's ELFs require at most GLIBC 2.39; current native checks
on Ubuntu 26.04 are not a fresh clean-Ubuntu 24.04 qualification. GTK3,
WebKit2GTK 4.1 and Soup3 remain prerequisites. Linux tray and Secret Service
pairing acceptance (OI-071) are unrun. Client packages retain Engine `05a286ba`,
four exact 167-payload images, 22 catalogs / 174 Qwen/Muse profiles and six
version-matched offline documents. That historical Engine reports unknown
embedded commit/dirty fields; exact baseline bytes/manifests establish its
provenance. There is no Flash, new Engine capacity, model or GPU qualification
claim, and Server 2 is untouched. See [installer refresh](../installer-refresh/README.md).
Linux package/native lifecycle acceptance is complete. Next continue
Host/Manager review from Bubbs’s 22:43 handoff.

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
| Stopped-error UI / GChat coordinator | `/ai/gchat-worktrees/manager-stopped-error-7d9` | Isolated source candidate from `7d9a8f689`; UI/CSS, two observable DOM regressions and this subject record. Retain for review/integration and admitted checks; no private fixture, native source, models, build outputs or owned dependencies allocated. |
| Diagnosis clarification | `/ai/gchat-worktrees/manager-kv-diagnosis` | Documentation-only correction on `6ea7dc9d4`; source in Git and checkout retirement in task `diagnosis-cleanup.json` |
| C4 startup diagnosis | `/ai/gchat-worktrees/manager-kv-math` | Documentation branch from `fbe10c93d`; attribution follow-up retained beside existing KV evidence, checkout retirement in `math-worktree-cleanup.json` |
| KV budget candidate | `/ai/gchat-worktrees/manager-kv-budget` | Accepted `ce6a6c0e6` retained in Git; checkout disposition in task `worktree-cleanup.json` |
| KV budget evidence | `/ai/gchat/out/manager-kv-startup-20261008/` | Pinned public snapshot/catalogs, review and source/native checks; no credentials or model copy |
| KV native candidate | `C:\Users\Ron\AppData\Local\GChat\windows-build\manager-kv-startup-20261008` | Retired after accepted Windows package/install; shared cache junction detached first |
| Offline source candidate | `/ai/gchat-worktrees/manager-offline-status` | Reviewed source retained in Git; checkout disposition in task `worktree-cleanup.json` |
| Windows accepted package/proof | `/ai/gchat/out/ginfer-manager/windows/` | Current archive/guide/hashes and earlier public native proof |
| Linux accepted package/proof | `/ai/gchat/out/ginfer-manager/linux/` | Refreshed Manager compiled `54c931c68`, guide/checksums; earlier native proof retained as historical evidence |
| Linux refresh packet | `/ai/gchat/out/oi070-linux-refresh/` | Accepted `02d369e8a` assembly, compiled `54c931c68`, independent package/native proof; old packet path retained as stable symlink |
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
