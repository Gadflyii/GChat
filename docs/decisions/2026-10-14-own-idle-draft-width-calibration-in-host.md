# Own idle draft-width calibration in Host

Status: implementation follows bubbs’s 2026-10-14 setup decision; source candidate awaits review.

Host owns one durable queue for saved deployment recipes, sharing its existing
lifecycle lock and activity notification with model and hardware-profile jobs.
It runs the matching native `ginfer --calibrate-draft-width` command only after
hardware profiling and while no model process is resident. No deployment is
invented for installs without a saved profile.

A recipe binds the artifact/runtime and exact GPU group, context, concurrency,
TP, KV, graph and Vision settings. Changed recipes queue again. The native
producer owns its mixed-real-text corpus, measured policy and hardware-profile
record; Host does not infer a draft width. User activity cancels and reaps the
child before launching a model. Completed jobs survive Host restart;
interrupted jobs queue again, and failed jobs retain diagnostics without
automatic retries. Both clients expose this state in their existing hardware
profile area. Linux parent-death and Windows Job ownership follow the existing
hardware-profile process path.

Focused source checks and the pending native CLI/Windows checks are recorded in
[the subject record](../ginfer-manager/README.md#idle-draft-width-calibration).
