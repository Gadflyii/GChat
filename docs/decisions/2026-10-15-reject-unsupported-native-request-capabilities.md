---
date: 2026-10-15
title: "Reject unsupported native request capabilities"
---

# 2026-10-15 — Reject unsupported native request capabilities

- **Context:** The legacy Responses adapter dropped hosted tools and non-text
  input, and the Messages fallback retried rejected requests after lossy
  conversion. Successful generation could therefore ignore a requested capability.
- **Decision:** Inference-server hosted retrieval, `file_search`, `web_search`
  and MCP remain unsupported and must fail explicitly. GChat client-side web
  search/fetch, direct local-file search and trusted static-credential MCP are
  included in the Linux release under the [client tools decision](2026-10-16-include-qualified-client-tools-in-linux-release.md).
  Host checks declarations
  ignored by the engine; native protocol validation remains authoritative for
  supported features. Translation rejects unrepresentable requests. Native Messages
  errors remain errors; remote endpoint compatibility fallback is limited to
  404/405 and checked conversion.
- **Consequences:** Requests no longer silently lose unsupported tool, content or
  output-format declarations. Supported client function tools, configured GChat MCP
  connectors and engine-supported structured outputs remain available. Remote
  native passthrough retains provider-specific capability support.
- **Owner:** team.
- **Links:** OI-055; [runtime contract](../agent-runtime/README.md);
  [original Responses adapter decision](2026-06-02-add-a-v1-responses-translation-shim-to-the-local-proxy-so-codex.md).

<!-- Supersedes the original adapter decision's permission to drop unsupported content/tools. -->
