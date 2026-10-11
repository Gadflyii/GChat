# Bind Standard Benchmark to versioned Max Perf launches

Standard previously fixed its request sizes but inherited whichever server
profile was loaded. That allowed incomparable contexts, KV codecs, drafter
settings and concurrency capacities to reach submission.

Host now owns the versioned Max Perf policy described in the
[benchmark authority](../benchmark/README.md). It is separate from physically
qualified capacity profiles: selecting it is a launch choice, not new hardware
qualification. Normal launch/restart persists its reference and exact settings.

Standard requires that selected session, all C1/C4/C8 points and every resolved
engine configuration match. A replacement session or changed setting is refused.
Native submission validation applies the same Host policy before signing or
network access. Local history retains the profile/session facts; the public v1
submission fields and metric definitions remain unchanged.

Publishing is disabled for this gate. Native-v2 report support and the site's
MTP whitelist remain separate open items. No live result or model test is part
of this source change.
