# Host-aware model management

Status: host-aware management foundation implemented and verified. On 2026-09-09
the user expanded this same goal to build the missing profile system and interactive
launcher, with shared multi-instance lifecycle and complete GChat remote controls.
The missing preset interface is now implementation work, not an external prerequisite.

Current handoff: the launcher/control foundation is merged on both main branches.
The fleet catalog delivery adds 275 profiles in 36 editable catalogs: 105 retain
full-context evidence, four have calculated capacity with startup/short-smoke
evidence, and 166 are explicitly calculated/pending validation. This includes
C1–C8 text and Vision+DFlash for both available models on the authorized Linux
SM80/86/89/120a fleet and native Windows RTX4090/5090, with native NVFP4 variants
on Blackwell. Extra entries preserve existing draft/graph alternatives. All
catalogs passed the actual Rust profile reader; no pending entry is a physical
qualification claim. GInfer source and catalogs are merged at `6b0bfce`.
The subsequently authorized hygiene pass
removed obsolete task worktrees, builds and installers, preserving current
releases, source, model roots, selected evidence and other-session campaigns.
Remaining work is final packaging and the real installer/LAN/WebView walkthrough;
engine-dependent qualification is explicitly deferred, not a catalog blocker.

C8 graph choices: the user explicitly approved offering both graph-enabled and
no-graph profiles when each can be physically qualified. Investigate a smaller
context for the graph-enabled option before concluding it cannot fit; startup
graph reservation and runtime KV capacity are distinct constraints. Label the
execution mode clearly. The user clarified that validation covers package size,
per-GPU memory fit, full-context execution, correctness/accounting, headroom and
operations. Performance tuning is not part of this goal. Optional performance
checks must be brief, bounded smoke checks on the selected updated engine, not
repeated campaigns or a prerequisite for acceptance. Do not benchmark the outdated
engine. Existing timing fields are not release performance evidence. Revalidate
resource profiles against the updated engine before claiming they qualify it.
Graph-enabled Qwen C8 failed startup reservation on RTX4090 at 8192, 4096,
2048 and 512 context. Even the 512-context probe requested 6,785,633,536 bytes
against 5,891,972,608 available. No graph-enabled C8 profile is qualified on this
revision. Keep the qualified no-graph C8 option and graph-enabled C1/C2/C4
choices; revisit C8 with the updated engine instead of further shrinking context
or changing the obsolete planner.

## Outcome

Current acceptance update: finish and merge the text-only and Vision+DFlash
C1–C8 catalogs now, assuming the engine's Vision+DFlash restriction is corrected.
Vision+DFlash is the default selection; never silently substitute autoregressive
decoding or text-only operation. Preserve completed full-context evidence and
calculate remaining cohort capacity from target/codec allocation rules, actual
Vision residency and explicit conservative budget assumptions. Do not wait for
engine repair, repeat long context matrices or queue hours of model reloads.
Keep completed startup/short-smoke results; unexecuted or engine-blocked entries
are selectable `calculated-pending-validation` profiles with an explicit warning.
Record full-context-tested, calculated/startup/smoke-tested and pending profiles
as distinct evidence tiers in the shared catalog and user-facing selection.
Do not populate full-context request counts from calculations or describe a small
smoke test as proving full-pool execution. Unavailable hardware/packages stay
explicitly untested; SM coverage does not establish every SKU or TP topology.
This policy supersedes the remaining matrix and per-entry startup gates below, not the
requirements for exact artifacts, editable profiles, coherent host control,
platform separation, short lifecycle checks, final packaging or honest evidence.
Retain the selected 300 MiB guard and 500 MiB fallback where measured necessary.
The SM80 Qwen PP defect is tracked separately as GInfer `HARDWARE-002`; profile
completion does not resolve or conceal it.

Completed campaign output includes editable, prebuilt C1, C2, C3, C4, C5, C6,
C7 and C8 profiles for Qwen3.8 and Muse on every supported, physically qualified
SM/SKU and available exact TP degree. AutoRound uses INT8 KV and the exact
declared draft format. Blackwell additionally requires NVFP4 target weights,
NVFP4 KV and native NVFP4 DFlash2: Qwen `nvfp4-dflash2-nvfp4` and Muse
`nvfp4-dflash-nvfp4`. Existing NVFP4-target/INT8-KV/Q4-draft results do not
qualify these combinations. Availability of a registered identity or a compiled
route is not physical qualification; locate exact artifacts including required
KV calibration before testing. Missing packages/hardware remain explicit gaps.
For Muse, `kv_dtype=nvfp4` selects native NVFP4 long-context KV; its current
target contract keeps sliding KV in INT8 and draft cyclic KV in BF16. Do not
describe that option as converting every cache to NVFP4. Structural inspection
of the exact TP1 native-NVFP4 candidate found its required v2 calibration header
and finite positive full/sliding scale tables; this is not physical qualification.
The producer's complete read-only six-package reconstruction/manifest validator
subsequently passed on ginfer-tools `4926efa` using Python 3.11.15. This clears
the producer-validation prerequisite for native-NVFP4 physical fit checks, not
the physical qualification itself. The result is recorded in the operational
campaign state's `native-nvfp4-validation.json`.
Local RTX5090 native Muse subsequently passed C1/131,072 full-context execution
with 11,889,803,264 explicit arena bytes and a 500 MiB guard: 808,452,096 minimum
GPU-free bytes, 64 returned / 63 committed decode tokens, 13 graph rounds and
zero eager decode. Smaller reserves crossed live guards and remain failed fit
attempts. The final arena preserves model-maximum context and includes measured
execution allowance; it is not proof that startup autosizing alone is sufficient.
Native Muse Linux/WSL C1–C8 are now cataloged at model-maximum 131,072 context,
each with its own explicit arena and validated 500 MiB guard. All eight also
passed two host-managed start/generate/stop cycles, with distinct restart session
identities and unchanged saved profile options. Their catalog evidence links the
archived lifecycle reports. Numerical qualification, native Windows and WebView
integration remain separate gates.

CMP170HX Muse C1–C8 full-context profiles are cataloged at 131,072 context with
48,007,806,976 explicit arena bytes and a 300 MiB guard, tested at 180 W with
an 80 C core/HBM limit. All C1–C8 host lifecycle checks have passed. The batch's
one-hour limit interrupted C8 before its report completed; an isolated C8-only
retry then passed both cycles at the full 300 MiB guard, restored 250 W and
released the GPU. Completed profiles were not repeated. Power policy is external
to the profile, and the guarded runner restores the prior power limit on exit.
Native Qwen RTX5090 C1–C8 resource profiles are cataloged at contexts 262,144,
229,376, 148,480, 106,496, 80,896, 64,512, 52,224 and 43,008 respectively,
all with validated 500 MiB guards. C7/C8 were enlarged after their first fits
showed reclaimable headroom, then independently revalidated. All eight profiles
also passed two host-managed start/generate/stop cycles with exact saved options
and distinct restart sessions; the isolated host was stopped and its port/GPU
released. This establishes API lifecycle behavior, not native Windows, numerical
qualification or a WebView walkthrough. C5–C8 explicitly record mixed graph/eager execution: this runtime
captures adaptive W16 private verification only through C4. No all-graph claim
is made for those profiles.
AutoRound Muse RTX5090 C1–C8 also have passing full-context 131,072-token
resource profiles, with INT8 target KV, Q4 DFlash and 300 MiB guards. All eight
archived full-cohort reports match the saved explicit arenas and exact token
accounting, with thirteen graph decode rounds and zero eager decode. All eight
also passed two isolated host-managed start/generate/stop cycles with distinct
restart sessions and exact saved options. Their temporary host was stopped.
AutoRound Qwen RTX5090 C1–C8 full-context resource profiles now pass at
262,144, 184,071, 116,260, 83,673, 64,443, 52,420, 43,965 and 37,445 tokens
respectively, with INT8 target KV, Q4 DFlash and 300 MiB guards. Independent
report review confirms all saved arenas and exact full-cohort token accounting.
C1–C4 executed graph-only decode; C5–C8 correctly record mixed graph/eager
execution. All eight also passed two saved-profile start/generate/stop cycles;
independent review verified exact settings and sixteen distinct session IDs.
The isolated host exited and released its port/GPU. Linux RTX5090 fit and API
lifecycle coverage is now complete for both models in AutoRound and native
NVFP4; native Windows and the real GChat walkthrough remain separate gates.
Qwen RTX4090 has nine precise-context profiles covering C1–C8: graph-enabled
C1–C5, a 4K graph C6 choice, and larger-context eager C6–C8 choices. All nine
passed full-cohort resource checks and two host-managed start/generate/stop
cycles with exact saved options and distinct restart sessions. Each catalog entry
links its archived API lifecycle report; WebView validation remains separate.
RTX4090 Muse C1–C5 retain model-maximum 131,072 contexts. Its refined C6–C8
contexts are 108,411, 89,650 and 74,472, using unchanged explicit arenas and
300 MiB guards. Those three larger-context profiles passed fresh full-cohort
fits and their own two-cycle saved-profile lifecycle checks; no old-context
lifecycle result was relabeled. Both models' RTX4090 fit and API lifecycle
matrices are complete, and the temporary host/GPU were released.
RTX3090 Qwen has current-runtime C1–C8 fit coverage, with C1/C2 refinement and
host lifecycle still pending. The initial 8K-grid profiles remain valid evidence
of their tested settings, not claims of maximum capacity.
Native Windows RTX4090 Muse C1 now has separate physical evidence at its
131,072-token maximum: 5,574,230,016 explicit arena bytes, 627,048,448 minimum
free bytes against the 300 MiB guard, exact 131,009 prompt / 64 returned / 63
committed tokens, and thirteen graph rounds with no eager decode. The SM89
binary was built on Ron-9950X3D2 with CUDA 13.3/MSVC and executed on
DESKTOP-DG588BU under Windows driver 610.88. Its selected reports and provenance
are under `profiles/windows-sm89/rtx4090/muse-c1-ctx131072-explicit-margin300m/`
in the qualification archive. Native Windows RTX4090 Muse C1–C8 resource fits
are now complete and independently reviewed: C1–C5 use 131,072 context, with
C6/C7/C8 at 109,633 / 90,698 / 75,388. All eight met the 300 MiB guard and
executed thirteen graph rounds with no eager decode. Native saved-profile host
lifecycle checks are running separately. The current Windows host was built
offline in an isolated lane; its seven focused profile tests passed, including
explicit-arena and selected-headroom validation. This does not establish the
installer/WebView walkthrough.
Native Windows RTX5090 Muse native-NVFP4 C1 also passed at 131,072 context:
12,467,568,640 explicit arena bytes, 415,236,096 minimum free bytes against the
300 MiB guard, exact 131,009 prompt / 64 returned / 63 committed tokens, and
thirteen graph rounds with no eager decode. Its Windows-specific full-wave
measurement established the execution allowance; Linux values were not reused
as qualification. The separate SM120a build uses the same recorded runtime and
current benchmark sizing patch. Evidence is under
`profiles/windows-sm120a/rtx5090/muse-native-nvfp4-c1-ctx131072-explicit-margin300m-final-fit/`.
C2–C8 native Windows fits remain in progress; host lifecycle and GUI checks are
still separate requirements.

Use artifact layout calculations and measured startup/workspace/graph residency
to select the largest context candidate at each point, capped at 262,144 tokens
for Qwen and 131,072 for Muse. Start with 300 MiB per-GPU headroom and increase
to 500 MiB where fit/operation checks require it. Run bounded full-context fit,
start and inference checks, then verify host lifecycle/profile launch using the
saved explicit arena and settings. Calculations reduce trial runs; they do not
replace physical allocation, full-cohort admission or graph execution checks.
The initial 8K context grid is a coarse sizing screen, not a mandatory Engine
allocation unit. Preserve its passing profiles, but refine capacity-limited
choices against the target/codec's actual tail, alignment and growth requirements
before claiming maximum context. Qwen scalar KV uses a preferred 1,024-token
tail and can truncate its final tail to the configured context; do not infer an
8,192-token constraint from the initial test grid. Model-maximum points need no
context refinement.
Do not perform a throughput-tuning campaign for profile production.

Models is a lightweight control surface for this computer and paired GInfer hosts.
Select a destination, see installed models or compatible published recommendations,
and manage transfers on that destination. Do not copy LAN downloads through GChat.

Typing `ginfer` without arguments opens a simple text menu showing detected hardware
and compatible installed-model profiles. Selecting a profile starts serving without
requiring the user to calculate context, concurrency, or KV memory. The launcher and
GChat operate the same host-managed instances; advanced explicit CLI usage remains.

## Ownership

- GInfer owns executable artifact compatibility, topology validation, and runtime
  presets. Saved host launch configurations are not hardware-qualified presets.
- Release metadata owns exact package identity, SM qualification, per-rank memory
  requirements, TP degree, immutable source URL, bytes, and SHA256. Unpublished or
  incomplete entries must not become download actions.
- ginfer-host owns durable transfers and managed storage. Existing inventory roots
  remain read-only. Authenticated management does not expose arbitrary shell commands.
  It also owns instance persistence, GPU reservations, port assignment and process
  lifecycle, independently of any running ginfer-serve or connected GChat window.
- The launcher is a client of that host lifecycle, not a second process supervisor.
  GInfer's profile contract is shared by launcher, host and GChat; the desktop does
  not duplicate memory tables. Profile production and qualification belong to the
  producer/engine workflow, not runtime weight conversion or repacking.
- GChat owns host selection, recommendations, progress, explanations, and explicit
  lifecycle actions. Unknown capabilities are not guessed from GPU names.

## Implementation sequence

1. Add exact hardware/release compatibility contracts and tests; expose actual SM.
2. Add persistent bounded host transfers with resume, cancellation, checksum and
   artifact inspection before atomic publication. Preserve incomplete jobs on restart.
3. Expose host model management through the authenticated desktop bridge.
4. Build host-scoped Installed / Recommended / Downloads views, reusing lifecycle
   controls, with unavailable/offline reasons and advanced settings disclosure.
5. Connect local storage and download management without changing model ownership.
6. Define and implement the shared prebuilt profile contract and machine-readable
   profile listing/resolution. Update affected GInfer authorities and packaging as
   part of this explicitly approved cross-repository product change.
7. Build and qualify profiles by artifact, SM, per-GPU VRAM tier and TP degree;
   never mark an unmeasured configuration qualified. See the profile rules below.
8. Implement host-owned GPU/port reservations and lifecycle reconciliation, then
   connect the no-argument `ginfer` menu to that same authority. Package the host
   service with the launcher; preserve explicit inference commands and --help.
9. Extend GChat's existing host panel with profile selection and complete instance
   controls. Use the same service for local and remote managed instances and
   destination-owned downloads; remove competing project-owned supervision paths.
10. Verify the profile/launcher/host/GChat path end to end, including multiple
    instances, disruptive changes, restart recovery and supported platform packaging.

## Prebuilt profile rules

The selected profile policy is now 300 MiB headroom, increased to 500 MiB for
individual configurations when validation shows issues. This supersedes the
original 1 GiB profile requirement, not the manual/auto launch default. Find the
largest physically validated context for every C1–C8 point on both models, capped
at 262,144 tokens for Qwen and 131,072 for Muse. Preserve graph-enabled and
explicit no-graph alternatives; do not silently disable graphs to obtain a fit.
The initial RTX4090 C8/64K experiment passed
one full-context wave with matching Engine autosizing and live free-memory guard:
eight lanes each returned 64 tokens, with 13 graph decode rounds and no eager
decode rounds. Arena capacity was 4,089,446,400 bytes; the post-wave snapshot
reported 3,598,712,832 used and 490,733,568 free. Minimum sampled GPU free memory
was 635,437,056 bytes (606 MiB). This is reduced-margin fit evidence, not yet an
exact explicit-arena catalog qualification or a manual launch default change.
The larger RTX4090 C8/73,728 candidate also passed one full-context wave at
300 MiB: 4,089,446,400 arena bytes, 4,048,551,936 used, 40,894,464 free and
635,437,056 minimum sampled GPU-free bytes. All eight lanes returned 64 tokens;
15 graph decode rounds and no eager decode rounds were observed. Its exact
explicit-arena repeat also passed with the same sampled minimum free memory;
the measured settings are now recorded in the RTX4090 Muse catalog. An isolated
real host subsequently passed start, public eight-token generation, stop, restart,
public generation and stop with a new session identity and unchanged explicit
C8/73,728/INT8/300 MiB settings. Evidence is archived at
`profiles/sm89/rtx4090/muse-c8-ctx73728-host-lifecycle/lifecycle.json`.
This is local host-control evidence, not a WebView walkthrough. Updated-engine
requalification remains pending. Resource reports are archived under
`profiles/sm89/rtx4090/muse-c8-ctx73728-auto-margin300m/`.
Evidence is archived under the qualification NAS root at
`profiles/sm89/rtx4090/muse-c8-ctx65536-auto-margin300m/`; runtime was main
`922e5a8` plus benchmark sizing/report changes, not a newer engine qualification.

- Cover 16, 24, 32 and 64+ GB per-GPU tiers where a registered, available artifact
  has a qualified fit. Offer multiple concurrency/context choices, bounded by the
  engine's C1..8 contract, and TP1/TP2/TP4 where topology and exact packages allow.
- A profile identifies the exact artifact/storage and draft configuration, SM and
  GPU-group requirements, context limit, concurrency, KV policy and required runtime
  options. No summed VRAM, inferred TP package or runtime weight splitting.
- Keep profiles in standalone, human-editable JSON catalogs, not compiled tables.
  Document their location and refresh workflow; adding or revising a catalog must
  not require rebuilding GInfer or GChat. Changes need corresponding qualification.
- Record the qualified platform explicitly. Linux/WSL measurements do not qualify
  Windows; the host excludes other-platform profiles from GPU choices and launch.
- Qualified allocation leaves its selected 300 MiB (or validated 500 MiB) guard
  free per GPU after weights, workspaces, CUDA
  Graphs and KV allocation. Actual usable memory and TP rank requirements govern fit.
- Establish the arena using Engine autosizing with the intended execution settings
  and selected headroom before selecting context/concurrency candidates. Calculate the
  whole-cohort KV requirement, including growth/allocation overhead, then validate
  full-context operations with the exact resolved pool. Save those validated bytes
  in `options.kv_arena_bytes`; profile launch must pass them unchanged. Re-size when
  settings change the workspace/graph budget. Catalog validation rejects missing
  or zero arena sizes; custom launches retain automatic sizing. Review all earlier
  explicit-pool
  profiles, including passing ones, before final release. Preserve earlier evidence
  as evidence of its exact settings, never relabel it as autosized qualification.
- Context is the profile's supported limit, not necessarily the model's native max.
  A profile that supports 128K loads at 128K normally, with no warning merely because
  the model supports more. Show resolved settings; do not silently replace the
  user's selected profile under unexpected memory pressure.
- Blank/auto options use the selected prebuilt configuration; explicit advanced
  overrides are validated and shown as custom settings, not qualified profile values.
- Multiple instances use exclusive GPU groups by default: four TP1, two TP2,
  one TP4, or TP2 plus two TP1 can coexist on four suitable GPUs. Sharing one GPU
  between serving processes is not part of the simple profile path.

## Launcher and remote-control acceptance

- No-argument interactive launch shows hardware, compatible installed-model profiles
  and GPU availability, accepts a simple selection, then shows server address/status
  and stop instructions. Noninteractive CLI use must not hang on a menu prompt.
- Reserve a GPU group atomically before startup and allocate a nonconflicting port.
  Concurrent CLI/GChat starts cannot claim the same group; failed startup and process
  exit release ownership. Reconcile real process state after host restart rather
  than trusting stale reservations or terminating unrelated GPU users.
- Every launcher-started instance appears through the paired host in GChat, with
  model, profile, GPUs, TP, context, concurrency, port, lifecycle state and metrics.
- GChat can download to the destination host; create/start, stop and restart an
  instance; load/change/reload its model; and switch profiles (including C1 to C4).
  Restart ginfer-serve when startup-fixed settings change. Other instances continue.
- Confirm interruption of active requests before disruptive changes. Report loading,
  stopping, restarting and failure states accurately; do not publish the new model
  or profile as running before readiness succeeds.
- ginfer-host remains discoverable and controllable when all serving processes are
  stopped. Closing GChat or leaving the launcher does not kill managed serving or
  host-owned downloads. Service restart reconciles saved instances and transfers.
- Focused behavioral tests cover resolution, reservation races, unavailable groups,
  failed starts, model/profile restart and recovery. Real-device evidence must support
  each released profile's context/concurrency/headroom claim. A real CLI-to-GChat
  lifecycle check must demonstrate discovery, metrics and remote controls; mocked
  tests alone do not establish that integration or physical TP qualification.

## Acceptance

No invented release URLs or Smol artifacts, no aggregate-VRAM fit assumptions, no
automatic interruption of inference, no deletion of external model roots, no new
runtime dependency, and no commit/push unless requested. Existing uncommitted polish
work is preserved. Transfers survive closing the desktop; remote work requires no
desktop proxy. Public inference protocol behavior is unchanged.

## Delivered and verified

- Host-scoped Installed / Recommended / Downloads, shared host lifecycle controls,
  explicit unavailable/offline states, and a cross-host transfer count in navigation.
- Hardware matching from actual SM and per-GPU memory, with no VRAM summation or
  invented published packages. Exact release metadata gates every managed transfer.
- Durable destination-owned transfers, bounded streaming, HTTP Range resume,
  checksum/identity/TP checks, pause/retry, and explicit incomplete-file cleanup.
- Atomic local manifest/weights publication; existing first-model/default import
  policy is preserved without replaying old completed jobs on startup.
- Safe installed-package removal; loaded models are not automatically interrupted.
  External host inventory roots remain read-only. Fresh hosts can start without
  preinstalled models. First-run setup and reminders use the shared model manager.
- Shared polling and unchanged-state suppression. Superseded Hub filters, their
  tests/coverage target, and the old split onboarding picker were retired.

Validation: final `CARGO_INCREMENTAL=0 make verify` passed; GInfer extension build
passed; three Linux installer/preview checks passed; `git diff --check` passed.
Transfer tests cover resume, integrity rejection, restart, managed deletion,
atomic local publication/recovery, and default-import notification/deduplication.
The new NVIDIA query was checked on the local RTX 5090: SM 12.0, 32,607 MiB.

## Current integration evidence

The profiles below are text-only resource-fit checks on engine
`c8e0d4fd9e36c55789fda739a87d08ecf3de084b`, not performance claims and not
qualification for a newer engine. All use TP1/DTP1, DFlash with four draft tokens,
INT8 KV, and at least 1 GiB sampled free memory per GPU. Context is per request.

| Platform / GPU | Artifact | Recorded choices |
| --- | --- | --- |
| Linux/WSL RTX5090 | Qwen NVFP4 + DFlash2 Q4 | C1/128K, C2/64K, C4/32K, C8/16K, graphs |
| Linux/WSL RTX5090 | Muse NVFP4 with DFlash | C1/C2/C4/C8 at 128K, graphs |
| Windows RTX5090 | Qwen NVFP4 + DFlash2 Q4 | C1/128K, C2/64K, C4/32K, C8/16K, graphs |
| Windows RTX5090 | Muse NVFP4 with DFlash | C1/C2/C4 at 128K, graphs; C8 pending |
| Linux/WSL RTX4090 | Qwen groupwise INT + DFlash2 Q4 | C1/64K, C2/32K, C4/16K graphs; C8/8K no graphs |
| Linux/WSL RTX4090 | Muse groupwise INT + DFlash Q4 | C1/C2/C4 at 128K, graphs |
| Linux RTX3090 | Qwen groupwise INT + DFlash2 Q4 | C1/64K, C2/32K, C4/16K graphs; C8/8K no graphs |
| Linux RTX3090 | Muse groupwise INT + DFlash Q4 | C1/128K, graphs |

Exact artifact, pool, platform, revision, headroom and evidence paths are recorded
in GInfer's editable `config/launch-profiles/` catalogs. Selected reports,
resource observations, logs and telemetry are archived and byte-verified under
`/mnt/nas/AltaStratusAI/GInfer/qualification/launch-profile-qualification-20260909/profiles/`.
No build trees or binaries were archived.

The RTX3090 Muse C1 check used one full-context wave, no warmup or repetitions:
131,009 computed prompt tokens, 64 returned tokens, 63 committed decode tokens,
13 graph decode rounds and 2,375,024,640 bytes minimum sampled free memory.
Earlier passing cells used two full-context waves with matching per-lane output
digests. Windows Qwen digests matched the corresponding Linux results.

Failed configurations are not catalog entries. Qwen C8 graph startup failures
are described above. RTX5090 Qwen at 262K failed either headroom or an admission
invariant; the latter was reported to the engine owner. Oversized pools that
failed headroom were replaced with independently checked smaller pools.
On main `922e5a8`, RTX4090 Muse C8/128K with a 3 GiB INT8 pool passed the
sampled headroom guard (1,534,066,688 bytes minimum free) but failed to admit the
full eight-request qualification cohort. It is not a qualified profile.
Diagnosis: TP1 Muse INT8 long KV requires 6,864 bytes per token (13 full-attention
layers, two KV heads, K/V, 128 INT8 codes and two FP16 group scales per head).
The passing C4/128K report records exactly 3,598,712,832 arena bytes used, matching
that calculation. Independent C8/128K requires 7,197,425,664 bytes (6.703125 GiB),
before growth overhead, and cannot fit the chosen 3 GiB pool. The qualification
barrier correctly rejects a partial cohort instead of timing fewer active rows.
The C8/64K retry was stopped by the controller after this diagnosis: it also needs
3.3515625 GiB, exceeding the pool. Neither failure implicates the 1 GiB free-VRAM
guard. Calculate whole-cohort KV demand before another candidate; C8/48K needs
2.513671875 GiB of long KV. That C8/48K automatic-arena candidate subsequently
passed one full-context wave: 3,330,277,376 arena bytes, 2,699,034,624 used,
631,242,752 free and 1,394,606,080 minimum sampled GPU-free bytes. Its exact
resolved explicit-arena execution also completed successfully with the same
sampled minimum free memory. This retains the original 1 GiB guard and is not
the largest-context candidate under the new 300 MiB policy.
Corrected automatic startup preflight on the same RTX4090 C8/128K configuration
resolved 3,330,277,376 arena bytes with 1,073,741,824 bytes headroom. A resident
localhost server then reached readiness and held 22,809 MiB used / 1,330 MiB free;
the earlier roughly 19 GiB display was an intermediate startup reading. No arena
capacity claim is inferred from that transient. Re-size at the selected smaller
context before validating and recording its exact arena.

Server2 startup-only autosizing checks passed for Muse INT8 KV with graph decode:
RTX3090 C4/128K resolved 4,966,449,152 arena bytes; CMP170HX C1/128K resolved
48,414,654,464 bytes, both with 1 GiB headroom. These are allocation results, not
full-context qualifications. The RTX3090 automatic C4/128K execution was stopped
by its original 1 GiB sampling guard at 1,072,693,248 bytes free (1 MiB below
the guard), before completion; no passing claim is made. Re-size under the selected
300 MiB policy rather than relabeling that stopped run. The subsequent 300 MiB
automatic run also stopped 1 MiB below its guard, at 313,524,224 bytes free.
The next candidate reserves 500 MiB plus 2 MiB additional allocation allowance:
5,513,805,824 explicit arena bytes derived from the measured startup budget.
Its live guard remains the full 500 MiB; the cause of the 1 MiB discrepancy has
not been established. The explicit C4/128K candidate passed with 525,336,576 bytes
(501 MiB) minimum sampled GPU-free memory: all four lanes returned 64 tokens,
with 13 graph decode rounds and no eager decode. The RTX3090 Muse catalog now
records those exact settings and NAS evidence; host lifecycle validation remains.
The CMP170HX
preflight ran at 180 W, peaked at 30 C core / 45 C HBM and restored its prior
250 W limit, confirmed by a subsequent live query. Its execution check uses the
same 180 W / 80 C guard and independently attempts power restoration even if
owned-process cleanup fails. Full-context C1/128K execution subsequently passed
at the original 1 GiB guard, with 60 C peak core / 65 C peak HBM and verified
250 W power restoration. This is not yet a 300 MiB explicit-arena profile.

### Shared launcher and owner

- One private per-user `local-host.json` locator is implemented. Concurrent first
  registration, preservation of malformed records and adoption of an existing
  owner passed on Linux and native Windows. Explicit state-directory commands
  remain isolated. Existing engine and model/cache roots are preserved.
- The no-argument GInfer menu delegates to ginfer-host. Real Linux PTY tests
  checked cold bootstrap, hardware/menu display, noninteractive rejection,
  second-install adoption and host persistence after quitting.
- A real Linux RTX5090 profile test launched C1/128K through the menu, completed
  host-routed chat, verified persistence after quit, restarted to a new session,
  and stopped serving without stopping the host. A release-host test switched
  the same instance from C1/128K to C4/32K and checked resolved settings and
  forwarded Engine metrics. This tests the API used by GChat, not WebView clicks.
- Host state locking and the engine owner pipe prevent competing owners and
  orphan serving processes. Focused tests cover lock release, child lifetime,
  duplicate starts, restart, saved settings, authenticated forwarding and SSE.
- GChat model load/unload, CLI forwarding and downloads use the shared owner.
  Superseded direct-child/PID supervision was removed. Transfer tests cover
  resume, exact publication, inventory visibility, preservation and removal.
- Windows bootstrap and PowerShell pipeline tests verified client exit while
  the detached host stayed alive. Native Windows host tests and desktop
  compilation passed. No live Windows installer or WebView walkthrough was run.
- A temporary real host on WSL4090 passed LAN access from this workstation:
  certificate-pinned TLS pairing, unauthenticated snapshot rejection, one-use
  code replay rejection, authenticated snapshot/scan and actual RTX4090 inventory.
  No credentials appeared in its public snapshot, and no instance or model was
  started. An opt-in real-LAN test then exercised GChat's native `Discovery`
  implementation and resolved the remote host ID and expected LAN HTTPS origin
  through mDNS. Both owned temporary host runs were stopped afterward. This is
  real LAN discovery and transport/control evidence, not WebView interaction or
  remote inference lifecycle qualification. Re-run the discovery check with
  explicit `GINFER_LAN_HOST_ID` and `GINFER_LAN_HOST_URL` using
  `cargo test --manifest-path src-tauri/ginfer-host/Cargo.toml --test discovery_live -- --ignored`.

### Packaging and verification

- Current profile integration candidates are assembled without rebuilding the
  engine or installing into the user's profile. Linux outputs are under
  `/ai/ginfer/out/profile-integration-20260910/linux/`: the host-only archive
  contains all 172 Linux profiles; the SM120a runtime bundle contains its 72
  RTX5090 profiles, including preserved alternate draft formats. Extracted
  catalog values exactly match source. The three executable help routes and
  three packaging contract tests passed.
  The Windows candidate is
  `C:\ai\kernel-agent\run_workdir\Ron-9950X3D2\windows-profile-candidate-20260910\distribution\ginfer-bundle-0.1.0-windows-x86_64.zip`.
  It contains the 64 core RTX5090 text/Vision profiles, a host rebuilt from
  `d12420d2e`, and the previously tested `922e5a8` runtime. ZIP integrity,
  manifest, profile inventory, ten native host tests and executable help routes
  passed. These are integration candidates, not newly qualified engine releases;
  Qwen Vision+DFlash still requires the independent engine fix. No models,
  user installation, chat history or application settings were changed.
  The catalog source is already committed and pushed on both main branches.
  Remaining hands-on integration is the installer/LAN/WebView walkthrough below,
  not another calculation or full-context campaign.
- Standalone Windows and Linux setup offer editable approved per-user paths,
  preserve an existing owner, verify runtime integrity and refuse overwrites.
  Fixture tests cover installation, preview and second-install adoption without
  changing live user configuration, PATH or models.
- Linux staging copies explicit CLI/server builds, private FFmpeg/CUDA libraries
  and licenses, fixes relative library paths on copies and checks resolution.
  The relocated runtime and temporary installed CLI/server/host help routes
  passed. The helper is now integrated into primary GInfer at
  `tools/stage_linux_runtime.py`; focused package/setup tests passed.
  The integrated primary-source build was subsequently staged and packaged with
  the release host and eight matching RTX5090 profiles. The combined archive at
  `/ai/ginfer/out/releases/ginfer-bundle-0.1.0-linux-x86_64.tar.gz`
  passed extraction and installation into dedicated temporary directories; all
  three installed executable help routes and the installed catalog were checked.
  Other-SM profiles were not bundled with this SM120a-only runtime. Live user
  installation, PATH, model roots and host registration were unchanged.
- The isolated Windows integration tree includes the native port on engine c8,
  including exact MSVC service-cost arithmetic. Native builds, arithmetic and
  owner-pipe tests passed. The port is now integrated into the primary GInfer
  working tree, preserving its newer launcher documentation and existing edits.
  Integrated implementation files match the native-tested isolated source.
  Linux scheduler arithmetic, termination, owner-pipe and artifact-reader checks
  (including concurrent positional and short-tail reads) passed directly from
  the primary source. The integrated primary source then passed a native
  SM120a/CUDA13.3 Release build of CLI/server and six focused CTest checks:
  artifact reader, scheduler arithmetic, termination, request logs, owner pipe
  and serving options. Both executable help routes passed without inference.
  Git commit/merge/push are complete; final release checks remain pending.
  Preservation audit of `/ai/ginfer-windows`: the branch has no commits absent
  from main. Its 32 modified tracked files and 13 new files are represented in
  the integrated tree. Differences were reviewed: Linux retains main's private
  FFmpeg contract, Windows uses the same `ginfer_ffmpeg` target; shared exact
  service-cost arithmetic supersedes the older inline MSVC implementation;
  active launcher/serving documentation is more complete; token-count test
  differences are formatting only. No unique implementation was left behind.
  Keep the old checkout until the integrated source is committed and pushed;
  then its stale port/build copy is eligible for the requested cleanup.
- GChat 2.0.27 NSIS and MSI rebuilt with that explicit SM120a runtime and four
  Windows Qwen profiles. Runtime integrity and MSI profile inclusion were
  checked. No installer was executed in the live environment.
- Catalog delivery is implemented for standalone/OS-service installers and
  GChat desktop resources. Explicit same-platform catalogs combine beside the
  host; a state-directory override wins, including an intentional empty catalog.
  Invalid overrides remain visible errors. Downloaded release profiles contribute
  only after exact artifact publication and disappear on managed removal.
- Full GChat `make verify` passed with 19 Linux entries, including both
  no-graph Qwen C8 profiles. The subsequent RTX3090 Muse entry passed JSON
  validation; `cargo check` then passed with all 20 entries explicitly selected,
  and the staged resource includes that entry. Full `make verify` subsequently
  passed with all 20 entries after adding the opt-in real-LAN discovery test;
  that opt-in test also passed separately against WSL4090. Package/setup
  tests and `git diff --check` also passed after Linux staging integration.
  Clippy was installed with user approval and passed with existing style warnings.

## Remaining completion gates

After the headroom-policy change, full GChat `make verify`, focused profile tests,
host `cargo check` and host Clippy passed; Clippy retained two existing style
warnings. These checks validate metadata enforcement, not physical profile fit.
The subsequent explicit-arena requirement passed all 36 host unit tests,
`cargo check`, Clippy and a complete `make verify` rerun. Existing catalogs keep
their recorded settings; missing/zero prebuilt arenas now fail validation while
custom automatic launch remains supported.
The menu and GChat profile selector enumerate catalog entries without filtering
concurrency to powers of two, so C3/C5/C6/C7 require no selector change. At engine
main `095e3a4`, `src`, `include` and top-level `CMakeLists.txt` are unchanged from
tested `922e5a8`; the intervening commits are benchmark work. Preserve recorded
evidence revisions and requalify if the selected release changes runtime behavior,
rather than repeating physical tests solely for a benchmark-only commit.

Additional explicit-arena full-context checks on that runtime passed:
RTX4090 Muse C3/131,072 with 4,999,610,368 arena bytes and 627,048,448 minimum
free bytes; CMP170HX Muse C8/131,072 with 48,007,806,976 arena bytes and
314,572,800 minimum free bytes. Both use INT8 KV, Q4 DFlash K4, TP1/DTP1,
the 300 MiB guard, 64 returned tokens per lane and 13 full-cohort CUDA Graph
decode rounds with no eager decode. Exact settings are now in the per-SKU
catalogs; these are resource-fit checks, not performance qualifications.
The CMP run used the requested 180 W limit, peaked at 67 C core / 71 C HBM,
and restored its prior 250 W limit. Its power policy remains external to the
profile. Selected reports are archived under the corresponding
`launch-profile-qualification-20260909/profiles` SKU directories. Lifecycle
checks for these two entries remain pending.

RTX4090 Muse C5/131,072 also passed autosized and saved explicit-arena execution:
4,622,123,008 arena bytes, 627,048,448 minimum free bytes, 4,498,391,040 KV bytes
used and 123,731,968 free. All five lanes returned 64 tokens; accounting reports
655,045 computed prefill, 315 committed decode and 320 returned tokens, with
13 full-C5 graph rounds and zero eager decode. The catalog now includes this
model-maximum context point. Selected reports are in
`profiles/sm89/rtx4090/muse-c5-ctx131072-explicit-margin300m/`; host lifecycle
qualification remains pending.

RTX4090 Muse C6/106,496 passed auto and explicit execution with a 4,464,836,608-byte
arena, 627,048,448 minimum GPU-free bytes, 4,385,931,264 KV bytes used and
78,905,344 free. All six lanes returned 64 tokens; 13 full-C6 graph rounds and
zero eager decode were observed. The 114,688-token startup probe resolves the
same arena but requires 4,723,310,592 KV bytes, establishing 106,496 as the
largest tested 8,192-token-grid cohort context. Exact settings are cataloged;
evidence is at `profiles/sm89/rtx4090/muse-c6-ctx106496-explicit-margin300m/`.
Host lifecycle remains pending.

RTX4090 Muse C1/C2/C4 were requalified on the same runtime with their existing
explicit 4 GiB / 4 GiB / 3.5 GiB arenas and the 300 MiB guard. Minimum free bytes
were 1,855,979,520 / 1,591,738,368 / 1,648,361,472; each lane processed 131,009
prompt tokens and returned 64 with 13 graph rounds and zero eager decode.
Their catalog evidence now names these current-runtime runs. This completes
RTX4090 Muse C1–C8 resource-fit coverage, not host lifecycle or release-wide
qualification. Selected reports use `muse-c{1,2}-ctx131072-explicit4g-margin300m-requal`
and `muse-c4-ctx131072-explicit3p5g-margin300m-requal` under the SKU evidence root.

RTX4090 Muse C7/81,920 passed auto and explicit execution: 4,307,550,208 arena
bytes, 627,048,448 minimum GPU-free bytes, 3,936,092,160 KV bytes used and
371,458,048 free. Seven lanes returned 64 tokens each, with 13 full-C7 graph
rounds and zero eager decode. The next 90,112-token segment requires
4,329,701,376 bytes; its startup probe resolves the same arena, 22,151,168 bytes
short. The exact 80K profile is cataloged; lifecycle remains pending. Evidence:
`profiles/sm89/rtx4090/muse-c7-ctx81920-explicit-margin300m/`.

RTX3090 Qwen C1/172,032 with a 5,828,378,624-byte explicit arena held at least
301 MiB GPU-free but exceeded the operational runner's one-hour limit before
producing its completion report. This is inconclusive, not OOM or qualification.
Earlier 65,536-context evidence took about 529 seconds for prefill; quadratic
attention scaling suggests this larger point can exceed an hour, but does not
prove that it will complete. The unchanged candidate is being checked with a
bounded two-hour deadline and the same 300 MiB guard. The operational runner
now records timeout failures and cleans up its child; a one-second timeout
check verified that behavior. The bounded retry subsequently passed in 4,664
seconds with 315,621,376 minimum free bytes, 171,969 prompt tokens, 64 returned
and 63 committed decode tokens, six graph rounds and zero eager decode. Its
5,813,305,344 used KV bytes fit the saved 5,828,378,624-byte arena. The 168K
C1 profile is now cataloged; selected evidence is at
`profiles/sm86/rtx3090/qwen-c1-ctx172032-explicit-margin300m-timeout7200/`.
The original timeout remains inconclusive evidence, not an additional passing
cell. Saved-profile host lifecycle remains pending.
RTX3090 Qwen C2 startup probes at 262,144 and 81,920 context resolve the same
5,415,239,680-byte arena. The 81,920-token cohort needs 5,536,481,280 bytes,
so the largest 8,192-token-aligned candidate is 73,728 per request. Its full
execution check passed with 5,413,142,528 explicit bytes (2 MiB allocation
allowance below startup autosizing) and the unchanged 300 MiB live guard:
315,621,376 minimum free bytes, 147,330 prompt / 128 returned / 126 committed
decode tokens, six full-C2 graph rounds and zero eager decode. KV used
4,982,833,152 bytes. The 72K C2 profile is cataloged; selected reports are at
`profiles/sm86/rtx3090/qwen-c2-ctx73728-explicit-margin300m/`, with its two
startup probes in the corresponding preflight folders. C3 sizing is underway;
saved-profile lifecycle remains pending.
For C3, the smaller 49,152-context startup probe resolved a larger arena than
the model-maximum probe. The full execution candidate is now 47,997 tokens
per request with 4,865,785,856 explicit arena bytes. Exact reservation simulation
uses 1,024-token preferred tails, truncated final tails and a 15-draft
verification window: the three lanes reserve 4,865,743,872 bytes; one extra
context token per lane would require 4,865,845,248, exceeding this saved arena.
This precise candidate is running and is not yet qualified.

RTX4090 Qwen C1/147,456 passed saved explicit execution with 5,037,359,104
arena bytes and 627,048,448 minimum free bytes against the 300 MiB guard.
Accounting was 147,393 prompt / 64 returned / 63 committed decode tokens,
with six graph rounds and zero eager decode. KV used 4,982,833,152 bytes.
The next 155,648-token context needs 5,259,657,216 bytes; its startup probe
resolves the same arena, 222,298,112 bytes short. The 144K C1 profile is now
cataloged; evidence is at `profiles/sm89/rtx4090/qwen-c1-ctx147456-explicit-margin300m/`.
Saved-profile lifecycle remains pending. C2 subsequently passed at 65,536
context per request with a 4,624,220,160-byte explicit arena and 627,048,448
minimum free bytes. It reported 130,946 prompt / 128 returned / 126 committed
decode tokens, six full-C2 graph rounds and zero eager decode; KV used
4,429,185,024 bytes. The next 73,728-token cohort needs 4,982,833,152 bytes,
which exceeds its independently measured startup arena. C2 is cataloged with
evidence at `profiles/sm89/rtx4090/qwen-c2-ctx65536-explicit-margin300m/`.
C3 also passed and is cataloged at 32,768 context per request, with a
3,932,160,000-byte arena, 893,386,752 minimum free bytes, exact
98,115 prompt / 192 returned / 189 committed decode tokens, 24 full-C3 graph
rounds and zero eager decode. The next 40K cohort exceeds its measured startup
arena. Evidence: `profiles/sm89/rtx4090/qwen-c3-ctx32768-explicit-margin300m/`.
C4 passed and is cataloged at 24,576 context per request, with a
3,376,414,720-byte arena, 1,071,644,672 minimum free bytes, exact
98,052 prompt / 256 returned / 252 committed decode tokens, six full-C4 graph
rounds and zero eager decode. Evidence:
`profiles/sm89/rtx4090/qwen-c4-ctx24576-explicit-margin300m/`.
C5 at 262K failed startup reservation (6,236,563,200 requested versus
5,891,972,608 available); this does not establish graph infeasibility at a
capacity-appropriate smaller context. C5–C8 sizing continues with smaller
startup probes and unchanged graph mode, stopping on unresolved failure.

RTX4090 Muse C1–C7 subsequently passed real host start, eight-token public
generation, stop, restart, generation and stop. All 14 cycles preserved every
catalog option, context, concurrency and profile ID; each restart produced a new
session identity. Together with the earlier C8 lifecycle result, this completes
the SKU's Muse C1–C8 resource-fit and host-API lifecycle checks. Reports are at
`profiles/sm89/rtx4090/muse-c{1..7}-host-lifecycle-margin300m/lifecycle.json`.
The isolated host was stopped afterward. This does not replace the remaining
multi-host GChat/WebView walkthrough.

Native-NVFP4 Muse RTX5090 C5/C6 at 131,072 context passed saved explicit arenas
of 11,316,232,192 / 11,209,277,440 bytes, with 796,917,760 / 791,674,880 minimum
free bytes against the 500 MiB guard. Each lane returned 64 tokens; both checks
recorded 13 full-cohort graph rounds, zero eager decode and exact prompt/output
accounting. The Linux catalogs now include these resource-fit results. Evidence:
`profiles/sm120a/rtx5090/muse-native-nvfp4-c{5,6}-ctx131072-explicit-margin500m-execution-fit/`.
Native Windows, independent numerical qualification and host lifecycle are not
established by these checks.

Native-NVFP4 Muse RTX5090 C7/C8 also passed at 131,072 context, completing
C1–C8 Linux/WSL resource-fit coverage for that exact combination. Arenas are
11,093,934,080 / 10,957,619,200 bytes; minimum free memory is 792,723,456 /
788,529,152 bytes against the 500 MiB guard. Both passed exact per-lane
accounting, 13 full-cohort graph rounds and zero eager decode. C7/C8 are
cataloged with selected reports at
`profiles/sm120a/rtx5090/muse-native-nvfp4-c{7,8}-ctx131072-explicit-margin500m-execution-fit/`.
All eight saved profiles subsequently passed an isolated host lifecycle: two
ready/public-eight-token/stop cycles per profile, distinct restart sessions and
exact resolved catalog options, context, concurrency, profile ID and GPU UUID.
The 16 cycles are archived as
`profiles/sm120a/rtx5090/muse-native-nvfp4-c{1..8}-ctx131072-host-lifecycle/lifecycle.json`.
The isolated host stopped cleanly and released its port/GPU. Independent
numerical, native Windows and multi-host WebView gates remain separate. The
local GPU is now assigned Qwen native-NVFP4 C1 sizing and resource-fit checks.

Native-NVFP4 Qwen RTX5090 C1 passed full 262,144 context with a
9,141,485,568-byte explicit arena and 500 MiB guard: 601,882,624 minimum
free bytes, exact 262,081 prompt / 64 returned / 63 committed decode tokens,
six graph rounds and zero eager decode. Native KV used 4,957,667,328 bytes.
Earlier near-guard attempts stopped safely; a complete 6 GiB diagnostic run
measured a 564 MiB startup-to-execution free-memory gap. The final arena uses
that full-wave evidence plus observed-baseline allowance, not an assumed new
runtime allocation. The Linux profile is cataloged; reports are at
`profiles/sm120a/rtx5090/qwen-native-nvfp4-c1-ctx262144-explicit-margin500m-final-fit/`.
Native Windows, independent numerical and host lifecycle checks remain separate.
C2–C8 sizing uses each concurrency's own startup budget and native codec layout.

CMP170HX Muse C4/131,072 passed the same 48,007,806,976-byte explicit arena
and 300 MiB guard: 853,540,864 minimum free bytes, 67 C core / 71 C HBM peak,
four lanes returning 64 tokens and 13 full-cohort graph rounds with no eager
decode. The prior 250 W limit was restored after the 180 W test. C4 is now
cataloged alongside C5–C8; evidence is at
`profiles/sm80/cmp170hx/muse-c4-ctx131072-explicit-margin300m-180w/`.
C3 subsequently passed the same arena and context: 1,029,701,632 minimum
free bytes, 66 C core / 70 C HBM peak, exact 393,027 prompt / 192 returned /
189 committed decode tokens, 13 full-C3 graph rounds and zero eager decode.
Its 250 W restoration was verified and selected evidence archived in the
corresponding `muse-c3-ctx131072-explicit-margin300m-180w/` folder. C3 is
cataloged. C2 then passed and was cataloged with the same arena/context:
1,256,194,048 minimum free bytes, 65 C core / 69 C HBM peak, exact
262,018 prompt / 128 returned / 126 committed decode tokens, 13 graph rounds,
zero eager decode and restored 250 W power. Its reports are archived in the
corresponding C2 folder. C1 also passed at model-maximum context, with
1,480,589,312 minimum free bytes, 62 C core / 68 C HBM peak, exact
131,009 prompt / 64 returned / 63 committed decode tokens, 13 graph rounds,
zero eager decode and restored 250 W power. Its selected reports are archived
in the corresponding C1 folder. This completes cataloged CMP170HX Muse C1–C8
resource-fit coverage. All eight saved profiles also passed isolated host-managed
start/generate/stop/restart/generate/stop checks under the same 180 W / 80 C
controls. C8 completed in a separately bounded retry after the original whole-batch
timeout; no passing C1–C7 lifecycle was repeated. The catalog links each lifecycle
report, and prior 250 W power was restored. This is API lifecycle evidence, not a
GChat WebView walkthrough.

CMP170HX Qwen C1 at 262,144 context reached the original 7,200-second test
deadline without a completion report. Minimum free memory was 316,669,952 bytes,
peak core/HBM temperatures were 72/74 C, and the runner restored 250 W. This is
archived inconclusive timeout evidence, not a fit failure or qualification.
The same 48,649,535,488-byte arena is retrying without another startup probe,
using a four-hour deadline and unchanged 180 W / 80 C / 300 MiB controls.
Subsequent full-wave deadlines scale with cohort size and context; the request
pending timeout matches the operational deadline to avoid expiring queued lanes.

RTX3090 Qwen C7 now has a qualified graph-enabled 4,096-token choice with an
explicit 3,775,266,816-byte arena and 300 MiB guard: 28,231 prompt tokens,
448 returned tokens, 441 committed decode tokens and twenty full-C7 graph rounds.
Minimum sampled free memory was 315,621,376 bytes. C8 at the same graph-context
boundary failed before inference: the startup reservation required 7,330,034,176
bytes against 6,685,089,280 available. That is a failed configuration, not proof
that every smaller graph configuration fails. Explicit no-graph C7/C8 choices
subsequently passed at 17,609 and 14,469 tokens respectively, with 4,165,337,088
and 3,911,581,696 arena bytes. Minimum sampled free memory was 315,621,376 and
338,690,048 bytes; exact full-cohort accounting passed with nine and seventeen
eager decode rounds. Both choices are cataloged alongside the C7 graph option.
Qwen now has current-runtime resource-fit coverage at C1–C8 on the RTX3090;
C1/C2 capacity refinement and saved-profile lifecycle remain pending. The missing
RTX3090 Muse cells have now completed C1–C8 full-context resource-fit checks.

1. Finish the catalog/source handoff on main. Do not relabel old fit results as
   new-engine qualification. Pending entries assume the corrected engine and
   retain their declared Vision/DFlash modes; runtime validation remains explicit
   follow-up work, not a blocker for this catalog delivery.
2. Complete C1–C8 calculated profile coverage for both models where exact artifacts
   and authorized hardware exist: RTX4090, RTX3090, local RTX5090, native Windows,
   64+ GiB and homogeneous TP2/TP4. Include AutoRound/INT8 KV and the Blackwell
   native-NVFP4 target/draft/KV combination defined above; existing Q4-draft
   NVFP4-target profiles do not fill that combination. Preserve already completed
   cells; do not resume the long validation matrix. No 16 GiB Smol package or homogeneous TP4
   inventory is currently available in this task. Verify availability before use;
   record unavailable prerequisites without inventing qualified profiles.
   Server1 requires an explicit coordinated release before execution;
   Server2's heterogeneous GPUs are independent TP1 devices, never a TP2 group.
   The user explicitly authorizes local RTX5090, WSL RTX4090 and both Server2
   GPUs. Server2's unlocked CMP170HX reports a 65,536 MiB framebuffer (the
   Engine sees 64,912 MiB after protected reservation) and can supply 64 GiB-class
   TP1 coverage if its exact artifact and operational checks pass. The user lifted
   the prior 8,192-token ceiling for this profile work: context is limited by the
   registered model and measured capacity. Use 180 W and stop at 80 C on either
   core or HBM; monitor during execution and restore the previous power limit
   afterward, including failure cleanup. Keep these controls local to this profile
   task rather than modifying another session's suspended campaign policy.
   The user subsequently explicitly handed Server2 to this session. Direct
   inspection found the existing controllers already suspended, with only zombie
   children and no GPU clients; leave them suspended and preserve their state.
   The takeover is recorded in the shared mailbox. This inventory does not
   supply homogeneous TP2/TP4.
3. Complete the real multi-host launcher-to-GChat control walkthrough and native
   Windows installer/menu/WebView walkthrough. Mocked tests and single-host
   API evidence do not establish those results. Coordinate host ownership before
   deployment; do not disturb other sessions or their inference processes.
   Built-in Windows UI Automation is available, but GChat has no complete isolated
   application-profile switch: `CI=e2e` does not isolate thread/database and WebView
   storage. Do not launch with guessed overrides. Approval to use the existing
   Windows profile after the local GPU tests, or a user-operated walkthrough,
   is pending; preserve existing chats/models and restore test-only settings.
4. Assemble final selected-platform bundles with all accepted catalogs and the
   selected engine runtime. Check the packaged contents and rerun affected
   integration checks. Existing archives have different catalog selections;
   do not treat every old archive as the final distribution.
5. Preserve the completed source handoff and hygiene state. Retain only current
   operational builds and selected release outputs; archive selected qualification
   evidence, not stale binaries. Coordinate ownership before further cleanup and
   preserve models, active jobs and other-session work. Commit further changes
   only when requested.

Public release feeds and exact published model URLs remain producer-owned release
inputs. No URLs, Smol packages, hardware measurements or qualification were invented.
The goal remains unfinished and the user has authorized continuing these gates;
packaging success alone does not complete it.
