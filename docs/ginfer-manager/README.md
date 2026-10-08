# GInfer Server Manager

Repository: GChat. Owner: GChat coordinator. Subject: `docs/ginfer-manager/`.
Accepted runtime source: `ce6a6c0e6` for Windows; `2a6e21ff2` for the retained
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

The latest correction exposes automatic or exact GPU KV budgets in custom
launch/reload. Acceptance covers explicit null/fixed byte payloads, preserving
context/concurrency/headroom, unchanged saved-profile selection, independent
review, required source checks and the installed Windows control. Engine changes,
profile requalification, full-context/model qualification and Server 2 work are
excluded. The earlier neutral per-host Offline/Online fix remains delivered.

## Current decision and next action

The custom KV-budget correction is installed on RON-9950X3D2 from `ce6a6c0e6`.
Use **Reload → Custom settings**, clear **GPU KV budget (bytes, blank =
automatic)**, review the remaining settings and submit **Reload**. Clearing sends
`kv_arena_bytes: null` and removes qualified-profile attribution, while retaining
context, concurrency, headroom and all other saved options. A positive byte count
requests an exact arena. Qualified catalogs and their evidence stay unchanged.

The October 8 failure is an explicit-arena fit rejection. The pinned actual Host
snapshot selected Muse native-NVFP4 text C1 / 131,072, requesting 12,467,568,640
arena bytes with 314,572,800 headroom bytes from the installed bundled catalog.
That profile records engine `922e5a8`; installed engine `6138913f` rejects its exact
arena after startup. Host forwards the saved value unchanged. Disk/NUMA profile
warnings are nonfatal. No measurement identifies a changed startup allocation or
establishes current full-context capacity. Manager previously inherited the fixed
arena without exposing a way to change it; the new control closes that UI gap.

The native control is visible with the saved 11.6 GiB value and 131,072/C1 fields.
A custom Reload at 21:37:59 UTC retained that fixed arena and repeated the failure;
only `qualified_profile_id` changed to null. Attribution to live user clicking or
numeric UI automation is unresolved; the user was asked. Interactive form editing
by automation stopped. No successful automatic launch or native clearing claim is
made. Next: the user's explicit automatic-budget retry. Requalify current-runtime
profile capacity before publishing a new fit claim; old measurements are not new
engine qualification.

All apps were closed before the actual update; Manager normal startup opened the
registered GChat-owned Host. At verification, Manager PID 12192 and Host PID 12996
share original Host ID `4941572e-7ccf-48b7-a950-de8d4dd731c6` at HTTPS 7443.
Registry, owner locator, settings and readable native remote grant are preserved.
Two installed models remain; the instance is failed with no engine running.
The saved workload, fixed arena and headroom are unchanged by the latest attempt.
Fleet remains unconfigured. Existing per-host Online/Offline and actionable
Needs-attention behavior remain. GChat was not rebuilt; Linux retains `2a6e21ff2`.
Server 2 received no administration or testing.

Current diagnosis, source/native checks, observed state change and cleanup:
`/ai/gchat/out/manager-kv-startup-20261008/`. Prior offline evidence remains in
`/ai/gchat/out/manager-offline-status-20261008/`; local GChat installation evidence
remains in `/ai/gchat/out/local-update-20261008/`.

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

Required source checks pass at `ce6a6c0e6`: lint/typecheck, contract/assets,
2,067 frontend tests (six skipped), 102 extension tests, nineteen Manager DOM tests,
all six critical coverage floors and supported Rust suites, including 547 desktop
tests (seven ignored), 62 Host units and eight real TLS/Host-client checks.
`make verify` initially stopped on missing candidate extension dependencies;
its missing coverage/Rust targets passed after linking the existing caches. A real ten-second credential-stall regression retains an
actual cached pool, reports an actionable coordinator issue and verifies recovery.
Earlier unchanged Rust source passed separate GChat and Host/Manager Clippy with
warnings denied; the current change is UI/documentation only and native compilation
emitted no warnings. All five
code-session tests pass after a test-only lint correction. Independent source
review findings were implemented; root reviewed the actual changes and receipts.

Windows package:
`/ai/gchat/out/ginfer-manager/windows/ginfer-manager-windows-x64.zip`.
Current native Rust/MSVC compilation took 1m37s with one Cargo job and the standard
release profile. Source staging, four archive members, current guide and hashes
pass. The installed normal window and original pinned HTTPS identity/grant pass.
The native memory guard stayed above its 4 GiB floor after the unchanged 8 GiB
start preflight; minimum available RAM was
6,689,947,648 bytes. Shared compiler/dependency caches were preserved.

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

Fresh candidates need existing root/core/web and extension workspace dependency
links before checking. Two early gate attempts lacked the extension state/package
links; restoring them, without installation, produced passing extension coverage
and all remaining Rust checks. Future candidate preparation includes these links.

The first updater correctly refused a remembered Host PID before changing files.
Actual inspection found all apps closed, not a replacement Host process. The update
uses the verified current process inventory; normal Manager startup owns a new
registered Host process while retaining its identity. Native number inputs report
as UIAutomation Spinners. Do not use numeric ValuePattern editing in a live launch
form during user testing: the 21:37:59 Reload attribution remains unresolved, and
such automation has stopped. Use DOM payload regressions and read-only native
control inspection; no successful automated native clearing claim is retained.

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
| KV budget candidate | `/ai/gchat-worktrees/manager-kv-budget` | Accepted `ce6a6c0e6` retained in Git; checkout disposition in task `worktree-cleanup.json` |
| KV budget evidence | `/ai/gchat/out/manager-kv-startup-20261008/` | Pinned public snapshot/catalogs, review and source/native checks; no credentials or model copy |
| KV native candidate | `C:\Users\Ron\AppData\Local\GChat\windows-build\manager-kv-startup-20261008` | Retired after accepted Windows package/install; shared cache junction detached first |
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
