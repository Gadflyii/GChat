---
date: 2026-10-11
title: "Enable structured outputs in Host deployments"
---

# 2026-10-11 — Enable structured outputs in Host deployments

- **Context:** Host launches omitted `--structured-outputs`, preventing supported JSON-schema requests in Chat and agents. Historical catalog runs used the universal Engine default OFF. Host also dropped explicit zero Host KV cache limits from its argv, selecting AUTO instead of disabling the pool.
- **Decision:** Omitted Host deployment settings enable structured outputs; GChat and Manager expose a saved checkbox to disable them. Manual, preset and automatic model loads share Host validation. Catalog omission retains recorded OFF. Overrides clear qualification when settings differ; upgrading a saved qualified deployment with no structured-output field clears its old qualification before applying ON. Explicit OFF survives save, restart and reload. Ron subsequently selected Engine default ON with an explicit off flag, owned by C1. Host must forward saved OFF explicitly when adopting that Engine contract; the accepted 2cc runtime still defaults OFF.
- **Consequences:** New deployments can use the Engine's supported constrained-output routes and their startup allocations. Historical profile evidence does not qualify the changed options. Host KV limits preserve three meanings: omitted/null selects the Engine's automatic/default policy, zero emits an explicit disabled limit, and positive values emit exact bytes. This cache correction does not establish the cause of S2's separate RAM-headroom failure.
- **Owner:** GChat.
- **Links:** [Current status and acceptance](../ginfer-manager/README.md#structured-outputs-in-host-deployments), [controls](../ginfer-manager/guide.md), [master issues](../open-work.md), source `e65778645`.
