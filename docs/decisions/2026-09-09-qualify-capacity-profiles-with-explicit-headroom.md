---
date: 2026-09-09
title: "Qualify capacity profiles with explicit headroom"
---

# 2026-09-09 — Qualify capacity profiles with explicit headroom

- **Context:** The original 1 GiB profile guard limits context capacity. A physical RTX4090 Muse C8/64K check passed with a 300 MiB configured guard and 606 MiB minimum sampled GPU-free memory.
- **Decision:** Qualify the largest context at each C1–C8 point for both registered models using 300 MiB per-GPU headroom, increasing to 500 MiB where execution validation requires it. Save exact arena bytes, context and margin. Validation requires measured free memory to meet the selected margin. Manual/auto launch defaults remain 1 GiB.
- **Consequences:** Capacity increases at the cost of tolerance for unrelated GPU allocations. Startup sizing alone is insufficient; each profile needs full-context execution evidence. Existing results retain their original settings. This revises the headroom policy in the shared profile-launch decision, not its ownership or lifecycle design.
- **Owner:** team.
- **Links:** [Active plan](../model-management-plan.md), [shared profile launch](2026-09-09-share-profile-launch-and-instance-control.md).
