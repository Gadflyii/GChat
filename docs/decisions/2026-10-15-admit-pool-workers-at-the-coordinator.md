---
date: 2026-10-15
title: "Admit pool workers at the coordinator"
---

# 2026-10-15 — Admit pool workers at the coordinator

- **Context:** OI-069 found that independent GChat processes each counted a pool member's `worker_limit`, multiplying an instance's capacity for every client grant. Manager sets this capacity per instance; issuing a grant must never add slots.
- **Decision:** The configured fleet coordinator atomically admits workers against the lowest configured pool limit for the canonical Host/instance identity. GChat acquires that admission before tools or inference, in addition to its existing local concurrency, readiness, context and session checks. Capacity exhaustion queues the caller and leaves cancellation responsive.
- **Consequences:** A live authenticated HTTPS response owns each admission. Completion, cancellation or client exit drops the response and releases its slot; revocation closes it. The client cancels work when the response ends or its heartbeat is lost. Coordinator admission fails closed, including with older Hosts that lack the endpoint. Reservations are transient and introduce no durable schema or credentials. A disconnected caller may conservatively retain capacity until the connection closes; admission is not an inference API quota or a replacement for session fencing.
- **Owner:** team; aggregate-capacity policy confirmed by bubbs on 2026-10-15.
- **Links:** `src-tauri/ginfer-host/src/service.rs`, `src-tauri/src/core/agent/worker_pools.rs`, `src-tauri/ginfer-host/tests/fleet.rs`.
