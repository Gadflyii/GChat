# GInfer Server Manager

Repository: GChat. Owner: GChat coordinator. Candidate:
`/ai/gchat-worktrees/ginfer-manager`, branch `feat/ginfer-manager`, based on the
reviewed and pushed client source `6eacebfff`. Stable main is `/ai/gchat`.

## Outcome and acceptance

Implement the user's standalone GInfer Server Manager from
`/ai/faceless-video/tmp/briefs/ginfer-server-manager-gchat.md`. Ship a small
Windows tray application and Linux X11 window with a tray when supported,
independent of the GChat desktop process. Reuse `src-tauri/ginfer-host` for
discovery, pairing, sharing, model inventory/downloads and instance lifecycle.
Expose per-host start/stop/reload, model/GPU/port/client status, paired-client
grants and host-wide worker-pool assignments shared with every paired client.
Keep inference engine behavior and existing GChat conversation behavior intact.

Write [the design note](../ginfer-manager.md) and send its exact path to bubbs
before building. Review the API/storage design while implementation proceeds.
Acceptance requires the Linux X11 application plus local and paired-fleet host
control evidence, native Windows tray assembly, relevant behavioral regressions,
independent code review and `make verify`. No numerical/performance campaign,
dependency upgrade, GPU power/driver/package change or GChat installer update is
authorized by this task. Book any real-model test through the fleet protocol;
Server 2 launches only through its queue.

## Current decision and next action

The standalone Manager, shared native client and fleet catalog are implemented.
Reviewed source `af5013730` is pushed on `feat/ginfer-manager`; native builder
correction `bc9a369f5` is committed. Main remains `6eacebfff` until final acceptance.
The current candidate corrects a status defect found in the actual Windows UI:
a standalone advertised host paired successfully but reported sharing inactive
and port 7444 instead of its real port 53086. Replace its boolean marker with the
actual optional advertised port; effective status includes that listener while
managed start/stop remains independent. Snapshot enabled distinguishes managed
requested preference from standalone effective availability. Pairing and local
administrator restrictions remain intact. Eighteen focused Host checks pass;
the final combined gate and changed Host/Manager Clippy passed before both
package rebuilds and a focused native status/port check. No current native fixture or engine jobs remain.

The existing host owns launch, downloads, grants and sharing. Manager reuses that
implementation and the same native credential vault/locked registry as GChat.
Manager-first startup imports the actual registered owner's configured metadata.
One chosen coordinator stores durable revision/CAS pools and client assignments;
paired clients resolve its pinned locator through any member. Hosts receive
read-only projections of their own pool/instance memberships. Studio browses the
catalog; assignments constrain runnable placements. Each run freezes its validated
catalog and exact instance/session affinity. Offline catalogs are read-only and
cannot launch new pooled work. Exact import receipts prevent deleted legacy pools
from returning; canonical physical identity preserves overlapping capacity limits.

Independent source review accepted registry reconciliation, authority selection,
origin propagation, zero-step cancellation history and canonical instance fixes.
First coordinator setup publishes a reachable address. Thirteen production DOM
checks and real TLS/client/fleet regressions cover these behaviors, with inert
owned children rather than models or GPUs. The final standalone-status diff is independently accepted, including LAN → data
lock ordering. Next: Linux build, guarded Windows rebuild/status proof, then
reviewed main merge/push.

## Evidence and execution corrections

The pre-status-fix full `make verify` passed: 2,067 frontend tests, 102 extension
tests, thirteen Manager DOM tests, all six critical coverage floors and supported
Rust suites (546 desktop tests, seven ignored, plus Host/plugin/utilities suites).
Changed GChat, Host and Manager warnings-denied Clippy passed with `--no-deps`.
Eight final worker regressions passed after the two equivalent MSRV/closure lint
corrections. The final combined gate passed with the newly corrected Host (62 unit tests) and
its GChat test seam; focused status evidence is candidate
`out/ginfer-manager/lan-status-tests.log` (two sharing, five client, ten fleet and
one TLS pairing test). Public snapshots cover undiscoverable off, standalone
actual port/active/enabled despite an old disabled desktop preference, managed
startup failures and independent managed stop while the standalone listener stays
pairable. No engine numerical or performance claim follows from these checks.

Actual Linux X11 display, Models Scan via native IPC and Manager exit while its
empty host remains responsive passed. Default dark uses GChat's exact tokens
and explicit native preference, proven in real screenshots while the desktop
prefers light. Both ELF binaries require at most GLIBC 2.39, matching the freshly
verified Server 2 (`AIS-1-2950X-L02`, `192.168.1.112`); this is an ABI screen, not
remote installation. This desktop has no tray watcher or Secret Service provider,
so native Linux window/local control is verified but tray/vault pairing is not.
No plaintext fallback or package installation bypasses that limitation.

Actual native Windows pre-fix checks passed: Nearby one-click Pair, Credential
Manager probe, paired Models Scan, tray close/Open/Refresh/Exit, saved pairing
after restart, Forget deleting the credential, and no-tray Close. Both same empty
Host processes survived Manager exit. Five owned processes, their credential and
private fixture state were retired at 13:57:36 UTC; redacted screenshots, snapshots
and receipts remain in native `out/native-smoke/`. These remain evidence for the
recorded behaviors; the old package is held pending corrected sharing status.
The post-fix check will use a fresh `native-smoke-status` fixture and compare the
rendered/public port to the actual listener, then forget/exit/retire it.

Concrete build failures and preventive changes:

- Two full gates stopped at missing extension-project/package cache links. Reuse
  the accepted links and verify the actual extension Vitest CLI before a gate;
  the corrected full gate passed without installing/upgrading dependencies.
- Native Jobs4 and Jobs1 compiles crossed the 4 GiB running floor at low starting
  headroom; the guard terminated only their owned trees. After a quiet start with
  10,583,470,080 bytes available, the unchanged one-job build succeeded. The heavy
  Windows crate measured 2,406,203,392 bytes private peak, explaining the earlier
  5.70 GB baseline failure. Retain the profile/floor and require fresh sufficient
  starting headroom; no identical low-memory retry or global cache purge.
- PowerShell 5.1 reported null Cargo exit status after completion. Actual exit0/7
  reproduction confirms reading its owned Process handle preserves exact codes;
  the corrected builder packaged successfully. A source mirror then removed a
  generated Windows schema and caused a 56-second Manager rebuild. Exact source
  and destination `Manager/gen` exclusions now preserve generated files while
  copying tracked UI/config; an actual production-argument copy fixture verifies
  this behavior. Rebuild only for the current Host source change, then retain the
  tested binaries without another rebuild.

Initial Linux native assembly took 1m22s; its requested dark rebuild took 42.42s.
The shared release cache was root-owned/unwritable and remains untouched. Its
owned 1.68 GB replacement cache was retired at 13:36 UTC after accepted binaries
were preserved. A new scoped release target is needed for the corrected Host.
C1's finite model turn ended at 13:35:22 UTC. Current local5090 CPU booking is
`gchat-manager-windows`, 13:36–14:06 UTC with a 14:06–14:36 continuation, preemptible
CPUs 0–31, no GPUs. Linux checks/build and native Windows compilation are serial
under the build lock; Windows clearance resumes WSL quiet and its ten-second
memory guard. No installed GChat/host replacement, real model run or fleet
mutation is authorized or claimed.

## Owned inventory

| Owner / host | Path | Purpose and retention |
| --- | --- | --- |
| Coordinator / Ron-9950X3D2 | `/ai/gchat-worktrees/ginfer-manager` | Active candidate; retain source and current design/evidence |
| GChat | `/ai/gchat`, `6eacebfff` | Accepted stable source; no manager mutation |
| Client fixes | `/ai/gchat-worktrees/unified-sessions` | Accepted client candidate; preserve passing evidence |
| Shared caches | `/ai/gchat/node_modules`, `/ai/gchat/src-tauri/target` | Reuse dependencies and compiler cache |
| Manager build/evidence | `/ai/gchat/out/ginfer-manager/linux/` | Default-dark archive and native evidence; held for corrected Host rebuild |
| Manager compiler / Ron-9950X3D2 | `/ai/gchat/out/ginfer-manager/linux/cargo-target/` | Retired after accepted binaries/review retained; 1.68 GB released, receipt in Linux evidence folder |
| Shared-client verification | Candidate `out/ginfer-manager/client-{check,tests,tests-final}.log` | Scoped host check, client/lease/pairing/fleet regression logs; consolidate at handoff |
| GChat fleet verification | Candidate `out/ginfer-manager/gchat-fleet-tests.log` | Eight worker, two Code and fourteen frontend regressions, typecheck/lint |
| Combined gate | `/ai/gchat/out/ginfer-manager/make-verify*.log` | Passing gate and both missing-cache-link failures; retain correction evidence |
| Native Windows / RON-9950X3D2 | `C:\Users\Ron\AppData\Local\GChat\windows-build\ginfer-manager\{source,target,out}` | Owned NTFS cache/package/pre-fix proof; corrected Host rebuild pending, installed GChat preserved |

Compile only one process at a time under `/tmp/ginfer-local-build.lock`, with
`CARGO_BUILD_JOBS=6`, and not during a local model load. Native Windows work waits
for Linux acceptance, verified memory/booking and a quiet WSL interval. The
October 8 manager brief explicitly authorizes native Windows assembly after
Linux and supersedes the older October 6 no-Windows-build instruction for this
assembly only; it does not authorize a model run or GChat update.

The five completed client subtask trees are retired. Unrelated GChat/GInfer
worktrees, engine artifacts, installed apps and other owners' jobs are untouched.
Only this coordinator host has been inspected; no fleet cleanup is claimed.
