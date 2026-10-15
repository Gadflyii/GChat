---
date: 2026-10-15
title: "Share Agent Studio drafts with the selected Gbot"
---

# 2026-10-15 — Share Agent Studio drafts with the selected Gbot

- **Context:** Ron wants to ask Gbot for help creating an agent while continuing
  to work in Agent Studio. The companion overlay preserves the main view but did
  not give the bot its current unsaved draft or an editor action.
- **Decision:** Add explicit “Help with this page” sharing in the companion's
  Conversation tab when an Agent Studio definition editor is visible. Each send
  appends a snapshot of that draft to the existing task prompt for the selected
  bot and service. A reply may propose an allowlisted object of changed text
  fields in one `gchat-agent-draft` fenced JSON block. The companion displays a
  review card; “Apply to draft” invokes the existing editor state setter. Existing
  save, run, model, composition, permission, and workspace operations are unchanged.
- **Consequences:** The bot can explain and help fill the visible form without
  replacing it. This first slice covers name, description, instructions, default
  goal, output contract, and the composition's evaluator/planner/synthesis text;
  it does not edit worker/stage structure. Other pages do not share context yet.
  A proposal is bound to its task, sharing grant, bot, service, mounted editor and
  monotonically increasing draft revision. Edits after submission invalidate it,
  including edit-then-restore; applying consumes pending proposals. Leaving the
  editor, saving, opening run setup, hiding the pane, switching bots/services,
  disabling Gbot or stopping sharing revokes edit authority. Reload/reopen cannot
  restore authority from task text. Already submitted snapshots remain part of
  the existing durable task history; sharing is per-message, not continuous
  observation. Invalid, ambiguous, oversized or disallowed proposals remain inert
  text. No DOM scraping, screenshots, OS access, native endpoints, executable
  model output, persisted settings or dependencies are added. Model adherence to
  the proposed reply format determines whether an edit card is available;
  ordinary replies still provide guidance.
- **Owner:** team.
- **Links:** [Overlay decision](2026-10-15-open-gbot-in-a-workspace-overlay.md),
  [Gbot design](../gbot/README.md),
  `web-app/src/stores/gbot-page-store.ts`,
  `web-app/src/routes/agents/index.tsx`,
  `web-app/src/containers/GbotCompanion.tsx`.
