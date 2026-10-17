# GInfer host UI

## Disable OpenCode workspaces — C7

`GUI-CODE-DISABLE-WORKSPACE-STOP-20261017` fixes the integration switch's
use of the legacy `code` terminal ID while workspace sessions use `code:<path>`.
Turning OpenCode off must request stop for every app-owned Code session, including
legacy and workspace slots, while leaving Hermes unchanged. The switch stays on
until the native stop succeeds, disables repeated clicks during the request, and
shows a retryable error if stopping fails. No live user terminals are test inputs.

Acceptance: focused native lifecycle and rendered pending/success/failure tests,
then one full `make verify`; push the isolated branch for coordinator merge.
Installed GUI workflow belongs to Gchat 3's parent acceptance. Windows collision
qualification remains pending Gchat 2's separate installed-app handoff.

| Owner / host | Path | Status / retention |
| --- | --- | --- |
| C7 / local | `/ai/gchat-worktrees/c7-code-disable-workspace-stop-20261017`, branch `fix/c7-code-disable-workspace-stop-20261017` | Source candidate from `691fdcc10`; backend and frontend implementation in parallel |
| C7 / S1 | `/media/ron/SSD_RAID/ai/tmp-c7-code-disable-workspace-stop-20261017/` | Private source/dependency/native cache; retire after evidence extraction |
| C7 / evidence | `/ai/gchat/out/code-disable-workspace-stop-20261017/` | Focused and full verification pending |

The implementation serializes native Code launch/stop, reaps successful stops,
and retains failed stop handles for retry. A shared transient disabling state
blocks delayed UI readiness and restart work. Next: focused and full CPU-only
verification on S1 CPUs 80–87 in pinned image `ad7f9bf020d7`. No Engine or GPU/model runs.

## Proxy control labels — GUI-PROXY-SETTINGS-ACCESSIBILITY

Current main already supplies novice proxy instructions and accessible control
names. This follow-up keeps credential labels visible after typing, associates
each field and switch with its existing instructions, and connects the named
Show/Hide password button to the password field. Existing configuration values
and setters remain unchanged; locales and network behavior are outside this fix.

Acceptance is met on candidate `409322292`: four focused rendered cases,
lint, frontend types and coverage checks, 2,658 frontend tests (six skipped),
119 extension tests and 1,073 Rust tests (27 ignored). All required `make verify`
components completed on S1 CPUs 72–79 in the pinned `ad7f9bf020d7` container.
The first attempt stopped at a fake-GPU fixture because the runner set
`CUDA_VISIBLE_DEVICES` empty. Leaving CUDA mask/order unset made that case pass;
the remaining Rust suites then passed without source changes or repeating
successful checks. CPU-only verification must preserve the fake GPU inventory.
Next: coordinator review and merge; installed workflow qualification is separate.

| Owner / host | Path | Status / retention |
| --- | --- | --- |
| Codex 6 / local | `/ai/gchat-worktrees/c6-proxy-settings-accessibility-20261017`, branch `fix/c6-proxy-settings-accessibility-20261017` | Candidate from `eaf131aed`; route and dedicated tests only |
| Codex 6 / evidence | `/ai/gchat/out/c6-proxy-settings-accessibility-20261017/` | Passing result JSON, initial runner failure and concise summary retained |
| Codex 6 / S1 | `/media/ron/SSD_RAID/ai/tmp-c6-proxy-settings-accessibility-20261017/` | Private gate source/dependencies/build retired after passing results; 19,857,235,968 allocated bytes reclaimed, no GPU |

## Data-folder move guidance — GUI-DATA-LOCATION-GUIDANCE

The confirmation dialog explains which files are copied, that external model
files stay in place, and that the original folder is retained. It asks for an
empty destination with room for a second copy, explains the restart, and gives
next steps for a busy service or a failed Host restart. The pending state names
the copy and asks the user to keep GChat open.

Scope: dialog presentation and its existing General settings tests. Native move,
rollback, error toast and relaunch behavior remain owned by the existing caller
and native service. No live user-data move or backend change is authorized here.
Acceptance: focused rendered move/pending/refusal/completion cases and full
`make verify`; then push the isolated branch for coordinator merge.

| Owner / host | Path | Status / retention |
| --- | --- | --- |
| Codex 6 / local | `/ai/gchat-worktrees/c6-gui-data-location-guidance-20261017`, branch `fix/c6-gui-data-location-guidance-20261017` | Candidate from `fb15341b1`; focused and full verification pass |
| Codex 6 / evidence | `/ai/gchat/out/c6-gui-data-location-guidance-20261017/` | Result JSON and concise verification summary retained |
| Codex 6 / S1 | `/media/ron/SSD_RAID/ai/tmp-c6-gui-data-location-guidance-20261017/` | Merged-source gate passed on CPU 72–79; private source/dependency/build copies retired, no GPU |

Verification passed on S1 in the pinned `gchat-s1-verify` container: all 21
focused settings cases and full `make verify` (2,579 frontend tests, 119 extension
tests, critical coverage floors and all supported Rust suites). Setup refreshed
local-core archive references only in the disposable test copy; candidate
dependency files are unchanged. No live data move was performed.

Current: `origin/main` (`51842219e`, including the settings guidance) is merged
without rebasing, retaining both guidance sections. Gchat 2 released the stale
Gbot LAN-label test expectation for correction in `ba19013a5`. Combined-source
`make verify` passed on that commit: 2,619 frontend tests, 119 extension tests
and 1,073 Rust tests, with six frontend and 27 Rust skips/ignored cases. The
21 General settings cases pass. The initial fixture failure and corrected result
are retained beside the original evidence. Next: coordinator merge of the
isolated branch; installed workflow qualification remains separate.

## Integration switch guidance — C7

`GUI-INTEGRATION-TOGGLE-GUIDANCE` explains Gbot, OpenCode and Hermes beside
their persisted switches in Settings and Integrations. Each has a visible
**Enable** label and an accessible description. Gbot off hides the interface and
disables sign-in startup while work continues. OpenCode off now stops all Code workspaces before hiding Code, as specified
in the current disable-workspaces section above. Hermes off
stops its terminal while retaining saved settings. Enabling the terminal tools
can install them; enabling Gbot still opens its setup. **Hermes settings** remains
available. Existing actions, defaults and saved choices are unchanged.

Acceptance is met: five focused rendered tests and full `make verify` pass.
The full gate includes lint, frontend types, 2,584 frontend + 119 extension tests,
coverage checks and all supported Rust suites. Existing saved choices, enabling
navigation and terminal actions are protected. The original guidance shipped separately; the current disable-workspaces
fix above replaces its temporary Stop-first guidance.
No Engine, installer, model or Windows acceptance run belongs to this GUI change.
The Windows host-port collision leaf waits for Gchat 2's installed-app handoff.

Owned source: `/ai/gchat-worktrees/c7-integration-toggle-guidance-20261017`,
branch `fix/c7-integration-toggle-guidance-20261017`, base `fb15341b1`, tested
implementation `eafaedd7c`. Results and concise suite outcomes:
`/ai/gchat/out/integration-toggle-guidance-20261017/{result.json,summary.md}`.
Verification ran on S1 CPUs 80–87 with the pinned Rust 1.98 image `ad7f9bf020d7`.
Private compiler/dependency copies are retired; the authorized donor is unchanged.
No live job or retained remote build. Next action: coordinator review and merge.

## Profile presentation — OI-077

Ron approved model then card grouping, one recommended measured profile per card,
remaining profiles behind **Show all**, and **Tested / Estimated / Untested**
labels on October 11 at 22:15Z. GChat and Server Manager use the same presentation
rule. Only full-context-tested evidence earns a recommendation; startup/smoke
capacity remains Estimated, and calculation-only profiles remain Untested.
The recorded Engine revision and detailed qualification limits stay visible.
Existing automatic/saved selections stay selected even when outside the compact
recommendation; expanding or collapsing the list never changes launch settings.

The original presentation landed in main as `a665f666e`. The approved follow-up
uses one shared option label: evidence, concurrency, context and mode, each once.
Model and GPU remain in their own selectors; Engine evidence remains below the
profile selector. Manager radios use fixed 16-pixel controls and one-line labels.

Acceptance: focused rendered filtering, compact/expanded evidence, exact labels
and unchanged launch payload cases; affected lint and frontend types; one
WebKitGTK screenshot checking radio dimensions and single-line labels. No model
run, Engine/catalog changes, Windows build, installed update or publication.
Follow-up verification passes: 14 GChat picker cases, five Manager cases,
frontend types and affected lint. Exact option labels and Engine evidence updates
are covered alongside unchanged filtering and launch payloads. The
[follow-up preview](/ai/gchat/out/oi077-profile-presentation-20261011/follow-up/profile-list.png)
shows 16×16-pixel radio controls and 22-pixel single-line labels in WebKitGTK.
Only its fixture's incorrect C1 assertion required a harness correction; passing
source checks were not repeated. Next unresolved action: coordinator review and
merge; no installed update.

The [accepted original preview](/ai/gchat/out/oi077-profile-presentation-20261011/profile-list.png)
and focused receipts remain retained. Follow-up evidence goes in the same results
folder's `follow-up/` directory. Preview data is a development fixture, not model
qualification.

| Owner / host | Exact path | Purpose / status |
| --- | --- | --- |
| GChat / local | `/ai/gchat-worktrees/oi077-profile-presentation`, branch `fix/oi077-profile-presentation` | Source candidate from current `origin/main`; no live job |
| GChat / local | `/ai/gchat-worktrees/oi074-frontend-packages/node_modules` | Accepted dependency cache reused; no dependency changes |
| GChat / local | `/ai/gchat/out/oi077-profile-presentation-20261011/` | Passing focused results and one preview retained; no live job or build |

## Offline status — accepted October 1, 2026

Replace the paired host's raw snapshot connection error and red alert with the
existing muted header status, labeled **GInfer offline**. Retain saved model/GPU
inventory and disabled offline mutation controls. Connected launch/inventory
errors remain actionable; transport/discovery/pairing behavior is unchanged.
The owning repository is `/ai/gchat`; network/storage authorities are
[host setup](../lan-host-setup.md) and [model management](../model-management.md).

Acceptance: the host card shows the muted status without the raw TCP message,
still offers cached inventory and blocks loading while offline; focused rendered
verification and full `make verify` pass. Commit/push and refresh the local Windows
app using its accepted engine/profile set. No engine changes or new error taxonomy.

| Owner / host | Exact path / revision | Purpose / status |
| --- | --- | --- |
| GChat | `/ai/gchat`; reviewed source `d3199048d`, baseline `c4c170061` | Integrate the accepted candidate; final status in the handoff receipt |
| Offline host status | `/ai/gchat-worktrees/offline-host-status`, `fix/offline-host-status` | Reviewed candidate; release after integration and evidence retention |
| Offline host status | `/ai/gchat/out/offline-host-status-20261001/` | Retain verification, installer/update and cleanup evidence |
| Windows / RON-9950X3D2 | `%LOCALAPPDATA%/GChat/gchat.exe`, source `d3199048d` | Installed, verified and open |
| Windows build / RON-9950X3D2 | `%LOCALAPPDATA%/GChat/windows-build/offline-host-status-20261001` | Completed receipts retained; task directory removed |
| Accepted caches | `/ai/gchat/src-tauri/target`, native `%LOCALAPPDATA%/GChat/windows-build/source` | Reuse compiler/dependency caches |

The host-level alert is removed; the existing muted status now says GInfer offline.
The rendered offline-inventory regression passes, retaining cached selection and
blocked loading. Full `make verify` passed: 2,031 frontend tests (6 skipped), 15 extension tests,
critical coverage floors and supported Rust suites, including 529 desktop tests
(7 ignored). The 12 focused host-page tests pass. Coordinator review confirms
the existing offline gates and cached inventory are unchanged.

Recovery verified RON-9950X3D2 and RTX 5090 UUID
`GPU-92a61cb1-6b5e-cc7b-b669-72b2662d9d6e`. NSIS/MSI assembly and the authorized
update exited 0. The installed desktop matches the build except Tauri's three-byte
NSIS tag; CLI and host match their payloads. Both 120-file runtimes remain on engine
`74780ea1415ac8d3bb440d58442ac4f81a5dfde3`; all 103 profiles are unchanged. Four
model files, eight conversations, nine saved runs and agent definitions are preserved.
Visible desktop PID 40660 / host PID 37580 and local HTTPS identity pass startup checks.
The first startup check found a closed desktop; its log records a normal window-close
and exit request. Reopening once and checking the visible window resolved acceptance.

Retain both Windows installers and adjacent checksums in `out/windows/`.
The native task is removed; accepted compiler/dependency caches remain. Candidate
retirement and merge/push status are recorded in `out/offline-host-status-20261001/handoff.json`.
Next interactive check: the paired offline host card in the updated Windows app.
