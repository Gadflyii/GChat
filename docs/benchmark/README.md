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

## Current implementation and gate

Repository: GChat. Candidate:
`/ai/gchat-worktrees/gbench-max-perf-profile-42d`, branch
`feat/gbench-max-perf-profile-42d`, baseline main `42d8c401e`.
Source owners are Host launch policy, native benchmark/signing validation and
the benchmark UI. No model, profile or user-state copy is allocated.

Approved gate: focused per-class selection, session-mismatch refusal and
unchanged v1 report fields. No real submission; publishing stays disabled.
The current Engine's native-v2 phase report remains a separate compatibility row.
It must not be relabelled as v1 or used to claim current-runtime submission.
The site's `spec=mtp` rejection belongs to Ron's site row; this work does not
change PHP, MySQL or the public board.

Next action: compose those three owners, run the focused CPU cases and report
their actual result. Current implementation is untested.

Exact settings authority:
`/ai/coordination/flash-next/gbench-standard-settings.md`.
