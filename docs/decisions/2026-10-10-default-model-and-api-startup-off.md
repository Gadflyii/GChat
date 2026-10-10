---
date: 2026-10-10
title: "Default model and API startup off"
---

# Default model and API startup off

Ron requests both `preloadModelOnStartup` and Local API Server
`enableOnStartup` to default to `false`. Opening GChat does not opt a user into
either startup action. Both settings remain independently selectable.

Missing legacy preferences resolve to off. Explicit saved true or false values
survive migration; changing the default does not replace an existing choice.
The two owning Zustand stores, existing migration regressions and English/Russian
descriptions follow this policy. OS login autostart is a separate preference.

The focused source check passes15 default/migration cases. The installed3aff
executable retains its original defaults; Ron's actual saved flags were set and
verified false across a fresh native launch. That screen reused accepted bytes
without a rebuild, and does not claim the new defaults are installed.

This replaces the preload-default/forced-opt-in policy in the
[August30 decision](2026-08-30-autoload-the-first-ginfer-model-as-the-persisted-default.md).
[Remaining acceptance](../agent-runtime/remaining-acceptance.md) records the
source and installed scopes. No release signing or publication is authorized.
