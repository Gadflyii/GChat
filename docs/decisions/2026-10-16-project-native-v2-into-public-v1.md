---
date: 2026-10-16
title: "Project native v2 results into the public v1 report"
---

# 2026-10-16 — Project native v2 results into the public v1 report

- **Context:** Native v2 records independent cold-prefill and warm-generation phase pairs. The public site accepts `gbench-submission-v1`, derives cold prefill from its warmup wave and generation from its measured wave, and requires the public v1 methodology label. GChat previously refused native-v2 projection pending a reporting decision.
- **Decision:** Bubbs approved projecting `cold_prefill.warmup[0]` to public `warmup` and `warm_generation.measured[0]` to public `measured`, using `ginfer-resident-max-perf-v1` as the public scoring label. Preserve the original `engine_build`, every raw counter and timer, existing public fields, Standard workload, Max Perf session guards and stored-v1 support. Keep the local result, evidence and scores as v2.
- **Consequences:** The unchanged site computes its historical scores from genuine warmup/measured observations despite the newer acquisition procedure. Public PP remains logical input divided by measured mean TTFT; it does not become the local v2 warm-prefill rate. No schema, site, dependency, signing or network change is required. Publishing stays disabled, and the first live submission remains Ron's release gate.
- **Owner:** GChat.
- **Links:** [Benchmark authority](../benchmark/README.md); [historical public contract](2026-09-18-gbench-community-leaderboard.md); [local native-v2 semantics](2026-10-12-consume-native-v2-benchmark-phases.md).

Supersedes the native-v2 public-projection refusal in the October 12 decision and the September 18 decision's single-pair acquisition assumption for projected results. Historical stored-v1 behavior and local native-v2 scoring remain unchanged.
