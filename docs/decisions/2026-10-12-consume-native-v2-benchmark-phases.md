---
date: 2026-10-12
title: "Consume native v2 benchmark phases with their measured scope"
---

# 2026-10-12 — Consume native v2 benchmark phases with their measured scope

- **Context:** The current Engine emits independent measured cold-prefill and warm-generation phases. GChat's live v1 reader expected top-level warmup/measured arrays, scored cold from discarded warmup and used logical input/TTFT PP. Those meanings cannot be silently projected onto native v2 or the public v1 board.
- **Decision:** Replace the live native reader with explicit v2 workload/phase validation and local v2 methodology. Score measured cold compute, cached warm prefill per request, separate cached TTFT and warm exact-concurrency generation from their native observations. Keep unavailable observations null. Preserve stored v1 results and public v1 projection, but refuse all native v2 submission until a public report/scoring decision exists.
- **Consequences:** Current native reports can be consumed without changing Standard/Max Perf settings or claiming comparability with historical v1 PP. Both phases retain warmup and measured evidence. Local UI labels name the scope. The public site's v2 contract remains an explicit unresolved decision; no conversion semantics are invented.
- **Owner:** @Gadflyii.
- **Links:** [Current authority, fixture provenance and gate](../benchmark/README.md); [unchanged Max Perf policy](2026-10-11-bind-standard-benchmarks-to-versioned-max-perf.md).
