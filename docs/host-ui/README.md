# GInfer host UI

## Attachment field labels — C4

`GUI-SETTINGS-CONTROL-LABELS` also affected attachment numeric fields: their
visible translated titles were not passed to the shared input controls. This
caller fix passes each existing title through C6's `DynamicControllerSetting`
API, giving the fields accessible names without changing values, validation or
persistence. C6's frozen shared-control change `c6292eeee` merges without
conflicts; shared controls and provider behavior remain C6-owned.

Acceptance: a rendered page finds fields by their visible translated names,
edits the named file limit and verifies its persisted value after navigation;
existing attachment durability checks and full `make verify` must also pass.
Source is ready, with tests and builds unrun during C3's TIMING hold. Next:
coordinator verification after the explicit timing return.

Owned source: `/ai/gchat-worktrees/c4-settings-attachment-labels-20261017`,
branch `fix/c4-settings-attachment-labels-20261017`, from attachment durability
`16b71ec23`. Evidence belongs to
`/ai/gchat/out/c4-settings-sweep-20261017/`. No runtime or build resource is
held, and the unavailable-embeddings finding remains a separate branch.
## Available attachment settings — C4

`GUI-SETTINGS-UNAVAILABLE-EMBEDDINGS` was observed in the native Linux
walkthrough: Settings offered document-search ingestion and retrieval controls
although GInfer embeddings are feature-disabled. The page now offers Automatic,
Include document text and Ask me each time, explains their unavailable search
fallback, and hides the inactive retrieval, chunk and search controls. A saved
embeddings choice is displayed as unavailable and kept until explicitly changed;
hidden settings and supported attachment behavior remain intact. No backend or
shared control-label change belongs to this branch.

Acceptance: rendered checks for available choices/help, saved-mode recovery,
preserved hidden preferences, navigation durability and visible numeric bounds,
then full `make verify`. The candidate includes current main and the accepted
attachment-durability fix. Next: focused and full verification after the
sidebar gate, then the final private native replay.

Owned source: `/ai/gchat-worktrees/c4-settings-attachment-availability-20261017`,
branch `fix/c4-settings-attachment-availability-20261017`. The original evidence is retained in
`/ai/gchat/out/c4-settings-sweep-20261017/{attachment-parse-options.json,settings-attachment-unsupported-mode.png}`.
No new build, runtime, model or fixture resource is allocated.

## Attachment edits survive navigation — C4

`GUI-SETTINGS-ATTACHMENT-EDIT-LOSS` was reproduced in the current native Linux
Settings walkthrough: changing the file limit from 20 to 21, leaving within
100 ms and reopening after 600 ms restores 20. The page discarded its pending
500 ms write on unmount. Independent extension updates also read and replace
the same settings document, allowing concurrent writes to lose another edit.

The candidate flushes pending numeric edits together when leaving, retains the
typing debounce and existing validation, and serializes extension reads/writes
so reopening waits for persistence. Acceptance: rendered regressions using real
extension persistence for debounce, quick navigation, delayed reads, concurrent
controls, validation and retry after a failed write; one full `make verify`.
No model, Engine, provider request or real user-data operation is in scope.

Source: `/ai/gchat-worktrees/c4-attachment-edit-durability-20261017`, branch
`fix/c4-attachment-edit-durability-20261017`, base `0099e0a1d`. The route, hook and
dedicated tests are ready for verification. Results and the original native
screenshots belong to `/ai/gchat/out/c4-settings-sweep-20261017/`; the reproduced
loss is in `attachments-quick-navigation.json`. The private S1 cache at
`/media/ron/SSD_RAID/ai/tmp-c4-settings-sweep-20261017/` is retained for this gate;
no build is running. Next: focused tests and full verification after C3's GMUL
timing return, then merge-ready. Provider labels are owned separately by C6,
provider keyboard navigation by C7; unsupported attachment choices and sidebar
density remain separate findings in Gchat3's shared GUI list.
## Provider field labels — C6

`GUI-SETTINGS-CONTROL-LABELS` gives provider API Key and Base URL inputs
accessible names from their existing visible setting titles. Password reveal,
hide and copy actions identify their field and cannot submit an enclosing form.
Passwords stay masked initially; setting values, editing, clipboard contents and
numeric adjustment semantics remain unchanged.

Acceptance: rendered regressions for named fields, password actions, form safety
and existing numeric behavior, followed by one `make verify`; push the isolated
branch merge-ready. Installed confirmation belongs to Gchat3's GUI acceptance.
No Engine, GPU, model, provider request or real user-data operation is required.

Source: `/ai/gchat-worktrees/c6-provider-control-labels-20261017`, branch
`fix/c6-provider-control-labels-20261017`, from main `513f2ab30`. C6 owns the
shared `dynamicControllerSetting/index.tsx` and `InputControl.tsx`, the dedicated
`index.test.tsx` and the provider caller's title prop. C4 retains attachment
routes and their labels; C7 retains SettingsMenu. Plan/results live here;
concise results will be retained in
`/ai/gchat/out/c6-provider-control-labels-20261017/{result.json,summary.md}`.

Implementation `c6292eeee` passes all four rendered regressions. Required
verification completed on October17: 2,966 frontend tests, 119 extension tests,
59 Node contracts and 1,079 Rust tests passed; six frontend tests were skipped
and 27 Rust tests ignored. Types, quality checks and all six coverage floors
passed. Lint retains three existing warnings and no errors.

The initial `make verify` exited2 because its private offline container lacked
a non-loopback route: the shared-address Rust fixture reported
`NetworkUnreachable` at `worker_pools.rs:887`; the other 721 library cases passed.
Using a private Docker bridge, that one failed case and the five unrun Rust
commands passed, exit0 at16:03:54Z. Passed gates were retained; no product source
or dependency changes were required. Future verification containers need this
private route for the fixture. S1 CPU72–79 nice10 returned16:04Z.

Concise results are retained at the path above. The private verification copy
is retired after retaining the result; the read-only donor remains untouched.
Next: coordinator merge and ordinary installed associated-label/navigation
confirmation. W3 local-path validation still uses Gchat3's sole Installed Load
packet, without a separate Load.

`fix/c4-attachment-edit-durability-20261017`, integrated source `1788ee4336`.
All six focused persistence regressions and one full `make verify` pass:
2,971 frontend tests, 119 extension tests, 1,079 Rust tests and 59 Node
contracts. Six frontend tests were skipped and 27 Rust tests ignored; lint,
types, quality checks and all six critical coverage floors passed. Lint retains
four warnings, including the existing attachment `sel` dependency warning.

Results and the original native screenshots belong to
`/ai/gchat/out/c4-settings-sweep-20261017/`; the reproduced loss is in
`attachments-quick-navigation.json`, and passing commands are linked from
`attachment-fix/result.json`. Retained source permissions were repaired before
tests began. A stale post-run phase reader failed after both requested commands
and the container exited 0; its separate error does not replace their results.
No passing test was repeated. Returned 15:55Z; booking2638 canceled.

The private S1 cache at `/media/ron/SSD_RAID/ai/tmp-c4-settings-sweep-20261017/`
is retained for the remaining isolated Settings fixes. Next: coordinator merge,
then replay the accepted Settings changes in the private native app. Provider
labels are owned separately by C6, provider keyboard navigation by C7;
unsupported attachment choices and sidebar density remain separate findings in
Gchat3's shared GUI list.

## Provider settings keyboard navigation — C7

`GUI-SETTINGS-PROVIDER-KEYBOARD` fixes the ordinary Settings provider entries
observed as clickable divs that keyboard users cannot reach. Use native router
links for active and hidden providers, keeping the current destinations, remote
setup search, provider ordering, selected-model marker and sidebar layout.
Keyboard focus must be visible and Enter must open the selected provider.

Acceptance: focused rendered navigation regressions and one `make verify`, then
push the isolated branch merge-ready. Existing installed evidence is
`/ai/gchat/out/c4-settings-sweep-20261017/provider-navigation-semantics.json`;
the parent retains the ordinary installed keyboard recheck. No provider setup,
model, GPU, Engine, install or existing user data is involved in this source fix.

Owned tree: `/ai/gchat-worktrees/c7-settings-provider-keyboard-20261017`, branch
`fix/c7-settings-provider-keyboard-20261017`, base `0099e0a1d`. Implementation
`da2fe1f1e` passes 20 focused cases, including three real-router keyboard
regressions. All `make verify` components passed on S1 CPU48–55 nice10:
lint, types, 59 Node contracts, 2,958 frontend tests, 119 extension tests,
1,079 Rust tests and all six critical coverage floors. Six frontend tests
were skipped and 27 Rust tests ignored; lint retains three existing warnings.

The single `make verify` invocation initially stopped because the private cache
lacked the current core package's `dist` entry point. Building that exact core
source repaired the fixture; only the failed coverage and unrun Rust targets
were resumed, and both passed. No passing stage was repeated.

Returned15:35Z; booking2630 canceled. The private verification copy and four
exited containers were removed, with the read-only donor untouched. Concise
results are retained in
`/ai/gchat/out/settings-provider-keyboard-20261017/{result.json,summary.md}`.
Next: coordinator merge, then Codex4's sidebar-density integration and Gchat3's
ordinary installed keyboard recheck. The Models/Hub/Engine/Hardware hands-on
pass waits for Gchat3's RC Load and Codex3's GMUL TIMING pair to return;
Windows collision remains pending Gchat2's installed RC handoff.
## Copy result and accessible control — C6

`GUI-COPY-RESULT-ACCESSIBILITY-20261017` fixes the shared Copy button in
messages, model errors and local API details. It waits for the clipboard
promise before announcing success, blocks duplicate writes while pending and
shows a retryable error on failure. The real button has an accessible name and
a polite success announcement; callers and copied text are unchanged.

Implementation `3fda416dc` passes four rendered cases covering the accessible
name, pending and same-tick duplicate clicks, successful resolution/reset,
and rejected, thrown or unavailable clipboard with retry. One `make verify`
exited 0 at 15:23:31Z October17: 2,955 frontend tests, 119 extension tests,
59 Node contract tests and 1,076 Rust tests passed; six frontend tests were
skipped and 27 Rust tests ignored. Lint, types, quality checks and all six
critical coverage floors passed; lint retains three existing warnings.
No installed workflow, Engine, model or GPU run was needed.

C6 owns only `web-app/src/containers/CopyButton.tsx`, its dedicated
`__tests__/CopyButton.test.tsx` and this section. Source is
`/ai/gchat-worktrees/c6-copy-result-accessibility-20261017`, branch
`fix/c6-copy-result-accessibility-20261017`, from main `58af0e961`.
Concise results are retained in
`/ai/gchat/out/c6-copy-result-accessibility-20261017/{result.json,summary.md}`.
Verification used S1 CPU72–79 nice10 in pinned image `ad7f9bf020d7`, private
offline caches and 22 read-only profiles. The private S1 source/dependency/build
copy is retired; the read-only donor remains untouched. Next: coordinator merge,
then the next unowned GUI row from Gchat3. New S1 work holds through Codex3's
announced GMUL TIMING pair. W3 local-path validation uses Gchat3's RC Installed
Load/cache packet when it arrives, with no separate Load.

Setup correction: root installation succeeded but pruned 40 extension-only
cache entries, stopping offline extension installation before any tests.
Refilling the private cache **after** root installation allowed extension setup
to finish, followed by the still-unrun focused and full gates. Preserve this
ordering for future offline setup; the cause and correction are in `result.json`.

## Assistant save results — C7

`GUI-ASSISTANT-SAVE-RESULT-20261017` fixes assistant creation and editing
that currently publish success before disk persistence and only log failures.
Save must await persistence, block duplicate submissions/dismissal while pending,
and preserve the draft with a visible retryable error on failure. Settings and
the project dialog must await the same result before closing/selecting an
assistant. Existing sampling values and selection semantics remain unchanged.

Acceptance: focused store and real-dialog regressions for pending, failed,
retried and successful saves, plus one full `make verify`; commit and push the
isolated branch merge-ready. No real user-data writes, installed workflow,
Engine, model, GPU or provider operation belongs to this source change.

Owned source: `/ai/gchat-worktrees/c7-assistant-save-result-20261017`, branch
`fix/c7-assistant-save-result-20261017`, base `68cc55bba`. Subject plan/results
are here; concise verification results are retained in
`/ai/gchat/out/assistant-save-result-20261017/{result.json,summary.md}`.
Implementation `cc36c51cb` passes all 42 focused store, real-editor, settings
and nested-project cases. One full `make verify` exited 0 at 15:04:18Z on
October17: 2,926 frontend tests, 119 extension tests, 59 Node contract tests
and 1,076 Rust tests passed; six frontend tests were skipped and 27 Rust tests
ignored. Lint, types, quality checks and all six critical coverage floors passed;
lint retains three existing warnings.

Verification used S1 CPU48–55 nice10 in pinned image `ad7f9bf020d7`, private
offline caches and retained read-only profiles. No installed UI, Engine, GPU,
model, Ensure or install operation ran. Returned15:04Z; booking2611 canceled.
The private verification source/cache copy and exited container were retired
at15:06Z; the read-only donor remains untouched. Next: coordinator merge of the isolated branch, then the
current-main Models/Hub/Engine/Hardware walkthrough with a fresh private home
after Gchat3's RC Load return, using Codex3's read-only runnable closure.
Windows host-port collision remains pending Gchat2's installed RC handoff.
## Folder launcher failure — GCHAT-OPEN-FOLDER-NATIVE-FAILURE-20261017

Open folder and the data-folder shortcut return a clear error when the desktop
file manager cannot start. A missing Linux `xdg-open` explains how to install
`xdg-utils` or open the selected folder manually; GChat stays open. Windows
Explorer keeps its existing handoff behavior. Paths remain literal arguments.

An ordinary model-free XFCE walkthrough on source `68cc55bba` reproduced an
abort at 15:02:50Z on October17: `xdg-open` was absent and the native command
used `expect()`. Browse, text preview/retry and View AGENTS.md passed before
the crash. Evidence and the normal guest return are retained in
`out/gui-folder-walkthrough-20261017/{result.json,summary.md,open-folder-crash.txt}`.
Three native regressions cover missing launcher, literal arguments and failed
exit status. Full Linux verification is required before merge; a corrected
installed native walkthrough and Windows execution are not yet qualified.
## Settings walkthrough — C4

`GUI-SETTINGS-SWEEP-20261017` covers every Settings section and all 19 provider
pages in native Linux GChat from main `77ccd3624`. The private HOME/XDG app in
the OLD fixture uses no retained profile, model or Engine. Screenshots and
control results are retained in `/ai/gchat/out/c4-settings-sweep-20261017/`;
findings belong to Gchat3's single [GUI list](/ai/coordination/flash-next/gui-sweep-20261017.md).

The walkthrough reproduced a visible Hugging Face token, lost attachment numeric
edits when leaving within the debounce delay, inaccessible provider navigation,
an overcrowded Settings sidebar, controls lacking associated labels, and an enabled
attachment embeddings mode whose backend is unavailable. Interface
preferences persisted, Hardware refresh returned, and the MCP Add dialog canceled
without saving. Provider keyboard access is transferred to C7; C4 owns token,
attachment durability, unavailable embedding controls, sidebar and attachment labels,
each on its own branch. C6 owns provider control labels.

The first fix masks the token by default, adds an associated label and an explicit
Show/Hide button. Token storage and verification semantics are unchanged. Its 24
focused General cases pass. All `make verify` components pass: the single invocation
stopped on an environment-sensitive fake-GPU fixture because the CUDA mask was empty;
only that fixture and the previously unrun Rust suites were recovered with CUDA
mask/order unset. Native replay confirmed password by default, Show/Hide preserving
the value, and clearing the fake token. Screenshots and the qualified verification
receipt are in `token-fix/result.json` beneath the retained evidence directory.

| Owner / host | Path | Status / retention |
| --- | --- | --- |
| C4 / local | `/ai/gchat-worktrees/c4-settings-sweep-20261017`, branch `fix/c4-settings-sweep-20261017` | Token fix and subject record; remaining findings have separate ownership |
| C4 / S1 | `/media/ron/SSD_RAID/ai/tmp-c4-settings-sweep-20261017` | Private dependency/build cache retained through the Settings fixes; donor read-only |
| C4 / OLD | `/home/gchat/c4-settings-sweep-20261017` | Private native app/home only; returned 15:30Z, normal OFF and unchanged XML |
| C4 / evidence | `/ai/gchat/out/c4-settings-sweep-20261017/` | Before screenshots, control outcomes, findings and validation; no real token used |

Token privacy merged as `513f2ab30`; attachment edit durability now passes its focused and full gates. Next: merge attachment durability, then sidebar density and the unavailable document-search controls. Assistant create/update remains C7-owned; existing Engine and
Hardware work remains with its owners. No model or shared FRESH fixture is in scope.
## Models, Hub, Engine and Hardware walkthrough — C7

`GUI-MODELS-HUB-ENGINE-HARDWARE-20261017` is an ordinary first-user walkthrough
of Models/Hub, GInfer Hosts, Hardware and Benchmark: discovery, download and
installation, Load/Unload, profiling, progress, errors and next-action wording.
Use the current-main `77ccd3624` desktop/Host/resources closure supplied read-only
by Codex 3, with a fresh private HOME/XDG on local Linux/WSLg. Initial results
are due 16:00Z October 17. No duplicate build or source test rerun is needed for
this observation-only pass.

Acceptance: observe the actual ordinary screens and supported actions, distinguish
completed leaves from missing catalog/resources or unavailable hardware, send real
findings to Gchat 3's shared GUI list, and fix each confirmed defect on its own
branch with focused tests and one `make verify`. Do not substitute a seeded
catalog, fake model, altered defaults or another user's data. Windows host-port
collision remains a separate leaf awaiting Gchat 2's installed-app handoff.

Current preparation: owned source
`/ai/gchat-worktrees/c7-models-hub-engine-hardware-20261017`, branch
`test/c7-models-hub-engine-hardware-20261017`, from `77ccd3624`. Codex 3's
read-only build 2616 passed at 15:06:36Z and returned at 15:08Z. Its S1 runnable
root is `/media/ron/SSD_RAID/ai/tmp-c3-chat-area-hands-on-20261017/runnable`;
the receipt and layout are under
`/ai/gchat/out/c3-chat-area-hands-on-20261017/`. Desktop and Host are from the
frozen main revision; the genuine bundled Engine resources are retained
`5af502f1e59a99205750c9090874e2a0448f199f`, so this is not a current-Engine
qualification. The actual desktop and Host local `ldd` checks resolve.

Codex 3 returned GMUL at 15:49Z. Gchat 3 reached Ready at 15:51Z and clarified
its staging/launch release at 15:52Z. The sole read-only donor copy is staged at
`/ai/gchat/out/c7-models-hub-engine-hardware-20261017/runtime`; desktop and Host
hashes match the retained receipt, and both actual local `ldd` checks resolve.
S1 staging is returned at 15:54Z. Local CPU20–23 is booked for the ordinary
private-home desktop; no C7 model or GPU operation is admitted. Launch
with separate Host/Inspector ports. Use a private `dbus-run-session` as well as
fresh HOME/XDG: desktop single-instance ownership uses a session-bus name and
is not isolated by the data directories alone. Keep WSLg display/runtime
variables intact. Keep Ron's port 17483 and all existing data
untouched. Retain concise results under
`/ai/gchat/out/c7-models-hub-engine-hardware-20261017/` when observations exist;
release private processes and disposable copies at completion.

Local preparation found an available WSLg display, private Inspector ports and
37 GB free disk before staging. The actual local dependency checks supersede
the earlier static six-SONAME warning; no extra dependency copy was needed.
Observed at 15:58Z: the ordinary private desktop opens, identifies the RTX 5090,
and displays Installed, Recommended, Downloads, GInfer Hosts, Hardware and
Benchmark. Installed and Downloads are empty; Recommended reports no published
recommendation with verified release metadata. Benchmark explains the missing
loaded model and disables Run. No download, installation, Load/Stop, measured
profile or benchmark execution is qualified.

The raw donor used lowercase `lib/gchat`; Tauri uses productName `GChat` when
resolving its Linux resource directory. Only the owned staged copy was renamed
to `lib/GChat`, then normally reopened in a second fresh private HOME. Extensions
now install successfully. This was launch preparation, not a product defect.
The donor remains unchanged.

Two observations need follow-through: Hub still says “Preparing local model
runtime…” and Hosts is unavailable while bundled resource installation is
pending; the Hardware GPU fallback message incorrectly refers to a “llama.cpp
backend”. The latter is a confirmed wording defect in
`web-app/src/locales/en/system-monitor.json`; check current main and claim a
separate fix before editing. The runtime state needs its completion/error result
before classification. Saved observations are `screens.json`,
`model-tabs-hardware.json`, and `hardware.png` under the owned output root.
Current desktop is private and model-free; CPU20–23 booking1357 ends16:13Z.
Next: finish resource-startup diagnosis, report the leaf limits to Gchat3, and
fix the confirmed wording on a distinct branch.

The source-reading helper mapped the ordinary sequence: Models → Installed /
Recommended / Downloads; GInfer Hosts → Set up models on this computer;
Advanced hardware profile options; Settings → Hardware; then Benchmark.
Inspect the empty states and next-action wording before requesting any expensive
operation. Model download availability depends on the genuine published catalog;
an absent catalog is a scope limit, not a reason to inject one. Viewing hardware
information is distinct from building a measured hardware profile. Downloads
become Installed after verification, model unloading is labelled Stop, and
Benchmark requires an already loaded instance. Observe these actual controls;
do not claim download, profiling, Load or benchmark completion from source reads.

## Global conversation deletion — C7

`GUI-GLOBAL-THREADS-DELETE-SINGLE-SUBMIT-20261017` applies the existing project
confirmation behavior to global Delete all: Cancel initially focused, synchronous
single submission, blocked dismissal while pending, and a visible retryable
error. Global deletion scope, success notification and deferred home navigation
are preserved. No real conversation deletion was performed.

Implementation `6d8c84f60` passes six rendered keyboard, repeated activation,
pending, success and retry cases. One full `make verify` exited 0 at 14:41:36Z
October17: 2,870 frontend tests, 119 extension tests, 59 Node contract tests and
1,076 Rust tests passed; six frontend tests were skipped and 27 Rust tests
ignored. Lint, types, quality checks and all six critical coverage floors passed;
lint retains three unrelated existing warnings.

Verification used S1 CPU32–39 nice10 in pinned image `ad7f9bf020d7`, private
offline caches and 22 retained profiles, with CUDA mask/order unset. The private
source/cache and stopped container are retired, read-only donor untouched;
booking2595 canceled, returned14:42Z. Concise evidence is retained in
`/ai/gchat/out/global-threads-delete-single-submit-20261017/{result.json,summary.md}`.
The branch `fix/c7-global-threads-delete-single-submit-20261017` from main
`65248d3cc` merged as `38317aca1`; its clean owned worktree is retired.
Installed confirmation remains with Gchat3. Windows host-port collision waits
for Gchat2 installed-Windows handoff. No Engine/GPU/model gate applies.

## Project conversation deletion — C7

`GUI-PROJECT-THREADS-DELETE-SINGLE-SUBMIT-20261017` makes the project's
Delete all confirmation safe to operate with the keyboard: Cancel receives
initial focus, explicit Delete uses native button activation once, and pending
deletion blocks repeated submissions and dismissal. A rejected operation stays
open with its error and permits retry. The existing deletion callback, project
scope, translations and success notification remain the contract.

Acceptance: rendered keyboard, repeated activation, pending, success and retry
tests, then one full `make verify`; commit and push an isolated merge-ready
branch. No real conversation deletion, Engine, model or GPU operation.
Installed confirmation belongs to Gchat 3's parent GUI qualification. Windows
host-port collision remains pending Gchat 2's installed-app handoff.

| Owner / host | Path | Status / retention |
| --- | --- | --- |
| C7 / local | `/ai/gchat-worktrees/c7-project-threads-delete-single-submit-20261017`, branch `fix/c7-project-threads-delete-single-submit-20261017` | From main `a08e2b053`; dialog implementation and six dedicated regression cases frozen at `79b06e217` |
| C7 / S1 | `/media/ron/SSD_RAID/ai/tmp-c7-project-threads-delete-single-submit-20261017/` | Private source/dependency/native cache retired after verification; booking 2563 canceled, returned 14:12Z |
| C7 / evidence | `/ai/gchat/out/project-threads-delete-single-submit-20261017/{result.json,summary.md}` | Passing focused and full verification result retained here |

The six focused rendered regression cases pass. The single full `make verify`
exited 0 at 14:10:39Z on S1 in pinned image `ad7f9bf020d7`: lint, frontend
types, contracts and critical coverage floors passed, with 2,796 frontend tests,
119 extension tests and 1,076 Rust tests. Six frontend tests were skipped and
27 Rust tests ignored. The gate used private offline caches and 22 retained
profile catalogs; generated local-core archive references changed only inside
the disposable copy. Source dependency files and the read-only donor are
unchanged. The private build copy is retired. Next: coordinator merge of the
isolated branch; installed confirmation remains with Gchat 3.

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
| C7 / local | `/ai/gchat-worktrees/c7-code-disable-workspace-stop-20261017`, branch `fix/c7-code-disable-workspace-stop-20261017` | Tested implementation `6b99bcf84` from `691fdcc10`; merged in main as `c256d7236` |
| C7 / S1 | `/media/ron/SSD_RAID/ai/tmp-c7-code-disable-workspace-stop-20261017/` | Private source/dependency/native cache retired; 19,816,259,584 allocated bytes reclaimed, donor unchanged |
| C7 / evidence | `/ai/gchat/out/code-disable-workspace-stop-20261017/{result.json,summary.md}` | Passing focused and composed full verification results retained |

The implementation serializes native Code launch/stop, reaps successful stops,
and retains failed stop handles for retry. A shared transient disabling state
blocks delayed UI readiness and restart work. Verification passes on S1 CPUs
80–87 in pinned image `ad7f9bf020d7`: 55 focused frontend cases, three native
lifecycle cases, Cargo check and strict Clippy. All `make verify` components pass:
2,709 frontend tests (six skipped), 119 extension tests and 1,076 Rust tests
(27 ignored), plus lint, types, quality and coverage checks.

The one `make verify` invocation exited 2 at an unrelated coordinator fixture:
Docker `--network none` provided no route for its UDP address selection. Retrying
only that failed case with bridge networking passed, then the five unrun Rust
suite commands passed. Successful checks were not repeated. Offline setup uses
the retained per-project Yarn cache with global caching disabled and refills
extension-only entries after root installation; generated core archive references
remain confined to the disposable copy. Candidate dependency files are unchanged.
No Engine or GPU/model run. Next: Gchat 3's installed
workflow acceptance; Windows collision still waits for Gchat 2's handoff.

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
## Factory-reset keyboard confirmation — GUI-RESET-CONFIRMATION-KEYBOARD

The factory-reset confirmation opens with **Cancel** focused. Reset requires an
explicit mouse or keyboard activation and invokes the existing reset callback
once, without changing the reset operation. Cancel, Close and Escape dismiss
the dialog without resetting; closing returns focus to the trigger.

Owned source: `/ai/gchat-worktrees/c3-reset-confirmation-keyboard-20261017`,
branch `fix/c3-reset-confirmation-keyboard-20261017`, base `eb6831fb0`.
Focused mouse/keyboard tests: 8 passed. Full `make verify` passed on S1 CPUs
88–95 at 2026-10-17 13:37:54Z: frontend 2,688 passed / 6 skipped, extensions
119 passed, Rust 1,073 passed / 27 ignored; critical coverage floors passed.
The offline gate used private writable caches, Rust 1.98 and 22 retained
profile catalogs. Only the disposable fixture's local-core archive references
were adjusted; no dependency install, GPU/model operation or live reset ran.
Logs and command: `/ai/gchat/out/c3-reset-confirmation-keyboard-20261017/`.
The private S1 source/build/cache copies are retired, result/log receipts and
the read-only donor remain; booking 2542 is canceled. Coordinator integration
is next.

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
No live job or retained remote build. The original guidance was merged at
12:48Z as `2f2c4f028`; its workspace-stop follow-up is recorded above.

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
