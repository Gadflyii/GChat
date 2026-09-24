---
date: 2026-09-24
title: "Count and compact GInfer chat requests without reloading profiles"
---

# 2026-09-24 — Count and compact GInfer chat requests without reloading profiles

- **Context:** The context meter could undercount the first request because it estimated transcript text without the fully rendered instructions and tools. Automatic context growth also tried to change a startup-fixed GInfer capacity by stopping and restarting the model after a request failed.
- **Decision:** Count the exact rendered request before admission and use the loaded context capacity when available. Preserve older-turn checkpointing; when a current-turn tool result makes the request too large, summarize that result in bounded chunks in the wire request while retaining the transcript and tool-call IDs. Context exhaustion asks the user to select a larger host profile or reduce the request; it does not automatically grow or reload the process.
- **Consequences:** The meter can account for instructions and tools on the first request, and large tool results can be reduced without replacing the user's history. Summaries add model calls and can still fail when the request itself cannot fit. The Windows Muse 131072/C4 installed walkthrough remains release acceptance work; source changes and automated coverage do not establish it.
- **Validation:** On the loaded Windows Muse TP1/131072 instance, a representative 258 KB crawl result produced 44,902 rendered tokens. With a deliberately constrained 32,768-token request budget, two completed summaries reduced it to 272 tokens. The original transcript and call/result IDs were unchanged; the summary and final answer retained all three test source URLs/numeric facts. This validates the live request path, not the full installed WebView walkthrough.
- **Owner:** team
- **Links:** `web-app/src/lib/smart-context.ts`, `web-app/src/lib/custom-chat-transport.ts`, `web-app/src/hooks/useContextUsage.ts`, `web-app/src/containers/ContextSizeControl.tsx`, `docs/open-work.md`

<!--
Supersedes in part: 2026-08-30-own-context-compaction-in-gchat.md
-->
