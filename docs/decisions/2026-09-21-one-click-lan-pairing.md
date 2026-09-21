---
date: 2026-09-21
title: "Pair shared LAN hosts with one click"
---

# 2026-09-21 — Pair shared LAN hosts with one click

- **Context:** Code and fingerprint entry made pairing unnecessarily complex for the requested trusted-LAN workflow.
- **Decision:** Clicking Pair enrolls directly when host sharing is active. The client captures the peer certificate on first use, validates the discovered host identity, pins the enrollment request to that certificate, and saves the credential in the OS vault. Saved connections never silently replace their certificate pin. Discovery alone does not enroll.
- **Consequences:** Sharing permits LAN clients to obtain host management and inference access without approval on the serving computer. First-use identity is trusted, not independently authenticated. Revoking a token does not prevent explicit re-enrollment while sharing is enabled. Turning sharing off blocks enrollment and desktop LAN connections. Local administrator settings retain their separate authorization. Manual address entry uses the same enrollment flow. Pairing remains directional and never starts a model.
- **Owner:** team.
- **Links:** [Host setup](../lan-host-setup.md). Supersedes the code-entry pairing flow in [desktop LAN sharing](2026-09-20-desktop-lan-sharing.md); removes code activation from the UI, CLI, and host API.
