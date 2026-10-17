---
date: 2026-10-17
title: "Default desktop Host to loopback only"
---

# 2026-10-17 — Default desktop Host to loopback only

- **Context:** A fresh desktop Host enabled LAN sharing automatically, opening an IPv4 wildcard TLS listener on port 7444 and advertising it through mDNS. On Windows this could show a firewall prompt before the user chose to share.
- **Decision:** New Host state and saved state without a sharing choice default to LAN sharing off. The desktop management listener remains loopback only. The local administrator must enable **Share this host** to start the separate LAN listener and advertisement. Explicit saved choices remain intact.
- **Consequences:** Local setup and inference do not require LAN sharing. Users who enable sharing may still need to approve their operating system's firewall prompt. Standalone services retain their explicitly configured listen address.
- **Owner:** team.
- **Links:** [Host setup](../lan-host-setup.md). Supersedes the default-on choice in [desktop LAN sharing](2026-09-20-desktop-lan-sharing.md).
