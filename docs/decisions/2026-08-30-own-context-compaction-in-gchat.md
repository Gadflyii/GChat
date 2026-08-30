---
date: 2026-08-30
title: "Own context compaction in GChat"
---

# 2026-08-30 — Own context compaction in GChat

- **Context:** OpenAI's `finish_reason: length` conflates an output-token limit, logical context exhaustion, and physical KV exhaustion. GChat previously reacted after generation with token-count heuristics, while Agent sessions replaced old work with a count-only placeholder. Both paths could lose useful state or misclassify an Engine capacity defect as ordinary context pressure.
- **Decision:** GInfer remains strict and exposes exact prompt counting plus its native finish reason. GChat counts the final rendered GInfer request before admission, grows the startup-fixed context first when allowed, and otherwise replaces only older complete turns in the wire payload with a model-generated structured checkpoint. The stored chat transcript remains unchanged. Agent execution sessions use the same structured checkpoint contract and prune their operational copy only after the checkpoint succeeds. The exact `/compact` command invokes that same path immediately, retains the newest two complete user turns, and pins the resulting checkpoint for later requests without adding `/compact` or a synthetic answer to the transcript.
- **Consequences:** Long-running chats and Agent runs retain objectives, decisions, paths, tool findings, and pending work without silently splitting tool-call groups. One oversized current turn fails with an actionable error. The first compaction adds a checkpoint-generation request, subsequent requests reuse it until more old turns must be folded in, and GChat now requires a GInfer build that implements `/v1/chat/completions/count_tokens` and `x_ginfer.finish_reason`. Manual compaction reports whether it compacted, was already active, had insufficient old history, or would not reduce the rendered prompt.
- **Owner:** team
- **Links:** `web-app/src/lib/smart-context.ts`, `src-tauri/src/core/agent/session.rs`, `src-tauri/src/core/agent/ginfer_client.rs`, `Gadflyii/ginfer` `docs/serving.md`
