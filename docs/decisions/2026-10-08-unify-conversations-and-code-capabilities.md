---
date: 2026-10-08
title: "Unify conversations and expose shared capabilities in Code"
---

# 2026-10-08 — Unify conversations and expose shared capabilities in Code

- **Context:** choosing Chat or Agent changes navigation, workspace controls and
  execution despite their shared native capability catalog. Code sessions are
  absent from GChat history, and its bridge exposes delegation but not direct
  native tools or configured connectors. Document extraction also loses its text
  when the shared adapter returns metadata instead of the tool summary.
- **Decision:** one conversation view handles streaming replies, local tools,
  skills and delegated agents under one saved workspace, approval policy and
  tool selection. Agent Studio remains the authoring and worker-pool workspace.
  Shared sidebar history contains conversations and durable Code references;
  icons identify the view and badges identify agent activity. Stock OpenCode owns
  its transcript. GChat registers and reopens its sessions through the public
  adapter and keeps live workspace runtimes when users navigate away. The scoped
  Code bridge uses the same native/MCP catalog and executor, with the selected
  session's policy; asynchronous agent delegation keeps its existing lifecycle.
- **Consequences:** existing histories, folders, approval choices and saved-agent
  restrictions must survive the transition. Permission requests and run progress
  stay in the originating view. `/compact` is reserved before ordinary prompt
  dispatch: Chat checkpoints its working request context, active agents compact
  at safe tool boundaries, and Code uses its stock command. Stored transcripts
  remain intact, and compaction never reloads the model. Native tool results
  retain their useful summary and structured details together. This changes no
  inference limits, model placement, task budgets or engine behavior.
- **Owner:** team.
- **Links:** [current implementation and acceptance](../agent-runtime/README.md),
  [shared capability ownership](2026-10-01-share-chat-and-agent-capabilities.md),
  [stock Code adapter](2026-08-30-keep-embedded-opencode-stock-behind-a-managed-adapter.md),
  [Code delegation](2026-09-23-connect-opencode-to-agent-studio.md),
  [context admission](2026-09-24-count-and-compact-ginfer-chat-requests.md).

Supersedes the separate Chat/Agent navigation and view selection in
[sidebar separation](2026-07-21-separate-chat-and-agent-navigation-in-the-sidebar.md)
and [view selection](2026-09-23-separate-chat-view-from-agent-execution.md).
Their recorded history does not define current navigation.
