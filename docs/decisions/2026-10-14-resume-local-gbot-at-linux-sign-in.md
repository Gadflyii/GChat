---
date: 2026-10-14
title: "Resume local Gbot at Linux sign-in"
---

# Resume local Gbot at Linux sign-in

Enabling Gbot registers an owned XDG desktop sign-in entry for the local service,
independent of the GChat window. Disabling Gbot or choosing a LAN service removes
only that entry. It carries the exact data folder and installed resource paths,
including the outer AppImage path; it carries no credentials.

On service startup, the setup owner restarts previously Ready local computers
using their saved VM identity and vault key, then repeats the readiness check.
Its private setup connection can pass that check while user operations remain
blocked until Ready. Unfinished first-time setup still needs explicit Resume.

This runs after desktop sign-in, not before it. A locked passphrase vault still
needs unlocking. Native Windows startup and VM provisioning remain release work.
No dependency or inference lifecycle changes are introduced.

Owner: GChat. Plan and evidence: [Gbot README](../gbot/README.md).
