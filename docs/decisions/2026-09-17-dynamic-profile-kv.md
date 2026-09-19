# Dynamic KV sizing in packaged profiles

Packaged profiles accept the same dynamic KV policy as custom launches: absent or
null `kv_arena_bytes` lets the engine size the pool after startup allocations while
preserving the requested headroom. Positive explicit arenas remain supported;
zero is invalid. No profile is silently converted between these policies.

For calculated smoke evidence, the measured available arena must cover the required
capacity, and an explicit arena must lie between those bounds. Pending dynamic
profiles retain their positive calculated requirement without inventing measured
capacity. Neither startup success nor dynamic sizing establishes full-context
qualification. Existing evidence tiers and memory-margin checks remain intact.

Catalog deserialization and host lifecycle tests cover dynamic profile selection,
disk persistence and restart. Only the Windows RTX 5090 Muse C4 catalog entry is
changed in the engine repository; other entries are not converted by this change.
