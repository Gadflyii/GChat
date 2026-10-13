---
date: 2026-10-13
title: "Own Gbot paired inference in the service"
---

# 2026-10-13 — Own Gbot paired inference in the service

- **Context:** Gbot outlives GChat. Its executor needs an OpenAI-compatible endpoint, while paired GInfer Hosts require native certificate pins, vault grants and a specific live model session. The desktop API cannot own this dependency.
- **Decision:** Persist a typed endpoint or paired Host assignment. The background service uses the shared native Host client and gives each running task a revocable authenticated loopback endpoint for chat and token counting. Paired selection saves the exact Host, instance, session, model and served context; a restart requires explicit selection again.
- **Consequences:** No Host grant reaches the browser, task record or executor. Task cancellation revokes its inference connection. Direct endpoint keys retain the existing per-bot vault transaction; switching to a paired Host removes that endpoint key. Ready models are refreshed on demand, with no polling loop.
- **Owner:** @Gadflyii
- **Links:** [Gbot design](../gbot/README.md), [current acceptance](../agent-runtime/remaining-acceptance.md), `gbot-service/src/inference.rs`, `ginfer-host/src/client.rs`.
