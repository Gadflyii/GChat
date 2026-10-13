---
date: 2026-10-13
title: "Use assigned Cloud PCs for Gbot setup"
---

# Use assigned Cloud PCs for Gbot setup

The M365 wizard connects setup to a user's existing Windows 365 assignment. It
uses the shared Microsoft account owner and delegated `CloudPC.Read.All` consent,
with explicit account and computer selection. No tenant-wide provisioning or
Cloud PC purchase is performed. Credentials stay in the existing vault.

The Gbot service owns durable setup metadata: bot name, account reference,
assigned-PC identity and connection choice. Saving rechecks the assignment;
removing setup leaves the account and Cloud PC intact. Cancelled save/remove
requests do not interrupt their owned durable write. No launch URL or token is
persisted. Microsoft launch details are fetched afresh for the exact saved PC.

Setup requires confirmation that the Cloud PC is dedicated to the bot. The user
chooses the supported Microsoft client or a tenant-approved in-PC worker with an
independent connection. Saved prerequisites are separate from a connected
workspace: neither an assignment nor opening Microsoft's client establishes
Gbot desktop viewing, input, takeover or Ready. Those routes remain to be
qualified on the dedicated Cloud PC, including tenant policy and session recovery.

Missing app registration, consent, account, assignment and launch failures are
shown in setup with explicit retry. Sign-in completion never chooses a computer;
there is no account polling or reuse of operating-system authentication tokens.
The source gates use the existing focused service/native/UI fixtures and add no
dependency, resource provisioning or native Windows build.

Owner: GChat. Current state and evidence:
[Gbot README](../gbot/README.md#current-record-and-inventory).
Microsoft contracts:
[list assigned PCs](https://learn.microsoft.com/en-us/graph/api/user-list-cloudpcs?view=graph-rest-1.0),
[retrieve launch detail](https://learn.microsoft.com/en-us/graph/api/cloudpc-retrievecloudpclaunchdetail?view=graph-rest-1.0).
