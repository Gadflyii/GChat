---
date: 2026-10-14
title: "Package Engine documentation from its runtime manifests"
---

# 2026-10-14 — Package Engine documentation from its runtime manifests

- **Context:** The authorized current Linux Engine rebuild retires the separate operations/versioning guides. GChat's six-document external provenance contract rejects its five-entry runtime payload.
- **Decision:** Stage the Engine's README, VERSION, CLI, serving and release names from the verified runtime manifest. Require the same hashed documentation in all four images and preserve offline link checks.
- **Consequences:** One Engine-owned payload supplies both runtime and desktop documentation. Remove the obsolete external documentation-directory argument; historical packages remain evidence, not inputs to current assembly.
- **Owner:** GChat.
- **Links:** [Installer refresh](../installer-refresh/README.md), [runtime staging](../../scripts/stage-linux-runtime-set.py), GInfer `packaging/runtime-docs.json` at `415eaa2b5`.
