---
date: 2026-09-08
title: Unify desktop agent activity, preflight and workspaces
---

# Unify desktop agent activity, preflight and workspaces

- **Context:** Studio runs could wait on unsuitable assignments, approvals were hidden when leaving Runs, and separate polling/UI paths made host state and workspaces inconsistent.
- **Decision:** Use one visibility-aware Studio capacity subscription, explicit per-role readiness, a global activity/approval surface and shared workspace selection. Completed records retain workspace/output locations. Continue as new run opens an editable evidence-based task, not a replay or exact execution resume. Personal memory supports both GInfer provider routes; user-reviewed message saves retain origin metadata.
- **Consequences:** Native dispatch remains authoritative and users review every new run. Independent run monitors subscribe to their own state. Desktop branding maps the 2026-09-08 Sectile Research Laboratories kit into existing semantic tokens and retains self-hosted fonts and product artwork.
- **Owner:** GChat
- **Links:** [Delivery plan](../usability-polish-plan.md), [Memory](../memory.md)
