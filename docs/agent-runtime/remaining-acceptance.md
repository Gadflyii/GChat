# Remaining installed acceptance

Repository: `/ai/gchat`; subject: `docs/agent-runtime/`. The GInfer
`docs/maintainer/open-work.md` is the sole issue-status authority. This record
owns acceptance scope, preserved evidence and actual prerequisites.

## Current ordered acceptance — October 10

Installer source candidate `fix/gchat-current-user-nsis-7d9`, owned at
`/ai/gchat-worktrees/current-user-nsis-7d9`, retains accepted Rust/ConPTY inputs
and adds a pinned custom NSIS template with validated current-user NSIS
precedence. Actual installation remains unchanged. At 10:13:26 UTC the typed
installer refused WiX migration before stopping apps or launching an installer.
The [10:19:45 NSIS owner proof](/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/nsis-owner-proof-341.stdout)
confirms matching HKCU64 product/uninstall records and the actual GChat
uninstaller. The [MSI proof](/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/msi-precedence-registry-341.stdout)
also identifies a genuine HKLM registration at the same directory; it is not an
unrelated installation. The [decision](../decisions/2026-10-10-prefer-current-user-nsis-owner.md)
requires retaining normal MSI migration when the NSIS owner is not validated.

Next installer action: independent source review, then admitted package-only
regeneration from the accepted binaries and generated-template verification.
Installed acceptance must demonstrate current-user NSIS update without running
the old uninstaller or MSI migration, unchanged models/profiles/credentials and
histories, the authorized AUTO profile and functional installed Code Stop.
No build, test, staging or installation runs during the 10:20–11:00 quiet period.
The coexisting MSI registration is preserved; subsequent MSI repair/uninstall
can still modify the shared installation. No registry deletion or reconciliation
is part of this change. Retain this source tree and the existing OI-068 evidence;
no new build or model copies were allocated.

Candidate `fix/gchat-remaining-acceptance-bd4` at
`/ai/gchat-worktrees/remaining-acceptance-bd4` starts from published
`bd4dba841`. Installed Windows runtime remains GChat `0f06ba433`, Manager
`43c8d71cf`, Engine `2ef56a52`. Host fixes OI-111–114 and OI-120–122 are
source-accepted, with composed Rust checks completed at 01:50:05 UTC; they
have not been installed. The [integration authority](../code-hygiene/README.md)
owns their source verification and accepted Linux packages (`54c931c68`
compiled, `02d369e8a` assembled).

OI-072's ordinary-token capture completed without reproducing the historical
118 MiB loss; attribution remains unresolved in its
[single current authority](/ai/kernel-agent/run_workdir/local/oi072-runtime-53516bb5/ginfer/docs/oi072-runtime/README.md).
OI-076's two saved incident files contain neither the original warning nor its
failed request. OI-110 is parked pending Ron's public-feed and existing-key
signing/publication decision; no signing or publication is authorized.
OI-073 is separately parked for Ron to name a disposable completed Standard
result and website test window; no public publish, retry or deletion is allowed.
The ordered remaining checks are OI-068, OI-069, OI-071 and OI-075.
The registered second peer timed out on the bounded reachability check and the
local fleet is unconfigured. Physical pool checks need designated available
paired hosts/clients; Linux tray/vault checks need an actual provider-equipped
desktop. Those inputs are pending. OI-075 uses the existing 12-message,
107,089-byte long-content thread; actual UI measurements await a quiet interval.

OI-068 now has actual Windows prerequisites: OpenCode **1.18.35** resolves
through native npm shims and its underlying executable; installed GChat reports
ready/installed/configured with `viaWsl=false`. Hermes is present with unchanged
custom Muse configuration and advertised 65,536-token context. Actual Code
navigation resumes stock session `ses_ee1fb639bffetRmwKyDR4L0ZOH`, shows its Code
sidebar icon and reports the GChat bridge connected. No model request was sent;
this does not qualify shared tool execution, compaction or continuation.

Stopping that terminal returns `Could not stop Code terminal: The operation
completed successfully. (os error 0)`, then the same generation reports
Exited/code 1. Cached `portable-pty` 0.9.0's Windows cloned killer reverses the
Win32 `TerminateProcess` success test. GCHAT-PTY-STOP owns this demonstrated
failure and its product-side exact-handle correction. Candidate `37aa7beed` is independently source-accepted. Its focused native
check failed before any test at 05:20:41 UTC: Tauri requires a Windows `.ico`,
which the fresh test staging omitted. PNG-only bundle configuration falls back
to `icons/icon.ico`; the earlier documented prerequisite was missed during
preparation. Reuse the accepted generated ICO in the owned test extraction
and verify its bytes before the next admitted compile. No test pass is claimed. Four real ConPTY tests
cover successful stop/waiter publication, already-exited handles, clone lifetime,
live access-denied failure through actual Stop and retained-startup-child cleanup.
Windows Stop requests termination before consuming its live session resources;
Unix semantics and the dependency version are unchanged. Do not suppress the error or edit dependency caches.

Graceful GChat-only recovery completed at 04:52:04 UTC. Ordinary GChat PID
30972 is visible; original Host 23052 and Manager 15224 retain their creation
identities. Engine/API counts are zero, port 9271 is closed, settings/autostart
are preserved and all observed debug-app descendants have exited. Receipts:
`/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/`
(`native-command-prerequisites.json`, `code-resolved-state.json`, `stop-code.json`,
`after-stop-state.json`, `normal-app-restoration.json`). These are prerequisite
and recovery receipts, not full OI-068 acceptance.

Reuse accepted ordinary Chat workbook/discovery/manual and automatic compaction/
continuation, original-run reporting and stock persistence evidence below.
Preserve user histories, definitions, settings, profiles, grants, existing agent
budgets, caller identity and actual loaded capacity. A model-backed check needs
a compatible actually Ready instance and both canonical GPU/build guards for its
whole lifetime. No UAC, provider/dependency installation, Server 2 use, reduced
profile controls or widened folder permissions. Final Stop keeps the explicitly
authorized AUTO profile; restore normal apps and prove Engine absence before
guard release.

Accepted `7d9a8f689` production and package checks passed in booking 337; the
booking-341 invocation refused MSI migration before launch. The next installer
action and preservation criteria are specified above. Native all-target check
and strict Clippy pass on unchanged Rust source `9a4caa1c3`; do not repeat those
gates or the four passing CCC ConPTY tests for this template-only change.

Installer review found an obsolete pre-uninstall macro that stops helpers by
shared executable names and uses a PowerShell policy bypass. No live uninstall
or unrelated-process loss was observed. Source `7d9a8f689` removes that macro;
the optional post-uninstall data block is byte-identical. Independent review
accepts the cached NSIS template's conditional macro insertion and unchanged
Rust/ConPTY inputs. GCHAT-UNINSTALL-PROCESS-SCOPE is on the master list.

Use the supported NSIS `/S /UPDATE` path to skip the installed old NSIS
uninstaller. Verify the freshly generated script's `currentUser` and
`RequestExecutionLevel user` behavior, validate exact current NSIS owner
precedence before the WiX scan, and
require no running current-user `gchat.exe` before launch to avoid the template's
name-based fallback. No `/R`, elevation or policy bypass. Close the verified
clients gracefully and stop only the exact idle Host handle after successful
scan/persistence flush, stopped instances and no active downloads. Verify
installed payloads and full original-thread byte preservation before acceptance.
The prepared packet under the existing OI-068 evidence folder is preparation,
not proof of a generated package or installed update.

Ron authorized retaining the existing AUTO Muse profile after preservation
verification. Model-backed replay still needs fresh actual Ready capacity and
both guards; final Stop keeps AUTO. The earlier AUTO-to-fixed reload restoration
template is withdrawn because it would attempt the known failing fixed startup.
Do not write private Host state or use that failure as a cleanup step. Installed
Code Stop and model-free OI-075 can proceed independently of model admission.
Frozen `37aa7beed` compiled successfully; the actual four-case run completed
at 06:32:29 UTC with three passes and one failure: `cmd.exe /D /C "exit 7"`
did not signal exit within five seconds. The real Stop/waiter, denied Stop
with retained retry ownership, and startup-child cleanup tests passed. Do not
increase that timeout, suppress the failure or infer its cause from the three
passes. Installed Stop replay and model-backed OI-068 remain pending.

Independent source review accepts a test-only correction of the already-exited
fixture. The installed portable-pty implementation enables cursor inheritance;
the fixture must drain ConPTY output and reply to cursor-position requests,
as required by [Microsoft's contract](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole).
The corrected fixture records actual query/reply evidence, retains all four
real ConPTY cases and the original five-second natural-exit/exit-7 checks,
then closes and joins its consumer before checking the retained killer.
No product code, timeout, dependency or profile changed in this correction.
Pipe clones do not retain the PseudoCon owner; closure/EOF lifetime was
checked against the exact cached implementation. Actual CCC execution records
the cursor query, one reply and natural exit code 7; all four real ConPTY
tests pass at 07:46:54 UTC. Frozen source `ccc9ab250` is committed and pushed. The independently reviewed
prepared packet uses the existing exact `37aa7beed` archive/extraction plus
an immutable two-file delta (109,407 bytes) to that source. Root applies it
only after actual 07:30 admission and both canonical guards; all before/after
bytes and the applied receipt must match. Fresh CCC compile and four-case
PASS precede Check/Clippy and production; the prior failed test cannot satisfy
a gate. No native staging or new compilation occurred during preparation.

The shared helper's new `Result` branch and earlier killer drop compile on
Unix. Its Unix branch returns the same cloned `ProcessSignaller`, which owns
only an optional PID and has no drop action; the new error path is unreachable
there. Current Unix all-target check and strict Clippy cover that compilation
boundary. Reuse the retained 553-case Unix behavior suite and unchanged Host98,
adapter6, hardware12, utility29 and Manager/frontend gates; do not call those
fresh CCC compilation results. Native CCC four-case PASS and current Windows
all-target check/strict Clippy remain mandatory. This composition avoids
repeating unaffected suites without replacing actual native verification.

Actual booking 331 admission at 07:30 holds canonical build/GPU guards with
keeper PID 2215772, start ticks 6398839. Ordinary native Ron has Engine0/API0
and 95 GB free RAM; original app identities are unchanged. The exact CCC delta
was applied at 07:31:34. Native Cargo finished 0 after 3m27s, but the runner
failed its lifecycle gate: an identity-proven owned MSVC `VCTIP.EXE` child
remained after the ten-second natural drain. Final Job0, pinned body exit and
controller terminal1 are proven; all three owned PIDs are absent. Preserve
this failed receipt rather than promoting it. The existing runner correction is independently accepted (`48602e1479` /
`b129932d99`) and staged byte-for-byte, with consumed scripts preserved. It
validates command/artifact completion separately, then allows bounded
teardown only of freshly pinned, verified MSVC telemetry helpers. Unknown members,
actual test failures and deadline/RAM errors remain failures. No product source,
profile, timeout, global telemetry setting or installed app changed. The fresh
compile passes at 07:46:18 and four actual tests pass at 07:46:54, with normal
controller exit and Job0. No telemetry helper teardown was needed by these
cached successful runs. Current CCC Unix check and strict Clippy also pass.
Receipts: `compile-vctip-root-terminal-331.json`,
`test-vctip-root-terminal-331.json` and `ccc-unix-check-clippy-result-331.json`
in the existing OI-068 packet; initial failed receipts remain retained.

Strict Windows Clippy then exposes two platform-specific blockers. CCC
all-target check passes, but `Owner::Desktop(LocalHost)` is 288 bytes versus
56 for Service. Source `5988620a1` boxes desktop ownership and preserves its
Serde fields/tag/defaults; independent review, three registry tests, the
existing first-import/grant test, current Unix all-target check and strict
Clippy pass. Native 598 check passes and clears that warning, then rejects
four unnecessary argument-array borrows in Windows network helpers. Source
`a7a268455` removes only those four borrows; command arguments and Linux
compiled code are unchanged. The next native pass clears those errors and
exposes eight Windows-only desktop helper warnings. Source `9a4caa1c3`
corrects their redundant borrows/returns, first-match iterator and borrowed
path parameters without changing arguments, platform control flow or data.
Independent review accepts both corrections. Current 9a native all-target
check and strict Clippy pass at 08:07:08 UTC, with normal controller exit0,
Job0 and pinned body exit. Reuse CCC four-test evidence only for unchanged
terminal/Cargo/build inputs and 598 Unix checks for unchanged Linux compiled
code; do not label either a fresh 9a execution. Packages and installed replay
remain pending. The master list owns the corresponding native lint defects.

Current331 ends at 08:08:44.295 UTC: fresh native inspection proves all 14
owned controller/body identities absent, Engine0 and API0 before canonical
build/GPU guard release. Booking331 is cancelled; installed apps/settings
remain unchanged. Actual receipts: `9a-checkclippy-root-terminal-331.json`,
`final-native-absence-331.json` and `release-verified-331.json`. Production
uses booking337, 09:15–10:00 UTC, and reuses valid source gates rather than
repeating tests. Original331 source-application provenance remains separate
from new337 admission and guard ownership.

The bounded owned-disk review found no verified disposable candidate; zero
bytes deleted. Retain current source/cache/evidence and list shared, unmerged
or unclear paths in `hygiene-not-deleted-20261010.txt` in the same packet.
Filesystem traversal stopped at 08:07:35 UTC; no activity continues into
another owner's exclusive window.

CPU-only booking 333 ended at 06:34:28.858 UTC before its 06:35 boundary.
All three native Jobs were empty, pinned bodies exited, all six owned controller/
body PIDs were absent and Engine count was zero before canonical build-guard
release. User apps/settings were unchanged. The earlier no-run command
completed Cargo 0 after 3 minutes 41 seconds, but its runner rejected an
immediate remaining Job entry `[13996]`; that member's state is unproven.
The reviewed retry records bounded natural drain and still requires actual
Job 0 before promotion. Its cached no-run passed with the same executable
(26,900,480 bytes, SHA `f462fc3e883c5ca7f108e97f3fac7c54edf048ee6d0fc87dfcb6974a1ba29a39`).
The initial UNC invocation was rejected before launch; exact NTFS staging
corrected it without execution-policy changes. Preserve failed and accepted
receipts separately in `pty-stop-37aa7beed-early333-{compile,drain-compile,drain-test}`
(native) and `release-verified-333.json` (WSL). No package/update occurred.

Prior native attempts remain historical evidence: booking 325 omitted the
required ICO and booking 329 timed out during compilation, both with zero
executed tests. Their owned Jobs emptied and apps/settings remained unchanged.
329's guard release was 1.4 seconds late and was reported. The preventive
change gives compilation a separate finite budget and reserves 60 seconds
for native cleanup plus another 60 seconds for root absence proof.
All three earlier bookings are cancelled; no owned process or guard remains.

Ron moved the local window to 07:30–08:10 UTC. Reservations 327/328 are
cancelled; replacement 331 reserves the same later interval with both canonical
guards for compilation/checks/package work followed by acceptance. No compile
may run locally during the 06:45–07:30 kernel gates. Reuse the existing
extraction, accepted ICO and native cache; do not change the release profile or
replace real tests with a smaller crate. The continuation gives the no-run
compile its own finite budget, followed only after actual compile/controller
completion by the four cached tests within five minutes. Reserve 60
seconds for native cleanup plus a separate 60 seconds for root absence proof
before the booked END. The latest native phase deadline is 08:08 UTC, native
cleanup 08:09 and root proof/release 08:10.
This corrects the insufficient whole-compile deadline; compilation is not a
passing test. Release unused reservation time at actual END and recheck inbox,
booking and actual ownership before execution.

Owned inventory for this continuation: the candidate tree is
`/ai/gchat-worktrees/remaining-acceptance-bd4`; frozen package source is
`7d9a8f689`, with accepted Rust checks at `9a4caa1c3`.
Retain the existing native extraction and shared Windows target cache at
`%LOCALAPPDATA%/GChat/remaining-acceptance-20261010/source` and
`%LOCALAPPDATA%/GChat/windows-build/source/src-tauri/target` for the next
check/build; no duplicate source archive or model copy was allocated.
Prepared scripts, delta, verifiers and exact command inventory are indexed
in `/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/native-ccc9ab250-preparation.json`.
All build/package/installed acceptance fields remain pending. Consumed
37aa/333 artifacts are retained evidence, not current passing gates.

The production refresh must rebuild both Manager and Host: Manager statically
uses the changed Host client/fleet code and its own source has changed since the
installed `43c8d71cf`. Reusing that executable would leave accepted fixes
uninstalled. Reuse unchanged accepted frontend/assets and the exact selected
Engine closure; replace all inert test resources with verified production
payloads before packaging. Verify current source, both package formats, Manager
closure and preserved installed data before claiming an update.

After the required CPU checks and production refresh, perform remaining
acceptance sequentially inside the admitted reservation. Compilation/checks and actual model use cannot overlap. The
40-minute total build/acceptance fit is unmeasured; finish the required checks
and preserve valid partial results instead of shrinking scope to fit. Missing physical providers
or inputs remain explicit prerequisites; partial source checks never substitute
for installed acceptance.

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

Actual installed Chat acceptance reads the native workbook from
`C:\Users\Ron\OneDrive\Desktop\GChat acceptance 20261009\Quarterly budget.xlsx`
after approval of precisely its fixture folder. It exposes worksheet Budget,
Revenue 42,000 and Expenses 12,000; a later reply retains both values. Shared tool
discovery identifies agent/Studio controls and the enabled Agent Builder without
creating or running an agent. Automatic and manual Chat compaction complete,
and continued Chat reaches `stop`/ready rather than Working. Earlier acceptance
used 25,988 → 5,419 input tokens; the accepted `7d9eb55f9` continuation used
26,285 → 2,159. Current `0f06ba433` continuation saves `QXr1fqK7RSTetk3Y` as
ready/stop with output 30,000 after compaction from 26,366 to 1,705 tokens;
the UI is idle after the 4.614-second turn.
Evidence: `/ai/gchat/out/remediation-native-correction-20261009/actual-chat-acceptance.json`
and `/ai/gchat/out/oi106-final-update-20261009/installed-lifecycle-acceptance.json`.
The initial actual short request now prepares 1,514 tokens; the earlier OI-091
40,666-token overflow is historical. Workbook acceptance covers native local
extraction, not an installed XLSX skill or the missing original Desktop error.

The installed original run `eeaff6d8-0e7f-46d3-bb0c-a9695d7c9f8b` displays
**INCOMPLETE · STEP LIMIT REACHED**, original 45 steps, final output and throughput
metrics. Its raw history remains intact; no original long run was rerun. Evidence:
`/ai/gchat/out/remediation-native-correction-20261009/ui-original-history-and-server-menu.json`.

Source/stock-session evidence in the table does not close actual Code document
access and continuation, running-worker compaction/checkpoint/continuation or
configured connector execution. Those checks still require their real selected
sessions and inputs. Preserve existing definitions, folder decisions, grants,
budgets and transcript authority. A denied folder stays denied; discovery alone
never grants access. Use the existing `/compact` boundary and retain loaded
capacity, context counts, checkpoint state, completion/Working state and metrics.

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

OI-071 reuses the current Linux packages compiled at `54c931c68` and assembled
at `02d369e8a`; the package and DEB/AppImage X11 receipts are under
`/ai/gchat/out/oi070-linux-refresh/`. The actual dark window, Scan and
close/reopen retained the same empty Host. Historical `2a6e21ff2` window/no-tray
evidence does not supersede those packages. The current WSLg desktop has neither
an X11 tray owner nor StatusNotifierWatcher/Secret Service bus providers.
The missing inputs are a designated native Linux desktop, its real tray watcher
and Secret Service; no provider installation or activation is authorized here.
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
no owned debug listener. The authorized later app-only debug restart and
measurement must preserve existing history and use browser frame/long-task
observations alongside these same native process counters. No numerical performance floor or arbitrary conversation cap is set.
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
| Remaining acceptance `/ai/gchat-worktrees/remaining-acceptance`, branch `dev/gchat-remaining-acceptance-104d4ec6` | Owned tree retired after remote/tip/live-use checks; branch and concise evidence retained. |
| Coordinator `/ai/gchat-worktrees/remediation-integration`, branch `dev/gchat-remediation-104d4ec6` | Current composed source; active job/build inventory in the integration authority. |
| `/ai/gchat/out/remaining-acceptance-20261009/` | Retain bounded idle receipt/command and the accepted Office fixture; no live job or build. |
| Existing `/ai/gchat/out/unified-sessions-20261008/`, `agent-recovery-20261001/`, `ginfer-manager/`, `oi056-current-engine/`, `remediation-native-correction-20261009/`, `remediation-final-20261009/` | Reused retained evidence; no duplicated suite or model artifacts. |

Two file-launch attempts ran no measurement: a guessed native path did not
exist, and UNC script-file execution was rejected by PowerShell authorization.
The completed sample used the actual `wslpath` root and a single encoded command
without changing execution policy. Future checks use actual path translation,
durable JSON output and retained process completion status.

This documentation-only change uses link/path review and `git diff --check`.
Accepted source suites and installed receipts are reused without reruns. Actual
installed Chat acceptance is identified above; preparing inputs establishes no
additional capability or publication result.
