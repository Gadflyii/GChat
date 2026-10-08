# GInfer Server Manager

Repository: GChat. Owner: GChat coordinator. Accepted source is retained at
`/ai/gchat-worktrees/ginfer-manager`, branch `feat/ginfer-manager`; stable main
is `/ai/gchat`. The previous client baseline was `6eacebfff`.

## Outcome and acceptance

Implement the user's standalone Server Manager from
`/ai/faceless-video/tmp/briefs/ginfer-server-manager-gchat.md`: Windows tray and
Linux X11 window, independent of GChat, over the existing ginfer-host controller.
Provide local/paired instance start/stop/reload, models/downloads, sharing, pairing,
client grants and fleet worker-pool assignments visible to every paired client.

Acceptance requires the design note, independent source review, relevant behavioral
regressions, `make verify`, Linux native assembly/control evidence and Windows
native tray assembly. No engine tuning, numerical/performance qualification,
dependency upgrade, GPU/driver changes, installed GChat update or fleet deployment
belongs to this brief. Any subsequent model test must use fleet booking; Server 2
runs only through its queue.

## Current decision and next action

The implementation and native packages are accepted. Reviewed implementation
`af5013730`, builder correction `bc9a369f5` and independently reviewed standalone
LAN correction `2a6e21ff2` are integrated into main. Both packages use the final
runtime source `2a6e21ff2`; documentation-only handoff changes do not rebuild them.
The [design](../ginfer-manager.md), [decision](../decisions/2026-10-08-share-host-management-and-fleet-pools.md)
and [operator guide](guide.md) describe the delivered behavior.

Manager shares GChat's locked registry and native credential vault. The host owns
launch, downloads, grants and sharing; Manager does not start a model on opening
or replace another owner's host. Closing/exiting Manager leaves hosts running.
The requested default dark theme uses GChat's exact tokens and native preference.

One selected coordinator owns durable revision/CAS pools and client assignments.
Every paired client resolves its pinned locator through fleet members. Hosts
receive read-only projections of their own membership. Studio browses the full
catalog; assignments constrain runnable placement. Each run freezes its validated
catalog and instance/session affinity. Offline catalogs are read-only and cannot
start new pooled work. Exact migration receipts prevent deleted pools returning;
canonical physical identity preserves overlapping worker limits.

The desktop windows used for verification were isolated empty-host fixtures,
not the installed GChat configuration or real fleet. They are closed and retired.
Next product action is matching installed host/GChat versions and real-fleet click
testing. The packages contain Manager, matching Host, guide and font license;
they contain no inference engine or models. Current installed apps remain unchanged.

## Verification and limits

Final `make verify` passed: 2,067 frontend tests (six skipped), 102 extension
tests, thirteen Manager DOM tests, all six critical coverage floors and supported
Rust suites, including 546 desktop tests (seven ignored), 62 Host units and real
TLS/client/fleet regressions. Changed GChat, Host and Manager Clippy passed with
warnings denied and `--no-deps`. Independent source review found no unresolved
in-scope blocker.

Final standalone status evidence covers undiscoverable off, standalone
enabled/active on its actual bound port despite an old disabled managed preference,
managed startup failure, and managed stop preserving an independent standalone
listener. Pairing uses effective activity, with consistent LAN → data lock order.
Eighteen focused checks pass in candidate `out/ginfer-manager/lan-status-tests.log`.

Linux package:
`/ai/gchat/out/ginfer-manager/linux/ginfer-manager-linux-x64.tar.gz`.
Final assembly took 1m23s. Actual final CLI/pinned HTTPS reports enabled/active
on port 44851, matching its listener; Host exited zero and its private fixture
was retired. Exact archive/guide/hash checks pass. Both ELFs require at most
GLIBC 2.39; Server 2's matching ABI is a screen, not deployment. GTK3,
WebKit2GTK 4.1 and Soup3 remain prerequisites.

Earlier actual Linux X11 evidence covers default dark on a light desktop,
Models Scan through native IPC, and window exit leaving its empty Host responsive.
Its UI/client code is unchanged by the final Host correction; this is recorded
earlier-build evidence, not a replay of the final ELF. This desktop has no tray
watcher or Secret Service provider, so native Linux tray and vault pairing remain
unqualified. Local window fallback is verified; no plaintext fallback was added.

Windows package:
`/ai/gchat/out/ginfer-manager/windows/ginfer-manager-windows-x64.zip`.
Final native Rust/MSVC build took 1m41s with one Cargo job. Actual current dark UI
shows LAN port 53815, equal the paired Host's live TLS listener. Nearby one-click
Pair and native Credential Manager storage pass; Forget removes the saved grant
and credential. Tray Exit leaves both empty Hosts responsive. All three final
fixture PIDs ended; private state and credentials are retired. Earlier native
evidence also covers secure-storage probe, Models Scan, saved pairing after
restart, tray close/Open/Refresh and no-tray Close. No real model/GPU was run.

## Execution corrections

Missing extension dependency links caused two early gates to stop. Reusing the
accepted cache links and checking the actual extension Vitest CLI corrected them;
the final gate passed without dependency installation.

Two low-headroom native compiles crossed the 4 GiB running floor; the guard stopped
only their owned Cargo trees. The heavy Windows crate measured 2.41 GB private
peak. Fresh sufficient headroom and a quiet WSL interval resolved the failures
without changing profile/floor or purging global caches. Final build minimum
available RAM was 9,372,327,936 bytes. Local CPU bookings were released at actual
completion; no current task jobs or resource allocations remain.

PowerShell 5.1 lost Cargo exit status after completion. Reading the owned Process
handle fixes actual exit-zero/seven reproductions. The mirror also removed a
generated schema; exact source/destination Manager/gen exclusions now preserve it
while copying tracked UI/config. A production-argument copy fixture verifies that
behavior. Accepted final binaries are preserved without another rebuild.

## Owned inventory

| Owner / host | Exact path | Purpose and retention |
| --- | --- | --- |
| GChat / Ron-9950X3D2 | `/ai/gchat` | Stable main with reviewed Manager source |
| Manager / coordinator | `/ai/gchat-worktrees/ginfer-manager` | Accepted source/build baseline; retain |
| Prior client candidate | `/ai/gchat-worktrees/unified-sessions` | Clean superseded tree retired; source commits and external evidence retained |
| Shared caches | `/ai/gchat/node_modules`, `/ai/gchat/src-tauri/target` | Shared dependencies/compiler cache; preserve |
| Linux accepted package/proof | `/ai/gchat/out/ginfer-manager/linux/` | Archive, binaries, hashes, native screenshots and actual final CLI/TLS receipt |
| Windows accepted package/proof | `/ai/gchat/out/ginfer-manager/windows/` | Final archive/current guide, hashes and selected public native evidence |
| Windows native source/output | `C:\Users\Ron\AppData\Local\GChat\windows-build\ginfer-manager\{source,out}` | Accepted native binaries, package, public receipts/screenshots and guarded-build logs |
| Manager compiler caches | Linux `linux/cargo-target/`, native Windows `target/` | Retired after acceptance; Linux final 1.68 GB and Windows 1.79 GB, receipts retained |
| Focused verification | Candidate `out/ginfer-manager/` | Relevant client/fleet/worker and corrected status regression logs |
| Combined verification | `/ai/gchat/out/ginfer-manager/make-verify*.log` | Passing final gate and concise correction evidence |

The five earlier completed client subtask trees and superseded client baseline are
retired. Unrelated worktrees, shared caches, installed apps, engine artifacts and
other owners' jobs are untouched. Only this coordinator host was inspected;
no fleet cleanup is claimed. GInfer's separately accepted operations manual
handoff is tracked in [Agent runtime](../agent-runtime/README.md).
