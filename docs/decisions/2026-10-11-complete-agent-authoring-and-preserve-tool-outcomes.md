---
date: 2026-10-11
title: "Complete agent authoring and preserve tool outcomes"
---

# 2026-10-11 — Complete agent authoring and preserve tool outcomes

- **Context:** The real-model walkthrough saved a reviewed definition but Builder requested the same save again. Mounted Chat did not discover that definition until reload, and reopened failed tool calls appeared pending because persistence omitted their terminal state and error.
- **Decision:** A successful reviewed Builder save completes its authoring turn through the normal reply/session path. Native save and delete operations notify all definition consumers after persistence; mounted consumers subscribe before loading and ignore superseded responses. Chat stores SDK tool state and error text in the canonical content representation used by both serializers.
- **Consequences:** Denied or failed Builder saves remain revisable, and ordinary agents continue after saves. Builder, Studio and Code share native notifications without polling. Failed tools retain their error when reopened and converted to model messages; previously discarded errors cannot be recovered.
- **Owner:** GChat agent runtime.
- **Links:** [Current acceptance](../agent-runtime/remaining-acceptance.md#current-walkthrough-defect-correction), [Builder runner](../../src-tauri/src/core/agent/runner.rs), [Definition authority](../../src-tauri/src/core/agent/definitions.rs), [Chat content](../../web-app/src/lib/messages.ts).
