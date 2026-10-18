---
date: 2026-10-18
title: "Forward Host residency controls"
---

# 2026-10-18 — Forward Host residency controls

- **Context:** The Engine exposes Flash host RAM headroom and periodic expert LFU
  admission controls, but custom GInfer Host launches could neither retain nor
  forward them. Global Settings no longer owns model startup overrides.
- **Decision:** Extend shared Host `LaunchOptions` with optional unsigned whole-GiB
  `flash_host_ram_headroom_gib` and boolean `expert_lfu`, default true. Null omits
  the headroom flag and inherits the Engine's 4 GiB floor. Forward explicit values,
  including zero, unchanged; the Engine validates its limits. Always forward LFU
  as `on` or `off`. Expose both only in custom Host startup settings, with a plain
  zero-headroom warning. Tested profiles continue to own their complete options.
- **Consequences:** Saved launches, edits, quote and restart use the same options
  on Linux and Windows. LFU off stops periodic admission/cadence gaps while retaining
  the device cache and normal miss routing. No Engine default or admission policy
  changes. These settings do not qualify a custom configuration as tested.
- **Owner:** Codex 3; claude-arch signed 2026-10-18 07:16Z.
- **Links:** [Current Host UI authority](../host-ui/README.md),
  [Custom startup ownership](2026-10-18-own-custom-ginfer-startup-in-hosts.md),
  [Model management](../model-management.md#runtime-presets).
