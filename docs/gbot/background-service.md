# Native background service lifetime

Candidate: `feat/gbot-background-ec21`, owned worktree
`/ai/gchat-worktrees/gbot-background-ec21`, baseline `ec21a1874`.
The coordinator owns the current [Gbot record](README.md) and master work ledger.
This implementation supplies the missing independent lifetime while retaining
existing runtime, executor, workspace, account and approval ownership.

GChat launches its installed executable in `--gbot-service` mode, before Tauri
single-instance/window startup. The detached process acquires the existing
exclusive service-owner lock under the exact `<data>/gbot` directory before
opening state. Its native vault-backed bearer authenticates loopback clients;
`<data>/gbot/service.json` records only its service ID, endpoint and exact data
folder. Reopening GChat validates these values and reconnects to the same
service. Concurrent starters serialize through ownership; a losing process
never opens mutable service/account state. No alternative data root is inferred.

The service owns `AccountsState` at the existing
`<data>/workspace-connections.json` path and its native Google/Microsoft provider
and credential implementations. UI settings and ordinary Chat/Code calls proxy
to this owner. Bot calls retain linked-account checks, preparation before
approval, admission rechecks and durable operation receipts. Ordinary connector
calls register a cancellation identity before execution; cancellation or dropped
client tasks cancel that registered operation, while duplicate execution is
refused. Neither the service bearer nor provider secrets enter the webview.

The owning API retains guided KVM setup, workspace lifecycle, schedule ticker,
durable task recovery and the pinned packaged Cua ComputerAgent/context helper.
For AppImages, the service launches the outer image and rebases resources in its
own mount, preserving Python/Bun and guest files after the GUI image exits.
Explicit environment executor configuration still uses its existing paired
variables. No packaged runtime manifest means task execution is unavailable;
an invalid/incomplete declared runtime fails service startup rather than silently
running a disconnected executor. Unsupported platform setup remains unsupported.

GChat Exit drops its native update subscription, leaving the service alive.
`Quit Gbot service` sends authenticated shutdown, cancels/joins tasks, closes
connector OAuth/operations and workspace/setup jobs, then waits for ownership
release. Saved state is retained and the current GUI will not implicitly restart
the explicitly stopped service. `Start Gbot service` reconnects/starts it again.
Shared account operations also stop with this service, stated in the stopped UI.
No OS login startup or inference process owner changes are introduced.

Bot brain assignment creation still starts with an empty API URL, model and
context. Its explicit inputs preserve saved URLs and vault-backed keys. Adjacent
text requires an independently running Host endpoint for background work and
states that the GChat port 1337 facade exits with GChat. External persistent
endpoints continue unchanged; no saved assignment is silently rewritten.

## Verification and retained inventory

Source is frozen before the coordinator-booked focused CPU gate. The new
process fixture starts only a test API with a memory vault and inert executor;
it checks client disconnect/reconnect, durable workspace/schedule retention,
unauthenticated shutdown rejection and authenticated shutdown with a pending
update poll. Existing affected schedule UI cases plus one explicit stop/start
case, native compile/strict owning Clippy, frontend types and affected lint are
the intended gates. Results are pending; no physical guest/model or packaged
AppImage lifetime claim is made from this fixture.

Retain the owned source worktree/branch for integration and concise gate
receipts in `/ai/gchat/out/gchat-open-items-20261012/background-service-note.md`.
Reuse the coordinator-owned accepted Cargo/frontend caches; no owned build
copy, downloaded artifact, VM, model or running service is allocated by this work.

Ordinary Chat/Code connector requests carry a native GUI client identity. GChat Exit awaits a bounded disconnect cancellation sweep and closes that identity before dropping its client; late registrations are rejected. Bot tasks and their approval ownership are independent of this client identity.
