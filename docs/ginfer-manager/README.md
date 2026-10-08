# GInfer Server Manager

Repository: GChat. Owner: GChat coordinator. Subject: `docs/ginfer-manager/`.
Accepted runtime source: `4021290af` for Windows; `2a6e21ff2` for the retained
Linux package. Packages and native proof live in `/ai/gchat/out/ginfer-manager/`.
Documentation-only handoffs do not rebuild accepted binaries.

## Outcome and acceptance

The standalone Manager requested in
`/ai/faceless-video/tmp/briefs/ginfer-server-manager-gchat.md` is delivered:
Windows tray and Linux X11 window, local/paired model start/stop/reload,
models/downloads, sharing, pairing, client grants and shared fleet work pools.
The [design](../ginfer-manager.md),
[decision](../decisions/2026-10-08-share-host-management-and-fleet-pools.md)
and [operator guide](guide.md) define its behavior.

The latest fix replaces the raw red connection failure under **Set coordinator…**
with neutral per-host availability. Acceptance covers Offline/Online status,
reconnection, actionable authentication/certificate/configuration failures,
read-only cached pools, source review, the required source gate and the normal
installed Windows window. Engine/model tests, coordinator changes, GChat/Host
restarts and Server 2 administration are excluded.

## Current decision and next action

Current candidate: `fix/manager-kv-budget` at
`/ai/gchat-worktrees/manager-kv-budget`, based on `cd74457df`.
Outcome: allow explicit automatic or fixed GPU KV sizing in Manager custom
launch/reload, preserving context, concurrency and other saved options. Verify
the submitted configuration, saved-profile path, required source gate and native
installed control. No engine change, model run, profile requalification, silent
settings change or Server 2 administration is authorized by this correction.

The October 8 startup report is an explicit-arena fit failure. The pinned actual
Windows Host snapshot shows the selected Muse native-NVFP4 text C1 / 131,072
profile requests 12,467,568,640 arena bytes and 314,572,800 headroom bytes.
That profile records engine `922e5a8`; installed engine `6138913f` rejects its
exact arena after startup. The installed bundled catalog supplies these bytes;
Host forwards them unchanged. Disk/NUMA profile warnings are nonfatal. No
measurement establishes which startup allocation changed or current full-context
capacity. Custom reload also inherits the fixed arena without exposing a control;
this missing control is the bounded implementation defect. Saved qualified
catalogs and their original evidence remain unchanged. The control and 19 Manager
DOM tests pass independent review. Required source checks pass: lint/typecheck,
contracts/assets, 2,067 frontend tests (six skipped), 102 extension tests, six
coverage floors and supported Rust suites. The initial gate needed the existing
extension dependency links restored in this new tree; remaining targets then
passed without installing dependencies. Next: native Windows assembly and
Manager-only update with unchanged Host/user state.
Read-only diagnostic evidence: `/ai/gchat/out/manager-kv-startup-20261008/`.

The fix is accepted and installed on RON-9950X3D2. The expanded Work pools and
client assignments panel shows RON-9950X3D2 **Online** and saved AIS-1-2950X-L02
**Offline**, in the default dark theme, with no raw connection error. Manager
PID 39660 attaches the original GChat-owned Host PID 36616 at HTTPS 7443. Settings,
registry, pinned host identity and native saved grant are preserved. Two installed
models and the stopped instance remain visible; no model was started.

Client failures keep their host identity and request phase. Transport refusal,
reset, timeout and known unreachable-host/network failures are Offline.
Authentication, certificate, schema, registry and credential failures remain
**Needs attention** with an explanation. An offline member cannot disable a
reachable coordinator, authorize legacy pool migration or cause an implicit
replacement coordinator. The original snapshot ten-second total/three-second
origin budgets, fleet ten-second deadline and generic 600-second request budget
are preserved. One typed pinned snapshot implementation serves every caller.

The fleet remains unconfigured. Next: user click testing and real-fleet shared
pool behavior after explicitly selecting a coordinator. Only the local Windows
Manager was refreshed; Linux remains its previously accepted package. Server 2
was not administered. A future model/GPU test requires fleet booking.

Current source/install/build/cleanup receipts and the actual expanded screenshot:
`/ai/gchat/out/manager-offline-status-20261008/`. Git records source integration;
`worktree-cleanup.json` records the final checkout retirement. Prior local GChat
installation evidence remains in `/ai/gchat/out/local-update-20261008/`.

## Ownership and fleet contract

Manager shares GChat's locked registry and native credential vault. The Host owns
launch, downloads, grants and sharing. Opening Manager does not start a model or
replace another owner's Host. Closing/exiting Manager leaves hosts running.

One selected coordinator owns durable revision/CAS pools and client assignments.
Paired clients resolve its pinned locator through fleet members. Hosts receive
read-only projections of their own membership. Studio browses the full catalog;
assignments constrain runnable placement. Runs freeze their validated catalog
and instance/session affinity. Offline catalogs are read-only and cannot start
new pooled work. Exact migration receipts prevent deleted pools returning;
canonical physical identity preserves overlapping worker limits.

## Verification and limits

Final `make verify` passed: 2,067 frontend tests (six skipped), 102 extension tests,
sixteen Manager DOM tests, all six critical coverage floors and supported Rust
suites, including 547 desktop tests (seven ignored), 62 Host units and eight real
TLS/Host-client checks. A real ten-second credential-stall regression retains an
actual cached pool, reports an actionable coordinator issue and verifies recovery.
Separate GChat and Host/Manager Clippy passes with warnings denied. All five
code-session tests pass after a test-only lint correction. Independent source
review findings were implemented; root reviewed the actual changes and receipts.

Windows package:
`/ai/gchat/out/ginfer-manager/windows/ginfer-manager-windows-x64.zip`.
Final native Rust/MSVC compilation took 1m36s with one Cargo job and the standard
release profile. Source staging, four archive members, current guide and hashes
pass. The installed normal window and original pinned HTTPS identity/grant pass.
The native memory guard stayed above its 4 GiB floor; minimum available RAM was
7,723,278,336 bytes. Shared compiler/dependency caches were preserved.

Earlier native tray, pairing/vault, Scan, saved-pair restart, no-tray and LAN-port
proof is retained in the Windows package's `native-smoke/` and
`native-smoke-status/`. This is baseline evidence, not replay of the current PE.
Private fixtures and superseded native source/output were retired. The current
acceptance does not claim inference/GPU qualification.

Linux package:
`/ai/gchat/out/ginfer-manager/linux/ginfer-manager-linux-x64.tar.gz`.
Its accepted `2a6e21ff2` assembly and pinned HTTPS/sharing checks remain valid
baseline evidence. Both ELFs require at most GLIBC 2.39. GTK3, WebKit2GTK 4.1 and
Soup3 are prerequisites. Earlier X11 checks cover default dark, Models Scan and
window exit preserving the empty Host. This desktop has no tray watcher or
Secret Service provider, so native Linux tray/vault pairing remains unqualified.
Server 2's matching ABI was a screen, not deployment. The offline-panel fix was
not rebuilt into this retained Linux archive.

Both packages contain Manager, matching Host, guide and font license. They
contain no inference engine or models. Registered service/Desktop ownership
continues to select the actual Host and engine independently of these companions.

## Execution corrections

The final review corrected an inaccurate eight-second baseline claim by checking
the original code and preserving its ten-second deadline. Credential preparation
and network timeout classification now differ before errors become text. The
shared transport implementation removes the divergent snapshot route. Regression
checks protect cached pools, recovery and blocking unknown-host legacy migration.

Direct Cargo checks require the public resource-stub target. Typed errors are
mapped at existing String IPC boundaries. A live membership fixture releases its
data lock before awaiting delivery. A pre-existing test-only clone warning uses a
borrowed slice; its focused tests and warning check pass.

Combined GChat test-tauri/Manager feature unification was an invalid check
configuration; separate product Clippy commands are authoritative. Native scripts
use actual `wslpath` output and the verified Ubuntu distribution. Guarded native
startup waits for actual Windows headroom after WSL file-page advice; one refused
preflight started no compiler. Shared cache files, toolchains, release profiles and guard
floors were preserved. Earlier low-headroom compiles stopped only their owned
Cargo trees; pinned Process handles retain the real PowerShell 5.1 exit status.

## Owned inventory

| Owner / host | Exact path | Purpose and retention |
| --- | --- | --- |
| GChat / RON-9950X3D2 | `/ai/gchat` | Stable main delivery checkout |
| KV budget candidate | `/ai/gchat-worktrees/manager-kv-budget` | Active custom-budget correction; baseline `cd74457df` |
| KV budget evidence | `/ai/gchat/out/manager-kv-startup-20261008/` | Pinned public snapshot/catalogs, review and source/native checks; no credentials or model copy |
| KV native candidate | `C:\Users\Ron\AppData\Local\GChat\windows-build\manager-kv-startup-20261008` | Planned bounded native mirror/output; shared target cache preserved |
| Offline source candidate | `/ai/gchat-worktrees/manager-offline-status` | Reviewed source retained in Git; checkout disposition in task `worktree-cleanup.json` |
| Windows accepted package/proof | `/ai/gchat/out/ginfer-manager/windows/` | Current archive/guide/hashes and earlier public native proof |
| Linux accepted package/proof | `/ai/gchat/out/ginfer-manager/linux/` | Retained `2a6e21ff2` archive and native evidence |
| Offline task evidence | `/ai/gchat/out/manager-offline-status-20261008/` | Required gate, Clippy, native build, installed UI/identity, cleanup receipts |
| Native task mirror | `C:\Users\Ron\AppData\Local\GChat\windows-build\manager-offline-status-20261008` | Retired after package/install acceptance; detached shared-cache junction first |
| Superseded native baseline | `C:\Users\Ron\AppData\Local\GChat\windows-build\ginfer-manager` | Retired; public proof preserved beside accepted Windows package |
| Shared caches | `/ai/gchat/node_modules`, `/ai/gchat/src-tauri/target`, native `windows-build/source/src-tauri/target` | Preserved dependencies/compiler cache |
| Earlier source candidates | `/ai/gchat-worktrees/ginfer-manager`, `/ai/gchat-worktrees/unified-sessions`, `/ai/gchat-worktrees/local-update-20261008` | Retired; source commits and accepted evidence retained |

Earlier Manager-specific Linux/Windows compiler targets were retired after their
acceptance. Unrelated worktrees, installed apps/data, engine artifacts and other
owners' jobs are preserved. Only this workstation was inspected; no fleet cleanup
is claimed. GInfer's separate operations-manual handoff is tracked in
[Agent runtime](../agent-runtime/README.md).
