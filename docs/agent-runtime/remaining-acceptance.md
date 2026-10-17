# Remaining installed acceptance

Repository: `/ai/gchat`; subject: `docs/agent-runtime/`. The GInfer
`docs/maintainer/open-work.md` is the sole issue-status authority. This record
owns acceptance scope, preserved evidence and actual prerequisites.

Completed **GCHAT-GENERAL-WORKER-TEST-GBOT-BOOTSTRAP**: the existing mock app and
reopened app manage explicitly stopped Gbot state; an empty connector catalog no
longer launches a real service. The dispatch/cancel/policy/reopen fixture passes
(0.17 s), and strict library Clippy passes. The helper is test-only; production
behavior and dependencies are unchanged. Evidence: `out/worker-fixture-gbot-20261014/result.json`.
Next: consume C2's actual native-v2 benchmark output; while unavailable, attribute
`GCHAT-LINUX-NATIVE-IDLE-CPU` before selecting an owner fix.

## OI-068 native near-full-input task — October 15

One ordinary Linux native Standard Agent run reached a correct Reply with
241364 measured whole-input tokens, configured context 262144, a 20480-token
reserve and zero compactions. The task placed three codes among filler text;
the exact answer was `North=CEDAR-74291; Central=MICA-58604; South=OTTER-19387`.
The native UI showed finished at 19:15:03Z. Engine request 1 completed at
19:13:47.182Z with 241364 prompt tokens, 183 generated tokens, no cache hit and
207.33 seconds wall time. One earlier count-only calibration correctly blocked
567284 input tokens with zero model steps and zero generated tokens.

Desktop source `00068f2a8`, merged Host `16a338aff` and the complete 171-payload
Engine `5af502f1` runtime served `qwen3.8-27b/nvfp4-dflash2-nvfp4` on S1 GPU0,
an NVIDIA RTX PRO 6000 Blackwell Workstation Edition. The package SHA is
`4689bdc908d989170106b07e91d81e0898bfe5c5e2cca98ae1d7350276d715a6`.
The ordinary Save & Run
path created fresh run/session `c0d7ac9b-56f0-49b1-ac07-51719bdec0cb`, stored as
record `9dbd486b-d831-443d-9604-bc87c9fee081`. Settings
were C1, speculation disabled, NVFP4 KV, structured outputs and graphs on,
headroom 1073741824 bytes, no host KV cache, high reasoning, Auto output and
the default 25 steps. Saved KV remained Automatic; the effective arena was
79365530624 bytes.

Ordinary Refresh runs and selection of the saved FINISHED record reopened the
exact final output and persisted one-step metrics at 19:15:42.800Z. Independent
inspection confirms the finished/reply record and the same semantic session's
single user/reply turn. Live Context count, reserve and zero compactions are
retained separately from the saved Result overview.

Normal UI Stop at 19:16:12.075Z reached stopped at 19:16:21.200Z; the engine was
absent and GPU compute empty. The guard exited without kills. The owned remote
Host then exited, its listeners closed, the GPU lock was free and resource
bookings were returned. Normal desktop Close and retirement of the owned private
Host, Gbot and helpers completed; the private FUSE mount disappeared. The private
app also overwrote shared `~/.local/bin` CLI files despite XDG isolation. After
exit, its private redirect was moved aside reversibly; verified CLI binaries
were retained, with no original backup available. This qualifies the measured
near-full-input functional gate; literal 262144 input tokens and fresh-install
acceptance are not claimed.
OI-068 remains PARTIAL. Evidence:
`/ai/gchat/out/native-full-context-20261015/{full-input-recipe.json,full-input-result.json,full-input-summary.md,stop-observation.json,guard.json,release.json}`.

## OI-068 native near-full-context startup — October 15

The local RTX 5090 native Standard Agent gate selected Qwen3.8-27b NVFP4-DFlash2,
C1, context 262144, NVFP4 KV, headroom 524288000 bytes, graphs on and host cache 0.
Normal Host defaults enable structured outputs, which clears historical catalog
qualification. This functional gate does not requalify that historical profile.

The first two attempts used accepted Host `44e80b7c1`, which supplied the catalog's
historical explicit KV arena of 9141485568 bytes. Packaged Engine `9f8fb8ff9`
loaded weights but failed before Ready: its post-startup maximum was 7383592960
bytes. The one unchanged current-Engine `5af502f1` retest also failed before Ready,
with maximum 7307931648 bytes and unchanged headroom 524288000 bytes. Normal Host
Stop completed with zero active requests for both attempts. No native input count
or inference ran. The current reservation default did not resolve the failure;
its underlying capacity difference remains unestablished. The complete current
runtime had 171 verified payloads and ten changed libraries, so this was not a
binary-only causal test.

Host source `93143951d` obtains a fresh selected-runtime quote before every serving
start. One authorized retest through the existing isolated desktop began at
17:52:24Z with the same execution settings and no KV override. Startup passed:
Ready was observed at 17:58:39.677Z with an effective 7004386304-byte KV arena and
saved `kv_arena_bytes: null` (Automatic). C1, context 262144, structured outputs
on and headroom 524288000 bytes were retained. Normal Host Stop at 17:58:52.799Z
was observed stopped at 17:59:32.324Z, with zero active requests and the engine
child absent. No input count or inference ran.

The source change is merged on `16a338aff`. One merged-Host retest (SHA
`d4863c80b3013ceac78cd4bc3680d97b4dffaa52c02409acb47966506f34d71c`)
used the same Engine `5af502f1`, model, GPU and settings through the standalone
native Host/Manager API. One profile launch at 18:32:10.207Z returned an effective
7080309760-byte KV arena; saved `kv_arena_bytes` and `qualified_profile_id` remain
null. The observed quote has no explicit arena, and quote/serving arguments match
apart from the effective allocation and transport/lifecycle flags. Ready was
observed at 18:39:16.227Z. The engine startup log reports maximum request context
261632 tokens despite configured context 262144. Normal Stop with the matching
session ID and `force: false` returned stopped with zero active requests. Both
owned engine processes, Host and guard are absent, no guard kill occurred and
both resource locks are released. This qualifies API startup and normal Stop,
not a desktop UI or installer walkthrough. Raw quote stdout was not retained.

Ada separately passes the installed UI startup with production Host `93143951d`
(SHA `66caef75…`), Engine `5af502f1` and the frozen installed DEB with isolated
Host/runtime replacements. One ordinary catalog reselection started C1/context
149069 with structured outputs off, headroom 314572800 bytes and a fresh
4695700992-byte KV arena; saved desired KV is null. UI Ready and normal UI Stop
pass, and owned engine, Host, guard and resource release are recorded. The engine
startup maximum request context is 132096 tokens, below configured 149069.
There were no inference requests; this does not qualify full-context capacity
or the final fresh-install package gate.

Production implementation remains `93143951d`. Fixture-only correction `611fc26e9`
passes all 11 plugin tests. After a further quote-unaware client sleeper is
corrected in `7d92bad30`, the full Host suite passes: 172 tests, 19 ignored,
including 144 library, 5 main, 11 client, 11 fleet and 1 pairing test. The stale
4-GiB first-run and inference-usage regressions both pass; the remaining Host
integration and doc targets complete. The quality guard passes across 312 files.

The composed Linux source gate passes, combining those corrected suites with
the passing unaffected `make verify` targets from `93143951d`: lint, typecheck,
2343 app tests (6 skipped), 114 extension tests, 41 Manager UI tests and critical
coverage floors. Unique Rust results total 869 passed and 27 ignored. This is a
composed gate with fixture-only follow-ups, not one final `make verify` invocation.
The exact 2996-file source check and per-target results are retained in
`/ai/gchat/out/gbot-linux-walkthrough-20261014/final-refresh-20261015/verification-7d92bad3.json`.

The private desktop and helpers are retired, local GPU/CPU resources are
released and disposable private payloads totaling 6.48 GB logical are removed.
Gchat 2 copied and hash-verified the Host binary locally and on Ada for its
separate retest; the original handoff copy is retired. Source donors, models and
shared caches are untouched.

These startup attempts alone do not qualify the predeclared native gate of
240000–241664 measured whole-input tokens, the correct three-code Reply and zero
compactions. The later [native task above](#oi-068-native-near-full-input-task--october-15)
passes that scope. OI-068 remains PARTIAL. Historical startup evidence:
`/ai/gchat/out/native-full-context-20261015/{result.json,summary.md}` and
`/ai/gchat/out/host-fresh-kv-quotes-20261015/{ready.json,stopped.json,cleanup.json,result.json,summary.md}`.
Merged retest receipts:
`/ai/gchat/out/host-fresh-kv-quotes-20261015/merged-16a338aff/{recipe.json,host-process.json,preflight.json,launch.json,ready.json,stop.json,stopped.json,guard.json,release.json,host.log}`.
Ada receipt (SHA-256
`8a709c152a3b2aa2e1b6bcab844ec50b9324b907de44bb7797b40883323a5980`):
`/ai/gchat/out/gbot-linux-walkthrough-20261014/current-source-20261015/host-fresh-quote-check.json`.

## OI-068 Linux Hermes home override — October 15

The shared Hermes resolver ignored a nonempty `HERMES_HOME` on Linux even though
the child inherited it. Configuration, reset, readiness, skin installation and
update paths could therefore disagree with the actual Hermes home. The fix
honors the process override before the Linux default `~/.hermes`, preserving
the absent/empty fallback and existing Windows registry precedence.

The existing Rust suite adds a child-process regression for an override path
containing spaces, an absent override and an empty override. It configures and
clears the selected home, checks the local provider contract and retained settings,
and requires the other home's configuration and environment files to remain
untouched. The fixture changes only its child environment. Native `cargo check`,
strict Clippy and `make verify` pass: 2,335 app tests, 114 extension tests and
853 Rust tests, with 6 app tests skipped and 25 Rust tests ignored. The shared
resolver establishes the readiness and skin path change; live Hermes acceptance
remains deferred.

Actual Hermes reply, tool use and continuation remain deferred pending the
installed runtime prerequisite. No Hermes provisioning or inference gate is
claimed, and OI-068 remains PARTIAL.

## OI-068 Studio worker exit persistence — October 15

Direct Studio turns were absent from the Chat delegation and Code task shutdown
maps. Their cancellation senders and terminal events also did not establish that
run-history and semantic-session writes had finished. The shared turn registry
now covers preflight through persistence and pending-request cleanup. Normal app
exit closes admission, cancels tracked turns and waits alongside Chat and Code
shutdown for up to 15 seconds before model teardown. Closed UI event delivery
during shutdown no longer turns cancellation into failed history.

The existing mock app, TestFleet and scripted engine fixture checks a direct
Studio turn that reads a real file and then waits for shell approval. It closes
the event sink and requires cancelled history, the same task/session and retained
file content on disk before shutdown returns. It also checks cleared pending
requests, no shell side effect, rejection of a late run and fresh-app history
reopening without replay. A missing-definition preflight regression checks that
an early error releases shutdown tracking without creating history.

Native check, strict Clippy and full `make verify` pass, including both new
regressions (2335 app, 114 extension and 852 Rust tests). Evidence:
`out/studio-exit-durability-20261015/{result.json,summary.md}`.

The native normal-exit gate also passes on source `105ee93cf`. An ordinary
Standard Agent read `observation.txt` (harbor-7314), then awaited shell approval.
Normal main-window Close at 16:23:47Z persisted cancelled record
`ba5ce923-e94a-4427-8b5b-9ea871ee97fb`, run/session
`8848fadf-9afd-4bc5-8b80-ef0c2205fe3b`. Same-data relaunch and ordinary Studio
Runs reopening at 16:24:09Z showed that record and two steps. Independent audits
confirm the original task/current goal, turn count 1, completed read, denied
shell, working state, transcript and tool artifacts. The command never ran;
Host logs show no inference replay after restart.

The private native candidate reused accepted DEB resources and Qwen3.8-27b
NVFP4-DFlash2 on S1 GPU1, C1/context 262144, speculation disabled, high reasoning,
Auto output and default 25 steps. This was a functional gate, not a fresh install.
Normal Host Stop reached stopped with zero requests and Forget removed the
pairing. Exact owned processes and disposable stages were retired; GPU1 and
local CPU bookings were returned early. Shared GPU0, model/profile donors and
the user's desktop were untouched. UI, durable artifacts and cleanup receipts
are consolidated in the result JSON above.

The separate October 17 desktop-death check below passes its bounded scope;
automatic continuation and broader crash recovery remain unqualified. The original
review-quality failure is now a known limitation; full 262144-token capacity,
Hermes and Windows remain open. OI-068 remains PARTIAL.

## OI-068 native desktop process-death and continuation — October 17

The retained Linux desktop from source `0c3b8f265` ran a real Standard Agent
with Qwen 27B INT on the local RTX 5090. The packet below records the artifact
SHA and full settings. After a completed `observation.txt` read and while a
shell action awaited approval, only the desktop received
SIGKILL at 05:05:31.976Z. Ordinary Runs reopening after relaunch showed the
original record as INCOMPLETE, with completion and steps not recorded. Its
working state, transcript and completed tool artifact remained hash-identical;
the marker was absent and the pending approval did not replay. The original
approval display omitted arguments, so its pending command was not independently
verified.

The Host survived, but the Engine later disappeared; an ordinary new INT Start
was required. Continue as new run then created a distinct record with fresh
folder and shell approvals. The approved step-4 `touch` succeeded. The model
requested another `touch` at step 6, which the human denied. The new run finished
with a Reply after eight steps and reopened as FINISHED; the original remained
INCOMPLETE.

This passes bounded native desktop-death history discovery and explicit new-run
continuation. It does not qualify automatic resume, exactly-once execution,
Host/Engine loss, power loss or Windows. OI-068 remains PARTIAL. Normal UI Stop
at 05:22:44.255Z and normal desktop/Host exit completed; owned resources were
returned at 05:23Z. Evidence:
`/ai/gchat/out/oi068-process-death-20261017/{result.json,summary.md}`.

## OI-068 native idle Host termination and continuation — October 17

The retained d31 AppImage with Engine `db265e6b2` ran Qwen 27B NVFP4 on the
local RTX 5090. The packet below records binary and model SHA256 values and full
settings. After a successful file read and at genuine shell approval, the idle
managed Host received SIGTERM at 08:05:54.345399Z. Ordinary Stop followed within
one second; at 08:05:59.576Z the UI showed CANCELLED with no pending approval or
marker. The original run `229ae658-a07f-4ae8-b63d-2d15e24f58f9` later reopened as
CANCELLED with two steps.

The managed Host was replaced automatically, followed by an explicit ordinary
Start of the same model profile. Continue as new run preserved the goal and
workspace and created distinct run `1742924f-e69f-49aa-986b-33018f96d358` and session
identities. Fresh Allow once at 08:08:07.287Z executed one `touch` with exit code
zero. The new run reopened as FINISHED with five steps, separately from the
cancelled original. All four original archive files remained hash- and
size-identical.

The new model reply incorrectly said the cancelled run created the marker,
claimed no new changes and called itself a resumed original run. The transcript
instead shows that this distinct new run created the marker after fresh approval.
The recovery pass rests on observed tools, artifacts and run identities; it is
not a factual-accuracy pass.

This qualifies idle Host SIGTERM, cancellation and explicit new-run recovery.
Abrupt crash, loss during in-flight inference, automatic resume, power loss and
Windows remain unqualified; OI-068 remains PARTIAL. Normal model Stop at
08:08:57.619Z, desktop close and idle Host Stop completed; owned resources were
returned at 08:09Z. Evidence:
`/ai/gchat/out/oi068-process-death-20261017/{host-loss-result.json,host-loss-summary.md}`;
result SHA256 `deee51b6ef02fa3629865694916ecaa7fc3d6cbd9e0820864d4a381fa1a2581c`.

## Native attachment chooser current tools — October 17

In an existing private conversation on the same desktop, the document reader
was disabled before the native chooser opened. Ordinary Tools controls enabled
it while the same chooser, XID `0x800e2d`, remained open. Native accessibility
input confirmed `short.pdf` (585 bytes); the result retained an Auto raw-path
attachment with no inline content, processing, error or ingestion prompt. This
exercises current tool availability after the asynchronous chooser returns and passes
`GCHAT-ATTACHMENT-PICKER-STALE-TOOL-SNAPSHOT-20261015`'s causal native check.

The preliminary New Chat attempt bypassed the existing-conversation processing
branch and is retained as unqualified. App controls and state capture were
Inspector-assisted; native chooser input used AT-SPI. No PDF Send, document
content extraction, Windows or fresh-install acceptance is claimed. Evidence:
`/ai/gchat/out/attachment-picker-current-tools-20261016/result.json` and the
`05-picker-thread-*` receipts in
`/ai/gchat/out/oi068-process-death-20261017/`.

## Worker review guidance — October 15

The retained default-worker review used `qwen3.8-27b/nvfp4-dflash2-nvfp4`,
normal 262144 context, high reasoning, Auto output and the default 25-step limit.
It finished in 11 decisions, inspected all eight requested files in order and
made one tool call per decision. All ten source reads remain verbatim in the
saved working state; ordinary Studio reopening preserved the exact answer.

Factual accuracy still fails: the answer claims a fitting input makes manual
Compact a no-op, but `src-tauri/src/core/agent/context.rs:196` bypasses checkpoint
attempts only without a manual request; lines 200–293 try candidates before the
fallback at line 295. Its first cut index is also wrong: lines 203–213 select
`boundaries[len-3]`, then `boundaries[len-2]`, when available. These errors do not
establish another product defect; model capability remains a possible cause.
The October 17 disposition closed `GCHAT-WORKER-REVIEW-INSTRUCTION-FOLLOWING`
as a known model limitation, recorded in the release notes. This run had no compaction
and adds no checkpoint, restart or post-compaction task acceptance.

Evidence: `/ai/gchat/out/worker-review-guidance-20261015/{result.json,summary.md}`.

## OI-068 factual multi-file task after checkpoint — October 15

**PASS for a correct eight-file maintainer reference after live-worker
compaction.** The Linux native worker used `qwen3.8-27b/nvfp4-dflash2-nvfp4`,
C1, normal 262144 context, speculation disabled, high reasoning, Auto output
and the unchanged default 25-step limit. This was a native functional gate,
not a fresh installer gate.

An ordinary UI Compact installed one checkpoint after step 5, reducing counted
input from 32584 to 17211 tokens and replacing nine older entries. The same
session `7ca4a260-5ed4-4ef9-9057-f64c0f37f17a` and context
`9595d540-f2cd-4bd6-aec0-fe2c2d4ee1c6` preserved the verbatim task and
20480-token reserve, then executed six more bounded source reads and Reply.
The run finished in 13 decisions with one tool call per decision; first
inspection followed all eight requested files in order. Independent source
review found every requested reference row correct. The exact terminal reply
survived ordinary Studio navigation and saved-run reopening.
After completion, closing the native window normally and relaunching with the
same data also preserved the exact terminal record; run history, working state
and transcript hashes were unchanged.
Normal Host Stop reached `stopped` with zero active requests. The native
inventory no longer showed the private remote pairing; owned processes were
retired, and S1 GPU/CPU plus local CPU bookings were released.

The original harder review is a known accuracy limitation, recorded in the
[release notes](../installer-refresh/README.md#known-issues). Broader active-worker
app-exit/restart recovery, full 262144-token capacity, Hermes and Windows remain
unqualified; OI-068 remains PARTIAL. Evidence:
`/ai/gchat/out/worker-post-compact-20261015/{result.json,summary.md}`.

## OI-068 Linux live-worker checkpoint continuity — October 15

**PASS for checkpoint installation and same-worker continuation; review task
FAILED.** The retained developer DEB uses desktop/CLI/Host `7e33222e8` and
Engine `38ff80e0c`; the relevant context/session/runner/Studio paths match
current main. Normal Qwen 262144 reached Ready using the existing exact
115 GiB, CPU 0–31 hardware profile; no build or calibration was repeated.

One ordinary Standard Agent used default 25 steps, high reasoning, no output
limit override and a read-only eight-file review task. The early UI Compact
request returned `nothing_to_compact`: its candidates were larger than the
short history. A later UI request installed one durable checkpoint before
step 11, reducing exact counted input from 12662 to 11567 and removing 19
older entries. Session `b467f358-81bc-47f1-b2b1-6381489226d8`, context
`5ca524c1-fea1-4572-af1c-4c15c2d8e11b`, task, workspace, recent exchanges and
20480-token reserve were preserved. Sixteen non-reply tool executions plus
Reply followed in the same worker. All 28 full tool records were present at
termination; transcript, checkpoint, working states and records are consolidated
in the retained result JSON.

The run ended after 22 decisions as `finished` / `reply`, but returned unsupported
tool markup and never completed the eight-file review. This is not accepted task
completion. Recorded string `limit: "2400"` returned the default 16000-byte excerpt;
string `offset` likewise takes the numeric default. The native read schema leaves
parameter types unspecified, while its handler accepts numeric JSON values only.
`GCHAT-WORKER-FILE-READ-STRING-RANGE` owns that reproduced read-range defect.

The exact terminal record reopened in Studio. Normal Host Stop at 10:44:53Z
passed with zero requests. Private pairing credential removal passed; exact owned
processes, private keyring/state and 7467851941 bytes of disposable copies are
retired, and local booking 715 is returned. The physical desktop keyring was not
used. Evidence: `/ai/gchat/out/worker-compaction-20261015/{result.json,summary.md}`.
The unchanged CLI hash is retained there. This replay's `make verify` was blocked
before checks by missing Yarn dependency state. The follow-up source
`2072528cf` documents fresh-worktree dependency/core/extension preparation and
refreshes the local core archive lock references; the full corrected-worktree
`make verify` now passes (2295 root, 114 extension and 846 Rust tests;
25 Rust tests ignored). See [current preparation evidence](README.md#worker-file-read-ranges--october-15). No Windows,
Hermes, app-exit/restart recovery, full 262144-token capacity, signing or publication
acceptance is claimed. OI-068 stays PARTIAL.

## Accepted General Agent dispatch from Chat — October 15

`GCHAT-CHAT-GENERAL-AGENT-DISPATCH` is closed for Linux dispatch, result
collection, targeted cancellation and saved-run reopening. Source `325998951`,
the normal-context correction `1eba42a27`, card restoration `177d574e6` and
idempotent Stop `22ae47c0b` are ancestors of reviewed main `1825d964e`.

The existing native `chat_general_workers_collect_cancel_and_reopen_with_parent_policy`
fixture creates two independent sessions, collects one result, cancels the other
and reopens its persisted record. It verifies inherited disabled tools, human
approval, pool placement and parent identity. Its October 14 stopped-Gbot
fixture correction passes 1/1 with strict library Clippy; the October 15
631-case Chat suite also passes (seven ignored). Retained frontend checks cover
dispatch and worker presentation.

The installed real-model retry at Qwen's normal 262144 configuration dispatched
two workers before waiting, collected both terminal results and returned Chat
to idle. Both records and results survived conversation reopening and client
reload: the math worker returned `323`; the document worker respected denied
folder access. That run did not reach cancellation. The separate October 15
production native replay on `22ae47c0b` cancelled a generating worker with one
Stop click, completed the parent without a failure toast and preserved the exact
Chat and cancelled record after reopening. The native fixture covers the combined
two-worker/cancel lifecycle; these installed runs qualify its model-backed
transitions separately.

Evidence is reused without a new build or model run:
`out/worker-fixture-gbot-20261014/result.json`,
`out/test-quality-20261015/{result.json,worker-cancel-result.json}`,
`out/gchat-open-items-20261013/oi068-chat-workers/result.json`,
`out/worker-card-restore-20261013/result.json` and
`/ai/gchat-worktrees/worker-replay-22ae/out/worker-acceptance-20261015/{result.json,summary.md}`.
Active-worker restart recovery, compaction/checkpoint resume, Windows and the
broader walkthrough remain outside this row's accepted scope under OI-068.
Ordinary Chat workers still stop with the app; Gbot service lifetime is separate.

## OI-068 targeted worker cancellation and continuation — October 14

The installed/extracted Linux developer AppImage passes the missing targeted
transitions. Desktop/CLI/Host source remains `7e33222e8`; the four-image Engine
closure is clean `38ff80e0c` (requested `415eaa2b5` plus the FFmpeg worker-cap
control). Its packaged SM120a CLI generated the current local5090 hardware
profile in 760.4 seconds. The Host reached Ready at 21:45:52 UTC with Qwen
`qwen3.8-27b/nvfp4-dflash2-nvfp4`, normal 262,144 context and unchanged saved
configuration. This supersedes the earlier pre-Ready bundle/profile blockers.

**Stop worker** cancelled run `6a0eb23b-9f4e-40cc-84f0-4ad45e0fdc52` while
its first model step was generating (21:48:28 UTC). Its parent Chat finished
at 21:48:32; the cancelled record, result and exact conversation survived
reopening. No completed worker step or partial article is claimed. The UI
snapshot also contains a false “could not be cancelled” toast; the distinct
`GCHAT-WORKER-CANCEL-FALSE-ERROR` row records this presentation defect.

Studio's **Continue as new run** created
`1b9975bd-8972-425a-9511-e368eb8ab3d2`, completed nine steps with finish reason
`reply` at 21:59:22 UTC and wrote 7,324 output bytes. Reopening at 22:02:26
preserved the exact finished record. Normal Host Stop then passed. This
accepts first-step cancellation and supported continuation as a separate run;
it does not establish checkpoint resume, broader active-worker compaction,
Hermes, Windows, performance or all-image physical acceptance. OI-068 stays PARTIAL.

Evidence: `/ai/gchat/out/gchat-open-items-20261013/oi068-chat-workers/live-cancel-20261014/`
contains `result.json`, `package-result.json`, `hardware-profile-result.json`,
`ui-cancel-current.json`, `ui-worker-reopen-current.json`,
`ui-continuation-reopen.json` and `ui-normal-stop-current.json`. Current unsigned
DEB/AppImage paths are in the [installer record](../installer-refresh/README.md).
Package integrity/manifests and the focused runtime-document staging fixture
pass. Resume-time `make verify` stops before checks at missing Yarn dependency
state (`make-verify-resume.log`); no install or repeated live gate ran.
No owned job, model, booking or lock remains. Disposable stages, isolated client
state and superseded installers are retired; current packages/profile/runtime
and acceptance receipts remain. Signing and publication were not performed.

## Current implementation and test plan — October 13

Completed item **GBOT-INSTALL-WALKTHROUGH**: opt-in Linux service startup at desktop
sign-in and automatic recovery of the same saved Ready VM. Candidate
`/ai/gchat-worktrees/gbot-linux-login-e04` (`feat/gbot-linux-login-e04`, base
`e04e7393e`); results go to `out/gbot-linux-login/result.json`. Acceptance is
focused startup/recovery/UI cases and one private installed Linux walkthrough,
using existing tools. Prior wizard, task and GUI-close passes are reused below.
No Windows build, cloud/user desktop input, new dependency, signing or publication.
Focused checks and the corrected native desktop build pass. The developer frontend
now uses `IS_TAURI=true`, which the first artifact omitted. Installed enablement and
desktop sign-in after OS reboot pass: the background service starts without GChat,
restores the same Ready VM/session and native-vault credentials, and retains
authenticated control. Receipt: `out/gbot-linux-login/sign-in-recovery.json`.
The private S1 guest and disk are retired; the corrected developer installer is
retained at `/ai/gbot-vms/linux-login-20261014/GChat-linux-login-e04.deb`, with
`out/gbot-linux-login/package-receipt.json`. No live job, model or reservation
remains. Next: reviewed merge. This gate does not qualify physical sleep recovery,
unattended startup before sign-in, Windows or M365.

Installed paired-Host brain/task acceptance **PASS**: select a Ready model, save
its actual served context, create `~/hello.txt` through the desktop editor,
verify exact `Hello from Gbot.` by independent SSH read, and reopen the saved result.
The native selector fix is merged in main `98bef9d07`; its focused fixture and
incremental desktop build pass. Evidence: `out/gchat-open-items-20261013/paired-brain-installed/result.json`.
Inventory: source `/ai/gchat-worktrees/gchat-focused-burndown-c36a`, branch
`fix/gbot-remove-refusal-e56`, tested desktop and cited evidence; no live guest, Host,
model or reservation. Shared base image and baseline package are retained.
Completed source fix `GBOT-REMOVE-SAVED-BRAIN`. Explicit removal clears an idle brain only
after physical guest cleanup; durable credential cleanup supports retry. Pending
tasks, schedules, operations, accounts and human control remain protected. Gate:
four focused service/setup/task/schedule cases and strict service Clippy pass,
no model or guest run.
Results: `out/gchat-open-items-20261013/remove-saved-brain/result.json`.
Completed source fix `GBOT-REMOVE-REFUSAL-STATE`: removal checks ownership and
live-work blockers before marking Removing or disconnecting. The existing runtime
lifecycle and Service locks hold ownership through cleanup; only the matching idle
session can be detached. Refusal preserves Ready, its live session, brain and
control/operation state. Six affected removal cases and strict service Clippy pass
in 16 seconds; no physical guest or model gate.
Results: `out/gchat-open-items-20261013/remove-refusal-state/result.json`.
Next unresolved action: reviewed merge, then the next open GChat/Gbot item.
Signing/publication, native Windows builds, personal desktop input and Engine
rebuild/calibration are excluded. The master list remains the status authority.

| Queue item | Current result and next unresolved action |
| --- | --- |
| Manager vault success style | Merged correction; success/failure/retry DOM case passed. Native presentation remains a release check. |
| Shared application icon | Merged canonical source; actual `3aff66d62` ICO generation and desktop compilation passed. Compare installed window/tray appearance at release. |
| Linux tray accessible name | Approved tooltip backend compiled and checked; own SNI/Hide passed. Native name/Open/Exit remain release checks; no more finder loops. |
| AppIndicator deprecation | Approved dependency decision retains the existing backend and warning; replacement API is GPL-3.0-only. Closed; no runtime change. |
| DRI3 startup warning | Diagnosed Mesa/Xwayland device-open failure. Retained rendering/input passed; no GChat correction demonstrated. |
| Browser baseline data | Updated the two existing metadata packages; unchanged Browserslist consumer passed both queries with no stale-data warnings. No frontend build or browser qualification claimed. |
| OI-072 catalog and Flash alias cutover | C3's cutover is complete (`147a22cd8`). Source complete: retired Flash aliases removed; 83 matcher and 19 catalog/discovery/load cases plus affected lint passed. Exact artifact paths and native context retained. Muse all-Q4 DFlash2 qualification remains a scheduled release gate. |
| Gbot readiness failure detail | Already fixed on main `13f88c042`; operation and safe reason survive restart. Existing focused receipt reused. |
| Gbot seed asset symlinks | Already fixed on main `a5490907d`; canonical archive bytes reach the guest. Existing focused and physical seed receipts reused. |

The compiled icon receipt is
`out/remaining-acceptance-20261009/oi068-windows-20261010/compiled-desktop-code-380-proof.json`.
Vault and tray source gates are `out/s2-acceptance-20261011/source-gates.json`;
these passes do not imply an unperformed native presentation check.

Completed Linux missing-provider/passphrase setup gate: the native app shows
its missing-keyring guidance, creates the chosen vault, preserves its tier while
locked, rejects an incorrect passphrase, and unlocks. Restart retains the selected
vault in its locked state; entering the correct passphrase unlocks it again.
Evidence: `out/secret-store-installed-20261013/result.json`. No product source
change or rebuild was needed. The private fixture is retired; no model ran.
That gate did not replay locked Secret Service behavior; the separate October 17
installed-package check below covers its bounded launch and Connect behavior.
Windows helper/lifetime checks remain at the release gate.

Completed GCHAT-MULTI-WORKER-CARD-RESTORE: source `177d574e6` restores
all saved workers once, merges live progress by run ID and preserves answers.
Twenty-five focused cases, frontend types/lint and the native embed pass.
One isolated Linux/WSLg reload restores two cards exactly once, one saved
answer, and zero Working/Stop controls for completed workers; generated history only.
Evidence: `out/worker-card-restore-20261013/result.json`; no model or Windows change.
Merged to main `585c95484`; executable/evidence retained, private fixture retired,
owned processes absent, bookings604/605 canceled.

Completed GCHAT-SECRET-STORE Linux tiers merged to main `ca45da2a0`.
Core 5, Chat 8, Manager 3 and Gbot 1 focused cases, check, strict Clippy,
frontend types/lint pass; lock adds nine edges, no package/version changes.
Evidence: `out/secret-store-20261013/result.json`; native missing-provider and
passphrase setup acceptance is recorded above. The separate installed-package
check below covers locked-provider launch, explicit Connect prompting and
stored-credential retrieval after restart. Release-only Windows helper/lifetime
checks remain pending.

## Installed Linux locked-keyring launch and explicit Connect — October 17

The retained Debian XFCE guest ran the installed d31 DEB with a private D-Bus
session and synthetic Secret Service, preserving the original keyring and bots.
Ordinary Pair wrote a credential and connected. After normal close, locking the
login collection and restarting `/usr/bin/gchat`, plain launch and navigation to
Hosts left the collection locked, without an app Secret Service call or prompt.

Ordinary saved Connect at 07:56:00.480Z then requested Unlock and Prompt. The
D-Bus sender mapped to the running `/usr/bin/gchat` process, and the desktop
showed Unlock Login Keyring. Two keyboard submissions of the retained synthetic
password were rejected; that attempt did not qualify GetSecret or reconnection.
Ordinary Cancel at 07:57:59.013702Z returned the explicit error: "Secure storage
is locked. Unlock the selected store before continuing." The app and private
services stopped normally, and the original guest was shut down and returned at
07:58Z. Evidence:
`/ai/gchat/out/keyring-prompt-at-launch-20261016/final-d31-retrieval-20261017/{result.json,summary.md}`.

A follow-up on the same installed d31 executable, SHA256
`51d77b8502e4785aa22b6bae14c0f86794e73b0b64686cfe686d6a1e4f9e2ce4`,
used a new isolated known-password login keyring. Ordinary Pair succeeded at
08:19:48.515Z; normal close and locked restart followed at 08:20:13Z. Plain launch
and Hosts navigation made no app Secret Service calls before Connect; the saved
card was visible and the collection still locked at 08:23:50.587Z.

Ordinary saved Connect at 08:23:58.275Z opened Unlock Login Keyring. Sender
`:1.64` mapped live to `/usr/bin/gchat` PID 1945. One ordinary password submission
unlocked the collection; GetSecret occurred at 08:24:13.979500Z and the saved Host
showed Connected at 08:24:23.065Z. Normal app close and owned private-service exit
completed at 08:24:45Z. Evidence:
`/ai/gchat/out/keyring-prompt-at-launch-20261016/final-d31-retrieval-known-password-20261017/result.json`.
The earlier rejected-password fixture remains recorded separately above.

This saved-Host check passes installed Linux locked launch, explicit saved-Connect
prompting, ordinary unlock and stored-credential reconnection after restart,
alongside the earlier Cancel result. It does not qualify a fresh install, Gbot
credential workflow or native Windows. This check used synthetic credentials and
a private remote Host, with no model or GPU workload.

### Gbot local service-token follow-up

The same installed d31 executable and isolated known-password keyring pass the
local Gbot service-token round trip. Ordinary Enable Gbot and Start created the
token; the first Start remained disconnected after a roughly 40-second unlock
delay, and a second Start connected. The desktop closed normally while the
service survived. After locking the collection and restarting the desktop at
08:37:54.808Z, plain launch and Gbot navigation through 08:38:18.875Z produced no
Secret Service calls or unlock prompt.

Ordinary Start waited for bundled-resource validation, then requested Unlock and
Prompt at 08:41:22Z. Sender `:1.35` mapped live to the restarted desktop PID1814;
ordinary password entry was followed by GetSecret at 08:41:23.407809Z. The UI
reconnected, with the same service UUID and endpoint and the original service
process still alive. Ordinary Quit Gbot service and normal desktop close left
both processes absent at 08:41:54.564547Z.

The separate service-process restart check also passes. After normal Quit of
service PID1645 and guest/private-keyring-daemon restart, new desktop PID1453's
locked launch and Gbot navigation stayed silent. One ordinary Start at 08:57:53Z
waited for bundled-resource validation, then prompted at 09:01:37Z. Sender
`:1.16` mapped live to new service PID1770. Ordinary unlock at 09:01:48Z was
followed by two GetSecret calls and no CreateItem; the same service UUID
reconnected by 09:01:55Z. Normal service Quit and desktop close completed at
09:02:16Z, and the guest was normally shut down and returned at 09:02Z. Evidence:
`/ai/gchat/out/keyring-prompt-at-launch-20261016/final-d31-gbot-service-restart-20261017/result.json`.

This qualifies local service-token creation, persistence and retrieval across
GUI and normal service-process restart, alongside silent locked launch and
navigation. Crash recovery, SSH/provider credentials, bot control/tasks, fresh
installation and native Windows remain unqualified. No model, GPU workload, bot
or task ran. Prior GUI-restart evidence:
`/ai/gchat/out/keyring-prompt-at-launch-20261016/final-d31-gbot-credential-20261017/result.json`.

Completed item at the recorded scope: OI-069 two-Host shared-pool gate PASS.
Two concurrent workers finished; a third queued at full capacity and was cancelled.
Results survived client restart; shared catalog and assignment survived coordinator restart.
Evidence: `out/s2-acceptance-20261011/local-worker/result.json`.
Simultaneous use from two independent workstations remains owed; the native clients ran
sequentially with independent folders on one desktop and shared its coordinator grant.
All disposable Hosts, clients, services, credentials/state and bookings are retired.
The credential-store implementation above follows; no GPU is needed.

## Accepted OI-069 independent-workstation capacity

The October 15 follow-up passes using native Linux GChat clients on
Ron-9950X3D2 and DESKTOP-DG588BU, each with a private passphrase vault and its
own coordinator grant. Both observe revision 4 of the same catalog, pool and
assignments. The served instance has concurrency 3; its Manager pool-member
worker limit is 1 across both clients.

Source `d1dc7e621` corrects per-client capacity accounting by admitting pooled
workers at the coordinator before tools or inference. One real TLS two-client
test covers concurrent admission, overlapping-pool limits, disconnect release
and revocation. It passes, as do affected Rust check, strict Clippy and the
desktop/Host build. The existing dispatch release/queue case passes. The other
preflight fixture lacks managed Gbot state; a temporary fixture setup attempt
timed out and was removed. Full `make verify` in this isolated tree stops at
missing Yarn installation state; no dependencies were installed.

Live acceptance at 04:52–04:56Z: the first client's worker finishes normally;
the second client's worker stays queued with zero Engine request, cancels
durably, and a fresh queued worker starts only after the first releases its
slot. The second worker returns `OI069 Ada independent client completed.`
Both clients save normal final replies and report zero usage. Native Gbot Quit,
window Close and normal Host Stop complete. The earlier two-Host concurrent
dispatch, durable reopen and coordinator restart evidence above is reused.
No Windows, signing, publication or Engine change is included.

Rebuilt desktop SHA-256:
`de48d58b5796839a0270061e033a8d079ca06c8d3827b4536e62f9be4db8597c`;
Host: `cb7f13c6d7b219a855bec96d3073c5b5dc71cb9ab2fe0aa4e713a74360a74b2c`.
The accepted four-architecture Engine runtime remains `38ff80e0c`.
Receipts: `out/oi069-independent-clients-20261015/{result.json,summary.md}`.

Completed item: the reproduced OI-068 custom-launch/output-budget conflict.
The old installed fresh Chat served 8,192 context, reserved 8,192 output and
rejected its 1,859-token prompt with a false one-token input budget.
Custom launches now select the registered model's native context (Qwen 262,144;
Muse 131,072), preserving explicit custom and saved values. Incompatible output
reservation gets an actionable settings error before tokenization or compaction;
user settings are not silently reduced.

Twenty-three focused launch/budget cases, affected lint, frontend types and one
incremental Linux desktop build pass. The isolated installed retry at Qwen's
262,144 context dispatched two General Agent workers before waiting, collected
both terminal results, returned Chat to idle and preserved both run records and
results across conversation reopen and client reload. The math worker returned
323; the document worker reported denied folder access and finished itself.
That earlier run did not reach targeted cancellation; the October 14 targeted
gate above accepts first-step cancellation and continuation as a new run.

Client reload exposed a separate display defect: only the last worker activity
card is restored, although both results remain saved. It is logged separately
as GCHAT-MULTI-WORKER-CARD-RESTORE; this item does not claim that display fix.
Evidence and exact source/runtime provenance:
`out/gchat-open-items-20261013/oi068-chat-workers/result.json`.
The model and Host stopped normally; canonical GPU/build guards were returned
and both bookings canceled. The disposable private desktop guest and its disk,
keys and staging files are retired. Inventory retains this unmerged source
candidate, the accepted stripped desktop executable and cited evidence; no live
job, model, guest or booking. Retired outputs freed 10.695 GiB on S1 and 1.050
GiB locally. No Engine build, calibration, Windows change or broader walkthrough.

Completed source item: paired-Host Gbot brain selection merged to main
`fe79233c3` from `9e9ef6272`. The independent service uses the shared native
Host registry/vault, pinned session-bound requests and revocable per-task
loopback connections. The selector binds a ready instance's model, actual
served context and exact session; restart requires explicit re-selection.
Eighteen focused selector, route, service, vault, scheduler and stale-session
cases pass, with frontend types/lint, native check and strict Clippy. Evidence:
`out/gchat-open-items-20261013/paired-brain/result.json`. The native check ended
02:38:29 UTC; its container/guard and booking 592 are retired. These source
checks do not qualify an installed paired-model task, which remains owed.
Inventory: one reused candidate tree and the accepted desktop executable;
no new build, package, copied model or profile is needed.

Completed source item: guided Gbot brain assignment, merged to main `0f752946a`
from `feat/gbot-guided-brain-e428`, based on reviewed main `e42805f2a`, in
`/ai/gchat-worktrees/gbot-browser-physical-2e735`. After computer setup the
next step must be visible: choose a persistent inference endpoint, enter the
model and its served context capacity, review, and save through the existing
service-owned assignment/vault transaction. Existing configured bots retain
an edit control. Failed saves retain inputs and remain visibly incomplete.
Acceptance is three focused frontend flows (new setup, retained vault key on
edit, save failure/retry), the owning route integration case, frontend types
and affected lint. This is UI configuration acceptance; it does not prove a
reachable model or a completed task. The paired-Host transport gap identified
by this completed item is addressed by the merged source item above.
No new dependency, native build, VM, GPU, inference probe or credential copy.
Implementation and acceptance are complete for this source change: three
component flows and eight route cases pass (11 total, 1.46 seconds), frontend
types pass, and affected production lint has zero errors. Two existing React
act warnings remain in the route fixture; ESLint skips test files by policy.
The first focused run exposed a duplicate React key between the new brain and
connector panels. The brain key now has its own prefix; the successful rerun
covers switching bots. No unchanged passing native checks were repeated.

Editing a saved assignment also exposed an owning payload bug: spreading the
saved record sent `credential_ref` to the strict save API. The route now sends
only supported input fields. Empty key input retains the saved vault key;
removal requires the explicit checkbox. Failed save errors stay beside the
form and retain its inputs. Evidence:
`out/gchat-open-items-20261013/brain-setup/result.json` and its focused logs.
Its guided-brain source is the current branch baseline. The merged paired-Host
item above owns its source evidence; installed real-model selection, task and
result-reopen acceptance now pass, as recorded in the current plan above.
Inventory at this item’s completion: one source tree, accepted installed desktop
artifact and cited evidence; no live job, model, VM or booking. CPU booking 591 is canceled
and its canonical build guard released.

Completed hardware item: main `e42805f2a` integrates `789d089db`.
Local Host bootstrap and post-install preparation use the existing cached
hardware inventory before ownership/spawn, reject a missing NVIDIA GPU with
an actionable message, and retain Host validation for unreadable NVIDIA
capability. The focused case, desktop/CLI checks and strict Clippy pass;
desktop/Clippy have no warnings, with two/four unchanged setup warnings in
test/CLI builds. Evidence: `out/gchat-open-items-20261013/hardware-gate/result.json`.
Its container and CPU booking are retired. The historical ENOENT log does not
identify the missing loader. The October 15 fresh Linux handoff below records
the supported-GPU follow-up.

Fresh Linux hardware preparation, October 15: the retained developer DEB
(`7e33222e8` desktop/CLI/Host, `38ff80e0c` Engine) was extracted into a new
private installation root and launched with empty private XDG managed data,
no Host locator and no profile. Native startup installed its bundled runtimes
and automatically attached a live local Host at 08:56:20 UTC. Preparation
returned `idle`, as required by the
[explicit GPU selection decision](../decisions/2026-10-11-own-hardware-profile-installation-in-host.md):
first install chooses no default GPU, including on a singleton host.

The packaged native `prepare-hardware` command then explicitly selected the
booked RTX 5090 UUID at 09:01:36 UTC. Its first `Ensure` started one Host-owned
job with the newly installed SM120a CLI, without a prior profile or forced
refresh. The Host completed at 09:13:42.134 UTC and published a schema-v2
profile in 725.317 seconds: exact 5090 UUID, CPUs 8–31, error null, available
true and no pending/stale groups. The profile SHA-256 is
`349bf23190fcb1860437aa368c56db4f0c450a412501f99908ccfa02e906bd60`.
All owned fixture processes stopped after completion; private payload/data
were retired, booking 706 canceled and the GPU guard released. Evidence:
`/ai/gchat/out/gchat-installed-gpu-handoff-20261015/{result.json,summary.md}`.
This gate uses the extracted DEB payload, rather than a system package-manager
installation. GPU selection through the desktop UI, model capacity and native
Windows release acceptance remain separate.

Completed item: installed Linux Gbot computer creation and same-setup resume.
Candidate `test/gbot-installed-creation-2eff` at source `6acaead46`, based on
reviewed main `2effbe4df`, fixes two installed blockers: the empty built-in
GInfer provider no longer skips Welcome, and the Gbot frontend consumes the
service's plain `live_sessions` identities instead of a nonexistent wrapper.
Nine onboarding cases and the existing Ready/session regression pass, together
with frontend types, affected lint and one incremental desktop build per source
change. The route fixture emits two React act warnings; they are retained in
`ready-session-contract/build/ready-tests.log`. Unchanged passing checks were
not repeated.

The unsigned developer DEB passed the installed gate at 01:08:07 UTC on
October 13 in one disposable Debian 13 desktop on S1. Welcome rendered; the
visible wizard created one local KVM bot and reached Computer ready. After
client and service restart, visible Resume reconnected the same workspace,
session, pinned host key and native-vault credential. The corrected Ready page
renders Connected. Authenticated state returned 200, unauthenticated state 401;
there was exactly one workspace. This establishes computer setup and resume,
not model/brain/task readiness. No model, GPU, person's desktop or host package
installation was involved.

Evidence: `out/gchat-open-items-20261013/installed-creation/desktop-guest/`
contains `installed-result.json`, `ready-before.json`, `setup-final.json`,
`state-ready-fixed.json`, `ui-after-install.png`, `ui-ready-final.png` and
`ui-connected-final.png`. The pre-fix crash and failed Host log are retained.
The disposable package refresh initially copied an executable with mode 0664;
packaging now sets and verifies archive mode 0755 before installation, without
another compilation. The corrected developer package/build receipts are under
`ready-session-contract/`; this was not a release package gate.

The nested bot was removed through the production setup API, then the private
service and client exited. Outer guest/domain/disks/keys/private daemons were
retired at 01:09:06 UTC, reclaiming 30.47 GB on S1; booking 1442 was canceled.
Two superseded local desktop binaries were retired, reclaiming another 2.25 GB.
Cleanup receipts are `desktop-guest/{nested-removal,cleanup}.json` and
`retired-local-builds.json`. Current inventory retains only the candidate
source tree, current tested desktop artifact and evidence; no live job or
reservation remains. The accepted baseline package was preserved.

This candidate is merged to main `bb4cde410`; its installed evidence is reused.
Remaining setup acceptance: Windows/Hyper-V, cloud/M365,
remote service selection, installer choice, sleep recovery and scheduled
dispatch after client exit. Gbot's explicit brain assignment must select a
persistent Host or other inference endpoint for client-exit continuity. Hardware preparation is a
separate finding: the retained historical Host log reports that NVIDIA GPU
inventory could not be executed (ENOENT) in the CPU-only guest; this does not
qualify a GPU installation or prove the exact missing executable.

Completed item: the two-question Linux Gbot wizard, source `f39961b6c` from
main `e7d761c2f` in `test/gbot-installed-wizard-e7d`. Five affected wizard/route
cases, frontend types/Vite, lint and the incremental desktop build pass. The
unsigned developer DEB `2.0.42+wizard20261012.f39961b6c` passed one installed gate
in Ron's approved disposable Debian 13 desktop guest: enable/setup entry,
separate service/computer questions and the local-KVM prerequisite hold. Ordinary
GChat window close preserved the same native-vault authenticated service PID and
identity. Explicit shutdown and guest/domain/disk/key/daemon retirement passed;
actual END 23:11:08 UTC, 9.93 GB freed and booking 1415 canceled.

The historical base Engine/Host/CLI were outside this GUI-only gate. No model,
GPU, Windows, nested VM, completed wizard creation/resume, sleep/restart or
release/performance qualification ran. First launch rendered after synchronous
asset installation; its debug timing is recorded as a separate startup finding.
The `fix/gchat-linux-resource-startup-ba46` candidate now runs that installer on
one blocking worker and retains its result for Host, model and Gbot admission.
Source `0e2160b54` passes three focused readiness cases, production check/strict
Clippy and the incremental desktop build. One fresh installed Debian 13 launch
rendered and responded to Settings while its worker installed the bundled
resources; successful installation settled at 23:46:30 UTC. All 668 runtime
payloads matched their manifest hashes and lengths, with packaged manifests,
runtime-set, Host and Gbot assets also verified; no staging paths remained.
Guest/domain/disk/keys/private daemons were retired at 23:49:00 UTC, booking
1433 canceled and 13.33 GB freed. Source and documentation merged as `8d268fc11`.
Automatic hardware preparation later failed with Host exit 1/no local owner
ready in the CPU-only guest. The subsequent installed-creation gate retains its Host inventory ENOENT log; `GCHAT-LINUX-HARDWARE-PREP-OWNER-UNAVAILABLE` tracks diagnosis.
Evidence is under
`out/gchat-open-items-20261012/resource-startup/`; this is functional startup
acceptance, with no Engine or performance qualification claim.
Evidence, screenshots, guest-only closure and cleanup:
`out/gchat-open-items-20261012/installed-wizard/desktop-guest/receipt.json`.
Earlier guest/disks are retired and their saved evidence remains valid.

Completed source item: OI-074 in `fix/gchat-chat-bundle-8d268`, based on
`8d268fc11`, at `/ai/gchat-worktrees/gbot-browser-physical-2e735`. English
remains an eager fallback in one shared leaf chunk; other languages remain
lazy. The production entry falls from 532,470 to 463,950 bytes; `locale-en` is
64,991 bytes and the largest JavaScript chunk is 499,377 bytes. The unchanged
500 kB advisory no longer fires. Four existing language-loading cases, types
and affected lint pass; the emitted manifest confirms eager English, no catalog
dependencies and lazy Japanese. Existing route and terminal transforms are
unchanged. No dependencies, warning-limit change or runtime performance claim.

The first build could not replace root-owned `web-app/dist` and emitted no new
bundles. The build-only retry used owned
`out/gchat-open-items-20261012/oi074/production/`; passing checks were reused.
Complete build logs, the baseline and summarized receipt remain under
`out/gchat-open-items-20261012/oi074/`. The output is retained for review;
no desktop build, model or GPU ran. Actual END was 00:11:21 UTC on October 13;
booking 584 is canceled and the build guard released. This candidate is merged
in main `2e2edfc86`; browser-data advice remains a separate row.

This reconciliation uses reviewed main `e42805f2a`, including background ownership and seed repair, plus `ec21a1874`
(guest delivery) and `e49219967` (native reports), the master rows and saved
receipts. A source fix, a focused fixture and an installed acceptance gate are
separate claims. Passing evidence is reused; no broad suite or repeat GPU run
is part of this plan. The master list remains the sole issue-status authority.

### Remaining implementation and acceptance

| Item | Current behavior / remaining work | Smallest useful gate |
| --- | --- | --- |
| General agent delegation from Chat | CLOSED for the original dispatch/collect/cancel/reopen scope. The native two-worker policy/lifecycle fixture and retained installed two-worker result/reopen and October 15 targeted Stop replays pass on source incorporated in main `1825d964e`. | [Accepted evidence and scope](#accepted-general-agent-dispatch-from-chat--october-15). Model-backed transitions were checked in separate runs; active-worker restart/compaction/checkpoint recovery and Windows remain under OI-068. |
| Gbot enable and guided setup | Baseline sidebar ignored enablement and Add bot was a manual SSH form. Main `8440b5f7a` adds opt-in and a guided existing-LAN connection with review; 39 focused cases pass. Settings enable now navigates to Gbot, where first setup opens; disable/startup leave it closed. Three focused cases, types and affected lint PASS. Installed DEB creation and same-setup resume pass on main `bb4cde410`; prerequisite holds remain actionable. The current brain handoff adds 11 focused frontend cases. | PASS October 15: current Linux native desktop shows the Gbot switch in Settings and Integrations under Native integrations. Enable opens first setup and the sidebar entry; disable synchronizes both controls, hides the entry and survives a full disabled-route reload. Existing installed and focused receipts are reused; no fresh installer gate. See [Gbot evidence](../gbot/README.md). |
| Automatic bot computer setup | Main `b1502528b` wires the KVM adapter to resumable product onboarding; accepted bundle/seed and diagnostic fixes provide pinned delivery and actionable failures. Corrected readiness keyboard arguments pass the owning adapter case, check and strict Clippy. One dedicated S1 guest reached Ready through the authenticated API after service restart/resume; input/save, independent readback and view-only media pass. Guest and private roots are retired. Source `30a8be28a` holds operations until persisted Ready and reopens the same saved setup; 2 service/13 UI cases, check/strict Clippy/types/lint pass. Native detached bootstrap/vault/restart pass separately. Installed wizard creation, Computer ready and same-setup resume pass on main `bb4cde410`. Hyper-V, cloud creation/live cost review, M365 and remote service selection remain unfinished. | Installed wizard presentation separately; Windows/M365 at the release window. No person's desktop. |
| Per-bot connectors and research | Main `8440b5f7a` links explicit existing accounts per bot, scopes native tools and persists provider receipts; none are inherited. Existing native/service and frontend evidence is supplemented by two full local mock OAuth lifecycles for Google/Microsoft, including callback, refresh, reduced consent, isolation and disconnect. | Source scope complete against local mocks. Live provider consent is Ron's release gate with existing approved registrations/accounts; research reuses shared tools. [Qualification](../workspace-connectors/README.md#local-mock-oauth-qualification--october-15). |
| Scheduled/background Gbot work | Main `b1502528b` owns once/interval scheduling with persisted occurrence IDs, explicit bot assignments, create/list/disable UI and conservative restart recovery. Main `500a5f2cb` includes separate service ownership `a2b0053a9`, which passes one process and eleven UI cases plus owning checks; native detached lifetime, vault and authenticated shutdown/restart now pass; installed DEB ordinary GUI close keeps the same native service alive. AppImage GUI-exit/resource/shutdown lifetime also passes; sleep/restart and live dispatch are unrun. | Focused injected-time due/disabled/missed-run/ambiguous-dispatch fixtures plus fake executor and UI controls pass; independent service acceptance remains separate. |
| Browser tools | Typed browser catalog/schema and one real isolated Chromium form pass: exact native window binding, navigation, typing and trusted input submission, independently verified over pinned-host system SSH. | Broader browser tasks and installed presentation remain separate; no model or performance claim. |

### Bugs, decisions and incomplete diagnostics

| Master item | What remains | Next evidence / dependency |
| --- | --- | --- |
| GBOT-SETUP-CREDENTIAL-ORPHAN | Main `8440b5f7a` replaces the two requests with a service-owned transaction and stable vault slot. | Five service failure/retry cases and five route cases PASS, with service check/strict Clippy. Native endpoint admission PASS. Cross-store power-loss/reload recovery is not qualified. |
| GCHAT-GBENCH-NATIVE-V2-REPORT | Accepted `e49219967` consumes the current native report and preserves measured cold PP, warm PP per request, cached TTFT and exact-concurrency TG. Stored v1 retains its historical meaning. Native v2 public submission is refused pending the site's approved contract. | Eight owning Rust cases and 34 frontend cases, check/strict Clippy/types/lint PASS; captured real report fixture. Public schema/scoring is a site-owner decision. |
| OI-069 | Pair/restart/grant restore passed; shared-pool queue, cancellation and recovery across two Ready hosts did not. | Resolve the worker startup/RAM blocker, then one two-host job lifecycle. |
| OI-072-RUNTIME | Closed by Arch as external in master docs `33a2f02b9`: current Muse C4/131072 had no post-Ready allocation and did not reproduce the historical drop. | Reuse C4’s 1,602-sample result (641.7–674.3 MiB free against the 300 MiB guard). Follow-up only under GUARD-EXTERNAL-DROP; this does not qualify the launch catalog. |
| OI-076 | Continued-chat context/format warning's original cause remains unknown. | Diagnostics merged in `36ac89441`; collect exact trigger on the next occurrence. No speculative fix. |
| GCHAT-LINUX-HARDWARE-PREP-OWNER-UNAVAILABLE | Local bootstrap/preparation rejects no-NVIDIA inventory before Host spawn; unreadable NVIDIA capability continues to Host validation. Main `e42805f2a` integrates source `789d089db`; focused fixture, desktop/CLI checks and strict Clippy PASS. | October 15 fresh native DEB payload handoff PASS: empty managed data, bundled runtime install, automatic live Host/idle pending required explicit GPU choice, then first native 5090 Ensure completed/published v2 in 725.317 s. Private fixture retired and booking released. Desktop GPU-picker interaction and system package-manager installation are separate; historical ENOENT loader is not asserted. |
| OI-066 | Guard diagnosis is closed; fit-message correction `85bc3d087` is not in origin/dev/next. | Owning CPU/syntax fixtures pass; reviewed engine landing remains pending. Profile qualification is OI-072. |
| OI-110 / GCHAT-UPDATER-SIGNATURE | Routing/metadata source is accepted; all 19 existing offline metadata cases PASS on S1. The live feed is not published. | Exact final-payload signature and signed artifact/feed acceptance at Ron's release gate. SectileLabs repo is artifacts only. |
| GCHAT-GBENCH-MTP-SITE-CONTRACT | Ron's local site correction awaits upload confirmation. | Ron/site owner confirmation; no site edits or publication here. |
| GCHAT-LINUX-ANN-STARTUP-UNAVAILABLE | Closed: main `8440b5f7a` removes the unconditional VectorDB startup probe and awaits settings initialization. | Focused startup case/types and October 15 retained native DEB startup PASS: six extensions loaded, RAG settings initialized, welcome rendered, zero VectorDB/ANN startup probes. Explicit diagnostics remain available; embeddings are not qualified. |
| GCHAT-LINUX-DRI3-STARTUP-WARNING / GCHAT-LINUX-APPINDICATOR-DEPRECATION | Recorded diagnostics; functional Linux acceptance passes. | Keep separate from functional failures; fix in the owning initialization/dependency only if actionable. |
| OI-074 / GCHAT-BROWSER-BASELINE-DATA | Main `2e2edfc86` removes the size warning without changing language loading or the advisory limit. Browser-data advice remains separate. | Production/loading evidence above is accepted; no unrelated upgrades. |
| GCHAT-WEB-TEST-DIAGNOSTICS | Main `b1502528b` incorporates `2c1bb9c41`, fixing fixture ownership and asynchronous settling; all 26 selected cases have passing evidence, with zero diagnostics in the final affected cases. Product code is unchanged. | Focused evidence `web-warning-note.md`; no full-suite or real Shiki/browser qualification claim. |

### Updater offline metadata gate — October 12

The retained accepted source `874cbc98d31532e92b43ff7d60072b474153236e`
integrated in main `b1502528b` passes its unchanged production
filter gate: `python3 -m unittest discover -s tests -p test_updater_manifest.py`.
S1, verified as `AIS-2-8592-L01` at `192.168.1.109`, provides existing
Python 3.12.3 and jq 1.7. Four test methods contain 19 cases/subcases and
finish `OK`, exit 0, in 0.077 seconds. Valid Windows/Linux/combined metadata,
failed/skipped omission, signature/asset-name rejection and version rejection
are covered. Sentinel signatures establish metadata admission only.

Local `jq` and the three admitted cached container images lack the executable;
the established SSH host supplied it without installation. Only the retained
test, shared filter and template were copied to an owned temporary folder;
that folder is retired after receipt retention. No build, GPU, full suite,
key change, signing, CI, release/feed access or publication ran. No source
change was needed. Actual cryptographic verification of the exact final
NSIS/AppImage bytes against the unchanged configured key and release/feed
acceptance remain separate pending gates; the recorded live 404 is unchanged.

Evidence: `/ai/gchat/out/gchat-open-items-20261012/updater-offline-note.md`.
The documentation-only tree `/ai/gchat-worktrees/updater-offline-8440`, branch
`fix/gchat-updater-offline-8440`, is based on `8440b5f7a` and retained for
coordinator review. The complete accepted updater branch is integrated as
`c36e3862c` and merged in main `b1502528b`. The test/filter/template are
unchanged from the source used for this gate.

### Untested or only partly tested

| Gate | Accepted evidence already available | Remaining scope |
| --- | --- | --- |
| OI-068 installed app walkthrough | Linux Chat, Code and builder/run routes; two workers collected/reopened; targeted Stop/parent/reopen and nine-step new-run continuation; live-worker checkpoint continuity. A later native checkpoint reduced32584→17211, followed by six source reads and a factually correct eight-file reference; exact terminal reply reopened. Normal active-worker window Close persisted cancelled history/session, then ordinary Studio reopening passed after same-data relaunch. October 17 desktop-only process death retained the original incomplete record and unchanged artifacts without replay; explicitly approved Continue finished as a distinct record. A separate idle Host SIGTERM plus ordinary Stop cancelled without executing the pending command; explicit same-profile Start and fresh approval finished a distinct new run while original archives stayed unchanged. Its final model narrative was inaccurate. One native task passed at 241364 measured input tokens with configured context 262144, reserve 20480, correct three-code Reply and zero compactions; saved Result reopening and normal Stop passed. | Automatic continuation, exactly-once execution, abrupt Host/Engine failure, mid-inference loss and power-loss recovery; Windows/Hermes at release. The original harder review is a known accuracy limitation in the release notes. The measured input gate does not qualify literal 262144 input tokens or fresh-install packaging. Read-range defect tracked separately. Do not replay passing gates. |
| OI-071 / Manager tray rows | Linux own SNI registration and native Hide. | Open/Exit on Ron's desktop release walkthrough; vault restoration across a real logout/login. No further finder loops. |
| Manager credential presentation | Forget warning DOM cases; vault success/failure/retry component fixture. | One native success/error presentation check at release. Do not repeat the DOM cases. |
| GCHAT-SHARED-APP-ICON | Shared canonical source; actual `3aff66d62` ICO generation and desktop compilation passed. | One installed GChat/Manager window and tray comparison at release. No new artwork/generator run. |
| GCHAT-HARDWARE-PROFILE-INSTALL | Linux exact-group reuse, interrupt/resume and cancellation. | Native Windows normal/cancel/Host-loss lifetime and MSVC release build. |
| GCHAT-UNIX-PTY-PIXEL-GEOMETRY | Source is merged; Linux TUI/input acceptance covers a different parser fix. | Named pixel-only resize fixture PASS (one case); native geometry/mouse behavior is not qualified. |
| OI-072 model/profile qualification | Historical evidence and source binding audit. | Exact current Muse TP1 C4/131072 NVFP4 KV + Q4 DFlash2 artifact/engine at the scheduled release gate. |
| Google / Microsoft connectors | Existing 36 focused auth/provider/runtime/UI cases plus two full local mock OAuth lifecycles; 13 current account-owner cases PASS. Source scope complete; synthetic credentials and test-only endpoints. | Live provider consent: Ron's release gate using existing approved registrations/accounts; consent/refresh/one read/revocation or local disconnect and per-bot isolation. No new credentials/accounts or broad CRUD matrix. |
| Gbot Linux executor | Exact desktop overwrite + two actual Cua file evaluators passed. | Broader task set and Vision; new cua-bench dependency closure is not approved. |
| Gbot runtime/media | Linux packaged runtime; physical frame, 440 Hz audio, view-only/takeover/revocation passed. Native Tauri WebKit playback/permissions pass after `9fa2e32b9`, replaying accepted physical media with mock service state/control; all five leases close. | Windows/M365 connection/runtime at release. Physical Linux media evidence is reused. |
| Gbot guest persistence | Fresh dedicated guest setup, persisted service restart/resume to Ready and product guest/key retirement passed; installed DEB and AppImage exit continuity passed. | One guest reboot/reconnect. Durable scheduling fixtures first; no long sleep harness. |
| OI-073 public board | One disposable publish/read/delete and app delete path passed. | Broader retry/replay/concurrent/fault cases remain parked; never use official series as tests. |
| OI-075 / OI-115 / OI-119 | Windows/generated Linux observations and focused stream/projection fixes. | Representative native memory/idle/large-media attribution; no general performance gain claimed. |
| OI-116 / OI-118 | Catalog/statvfs/lifecycle changes and Linux control/scan/journal measurement. | Windows UNC/extended-path/error, slow-NAS/hash and SCM idle/worker-count release gates. |

Schedules/KVM/updater source, pinned guest delivery and native-v2 consumption
are accepted in main `500a5f2cb`. Background ownership and seed repair are merged.
Main `13f88c042` preserves failed readiness operation/reason across restart;
its focused fixture, check and strict Clippy pass. That evidence identified the
setup owner's obsolete nested `target` keyboard arguments. The correction sends
flat `pid`/`window_id` through the existing foreground-input adapter, without
changing its guards. One owning regression, check, strict all-target Clippy and
incremental example build passed in 17 seconds at 21:42:02 UTC.

The same persisted S1 guest `4ed37849-6aa4-492d-aeb7-1cc6a63b07b4`, confined to
CPUs 80–81, reached Ready after service restart/resume. Keyboard edits were saved
and independently read back; desktop frame and view-only media readiness passed.
At 21:45:25 UTC, an isolated Chromium form passed exact native window binding,
navigation, typing and trusted input submission. The driver reported background
delivery; acceptance relies on independent pinned-host system SSH readback of
the exact saved content, including punctuation and newline, rather than its
acknowledgement. No model/GPU or person's desktop was used.

Product removal retired the guest, disk and vault key; the service exited
normally. Owned private S1 roots `gd20261012`, `gdctl`, `gdcfg` and `gdrun` are
removed and the CPU booking released. Source assets, other guests and retained
evidence remain. Receipts: `out/gchat-open-items-20261012/readiness-input/` and
`readiness-physical/`. The native lifetime gate below passes. Installed wizard/prerequisite hold and ordinary DEB window-close continuity pass.
Next: completed wizard creation/resume, sleep and live scheduled dispatch;
Hyper-V/cloud/M365 and remote service selection remain explicit source gaps.

Source `30a8be28a` closes premature admission after setup interruption or
service restart: tasks, desktop operations, view and takeover wait on the
persisted Ready stage. Resume setup retains the exact saved identity. Two
owning Rust cases and thirteen UI cases pass, plus service check, strict
all-target Clippy, frontend types and changed-file lint. Evidence:
`out/gchat-open-items-20261012/setup-admission/`.

The accepted Linux desktop executable from `17f202edb` passes a separate native
background check on S1 in a private D-Bus/keyring and data root. Its launcher
exits while the authenticated API remains alive; native vault credentials stay
out of discovery; a second owner is refused; explicit shutdown removes discovery;
restart reuses the same identity and vault credential. No GUI, executor, VM or
model ran. Missing pinned guest assets correctly return actionable not-ready
preflight issues. The private root is retired and no owned process remains.
This binary predates `30a8be28a` UI changes: it qualifies unchanged native
bootstrap, not the new wizard or installed client-window exit/sleep. Evidence:
`out/gchat-open-items-20261012/installed-bootstrap/native-result.json` and
`native-cleanup.json`.

Coordinator tree: `test/gbot-installed-wizard-e7d` in
`/ai/gchat-worktrees/gbot-browser-physical-2e735`, based on reviewed main
`e7d761c2f`, including background ownership, seed/readiness repair and admission.
The first wave (opt-in/LAN setup, transactional credential creation, Chat workers,
per-bot connectors and disabled-embedding startup) is merged there. The second wave
integrates schedules (`f769d1ead`), KVM onboarding (`89e4a22f4`) and the complete
updater source (`c36e3862c`). Focused component cases and the combined native route
fixture, frontend types, native check and strict native/service Clippy pass.
Component receipts and `wave2-*` logs are in
`/ai/gchat/out/gchat-open-items-20261012/`. Reuse passing first-wave evidence;
no installed UI, new VM, live OAuth or active-worker recovery qualification is
claimed for these changes. Schedules now belong to the independent service; installed DEB client-exit continuity
passes; AppImage GUI-exit/resource/shutdown lifetime also passes. Sleep and live dispatch remain unqualified. KVM refuses missing
host prerequisites/assets and does not install tools or substitute another PC.

The PTY geometry fixture passes (`pty-geometry-test.log`), without a native mouse
or blank-TUI cause claim. First-wave agent worktrees are retired after main merge;
second-wave source is merged and its owned trees can retire after live-use checks.
User-authorized cleanup retired seven clean merged trees. Final net Cargo
reduction was 69.77 GB, from 99.34 to 29.57 GB before the current build. Source
cleanup freed 1.35 GB apparent size from the first five trees and 0.55 GB
allocated from the final two.
Current closures, accepted packages and evidence remain. Inventory:
`/ai/gchat/out/gchat-open-items-20261012/disk-cleanup.md`.

### Disabled-embedding native startup — October 15

`GCHAT-LINUX-ANN-STARTUP-UNAVAILABLE` is closed. The retained developer DEB
`GChat_2.0.42+oi06820261014.38ff80e0c_amd64.deb` (desktop source `7e33222e8`,
including fix `3afd4ea8a`; package SHA256
`dd145b4f19faffe7665b8e3325ca4326f80d36087ccd3a8e5df7227b72e51169`)
passes native startup at 10:01:12Z. The actual packaged RAG instance awaits
`configure()` during `onLoad`, initializes its settings and joins all six
registered extensions while the welcome screen renders. Native startup emits
zero `[VectorDB]` messages, sqlite-vec path attempts or ANN-unavailable reports.
The explicit VectorDB `getStatus` method remains available and was not invoked.
Attachment configuration `enabled=true` does not qualify embeddings.

This is an extracted native payload on WSLg X11 with empty private XDG data,
private D-Bus and an unlocked private Secret Service, on booked CPUs 8–11.
No package-manager installation, model/GPU workload, build or feature activation
was performed. Existing DRI3/AppIndicator diagnostics, successful NVML fallback
and the unpublished updater's HTTP 404 remain separate; this is not a clean-console,
renderer-acceleration or release claim. The native window closed normally and
completed app cleanup. Exact private helpers and 4.244 GiB of owned extraction/data
were retired; the booking was returned and physical session/keyring left untouched.
The startup-refreshed shared CLI has identical bytes. Evidence:
`/ai/gchat/out/ann-startup-20261015/{result.json,summary.md}`. Reuse the passing
focused case and frontend types (`ann-test.log` / `ann-types.log`); no repeat suite.

## Accepted Ubuntu Desktop packages — OI-057

The retained `0705f31a6` GChat 2.0.42 DEB and AppImage pass installed desktop
acceptance on stock Ubuntu 24.04.5.1 GNOME, with WebKitGTK 2.52.6, in the private
S1 `gchat-linux-accept` guest. Both actual Wayland and Ubuntu on Xorg pass:

| Desktop session | Installed DEB | AppImage after normal DEB exit |
| --- | --- | --- |
| Wayland | Visible render, ordinary Chat completion, normal exit | Visible render, sidebar reopen of the saved answer, normal exit |
| Xorg | Visible render, ordinary Chat completion, normal exit | Visible render, sidebar reopen of the saved answer, normal exit |

The same accepted native Host launches Qwen3.8-27B INT through `3235aaacc`
SM120 `ginfer`/`ginfer-serve`, side by side, with the existing pro1-r2 dense
hardware profile. The unchanged functional launch is TP1, C2, context16384,
INT8 KV, DFlash fixed7 and AUTO arena, with Vision and structured outputs enabled.
The two ordinary Chat turns finish with no active generation. Saved thread IDs
are `0b72a24b-f513-44b1-9aeb-a8b256dbc4b7` (Wayland) and
`8df54865-b9de-4872-8527-8ac2e5f13d6c` (Xorg).

The private Xorg autologin session left its earlier test keyring locked, and the
saved test-account password did not unlock it. The encrypted fixture was
preserved; a fresh private keyring and normal Host Forget/Pair restored testing.
Xorg authenticated Host access survives the subsequent app restart. This does
not establish keyring preservation across desktop logout/login. No Ron desktop,
credentials or history were used. No GChat product defect was demonstrated by
that fixture recovery.

The final model Stop returns HTTP200. Both apps, the owned Host and Engine exit;
GPU0 is empty and its canonical guard is reacquired/released. The guest shuts
down normally, its transient domain/QEMU process and private SSH listener are
absent, and bookings1094/1101 are canceled. No rebuild, calibration, Windows
change, signing or publication occurred. This is desktop functionality against
an accepted external runtime, not qualification of the historical `05a` Engine
bundled in these packages or a performance/release claim.

Evidence: `/ai/gchat/out/oi057-linux-desktop-acceptance-20261011/result.json`,
with the two terminal Chat receipts, saved-session/vault receipts, visible
screenshots and resource-return receipts linked there. The immutable package
receipt remains `/ai/gchat/out/oi057-linux-packages-20261011/artifact-result.json`.
The S1 `/ai/gbot-vms/gchat-linux-accept` disk, clean-os snapshot and old package
copies were retired in the authorized October 12 cleanup at 00:28 UTC. Retained
screenshots, results and package receipts preserve this historical qualification;
they do not provide a runnable desktop baseline. Current implementation and
unrun scope are listed above.

## Current Linux reasoning menu correction

Ron reports the Linux reasoning popup is white and differs from Windows.
The control uses a native HTML select, whose popup follows WebKit/platform
styling. The candidate replaces it with the existing themed Radix radio menu,
retaining all six effort values, Off, the bulb toggle and re-enable behavior.
No reasoning levels, budgets, dependencies or model defaults change.

The three focused selection/keyboard/disabled-state cases pass, as do affected
source lint and frontend typecheck. Candidate source is on
`fix/gchat-s2-acceptance-058`; evidence is
`/ai/gchat/out/s2-acceptance-20261011/reasoning-dropdown-proposal.json`.
The corrected Linux frontend and desktop build pass; the build container is
removed and the guard returns at 13:08:19Z. The private Linux app's actual
opened radio menu is visible at 13:10:35Z, with dark background `rgb(17,19,22)`,
light text, all six options and the saved High selection. Ron accepts its
appearance. Native keyboard input is not claimed: the X11 focus attempt stops
before sending a key; the focused DOM fixtures cover keyboard behavior.
No native Windows or release change. Build and visible proof are retained in
`reasoning-build-6b199362-1300/` and `reasoning-menu-visible.json`.

## Current Unix PTY window geometry correction

GCHAT-UNIX-PTY-PIXEL-GEOMETRY is a separate source-proven resize units defect.
The shared Code/Hermes terminal hook divided container pixels by rows/columns;
native `terminal_resize` forwards those values unchanged as whole-window
`PtySize.pixel_width/pixel_height`. The correction sends integer
`clientWidth/clientHeight` directly, preserves the existing row/column fit, and
also reports a pixel-only resize when the fitted grid does not change. Showing
the terminal or starting a new visible generation synchronizes the same geometry.
No native PTY contract, request field, dependency or terminal parser changes.

Source `a0e51478d` is merged as `97b387202`. The named CPU-only fixture
`CodeTerminalHost > reports whole-window PTY pixels when the fitted rows and
columns stay unchanged` PASS on October 12: full 960 by 739 pixels and 961 by
740 at the same 24 rows and 80 columns. Evidence:
`/ai/gchat/out/gchat-open-items-20261012/pty-geometry-test.log`.
No new source change or repeat test was needed. Installed geometry and mouse
acceptance remain pending.

The contrary same-session observation is retained at
`/ai/gchat/out/linux-code-tui-20261011/geometry-probe.json`: supplying full 960 by
739 pixels did not resume the blank TUI. This resize correction is not its cause
or a replacement for the accepted production DECRQM parser correction below.
No mouse-input failure or downstream mouse-behavior improvement is claimed.

## Current Linux Code TUI correction

Repository `/ai/gchat`; subject `docs/agent-runtime/`; baseline main `7fe8363b1`,
branch `fix/gchat-linux-code-tui-7fe`, source
`/ai/gchat-worktrees/linux-code-tui-7fe`. The October 11 10:42 decision assigns
GCHAT-CODE-LINUX-TUI-BLANK. Establish the cause from source plus one isolated
Linux reproduction, then fix the owning path. Deadline 13:30Z.

Acceptance: focused owning cases and one live Linux Code session that renders
its TUI and accepts a typed prompt. Use the local 5090 for at most 20 minutes
only if the final response needs a model. No native Windows work, dependency
installation, Engine build, calibration, full suite or release publication.

Saved baseline: stock OpenCode 1.18.21 starts its managed provider/MCP/session,
but the parsed xterm screen contains only the shell launch. Successful native
PTY input does not enter stock message history. The same session's public API
prompt completes normally; model routing and managed configuration are accepted,
not embedded TUI interaction. No cause is inferred from those associations.

One private no-model reproduction proves the owning failure. OpenCode receives
unsent terminal input and produces ANSI TUI drawing; the native channel delivers
it. xterm instead throws `ReferenceError: Can't find variable: i` in `requestMode`
on the initial DECRQM capability query, leaving 15 chunks / 13,660 bytes queued.
The installed 6.0.0 source and published JS builds declare that variable. The
actual shipped GChat bundle removes the declaration but retains the enum's
assignment, establishing production bundling as the owner. Correcting
PTY window pixels inside the same session does not resume rendering; it is not
established as this defect's cause. No model was needed for this diagnosis.

Tested source `f2de958f3` preserves logical assignment in the existing Vite esbuild
configuration. An installed esbuild-only discriminator proves default lowering
throws while the feature override executes correctly; preserving Rollup output
alone still fails. Actual Linux WebKit directly executes the supported syntax.
Independent source review accepts the correction and the focused fixture, which
bundles the actual published terminal with production settings and checks exact
mode replies plus continued output through public APIs.

The focused production parser fixture passes 1/1 in 909 ms. Affected fixture
lint, frontend typecheck/build and the corrected Linux desktop build pass on
that exact source; the desktop finishes in 3m11s at 11:24:21Z under CPU booking
481 (11:14–11:39Z). Its retained executable is
`/ai/gchat/out/linux-code-tui-20261011/runtime-donor/usr/bin/gchat`.
These checks establish exact query replies and continued parsing/write completion,
not visible drawing or ordinary OpenCode input.

The named live Linux Code TUI gate passes at 11:36Z on the corrected desktop.
Screenshots show the rendered TUI, typed prompt, response and next-input cursor.
One native X11 submission sends 53 characters and one Return; the same stock
OpenCode session changes from zero messages to exactly one user and one assistant
message. The exact typed prompt is persisted. The assistant answers `ok`, finishes
with `stop`, becomes idle and calls no tools. It does not return the requested
full marker; this is functional TUI/input evidence, not model-quality evidence.
The bridge shows Connected with 16 skills and 39 tools, and the session appears
in the Code sidebar. Independent saved-evidence review accepts that named scope.

Ordinary Code Stop and the owned Host's normal Stop at 11:37:19Z complete.
App and Host exit normally; Code and Engine children are absent, all five private
listeners close, and guard PID 1901679 exits 0 (execution session 29915).
Booking 485 is cancelled. All 11 standalone configuration entries remain unchanged. `resource-return.json` records
the verified return. `cleanup-result.json` confirms removal of the private
test root and 95,838,208 allocated bytes; no owned process or model remains.

The correction is merged and pushed on main `058702dd8`; its source tree is
retired and accepted desktop/resources and evidence remain. OI-069/OI-071
S2 acceptance is current in `docs/ginfer-manager/README.md`. No Windows or
release change occurred.
Code TUI acceptance is PASS. OI-068 remains PARTIAL for Hermes/Windows and the
broader active-worker compaction scope.

Initial fixture failures are retained: bundling now uses an actual Node subprocess,
paths use Node file utilities, and expected replies include xterm's real
focus-out report. No parser interception or fabricated reply was introduced.
The frontend's existing large-chunk warning remains visible: baseline 531.59 kB,
current 531,559 bytes. OI-074's remaining packaging work is separate.
Evidence: `/ai/gchat/out/linux-code-tui-20261011/` `console-errors.json`,
`bundled-handler.json`, `parser-state.json`, `raw-after-input.json` and
`buffer-after-input.json`; passing gates are retained in
`frontend-terminal-mode-replies.log`, `frontend-fixture-focus-lint.exit`,
`frontend-build.log` and `desktop-corrected-cli.log`, with their exit receipts.
Live evidence is `corrected-code-before-input.png`, `corrected-code-final.png`,
`type-own-code-result.json`, `dismiss-update-result.json`,
`runtime-before-typed.json`, `runtime-final-typed.json`,
`corrected-buffer-final.json` and `corrected-code-final.json`.

| Owner / host | Path | Purpose / retention |
| --- | --- | --- |
| GChat / local | `/ai/gchat-worktrees/linux-code-tui-7fe` | Current candidate; retain through reviewed merge |
| GChat / local | `/ai/gchat/out/linux-code-tui-20261011/` | Retain cause, focused/live verification and resource-return evidence |
| GChat / local | Same packet `test-root/` | Removed after normal teardown; 95,838,208 allocated bytes reclaimed |
| GChat / local | Same packet `runtime-donor/usr/bin/gchat` | Corrected tested desktop from `f2de958f3`; source and live gates pass, merge pending |
| GChat / local | `/ai/gchat/out/opencode-data-root-20261011/` | Accepted tested desktop and config-isolation evidence; preserve without rebuilding |

## Current Code configuration isolation

Repository `/ai/gchat`; subject `docs/agent-runtime/`; baseline main `1e61155b4`,
branch `fix/gchat-opencode-data-root-1e611`, retired source
`/ai/gchat-worktrees/opencode-data-root-1e611`. The October 11 decision assigns
GCHAT-CODE-MANAGED-CONFIG-DATA-ROOT: managed configuration and all managed OpenCode
children must use the selected GChat data folder without writing the user's
standalone OpenCode configuration. The owning master rows were read before changes.

The implementation is complete in reviewed/pushed product `6a8d81383`.
Independent review accepts the source and saved evidence for managed ownership;
it explicitly excludes natural embedded TUI acceptance.
One directory, `<data>/code/opencode`, owns configuration, theme, plugins and
update logs. Desktop and CLI resolve the selected app data folder once per
operation. Every managed child receives `XDG_CONFIG_HOME=<data>/code`,
`OPENCODE_CONFIG_DIR=<data>/code/opencode` and `OPENCODE_CONFIG` pointing at the
preferred writable document. Readiness, embedded and external Launch, CLI,
updater and offline session deletion use this contract. HOME is unchanged; there
is no standalone import or fallback. Stock project and HOME/.opencode discovery
remain upstream behavior; this correction isolates managed writes.

All eight owning cases pass, including real PTY and external-shell environment
witnesses. Strict Clippy, affected Launch lint, frontend typecheck/build and the
corrected Linux desktop pass. CPU booking 474 returned at 10:17 after producer
exit. No source changed after these checks.

The isolated Linux/WSLg Code configuration and routing check passes with stock
OpenCode 1.18.21, the accepted 257 Host, accepted 670 runtime/profile and the
existing FlashNext SMOL artifact in place. Native readiness resolves the private
managed JSONC. The actual OpenCode process has unchanged HOME and the expected
configuration environment; its loaded provider/model and MCP connection match
GChat. Its session is saved as a Code sidebar reference. One public API prompt
on that same session returns `OI068_CODE_DATA_ROOT_OK`, finishes with `stop`,
makes no tool call and becomes idle. All 11 pre-existing standalone configuration
entries retain exact bytes, hashes, modes and mtimes through full teardown.
This is configuration/model/bridge evidence, not inference performance or
physical model qualification.

That configuration check did not complete embedded terminal interaction. Its
parsed xterm buffer was
blank apart from the launch command, and the once-only native PTY prompt never
entered OpenCode's message history. The API prompt above was submitted only after
that session was confirmed to contain zero messages. It does not establish a
natural TUI response. GCHAT-CODE-LINUX-TUI-BLANK records this separate observed
defect; the current item above establishes its bundling cause and passes the
live typed-input gate. OI-068 remains PARTIAL for Hermes/Windows and broader
active-worker compaction scope.

Ordinary Code Stop reports Exited; ordinary sidebar Stop leaves the Host instance
stopped with zero active requests. Model booking 478 (10:24–10:39) returned at
10:35 after Engine/OpenCode absence and closed facade/upstream/Code listeners.
The guard exits 0. App and Host exit normally, all five private listeners close,
and the private test root releases 95,911,936 allocated bytes at 10:37.
The clean merged prior agent tree is retired (302,551,040 allocated bytes);
its exact baseline LICENSE/agent-skills resources are preserved in the accepted
donor first. Original models, runtime, profile and Windows installation remain intact.

Acceptance scope is the requested managed-configuration correction: focused cases
and one isolated Linux Code configuration/routing check without repurposing HOME.
No full suites, Engine/model build, calibration, dependency/tool installation,
Windows build/run or release/sign/publication. The existing overwritten global
configuration has no known immediate before-image; no restoration is claimed.
Driver corrections are recorded in the evidence packet: typed Host routes/snapshot
fields must be read before commands, Radix menus opened through supported keyboard
interaction, and process ownership checked as paths/arguments rather than raw
command substrings. Failed driver observations are excluded from product evidence.

Configuration ownership is merged/pushed on main `7fe8363b1`. The separate Linux
terminal defect is the current item above; no configuration-check job remains.
The clean merged source tree is retired. Its tested desktop and exact accepted
resources remain in `/ai/gchat/out/opencode-data-root-20261011/runtime-donor/`;
`baseline-tree-retired.json` in the current TUI packet records the retirement.
The next paired-Host acceptance items are OI-069/OI-071.

| Owner / host | Exact path | Purpose / retention |
| --- | --- | --- |
| GChat / local | `/ai/gchat-worktrees/opencode-data-root-1e611` | Retired after merge on main `7fe8363b1`; accepted desktop/resources retained externally |
| GChat / local | `/ai/gchat/out/opencode-data-root-20261011/` | `focused-result.json`, `code-config-functional-result.json`, `runtime-api-after.json`, exact standalone snapshots, blank terminal and cleanup evidence; tested desktop retained |
| GChat / local | Same packet `test-root/` | Removed after normal teardown |
| GChat / local | `/ai/gchat/out/agent-walkthrough-20261011/` | Accepted three-defect evidence and tested baseline; preserve |
| GChat / local | `/ai/gchat-worktrees/agent-walkthrough-869` | Retired; baseline resource links replaced with exact retained copies |

## Accepted walkthrough defect correction

Repository `/ai/gchat`; subject `docs/agent-runtime/`; baseline main869a368b1,
branch `fix/gchat-agent-walkthrough-869`, owned source
`/ai/gchat-worktrees/agent-walkthrough-869`. The09:07 decision authorizes one
coherent correction for the three discovered core-agent defects: Builder must
finish after its successful required save; mounted Chat must refresh newly saved
and updated definitions; failed Chat tool state/error must survive persistence.
Read each owning-file master row before changing it; original walkthrough
receipts below are baseline evidence, not passing candidate evidence.

Acceptance: one focused regression per owning behavior, then one installed
Linux real-model re-check of only those three steps. Reuse the accepted670
runtime/profile/in-place artifact without Engine build, calibration, model copy
or Windows changes. Book the local5090 for at most20 minutes only while the
model runs, after C3's current09:01–09:36 install actually releases its guard;
09:40 remains the conservative earliest planned GPU start. No full suites,
passing-gate repeats, release/sign/publication or added limits. Deadline11:30Z.
The coherent candidate fixes all three source owners: native Builder ends after
its successful reviewed save; native definition saves/deletes notify mounted
consumers after persistence; canonical Chat history retains terminal tool state
and error text. Denied/failed authoring remains revisable, ordinary-agent saves
continue, and successful/falsy results and existing saved-tool history are retained.

All19 focused cases pass: mounted definitions5, history11, native Builder2 and
native persistence1. Current core/frontend build and affected lint pass; corrected
Linux desktop production from b51909e63 passes in3m11s without compiler warnings.
The frontend retains its existing large-chunk notice. Independent source review
and independent saved live-evidence review find no material blocker.

The single real-model gate passes on the corrected Linux desktop, accepted257
Host, accepted670 runtime/profile and in-place FlashNext SMOL. Each actual Create
agent approval saves exactly once, then native Builder finishes with reply and
no further inference. Outer Chat still generates its normal summary and clears
Working. Create and rename appear in the same Chat selector without reload or
navigation; the stored update changes only name. No separate persistent React
mount token is claimed. One ordinary approved missing-file read stores
output-error and the exact OS error; sidebar reopen shows Could not read document
with the identical ERROR text, rather than a pending tool. No retry or alternate
file/shell/web execution occurs.

Booking47109:43–10:03 is returned at the actual09:49 model end, after normal
sidebar Stop proves stopped/0active and facade1337/upstream46013 closed. Owned
model children, app, Host and guard are absent. The guard exits0; later admission
belongs to another owner. Private test state23797760 allocated bytes is removed,
and the clean/pushed/merged prior OI-068 tree is retired. Candidate source and
tested desktop/evidence remain for coordinator merge; shared models, source
profile/runtime, previous evidence and Windows installation remain intact.

The existing Code isolation gap is also observed during ordinary model selection:
managed configuration writes HOME/.config/opencode/opencode.jsonc despite private
XDG/app data. No Code run occurs. Its immediate before-image is unavailable, so
no exact restoration or wholly isolated user-configuration claim is made. The
master GCHAT-CODE-MANAGED-CONFIG-DATA-ROOT row retains this owning correction.
Broader OI-068 remains PARTIAL for Code/Hermes/Windows and active-worker scope.

The three-defect change is merged and pushed on main `1e61155b4`. No owned live
job or booking remains. Current Code isolation and its separate terminal blocker
are recorded above; no release/sign/publication occurred.

| Owner / host | Exact path | Purpose / retention |
| --- | --- | --- |
| GChat / local | `/ai/gchat-worktrees/agent-walkthrough-869` | Retired after preserving exact baseline resources |
| GChat / local | `/ai/gchat/out/agent-walkthrough-20261011/` |19 focused PASS, tested desktop and real-model-result.json / exact saved-error and cleanup evidence |
| GChat / local | Same packet `runtime-donor/usr/bin/gchat` | Tested b51909e63 Linux developer desktop; preserve without rebuilding |
| GChat / local | Same packet `test-root/` | Deleted after normal resource return; concise generated evidence retained |
| GChat / local | Prior OI-068 packet `accepted-host/ginfer-host` | Accepted257 Host reused without rebuild; preserve |

Accepted670 runtime, complete v2 profile and in-place FlashNext SMOL artifact are
retained prerequisites in the baseline inventory below. No Engine build,
calibration, model copy, Windows change or performance/qualification claim.

## Accepted OI-068 Linux SMOL functional walkthrough

Repository `/ai/gchat`, subject `docs/agent-runtime/`; source baseline
`a4bebb2e1`, Host candidate `257252131`, branch
`test/gchat-oi068-real-model-a4bebb2e`. The October11 authorization permits an
isolated Linux Host and accepted desktop, accepted670 SM120a runtime, existing
complete v2 profile and existing FlashNext SMOL artifact in place. The08:33
exception permits one current Host build for the discovered argument-order
blocker. No Engine build, calibration, model copy, Windows change, performance
claim or physical-release qualification is included.

The bounded Linux cells are complete, with partial acceptance. Actual Ready
reports131072 context. Fresh Chat reads generated MD/XLSX through ordinary
folder permission and reports OI068-LOCAL-ONLY / Budget /42000/12000/30000;
same-conversation continuation passes without tool calls. The reviewed standard
definition saves through the actual native Create agent control with current
model, default{} permissions and unchanged25 steps. Its separately invoked
saved-agent run finishes in2 steps with two fresh native document reads and
final reply; Chat clears Working. Manual `/compact` creates a checkpoint, and
the final no-tool continuation reuses it: input10138→4667,6 retained and23
summarized messages. This does not qualify Code compaction or continuity of an
already active worker. The same actual Engine session is used throughout.

Agent Builder normal completion fails: after the approved save succeeds, the
worker requests an identical second save despite the explicit once instruction.
The second approval is not granted; ordinary Stop cancels that turn. A preceding
review rejects a wrong goal path and a changed-permissions proposal; the final
saved definition has the correct paths and original settings. Persisted-definition
and saved-agent success are distinct from Builder completion.

All discovered product defects are on the sole master list:

- GCHAT-HOST-HARDWARE-PROFILE-ARG-ORDER: fixed257. Host had prepended the
  hardware-profile flag before the required artifact; accepted670 rejected the
  profile path before weights. The fix preserves profile/settings and orders
  the artifact or closed-set selector first. Actual spawn-argv fixture1/1,
  production build/zero warnings and same-runtime Ready pass. Initial failure
  and normal resource return are retained; this was not a VRAM failure.
- GCHAT-CHAT-TOOL-ERROR-PERSISTENCE: failed tool parts drop state/errorText on
  save and reopen as pending inputs. Four absent-output calls prevent exact
  diagnosis of the initial read failure. No maxChars permission cause is claimed.
- GCHAT-AGENT-BUILDER-DUPLICATE-SAVE: actual repeated save and unfinished Builder
  turn; inference/runtime cause remains unproven.
- GCHAT-CHAT-AGENT-DEFINITION-REFRESH: mounted Chat keeps its initial empty list
  after Builder saves. Reload restores the saved selector; ordinary Host refresh
  and model reselection retain the same Engine session before the actual run.

The08:23 conditional decision allows Code only with safe isolation. Linux
managed configuration ignores private XDG and writes under HOME, which stays
unchanged here: Code is skipped and GCHAT-CODE-MANAGED-CONFIG-DATA-ROOT remains
open. Hermes provisioning is excluded; its live cell is owed on the existing
Windows installation at the release walkthrough. These are baseline failures; the three-defect candidate above now accepts Builder
completion/live refresh/error history. Broader Windows/Code/Hermes and active-worker
checks keep OI-068 open.

One invalid harness send is excluded from saved-agent acceptance: selector
lookup failed, but its shell caller continued to Send. Ordinary Stop cancels
that turn. Dependent phases now use `set -e` and verify both the saved ID and
selected model before Send. Process ownership checks use every Host task's
children and birth identity; checking only the main thread misses worker-spawned
children. Radix menus use their supported keyboard trigger rather than a bare
programmatic click. No passing gate is repeated for these helper corrections.

Normal sidebar Stop closes the facade1337 and Engine44775; the Host reports
stopped/0 active and owned Engine PID1713297 is absent. GPU memory returns to
1927MiB. At09:01 the keeper exits, canonical GPU guard is reacquired/released and
booking464 is cancelled before C3's09:05 install. Isolated app/Host exit normally;
no private-root process references remain. The test root is deleted, while the
tested candidate Host is retained as baseline. The merged OI-073 tree's generated
remnant is also retired after confirming its source is pushed and merged;
315,731,968 allocated bytes are removed in total. No Windows state or owner
runtime/profile/model is changed.

Source257 and this baseline are merged/pushed on main869a368b1. The current
three-defect candidate gate and handoff are recorded above.
There is no live model, Host, app, booking or guard owned by this walkthrough.

| Owner / host | Exact path | Purpose / retention |
| --- | --- | --- |
| GChat / local | `/ai/gchat-worktrees/oi068-real-model-a4bebb2e` | Retired after clean, pushed and merged main869 verification; evidence/accepted Host retained outside tree |
| GChat / local | `/ai/gchat/out/remaining-acceptance-20261009/oi068-linux-smol-20261011/` | Concise generated-fixture evidence, `chat-functional-result.json`, `saved-agent-functional-result.json`, `compact-and-continuation-result.json`, final Stop/resource/cleanup receipts |
| GChat / local | Same packet `accepted-host/ginfer-host` | Tested257 Linux Host,4,323,960 bytes; retain without rebuilding |
| Accepted baseline / local | `/ai/gchat/out/remaining-acceptance-20261009/oi073/app-delete-20261011/runtime-donor/` | Accepted35e desktop and packaged resources; preserved |
| C3 / local | `/ai/kernel-agent/run_workdir/local/direct-read-wake-670d1c68a/accepted-670-full-cli-120a/` | Authorized670 CLI/library closure; owner prerequisite preserved |
| C3 / local | `/ai/kernel-agent/run_workdir/local/profile-v2-87f0820b0/apps-670d1c68a/apps/ginfer-serve` | Accepted670 server; explicit source/ELF binding retained in `runtime-binding.json` |
| C3 / local | `/ai/kernel-agent/run_workdir/local/profile-v2-87f0820b0/results/local5090-301974bb6-r1/hardware-v2.json` | Complete v2 profile; preserved without calibration |
| Shared model / local | `/ai/kernel-agent/run_workdir/local/fn-graph-probe-startup-f9af4cff4/model/qwen38_flash_smol_mtp.ginfer` | Existing TP1 `qwen3.8-flash-next/smol-q2g64`; preserved in place |

## Current ordered acceptance — October 10

Booking380 completed and both canonical guards returned at 22:44:41 UTC,
before the 22:49 boundary. Source `3aff66d62` retains the accepted Linux gate.
Windows release libtest compile passed (Cargo 4m03s), the four real ConPTY
cases passed 4/4, fresh frontend passed in 33.80s, and desktop production compile
passed (Cargo 4m20s). No compiler warnings were emitted. Independent artifact
verification passes for the exact 38,272,000-byte developer executable and all
832 embedded frontend assets; this is neither a new NSIS installer nor an
installed UI pass.

The ready executable is
`C:\Users\Ron\AppData\Local\GChat\remaining-acceptance-20261010\desktop-code-1ccde5715-380-r4\windows\gchat.exe`.
`compiled-desktop-code-380-proof.json` in the existing packet records its
producer, relative frontend embedding and canonical icon. All five native
controller attempts have proven terminal results, pinned body exits and empty
Jobs; exact owned PIDs are absent. Engine/API/debug listeners are zero, retained
Host PID6788 is unchanged, and installed GChat retains the original574d bytes.
Keeper475147/start11741613 exits0; both canonical guards were reacquired and
released, and booking380 cancelled.

Booking391 installed the exact accepted3aff desktop and rendered the embedded UI.
Visible Stop/native exit and Restart/output/tools bridge pass. Page reload leaves
an empty terminal with a lost-screen-state warning while native replayComplete
remains true; this reconnect screen fails. Ordinary desktop recovery passes at
23:06:24 UTC with Manager/Host/state preserved and Engine/API/debug0. Both guards
were reacquired/released and391 was returned at23:07. Evidence lives under
`oi068-windows-20261010/desktop-ui-391/` (UI receipt, screenshot, normal recovery,
root retirement). The actual preload flag was false and API startup flag true.
Ron's23:05 decision makes both product defaults off and requests a fresh native
window with both saved settings off, reusing the accepted artifact/tests with
no rebuild. This next screen must separate original Stop acceptance from the
new reconnect failure and cannot claim the newly edited defaults are installed.

The requested fresh native window at23:11:44 retains both saved flags false.
Visible Stop becomes Exited and Restart creates generation2 with output and
connected GChat tools; those narrow checks pass. Reload again leaves56 empty
DOM rows and the lost-screen-state warning while native status says Running /
replayComplete=true. This is a separate reconnect defect, not a startup-setting
cause. Evidence: `desktop-ui-392-fresh/ui-result.json`, native/visible checks and
`22-reconnected-screenshot.png`. Ordinary recovery passes at23:14:07; updated
GChat PID636, Manager37676 and Host6788 remain open with no Engine/API/debug
listener. All helpers are terminal/absent; keeper854121 exits and both guards
are reacquired/released. Booking392 is returned at23:16:12.
Ron accepts the Stop correction at23:14. Submit the accepted Stop branch through
the normal merge path without signing/publication. The next single item is
live-channel reconnect: `terminal.rs` treats replacement as unavailable and
then resets replay completeness; it does not retain delivered output for a new
renderer. Add that product defect separately to the master list, use small
regressions and one installed visible replay after its source correction.
Broader OI-068 model/tool/worker acceptance remains incomplete. No new build,
model request or full suite ran in391/392.

## Live terminal reconnect: installed gate accepted

Repository GChat, subject `docs/agent-runtime/`, branch
`fix/gchat-terminal-reconnect`, product `f111810ec`, baseline `ac3c7a5db`
(product3aff). The fix retains every published event before delivery in the
existing 1MiB full-generation replay log. Healthy replacements replay complete
history; attachment does not reset it. Delivery failure preserves history and
actual overflow remains unavailable until a new generation. No cap, dependency,
redraw workaround or model request changed.

The four focused Rust reattach regressions and existing frontend 21/21 checks
pass in `reconnect-focused-result.json`. One Windows desktop build passes at
23:38:12 UTC, reusing the accepted 832 embedded assets. The actual installed
fresh-window reload passes once at 23:54:58: same generation1 and viewport,
56 rows/15,547 text characters retained, Running, connected tools, visible prompt
and no lost-screen warning. Both saved startup flags remain false. Evidence:
`out/remaining-acceptance-20261009/oi068-windows-20261010/`:
`compiled-desktop-reconnect-393-proof.json` and
`desktop-ui-393-retry/{ui-result.json,23-full-screenshot.png}`.
Accepted Stop/Restart392 is reused; no repeated model, full suite or reload gate.

Normal candidate GChat30972 starts at23:59:18 with debug disabled. Root verifies
all protected state equal and Manager/Host retained, Engine/API/debug0; the
build-only keeper exits0 and releases at23:59:56. Booking393 is cancelled.
`desktop-ui-393-retry/root-normal-recovery-verification.json` and
`desktop-ui-393/release-verified.json` hold the actual recovery/resource proof.
The new accepted desktop is retained locally as baseline; source is pushed.
Startup-default source1ec is integrated from main but remains unbuilt; the
installed local flags are false, not proof the new default code is installed. Next: coordinator
lands the accepted source through normal main merge, with no release/signing.

Original refresh/recovery helper FAIL receipts remain. They caused no foreign
process action: raw PID ancestry followed older OneDrive children of a reused
WebView PID; a recovery caller used unsupported capture names; descendant pinning
raced natural exit; final detailed receipt proved equivalent `\\?\C:` and `C:`
conhost paths compared unequal. Recovery uses the verified root process's graceful
CloseMainWindow/exit and ordinary restart, without replacement or force. Future
helper ownership must use live birth identities, tolerate proven exits, normalize
native verbatim drive-path spelling and validate caller/capture contracts together.
These procedural corrections belong in GInfer `docs/maintainer/process-log.md`;
the one installed product replay remains accepted, never rerun for helper failures.

## Startup defaults: accepted source integrated from main

Both source startup defaults are false in accepted `1ec7ad935`, merged into
GChat main `a3803c023`.
Legacy missing keys resolve false; explicit saved true/false choices survive.
The owning hook regressions pass15 selected cases in1.30s;44 unrelated cases
were excluded by the name filter, not treated as passes. Production hooks pass
ESLint; its configured test-file exclusions remain explicit. The Yarn launcher
could not write the shared install-state cache, so the existing installed
ESLint binary supplied the source check without package changes. No desktop
rebuild ran; the installed flags and unbuilt default change are different scopes.
The [startup decision](../decisions/2026-10-10-default-model-and-api-startup-off.md)
replaces the old automatic opt-in policy. Accepted Stop `ac3c7a5db` and startup
defaults are integrated on main; this reconnect branch imports them to resolve
its documentation conflict. The terminal fix and passing gates remain unchanged.
No build or test is repeated for this merge; installed acceptance above remains
bound to the retained f111 executable and explicit saved startup settings.

Pre-Cargo failures are preserved separately: historical-PID stderr handling,
missing admitted guard arguments in the suspended child, and a test-generated
empty staged catalog. Explicit existence status and child argument propagation
were verified by the actual r3 passes. The empty61B catalog is preserved and
only the owned staged resource restored from the verified accepted206488B
copy; production passes with the accepted14 catalog inputs. Future test setup
uses those inputs instead of clearing them. Process corrections belong to
GInfer `docs/maintainer/process-log.md` row
`GCHAT-NATIVE-380-HANDOFF-STAGING`; product acceptance remains on the master row.

The [validated NSIS owner decision](../decisions/2026-10-10-prefer-current-user-nsis-owner.md) governs the integrated custom template; failed ownership checks retain upstream MSI migration.

### Historical Windows and S2 acceptance preparation

The October 10 records below preserve the tested producers and then-pending
actions. Current acceptance and the new S2 plan are recorded above and in
[the Manager authority](../ginfer-manager/README.md).

Candidate `fix/gchat-remaining-acceptance-bd4` at
`/ai/gchat-worktrees/remaining-acceptance-bd4` starts from published
`bd4dba841`. Historical Windows components were corrected `574d73df7` GChat
desktop, new Manager `574d73df7`, 7d9 Host/CLI and retained Engine `2ef56a52`.
The baseline restoration, corrected desktop compilation, embedded-origin
rendering and separate NSIS payload verification pass at their recorded scope.
Code Stop presentation failed at that stage; subsequent correction and acceptance
are recorded in the current account above. Host fixes
OI-111–114 and OI-120–122 retain composed Rust checks at 01:50:05 UTC.
The [integration authority](../code-hygiene/README.md)
owns their source verification and accepted Linux packages (`54c931c68`
compiled, `02d369e8a` assembled).

OI-072's ordinary-token capture completed without reproducing the historical
118 MiB loss; attribution remains unresolved in its
[single current authority](/ai/kernel-agent/run_workdir/local/oi072-runtime-53516bb5/ginfer/docs/oi072-runtime/README.md).
OI-076's two saved incident files contain neither the original warning nor its
failed request. Ron authorized OI-110 local manifest preparation for the
SectileLabs public feed; actual existing-key signing/publication remains gated
until his next release. He separately authorized OI-073's complete lifecycle
and final deletion for one clearly labelled root-created disposable test
result, preserving all 12 official series/36 points. After Ron corrected the
partial site deployment, the explicitly authorized one-attempt installed
submit/read/delete check passes. Public and local test data are removed;
broader retry checks remain unrun under the current restriction.
The ordered remaining checks are OI-068, OI-069, OI-071 and OI-075.
The October 10 booking364 desktop refresh passed embedded-origin rendering
and normal nondebug restart with state and Manager/Host/Engine preserved. Code
Stop succeeded at backend/process scope but its UI remained Stopping after 26s;
`GCHAT-CODE-STOP-STUCK-UI` was open and the complete Code case was not accepted
at that stage.
The packet's `desktop-ui-terminal-364.json` records this split outcome and actual
16:31:58 guard release. Booking365's corrected Linux Manager component/package
pass and the still-unrun S2 native tray/grant check are recorded in the current
[Manager subject](../ginfer-manager/README.md). NSIS367's producer and independent
package check pass; bundling took 159.902512 seconds. The wrapper's final success
allowlist omitted `NSIS_ONLY_PASS`, so its actual terminal exit 1 is retained
separately from body exit 0, actual Job0 and package PASS. Guards were released
at 17:04:53.939 UTC, all six observed build PIDs are absent, and booking367 was
cancelled early. Apps and settings are unchanged. The new Code UI fix is absent
from this installer; its composed verification was booked for 17:30–17:50 UTC.
There has been no new model-backed walkthrough or capacity qualification.

The registered second peer timed out on the bounded reachability check and the
local fleet is unconfigured. Read-only strict-key/BatchMode SSH to
`ron@192.168.1.112` succeeded at 11:15:27 UTC as `AIS-1-2950X-L02`, UID1000
(`out/remaining-acceptance-20261009/oi069-windows-20261010/s2-online-readonly-20261010.json`).
That earlier query found only the GDM greeter and SSH sessions. A fresh read-only
query at 12:19:11 UTC now proves Ron's active X11 `:1` session, both tray
providers and Secret Service (`oi071/s2-logged-in-readonly-20261010.json`).
The accepted Manager/Host pair is now staged in a separate S2 child-XDG fixture;
the existing Host and its ordinary state remain intact. FIFO row 806 ran the
baseline Manager at 14:34:43–14:42:43 UTC. Native Check secure storage displayed
ready; Cancel dismissed the Pair dialog without pairing. The fixed timeout
ended it with code 124 and the exact Manager PID was absent afterward. Tray
Open/Exit remains unqualified because no safe icon target was available.
This screen created no Host, model or pairing grant; it does not qualify the
new tray lifecycle correction.
The accepted four-file archive and S2 Ubuntu 24.04.3/glibc 2.39/GTK/WebKit/Soup
prerequisites match (`oi071/s2-compatibility-package-proposal-20261010.json`).
Physical pool checks need designated available
paired hosts/clients. OI-075 now has an actual restored-Windows long-content
baseline; Linux native rendering remains unmeasured.

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
whole lifetime. No UAC, provider/dependency installation, original Server 2 state
changes, reduced profile controls or widened folder permissions. The authorized
S2 native tray/vault fixture uses its FIFO and leaves other owners' jobs intact.
Final Stop keeps the explicitly
authorized AUTO profile; restore normal apps and prove Engine absence before
guard release.

Frozen `7d9a8f689` passes actual production at 09:37:44 UTC and independent
package verification at 09:40 UTC. Retain its accepted artifacts and reuse
unchanged Rust/ConPTY evidence. Booking349 completes the integrated corrections
with a Manager embed build and NSIS-only bundle from `574d73df7`. Existing
compiled 7d9 GChat/Host/CLI, Engine and frontend payloads are reused with their
original producer provenance.
Evidence is in the existing OI-068
packet (`production-terminal-337.json`,
`production-9a4caa1c3-337/package-verification.json`). Booking 337 ended at
09:58:48 UTC with Engine/API0 and guard release. Booking 341 ended at
10:19:18.993484 UTC: keeper 3053354/start ticks 7297225 stopped, both guards
released and the booking cancelled. Installer controller 37548/body 42660
exited 1 at preflight, before any app stop or NSIS launch. Fresh absence proof
records Job0, Engine/API0 and unchanged baseline apps/settings
(`gchat-install-terminal-341.json`, `release-verified-341.json`). That attempt
did not pass an installed update. GPU/model/native compilation was excluded during
10:20–11:00 UTC. CPU-only booking346 used the actual cancelled342 gap and
closed at 10:44:12 UTC with its jobs and guards released.

Baseline apps were unexpectedly absent from the fresh pre-install owner query
before 10:03 UTC. GChat logs record ordinary exit requested at 09:58:54;
the reason and Manager's exit cause are unattributed. Stale owner identities
were rejected before installation. Supported baseline Start reopened GChat
21848/birth `2026-10-10T10:04:36.3895448Z` on debug port 9271 and Manager
7296/birth `2026-10-10T10:04:36.3985529Z` on 9272; Host 23052 retains its
original identity. `owners-for-install-341.json` records the fresh owners.
Supported pinned Rust POST scan and snapshot passed at 09:55:39 for Host
`4941572e-7ccf-48b7-a950-de8d4dd731c6`, with stopped instances, zero requests
and no downloads (`host-scan-installed-337.json`). C#/PowerShell helper aborts
remain unresolved; the supported Rust result does not claim a helper fix.

Ron fulfilled the bring-to-front request: native Manager Document visibility
passed at 10:10:41 (`manager-after-user-go-341.stdout`). Its tray still has no
clickable point; no agent tray click or forced app exit occurred. GChat 21848,
Manager 7296 and retained Host 23052 survived the booking341 attempt, with the
model stopped. Ron subsequently exited Manager before booking349 production.
Actual registration evidence proves a genuine same-path MSI record and exact
valid HKCU64 NSIS owner (`msi-precedence-registry-341.stdout`,
`nsis-owner-proof-341.stdout`). The MSI rejection was a real route conflict,
not an absent registration. Source `d6da84677`, integrated/pushed as
`1a9044e65`, selects the
validated current-user NSIS owner before the stock MSI scan, preserving the
coexisting MSI registration. Rust and Engine inputs are unchanged by that
template correction. Manager's historical-error display and retained diagnostic
reading state are corrected in integrated/pushed `c20217d22` and `574d73df7`.
Independent source reviews accept the exact original template/follow-up inputs.
Actual focused Manager Node checks pass 24/24 at 10:36:08 UTC
(`manager-ui-574d73df7-346.log`). Pure PowerShell preservation classifier
checks pass 10/10 at 10:44:11.6667562 UTC, with two zero-error AST parses
(`installer-preservation-component-346-explicit.json`). The first launch failed
before parsing or reads because default `Join-Path` evaluated an empty
`PSScriptRoot`; passing all five paths explicitly corrected that invocation.
These are component checks only: original booking341 body exit 1 remains FAIL,
and its receipts were not modified. Booking346's jobs/guards are released.
Those component results do not claim an installed replay.

Booking349's actual `PRODUCTION_PASS` at 11:26:00.6625612 UTC records Manager
producer `574d73df7`, reused binary producer `7d9a8f689`, body exit 0 and an empty
job after exact live-identity/current-job classification and teardown of VCTIP
40552. Settings/apps are unchanged; no model started and only retained Host
23052 appears in the post-build app receipt. Actual native evidence is
`/mnt/c/Users/Ron/AppData/Local/GChat/remaining-acceptance-20261010/native-574d73df7-349-production-refresh/native-test-result.json`;
the refreshed packet is `%LOCALAPPDATA%/GChat/remaining-acceptance-20261010/production-refresh-574d73df7-349`.
Independent package verification passes in
`production-refresh-574d73df7-349/package-verification.json`.

GChat R2 body and NSIS exit 0, with an empty job and unchanged protected state.
Its parent classifier incorrectly treated null empty-app output as a changed
app; the original FAIL remains in
`native-574d73df7-350-r2-installgchat/native-test-result.json`. Separate
`gchat-install-terminal-350-r2-adjudicated.json` proves the authorized exits
and preservation without an installer retry. Manager R3 actually passes at
11:43:08.6470828 UTC (`manager-install-terminal-350-r3.json`). Full installed
payload/thread/state verification passes at 11:45:47.178232 UTC
(`install-refresh-574d73df7-r2/installed-verification.json`); this does not
verify frontend loading. Actual Manager CDP at 11:46 shows
`http://tauri.localhost/`, stopped, zero active requests and no alerts
(`manager-installed-presentation-350.json`).

The user and root confirmed that the candidate GChat desktop opened a directory listing at
`file:///C:/Users/Ron/AppData/Local/GChat/windows-build/source/web-app/dist/`.
The saved production config's absolute Windows `frontendDist` parses as a
`C:` Url rather than a Directory, so frontend assets are not embedded. The
package/byte checks missed this ordinary installed UI failure. Exact desktop-only
restoration passes at 11:56:54.9219517 UTC
(`rollback-desktop-0f-20261010/restore-ui-verification.json`): source `0f06ba433`,
SHA `1761bdea…`, GChat 38164/birth `2026-10-10T11:56:51.7254124Z`. The old
42176 was already absent in the fresh scan; no forced exit or NSIS ran.
Actual `restored-ui.json` shows `http://tauri.localhost/`, title GChat, two root
children, all seven original saved threads and no alerts. All selected protected
state fields are identical before/after, including threads, models, settings,
profiles and certificates. Manager 24796/birth `2026-10-10T11:46:14.4288363Z`
and hash `1b9f0173…` are unchanged; 7d9 Host/CLI and 2ef Engine remain intact.
Engine/API counts are zero and guards are released.

### Historical October 10 desktop and terminal correction

The following preparation decisions and pending claims describe their original
execution stage. The current acceptance account above supersedes them.

CPU-only booking353, 15:05–15:15 UTC, compiled the corrected desktop: relative
`frontendDist` `../../../windows-build/source/web-app/dist` resolves to the exact
832 accepted assets as a Directory. Cargo passed from 15:07:07.607 to
15:11:35.887 UTC (4m28s). The independent 15:13 UTC deadline killed the owned
job with NSIS packaging incomplete, about 84 seconds after Cargo completion.
Overall native result remains `BOUNDED_ABORT`/exit 1. Job membership was empty;
fresh controller/body/helper absence passed at 15:13:44 UTC and the keeper
released at 15:14:21 UTC. Evidence: `production-terminal-353.json`,
`release-verified-353.json` and native
`%LOCALAPPDATA%/GChat/remaining-acceptance-20261010/native-574d73df7-353-frontend-directory/`
under the existing OI-068 packet. The preparation is retained in
`oi068-windows-20261010/production-frontend-directory-574d73df7-proposed/`.
Ron separately approved desktop-only UI and NSIS continuation; booking364's
embedded UI and NSIS367's later completion retain their independent scopes.
Manager, Host/CLI, Engine and saved-state evidence remain unchanged.

### Embedded terminal status ordering

At 16:25:45.643 UTC, native Code generation 1 reports Exited/code 1 immediately
after the visible Stop click. At 16:26:11.753 the UI still shows Stopping, a
disabled Stop and no Restart; the next native status remains Exited. Native
ancestry at 16:26:12 contains only WebView descendants, with the four prior
Code child PIDs absent. These are no-model observations. Exact files in
`out/remaining-acceptance-20261009/oi068-windows-20261010/desktop-ui-574d-364-proposed/`:
`18-after-stop-status-result.stdout`, `20-stop-settled-visible-result.stdout`,
`21-stop-settled-status-result.stdout` and `23-code-stopped-native.stdout`.
Normal restart passes at 16:31:17.227 UTC without force or another copy:
`%LOCALAPPDATA%/GChat/remaining-acceptance-20261010/desktop-ui-574d-364/restorenormal-result.json`.
Engine/API/debug-listener counts are zero; state and Manager/Host/Engine bytes
are preserved.

Source establishes an unguarded cross-transport overwrite: `terminal_stop`
captures Stopping under the session lock, drops PTY resources, and returns the
captured snapshot. The waiter can publish Exited before that invoke reply is
delivered; `useEmbeddedTerminal.updateStatus` accepted the older snapshot.
The saved observation does not trace Channel arrival order, so that scheduling
in the actual replay is inferred rather than independently measured.

The isolated candidate is `/ai/gchat-worktrees/terminal-stop-ui-574d`, branch
`fix/gchat-terminal-stop-ui`, baseline `88ba8b762` (only documentation differs
from exact product `574d73df7`). Its
[ordering decision](../decisions/2026-10-10-order-embedded-terminal-status.md)
uses the existing session sequence on locked snapshots and lifecycle events.
Successful Stop/shutdown transitions advance it; failed Windows termination
does not. Output/replay has a separate generation/sequence cursor, and disposed
Channel callbacks are ignored. Started, Exited and Error carry actual native
status, including current metadata, without phase ranking or guessed exit codes.
Frozen Windows/Linux sources and packages remain unchanged.

Prepared observable regressions cover both Stop/exit delivery orders, Restart
with fresh output after the spawn reply, duplicate replay, old-generation
attachment, failed live Stop with retry, native reader/waiter error status and
the shared Hermes surface. The existing real Windows denied-stop/retry test now
checks actual Tauri Stop/status IPC sequence and unchanged native ownership.
Independent source review accepts product `2684a6c70`; fixture tip `57507c234`
only wraps the existing navigation updates in async act. Root's final admitted
focused run passes 21/21 at 16:45:35 UTC without act warnings. Typecheck exits 0;
affected hook/type ESLint exits 0 at 16:46 (the current lint configuration ignores
tests). Preserve both `code-ui-stop-focused-2684.log`, with the original two act
warnings, and corrected `code-ui-stop-focused-5750.log`, plus
`code-ui-stop-typecheck-2684.log` and `code-ui-stop-lint-5750.log`, in the existing
OI-068 packet.

The reused booking365 container passes Linux all-target release/locked/offline
`test-tauri` check in 41.72 seconds and strict Clippy in 10.67 seconds. Its exact
container is removed at 16:49:39 UTC and the canonical build guard is reacquired
and released. `build-365-terminal-2684-proposed/output/focused-check-result.json`
records those source checks and their exclusions. Full web-suite evidence is
`code-ui-stop-web-suite-5750.log`: 227 files and 1,962 tests pass, five tests are
skipped, and unrelated act, DialogDescription and Shiki URL diagnostics remain
visible. This suite is not warning-free.

The composed Linux `make verify` gate passes on clean source `210d642ba`.
It includes 2,120 root/frontend tests (six skipped), 102 extension tests, all six
critical coverage floors and all six supported Rust suite commands: 553 desktop,
six GInfer plugin, 98 Host, 12 hardware and 29 utility tests pass; Manager's
current test target compiles but contains no tests. Seven desktop and three Host
cases remain ignored by their existing platform/fixture rules. Existing act,
DialogDescription and Shiki URL test diagnostics remain visible; the gate is
not warning-free. Its independent three-fixture cleanup patch is source-reviewed,
unapplied and untested.

Two runner setup failures are retained. The first omitted Yarn's extension-root
node_modules state; the corrected runner preflights and mounts that complete
aligned directory read-only. Docker's disabled network then prevented the real
shared-fleet test from choosing a nonloopback address. The final runner uses the
existing bridge for its local TLS fixture, retaining offline dependency controls
and the unchanged test. The actual final container exits 0, is removed at
17:39:49 UTC, and its original PID is absent. Root reacquires/releases both
canonical guards and cancels booking369 at 17:40. Evidence is the existing
OI-068 packet's `build-369-terminal-2684-r3/current-result.json`; the two earlier
setup results remain beside it. No model, app restart or dependency installation
was required.

The exact ten-leaf native `1ccde5715` source overlay is applied in booking374.
Actual Compile is bounded-aborted at 18:35:00 UTC before test execution: root
selected a deadline only 4 minutes 22 seconds after native body startup, while
the final Rust compiler starts at 18:31:08 and does not finish before it. This
is an execution-budget failure, not a demonstrated compiler or product defect.
The original result is retained in native
`pty-stop-code-210d-374-compile/native-test-result.json`; the same OI-068 packet's
`native-374-bounded-abort-observation.json`, `release-verified-374.json` and
`guard-return-374.json` prove controller terminal1, empty Job, pinned body exit,
owned native PIDs absent, Engine/API/debug0 and canonical guards free at
18:36:44 UTC. The keeper exits 0 and booking374 is returned early.
Apps and settings are unchanged; no Test, desktop build or install ran.

The successor is booking380, 22:20–22:50 UTC, CPU only, stopping by 22:49.
Ron subsequently chose Manager's existing `src-tauri/icons/icon.png` as the
shared GChat/Manager icon. GChat's Windows/Linux tray now loads that PNG
directly, and its Windows ICO producer uses the same source. Manager already
embeds that PNG and keeps its existing route. The icon is reused unchanged;
no new artwork or dependency is introduced. The previous and canonical PNGs
represent identical pixels; canonical generation may legitimately produce the
same ICO bytes. Direct PNG tray loading and one source authority are the change.
Source review is independent of the retained terminal checks. Before execution, the380 packet must bind the
reviewed new source and two-file native overlay and generate its canonical ICO
in the admitted slot. The historical1cc/374 application remains unchanged;
the earlier380 proposal cannot be executed with stale source bindings.
Ron’s current rule33 limits this run to the four changed Windows terminal cases,
the necessary desktop build and the installed Stop/Restart replay. Reuse the
passing Linux evidence; no full suite or unchanged passing check is rerun.
Root and independent source review accept the revised icon packet; the
previously accepted380 lifetime is retained. The packet is indexed by
[`code-380-preparation.json`](/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/code-380-preparation.json)
(SHA `565a2748dc557331669031196691e9f97bd1f89b33cf11be5346a229c51b7925`)
and its existing [activation commands](/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/code-380-activation-commands.txt).
The [source review](/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/code-380-icon-source-review.json)
records the corrected icon preflight and resource checks. The subsequent admitted native results are recorded in the current account
above; the original preparation files remain historical evidence.
The380 packet now binds committed `3aff66d62` product source with exactly two
reviewed icon leaves over retained native `1ccde5715`. Historical booking374
APPLIED receipt remains preserved (`db4fcdd00ac531bde866174b32e31771bedc619f40437309133f1629f8336579`);
later documentation is separate and is not copied into the native mirror.
No old ten-file overlay is reapplied; the admitted380 helper applies only the
two icon leaves, then the owned Compile Job generates a fresh canonical ICO
using existing Python/Pillow. Only the candidate ICO is exempted from the
historical resource digest loop; Test/Desktop consume its fresh canonical
receipt, while every other accepted resource check remains intact.
Byte-identical ICO output is valid; actual canonical producer invocation is
required. The historical ICO remains preserved in the
accepted compiler cache. Actual canonical generation, four IPC cases and desktop production pass;
installed replay remains unrun.
The actual [374 retirement proof](/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/root-retirement-374.json)
(`d7157ed9a82ec3e7181930dbd51fafbb0a41e998fedaad8c0229dd80629b0e58`)
and raw failure remain required historical inputs. Compile admission requires
at least **600 seconds remaining immediately before Cargo**, with a 900-second
phase maximum; cached four-case execution retains its 300-second maximum.
The copied NativeJob classes and complete cleanup tails are byte-identical to374.
Desktop commands end by22:45, native cleanup by22:46, root terminal proof
by22:47, and visible replay plus ordinary-app recovery by22:49. Fresh380
keepers, exact source/input checks, real four IPC passes and external controller
terminal0 are prerequisites; no Windows execution or producer/UI pass is claimed.
The combined30-minute budget remains uncertain: late compilation/checks defer
remaining desktop/UI work without weakening gates, changing Release/LTO or
replacing retained production resources.

It retains the applied source and composed gate, preserves the failed attempt,
uses fresh output paths and gives Compile at least ten minutes. Four actual
Windows ConPTY IPC cases, updated desktop build and visible Stop/Restart replay
remain required; execution is not admitted outside that slot. Current installed
`574d73df7` still retains the actual UI FAIL above. The accepted earlier NSIS
packet contains that source, not the new correction. Source verification does
not replace the installed replay or establish the recorded Channel arrival
order. Required Windows command, after root admission:

```sh
cargo test --release --no-default-features --features test-tauri --lib core::terminal::tests::windows_terminal_ --no-run
cargo test --release --no-default-features --features test-tauri --lib core::terminal::tests::windows_terminal_ -- --test-threads=1 --nocapture
```

Reuse canonical dependency/build caches and the accepted Windows ICO prerequisite;
do not create another installer or model fixture. Acceptance is native Exited
matching visible Exited/Restart for the same generation, a supported restart
with output, truthful failed-stop Running/error/retry, preserved histories and
no inference. Until those checks pass, this is a prepared source correction.

Installer review found an obsolete pre-uninstall macro that stops helpers by
shared executable names and uses a PowerShell policy bypass. No live uninstall
or unrelated-process loss was observed. Source `7d9a8f689` removes that macro;
the optional post-uninstall data block is byte-identical. Independent review
accepts the cached NSIS template's conditional macro insertion and unchanged
Rust/ConPTY inputs. GCHAT-UNINSTALL-PROCESS-SCOPE is on the master list.

Use the supported NSIS `/S /UPDATE` path to skip the installed old NSIS
uninstaller. Verify the freshly generated script's `currentUser` and
`RequestExecutionLevel user` behavior and validated current-user NSIS precedence
before the WiX/MSI scan; do not invoke MSI migration or alter its registration.
Require no running current-user `gchat.exe` before launch to avoid the template's
name-based fallback. No `/R`, elevation or policy bypass. Close the verified
clients gracefully and stop only the exact idle Host handle after successful
scan/persistence flush, stopped instances and no active downloads. Verify
installed payloads and full original-thread byte preservation before acceptance.
The 7d9 package is retained prior producer evidence. Booking-341 installer copies
are consumed preflight evidence; booking350's transaction and full byte/state
checks pass at the scope above, while GChat frontend repair remains pending.
Do not reuse consumed copies as current admitted installers.

Ron explicitly authorized **Use and keep AUTO** on the existing Muse instance.
After package/install preservation of the original profile is verified, select
the existing `rtx5090-muse-nvfp4-dflash-nvfp4-tp1-c4-128k-nvfp4-windows-automatic-current`
profile through supported Host controls using the fresh current session lock.
Keep C4/131072, NVFP4 KV, the existing headroom, sampling and saved-agent budgets;
only the arena policy becomes automatic. Before model-backed acceptance, verify
the same selected instance/session is Ready with `configuration.max_context`
and Engine-reported `model_metadata.max_model_len` both at least 65536. This
authorizes functional replay, not physical 131K qualification or an execution
PASS. Final supported Stop keeps AUTO saved. The earlier AUTO-to-fixed reload
restoration template remains withdrawn: do not launch the known failing fixed
profile or write private Host state. The existing `hermes-route-plan.json`
records the authorized actions pending preservation and Ready verification.
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
were still pending at that gate; the current production/package result is above.
The master list owns the corresponding native lint defects.

Booking331 ended at 08:08:44.295 UTC: fresh native inspection proved all 14
owned controller/body identities absent, Engine0 and API0 before canonical
build/GPU guard release. Booking331 is cancelled; installed apps/settings
remain unchanged. Actual receipts: `9a-checkclippy-root-terminal-331.json`,
`final-native-absence-331.json` and `release-verified-331.json`. Production
completed under booking337 using the accepted source gates. Original331
source-application provenance remains separate from production337, ended
installer341 and future admission/guard ownership.

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

Owned inventory: the candidate tree is
`/ai/gchat-worktrees/remaining-acceptance-bd4`; accepted prior package source is
`7d9a8f689`, with Rust checks at `9a4caa1c3`. Template/Manager corrections are
integrated through `574d73df7`; booking349's Manager embed and NSIS-only bundle
refresh passes at 11:26:00.6625612 UTC, with body exit 0 and an empty job.
Booking341 and CPU-only booking346 are closed with jobs/guards released.
Retain the existing native extraction and shared Windows target cache at
`%LOCALAPPDATA%/GChat/remaining-acceptance-20261010/source` and
`%LOCALAPPDATA%/GChat/windows-build/source/src-tauri/target` for the next
desktop correction/rebuild; no model copy was allocated.
Prepared scripts, delta, verifiers and exact command inventory are indexed
in `/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/native-ccc9ab250-preparation.json`.
The 7d9 and refreshed349 production/package fields pass. Booking350 retains
original R2 classifier FAIL, separate adjudication, actual Manager R3 PASS and
full installed byte/state PASS. The candidate GChat frontend failed to load;
exact baseline desktop-only restoration and ordinary UI now pass. Relative
Directory correction desktop compilation passes in booking353; candidate UI
acceptance and separate NSIS packaging remain pending.
Retain the native `production-refresh-574d73df7-349` packet and
`native-574d73df7-349-production-refresh/native-test-result.json` for those next
steps. Consumed 37aa/333 artifacts are retained evidence, not current passing gates.

The refreshed package reuses the accepted 7d9 compiled GChat/Host/CLI and exact
Engine/frontend closure. Only the Manager embed and NSIS bundle regenerated; do not
relabel reused compiled payloads as newly compiled from `574d73df7`. Retain
package/component/state proof separately from the failed ordinary GChat UI and
completed corrected desktop compilation and pending UI/separate NSIS acceptance.

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
evidence does not supersede those packages. The WSLg desktop lacks the required
providers, but the fresh 12:19:11 UTC read-only S2 query proves Ron's active X11
`:1`, an X11 tray owner, StatusNotifierWatcher and Secret Service. Evidence is
`out/remaining-acceptance-20261009/oi071/s2-logged-in-readonly-20261010.json`.
The accepted Manager/Host pair is now staged in the isolated S2 fixture.
FIFO806's actual baseline Manager screen passes native secure-storage readiness;
its timeout124 and exact PID absence are recorded in
`oi071/s2-row806-native-storage-tray-20261010.json`. No Host or grant was created,
and tray Open/Exit remains unqualified. The corrected Linux Manager check,
strict Clippy and build are approved for CPU-only 16:35–16:55 UTC; its actual
lifecycle and pairing checks remain next.
On that desktop, use the actual Manager/Host pair, pair through the native vault,
restart Manager and restore the saved grant, then use Show/Hide and Exit tray
actions while checking that the same Host remains alive. No provider install or
original deployment/credential change was attempted; only the readiness probe's
temporary native-vault set/read/delete was exercised.

## Current OI-073 app public deletion: gate accepted

Repository `/ai/gchat`; subject `docs/agent-runtime/`; candidate
`/ai/gchat-worktrees/gbench-delete-bd4`, branch `fix/gchat-gbench-delete-bd4`.
Product `c6fcfe34f` is composed with main `3bccdb243` as `3a4ca23af`; route-only
fixture correction `35e8e8882` supplies main's `hardwareProfileBusy` mock.
Connector/model commands and the new deletion command are preserved together;
the owning IPC fixture includes ten formerly omitted main commands.
Next: coordinator main merge, then retire this clean owned tree after verifying
that merge. No release, signing, installer publication or Windows refresh.

Bubbs/Ron's October 11 07:27:35 UTC decision authorized focused cases and one
new labelled disposable submit/delete against the app's existing community API
`https://sectilelabs.ai/gbench/api/v1`. No alternate deployed test endpoint was
recorded. The app used its existing community signing and only the disposable's
saved deletion receipt. No official credentials, site/DB/cPanel access, inference,
calibration or native Windows build/run was used.

Published results restore from ownership receipts even after local-history
removal. The new Remove button confirms the exact ID, calls native
`delete_benchmark` and keeps local history and other receipts. Only confirmed
public success clears that receipt; failed/lost responses retain ownership.
A local persistence failure reports public success with local cleanup pending.
The existing site accepts a valid receipt after deletion for explicit cleanup
retry; no live retry or fault injection was included in this gate.

Eleven focused frontend cases and both native local-HTTP/validation cases pass,
with changed-source lint, strict native Clippy and the fresh frontend's typecheck.
Frontend production passes in13.95s; native desktop production passes in2m59s.
The 48,986,656-byte candidate35e desktop embeds the fresh assets and reuses only
the accepted54c931c68/02d369e8a package's resource closure. This does not qualify
current Host/Engine, model/GPU behavior or native Windows.

One actual Linux/WSLg WebKit2.52.6 candidate window is visible and focused with
its native bridge. Private XDG/config/data, an executable private CLI and an
exact provider locator at17443 preserve HOME and original user state; both
model/API startup flags and LAN discovery are off for the gate. The generated
local result copies the designated measured Standard evidence without an
inference rerun. Its complete actual UI submission preview equals that original
public projection with only the new ID and nickname changed.

The ordinary Submit button publishes `oi073-app-delete-20261011-01`, nickname
`Disposable App Delete Test`, once at07:59:58 UTC. GET200 returns the exact
reviewed payload with `official:false`. The new Remove button opens the exact-ID
confirmation; its single confirmation finishes at08:01:05 UTC. Native success
clears that receipt, keeps identical local history and preserves the unrelated
pending receipt. GET404 confirms removal; complete canonical records for all
12 official series and36 points remain identical. Zero public retries ran.
The final native observation confirms the dialog and target control are absent.

Evidence under `out/remaining-acceptance-20261009/oi073/app-delete-20261011/`:
`result.json`, `frontend-gate-result.json`, native logs,
`desktop-producer-result.json`, `ui-preview-comparison.json`,
`ui-submit-result.json`, `public-test-readback.json`, `ui-delete-result.json`,
`ui-final-state-result.json` and `public-after-comparison.json`.
The initial route mock failure and producer admission stops remain separately
recorded: cached fingerprint ownership, read-only TypeScript temporary output,
missing cached `/work` alias and missing source-local license. The corrected
producer uses the accepted root/cache aliases and verifies every declared
resource before compilation; no passing frontend/native cell is repeated.
The inspector preparation needed the existing HTTP transport variable and the
actual benchmark route; the input selector now checks its effective type.
A100ms observation still saw the closing dialog's exit animation; the final
observation proves normal closure without another deletion or source change.

Owned inventory: this committed source, accepted candidate desktop/resource
closure and concise evidence are retained pending merge; the original DEB and
shared build/dependency caches are unchanged. All owned app/Host/child processes
are absent and the canonical build guard is reacquired/released by08:03 UTC;
CPU452/453 are cancelled at actual return. The isolated fixture is deleted after
absence, reclaiming13,254,656 allocated bytes and retaining no ownership token.
`ui-process-return.json` and `ui-fixture-retirement.json` record cleanup.

## Accepted October 10 community publication

OI-073 now uses the existing installed public client and the board's public
GET/DELETE endpoints. Ron's October 10 12:09 decision allows the app-stored
receipt for this one row only; no MySQL, cPanel, additional credentials or new
app deletion implementation is permitted in this check. If DELETE fails, stop
and leave the labelled row, reporting its exact ID for Ron's manual removal.
The missing public deletion control in GChat is a separate master issue; the
local benchmark trash button removes only local history.

Read-only installed benchmark metadata finds three measured Standard results.
Root selects `9752b311-6224-4c48-95f9-555ccaf7292d`, preserving its original
C1/C4 configurations and warmup/measured counters. The sole disposable copy is
`oi073-disposable-20261010-ron1000z-01`, nickname **Disposable Test Only**.
Original runs and all 12 official reference series / 36 points remain protected.
Public preflight confirms those 12 series and GET404 for the disposable ID.
Evidence is in `out/remaining-acceptance-20261009/oi073/`:
`installed-standard-metadata.json`, `selected-standard-evidence.json`,
`board-before.json` and `disposable-before.json`. The sole local copy was created
at 12:14:50.975Z (`disposable-local-copy.json`). One actual installed-UI submission
failed: Ron's PHP log records undefined `engine_columns()` at server time
12:16:14Z, only on POST submission, before INSERT; throwable handling returned
503 and rolled back. This establishes partial site deployment as the cause.
Original client bounds are separately 12:16:16.796672–12:16:45Z; clock agreement
is not established and the original request/challenge ID was not exposed.

`local-contract-diagnosis.json` validates the exact failed payload with PHP
8.5.4: PASS, 37-byte ASCII run ID, nullable engine columns both null, and all 12
accepted September 17 fleet payload scores matching. This local contract check
does not prove the deployed site is corrected. GET404 at 12:17:56.759Z proves
no disposable public row (`installed-publish-failure.json`); no delete receipt
exists. `official-preservation-after-failure.json` at 12:27:44.133Z verifies all
12 official series/36 points exactly unchanged.

Ron uploaded the matching contract and checked the migration. Bubbs's explicit
12:33:30Z GO allows one installed submit/read/delete attempt. All three pass:

| Observed action | Result and evidence |
| --- | --- |
| Installed app submission, 12:35:11.408Z | PASS, app receipt saved; `go-installed-submit-result.json` |
| Public readback, 12:35:40.129Z | GET200, exact **Disposable Test Only** payload, community flag, 12 official series/36 points unchanged; `go-public-readback-result.json` |
| Receipt deletion, 12:35:58.297Z | DELETE200 using only this ID's app-stored receipt; `go-public-delete-result.json` |
| Public absence, 12:36:34.126Z | GET404, board returns to 12 exact unchanged official rows; `go-deletion-verification.json` |

The app's local trash removes only the disposable copy at 12:36:57.519Z;
its test ownership entry is then removed. The three original runs and all
other ownership entries remain unchanged (`go-local-cleanup-result.json`,
`original-local-runs-preservation.json`). No receipt or signing secret appears
in public evidence. `accepted-one-attempt-result.json` owns the accepted scope.
Retry/idempotency, concurrent submissions, conflicting-payload preservation and
fault injection are unrun under the one-attempt restriction; this result does
not qualify them. The missing public Delete control remains a separate open
issue: this check used the approved existing endpoint with the app's receipt.

Reuse the existing source signature/ownership/contract checks. Updater release
signing/publication (OI-110) is a separate decision. No new inference or official
reference import is needed for this measured result copy.

## Current OI-075 Linux rendering observation

Linux render/traversal and post-install native idle observations are complete.
C2's actual new native-v2 runner output is the next unresolved input; the passing
render/traversal checks and accepted package were reused without rebuilding.

The October 14 Linux-only rendering coverage is complete for a generated 120-message
conversation on Linux/WSLg WebKitGTK 2.52.6. The accepted October 14 package
(7e33222e8) was reused without rebuilding. Ten repetitions of the earlier
content-free twelve-message shape produced 1,037,320 JSONL bytes and 120 tool
parts, with no original conversation content or attachments. No model ran.

At 1200×800/DPR1, the first sidebar open reached all 120 wrappers and another
frame in 301 ms. Settled programmatic traversal took 1,003 ms over 73 steps;
frame gaps were median 16 ms, p95 17 ms and maximum 36 ms. The scroll height
changed during traversal, so the final bottom was resolved from current geometry.
This measures wrapper observation and programmatic traversal, not GPU-present
or native wheel/input latency. Cache state is unknown.

A passive 30-second foreground DOM observation retained the route,
viewport, collapsed states and all 120 wrappers, with no running DOM animations.
The complete endpoint-observed descendant group was stable: GChat,
WebKitNetworkProcess and WebKitWebProcess. Total CPU was 100.1123% of one logical
core: GChat 99.8457%, WebKit Web 0.26661%, Network 0%. Private resident bytes
were 419,319,808→418,545,664; PSS 530,434,048→529,660,928. These are endpoint
resident counters, not private commit or peak memory. WebKit long-task support
is unavailable, not zero. Native installation had not completed, so these counters do not establish
native idle. A follow-up located finite bundled-resource verification/copying;
after installation completed in 82 seconds, desktop threads used 0–0.4% of one
core (six five-second samples, mean 0.2%). That empty-history follow-up excludes
separate Host/Gbot services and does not repeat this many-message workload.
Correction: `/ai/gchat/out/native-idle-20261014/result.json`. Raw evidence remains
unchanged; no rendering cause, cross-OS comparison or gain is claimed. Future
native idle observations must wait for installation completion.

The missing many-message idle observation completed at 17:51:18Z after bundled
installation finished at 17:46:07Z (about 85 seconds after launch). This fresh
generated 120-message fixture contains 1,041,550 JSONL bytes, so it is not a
byte-matched comparison with the earlier render/traversal fixture. The 30-second
foreground observation retained its route, all 120 wrappers, viewport and
collapsed states. All five endpoint-observed descendant identities remained
stable and their native counters were complete: GChat 1.0664%, WebKit Web
0.9998%, Network 0.0333%, Gbot 0.0333% and Host 0.1000%, totalling 2.2328% of
one logical core. PSS was 666,037,248→658,471,936 bytes; private resident bytes
497,082,368→489,517,056. These are endpoint resident counters, not private
commit or peaks; helpers that started and ended between endpoints are excluded.
Passive observer overhead is unmeasured and WebKit long-task support is
unavailable. No idle-loop defect or performance gain is established.

Earlier capture failures were observer issues: window focus, cached scroll-height
assumptions and a final JavaScript scope reference. Native focus, per-frame
bottom resolution and a validated final expression corrected them before the
successful capture. Those failed attempts are not product qualification.
The final idle capture also corrected a twelve-message fixture/count mismatch
and an inspector selector that excluded the selected conversation's URL path.

Owner GChat; source candidate `/ai/gchat-worktrees/oi075-linux-many-20261014`
(branch `docs/oi075-linux-many-e971`). Evidence and retained existing tools:
`/ai/gchat/out/oi075-linux-many-20261014/result.json` and `native-idle.json`.
The final idle evidence is `settled-idle/result.json` and
`settled-idle/native-idle.json` in the same folder. All five final owned process
identities are absent; its private vault entry and package/data fixture were
removed, freeing 5,031,550,976 allocated bytes, and CPU booking 661 cancelled.
The earlier fixture was also retired (booking 659). Accepted installers remain retained.
No GPU, original-history, Windows, S2 or cross-OS qualification is implied.
Broader Windows coverage remains owed to the release walkthrough. Next action:
consume C2's actual native-v2 report when available; otherwise take an actionable
non-release row. The premature native idle attribution is closed with the
installation evidence above.

The worker fixture fix is now merged in `25ac2cdb2`; its clean candidate was
retired, reclaiming 282,525,696 bytes while preserving results and shared assets.
The existing Rust test preparation `bab6541bf` still awaits incorporation in
main. The remaining benchmark check needs C2's exact new runner revision and
saved real report; the older C1 parser fixture does not cover that integration.

The earlier generated twelve-message observation remains historical evidence at
`/ai/gchat/out/remaining-acceptance-20261009/oi075/linux-shaped-20261011/result.json`:
open 110 ms, traversal 113 ms, partial counters because image helpers ended.
It is not a matched performance comparison with this larger workload.

## Accepted Windows native idle observation

OI-075's actual October 10 12:02 Windows baseline uses restored desktop
`0f06ba433`, Manager `574d73df7` and existing thread
`68ae631c-0d2a-4ba3-b8d9-f359d5e1c6db`: 12 messages, 107,089 JSONL bytes,
101,857 content bytes and a largest message of 79,574 bytes. Evidence is
`out/remaining-acceptance-20261009/oi075/actual-20261010-1202/result.json`
and `native-idle.json`. First observed open reaches all 12 wrappers in 89.2 ms
(cache state unknown; not a GPU-present timestamp). Opening contains one 53-ms
long task at a phase-relative offset of 36 ms. The executed harness reports
`task.start_ms = entry.startTime - phase.start`; absolute task bounds are
307,292.3–307,345.3 ms, within the phase at 307,256.3–307,355.2 ms. The prior
historical-buffered exclusion misread that offset and is invalidated in
`long-task-scope-correction.json`. The observer disables buffering and filters
entries to the phase; raw receipts remain unchanged. Derived reports name the
time basis and use `start_offset_ms` to prevent the same mistake.
Settled programmatic traversal takes 79.8 ms, with five frame gaps averaging
16.68 ms, maximum 16.7 ms; this does not measure native wheel/input latency.

The 30.088-second foreground idle sample has continuous animation-frame sampling
disabled, stable identities for all 15 processes and no Engine. Its descendant
group counters are:

| Installed process group | Processes | CPU, percent of one logical core | Private commit, MiB |
| --- | ---: | ---: | ---: |
| GChat, root 38164 | 7 | 1.713706 | 354.83 |
| Manager, root 24796 | 7 | 0.207722 | 223.13 |
| Host, root 6788 | 1 | 0.103861 | 6.59 |

Private bytes are commit, not resident physical RAM; passive/debug observer
overhead is unmeasured. This qualifies the observed Windows long-content
baseline only, with no performance-gain, many-message scaling or polling
attribution claim. Generated Linux open/traversal coverage is now recorded above;
matched cross-OS idle coverage is not established. Never copy the user's history
for Linux qualification; generate its content-free shape and record the actual
build/window/workload. No numerical performance floor or conversation cap is set. The
older unselected-view idle observation remains historical in `idle-sample.json`.

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

October 11's bounded audit of main `d9b802e4c` finds no attributable warning
trigger in those records. The thread completion handler requires a length
finish with `context_capacity` (or usage-based fallback), while request
preparation and error classification handle structured/raw context failures.
The recorded agent `max_steps` is a separate outcome and cannot by itself
enter the completion warning branch. The later `stop_token` continuation does
not enter it either. SDK ModelMessage schema rejection is distinct from context
admission; the accepted delegated-result fix omits absent JSON fields.

Owning paths are `web-app/src/routes/threads/$threadId.tsx:257`,
`web-app/src/lib/smart-context.ts:895`, `web-app/src/utils/error.ts:19,74`,
`web-app/src/lib/agent-run-message.ts:31` and
`web-app/src/lib/execute-chat-capability.ts:114`. This separates possible error
sources; it does not establish which emitted the lost October 1 warning.
That audit made no implementation, test, model run or capacity change and did
not establish the original cause.

The subsequent October 11 decision adds diagnostics, not a speculative fix.
Candidate `6a9fd25e0` emits `chat_warning` records through the existing native
`data/logs/app.log` target for model setup, message conversion, stream failures
and completion warnings. Records identify the triggering branch, model/provider,
conversion/schema decision, message/tool counts and available current-request
capacity, input, output and reserve counts. Completion records include the
actual capacity used for the existing comparison; loaded capacity and reserve
are null when unavailable there. Earlier request metadata is never used to fill
missing diagnostic counts. Structured context errors retain their numeric
budget details. The added record excludes prompt/tool contents, error causes and
arbitrary error messages; known static SDK format messages remain distinguishable.

One focused real transport/SDK fixture passes 1/1 on `6a9fd25e0`, including
unchanged returned errors and completion predicates, unavailable fresh counts
after a counted request, and sensitive-value omission. Its final log is
`/ai/gchat/out/oi076-warning-diagnostics-20261011/fixture-owner-hook.log`.
The first IPC spy and the SDK formatter's duplicate invocation were corrected
before that pass; the existing console reporting and warning behavior remain
unchanged. No model run or installed occurrence was exercised. OI-076 now reads
diagnostics in place on the candidate, waiting for the next occurrence after
merge. Preserve its app.log record and the matching conversation on recurrence;
the October 1 cause remains unknown.

## Owned inventory and execution

| Owner / exact path | Purpose and retention |
| --- | --- |
| Remaining acceptance `/ai/gchat-worktrees/remaining-acceptance`, branch `dev/gchat-remaining-acceptance-104d4ec6` | Owned tree retired after remote/tip/live-use checks; branch and concise evidence retained. |
| Coordinator `/ai/gchat-worktrees/remediation-integration`, branch `dev/gchat-remediation-104d4ec6` | Retired after published source and live-use checks; external evidence and branches retained in the integration authority. |
| Windows acceptance `/ai/gchat-worktrees/terminal-stop-ui-574d`, branch `fix/gchat-terminal-stop-ui` | Native historical base `1ccde5715` plus actual two-leaf product overlay `3aff66d62`; checked source `210d642ba`. Stop source is accepted after actual392 replay and pending normal merge. Reconnect is a separate next item; retain source and concise374/380/391/392 evidence. |
| Windows acceptance `/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/`, native `C:\Users\Ron\AppData\Local\GChat\remaining-acceptance-20261010/` | Actual r3 Compile/Test PASS and desktop-r4 PASS/proof retained with fresh22MiB frontend and37MiB exact developer executable for the accepted installed Stop screen and upcoming reconnect correction. Original failed attempts, catalog diagnosis/restoration and reviewed r2/r3/r4 controls are concise retained evidence. `root-retirement-380.json` proves Jobs/PIDs/guards returned; no owned jobs remain. 391/392 refresh/recovery scripts completed; both saved startup flags remain false. Two same-byte392 backups can retire after recovery; original accepted build remains available. Keep accepted353/367/574d/7d9 artifacts and shared caches; no rebuild is needed. |
| `/ai/gchat-worktrees/remaining-acceptance-bd4`, branch `fix/gchat-remaining-acceptance-bd4` | Integrated implementation through `574d73df7`; this record owns current runtime acceptance. Retain source and reused build caches. |
| Retired `/ai/gchat-worktrees/current-user-nsis-7d9` and `/ai/gchat-worktrees/manager-stopped-error-7d9` | Removed after integrated-patch, clean/upstream and live-use checks. Published branches and acceptance evidence remain; 551,276,544 allocated file bytes released. Current candidates, packages and shared caches retained. |
| `/ai/gchat/out/remaining-acceptance-20261009/`, including `oi068-windows-20261010/production-9a4caa1c3-337/` and native `%LOCALAPPDATA%/GChat/remaining-acceptance-20261010/` | Retain prior 7d9 and refreshed349 production/package evidence, booking350 original R2 FAIL/adjudication, Manager R3/installed byte-state receipts, consumed booking341 evidence and Office fixture. Preserve exact rollback desktop, actual restoration/UI PASS and failed frontend production evidence; booking353 compiled desktop PASS, partial NSIS `BOUNDED_ABORT` and terminal/release receipts remain retained in `native-574d73df7-353-frontend-directory`. Candidate desktop UI 16:20–16:35 and separate NSIS 16:55–17:20 remain pending. No disk-cleanliness claim. |
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
