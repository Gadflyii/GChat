# Evidence and prepared installed checks

This reference supports the existing entries in GInfer's [single master
list](/ai/ginfer-worktrees/open-work/docs/maintainer/open-work.md). It records
evidence scope and concrete check inputs; issue status, owners and prioritization
remain in that list. Repository: GChat; subject: `docs/agent-runtime/`.
The October 9 review uses source `104d4ec6e`, installed GChat `a40d7221`,
Manager `ce6a6c0e6`, and native Engine `2ef56a52a`. Source acceptance and installed
acceptance are different claims.

The next dependent action is OI-091's shared tool discovery/schema fix followed
by the coordinated installed Chat continuation check. This work performed no
GPU operation, inference, application restart, dependency installation,
publication, remote administration or user permission/settings mutation. Server
2 remains excluded; Ron's OI-077 profile-presentation work remains parked.

## Shared conversation, documents and compaction

The [current runtime authority](README.md) already records accepted full
verification for unified sessions at `d1821fa5c` and the installed refresh. Reuse
those results. The following inspected evidence identifies what is established:

| Retained input or existing test | Supported observation |
| --- | --- |
| `/ai/gchat/out/unified-sessions-20261008/code-history/stock-public-api.receipt.json` | Stock OpenCode 1.18.21 retains session identity after server restart; public select/new/rename/delete work without inference. |
| `/ai/gchat/out/unified-sessions-20261008/code-history/stock-transcript-restart.receipt.json` | One stock transcript message restores under the same session ID, with no phantom session; public TUI selection passes without inference. |
| `src-tauri/src/core/code_sessions.rs` tests | Shared sidebar references retain the owning stock transcript and user metadata; caller ancestry requires the same complete workspace chain. |
| `src-tauri/src/core/code_bridge.rs` tests | Native file and configured connector execution use each actual Code caller's policy; child callers inherit live parent policy, disabled tools remain disabled, approval and cancellation use the shared executor. |
| `src-tauri/src/core/agent/capabilities.rs::chat_excel_read_preserves_extracted_cells_after_external_folder_approval` | A real XLSX outside the workspace requests folder access and, after approval, exposes Budget, Revenue, 42000, Expenses and 12000 in the model-facing summary. Metadata does not replace extracted contents. |
| `web-app/src/lib/attachmentProcessing.test.ts`, `execute-chat-capability.test.ts`, `custom-chat-transport.harness.test.ts` | Document references reach transport and agent staging; extraction failure is observable. These are client/transport regressions, not an installed Windows workbook replay. |
| `web-app/src/lib/__tests__/conversation-command.test.ts`, `smart-context.test.ts`, `custom-chat-transport.harness.test.ts` | `/compact` reaches its proper conversation boundary, retains transcript authority, uses reported loaded capacity, and does not start stopped models. |
| `src-tauri/src/core/agent/runner_tests.rs`, `context.rs` | Worker compaction uses the existing state/checkpoint path; preserved tools, approval and cancellation remain part of worker execution. |

An actual workbook copied from the existing Rust regression is prepared at
`/ai/gchat/out/remaining-acceptance-20261009/Quarterly budget.xlsx`.
`office-fixture.json` records its source and represented cells. ZIP CRC and an
independent XML read confirm A1=Revenue, B1=42000, A2=Expenses, B2=12000.
Fixture integrity establishes the check input only.

For the coordinated installed OI-068 replay, use the exact fixture path from an
otherwise normal saved Chat and Code workspace. Ask for its worksheet and both
amounts. Preserve the actual external-folder request and the user's decision;
inspect the shared tool summary and subsequent assistant reply for the exact
cells. An auto-approval mode alone does not establish folder permission. A denied
folder check must preserve denial; discovery must not grant access. Continue in
the same session, reload saved history and inspect retained document references,
sidebar type and stock Code transcript authority. Then exercise the existing
`/compact` boundary in Chat, Code and a running worker, preserving context counts,
checkpoint state, completion/Working state and metrics. Select existing saved
agents, skills and configured connectors through the same native executor; do
not change their definitions, grants or budgets to make the replay pass.

Installed tiny-question Chat is currently blocked by OI-091: Muse recorded
40,666 prepared input tokens against 32,768 loaded capacity. Source or fixture
checks cannot substitute for actual continuation after that fix. The original
Desktop Excel error is unavailable; this workbook validates the corrected
shared path and cannot establish that original incident's cause.

Hermes configuration independently advertises 65,536 tokens
(`web-app/src/routes/launch/index.tsx` and native `configure_hermes_agent`), and
the native source records Hermes' 64K minimum. The existing 32K Engine screens
cannot qualify that contract. A compatible actually Ready instance, installed
Hermes and its unchanged real configuration are prerequisites for the Hermes
reply/tool/continuation check. Do not represent the advertised value as proof of
actual Engine capacity or silently change the saved profile for this screen.

## Physical shared pools and Linux providers

OI-069's supporting [Manager evidence](../ginfer-manager/README.md) includes
actual TLS tests. Existing `src-tauri/ginfer-host/tests/fleet.rs` covers durable
revision/CAS catalogs, independent paired clients, coordinator read-only member
views and membership persistence. `worker_pools.rs` checks shared capacity across
overlapping pools and exact session affinity. The existing
`worker_dispatch.rs::real_dispatch_queues_cancels_releases_and_rejects_session_substitution`
check exercises real native dispatch with controlled servers. These results do
not establish simultaneous physical workers.

The real fleet is unconfigured. A chosen coordinator, a matching-version second
paired physical client/member, reachable pinned locator and explicitly available
Ready worker instances are the missing inputs. On those selected hosts, create
one disposable coder pool through Manager, inspect the same catalog revision and
canonical membership from the other client, then overlap worker runs against
the declared pool limits. Record visible queueing, cancel a queued worker, and
show its slot becomes available. Disconnect/reconnect the selected member and
preserve the cached catalog, executing worker's exact session and the actionable
failure/recovery. Do not promise global reservations: shared pool worker-limit
accounting is process-local; other clients' inference load is Engine-owned.
No model loads or coordinator changes were performed in this review.

OI-071's retained native Linux X11 receipt
`/ai/gchat/out/ginfer-manager/linux/native-smoke/receipt.json` explicitly used
`--window --no-tray`, had no tray watcher or native vault and preserved the empty
Host after Manager exit. The accepted Linux archive is `2a6e21ff2`; the later
offline-panel change was not rebuilt into it. Its standalone pinned HTTPS/sharing
receipt is an empty fixture without Engine execution. The missing providers are
a native desktop tray watcher and Secret Service on a designated Linux desktop.
On that desktop, use the actual Manager/Host pair, pair through the native vault,
restart Manager and restore the saved grant, then use Show/Hide and Exit tray
actions while checking that the same Host remains alive. No provider install,
Linux deployment or credential changes were attempted here.

## Installed community publication

OI-073 requires a designated disposable completed Standard Benchmark result,
installed community signing configuration and the board owner's publication
window. The 12 official reference series / 36 points are already accepted and
must remain untouched. Synthetic fixture data must not be published as measured
community results.

The existing frontend `services/benchmark/leaderboard.test.ts` checks public
payload fields, the complete supported C1/C4/C8 workload, malformed receipts and
ownership persistence across a lost-response retry. Native `benchmark_submission`
tests bind the exact result hash, challenge, expiry and key, and check the PHP
signature vector. Actual website publication/replay/rollback belongs to the
separate Sectile Web `site/gbench` repository; this checkout has no installed
deletion/replay acceptance receipt.

With the designated result and board window, publish through installed GChat's
`submit_benchmark` command, compare public readback to that result and keep the
returned deletion receipt private. Interrupt a response after acceptance and
retry the same saved owner token; then perform concurrent replay and the board's
rollback/deletion path against only that disposable result. Observe uniqueness,
receipt recovery, retained ownership and final removal. Those are concrete
installed/board checks; local signing tests or earlier official imports cannot
close them. This review sent no publication request.

## Native idle observation and remaining rendering measurement

At 2026-10-09 16:26:20Z, a 30.09-second read-only Windows observation matched
the exact installed GChat, Manager and Host paths on RON-9950X3D2 and aggregated
each root's actual descendants. All 15 processes retained their PID/start time;
GChat and Manager were visible and responding, autostart was disabled, and no
`ginfer-serve.exe` existed. WebView runtime was 154.0.4258.62. The sample made no
navigation, debug attachment, restart or settings/data change.

| Installed process group | Processes | CPU, percent of one logical core | Summed working set, MiB | Private commit, MiB |
| --- | ---: | ---: | ---: | ---: |
| GChat, root 33828 | 7 | 3.843 | 541.4 | 341.2 |
| Manager, root 20188 | 7 | 0.363 | 376.3 | 221.7 |
| Host, root 34448 | 1 | 0.208 | 14.4 | 7.6 |

The host exposes 32 logical processors; these percentages are normalized to one
core, not total machine capacity. Working-set sums can double count shared pages;
private bytes represent commit rather than resident physical RAM. The actual
visible conversation and its length were not inspected. This is a native current
view observation, not a long-conversation rendering benchmark, regression claim
or attribution to polling. Exact process roots, counters and scope are retained
in `/ai/gchat/out/remaining-acceptance-20261009/idle-sample.json`.

OI-075 still needs the actual representative long saved conversation selected
and recorded, with the same build, window state and measured idle/open/scroll
workload on Windows WebView and Linux X11. The normal restored Windows app has
no owned debug listener; no debug restart was authorized in this window. The
later coordinator-controlled measurement should preserve existing history and
use browser frame/long-task observations alongside these same native process
counters. No numerical performance floor or arbitrary conversation cap is set.
The source review's controlled DOM checks can distinguish redraw mechanisms,
but cannot establish native performance gains.

## Original diagnostic preservation

OI-076's original full-context/format warning is absent from the retained
incident. `/ai/gchat/out/agent-recovery-20261001/stuck-chat-incident.json` records
the later continuation: final request used 39,459 input tokens and 437 generated
tokens, persisted assistant state was ready/stop and engine work drained, while
the user still saw Working. That supports the separately fixed frontend lifecycle
defect; it does not reconstruct the earlier warning. The original model reported
131,072 context, and the earlier context/format warnings did not recur. OI-091's
new 32K schema overflow is a distinct observed failure, not demonstrated cause
of the October 1 incident.

The missing input is the exact original diagnostic or a preserved recurrence.
On recurrence, retain the full error, actual loaded capacity, prepared prompt
count, active tool schemas and continued conversation/run before recovery.
Preserve messages, tool results and settings; do not delete history or restart
the server to erase the evidence. No speculative engine fix follows from the
available receipt.

## Owned inventory and execution

| Owner / exact path | Purpose and retention |
| --- | --- |
| Remaining acceptance `/ai/gchat-worktrees/remaining-acceptance`, branch `dev/gchat-remaining-acceptance-104d4ec6` | Evidence reference from `104d4ec6e`; no product source or shared cache changes. |
| `/ai/gchat/out/remaining-acceptance-20261009/` | Retain bounded idle receipt/command and the copied Office fixture for the coordinated installed replay; no live job or build. |
| Existing `/ai/gchat/out/unified-sessions-20261008/`, `agent-recovery-20261001/`, `ginfer-manager/`, `oi056-current-engine/` | Reused retained evidence; no duplicated suite or model artifacts. |

Two file-launch attempts ran no measurement: a guessed native path did not
exist, and UNC script-file execution was rejected by PowerShell authorization.
The completed sample used the actual `wslpath` root and a single encoded command
without changing execution policy. Future checks use actual path translation,
durable JSON output and retained process completion status.

This documentation-only change uses link/path review and `git diff --check`.
Already accepted source suites were not rerun; no installed capability or
publication result is claimed by preparing inputs or writing this reference.
