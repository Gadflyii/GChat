---
date: 2026-10-11
title: "Own hardware profile installation in Host"
---

# 2026-10-11 — Own hardware profile installation in Host

- **Context:** Profile v2 measurements can take minutes and must survive a client
  closing. Ordinary inference startup consumes a complete saved profile. Desktop,
  standalone installers and Manager need the same job and deployment binding.
- **Decision:** Host owns one native profile job and its durable recipe, workspace,
  checkpoint and saved-group queue. Installers prepare the runtime and hand off to
  Host. First install requires an explicit homogeneous GPU selection, including
  on a single-GPU host. The profile path is keyed by the sorted UUID set; launch
  order remains a deployment input. Profiling and inference use the same visible
  GPU set and compatible runtime. Model admission waits for that group's profile.
- **Recovery:** Preserve native arguments and forced refresh across Cancel, crash
  and Resume. Keep the accepted profile until the producer succeeds and a v2
  output is published. The producer owns completeness, fingerprint and checkpoint
  validation. Native child lifetime belongs to Host: Linux parent-death signaling
  and Windows atomic kill-on-close Job membership prevent an orphan producer.
- **Hardware changes:** Explicit authenticated Scan ensures saved groups. A native
  reader rejection marks the launched group stale and offers explicit re-profiling.
  Snapshot polling does not detect hardware changes or start measurements. The
  reader's physical inventory and per-rank checks are unchanged; Host owns the
  exact deployment binding.
- **Consequences:** Both clients observe and control the same job. Serial saved
  groups retain one reservation through transitions. A completed hardware profile
  does not qualify a model or full-context capacity. No Engine recipe, runtime
  dependency, background calibration or automatic GPU selection is introduced.
- **Owner:** GChat coordinator.
- **Links:** [Current implementation and acceptance](../ginfer-manager/README.md),
  [Host implementation](../../src-tauri/ginfer-host/src/hardware_profile.rs).
