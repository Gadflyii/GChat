---
date: 2026-09-07
title: "Register discoverable GInfer hosts and address model instances explicitly"
---

# Register discoverable GInfer hosts and address model instances explicitly

- **Context:** GChat currently owns local inference processes and stores remote providers by provider name. LAN hosts need durable identity, installed-model inventory, authenticated management, and unambiguous routing when several instances serve the same model.
- **Decision:** Introduce a native engine registry keyed by host and instance IDs. A lightweight `ginfer-host` service owns discovery, pairing, model inventory, and inference child processes. GChat owns the host service implementation and distribution alongside its desktop client; the service is independently runnable on Windows/Linux without a desktop window. GInfer continues to provide the inference executable. The host service advertises DNS-SD, including while no model is loaded. Explicit pairing establishes credentials and certificate trust. Chat, agent roles, embedded coding clients, and benchmarks share the registry's instance resolver.
- **Consequences:** The local OpenAI facade gains stable instance-specific model aliases while preserving upstream model IDs in forwarded requests. Installed models and running instances are distinct. A host going offline never removes saved registrations or rewrites agent definitions. Remote inference does not require local NVIDIA hardware. Host lifecycle changes and benchmarking remain explicit user actions. Host functionality can develop independently of the current engine branch.
- **Owner:** team
- **Links:** [Implementation plan](../lan-engine-implementation-plan.md), `src-tauri/src/core/server`, `src-tauri/plugins/tauri-plugin-ginfer`
