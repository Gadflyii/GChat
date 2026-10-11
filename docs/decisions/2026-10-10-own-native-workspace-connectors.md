---
date: 2026-10-10
title: "Own native Workspace accounts and share connector execution"
---

# 2026-10-10 — Own native Workspace accounts and share connector execution

- **Context:** GChat bundles an external Google CLI skill without Windows admission
  and has no native Microsoft 365 account suite. Separate tool paths would repeat
  the Chat, Agent and Code differences Ron asked us to remove.
- **Decision:** One native account owner manages Google and Microsoft browser PKCE,
  OS-vault credentials, public account metadata and service consent. Typed provider
  adapters execute through existing shared capability discovery and permissions;
  freeze the exact account before approval and load schemas on demand.
- **Consequences:** Both desktop platforms expose the same account and tool model.
  Bundled native guidance replaces the external Google CLI skill. Registrations,
  provider consent, tenant policy and supported API operations still bound access.
  Live acceptance requires real registered client IDs and approved test accounts.
  SaaS integrations do not change LAN host management or add paid Arbitor layers.
- **Owner:** GChat team.
- **Links:** [Current delivery and verification](../workspace-connectors/README.md),
  [connection setup](../workspace-connectors/operations.md),
  [shared capabilities](2026-10-08-unify-conversations-and-code-capabilities.md).
