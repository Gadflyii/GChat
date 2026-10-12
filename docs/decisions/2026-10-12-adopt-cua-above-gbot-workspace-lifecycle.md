---
date: 2026-10-12
title: "Adopt Cua above Gbot workspace lifecycle"
---

# 2026-10-12 — Adopt Cua above Gbot workspace lifecycle

- **Context:** the Gbot prototype duplicates an agent loop while Cua supplies
  the loop, tools, Driver, skills and evaluation. Ron selected Cua-first, then
  explicitly retained our VM setup, Hyper-V and M365 connection.
- **Decision:** use our Cua fork at `0c69d9a2c8` above the existing workspace
  lifecycle. GChat keeps UI/sessions, durable service state, vault, approvals,
  capability adapters, GInfer assignment and Arbitor hooks. Cua owns agent
  iteration and computer tools; the provider/session integration is the next
  proposed implementation. FSL viewer/media is permitted in GChat and excluded
  from Arbitor pending Ron's review; AGPL perception is excluded.
- **Consequences:** retain the working VM/SSH foundation and stop further
  custom Gbot executor work. GInfer's text-only function-tool provider and the
  embedded viewer require adapters/qualification. Cua's popup foreground guard
  remains a driver gap; changing loops is not evidence of a fix. No runtime,
  dependency or physical qualification is introduced by this docs change.
- **Owner:** GChat.
- **Links:** [component map and smallest integration](../gbot/cua-map.md),
  [current design and evidence](../gbot/README.md),
  [foreground activation decision](2026-10-12-activate-gbot-controls-through-foreground-input.md).
