# GBench Standard and Max Perf

Standard Benchmark uses one fresh resident server unchanged across C1, C4 and C8.
Each point sends 2,048 input tokens and generates exactly 500 output IDs, with one
warmup and one measured wave. The server has TP1, 8,181 context and capacity 8;
graphs and prefix reuse stay enabled. The 131K/C8 workload is internal capacity
evidence and is not Standard Benchmark.

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
the first prefill token is excluded. Warmup waves are retained as evidence, never scored.
The obsolete live v1 PP field is null; it is not an alias for warm v2 prefill.

Persisted/user v1 runs retain historical rendering and their external v1 submission
contract. Native v2 cannot be converted or submitted to the public v1 board. The next
unresolved product decision is the public site's report/scoring contract for v2, including
its metric meanings; this task does not select a conversion, change the site or publish.
The site's MTP whitelist remains a separate row. Publishing remains disabled.

Owner: native-v2-report agent on Ron-9950X3D2. Baseline source `89e4a22f4`;
candidate `/ai/gchat-worktrees/gbench-native-v2-report-89e4`, branch
`fix/gbench-native-v2-report-89e4`, retained for review/integration. Existing stable main
and the earlier Max Perf candidate are not reset. No Engine build, model copy or live
benchmark is allocated. The existing shared cache `/ai/gchat/src-tauri/target` and
`/ai/gchat/node_modules` remain retained for existing consumers. CPU-only gate completed October 12 at 20:21:45Z after the prior owner released
the cache. Its container is absent and the canonical build guard was reacquired
and released. The unused 20:25–20:40Z slot was returned to the coordinator.

Acceptance: captured current v2 report parses and scores each supported measured phase;
missing/invalid fields are refused; unavailable native observations stay unavailable;
UI labels preserve scope; Standard mismatch checks and persisted/public v1 remain intact.
Focused gate passed eight owning Rust report cases, owning check and strict library
Clippy, 34 affected frontend cases, frontend typecheck and affected production lint.
The first frontend attempt corrected a misplaced test insertion; the next identified
an existing C4 profile assertion using an obsolete label. Its assertion now matches
the current tested-profile label, and the affected frontend stages passed.
No broad suite, native Engine/model/GPU run, public submit/delete, site edit or release.
Evidence and disk review: `/ai/gchat/out/gchat-open-items-20261012/gbench-native-v2-note.md`.

The parser fixture `src-tauri/plugins/tauri-plugin-ginfer/src/fixtures/native-v2-c1.json`
is a projection of the accepted saved report
`/ai/kernel-agent/run_workdir/local/c4-dense-int-ada-38c23bf20/local5090/stagec-pair-r2/current/C1/benchmark.json`.
It retains the original configuration, workload, corpus and consumed phase/wave values;
only unused hardware, lanes and additive diagnostics were omitted. Its 32K context and
three measured rounds are parser evidence, not Standard or physical qualification.
The producer authority is `src/serve/benchmark.cpp` in
`/ai/ginfer-worktrees/c4-oi126-next-2d162` at `2685ee10f`, especially `prefill_measurements` and phase
execution. Owned disk at handoff: 269 MiB candidate source, 12 KiB fixture; no
local build/model allocation. Disposable Vitest/TypeScript cache (56 KiB) was removed;
the root dependency symlink and shared caches remain for review/replay. Gate logs
and recipe under the handoff folder are retained as evidence. [Decision](../decisions/2026-10-12-consume-native-v2-benchmark-phases.md).

## Previous Max Perf gate evidence

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
That Max Perf candidate remains prior evidence. Current native v2 support is described
above; site MTP acceptance and release qualification remain separate open rows.

Exact settings authority:
`/ai/coordination/flash-next/gbench-standard-settings.md`.
