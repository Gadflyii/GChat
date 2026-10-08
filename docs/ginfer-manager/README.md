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

Read-only delegated mapping is complete. The design chooses a thin shared client,
one selected host authority with durable revision/CAS, redacted client activity,
canonical pool instances and explicit stale/offline behavior. It also identifies
the bounded host-only Flash/MTP admission gap. The design `fdcb6237d` was sent
to bubbs before implementation. Shared client/control, fleet authority, GChat
pool adapters, manager shell/packaging and Flash host admission are now delegated
in disjoint file areas; the coordinator integrates and verifies their outputs.

Review and implementation mapping exposed concrete identity/migration gaps.
Local administrator requests used the host UUID, not an issued client grant;
add a stable host-private local-client identity so local fleet assignments work
without requiring a desktop vault. A retained legacy pool file can otherwise
resurrect deleted pools; commit import receipts atomically with mapped pools.
Canonical local pool IDs must normalize the Current/Instance allocator and
affinity identity too, preserving overlapping limits. The design also preserves
populated authority ownership and durable revision ordering during explicit
empty-authority reconfiguration. Independent review found no further design
blocker after these corrections; code acceptance remains pending.

This WSL desktop has X11 and GTK/WebKit/AppIndicator, but no tray watcher and
no Secret Service provider. Linux window/local control can be checked here;
native Linux vault/pairing requires a desktop with an available provider. Do not
save paired tokens as plaintext or install packages to bypass that limitation.
The user clarified the cross-workstation expectation: creating a coder pool on
one workstation must make it visible from another paired with the same fleet,
and hosts must know their own pool/instance memberships. Resolve the known
coordinator from any paired host and enroll through the shared pinned pairing
routine. First creation offers a shared hosting coordinator instead of a local
fork. Add read-only derived member projections; they never become editable
catalog replicas. Studio browses all built pools, while assignments select usable
ones. An explicit Fleet assignment worker target consumes preferred placements.

Focused host checks pass: 61 unit tests, three shared-client behavior tests,
pairing, seven fleet integrations, Cargo check and warnings-denied Clippy before
the latest membership join. Client checks use an inert owned child/HTTP fixture,
not a real model. Eight production DOM/action tests pass. They caught recursive
child-rendering and duplicate preferred-host choices; the UI owner corrected
both. Follow-up tests protect one-click discovered pairing, truthful explicit
draft-width validation and membership freshness. The combined gate, native
window/build and latest integration review remain pending.

No GPU allocation, real-model run or fleet mutation has started. Server 2 is
freshly verified as `AIS-1-2950X-L02` at `192.168.1.112`, glibc 2.39; its user
session also has no running Secret Service provider. Next: complete and review
the implementation, then build Linux and verify actual window/control behavior
before native Windows assembly. Pairing acceptance must distinguish injected
test credentials from an actual native vault.

## Owned inventory

| Owner / host | Path | Purpose and retention |
| --- | --- | --- |
| Coordinator / Ron-9950X3D2 | `/ai/gchat-worktrees/ginfer-manager` | Active candidate; retain source and current design/evidence |
| GChat | `/ai/gchat`, `6eacebfff` | Accepted stable source; no manager mutation |
| Client fixes | `/ai/gchat-worktrees/unified-sessions` | Accepted client candidate; preserve passing evidence |
| Shared caches | `/ai/gchat/node_modules`, `/ai/gchat/src-tauri/target` | Reuse dependencies and compiler cache |
| Manager build/evidence | `/ai/gchat/out/ginfer-manager/linux/` | Planned native Linux artifact and window/control evidence |
| Shared-client verification | Candidate `out/ginfer-manager/client-{check,tests,tests-final}.log` | Scoped host check, client/lease/pairing/fleet regression logs; consolidate at handoff |
| Native Windows / RON-9950X3D2 | `C:\Users\Ron\AppData\Local\GChat\windows-build\ginfer-manager\{source,target,out}` | Planned isolated NTFS build; preserve accepted GChat cache/install |

Compile only one process at a time under `/tmp/ginfer-local-build.lock`, with
`CARGO_BUILD_JOBS=6`, and not during a local model load. Native Windows work waits
for Linux acceptance, verified memory/booking and a quiet WSL interval. The
October 8 manager brief explicitly authorizes native Windows assembly after
Linux and supersedes the older October 6 no-Windows-build instruction for this
assembly only; it does not authorize a model run or GChat update.

The five completed client subtask trees are retired. Unrelated GChat/GInfer
worktrees, engine artifacts, installed apps and other owners' jobs are untouched.
Only this coordinator host has been inspected; no fleet cleanup is claimed.
