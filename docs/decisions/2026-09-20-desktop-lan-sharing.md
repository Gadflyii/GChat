---
date: 2026-09-20
title: "Separate desktop LAN sharing from loopback management"
---

# 2026-09-20 — Separate desktop LAN sharing from loopback management

- **Context:** Desktop hosts listened only on loopback; enabling discovery could not make two desktops discover each other.
- **Decision:** Desktop bootstrap enables a host-owned, persistent LAN-sharing control. As requested, sharing defaults on, with a checkbox beside discovery. A separate IPv4 TLS listener on TCP 7444 advertises the existing host identity; loopback management stays on TCP 7443. Standalone service configuration retains ownership of its listener.
- **Consequences:** Toggling sharing leaves local inference running. Disabling closes LAN connections and withdraws discovery; saved pairings survive. Pairing remains mandatory, with code generation and sharing changes restricted to the local administrator credential. Firewall configuration is unchanged. Port conflicts are reported without disabling local inference.
- **Owner:** team.
- **Links:** [LAN setup](../lan-host-setup.md).

Discovered hosts offer Pair and Ignore; endpoint details are collapsed. Pairing probes candidate addresses in parallel using the user-supplied certificate fingerprint and selected host identity, then submits the one-use code to exactly one destination. Desktop names default to the OS hostname and can be changed in General settings without restarting inference.
