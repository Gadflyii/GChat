# Wait for small-VRAM Flash-Next residency before Ready

Status: superseded by [Engine-owned placed Ready](2026-10-15-use-engine-placed-ready-default.md).
The historical policy below used the pre-October 15 Engine contract.

The shared Host adds `--wait-for-residency-fill` to Flash-Next launches when
every selected GPU has known VRAM of at most 32 GiB. Larger VRAM classes,
including the 96 GiB PRO, retain progressive Ready until C4's fill-throughput
fix lands. This rule uses device memory, never a card-name list. Unknown VRAM
does not opt into the wait. Explicit custom waits remain available.

Bubbs reports Ready 21.9 → 25.0 s on the 24 GiB 4090, versus 42.9 → 66.5 s
on the 96 GiB PRO. The latter exceeds its 60 s gate, invalidating the earlier
all-Flash default. These are supplied measurements, not a new Host benchmark.

Custom, catalog and restored deployments share the policy. GBench's Flash
Max Perf profiles resolve the same option per selected GPU group so their
advertised and effective options agree. The existing selected-CMP policy is
unchanged. Context, concurrency, memory sizing, speculative settings and the
Engine default stay unchanged. The Engine owns the wait and its timeout;
this policy does not establish release-artifact or device qualification.
