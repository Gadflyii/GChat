---
date: 2026-10-16
title: "Guide Microsoft sign-in with a release identity"
---

# 2026-10-16 — Guide Microsoft sign-in with a release identity

- **Context:** Installed Gbot Cloud PC setup asked ordinary users to configure a
  Microsoft client ID before signing in. Ron could not understand the requirement.
- **Decision:** Default to browser-based **Sign in with Microsoft** using an
  approved public desktop-app identity compiled into the release. Until that
  identity is supplied, explain the missing release setup in plain language and
  disable sign-in. Keep existing custom registration under an advanced option
  with steps for an organization's already approved app.
- **Consequences:** Existing saved registrations and account selections win over
  the release default. Loading the default neither opens the vault nor writes
  configuration. OAuth PKCE, explicit service/account selection and permission
  checks remain unchanged. Ron owns the release registration and live consent
  gate; agents use synthetic IDs and local mocks only.
- **Owner:** team.
- **Links:** [Setup and release configuration](../workspace-connectors/operations.md),
  [native connector ownership](2026-10-10-own-native-workspace-connectors.md).
