# Chat and Agent runtime

## Agent result prompt failure — accepted Windows fix

The user confirms sidebar Stop works. The subsequent delegated run exposed a
separate Chat handoff defect: the SDK rejected optional `undefined` values in
JSON tool output after `convertToModelMessages`, before calling the model.
Persisted JSON had dropped those values, so saved history looked valid while
live continuation failed with `Invalid prompt: The messages must be a ModelMessage[]`.

Shared compact summaries and delegated results now omit absent fields. Zero
counters, errors and incomplete stage outcomes are retained. Normal Chat streams
its follow-up and reaches ready; the production ThreadMessage save/reload path
supports a later reply. Task budgets, model selection, permissions and history
are unchanged. The recorded run `b1f6572b-5429-4920-92eb-be9a9516a5d9` separately
ends `max_steps`: Researcher, Critic and synthesis reach their existing limits.
Engine changes, numerical/performance qualification and overall Coordinator
status reporting remain excluded.

The regression failed on baseline for finished, incomplete and failed results
with the reported SDK error. All 31 focused tests now pass, including actual
capability execution, SDK Chat/production transport, serialized history reload,
zero counters and retained errors. TypeScript and source ESLint pass; independent
SOL review found no blocking issues. Full `make verify` passed: 2,031 frontend
tests (6 skipped), 15 extension tests, critical coverage floors and supported
Rust suites, including 529 desktop tests (7 ignored). The preventive test uses
the actual structured result, replacing the earlier string-fixture evidence
that bypassed prompt validation.

Native NSIS/MSI assembly and the authorized Windows update from `a5d2e35f7`
exited 0. Both changed production files match the native mirror. Desktop matches
the build except Tauri's three-byte NSIS tag; CLI/host and all 120 members of each
bundled/active engine runtime verify. The unchanged engine is
`74780ea1415ac8d3bb440d58442ac4f81a5dfde3`; all 103 profiles from 14 explicit
catalogs are unchanged. Four models (44,808,326,736 bytes), eight conversations,
eight saved runs and agent definitions are preserved. Visible desktop PID 2900,
host PID 21120 and local HTTPS protocol version 1 passed startup verification.
No model was started by these checks.

The initial non-elevated update left the old elevated host running and failed
host binary verification despite NSIS exit 0. Recorded ownership and listener
identity identified that host; the user approved UAC and the elevated retry
replaced it. The retained updater now rejects an inaccessible host before NSIS
and checks termination. Installation success requires payload/startup verification.

| Owner / host | Exact path / revision | Purpose / retention |
| --- | --- | --- |
| GChat / workstation | `/ai/gchat`, accepted source `a5d2e35f7` | Reviewed implementation integrated and pushed to main |
| Agent follow-up | `/ai/gchat-worktrees/agent-followup-json`, `fix/agent-followup-json` | Accepted candidate released at handoff; see retained handoff receipt |
| Agent follow-up | `/ai/gchat/out/agent-followup-20261001/` | Retain focused/full verification, build/update receipts and cleanup evidence |
| Windows build / RON-9950X3D2 | `%LOCALAPPDATA%/GChat/windows-build/agent-followup-20261001` | Released after evidence retention; no live job |
| Accepted installers | `/ai/gchat/out/windows/`, native `%LOCALAPPDATA%/GChat/release-output` | NSIS/MSI and adjacent checksums |
| Compiler caches | `/ai/gchat/src-tauri/target`, native `%LOCALAPPDATA%/GChat/windows-build/source` | Preserve accepted builds/dependencies |
| Installed Windows | `%LOCALAPPDATA%/GChat`, `%APPDATA%/GChat/data` | Updated desktop/host; preserve user data |

The interrupted `/tmp/gchat-agent-followup-20261001` snapshot is removed.
Unrelated telemetry worktree and Server 2 are outside this cleanup; Server 2
remains uninstalled. Next user check: replay the saved agent in the existing
conversation, then send an ordinary message. Real-model replay remains distinct
from scripted verification. Ask Chat to list saved agents, or type
“Run my <agent name> on: <task>”; progress stays inline and inherits the chat's
folders/permissions, subject to saved-definition restrictions.

## Shared Chat and agent capabilities — accepted Windows update

The user approved one capability system for Chat and Agent Studio: a shared
native/MCP catalog and skill registry, common workspace/permission/cancellation
rules, and natural invocation of skills, saved agents and worker pools from Chat.
Normal replies retain streaming; tasks use the existing native orchestrator and
show progress in Chat. Slash commands remain optional shortcuts. Preserve model
selection, history, existing definition limits and remote-provider Chat support.

The October 1 Stop regression came from ChatInput's automatic startup effect:
unloading changed active-model state and the effect started the selected model
again. Stop now suppresses idle restart until explicit Start, model selection or
Send. It reserves the shared model lifecycle queue and resolves its unload target
after prior switches finish. The A → B → Stop → C regression confirms B unloads
before a later deliberate C start. Selection remains available after Stop.

Streaming Chat now uses the same Rust native/MCP catalog and ToolContext as the
Agent runtime. Skills and saved agents delegate to the existing orchestrator
with per-thread permissions, folders and cancellation. A saved pool chooses a
ready member rather than rejecting an offline first member. Disabled native
tools remain denied when a saved definition allows their capability. Builder
save confirmation and authoring restrictions are preserved. Failed and incomplete
task outcomes retain their inline summary; delayed terminal Channel events use
the authoritative result. See the
[capability decision](../decisions/2026-10-01-share-chat-and-agent-capabilities.md).
Acceptance covers skill discovery/read, builder invocation/save confirmation,
saved agent/pool dispatch, permission propagation, cancellation/continuation,
real Chat tool follow-up completion, a stable manual Stop and the full `make verify`
gate. Update the local Windows app after verification for continued user testing.
Numerical/performance qualification and changed task budgets are excluded.

| Owner / host | Exact path | Purpose / status |
| --- | --- | --- |
| GChat / workstation | `/ai/gchat`, `b86b87168` | Main source; pre-change baseline; accepted update source `f39cee7ed` |
| Shared capabilities | `/ai/gchat-worktrees/shared-chat-capabilities`, `fix/shared-chat-capabilities` | Reviewed implementation candidate; released after main integration and evidence retention |
| Shared capabilities | Candidate `out/shared-capabilities-20261001/` | Retain focused/full verification and Windows-update evidence |
| Existing caches | `/ai/gchat/src-tauri/target` and native `%LOCALAPPDATA%/GChat/windows-build/source` | Reuse valid compiler/dependency caches; preserve accepted Windows release |
| Installed Windows | `%LOCALAPPDATA%/GChat`, `%APPDATA%/GChat/data` | Accepted app PID 38412 / host 28832 at startup verification; user history/models preserved |

Verification passed: final `make verify` includes 2,027 frontend tests
(6 skipped), 15 extension tests, coverage floors and supported Rust suites,
including 529 desktop tests (7 ignored). Backend Clippy passed with warnings
denied. Independent review findings were corrected and covered by focused
behavioral regressions. Native NSIS/MSI assembly from `f39cee7ed` and the
in-place Windows update both exited 0. The native mirror matches all 41 changed
production files and both deleted approval-path files. Installed executables,
120-member bundled/active engine runtimes and unchanged 103 profiles passed
verification; four model files totaling 44,808,326,736 bytes, eight conversations,
seven runs and saved definitions are preserved. The visible desktop and host's
local HTTPS identity endpoint passed startup verification.

Evidence is retained in main `out/shared-capabilities-20261001/`; accepted
installers and checksums are in `out/windows/`. The temporary candidate/native
task directories are released at handoff; accepted compiler caches remain.
The user now confirms sidebar Stop works. The subsequent delegated run exposed
the SDK prompt-validation regression tracked above. Agent Builder discovery and
other interactive checks remain distinct from scripted/IPC verification. Numerical quality,
throughput qualification, task-budget changes and overall Coordinator status
reporting are excluded; Server 2 remains uninstalled.

## Earlier October 1 recovery acceptance

Investigate and fix the October 1 installed Windows incident: a builder-created
agent reaches its step limit, later chat reports full context on a small request,
and model output arrives while the client remains Working. Acceptance requires
an incomplete terminal run, released request state, accurate capacity errors,
and a subsequent ordinary chat that finishes without deleting history or
restarting the server. Preserve user data. The running model was preserved
during diagnosis; the authorized Windows update is installed and reopened for
the user to test. This is request
lifecycle verification, not model quality or performance qualification.

## Earlier recovery evidence

The user deleted conversations during recovery; automatic history deletion is
not reported. The preserved run `825d15f2-c4d0-49d2-adc1-60cab312adaa` is a
Coordinator named Test Coordinator Skill Builder, using three workers on Muse
Glimmer NVFP4 with NVFP4 DFlash. All stages exhausted their steps; the saved run
is incomplete with `finishReason=max_steps`, 69 total steps. The installed
server's October 1 startup reports 131072 context, automatic 5.88-GiB KV arena,
and maximum request context 130560. Later ordinary requests logged completion
with 28–30K prompt tokens. Server completion alone does not prove HTTP stream
closure or frontend completion.

The repeat `e3d1162c-ac23-4454-a9f1-f57fc74094e6` ended incomplete after 61 steps.
Three stages returned replies and two reached their step limits. A fresh ordinary
chat completed normally. A later continuation reproduced Working without the
context or format warnings. Thread `4b5f6686-4e98-49aa-8e2a-42dd04df83d0`
completed two searches and a crawl. Engine requests 234–237 ended normally;
the final request used 39,459 prompt tokens and generated 437 tokens before
`stop_token`. GChat saved assistant `3YSili1M1prYPs7Q` as ready with
`finishReason=stop` at 08:20:11. The engine subsequently reported zero running
or waiting requests. The user's final answer remained accompanied by Working.
The sanitized engine excerpt is restricted to the incident date and running
process; request numbers repeat between sessions and are not unique log keys.

The route keeps a separate busy flag, while its Chat instance and terminal
callbacks survive route remounts. Clearing an old callback's route-local flag
does not clear the remounted view's flag. Another possible ordering problem is
the terminal callback inspecting previous tool calls before batch cleanup; the
live trace does not distinguish these frontend mechanisms. The fix
removes the independent flag and derives Working from SDK request status plus
session-owned tool batches. Batch identities prevent late cancellation cleanup
from settling a later turn, and controllers belong to the same session as the
cached callback. Focused tests cover completion, cancellation, delayed/rejected
output admission and cross-session isolation. A real SDK Chat follows a tool
call with a final text response, reaches ready and stays idle when the cached
session is reused. Fourteen focused tests, TypeScript and source ESLint passed.
Full verification and independent review passed. This change delivers the
reviewed source fixes; retained evidence lives under `out/agent-recovery-20261001/`.
The authorized [Windows installer update](../installer-refresh/README.md) is installed
and reopened. Runtime integrity, source identity and preserved user data passed.
Next: the user replays the continued conversation in the updated app.
No engine failure or leaked request has been shown.
The earlier context warning's exact diagnostic is unavailable and has not
reproduced; do not claim its cause has been established.

## Confirmed throughput defect and fix

Rust serializes `stage_finished.inference` as camelCase. The frontend expected
snake_case and replaced all four valid live counters with undefined values at
stage completion. The repeated run's native history has valid counters, while
its chat summary contains empty inference objects. This directly explains blank
finished/incomplete stage rates and a blank aggregate in the live panel.

The fix uses the existing `AgentInferenceMetrics` IPC shape and preserves
it in the reducer. Intentional snake_case thread-message metadata is unchanged.
A regression covers measured-to-finished transition, model-instance aggregation
and numeric message metadata. Focused tests (8), TypeScript and source ESLint
passed. Full verification also passed. Live rates use generated tokens divided
by engine decode milliseconds; weighted totals sum tokens and milliseconds.
Pending non-streaming completions cannot provide partial timing measurements.

## Folder permissions and continued run

The user launched directly from Chat. The persisted approval mode for thread
`5c25b202-1ace-4daa-817e-7338f6e25310` is skip; its saved input selects the
Coordinator without the Agent Builder authoring skill. The reported prompt is
Allow folder access. That gate is independent of ordinary tool auto-approval.
The continued run `eeaff6d8-0e7f-46d3-bb0c-a9695d7c9f8b` finished with a reply
after 45 steps. Critic and Practitioner still exhausted their 12-round budgets;
the run was marked finished because synthesis returned a reply. In the earlier
repeat, Practitioner's apparent reply was the no-progress loop breaker's
fallback. Original stages exhausted 8 planning / 12 per worker / 25 synthesis
rounds. Transcripts show repeated file operations, missing `plan` paths and
access denials consuming those rounds. These are deliberate terminal budget or
loop exits, not demonstrated engine crashes. Overall status follows synthesis
and can obscure incomplete workers; correcting that reporting is still open.
Step budgets and saved definitions are unchanged. The ordinary-chat Working
state later reproduced as described above; the context warning did not.

Its transcript records unnecessary folder requests when synthesis reads its own
workers' `result.txt` files, plus reads of the nonexistent `plan/result.txt`.
The actual planning stage is `coordinate`; two handoff references use `plan`.
The run root is intended as trusted read access, but it lacked the canonical
Windows prefix used by the tool's resolved path. The fix canonicalizes
the existing root once and references `coordinate/result.txt` in both handoffs.
A scripted Coordinator regression reads planning and worker results while
external folder approvals are denied. The regression passed on Linux and native
Windows. Reading unrelated folders remains a distinct permission decision.

Source review also found a separate transfer defect: creating a Chat skill
thread copies its skill and workspace but drops its approval mode because the
copy is conditional on Agent workspace view. The fix preserves the
chosen execution approval mode without changing the selected sidebar view.

## Verification environment correction

The first full check passed 2,029 frontend tests, then stopped because the
candidate lacked the extension's existing `node_modules` path. It now reuses
that installed dependency tree. Rust verification exposed stale Linux test
resource names after the installer layout change: missing `bin/bun`, `bin/uv`
and `ginfer/linux`. The Linux `stub-resources` target now matches the actual
bundle paths, creates inert placeholders only when absent, and preserves real
resources. This corrects the shared cause rather than retaining manual setup
as a prerequisite. Final `make verify` passed: 2,038 frontend tests (6 skipped),
15 extension tests, critical coverage floors, and 524 desktop Rust tests
(7 ignored), plus supported plugin, host, hardware and utility suites. The
native Windows Coordinator regression and backend Clippy also passed. The native
Windows source-only harness omitted the generated Windows icon and three
compile-time proxy fixtures. It now includes the required fixtures and reuses
the existing installer build's icon before compilation. Future native source
captures must include these inputs before building. That source-only regression
did not replace release binaries.

## Owned inventory

| Owner / host | Path or process | Purpose / retention |
| --- | --- | --- |
| GChat / Ron-9950X3D2 | `/ai/gchat` | Main integrates these reviewed fixes; source baseline before this change was `8135380a2` |
| Agent recovery | `/ai/gchat-worktrees/agent-recovery`, `fix/agent-recovery` | Retired after integration; no retained build |
| Agent recovery | `/ai/gchat/out/agent-recovery-20261001/` | Retain two sanitized incidents and final Linux/native Windows verification logs |
| Agent recovery / Windows | `%LOCALAPPDATA%/GChat/agent-recovery-20261001/` | Native regression passed; temporary source/harness released after review |
| GChat / Windows | `%LOCALAPPDATA%/GChat/windows-build/source/src-tauri/target` | Regression debug cache retired after evidence retained; accepted release build preserved |
| Installed Windows | `%APPDATA%/GChat/data/logs`, `ginfer/host/host.log`, `agent-runs.json` | Existing read-only incident evidence; preserve original files |
| Installed Windows | Original GChat PID 22580, host 42428, engine 41536 | Incident provenance; updated app/host live inventory in installer record |

The accepted Linux/Windows installers remain under `out/linux` and `out/windows`.
The October 1 Windows installers now include these fixes and the sidebar model-stop
fix, and the local app is updated. Models and user data are preserved. Server 2
remains uninstalled. Existing contracts are in [Agent architecture](../../src-tauri/src/core/agent/ARCHITECTURE.md),
[chat lifecycle ownership](../decisions/2026-10-01-own-chat-tool-lifecycle-per-session.md),
[context admission](../decisions/2026-09-24-count-and-compact-ginfer-chat-requests.md),
and [open acceptance](../open-work.md).
