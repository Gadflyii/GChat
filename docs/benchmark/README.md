# GBench Standard and Max Perf

Standard Benchmark uses one fresh resident server unchanged across C1, C4 and C8.
Each wave sends 2,048 input tokens and generates exactly 500 output IDs per lane.
Native v2 runs one warmup and one measured wave in each of its cold-prefill and
warm-generation phases; stored v1 runs have one pair per point. The server has
TP1, 8,181 context and capacity 8; graphs stay enabled. The cold phase disables
prefix reuse, and the warm phase enables it. The 131K/C8 workload is internal
capacity evidence and is not Standard Benchmark.

## Max Perf launch policy

Ron selected these version-1 release classes on October 11:

| Class | Artifact identity | KV | Drafter |
| --- | --- | --- | --- |
| Dense Qwen INT | `qwen3.8-27b/groupwise-int-dflash2-q4` | INT8 | Q4 DFlash2, fixed K7 |
| Dense Qwen NVFP4 | `qwen3.8-27b/nvfp4-dflash2-q4` | NVFP4 | Q4 DFlash2, fixed K7 |
| Flash SMOL | `qwen3.8-flash-next/smol-q2g64` | INT8 | MTP, fixed K3 |
| Flash INT | `qwen3.8-flash-next/groupwise-int` | INT8 | MTP, fixed K3 |

The native NVFP4 drafter is historical, not the release drafter. Muse and other
artifact classes have no Standard Max Perf definition in this decision.

Flash filenames now use `qwen38_flash_next_180b_<int|smol|nvfp4>_mtp[_tp2|_tp4].ginfer`.
The [model catalog](../model-management.md#release-package-names) uses these release
names after the completed artifact rename. Max Perf matches unchanged artifact identities; filenames
do not change its settings or add an NVFP4 Flash release class.

Host owns the immutable, versioned launch policy separately from the catalog of
physically qualified capacity profiles. Choosing Max Perf uses the normal model
launch/restart lifecycle, persists its identity and retains ordinary automatic
arena, prefill and host-memory admission. It supplies no new fixed memory cap or
qualification claim. The UI makes a restart explicit.

Standard records the selected Host session and profile version. Every native
report must match those facts and the same configuration across all three points.
A missing, changed or mismatched profile/session cannot produce a submit-ready
Standard result. Native signing repeats the profile/workload validation; the
public v1 payload field set remains unchanged.

## Current native report contract and gate

GChat consumes the current Engine's `ginfer-resident-benchmark-v2` report directly.
The effective workload and both `cold_prefill` and `warm_generation` phase policies,
round counts, token observations and finite timers must match the request. Standard
still enforces its version-1 Max Perf launch policy and immutable session/configuration.
The report version does not change benchmark settings or qualify a GPU/model.

Local methodology is `ginfer-resident-max-perf-v2`. Cold PP divides measured cold
computed tokens by summed native compute durations. Warm PP / request divides logical
input by summed per-lane native prefill durations across fully cached measured warm
waves; it is an effective per-request rate, not an aggregate physical compute rate.
Cached TTFT is a separate mean over warm measured waves. Missing individual lane timers
or incomplete cache observations leave the corresponding warm metric unavailable.
TG uses committed exact-concurrency decode tokens/time from measured warm generation;
the first prefill token is excluded. Local v2 scores exclude warmup waves.
The obsolete live v1 PP field is null; it is not an alias for warm v2 prefill.

Persisted/user v1 runs retain historical rendering and their external v1 submission
contract. On October 16 Bubbs approved this legacy projection for native v2 into
the unchanged `gbench-submission-v1` contract:

| Public field | Native v2 source |
| --- | --- |
| `methodology` | Literal `ginfer-resident-max-perf-v1`, identifying the public scoring view; the stored local result remains v2. |
| `configuration.engine_build` | The original native engine build, unchanged. |
| `points[].warmup` | `cold_prefill.warmup[0]`, never the measured cold wave. |
| `points[].measured` | `warm_generation.measured[0]`, never a merged or synthesized wave. |

All ten public wave fields retain their original counters and timers. Hardware,
configuration and identity keep the existing public whitelist. No phase details,
extra native metrics or private session fields enter the payload. The projection
requires complete C1/C4/C8 Standard results with matching Max Perf sessions and
one warmup/measured wave in both native phases; a malformed or mixed-version
result is refused.

The site keeps computing Cold PP from the projected warmup's computed tokens and
compute duration, historical PP from logical input and measured mean TTFT, and
TG from the measured wave's committed decode tokens and duration. These are v1
scores, not aliases for local v2 measured-cold or warm-prefill scores. The native
v2 phases and local metrics remain unchanged. No site, signing or upload change
is needed for this projection.

The separate MTP whitelist/upload blocker is closed: the site now admits `mtp`,
and Bubbs confirmed Ron uploaded the correction on October 15. This does not
qualify a live submission. `GBENCH_PUBLISHING_ENABLED=false` still prevents native
submission and ownership writes. The first live submission remains Ron's gate.
[Projection decision](../decisions/2026-10-16-project-native-v2-into-public-v1.md).

The native-v2 implementation is merged in GChat main `ca4346ba2`. Its accepted
focused gate passed eight owning Rust cases, strict library Clippy, 34 affected
frontend cases, typecheck and affected production lint. Existing missing/invalid
observation and persisted-v1 checks remain valid; production reader code is unchanged.
Evidence: `/ai/gchat/out/gchat-open-items-20261012/gbench-native-v2-note.md`.
[Decision](../decisions/2026-10-12-consume-native-v2-benchmark-phases.md).

### Saved report verification

The requested `gbench.py` producer was cancelled on October 14; no new tooling
is required. The gate uses an unmodified real native-v2 `benchmark.json` linked
from GInfer `docs/tip-scoreboard/gbench-scoreboard.md`:
`/ai/kernel-agent/run_workdir/local/c4-gbench-scoreboard-20261011/results/local5090-r1/dense-qwen-int/C4/benchmark.json`.
Its engine is `2cc592d4`, SM120a, dense Qwen INT. Its session is TP1,
8,181 context, capacity 8, INT8 KV, fixed DFlash2 K7, graphs and prefix reuse on,
Vision off. The C4 workload is 2,048 input / 500 output tokens per lane, one
warmup and one measured wave. Its workload matches Standard, but Vision off
does not match GChat's Max Perf profile. The gate preserves this report and
checks the expected rejection rather than treating it as submit-ready Standard.
This checks report consumption, not current-engine physical qualification or
a new performance result.

Acceptance: one owning Rust case must deserialize the full saved report, validate
its workload, reject the Vision profile mismatch, and score measured cold PP,
warm PP per request, cached TTFT and committed decode throughput. Warmup is excluded;
the historical v1 PP field remains null. The fixture is
`src-tauri/plugins/tauri-plugin-ginfer/src/fixtures/native-v2-scoreboard-c4.json`.
The prior projected C1 fixture remains separate non-Standard parser evidence.

Owner: GChat; candidate `/ai/gchat-worktrees/gbench-native-v2-saved-099`, branch
`fix/gchat-native-v2-saved-099`, baseline `099989c29`. The saved-report case
passed: deserialization, measured-phase scores, retained hardware evidence and
Vision-mismatch refusal. The initial fixture incorrectly expected Vision-off to
match Max Perf; the corrected fixture checks the intended rejection. Compilation
took 1.18 seconds with the accepted build container/cache; the case took 0.02
seconds. No production code, dependencies, Engine build, GPU run or public
submission changed. Evidence: `/ai/gchat/out/gbench-native-v2-saved-20261014/result.json`.
Next action: reviewed merge; retire the candidate after merge. Retained data is
the 54 KB real report fixture and concise verification evidence.

## Accepted Max Perf policy and session guard

`GCHAT-GBENCH-MAX-PERF-PROFILE` is closed for the versioned launch policy and
Standard session/configuration guard. Tested product `b5cf154b3` and final
acceptance record `d1b7325f1` are ancestors of reviewed main `1825d964e`.
The retained focused gates below qualify that implementation; no fresh physical
benchmark or performance result is claimed. The later saved native-v2 C4 report
gate also verifies rejection of its Vision-off configuration against the
Vision-on Max Perf policy. The approved public legacy projection is described
above; it does not qualify a physical run or live submission.

On October 11 the focused CPU gate passed eight Rust cases and twenty frontend
cases: four-class selection, launch argv/restart/persistence, stale-session and
actual-report refusal, native validation before signing/network, public v1
projection, profile selection and route dispatch. Strict Rust library Clippy and
frontend typecheck passed. Production frontend lint passed; the repository's
existing ignore policy excludes test files. No full suite or real submission ran.

Tested product source is `b5cf154b3`. Rust/unchanged submission checks are retained
from their earlier composed source; only the changed selector cases were repeated.
The gate corrected a new fixture's nonexistent Stop method, a fixture's missing
graph fact and the nullable UI selection. Container mount recursion and an
invalid Clippy CLI/binary target selection stopped their own stages; all claimed
passing results name actual execution. Evidence and limitations are in
`/ai/gchat/out/gbench-max-perf-profile-20261011/result.json`.

CPU booking 511 ended early at the gate's actual completion; owned containers
are absent and the canonical build guard was reacquired and released. The shared
cache remains; no model, Engine, user profile or public-board state was touched.
Current native-v2 reader integration and the closed site MTP whitelist/upload
blocker are described above. Physical GPU/model qualification, a successful
Standard C1/C4/C8 run and release/publication acceptance are separate from these
policy, refusal and report-consumption checks. Passing evidence is reused;
no model, benchmark or signing/network action was repeated for this closure.

Exact settings authority:
`/ai/coordination/flash-next/gbench-standard-settings.md`.
