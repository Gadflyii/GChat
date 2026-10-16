---
date: 2026-10-16
title: "Guide Google Desktop registration and import client JSON"
---

# 2026-10-16 — Guide Google Desktop registration and import client JSON

- **Context:** Ron chose per-user Google Desktop OAuth clients. Requiring users
  to copy a client ID and secret into Settings makes this setup hard to follow.
  External apps left in Testing also lose these Workspace refresh tokens after
  seven days, which can look like an application failure.
- **Decision:** Keep Google registration user-owned, with no built-in Google
  release identity. Guide project creation, API enablement, External consent,
  Desktop-client creation and production publishing in Settings. Import the
  downloaded Desktop JSON with a file picker through the existing native
  configuration and credential-vault path. Explain expired or revoked sign-in
  without provider error text. Microsoft's release identity remains separate.
- **Consequences:** Users avoid manual credential copying. Import accepts only
  bounded Desktop-client data, ignores supplied provider URLs and does not grant
  consent. Imported credentials are transient in the frontend and any secret is
  stored by the native vault. Changing registration requires reconnection. The
  own-app unverified warning guidance never bypasses administrator restrictions;
  production publishing is distinct from Google verification. Source tests use
  synthetic registrations and local mocks; Ron owns live consent acceptance.
- **Owner:** team.
- **Links:** [Setup and operations](../workspace-connectors/operations.md),
  [Google native-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app),
  [Google token expiry](https://developers.google.com/identity/protocols/oauth2#expiration),
  [Google verification guidance](https://developers.google.com/data-manager/api/devguides/concepts/oauth-verification).
