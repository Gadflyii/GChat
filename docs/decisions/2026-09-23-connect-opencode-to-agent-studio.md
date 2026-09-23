---
date: 2026-09-23
title: "Connect embedded OpenCode to Agent Studio through scoped MCP"
---

# 2026-09-23 — Connect embedded OpenCode to Agent Studio through scoped MCP

- **Context:** The embedded OpenCode TUI could use GChat's OpenAI-compatible model endpoint, but it could not discover GChat skills or invoke the saved agents, Goal Loops, teams, and workflows managed by Agent Studio. A separate scheduler would also bypass the worker pools and approval policy users configure there.
- **Decision:** Keep OpenCode stock and attach a version-1 remote MCP adapter to each embedded Code launch. GChat serves the endpoint on loopback with a launch-scoped bearer token and canonical project workspace; its tools discover skills and definitions, start asynchronous runs through the existing Agent Studio executor, report compact run snapshots, list project runs across Code launches, and cancel runs. Agent Studio remains the owner of model routing, worker-pool placement, run history, and human approvals.
- **Consequences:** OpenCode delegation uses the same runtime and saved worker-pool assignments as Agent Studio. A run uses the launch-configured GChat model fallback or accepts an explicit ready model ID; it does not track model switches inside OpenCode. The Code panel and Agent activity view expose progress and approvals, while completed runs use standard Agent Studio history. Every delegated run gets a fresh Agent session; callers include needed context in each task. Retry IDs are scoped to one bridge launch. Closing the Code terminal releases its endpoint while delegated runs continue; quitting GChat requests cancellation and waits up to 15 seconds for runs to persist, with incomplete history possible after timeout. Changes to OpenCode's v1 MCP configuration contract must be reflected in the managed adapter.
- **Owner:** Sectile Research Laboratories
- **Links:** `src-tauri/src/core/code_bridge.rs`, `src-tauri/src/core/terminal.rs`, `src-tauri/src/core/agent/commands.rs`, `web-app/src/containers/CodeBridgePanel.tsx`, `web-app/src/containers/StudioActivity.tsx`, `src-tauri/src/core/agent/ARCHITECTURE.md`, https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/mcp-servers.mdx.
