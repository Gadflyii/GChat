---
date: 2026-10-16
title: "Allow personal Microsoft accounts with the release registration"
---

# 2026-10-16 — Allow personal Microsoft accounts with the release registration

- **Context:** The guided Microsoft flow defaulted its release tenant to
  `organizations`, excluding personal Outlook.com, Hotmail and OneDrive users.
  Ron registered the public desktop app `e618bfb1-eb1d-4112-ad84-e3ff963f585c`
  for organizational and personal accounts on October 16.
- **Decision:** Shared native release build configuration embeds that public
  client ID and defaults to `common`. Explicit build configuration and saved
  organization registrations retain precedence. Explain work or school account
  requirements for organization-only services and map recognized provider
  consent failures to plain guidance without exposing raw provider responses.
- **Consequences:** Personal Microsoft accounts can use supported services;
  SharePoint and Windows 365 Cloud PC still require work or school accounts and
  applicable permissions or licenses. GChat does not infer account type from an
  email address or a generic HTTP failure. Ron confirms the public-client
  `http://localhost/oauth/callback` redirect in Entra and performs live consent;
  agents use local mocks only.
- **Owner:** team; release registration and live consent: Ron.
- **Links:** [Connection operations](../workspace-connectors/operations.md),
  [guided sign-in decision](2026-10-16-guide-microsoft-sign-in-with-release-identity.md),
  [Microsoft account audience](https://learn.microsoft.com/en-us/entra/identity-platform/v2-supported-account-types),
  [loopback redirects](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url).
