# Own Gbot workspace connections in the local service

Status: accepted source-only scope, October 11, 2026.

Gbot's service owns durable workspace records, vault credential references,
guest session identities and operation reconciliation. It runs locally by
default. Guest file and command operations remain bound to that workspace;
transport failures cannot fall back to the user's computer.

Persist an operation before dispatch. Completion must match its workspace,
session and operation identity. After restart, discard live transport handles
and retain uncertain operations for reconciliation without replay. The shared
agent runtime remains the agent execution owner; this skeleton adds no agent
loop or provisioning flow.

An authenticated SSH connection establishes transport only. The initial view
channel forwards a guest-loopback endpoint and remains bidirectional transport,
without a read-only desktop or input qualification claim. Native vaults own
secrets; persisted records and diagnostic output contain references only.

Ron approved pinned `russh` 0.63.1 for the in-memory SSH client and hermetic
server fixture. A shared OS file lock admits one service owner per data folder;
the service's Rust minimum is 1.89. Dedicated VM, Windows and
M365 desktop qualification remain separate gates. The current plan and focused
acceptance live in [the Gbot authority](../gbot/README.md).
