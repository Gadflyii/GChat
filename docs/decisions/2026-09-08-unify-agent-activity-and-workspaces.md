---
date: 2026-09-08
title: Unify desktop agent activity, preflight and workspaces
---

# Unify desktop agent activity, preflight and workspaces

- **Context:** Studio runs could wait on unsuitable assignments, approvals were hidden when leaving Runs, and separate polling/UI paths made host state and workspaces inconsistent.
- **Decision:** Use one visibility-aware Studio capacity subscription, explicit per-role readiness, a global activity/approval surface and shared workspace selection. Completed records retain workspace/output locations. Continue as new run opens an editable evidence-based task, not a replay or exact execution resume. Personal memory supports both GInfer provider routes; user-reviewed message saves retain origin metadata.
- **Consequences:** Native dispatch remains authoritative and users review every new run. Independent run monitors subscribe to their own state. Desktop branding maps the 2026-09-08 Sectile Research Laboratories kit into existing semantic tokens and retains self-hosted fonts and product artwork.
- **Owner:** GChat
- **Links:** [Open work](../open-work.md), [Memory](../memory.md)

## Delivered behavior and validation limits

- Local and paired GInfer chat use the same personal-memory eligibility policy.
- Role preflight separates compatible busy assignments from offline, incompatible,
  and unknown capability. Workspace resolution also gates Run. Native dispatch
  still rechecks live capacity; preflight is not a reservation.
- App-wide Studio activity exposes approval handling away from Runs. Capacity polling
  is shared, visibility-aware and deduplicated. Refresh failures retain last-known
  data visibly instead of repeatedly toasting or silently disappearing.
- Workspace selection provides browsing, recent selections, resolved paths, Open
  folder and AGENTS.md preview. Navigation groups existing destinations into Work,
  Resources and Diagnostics.
- Run records retain workspace/output folders. A result overview provides file access
  and explicit Continue as new run. Its editable prompt is bounded below the agent
  session's user-text limit and includes prior findings and output locations.
- Message memory saves require user review and retain origin identifiers; chat exposes
  its last recall snapshot. Memory lists render in batches of 50.
- Individual live runs subscribe independently, collapsed event JSON is rendered only
  when expanded, and unchanged fleet projections are not republished. Existing bounded
  run history, chat scrolling and terminal execution remain intact.
- Compact sidebar branding uses the existing G icon with readable product/company text;
  full artwork remains on larger surfaces. Header layout can grow rather than cover
  navigation. Status colors, mono figures, font weights and backgrounds follow the kit.
- `CARGO_INCREMENTAL=0 make verify` and `git diff --check` pass. New status foregrounds
  exceed 4.5:1 against their respective paper/ink canvas colors; this does not certify
  all component/background combinations or the entire app's accessibility.


Installed Windows acceptance and unmeasured long-chat performance remain in
[open work](../open-work.md).
