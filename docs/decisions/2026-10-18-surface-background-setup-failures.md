---
date: 2026-10-18
title: "Surface background setup failures"
---

# 2026-10-18 — Surface background setup failures

- **Context:** First-run maintenance logged state-write failures, leaving Welcome
  unaware when a full disk prevented progress and prevented saving an error.
- **Decision:** Host owns the last maintenance failure in memory and returns it in
  first-run status. Welcome shows the actionable error and retries with the existing
  Resume action at every maintenance stage, including GPU selection and completed
  setup. Preserve the explicit download, profiling and startup Resume actions. At
  other stages, if maintenance cleared the error before Retry arrives, quietly
  return current status without saving unchanged progress or waking maintenance.
  Clear the failure after successful maintenance, not while waiting on active
  work. Do not persist this transient status on the failing disk.
- **Consequences:** Polling clients see the failure without another state write;
  restarting Host loses the transient message and pending work can report it again.
  Saved choices, model admission and Engine behavior remain unchanged.
- **Owner:** Codex 4.
- **Links:** [Current status and verification](../host-ui/README.md#background-setup-disk-errors--codex-4-october-18).
