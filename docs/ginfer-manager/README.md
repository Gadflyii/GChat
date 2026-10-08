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

Client bug fixes are accepted and pushed separately. The existing host owns
server processes and pairing. Existing `agent-worker-pools.json` is local to
GChat; it cannot by itself satisfy the shared fleet-assignment requirement.
Do not add a second host process controller or a manager-only pool store.

The thin shared client and one selected host authority are implemented. The
coordinator owns a durable revision/CAS catalog; paired clients resolve its pinned
locator from any member, and hosts receive read-only projections of their own
pool/instance memberships. Studio browses all pools; client assignments constrain
runnable placements. Fleet workers freeze the validated catalog for each run.
Offline catalogs remain visible but cannot launch new pool work.

The existing host owns launch, downloads, grants and sharing. Manager reuses that
implementation and the same native credential vault as GChat. Manager-first
startup imports the registered owner's configured metadata. Legacy pool import
receipts prevent deleted pools from returning. Current, explicit instance and pool
workers normalize to one physical instance/session identity so capacity limits
cannot be bypassed. First coordinator setup requires a reachable advertised origin.

Independent source review accepted the registry concurrency, authority selection,
coordinator origin propagation, cancellation history and canonical instance fixes.
Behavioral evidence includes 61 host units, five shared-client tests, ten fleet
integrations, pairing/control/lifecycle checks, eight native worker regressions,
two Code integrations, fourteen frontend checks and thirteen production Manager
DOM/action checks. These use owned inert children and real TLS fixtures; they are
not real-model or physical-GPU qualification. The full required `make verify`
passed: 2,067 frontend tests, 102 extension tests, the Manager DOM suite, all six
critical coverage floors and supported Rust suites (546 desktop tests plus the
host/plugin/utilities suites). Warnings-denied Clippy now passes for changed GChat,
Host and Manager crates using `--no-deps`. Two equivalent selector expressions
were corrected for declared MSRV and redundant closure lint; all eight focused
worker regressions passed afterward. Native Windows assembly is now authorized
under the current booking and emergency-memory guard.

The first two full gates stopped because this worktree lacked extension-project
and package dependency-cache links. Both now reuse the accepted caches, and the
actual extension Vitest CLI preflight passes. Before future worktree gates, verify
root/project/package cache links and execute that CLI. Failure logs are retained;
no dependency installation or upgrade was required.

The accepted Linux package is 4.9 MiB. Both binaries require at most GLIBC 2.39,
matching Server 2's fresh inventory; this is an ABI screen, not deployment
qualification. Actual X11 display, Models Scan through native IPC, and Manager
exit while its empty host remains responsive passed. The user's requested default
dark theme uses GChat's exact tokens and explicit native dark preference, verified
with actual screenshots while the desktop prefers light. No fixture jobs remain.
This desktop has neither a tray watcher nor Secret Service provider: visible
window fallback and local control are verified, while native Linux tray and vault
pairing remain unqualified. Injected-credential TLS/fleet tests have separate scope.

Server 2 is verified as `AIS-1-2950X-L02` at `192.168.1.112`, glibc 2.39, without a
running user Secret Service provider. No installation, real model/GPU execution
or fleet mutation has occurred. C1's private reference job returned its locks at
13:00:43 UTC. Current booking is local5090 line 251,
`gchat-manager-verify-windows`, 13:04–13:34 UTC on October 8, preemptible CPUs 0–31,
no GPUs. A continuation is booked for 13:34–14:04 UTC under the same owner.
Native Windows assembly started at 13:17 UTC with four jobs, an exclusive build
lock, WSL quiet and a ten-second emergency-memory guard. Fresh available Windows
memory was 6.75 GB; the guard stops only the owned compiler tree below 4 GiB.
At 13:18:41 UTC available memory fell to 3,981,864,960 bytes; the guard terminated
only the owned Cargo tree and the build returned failure without an artifact.
Resume uses the same owned partial cache with one job, sized to this measured
headroom. Other processes and WSL caches remain untouched. The memory trace and
failed build log are retained as proof of the enforced guard and correction.
The one-job attempt started with 5,703,385,088 available bytes but the single
`windows` dependency compile reached 3,849,961,472 bytes at 13:20:09 UTC. The guard
again stopped only its owned tree. No third identical attempt is authorized.
Before retry, retire this task's completed 1.5 GiB Linux release cache (accepted
binaries and evidence are retained), then measure actual Windows headroom. The
floor and release optimization stay unchanged; unrelated caches/apps are preserved.
The retirement attempt acquired no build lock and made no changes: C1's finite
legacy-NV comparator job had acquired the ordinary lock and started at 13:24:26
UTC. No native build is active. Bookings 251 and 252 were returned at 13:25 UTC;
C1 will report its actual end before Manager requests a fresh quiet interval.
Read-only native-cache inspection found no exact reusable `windows` dependency
fingerprint: accepted GChat artifacts use different feature sets/profiles. No
cache copy or fingerprint substitution was made. Available Windows memory later
recovered to 9.80 GB, but no retry starts during C1's model run. The inactive
Linux fixture's private host/config/data state and disposable harnesses are
retired; redacted screenshots, snapshots and exit receipts remain.
C1 reported all four comparator commands finished and locks returned at 13:35:22
UTC, with no successor. Fresh process inspection confirms no model/compiler.
At 13:36 UTC the exact owned Linux release cache was retired under the build
lock: 4,932 files, 1,682,564,388 bytes. Accepted binaries and archive remain.
The new `gchat-manager-windows` booking is 13:36–14:06 UTC, preemptible CPUs 0–31,
no GPUs. The next one-job attempt requires freshly measured available Windows
memory of at least 8 GiB, with the existing 4 GiB running emergency guard, an
owned-process RSS observer and WSL quiet. No identical low-headroom retry occurs.
Fresh quiet Windows available memory was 10,583,470,080 bytes at 13:36:40 UTC.
The unchanged single `windows` crate compiled successfully on the one-job retry;
its measured peak private allocation was 2,406,203,392 bytes. This explains why
the earlier 5.70 GB starting headroom could not sustain the 4 GiB running floor.
The same release profile and guard are preserved; application compilation proceeds.
Final independent review accepts `af5013730`, including the two equivalent lint
changes, without a remaining source/design blocker.
Native Rust compilation finished successfully in 3m25s and produced both PE
binaries. Packaging then stopped because PowerShell 5.1's returned Process object
reported a null exit code after the timed wait. This is a builder result-handling
defect, not a compile or memory failure. Before packaging retry, reproduce exit
0/7 with the same native process/wait path and pin the Process handle if confirmed;
validate the corrected script with a no-op Cargo run and retain the built binaries.
Native PowerShell 5.1 reproduction confirms the cause: both exit 0 and exit 7
returned null without retaining the handle, and returned the exact expected code
after reading `Process.Handle`. The builder now pins its owned Process handle
immediately after launch. AST and diff checks pass; no-op packaging validation
uses the accepted binaries and preserves their before/after hashes.
Reviewed source is committed as `af5013730`; main integration waits for native
Windows acceptance. The two lint corrections change no selector semantics.
Next: finish native assembly and tray/vault/control smoke, then reviewed merge/push.
The shared release cache is root-owned and unwritable; it remains untouched.

## Owned inventory

| Owner / host | Path | Purpose and retention |
| --- | --- | --- |
| Coordinator / Ron-9950X3D2 | `/ai/gchat-worktrees/ginfer-manager` | Active candidate; retain source and current design/evidence |
| GChat | `/ai/gchat`, `6eacebfff` | Accepted stable source; no manager mutation |
| Client fixes | `/ai/gchat-worktrees/unified-sessions` | Accepted client candidate; preserve passing evidence |
| Shared caches | `/ai/gchat/node_modules`, `/ai/gchat/src-tauri/target` | Reuse dependencies and compiler cache |
| Manager build/evidence | `/ai/gchat/out/ginfer-manager/linux/` | Current default-dark native archive, guide, window/control evidence; retain accepted package |
| Manager compiler / Ron-9950X3D2 | `/ai/gchat/out/ginfer-manager/linux/cargo-target/` | Retired after accepted binaries/review retained; 1.68 GB released, receipt in Linux evidence folder |
| Shared-client verification | Candidate `out/ginfer-manager/client-{check,tests,tests-final}.log` | Scoped host check, client/lease/pairing/fleet regression logs; consolidate at handoff |
| GChat fleet verification | Candidate `out/ginfer-manager/gchat-fleet-tests.log` | Eight worker, two Code and fourteen frontend regressions, typecheck/lint |
| Combined gate | `/ai/gchat/out/ginfer-manager/make-verify*.log` | Passing gate and both missing-cache-link failures; retain correction evidence |
| Native Windows / RON-9950X3D2 | `C:\Users\Ron\AppData\Local\GChat\windows-build\ginfer-manager\{source,target,out}` | Owned isolated NTFS partial cache and guard evidence; guarded one-job assembly resumes next, accepted GChat cache/install preserved |

Compile only one process at a time under `/tmp/ginfer-local-build.lock`, with
`CARGO_BUILD_JOBS=6`, and not during a local model load. Native Windows work waits
for Linux acceptance, verified memory/booking and a quiet WSL interval. The
October 8 manager brief explicitly authorizes native Windows assembly after
Linux and supersedes the older October 6 no-Windows-build instruction for this
assembly only; it does not authorize a model run or GChat update.

The five completed client subtask trees are retired. Unrelated GChat/GInfer
worktrees, engine artifacts, installed apps and other owners' jobs are untouched.
Only this coordinator host has been inspected; no fleet cleanup is claimed.
