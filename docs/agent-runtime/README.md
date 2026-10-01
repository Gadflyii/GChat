# Agent failure and chat recovery

## Current outcome and acceptance

Investigate and fix the October 1 installed Windows incident: a builder-created
agent reaches its step limit, later chat reports full context on a small request,
and model output arrives while the client remains Working. Acceptance requires
an incomplete terminal run, released request state, accurate capacity errors,
and a subsequent ordinary chat that finishes without deleting history or
restarting the server. Preserve user data and the running model. This is request
lifecycle verification, not model quality or performance qualification.

## Evidence and live question

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
live trace does not distinguish these frontend mechanisms. The candidate
removes the independent flag and derives Working from SDK request status plus
session-owned tool batches. Batch identities prevent late cancellation cleanup
from settling a later turn, and controllers belong to the same session as the
cached callback. Focused tests cover completion, cancellation, delayed/rejected
output admission and cross-session isolation. A real SDK Chat follows a tool
call with a final text response, reaches ready and stays idle when the cached
session is reused. Fourteen focused tests, TypeScript and source ESLint passed.
Full verification and independent review passed. This change delivers the
reviewed source fixes; retained evidence lives under `out/agent-recovery-20261001/`.
Next: rebuild the installers and replay the continued conversation in the
installed Windows app to establish the user-visible fix. That update must be
scheduled around the user's running model.
No engine failure or leaked request has been shown.
The earlier context warning's exact diagnostic is unavailable and has not
reproduced; do not claim its cause has been established.

## Confirmed throughput defect and candidate

Rust serializes `stage_finished.inference` as camelCase. The frontend expected
snake_case and replaced all four valid live counters with undefined values at
stage completion. The repeated run's native history has valid counters, while
its chat summary contains empty inference objects. This directly explains blank
finished/incomplete stage rates and a blank aggregate in the live panel.

The candidate uses the existing `AgentInferenceMetrics` IPC shape and preserves
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
after 45 steps. The ordinary-chat Working state later reproduced as described
above; the context warning did not.

Its transcript records unnecessary folder requests when synthesis reads its own
workers' `result.txt` files, plus reads of the nonexistent `plan/result.txt`.
The actual planning stage is `coordinate`; two handoff references use `plan`.
The run root is intended as trusted read access, but it lacked the canonical
Windows prefix used by the tool's resolved path. The candidate canonicalizes
the existing root once and references `coordinate/result.txt` in both handoffs.
A scripted Coordinator regression reads planning and worker results while
external folder approvals are denied. The regression passed on Linux and native
Windows. Reading unrelated folders remains a distinct permission decision.

Source review also found a separate transfer defect: creating a Chat skill
thread copies its skill and workspace but drops its approval mode because the
copy is conditional on Agent workspace view. The candidate preserves the
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
captures must include these inputs before building. No release binaries are
rebuilt or replaced.

## Owned inventory

| Owner / host | Path or process | Purpose / retention |
| --- | --- | --- |
| GChat / Ron-9950X3D2 | `/ai/gchat` | Main integrates these reviewed fixes; source baseline before this change was `8135380a2` |
| Agent recovery | `/ai/gchat-worktrees/agent-recovery`, `fix/agent-recovery` | Temporary candidate; retirement after integration, no retained build |
| Agent recovery | `/ai/gchat/out/agent-recovery-20261001/` | Retain two sanitized incidents and final Linux/native Windows verification logs |
| Agent recovery / Windows | `%LOCALAPPDATA%/GChat/agent-recovery-20261001/` | Native regression passed; temporary source/harness released after review |
| GChat / Windows | `%LOCALAPPDATA%/GChat/windows-build/source/src-tauri/target` | Existing debug cache reused by regression; preserve accepted release build |
| Installed Windows | `%APPDATA%/GChat/data/logs`, `ginfer/host/host.log`, `agent-runs.json` | Existing read-only incident evidence; preserve original files |
| Installed Windows | GChat PID 22580, host 42428, engine 41536 | User's live reproduction; do not restart or unload |

The accepted Linux/Windows installers remain under `out/linux` and `out/windows`.
Server 2 remains uninstalled. No release artifact or model is replaced by this
investigation. Existing contracts are in [Agent architecture](../../src-tauri/src/core/agent/ARCHITECTURE.md),
[chat lifecycle ownership](../decisions/2026-10-01-own-chat-tool-lifecycle-per-session.md),
[context admission](../decisions/2026-09-24-count-and-compact-ginfer-chat-requests.md),
and [open acceptance](../open-work.md).
