---
date: 2026-10-13
title: "Own Gbot cloud resource creation and recovery"
---

# Own Gbot cloud resource creation and recovery

The cloud wizard previously saved a cost review without creating a computer.
Gbot now creates the exact confirmed Hetzner or DigitalOcean plan in the user's
account. It checks live prices before each resource mutation and requires renewed
consent after a quote expires or changes. It never substitutes a plan.

The existing Gbot service owns a durable deployment record, including each
resource and pending operation. An uncertain create is reconciled by its unique
setup identity; it is never retried blindly. Deletion walks only that setup's
resources in reverse order and verifies removal. Failed deletion retains its
intent and credentials for retry. Workspace removal is blocked while resources
remain; durable retirement keeps keys until the workspace record is committed.

The first boot uses Debian 13, key-only SSH and an SSH-only inbound firewall
restricted to the user's explicit source ranges. Existing pinned guest tools are
uploaded after host identity verification; a fixed administrator helper checks
their digests before installing them. Provider tokens and private SSH keys stay
in the vault. Public identities and resource status may be saved outside it.

Provider Running is separate from desktop Ready. The wizard requires the user to
verify the SSH identity, authenticate, prepare the tools and connect the desktop
before completing setup. Recovery uses explicit Check progress; no background
provider polling is added. This change adds no dependency or account access to its
source gates. Physical provisioning remains unqualified until an approved test
account and cost window are available.

Owner: GChat. Current state and evidence: [Gbot README](../gbot/README.md#current-record-and-inventory).
Provider contracts: [Hetzner Cloud API](https://docs.hetzner.cloud/reference/cloud),
[DigitalOcean API](https://docs.digitalocean.com/reference/api/api-reference/).
Cloud-init's Deb822 support is described in its
[APT examples](https://docs.cloud-init.io/en/latest/reference/yaml_examples/apt.html).
