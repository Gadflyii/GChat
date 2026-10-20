---
date: 2026-10-20
title: "Load without tested profiles and save custom profiles"
---

# 2026-10-20 — Load without tested profiles and save custom profiles

- **Context:** Ron (October 20): tested launch profiles were meant to help novice users, but a
  computer without one must still load a model with custom settings, and people must be able to
  save their own settings into the profile list. Before this change every chat start, the model
  picker and the Models page asked the desktop load for a tested profile and got
  `no_qualified_profile` on any untested card; only the Models page Load recovered, through a
  TypeScript context ladder whose "fit" was a startup quote that never checks context for Qwen 27B
  and Muse 30B. Custom settings existed only on GInfer Hosts. Nothing could be saved.
- **Decision:** Automatic lives in the desktop load (`tauri-plugin-ginfer/src/managed.rs`) and is
  the same for every caller: use the running copy of the model, else a matching tested profile,
  else the person's saved custom profile for this exact package SHA-256 and these graphics cards,
  else the longest standard context (262,144 … 8,192) that the Host's startup check says fits. The
  Host's check (`ginfer-host/src/startup_fit.rs`) keeps the Engine's verdict (`fit_status`,
  `capacity_failure`, `quoted_context`) and, where the quote has no context search, compares the
  fixed startup bytes plus one `max_context` conversation of K/V segments plus headroom with the
  free memory of every rank. A launch that does not fit is refused before any process starts with
  `[does_not_fit]` and one plain sentence ("These settings need 3.2 GB more GPU memory than is
  free. Try a shorter context length: 169,984 tokens or less fits."). A settings check on cards the
  computer has not measured measures them first, as Start does. Saved custom profiles are a field
  of the Host's `host.json` (`custom_profiles`), keyed to the package SHA-256 (hashed once if the
  Host had no receipt) and the saved GPUs (UUID, name, memory, compute capability); the snapshot
  reports each one's status (`ready`, `model_changed`, `model_missing`, `hardware_changed`) and only
  `ready` profiles are offered for launch. Tested and custom settings reach the Engine through the
  same `LaunchRequest` → `EngineLaunch` → `LaunchOptions::args()` path.
- **Consequences:** a card without tested settings loads from every entry point; first-run picks
  the longest standard context that fits when it has no tested settings; the Models page has Custom
  settings with the standard engine setting names and Save as profile; GInfer Hosts and Benchmark
  list saved settings under Custom beside Tested. The K/V estimate is single-conversation (as the
  Engine's startup admission) and can be slightly optimistic when graph memory is unknown; the
  Engine's own startup check still refuses a context that does not fit, and its message is shown.
  Automatic's defaults (Vision on, Speculative Decoding off, Concurrency 1, 300 MiB reserve) are
  unchanged from the previous Models-page fallback.
- **Owner:** `team` (claude-gchat-custom for bubbs, row GCHAT-CUSTOM-PROFILES).
- **Links:** `docs/host-ui/README.md` (Custom settings without tested profiles),
  `src-tauri/ginfer-host/src/custom_profiles.rs`, `src-tauri/ginfer-host/src/startup_fit.rs`,
  `web-app/src/containers/ModelCustomSettings.tsx`.
