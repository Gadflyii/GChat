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

Next: map actual host APIs, current local/client identities and pool consumers;
choose one authoritative assignment store and its read/write protocol, write
the design note, then start bounded implementation. No manager code, build,
GPU allocation or live test has started.

## Owned inventory

| Owner / host | Path | Purpose and retention |
| --- | --- | --- |
| Coordinator / Ron-9950X3D2 | `/ai/gchat-worktrees/ginfer-manager` | Active candidate; retain source and current design/evidence |
| GChat | `/ai/gchat`, `6eacebfff` | Accepted stable source; no manager mutation |
| Client fixes | `/ai/gchat-worktrees/unified-sessions` | Accepted client candidate; preserve passing evidence |
| Shared caches | `/ai/gchat/node_modules`, `/ai/gchat/src-tauri/target` | Reuse dependencies and compiler cache |

The five completed client subtask trees are retired. Unrelated GChat/GInfer
worktrees, engine artifacts, installed apps and other owners' jobs are untouched.
Only this coordinator host has been inspected; no fleet cleanup is claimed.
