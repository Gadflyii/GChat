---
date: 2026-10-15
title: "Open Gbot in a workspace overlay"
---

# 2026-10-15 — Open Gbot in a workspace overlay

- **Context:** Ron wants to converse with a bot, inspect its agents and view its
  computer while continuing the current Chat, Code or Agent Studio work. The
  existing Gbot menu remains the home for settings, options and controls.
- **Decision:** Put each bot's animated avatar above Work in the left sidebar.
  Clicking an avatar opens or focuses its companion pane over the right side of
  the current workspace. The pane has hidden, compact and expanded states.
  Expanded fills the workspace content area; Minimize returns to compact.
  Conversation, Agents and Desktop retain per-bot selection and conversation
  drafts. Opening the pane never changes the main route or unmounts its content.
- **Consequences:** Compact leaves the uncovered workspace usable. Expanded
  makes the covered content inert while preserving it. Hidden makes the pane
  inert, restores avatar focus and releases its desktop media/input leases.
  Hiding or changing tabs does not cancel a task or automatically hand control
  back: a bot already paused for human takeover stays paused until Hand back.
  Failed hand-back retains the existing paused recovery behavior. Settings use
  the same service, task, approval, help and desktop contracts as the companion.
  Agents shows the assigned model and actual reported task/tool activity; it
  does not invent additional workers.
- **Avatar behavior:** Sleeping means disconnected, unavailable or paused for
  human control; listening means focused input or waiting for help/approval;
  thinking means a running task; thinking-hard means running work with reported
  tool steps; speaking signals a newly delivered assistant reply, without
  claiming audio output. Greeting runs briefly when opening an otherwise idle
  bot; idle means connected and ready. Real work and attention take precedence
  over greetings. Preserve supplied light/dark and reduced-motion styles.
- **Follow-up agreed with Ron:** A future “Help with this page” action will share
  the current view and relevant unsaved draft with the chosen bot and expose
  view-specific actions through existing app operations. This should let a bot
  guide or fill an Agent Studio draft while the user watches. Sharing is scoped
  to the chosen GChat view; existing save/launch and sensitive-action permission
  rules still apply. This change records that design only: it adds no main-panel
  observation/action bridge and grants no access to the user's OS desktop.
- **Owner:** team.
- **Links:** [Gbot design](../gbot/README.md),
  [native desktop media decision](2026-10-12-use-cua-native-media-for-gbot.md).
