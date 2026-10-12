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

GChat Exit cancels ordinary Chat/Code connector operations for its native client
identity and drops its update subscription, leaving bot tasks and the service
alive. The identity is closed before cancellation so late operation registration
cannot escape the sweep.
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

The focused gate passed on source `77c6cab04` in the coordinator-booked
CPU-only window, ending 2026-10-12 20:46:51Z. The process fixture selects one
case and starts a separate test API process with a memory vault and inert
executor. It checks client disconnect/reconnect, durable workspace/schedule
retention, unauthenticated shutdown rejection and authenticated shutdown with a
pending update poll. Native `test-tauri,cli` library check and strict owning
Clippy, `gbot-service` library/binary strict Clippy, all 11 affected UI cases,
frontend types and changed production-file lint passed. All Cargo commands used
locked/offline dependencies in the accepted container, CPUs 0–31, jobs 6.

The desktop `gchat` binary cannot be checked with `cli`, which disables the
existing desktop startup function. A separate `test-tauri` binary check reached
the existing build script and stopped on missing `resources/pre-install/**/*`
bundle resources; no fake resource or product configuration override was added.
Installed/AppImage parent-close, native-vault, sleep/resume, live OAuth, KVM and
model-backed scheduled dispatch lifetime remain unrun by this gate. No physical
Windows qualification is claimed. The fixture establishes API process lifetime
and retained state, not packaged provider/desktop execution.

Shared cache handoff initially selected the physical owner's test binary and
ran zero cases. That receipt was rejected; touching this candidate's changed
Rust source timestamps before retry forced the correct shared-path Cargo
fingerprint to rebuild, and the observed one-case result passed. The initial
fixture expected schedule creation status 201; existing API returns 200 and the
fixture expectation was corrected without changing production behavior.

Retain the owned source worktree/branch for integration and concise gate
receipts in `/ai/gchat/out/gchat-open-items-20261012/background-service-note.md`.
Reuse the coordinator-owned accepted Cargo/frontend caches; no owned build
copy, downloaded artifact, VM, model or running service is allocated by this work.
