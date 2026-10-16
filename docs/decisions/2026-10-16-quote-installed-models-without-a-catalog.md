---
date: 2026-10-16
title: "Quote installed models without a catalog"
---

# 2026-10-16 — Quote installed models without a catalog

- **Context:** Startup checks in the first-run wizard require a catalog download job. A supported model imported from a local path has no such job, so Manager cannot check its settings when the catalog is empty.
- **Decision:** Expose an administrator startup quote for an existing Host inventory UUID and the same launch request and instance count used by placement. Reinspect the artifact metadata, validate its registered identity and run the current Engine quote through the shared placement calculation. Manager and GChat offer this check in their custom launch forms.
- **Consequences:** Local models need no fabricated release or download metadata. A quote does not start, persist or reserve an instance; launch always quotes again. Artifact verification checks metadata and supported identity, not a complete payload digest. Form changes invalidate the displayed quote. Linux source gates cover the shared path; Windows runtime qualification remains a separate gate.
- **Owner:** team.
- **Links:** [Manager guide](../ginfer-manager/README.md), `GCHAT-LOCAL-MODEL-STARTUP-QUOTE-20261016`.
