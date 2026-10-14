# Native background service lifetime

Independent service ownership is merged in main `500a5f2cb`; opt-in Linux
desktop sign-in startup and automatic reconnection of previously Ready KVM
computers are merged in `7e33222e8`. The installed reboot/sign-in gate passed:
the service starts without GChat and restores the same VM/session and native-vault
credentials (`out/gbot-linux-login/sign-in-recovery.json`). Existing AppImage
lifetime and scheduled recovery receipts remain accepted. Physical sleep and
model-backed scheduled recovery are separate obligations.
The coordinator owns the current [Gbot record](README.md) and master work ledger.
Existing runtime, executor, workspace, account and approval ownership is retained.

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
Linux Gbot enablement registers a separate desktop sign-in entry for the
local service, independent of GChat's window autostart. Disablement or selection
of a LAN service removes that entry. This does not run before user sign-in or
change inference process ownership. A passphrase-protected vault still requires
unlocking after sign-in; no key or passphrase is placed in the startup entry.

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
model-backed scheduled dispatch lifetime were unrun by that fixture gate. No physical
Windows qualification is claimed. The fixture establishes API process lifetime
and retained state, not packaged provider/desktop execution.

Shared cache handoff initially selected the physical owner's test binary and
ran zero cases. That receipt was rejected; touching this candidate's changed
Rust source timestamps before retry forced the correct shared-path Cargo
fingerprint to rebuild, and the observed one-case result passed. The initial
fixture expected schedule creation status 201; existing API returns 200 and the
fixture expectation was corrected without changing production behavior.

Retain concise fixture receipts in `/ai/gchat/out/gchat-open-items-20261012/background-service-note.md`.
Reuse the coordinator-owned accepted Cargo/frontend caches; no owned build
copy, downloaded artifact, VM, model or running service is allocated by this work.


The October 12 native gate uses the accepted `17f202edb` desktop executable,
not the test fixture, on S1 with a private D-Bus session and native keyring.
Caller exit leaves the owner/API alive; native credentials are absent from
discovery; duplicate ownership is refused; authenticated shutdown retires
discovery; restart reuses identity and credential. All five checks pass.
The private root and processes are retired. Empty guest resources produce
not-ready asset diagnostics; no executor, GUI, VM or model ran. This establishes
native process/vault lifetime, not installed GUI/AppImage close, sleep/resume,
live OAuth or scheduled model work. Receipts:
`out/gchat-open-items-20261012/installed-bootstrap/native-result.json` and
`native-cleanup.json`.

The October 13 AppImage gate passes: ordinary GUI exit preserves the same
native-vault authenticated Gbot owner; its separate mount imports Cua and runs
Bun; explicit shutdown retires the owner, endpoint, discovery and both image
mounts. The original GUI mount remains while the background owner runs.
The disposable guest and dev image are retired. Sleep/restart and live scheduled
dispatch remain unqualified. Evidence:
`out/gchat-open-items-20261013/appimage-lifetime/result.json`.


## Scheduled recovery gate

The October 13 gate passes on fixture source `51638ecda`: three selected cases,
zero failures, 1.41 seconds of test execution (34 seconds including compilation).
It exercises actual scheduled TaskRunner dispatch using the
existing in-process SSH guest and executor protocol mock. Its three cases cover
client exit, a simulated sleep/time jump, and cold service reopening. RunLatest
coalesces missed intervals, SkipMissed discards the backlog, and reopening must
reconnect without a GUI and retain the completed task receipt without another
effect. Existing unknown-outcome review behavior remains authoritative.

Acceptance is one focused mock case per lifetime boundary, with no model, VM,
physical sleep, OS login startup, Windows build or new harness. Existing production
scheduler and task recovery required no change. Results are in
`/ai/gchat/out/gbot-scheduled-recovery/result.json`; `focused.log` retains the three
case names. The test container is retired and CPU booking 644 cancelled. This
candidate owns no build copy or live service; it reused the accepted Cargo cache.
Mock lifetime/recovery acceptance is complete. Physical sleep and model-backed
scheduled dispatch remain release qualification, rather than claims of this gate.
