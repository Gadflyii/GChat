---
date: 2026-10-11
title: "Design local-first Gbot and guided computer setup"
---

# 2026-10-11 — Design local-first Gbot and guided computer setup

- **Status:** approved product/design inputs, docs only; implementation and dependencies await separate authorization.
- **Context:** Ron selected a persistent GChat feature usable by people without servers, with separate service/computer locations and first-release M365 Cloud PC. The initial draft treated cloud computers as unassigned; that scope is superseded.
- **Decision:** [One current Gbot design](../gbot/README.md) owns the local-PC default service, optional LAN service, two-question novice walkthrough and four bot computers: separate Hyper-V/KVM local VM, LAN computer, user-rented Ubuntu cloud VM, or M365 Cloud PC. Automated cloud setup recommends Hetzner then DigitalOcean; Azure/AWS/GCP are guided. Query live prices before creation. Use one lightweight X11/worker/cloud-init flow, restricted SSH ingress and localhost VNC through SSH. View is read-only; Take over pauses bot input, Hand back reconciles and resumes. Evaluate SDK/Driver at the pinned Cua revision without adopting Spaces/relay dependencies. Qualify small Linux/Windows development VMs on this desktop/S1 and Ron's M365 PC once implementation is authorized.
- **Consequences:** Service state survives client exit, sleep and restart, but progress requires the service/computer/model to be available. Local means a separate guest, never the user's desktop. M365's supported brokered connection versus in-PC agent is an explicit engineering probe, not a qualified route or raw RDP endpoint. GChat owns basic setup/authentication and its vault; paid Arbitor policy/audit/cost layers remain extension points only. Cloud bot computers are an approved Gbot scope extension; cloud service placement and WAN GInfer management remain outside v1. No VM, paid layer, dependency, build, signing or publication is performed by this change.
- **Owner:** GChat coordinator.
- **Links:** [Current plan, constraints and acceptance](../gbot/README.md), [shared agent runtime](../agent-runtime/README.md), [pinned Cua license inventory](https://github.com/trycua/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/LICENSING.md).

Supersedes: [initial October 10 scope](2026-10-10-draft-gbot-shared-runtime-and-cua-workspaces.md).
