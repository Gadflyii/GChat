---
date: 2026-10-18
title: "Own custom GInfer startup in Hosts"
---

# 2026-10-18 — Own custom GInfer startup in Hosts

- **Context:** Settings held global engine startup overrides while GInfer Hosts
  edited per-instance settings independently. Chat/API starts combined those
  overrides with a model's native context, although Models Load selected a
  complete tested Host profile. A valid tested context could therefore be
  rejected by automatic loading.
- **Decision:** Models owns ordinary Load/Stop and package management. GInfer
  Hosts owns custom startup settings and saved profiles. Settings keeps model
  discovery, engine location, startup timeout and automatic unloading, with
  direct links to Models and Hosts. Remove global startup overrides and their
  extension consumption. New automatic chat/API starts select tested profiles
  through the same native route as Models Load, preserving explicit GPU
  constraints and operation IDs. Already attached custom sessions stay attached;
  an explicit Models Load still checks for the matching tested profile.
- **Consequences:** Provider or per-model context settings cannot override a
  tested desktop startup profile. Missing or unsuitable profiles still fail
  through native admission. Settings saves never restart a running model.
  Custom native/CLI launch configuration and the Hosts editor remain supported;
  model folder, binary selection, timeout and unload behavior remain available.
- **Owner:** Codex 7; claude-arch signed 2026-10-18 04:46Z.
- **Links:** [Current authority](../host-ui/README.md),
  [Installed tested-profile loading](2026-10-17-use-catalog-profile-settings-for-installed-load.md),
  [Earlier provider startup controls](2026-08-30-make-ginfer-model-controls-match-its-startup-contract.md).

Supersedes in part the two linked decisions: desktop automatic starts now use
profile defaults; provider startup controls and their restart prompt are removed.
Explicit Hosts and CLI configuration retain their ownership.
