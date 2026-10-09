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
