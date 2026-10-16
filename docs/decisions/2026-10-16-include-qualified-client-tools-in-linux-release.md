---
date: 2026-10-16
title: "Include qualified client tools in the Linux release"
---

# 2026-10-16 — Include qualified client tools in the Linux release

- **Context:** OI-055 left client tools pending a release scope decision while
  unsupported inference-server hosted requests were already rejected explicitly.
  Separate Linux qualifications now cover MCP, web search/fetch and local files.
- **Decision:** Ron approved trusted stdio and HTTP/SSE MCP servers with static
  credentials, web search/fetch, and direct local PDF/DOCX/spreadsheet reads plus
  filename globbing and raw-text grep for the release. OAuth MCP and semantic
  indexed RAG are post-release. Engine hosted tools remain unsupported and return
  explicit errors.
- **Consequences:** User docs list all three client features. Qualification stays
  bounded to the recorded Linux checks: MCP/local-file GUI checks are model-free;
  web tools also pass model-led Chat and saved Standard Agent checks. Windows,
  installer, OCR and immediate document-parser cancellation are not newly qualified.
- **Owner:** Ron, via Bubbs; Gchat records OI-055 closure.
- **Links:** [Runtime scope and qualification limits](../agent-runtime/README.md#client-tools-and-native-request-capability-errors--release-scope);
  [unsupported native requests](2026-10-15-reject-unsupported-native-request-capabilities.md).
