# Use the Engine default for placed Ready

GInfer `019ad0c92` waits for completed expert placement before Ready on every
card and removes `--wait-for-residency-fill`. Host therefore removes its
GPU-name and small-VRAM wait policies. Catalog, custom, restored and benchmark
launches share the Engine default. The optional `progressive_ready` launch
field passes `--progressive-ready` only on explicit opt-in.

This supersedes the October 14 Flash policy and the earlier CMP-specific rule.
Engine placement and timeout accounting remain authoritative.
