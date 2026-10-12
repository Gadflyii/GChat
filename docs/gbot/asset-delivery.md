# Pinned guest asset delivery

This source change delivers the accepted Debian image, Driver archive and native
media archive through existing release-resource and configured-data installer
owners. The [decision](../decisions/2026-10-12-deliver-pinned-gbot-guest-resources.md)
records the shared immutable pin authority and unchanged readiness contract.
Acceptance requires one small fixture for exact pins, data delivery, interrupted
retry and mismatch refusal, plus the owning native compile check. Full suites,
downloads, host installations, real asset copies, VMs, Windows, publication and
live desktop interaction are excluded.

The accepted pins are retained exactly in
[`guest-assets.json`](../../src-tauri/gbot-service/guest-assets.json). Release
assembly accepts only explicit existing local payloads; it does not obtain them.
The source delivery path cannot by itself qualify installed release assets or a
wizard-created VM. Those are the next unresolved acceptance actions.

## Evidence and current inventory

The final focused native fixture passed (1 test, 0 failures), including exact
accepted pins, production rejection of synthetic bytes, delivery to a custom
configured data root, a read-only interrupted partial, idempotent retry and
source/final mismatch refusal. The owning native check and strict Clippy passed.
The locked/offline, network-disabled Rust container used existing dependencies,
CPUs 0–31 and six jobs. The shared cache slot ended at **20:16:26Z**; no native job
remains. Python 3.14 compilation, affected shell syntax and `git diff --check`
passed; these are source checks, not a staged accepted-payload release test.

Retained receipts are
`/ai/gchat/out/gchat-open-items-20261012/asset-delivery-native-fixture.log`,
`asset-delivery-native-check.log`, `asset-delivery-native-clippy.log` and the
`asset-delivery-gate.sh` invocation. The admitted image was
`sha256:428cb8ca20b73d6d4b2cd8faba6584765562775c2577052caf91077a6214b132`.

| Owner / host | Exact path | State / retention |
| --- | --- | --- |
| GChat / local | `/ai/gchat-worktrees/gbot-asset-delivery-89e4`, branch `feat/gbot-asset-delivery-89e4` | Owned candidate from `89e4a22f425d057d90470096d10a36f5fd14e8b5`; retain source until integration. No root/main edit. |
| GChat / local | `/ai/gchat/out/gchat-open-items-20261012/asset-delivery-*` | Focused fixture/check/Clippy, gate invocation and handoff; retain concise evidence. |
| Coordinator / local | `/ai/gchat/src-tauri/target` | Existing shared admitted Cargo cache; this task owns no separate cache or build tree. |

No source checkpoints, real guest payloads, VM directories, credentials or
runtime dependencies are allocated. Fixture payloads use a self-cleaning temp
root and deliberately synthetic pins; they do not qualify the large artifacts.
The task-owned generated inert Tauri stubs and Python bytecode were removed
after the checks. No live job remains. The worktree and concise gate receipts
remain for source integration and review; the shared cache is coordinator-owned
and was not cleaned.
