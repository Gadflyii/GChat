# Wait for Flash-Next residency before Ready

Status: implementation requested by bubbs in the October 14, 2026 GChat queue.

The shared Host adds `--wait-for-residency-fill` to every Flash-Next launch,
using the inspected `.ginfer` model identity. Custom, catalog and restored
deployments therefore share the same Ready behavior. GBench's Flash Max Perf
profiles also declare this option so their expected and effective options agree.

The existing selected-CMP policy remains applicable to dense models. The Engine
default, context, concurrency, memory sizing and speculative settings are unchanged.
The Engine owns the residency wait and its warmup timeout. This startup policy
is separate from physical qualification of release artifacts and devices.
