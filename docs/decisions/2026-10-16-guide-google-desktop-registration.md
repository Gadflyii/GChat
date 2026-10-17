---
date: 2026-10-16
title: "Guide Google Desktop registration and import client JSON"
---

# 2026-10-16 — Guide Google Desktop registration and import client JSON

- **Context:** Ron chose per-user Google Desktop OAuth clients with no shared
  Sectile Google registration or paid verification. Users need a complete setup
  guide and a choice of manual client ID/secret entry or downloaded JSON import.
  External apps left in Testing also lose these Workspace refresh tokens after
  seven days, which can look like an application failure.
- **Decision:** Keep Google registration user-owned, with no built-in Google
  release identity. Guide project creation, API enablement, External consent,
  Desktop-client creation and production publishing in Settings. Accept manual
  client ID/secret entry and downloaded Desktop JSON through the existing native
  configuration and credential-vault path. Use the system browser with a temporary
  loopback callback and PKCE; retain refresh tokens in that same vault for use
  after restart. Explain expired or revoked sign-in
  without provider error text. Microsoft's release identity remains separate.
- **Consequences:** JSON import avoids manual credential copying, while users
  who already have their client details can paste them. Import accepts only
  bounded Desktop-client data, ignores supplied provider URLs and does not grant
  consent. Imported credentials are transient in the frontend and any secret is
  stored by the native vault. Changing registration requires reconnection. The
  own-app unverified warning guidance never bypasses administrator restrictions;
  production publishing is distinct from Google verification. Google's
  personal-use exception avoids submission for verification or a paid security
  assessment; it does not remove unverified-app limits or organization policy.
  Temporary provider failures preserve saved credentials. Source tests use
  synthetic registrations and local mocks; Ron owns live consent acceptance.
- **Owner:** team.
- **Links:** [Setup and operations](../workspace-connectors/operations.md),
  [Google native-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app),
  [Personal-use verification exception](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification#personal-use),
  [Google token expiry](https://developers.google.com/identity/protocols/oauth2#expiration),
  [Google verification guidance](https://developers.google.com/data-manager/api/devguides/concepts/oauth-verification).
