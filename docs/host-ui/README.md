# GInfer host UI

## Models overlapping deletion recovery — C7, October 18

`GUI-MODELS-DELETE-REFRESH-RECOVERY` follow-up: the permanent accepted-ID
filter in rejected candidate `43f4a075c` prevented overlapping reads from
resurrecting deleted models, but also hid legitimate re-downloads/imports.
Its focused tests and sole verify passed, but did not cover re-addition; they
do not qualify the correction below. That fixture and container were retired.

Owned branch `fix/c7-models-delete-overlap-recovery-20261018`, matching
`/ai/gchat-worktrees/` tree, base `e93d19e77`. Parent owns the shared helper,
notice caller and this authority; the test worker owns the existing rendered
deletion regression and independent S1 SSD fixture. The correction tracks each
accepted deletion by an ephemeral identity. Inventory reads capture those
identities and receive later accepted deletions. An inventory read started
after acceptance may acknowledge absence and clear that active identity;
older pending reads retain their captured identity until they finish. A
legitimate model re-addition retires its identity and preserves the current
model, path, settings and selection when an older read lands. The persistent
store's legacy deleted-ID list is not the authority for local recovery.

Acceptance: delete B, acknowledge or fail its read, re-add B through normal
persisted provider publication, then delete A without hiding live B; overlapping
A recovery and B deletion cannot resurrect B, even after B's newer read has
acknowledged deletion; an old A read cannot replace or omit a re-added B.
No delete/load/Stop mutation is replayed. Run focused deletion tests, lint and
exactly one new `make verify`, as requested for this correction; return to
Codex 8 before mailing merge-ready. No backend, Engine, installed-app or Windows
qualification changes. Source `540b1761f` implements that contract with five
added regressions. All 31 focused cases across both deletion suites passed;
lint passed with zero errors and five existing unrelated warnings. Exactly one
new `make verify` passed at **21:55:01Z**: **3,834 app tests / six skipped,
130 extension tests, 65 Node contract tests and 1,319 native tests / 28 ignored**
across 23 native summaries, all six critical coverage floors, typecheck and
quality guards. The coordinator directly reviewed the raw stage results and
exited-zero container, plus unchanged before/after bindings for three source
files, 35 dependencies and eleven catalogs / 48 profiles. No test reruns occurred.
Booking3588 CPU104–111 returned **21:56Z** and was canceled.
Next: Codex 8 review, then mail merge-ready on acceptance.
No GPU or Windows resource hold exists. The separate Stop/status candidate is
preserved.

Current correction evidence is
`out/c7-models-delete-overlap-recovery-20261018/test-result.json` and
`test-summary.md`, with the prior candidate retained only as a concise rejection
note. The owned S1 fixture is
`/media/ron/SSD_RAID/ai/tmp-c7-models-delete-overlap-recovery-20261018`
and was recreated only after confirming the previous fixture was absent.
The inactive offline donor's manifest references were compared separately from
the candidate's test-only Tokio addition; this prevents the mismatch that
stopped the previous preparation before tests. The reviewed fixture and sole
exited candidate container were retired at **21:57:58Z**; the coordinator
independently confirmed both absent and the inactive donor retained. Only the
result JSON and short summary remain. Protected inputs are preserved.

## Models accepted deletion and inventory recovery — C7, October 18

`GUI-MODELS-DELETE-REFRESH-RECOVERY` fixes the shared local deletion path:
the backend accepts deletion and local caches remove the model, then an
inventory read rejects and both entry points incorrectly report deletion
failure. Preserve accepted deletion separately from that read failure. A
persistent notification must survive the removed row/dialog, explain the
accepted result (including original-file preservation for external references),
keep diagnostics in closed Technical details and offer **Refresh model list**.
That recovery only reads provider inventory; it never deletes, adopts, loads
or stops a model. Rejected deletion keeps the existing retryable confirmation.

Owned branch `fix/c7-models-delete-refresh-recovery-20261018`, matching
`/ai/gchat-worktrees/` tree, base `a69c6ba20`. Parent owns the shared deletion
helper, shared notification, both callers and inventory service/extension
corrections; the test worker owns the two existing rendered deletion suites,
provider/startup/extension read regressions and independent S1 SSD fixture.
Acceptance:
ordinary/external accepted-delete/read-failure, notice surviving row removal,
failed then successful read-only refresh with duplicate-click protection and
no stale-response resurrection, true rejection and explicit deletion retry,
focused tests, lint and exactly one `make verify`. The existing Models refresh
button also adopts files, so it is not a substitute for this read-only retry.
Accepted deletion also clears a selection of the removed model immediately;
that must not depend on the inventory read succeeding. No native backend, Engine,
model run, installed-app or Windows qualification changes.
The accepted/read split and persistent recovery notice are implemented. The
real desktop provider service previously swallowed inventory failures as an
empty list, bypassing recovery; it now rejects and startup retains its cached
inventory on failure. The extension's `list()` previously adopted loose files
on each read; it now only reads registered models. Explicit Models refresh
still adopts files, and the existing single-model lookup/load path is unchanged.
Direct service, startup and extension regressions now cover these boundaries,
including read rejection/retry and a legitimately empty registered inventory.
The Settings external-reference case also preserves its original-file promise
through dialog removal and read-only recovery. Frozen source `e8bed0757` passed
**103 focused app tests** across five files, **34 focused extension tests**, and
lint with zero errors and five existing unrelated warnings. Exactly one
`make verify` passed at **20:54:06Z**: **3,816 app tests / six skipped, 130
extension tests, 65 Node contract tests and 1,318 native tests / 28 ignored**
across 23 native summaries, all six critical coverage floors, typecheck and
quality guards. The coordinator directly reviewed raw stage results and the
exited-zero container, plus unchanged before/after bindings for 15 source/test
files, 35 dependencies and eleven catalogs / 48 profiles. These are source
and Linux gate results; installed-app and native Windows acceptance remain
separate.

The independent S1 SSD fixture used booking3552 on CPU88–95; those CPUs returned
**20:57Z** and the booking was canceled. The owned fixture
`/media/ron/SSD_RAID/ai/tmp-c7-models-delete-refresh-recovery-20261018`
and its sole exited candidate container were retired at **21:00:24Z**, removing
**28,879,998,976 allocated fixture bytes** after direct review. Only the result
JSON and short summary remain; the inactive dependency donor and protected
inputs are preserved. The branch merged as `51dc678b9`; the overlapping-recovery
follow-up above remains active. Evidence:
`out/c7-models-delete-refresh-recovery-20261018/test-result.json` and
`test-summary.md`. No native resource hold exists.

## Models accepted download requests — C7, October 18

`GUI-MODELS-DOWNLOAD-ACTION-REFRESH` corrects the observed Models path where
Start download, Pause, Resume or Delete partial download succeeds, then the
following inventory read rejects inside the shared action catch. The UI says
the request failed and enables stale mutation controls. Preserve the accepted
request separately from its unread status, keep diagnostics in closed
Technical details and disable conflicting download requests for that computer
until **Refresh downloads** reads fresh status. Recovery must not replay the
mutation. An actual rejected request remains retryable. Do not claim a final
paused/deleted state before a fresh snapshot supplies it.

Owned branch `fix/c7-models-download-action-refresh-20261018`, matching
`/ai/gchat-worktrees/` tree, base `d9103a3b4`. Parent owns the component and
subject; the test worker owns rendered regressions and its independent S1 SSD
fixture. Acceptance: local and paired-computer accepted/read-failure recovery,
read-only failed then successful retry, per-computer isolation, repeated-click
guard and true rejection behavior, focused tests, lint and exactly one
`make verify`. Reuse the accepted first-run design above/below without
retesting first-run or changing the download backend, registration, model
load/Stop, Engine or native Windows behavior.
Download status reads now target the selected paired computer's snapshot and
publish it through the existing Host store; a fleet refresh can swallow a
per-computer read failure or return before another refresh finishes, so it
cannot establish this recovery. Local status retains its existing download
store read. An accepted request with unavailable status also suppresses the
empty-list claim and totals until the fresh read succeeds.
Frozen source `9ee296e5f` passed all **59 focused Models tests** and lint
(zero errors, five existing unrelated warnings). Exactly one `make verify`
passed at **20:24:13Z**: **3,803 app tests / six skipped, 127 extension tests,
65 Node contract tests and 1,318 native tests / 28 ignored** across 23 native
summaries, all six critical coverage floors, typecheck and quality guards.
The coordinator directly reviewed raw results, terminal state, source bytes
against the frozen worktree and unchanged before/after source, 35 dependency
and eleven catalog / 48 profile bindings. These checks cover the rendered
local/paired recovery behavior and Linux source gate; no installed-app,
native Windows, model or Engine qualification is claimed.

Independent S1 SSD preparation and the gate used booking3536 on CPU88–95,
with the inactive RC dependency donor and existing offline build image.
CPU88–95 returned **20:26Z** and booking3536 was canceled. The owned fixture
`/media/ron/SSD_RAID/ai/tmp-c7-models-download-action-refresh-20261018`
and its sole exited candidate container were retired at **20:28:33Z**, removing
**28,879,536,128 accounted fixture bytes** after direct review. The inactive
donor and protected inputs remain unchanged. Small evidence:
`out/c7-models-download-action-refresh-20261018/test-result.json` and
`test-summary.md`. Merged into `origin/main` as `a69c6ba20`; the next owned
Models item is deletion/inventory recovery above.

## Models accepted registration and refresh recovery — verified, C7, October 18

`GUI-MODELS-REGISTRATION-REFRESH-RECOVERY` fixes an observed source path in
`ModelManagement.tsx`: `local_model_register` can succeed before provider or
Host inventory refresh rejects, but the shared catch says the model could not
be added and recommends choosing a different file. The accepted operation
must remain accepted. Show that the model was added, retain the read failure
in closed Technical details, and let **Refresh installed models** reread the
provider/Host inventories without repeating registration, adoption or load.
An unsuccessful reread retains that recovery path; a successful reread clears
it. Actual chooser/registration rejection keeps its existing retry guidance.

Owned source: branch `fix/c7-model-registration-refresh-recovery-20261018`,
matching `/ai/gchat-worktrees/` tree, base `9314546cd`. Parent owns the component
and this subject; the test worker owns the rendered Models regressions and
independent S1 SSD verification fixture. Acceptance: both post-registration
read failures, failed then successful read-only recovery, existing repeated
click guards, focused tests and exactly one `make verify`. No Engine change,
model run, installed-app or native Windows qualification is claimed. Source
is frozen at `c183987e3`: accepted registration now retains a read-only refresh
retry through either inventory failure. The rendered regressions cover failed
then successful recovery and duplicate-click protection. The independent S1
fixture is `/media/ron/SSD_RAID/ai/tmp-c7-model-registration-refresh-recovery-20261018`,
using an inactive RC dependency donor. Booking3526 used CPU88–95 for
preparation and verification, with no GPU. The gate began at 19:46:45Z.
All **53 focused Models tests passed**;
lint passed with zero errors and five existing unrelated warnings. Exactly one
`make verify` passed at **19:55:20Z**: **3,792 app tests / six skipped,
127 extension tests and 1,318 native tests / 28 ignored** across 23 native
summaries, plus all six critical coverage floors, typecheck and quality guards.
The coordinator directly reviewed raw terminal results, zero exits, exited
container state, source bytes against the worktree and unchanged before/after
source, dependency and catalog bindings. CPU88–95 returned **19:56:23Z** and
booking3526 was canceled. The owned S1 fixture and sole exited candidate
container were retired at **19:59:55Z**, removing **27,821,528,481 logical
bytes**. The inactive RC dependency donor and protected inputs remain unchanged.
Small evidence: `out/c7-model-registration-refresh-recovery-20261018/test-result.json`
and `test-summary.md`. A staging argument error stopped before extraction or
tests; correcting `taskset -c 88-95` prevented recurrence without repeating a gate.
Next: merge the verified branch and continue the owned Models queue.

## First-run cleared choices — verified, Gchat 3, October 18

`GUI-FIRST-RUN-CLEARED-CHOICE-REMOUNT` follows Bubbs's approved unset/empty
design: new users retain the recommended preselection until an explicit
choice; saving an empty selection persists `[]` and remains unchecked after
polling, reopening the screen and restarting the Host. Recommendations stay
visible as suggestions. Status reads and maintenance must not save an empty
choice for a user who has never chosen.

Owned branch `fix/gchat3-first-run-cleared-choice-remount-20261018`, base
`15dbad1e6`, uses the matching `/ai/gchat-worktrees/` source tree. Acceptance
is rendered new-user/clear/remount behavior, durable Host null/empty behavior,
focused tests and one `make verify`. No GPU, installed-app or Windows claim is
made. The independent S1 SSD fixture uses the inactive RC donor. The initial
focused run passed 54 cases, including clear/remount, and stopped on the
existing pending-profile test: Clear now appears while profiling, so waiting
for that button no longer waits for the completed poll. The test now waits
for the changed recommendation before checking that edits survived. No
production change was needed for this failure. Frozen source `58100466d`
then passed only that failed case, 21 native first-run tests / one ignored,
Rust check/clippy and lint (zero errors, five existing unrelated warnings).
Exactly one `make verify` passed at **18:57:36Z**: **3,753 app tests / six
skipped, 127 extension tests, all six coverage floors and 1,317 native tests /
28 ignored** across 23 summaries. Typecheck and quality guards passed. The
coordinator reviewed raw results, terminal state and unchanged source,
dependency and eleven-catalog bindings before cleanup.

CPU88–95 returned **18:58Z**; bookings3499/3500 are canceled. The independent
`/media/ron/SSD_RAID/ai/tmp-gchat3-first-run-cleared-choice-remount-tests-20261018`
fixture and two exited containers were retired at **19:05:58Z**, removing
**28,312,764,003 logical bytes**. The inactive RC donor remains unchanged.
Small evidence is retained in
`out/first-run-cleared-choice-remount-20261018/test-result.json` and
`test-summary.md`. Next: merge the verified branch and continue the owned GUI queue.
## Saved-Host Connect recovery — verified, Gchat 3, October 18

`GUI-HOST-CONNECT-CANCEL-GUIDANCE` corrects the network-only advice observed
when a user cancels the secure-storage unlock during explicit Connect.
The retained installed Linux observation is
`out/c3-keyring-crash-relaunch-20261018/result.json`; its saved connection
survived cancellation and connected after an explicit retry and unlock.

Owner branch `fix/gchat3-host-connect-cancel-guidance-20261018`, base
`e97f30aa0`, starts after the reserve controls merged and their owner released
`EngineHostModels.tsx` and its rendered tests. Give conditional unlock and
network recovery advice without guessing the failure cause from diagnostic
strings. Preserve the saved Host, closed diagnostic details, single-submit
protection and explicit retry; do not add credential reads or automatic retry.
Acceptance is the affected rendered rejection/retry behavior and one
`make verify` on an independent S1 fixture. Native observation is reused;
this change makes no new installed-app or Windows qualification claim.
Frozen source `348117bc1` passed all **86 focused EngineHostModels tests**
and lint (zero errors, five existing unrelated warnings). Exactly one
`make verify` passed at **19:20:13Z**: **3,770 app tests / 6 skipped,
127 extension tests, 1,316 native tests / 28 ignored**, all six critical
coverage floors, typecheck and quality guards. The coordinator directly
reviewed terminal raw output and matching source bytes/modes, 35 dependency
inputs and eleven catalogs / 48 profiles before and after execution.

S1 CPU88–95 returned **19:21:26Z**, booking3512 canceled. After review, the
owned independent SSD fixture
`/media/ron/SSD_RAID/ai/tmp-gchat3-host-connect-cancel-guidance-tests-20261018`
and its sole exited candidate container were retired at **19:25:08Z**,
removing **29,846,760,042 logical bytes**. The inactive RC donor and protected
catalog inputs remain unchanged. Small results are retained at
`out/host-connect-cancel-guidance-20261018/test-result.json` and
`test-summary.md`. These checks establish rendered rejection/retry behavior
and the Linux source gate; the retained native observation is reused, with
no new installed-app or Windows qualification claim. Next: merge the verified
branch and continue the owned GUI queue.

## First-run action recovery — verified, Gchat 3, October 18

`GUI-FIRST-RUN-ACTION-ERROR-GUIDANCE` stops describing every rejected setup
action as a connection failure. A rejected folder change or Stop request now
directs the user to **Retry local setup** to read current status before an
explicit action retry. Diagnostics remain in closed **Setup action error
details**. Successful polls do not imply the action succeeded; edited choices
and existing retry behavior are preserved. Connection-read and actionable
disk-full maintenance guidance remain unchanged.

Frozen source `fc5a0b026` on
`fix/gchat3-first-run-action-error-guidance-20261018` passed the existing
rendered Stop/folder regressions, including status-only recovery without
folder mutation replay. The initial focused run passed 52 cases and stopped
on the existing replacement-Host test: it edited the folder before initial
`/fast` hydration settled. Waiting for that value before entering the draft
corrected the fixture; the failed case then passed without repeating the 52
passing cases or changing the replacement-Host assertions.

Lint passed with zero errors and five existing unrelated warnings. Exactly
one `make verify` passed at **18:14:39Z**: **3,735 app tests / 6 skipped,
127 extension tests, 1,316 native tests / 28 ignored**, all six critical
coverage floors, typecheck and quality guards. The coordinator reviewed the
actual raw results, terminal state, matching source bytes/modes, dependencies
and all eleven frozen catalog inputs. These are rendered regressions and a
Linux source gate; installed desktop, live Host and Windows acceptance remain
separate.

Candidate base is `73fac6573`, in the matching `/ai/gchat-worktrees/`
directory. S1 CPU80–87 returned **18:16Z**, booking3478 canceled. The independent
`/media/ron/SSD_RAID/ai/tmp-gchat3-first-run-maintenance-guidance-tests-20261018`
fixture and two exited containers were retired at **18:19:46Z** after direct
review, removing **30,090,876,987 logical bytes**. The inactive RC donor and
protected inputs remain untouched. Small evidence:
`out/first-run-action-error-guidance-20261018/test-result.json` and
`test-summary.md`. Next: merge the verified branch and continue the owned GUI queue.

## Locked-vault next action — verified, Gchat 3, October 18

`GUI-SECURE-STORAGE-LOCKED-STATE-GUIDANCE` gives a confirmed locked passphrase
vault its actual state and next action. Before opening the form, it directs
the user to choose Unlock vault; the open form then asks for the passphrase
and explicit Unlock. Locked storage remains unready and passive status reads
remain passive. Other unavailable providers retain their existing guidance.

Frozen source `f1c224c5c` on
`fix/gchat3-secure-storage-locked-guidance-20261018` passed **27 focused
credential tests** and lint (zero errors, five existing unrelated warnings).
Exactly one `make verify` passed at **17:41:43Z**: **3,722 app tests / 6
skipped, 127 extension tests, 1,316 native tests / 28 ignored**, six critical
coverage floors, typecheck and quality guards. Before/after source bindings
match. This establishes rendered state transitions and the Linux source gate;
live keyring, installed-app and Windows qualification remain separate.

The first archive preflight stopped before tests because its two tracked
`100644` files had mode `0664`. Normalizing those owned files to `0644` and
using extraction umask `022` corrected staging without changing their bytes.
No test stage or full gate was repeated. S1 CPU80–87 returned **17:43Z**,
booking3454 canceled. The owned SSD fixture and two exited containers were
retired at **17:46:18Z**, removing **28,309,240,082 logical bytes**. The
protected RC donor is unchanged. Only
[the result](../../out/secure-storage-locked-guidance-20261018/test-result.json)
and [short summary](../../out/secure-storage-locked-guidance-20261018/test-summary.md)
are retained. Merged as `73fac6573`; continue the next owned GUI row without
repeating these accepted checks.
## GPU memory reserve setting — merged, C3, October 18

`KV-HEADROOM-USER-SETTING` delivers Ron’s per-launch setting in each Host’s
model editor under Advanced: **GPU memory to keep free (MB)**. New custom
launches default to 300 MB (314572800 bytes); editing inherits the saved
profile’s value. The same `kv_arena_headroom_bytes` must reach quote and launch
unchanged. Saving changes uses the existing confirmed instance reload, so
editing alone never changes a running model. Signed profile recipes retain
all recorded values and qualification checks.

Acceptance: validate representable nonnegative MB input before quote/start/save;
cover conversion, profile inheritance, restart and Host argument forwarding;
show the Engine’s reserve-related startup failure with an actionable explanation;
run focused tests, exactly one `make verify`, and capture the real native editor
in an isolated S1 session. No Engine arithmetic/admission change, new release
package, GPU benchmark, global preference map, or CredentialSetup/EngineFirstRun
edit belongs to this item. Arch confirmed this launch/profile ownership at
17:40Z; C1 owns GInfer config/profile support and no GChat files.

Owner/worktree: C3, `fix/c3-gpu-memory-reserve`,
`/ai/gchat-worktrees/c3-gpu-memory-reserve-20261018`, baseline `5b48adfd9`.
The private S1 build fixture used independent read copies of the inactive granted
Gchat 3 dependencies; no GPU claim. Small evidence is under
`out/c3-gpu-memory-reserve-20261018`. New launches explicitly send
300 MB; editing preserves saved bytes, including zero and fractional MB; invalid
values block quote/start/save. The Engine has no dedicated error code for strict
post-attach reserve failure: C1 confirmed the exact `final KV arena violates
physical headroom on rank …; free_bytes=…; headroom_bytes=…` diagnostic. Quote,
action rejection and asynchronous instance failure show it visibly with recovery
guidance while retaining the full log in closed Technical details. See the
[decision](../decisions/2026-10-18-expose-per-launch-gpu-memory-reserve.md).
Focused verification passed: **85 rendered UI tests**, the exact Host arena
argument test, the existing quote/saved-launch pipeline test, lint, Rust check
and strict clippy. Three initial full-log assertions needed an exact-whitespace
matcher because Testing Library normalized multiline text; the corrected 85-test
run passed. The one unmodified `make verify` passed 3,750 app tests / 6 skipped,
127 extension tests and all six critical coverage floors, then reached the main
Rust suite, where 774 tests passed and two unrelated agent-tool
tests failed. Both were caused by the private `src-tauri/target` symlink:
the shell returned a canonical working directory and the diff labels could not
strip the lexical workspace prefix. The fixture now uses a physical
`src-tauri/target`, a matching `CARGO_TARGET_DIR` and a reverse convenience alias;
no product or test source changed. Both exact failed tests now pass, and all six
remaining Rust suites pass: 1,316 tests passed across the original run and
targeted continuation, with 28 ignored. There was no second full verify.

Normal Release sidecars and desktop passed at **18:26Z**. The coordinator
reviewed the actual build output and frozen source hashes, then paired the native
desktop with a real empty private Host. A private S1 HOME, Xvfb display, D-Bus
session and unlocked keyring isolated it from Ron’s session. Ordinary input
showed default **300 MB**, changed it to **600 MB**, and restored **300 MB**;
all three unmodified screenshots were viewed. The setting and full help text
fit the native window. No GPU or model execution was used for this editor check;
focused tests cover forwarding and confirmed restart.

The app closed normally, private services stopped, and CPUs40–47 returned
**18:32Z**. The owned 63 GiB S1 build/private-HOME fixture is retired; accepted
RC packages, dependency donors and protected inputs remain intact. See
`out/c3-gpu-memory-reserve-20261018/result.json`, `native-result.json`,
`terminal-summary.json` and `reserve-default-300.png`. Source `26a0f4e97` merged
as `e97f30aa0`; EngineHostModels.tsx and its rendered tests are released to
Gchat 3. Continue the remaining owned GUI acceptance without repeating these
checks.

## Check-again locked-vault recovery — verified, Gchat 3, October 18

`GUI-SECURE-STORAGE-LOCKED-RECOVERY` fixes Codex 8's P2 after passphrase
guidance merged as `d53b88432`. Explicit Check again now preserves a typed
`Locked` result instead of reporting the vault as unavailable. An uncertain
Unlock outcome can therefore recover the empty Unlock form. A new passphrase
and explicit retry are still required; checking never replays the mutation.
Readiness remains false while locked, error details remain available, and
passive status reads are unchanged.

The behavior-preserving old-mapping test seam reproduced the serialized-state
failure (`unavailable`, expected `locked`). The frozen candidate passed **22
rendered credential tests, three native credential tests**, Rust check and
clippy, and lint with zero errors and five existing unrelated warnings.
Exactly one `make verify` exited 0 at **16:43:56Z**: **3,703 app tests / 6
skipped, 127 extension tests, all six critical coverage floors and 1,311 native
tests / 0 failed / 28 ignored** across 23 native summaries. Typecheck and quality
guards passed. The coordinator reviewed the actual failing and passing logs,
terminal state, matching source bytes and executable modes, and all eleven
frozen catalog input bindings. These tests use mocked credential providers;
live keyring and installed-desktop acceptance remain separate.

Candidate: `/ai/gchat-worktrees/gchat3-secure-storage-locked-recovery-20261018`,
branch `fix/gchat3-secure-storage-locked-recovery-20261018`, base `d53b88432`.
S1 CPU112–119 returned **16:44Z**, booking3414 canceled. Small evidence:
`out/secure-storage-locked-recovery-20261018/test-result.json` and
`test-summary.md`. P2 scratch is retired after review; the independent S1 cache
was reused for installer guidance below and retired after its accepted result.
That candidate is preserved in
`/ai/gchat-worktrees/gchat3-secure-storage-install-error-guidance-20261018`.
The retained RC dependency donor is untouched.
Source `ac922560b` is merged as `a30bda127` (Codex 8 review clean).
Continue installer guidance without repeating the accepted P2 gates.

## Model deletion confirmation — verified, Codex 7, October 18

`GUI-MODEL-DELETE-CONFIRMATION` gives Cancel initial keyboard focus so Enter
cancels without deleting. While removal is pending, the confirmation remains
visible: Escape and outside interaction cannot dismiss it, Close is hidden and
Cancel is disabled. A synchronous guard blocks duplicate activation before
React renders the disabled controls. Rejection retains inline recovery and
closed technical details for an explicit retry; success closes the dialog.
Existing managed-file deletion and external-file removal semantics are unchanged.

The three new regressions fail on unchanged base `a4cd2835a`; all nine focused
candidate tests pass. Exactly one `make verify` passed at **16:02:51Z**:
**3,682 app tests / 6 skipped, 127 extension tests, all six coverage floors,
1,309 native tests / 0 failed / 28 ignored** across 23 native summaries.
Lint reports zero errors and five existing unrelated warnings. Source and all
eleven frozen catalog metadata inputs match the tested candidate. This is
rendered frontend evidence; installed-desktop, Windows and GPU qualification
remain separate.

Branch `fix/c7-model-delete-confirmation-20261018` is in
`/ai/gchat-worktrees/c7-model-delete-confirmation-20261018`.
S1 CPU104–111 returned **16:03Z**, booking3381 canceled. The owned
`/media/ron/SSD_RAID/ai/tmp-c7-model-delete-confirmation-20261018` fixture
(**27.82 GB logical bytes**) and two exited containers were removed after result
review; the retained RC dependency donor was untouched. Small evidence:
`out/c7-model-delete-confirmation-20261018/test-result.json` and
`test-summary.md`. Next: merge the verified branch, then continue the owned queue.
## Secure-storage installation error guidance — verified, Gchat 3, October 18

`GUI-SECURE-STORAGE-INSTALL-ERROR-GUIDANCE` replaces raw installation failure
text with plain recovery instructions and closed diagnostic details. Rejection
can follow a partial package operation, so the panel refreshes passive status
once before offering an explicit installation retry, Check secure storage or
Check again. Controls and readiness remain pending during that read. A newly
present native provider remains unchecked until the user explicitly checks it.
The failure warning survives a later successful check without claiming that
installation succeeded. Installation is never replayed automatically; existing
administrator consent and native commands are preserved.

All **four new regressions fail on the unchanged component**, with no runner or
hook failure. The frozen candidate passed all **26 credential tests** and lint
with zero errors and five existing unrelated warnings. Exactly one `make verify`
exited 0 at **17:07:27Z**: **3,707 app tests / 6 skipped, 127 extension tests,
all six critical coverage floors and 1,311 native tests / 0 failed / 28 ignored**
across 23 native summaries. Typecheck and quality guards passed. The coordinator
reviewed the actual baseline and candidate logs, terminal state, matching
source bytes and non-executable modes, 35 dependency inputs and all eleven
catalog inputs. This verifies rendered recovery with mocked native commands;
live installation, desktop vault, Windows and GPU acceptance remain separate.

Candidate: `/ai/gchat-worktrees/gchat3-secure-storage-install-error-guidance-20261018`,
branch `fix/gchat3-secure-storage-install-error-guidance-20261018`, tested source
`d2a4dbf63`. It includes accepted P2 `ac922560b`, already merged as `a30bda127`
after Codex 8 review. Its separate gates were not repeated. CPU80–87 returned
**17:08Z**, booking3429 canceled; baseline booking3427 returned **16:58Z**.
Owned independent cache:
`ron@192.168.1.109:/media/ron/SSD_RAID/ai/tmp-gchat3-secure-storage-install-error-guidance-tests-20261018`.
Scoped cleanup finished **17:11:57Z** after no-reader checks: the owned cache,
prep log and two stopped containers were removed, releasing **30,093,398,157
logical bytes**. Their absence was confirmed. Only reviewed
`out/secure-storage-install-error-guidance-20261018/test-result.json` and
`test-summary.md` remain. The inactive RC dependency donor and protected inputs
are untouched. Next: merge the verified branch, then continue the owned queue.

## Passphrase form error guidance — verified, Gchat 3, October 18

`GUI-SECURE-STORAGE-PASSPHRASE-ERROR-GUIDANCE` gives plain Create, Resume
migration and Unlock recovery instructions with closed diagnostic details.
Native operations can change the desktop vault before a later Gbot step
rejects; a timeout can also leave the outcome uncertain. A fresh passive status
now selects Resume for unfinished migration, Unlock for a locked vault, or
read-only Check again when the state is unknown. A newly available vault closes
the stale Create form. Desktop readiness does not claim Gbot access was
restored. Secret fields stay cleared, and mutations require an explicit retry.

The unchanged component reproduced all **seven intended failures**, with no
hook or runner failure. The frozen candidate passed **22 credential tests**,
lint with zero errors and five existing unrelated warnings, and exactly one
`make verify`. The gate exited 0 at **16:13:01Z**: **3,686 app tests / 6 skipped,
127 extension tests, all six critical coverage floors and 1,309 native tests /
0 failed / 28 ignored** across 23 native summaries. Typecheck and quality guards
passed. This verifies rendered frontend behavior; installed-desktop and Windows
acceptance remain separate.

The coordinator reviewed the actual failing and passing logs, terminal state,
and matching source bytes/modes and all eleven catalog input bindings.

Candidate: `/ai/gchat-worktrees/gchat3-secure-storage-passphrase-error-guidance-20261018`,
branch `fix/gchat3-secure-storage-passphrase-error-guidance-20261018`, base
`a4cd2835a`. S1 CPU80–87 returned **16:13Z**, booking3394 canceled. The owned
SSD test copy was
`ron@192.168.1.109:/media/ron/SSD_RAID/ai/tmp-gchat3-secure-storage-passphrase-error-guidance-tests-20261018`.
Scoped cleanup finished **16:17:22Z**: the owned copy, prep log and two exited
containers were removed after confirming no readers, releasing
**28,064,308,537 logical bytes**. Their absence was verified; the inactive RC
dependency donor was untouched. Only reviewed
`out/secure-storage-passphrase-error-guidance-20261018/test-result.json` and
`test-summary.md` remain. Source `ca17dc7cb` is merged as `d53b88432`;
continue the GUI queue without repeating accepted verification.

## Passphrase-vault Lock feedback — verified, Gchat 3, October 18

`GUI-SECURE-STORAGE-LOCK-FEEDBACK` names the pending Lock and hides the
ready/continue claims until the request and its follow-up status read finish.
A rejected Lock shows plain recovery guidance with closed diagnostic details.
Because native locking can succeed before another step fails, the guidance uses
the fresh status: an unlocked vault offers Lock again; locked or unknown status
offers Check again. Checking never replays Lock.

The unchanged base reproduced all four pending, rejection, partial-success and
failed-read regressions. An existing setup hook implicitly returned the command
mock as teardown, causing two additional hook timeouts after failed assertions
left deferred responses unresolved. Its braced callback now returns nothing;
assertions and default timeouts are unchanged, and the valid baseline was not
repeated. The frozen candidate passed all **15 credential tests**, lint with
zero errors and five existing unrelated warnings, and exactly one `make verify`.
That gate exited 0 at **15:43:38Z**: **3,657 app tests / 6 skipped,
127 extension tests, all six critical coverage floors and 1,309 native tests /
0 failed / 28 ignored** across 23 native summaries. Typecheck and quality guards
passed. The coordinator reviewed the failing and passing logs, terminal state,
and matching source and eleven catalog input bindings. This verifies rendered
frontend behavior; installed-desktop and Windows acceptance remain separate.

Candidate: `/ai/gchat-worktrees/gchat3-secure-storage-lock-feedback-20261018`,
branch `fix/gchat3-secure-storage-lock-feedback-20261018`, base `fe0630a14`.
S1 CPU112–119 returned **15:46Z**, booking3368 canceled. Scoped cleanup finished
**15:49:30Z**: the owned SSD test cache, prep log and two exited containers were
removed, releasing **29,845,885,776 logical bytes**. Their absence was confirmed;
the inactive RC dependency donor was untouched. Small reviewed results are
`out/secure-storage-lock-feedback-20261018/test-result.json` and
`test-summary.md`. Source `04dfd2c74` is merged as `a4cd2835a`; continue
the GUI queue without repeating the accepted verification.

## First-run accepted download actions — verified, Gchat 3, October 18

`GUI-FIRST-RUN-DOWNLOAD-ACTION-RESULT` preserves confirmation when the Host
accepts Pause or Discard but the following setup read fails. The accepted
request stays visible, conflicting download controls stay disabled, and a
read-only Retry or poll recovers the current state without replaying the
mutation. A rejected request remains retryable. The displayed job and progress
remain unchanged until the Host supplies a fresh snapshot; acceptance alone
does not claim that a download is paused or discarded.

The Host persists Pause as paused or pausing and removes Discard's job before
acknowledging success, but returns no setup snapshot. The frontend now separates
that acknowledgement from the subsequent read. Existing request revision,
pending-command and Host lifetime guards are preserved.

The unchanged base reproduced both accepted-action failures: a generic error
replaced acceptance and enabled a stale action. Two rejection controls initially
blocked hydration by awaiting the first button inside `act`; moving only that
wait outside `act` corrected the fixture. Only those corrected controls continued
on the base: both passed, with 51 filtered. The valid reproduction was not
repeated. The frozen candidate passed all **53 rendered tests**, lint with zero
errors and five existing unrelated warnings, and exactly one `make verify`.
The full gate exited 0 at **15:11:21Z**: **3,647 app tests / 6 skipped,
127 extension tests, all six critical coverage floors, and 1,309 native tests /
0 failed / 28 ignored** across 23 native summaries. Typecheck and quality guards
passed. The coordinator reviewed the actual failing and passing logs, terminal
state, and unchanged source and eleven catalog input bindings. No passing gate
was repeated. This verifies rendered frontend behavior; installed-desktop and
Windows acceptance remain separate.

Candidate: `/ai/gchat-worktrees/gchat3-first-run-download-action-result-20261018`,
branch `fix/gchat3-first-run-download-action-result-20261018`, base `8c2734714`.
S1 CPU96–103 returned **15:11Z**, booking3351 canceled. Scoped cleanup finished
**15:15:34Z**: the owned SSD fixture, prep log and three exited containers were
removed, releasing **28,064,389,959 logical bytes**. Their absence was confirmed;
the inactive RC dependency donor was untouched. Small reviewed results are
`out/first-run-download-action-result-20261018/test-result.json` and
`test-summary.md`. Source `71f48f238` is merged as `39f6acf78`; continue
the GUI queue without repeating the accepted verification.

## First-run queued model choices — verified, Gchat 3, October 18

`GUI-FIRST-RUN-CLEAR-MODEL-CHOICES` fixes the case where unchecking the final
saved model during hardware measurement disabled Save while leaving the old
download queued. **Clear saved model choices** now explicitly clears a
pre-admission selection. Edited choices stop claiming they are saved; accepted
clearing persists across polling, maintenance and Host restart, leaves the
measurement running and admits no removed model when measurement ends.
Omitting `release_ids` preserves the saved choice and its error state; an
explicit empty list clears it. Already admitted downloads still reject
model-choice edits.

First-run download cards expose the existing **Pause download** and
**Discard download** actions under Arch's approved wording. Pause keeps the
partial file. Discard removes it and appears only after the Host reports paused
or failed. The card stays visible while the request is pending and never claims
an active download has stopped before acknowledgement. These use existing Host
actions without new download semantics or stored formats.

Candidate: `/ai/gchat-worktrees/gchat3-first-run-clear-model-choices-20261018`,
branch `fix/gchat3-first-run-clear-model-choices-20261018`, base `ef2ef2d79`.
The new rendered regression reproduced the stale saved confirmation on the
unchanged base. Candidate validation passed all 49 rendered tests, both focused
native regressions, Host `cargo check --all-targets` and `cargo clippy --all-targets`.
The sole `make verify` exited 0 at 14:15:43 UTC: 3,607 app tests, 127 extension
tests, six coverage floors and 1,290 native tests passed; six app tests were
skipped and 28 native tests ignored. Lint had no errors and five existing
unrelated warnings. A pinned-future fixture borrow initially blocked native
compilation; scoping it before reopening the Host corrected that test, and only
the failed/unrun stages continued. No passing focused suite or full gate was
repeated. Final source and all eight catalog input bindings match the tested
candidate. No GPU/model, Windows or installed-desktop qualification is claimed.

The independent S1 SSD fixture
`/media/ron/SSD_RAID/ai/tmp-gchat3-first-run-clear-model-choices-tests-20261018`
was removed at 14:20:49 UTC after raw evidence review, along with its three
exited containers and prep log (29.83 GB logical bytes). CPU88–95 returned
14:16Z. The inactive RC donor remains protected. Small reviewed results are
`out/gchat-first-run-clear-model-choices-20261018/test-result.json` and
`test-summary.md`. Next: merge this verified candidate, then mirror the three
signed Muse consumer profile catalogs in one separate branch.

## First-run refresh feedback — verified, Gchat 3, October 18

`GUI-FIRST-RUN-REFRESH-LIFETIME` extends the existing setup request lifetime
to Host discovery errors. An initial or Retry refresh can finish after a newer
setup command has accepted the current state, restoring an obsolete connection
warning. Discovery started before that command must not replace its feedback.
Current discovery errors without a newer command, and rejected setup commands,
must remain visible. This follows the existing status-read ordering contract;
it does not treat a successful setup read as proof of a successful Host-list
refresh or change the shared refresh store.

Acceptance: deferred rendered tests reproduce the initial-refresh and Retry
orderings, retain current failures, then focused tests and ONE `make verify`
pass. The unchanged base with only the new tests reproduced **2 expected
failures / 1 passed / 44 skipped** at 12:53:20Z: both older discovery failures
restored the warning after Retry accepted the folder setup. Current discovery
failures remained visible. The coordinator inspected the actual failing log.
The candidate applies the existing setup revision and pending-command guards
to both refresh catches; obsolete and unmounted requests cannot publish.
Candidate focused tests pass **47/47** (12:53Z, 10.48s). ONE `make verify`
passed at 13:01:37Z: **3,599 app / 6 skipped, 127 extension, all six coverage
floors, 1,288 native / 28 ignored** across 23 native summaries. Lint has zero
errors and five existing unrelated warnings; typecheck and quality guards
pass. The coordinator inspected the actual baseline, focused and full-gate
logs, terminal exit0/noOOM and unchanged tested source/catalog bindings. No
gate was repeated. The independent fixture is retired; next: coordinator
integration. No Host, Engine, GPU, native GUI or Windows qualification changes
are claimed.

| Owner / host | Exact path | Purpose / status |
| --- | --- | --- |
| Gchat 3 / local | `/ai/gchat-worktrees/gchat3-first-run-refresh-lifetime-20261018`, branch `fix/gchat3-first-run-refresh-lifetime-20261018`, base `585a85405` | Candidate component/tests and current authority; independent of main |
| Gchat 3 / S1, verified `AIS-2-8592-L01` | `/media/ron/SSD_RAID/ai/tmp-gchat3-first-run-refresh-lifetime-tests-20261018` | Independent inactive RC dependency read-copy, CPU96–103 booking3291 returned 13:02Z, nice10/max8 jobs and socket-1 shared compile lock; preparation passed all 35 dependency and seven frozen catalog bindings at 12:51:42Z; no GPU; owned fixture, prep log and two exited containers removed 13:04Z after raw-log review and no-reader check; donor preserved |

The [result](../../out/first-run-refresh-lifetime-20261018/test-result.json)
and [summary](../../out/first-run-refresh-lifetime-20261018/test-summary.md)
retain the commands, bindings and outcomes. Cleanup removed 28,050,273,434
logical bytes from the owned fixture; only these two small evidence files
remain locally. This is deterministic rendered-control verification; it does
not require a native desktop fixture.

## First-run edited startup settings — verified, Gchat 3, October 18

`GUI-FIRST-RUN-UNCHECKED-SETTINGS` fixes a confirmed first-run control defect:
editing Advanced settings leaves the prior “Ready” message and Finish local
setup enabled, so finishing silently uses different settings from those shown.
Each model's displayed values must match the Host's checked settings before
Finish is enabled. A newer edit must survive an older check response, status
poll or rejected check. Restoring the checked values may reuse their check.

Acceptance: reproduce the unchecked-edit and in-flight-check cases in the
existing rendered tests, preserve separate model drafts, pass focused tests
and ONE `make verify`. This changes frontend readiness only; Host/Engine
startup, admission and physical qualification are unchanged. The candidate
keeps controlled drafts by download ID, compares their numeric values with the
Host's saved settings, and labels the summary as saved settings. Host startup
already clears its old quote when accepting changed settings; no Host repair
is needed. The unchanged base with only the new tests reproduced **5 expected
failures / 39 skipped** at 12:27Z: Finish stayed enabled for unchecked edits,
including after a rejected check or an older accepted check; both models kept
their Ready messages after one model was edited. The newer input itself was
preserved in the baseline; its incorrect readiness was the observed race.
Candidate focused tests pass **44/44** (12:27Z, 10.44s). ONE `make verify`
passed at 12:35:38Z: **3,586 app / 6 skipped, 127 extension, all six coverage
floors, 1,288 native / 28 ignored**, with no failures across 23 native
summaries. Lint has zero errors and five existing unrelated warnings;
typecheck and quality guards pass. The coordinator inspected the actual logs,
terminal exit0 and unchanged tested source bindings. No gate was repeated.
Gchat2 and C3 confirm no component/test ownership overlap. Next: coordinator
integration of the verified branch.

| Owner / host | Exact path | Purpose / status |
| --- | --- | --- |
| Gchat 3 / local | `/ai/gchat-worktrees/gchat3-first-run-unchecked-settings-20261018`, branch `fix/gchat3-first-run-unchecked-settings-20261018`, base `fbebb98b7` | Candidate component/tests and current authority; independent of main |
| Gchat 3 / S1, verified `AIS-2-8592-L01` | `/media/ron/SSD_RAID/ai/tmp-gchat3-first-run-unchecked-settings-tests-20261018` | Independent inactive RC dependency read-copy; CPU96–103 booking3278 returned 12:35Z, socket-1 shared compile lock, nice10/max8 jobs, no GPU; owned fixture and two exited containers removed 12:37Z, donor preserved |

The [result](../../out/first-run-unchecked-settings-20261018/test-result.json)
and [summary](../../out/first-run-unchecked-settings-20261018/test-summary.md)
retain the commands, source bindings and outcomes after raw-log review. All 35
dependency inputs and seven frozen catalog inputs match the prior accepted
offline recipe. The baseline and candidate containers both exited without
OOM; only the baseline has its expected regression exit1. Cleanup removed
28,050,102,588 logical bytes from the owned S1 fixture. This is deterministic
rendered-control verification; no native GUI or physical qualification is
claimed.

## First-run request lifetime — verified, Gchat 3, October 18

`GUI-FIRST-RUN-REQUEST-LIFETIME` fixes confirmed response-order races in
`EngineFirstRun`: status reads can snapshot the old state before an action,
then finish after its accepted response. The accepted step must remain visible.
An invalidated completed poll must not stop future polling, and replacing the
local Host in Welcome must discard the former Host's pending responses and
draft/busy state. Existing rejected-action errors must remain visible across
successful status reads.

Acceptance: reproduce these orderings with deferred responses in the existing
rendered component tests, implement one Host-owned request lifetime, pass the
focused suite and ONE `make verify`. No Host/Engine startup, admission, sampling,
native Windows or GUI screenshot qualification is changed or claimed.
Implementation `ad121b656` is committed and pushed after coordinator evidence
review; the focused file passed all 39 tests, lint passed with five existing
warnings and ONE `make verify` passed. Gchat2's retained failed placement case
also passed after the later one-line hydration wait: **1 passed / 35 skipped**,
11:39:09–11:39:11Z. Merge-ready; no passing suite or full gate was repeated.

| Owner / host | Exact path | Purpose / status |
| --- | --- | --- |
| Gchat 3 / local | `/ai/gchat-worktrees/gchat3-first-run-request-lifetime-20261018`, branch `fix/gchat3-first-run-request-lifetime-20261018`, base `f414a35bc` | Candidate component/tests and this authority; no main mutation |
| Gchat 3 / S1, verified `AIS-2-8592-L01` | `/media/ron/SSD_RAID/ai/tmp-gchat3-first-run-request-lifetime-tests-20261018` | Independent inactive RC donor read-copy; CPU104–111 booked 11:16–11:41Z, returned 11:30:25Z after terminal PASS; socket-1 shared compile lock, nice10/max8 jobs; owned fixture and two exited containers removed 11:32Z; no GPU or model work |

Both Gchat 2 and C3 confirmed no component/test ownership overlap. The exact
base plus only the new tests reproduced **3 expected failures / 36 skipped**:
a late status replaced accepted Stop, an invalidated completed read prevented
the next poll, and a former Host response restored its folder after replacement.
The coordinator reviewed the actual failing log. The candidate keys setup state
to its Host, prevents pending-command reads from publishing and invalidates
them again when the command settles. Only accepted completed reads stop polling;
action errors remain separate from status errors.

All 35 dependency inputs match the retained offline donor recipe. The four
explicit catalog inputs match accepted `5825c2e39` objects and the prior 38-profile
receipt. Independent preparation passed 11:17:42Z. Candidate commands use the
existing offline image, protected inputs and copied caches. Small gate receipts
live in `out/first-run-request-lifetime-20261018/`. The single full gate passed:
**3,547 app / 6 skipped, 127 extension, all six coverage floors, 1,288 native /
28 ignored** across 23 native summaries. Container exit0/noOOM at 11:30:10Z;
both frozen source hashes match after execution. No gate retry or continuation.
A subsequent Gchat2 gate exposed a separate placement-test hydration race:
the heading can render before the saved folder initializes. The existing test
now waits for `/models` before clicking `/fast`, matching its neighboring test.
The component remains unchanged. Gchat2's retained failed-case continuation
passed with the one-line fixture correction; terminal log SHA
`e1e52322bf0868c13d1f795d9838ed1f2d1410eaa8af696b6d9ec2d9b651c401`
is recorded in `out/gchat2-service-computer-list-retry-20261018/final-remote-evidence.json`.
The original lifetime full gate and this later test-only continuation remain
separate verification claims. Cleanup removed 38,232,500,574 logical bytes
and the owned prep log after confirming no readers; the RC donor remains intact.
No native fixture is needed for these deterministic response-order regressions.

The Windows SM86/SM89 qualification remains the lane priority and is recorded
in [installer refresh](../installer-refresh/README.md). This bounded GUI repair
uses its resource wait; it does not replace either pending Linux comparison.

## Completed graphics-card setup note — C7, October 18

`GUI-PROFILE-READY-NOTES` passes its remaining Linux completed-state
rendering leaf. Source `d5841351d`, merged `54c378d03`, hides the duration
and wait paragraph once setup is completed. The [native screenshot](../../out/c7-profile-ready-notes-20261018/completed-card.png)
shows “Graphics-card settings ready” and the reminder that every model still
needs a memory check. The entire card is visible in Dark 1200×800, with
neither “Allow 10 minutes to an hour” nor “Wait for setup to stop”. Native
pointer input opened the card; the inspector only read the DOM and captured
pixels.

This is an explicitly synthetic presentation fixture: an independent
retained `11ce0355d` desktop reads a saved completed job with no pending
work, GPU selection or artifact receipts. Its private resource copy uses the
existing installer-test pattern of inert `/usr/bin/true` engines, with their
actual sizes and hashes in the runtime manifests. The real Host reads the
saved state. No Measure, model load or GPU execution was started. This
qualifies the completed-card rendering, not profile validity or a new
end-to-end hardware measurement. Windows and other themes/viewports remain
unqualified. The old `hp7.png` and ed68 desktop predate the fix.

The component and its running-to-completed regression are identical between
the retained desktop source, this branch's base `3de78b829` and the reused
ONE full gate `1062ba9f8`: **3,523 app / 6 skipped, 127 extension,
1,284 native / 28 ignored**, all six critical floors. This evidence-only
branch passes `git diff --check`; no duplicate build or test run.
[Result](../../out/c7-profile-ready-notes-20261018/result.json),
[source binding](../../out/c7-profile-ready-notes-20261018/source-binding.json)
and [saved fixture](../../out/c7-profile-ready-notes-20261018/completed-job-fixture.json)
retain the observations and limits.

Owned worktree `/ai/gchat-worktrees/c7-profile-ready-notes-20261018`, branch
`docs/c7-profile-ready-notes-20261018`, base `3de78b829`. The private S1 root
`/media/ron/SSD_RAID/ai/tmp-c7-profile-ready-notes-20261018` was removed after
its processes stopped by PID; CPU88–95 booking3229 canceled. No donor hold;
only small JSON/PNG evidence remains. Next: coordinator integration and row
closure.
## Connected Host checkbox acceptance — C3, October 18

`GUI-CHECKBOX-THEME` passes the remaining Linux Connected Host keyboard and
naturally disabled-control leaves handed over by Gchat 2 at 10:11Z. No source
fix is needed. Prior Models checkbox and Gbot radio acceptance stays credited
to Gchat 2; signed-in Workspace and Windows remain open.

An independent private desktop connected to a genuine idle Host with real S1
NVIDIA inventory. In **Light and Dark, 1280×900**, Tab focuses the checked
Follow a response format box and Space unchecks it. Both states retain the
2px theme-colored focus ring with 2px offset. The checked fill/tick and
unchecked border use the app palette: [Light checked](../../out/c3-checkbox-theme-20261018/light-checked.png),
[Light unchecked](../../out/c3-checkbox-theme-20261018/light-unchecked.png),
[Dark checked](../../out/c3-checkbox-theme-20261018/dark-checked.png),
[Dark unchecked](../../out/c3-checkbox-theme-20261018/dark-unchecked.png).

Stopping only that private Host naturally disables the hardware fieldset and
saved-settings controls through ordinary offline polling. Checked and
unchecked boxes keep their theme fill/borders at 0.5 opacity and show a
not-allowed cursor. Pointer clicks cannot change their values, and Tab skips
them: [Light](../../out/c3-checkbox-theme-20261018/light-disabled.png),
[Dark unchecked](../../out/c3-checkbox-theme-20261018/dark-disabled.png),
[Dark checked](../../out/c3-checkbox-theme-20261018/dark-disabled-checked.png).
No DOM state injection, synthetic Host response, model load, Measure or
account sign-in was used. The private service locator was explicitly seeded;
this is not first-run discovery acceptance.

The retained desktop is `11ce0355d`, Host runtime `e2282c336`. Checkbox CSS,
EngineHardwareProfile and EngineProfilePicker are unchanged through current
main `297895834`; the relevant custom-settings boxes are unchanged too.
This qualifies those source-compatible controls, not a fresh current-package
release gate. Evidence-only `git diff --check` passes; no repeat make verify
is required. Heterogeneous-card exclusion, signed-in Workspace and Windows
remain unqualified.

[Result and small native receipts](../../out/c3-checkbox-theme-20261018/result.json)
record the input, source binding and limits. Owned worktree
`/ai/gchat-worktrees/c3-checkbox-theme-20261018`, branch
`docs/c3-checkbox-theme-20261018`, base `297895834`. The independent S1
runtime used CPU96–103 booking3233 with no GPU device grant. Its 9.1GiB
runtime/copies are removed, donors preserved and booking canceled;
returned10:25Z. Next: coordinator integration; Gchat 2 retains the remaining
Workspace/Windows leaves.
## Readable model-settings check — C3, October 18

`GUI-STARTUP-CHECK-SIZES` passes its remaining Linux native leaf on October 18.
The readable-size/plural fix `d3aa2668c` is delivered in merge `b4bba8b23`.
An independently built native development desktop and Host at `66e766a43`
used S1 GPU1 and the private dev catalog
`http://192.168.1.109:18761/catalog.json`. Native **Check model settings** returned:

> Model file checked: Qwen 3.8 27B — INT. 2 model copies. 27.5 GiB of graphics-card conversation memory per model copy. This check did not start a model.

The [reviewed screenshot](../../out/c3-startup-check-sizes-20261018/native-check-result.png)
and [actual quote](../../out/c3-startup-check-sizes-20261018/native-quote.json)
show formatted memory and the correct plural. The Host response contains
29,532,118,784 conversation-memory bytes per copy. Native XTest selected only
physical GPU1, two copies, the full default 262144-token context, one request,
automatic memory, Vision and structured output enabled, speculation off.
Read-only WebKit inspection captured the DOM and actual response; no injected
action or second quote API call. Start model was never clicked; the final Host
snapshot has zero instances.

The exact registered Qwen TP1 input was read from the NAS without copying it.
Catalog package SHA-256:
`bcf29abd1598f5666c641da7c59ac28bd999aa98a8d6ba533ae7aa579abd06a7`.
The real artifact-scoped schema-2 profile completed in 143.836 seconds with
base/scope complete and no error. Other format grids were not required. The
private Host received `GINFER_MODEL_CATALOG_URL`, and the dev frontend built
with `NODE_ENV=development` and `VITE_MODEL_CATALOG_URL`. The desktop used its
standard service-owner locator; its container had no GPU devices.

Existing ONE full gate at `1062ba9f8` covers the 69 Host-model and 48
model-release cases. Result wording and formatter are unchanged from retained
`11ce0355d`; complete files contain unrelated changes. This evidence/docs-only
branch reuses that gate and requires only `git diff --check`. Pre-fix `ed68c7443`
is invalid for this acceptance. The first Docker GUI launch failed before app
startup because an environment option preceded `run`; correcting option placement
reused the same build and private display. No Windows, installer, quality or
performance qualification is claimed.

[Result and small receipts](../../out/c3-startup-check-sizes-20261018/result.json)
belong to C3 worktree `/ai/gchat-worktrees/c3-startup-check-sizes-20261018`, branch
`docs/c3-startup-check-sizes-20261018`, base `3de78b829`.
The private app and Host are stopped; returned 11:08Z. Owned S1 root
`/media/ron/SSD_RAID/ai/tmp-c3-startup-check-sizes-20261018` was removed;
only small result/quote JSON, summary and screenshot remain. Read-only
Gchat1/C7 tool/resource donors, the shared catalog service and released NAS
artifact were left intact. GPU0's C2 job was excluded. Gchat 1 was coordinated
by row ID; Chat/agents remain theirs. Other remaining W8 rows have live
owners or Ron gates. Next: coordinator integration and row closure.

## Progress bars — C3, October 18

`GUI-PROGRESS-BARS` passes its remaining Linux native leaf. The original
fix `01caea779` (merge `836f7f4e9`) is delivered. Retained frames of a real
RTX 5090 profile show the turquoise indeterminate segment at different
positions while both report 70 seconds elapsed: [first](../../out/c3-progress-bars-20261018/hp5.png)
and [second](../../out/c3-progress-bars-20261018/hp6.png). The original author
confirmed movement in live WebKitGTK. Those frames precede the source commit
by seconds; no exact executable pin survives. Their file timestamps are
retention metadata, not independently verified capture times.

C7's already committed [real transfer](../../out/c7-managed-downloads-native-20261018/native/downloading-popover.png)
at `71abf1708` shows the Models determinate bar with a turquoise fill and
neutral track in Dark 1280×900. The retained [Light capture](../../out/c3-progress-bars-20261018/lt3.png)
is a synthetic native-control preview, not an actual download card. The
progress CSS, including the reduced-motion rule, is unchanged from the
original fix through both native sources and current main `925f99195`.
The existing three native-control CSS checks pass in the retained ONE full
gate at `1062ba9f8`: **3,523 app, 127 extension, 1,284 native**, six floors.
This evidence-only closure reuses those checks and passes `git diff --check`.
No fresh profile, transfer or build is needed. Runtime reduced-motion,
Windows and current-package acceptance are unqualified.

[Result](../../out/c3-progress-bars-20261018/result.json) binds the source,
captures, receipts and limits. Owned worktree
`/ai/gchat-worktrees/c3-progress-bars-20261018`, branch
`docs/c3-progress-bars-20261018`, base `925f99195`; only small JSON/PNG evidence,
no new resources, dependency copies or private state. C7's transfer fixture
and build are already retired. Next: coordinator integration and row closure.

## Plain Models error banner — C3, October 18

`GUI-MODELS-ERROR-BANNER` passes its remaining Linux native leaf. The
original source `15be971ff` (merge `44615416d`) is already delivered. C4's
retained native Add-file → Load failure shows a readable model-name alert
and Hosts link in Dark 1200×800, without an `Error:` prefix or the unrelated
“Saved inventory may be out of date” claim. The metadata-only fixture was
rejected before Engine startup. [Native screenshot](../../out/c4-journey-native-20261018/load-without-profile-guidance.png)
is already committed in `5a83d81e7`; no duplicate fixture is needed.

The error normalizer, plain-problem renderer, action error handling and
separate action/offline alert rendering are unchanged from the native donor
through current main `e80e4fd11` and tested source `1062ba9f8`. The existing
plain-failed-load regression matches the passing **51-case Models suite**;
ONE full gate passes **3,523 app, 127 extension, 1,284 native**, six floors.
This evidence-only closure reuses those gates and passes `git diff --check`.
The screenshot's old recovery instructions are superseded by the separate
Models-without-automatic-settings correction above; this leaf qualifies the
plain banner only. Generic Technical details expansion and separate offline
warnings have rendered tests, without fresh native acceptance. Windows and
additional themes/viewports are unqualified.

[Result](../../out/c3-models-error-banner-20261018/result.json) and
[source binding](../../out/c3-models-error-banner-20261018/source-binding.json)
record the reused evidence. Owned worktree
`/ai/gchat-worktrees/c3-models-error-banner-20261018`, branch
`docs/c3-models-error-banner-20261018`, base `e80e4fd11`. No new resources,
copies or private state; C4's prior native root is already retired. Next:
coordinator integration and canonical row closure.

## Models without automatic settings — C3, October 18

`GUI-LOAD-NEEDS-PROFILE-MESSAGE` is merge-ready. The original named-model
correction `68cfa4204` (merged `7f549eef6`) is retained, but the subsequent
startup-settings ownership change made its recovery advice obsolete. Models
Load selects tested settings and deliberately rejects custom resident
settings; choosing custom settings cannot make retrying that Load succeed.
The native diagnostic also names the removed Custom server settings section.
Gchat 3 reported this mismatch and retains separate ownership of the Host
launch-validation diagnostic in `engine_host.rs`.

The candidate directs both error surfaces to GInfer Hosts → Model and memory
settings → Choose model settings → Check model settings → Start model with
these settings. Acceptance: the Models alert retains the readable model name
and Hosts link, and the real native automatic-load rejection gives this
working manual-start route while preserving the existing custom resident.
The focused rendered Models suite passes all 51 cases. The first native
lifecycle run stopped before the changed rejection: the container set
`CUDA_VISIBLE_DEVICES` to an empty string, which correctly removes the test's
synthetic GPU from Host inventory. This was an execution-environment error.
The retained recipe leaves that variable unset; Docker has no GPU devices.
The corrected native continuation passes its one lifecycle case, including
preservation of the existing custom resident. The 51 passing frontend cases
were not repeated. ONE `make verify` passes: **3,523 app / 6 skipped,
127 extension, 1,284 native / 28 ignored**, all six critical coverage floors,
lint, types and quality guards. The initial environment failure and corrected
continuation are retained. No startup/admission behavior changes.

Owned worktree `/ai/gchat-worktrees/c3-load-needs-profile-message-20261018`,
branch `fix/c3-load-needs-profile-message-20261018`, base `163025d3c`.
Independent S1 cache/build root
`/media/ron/SSD_RAID/ai/tmp-c3-load-needs-profile-message-20261018`
was removed after the gate; CPU96–103 booking3218 canceled, returned09:53Z.
Donor unchanged; only small evidence remains.
No model/GPU work was used. Retained ed68 native visible wording establishes
the original name/destination correction only; it does not qualify the new
guidance. Fresh installed-GUI and Windows acceptance are not claimed.
[Result](../../out/c3-load-needs-profile-message-20261018/result.json),
[source binding](../../out/c3-load-needs-profile-message-20261018/source-binding.json)
and [full gate](../../out/c3-load-needs-profile-message-20261018/verify-summary.json)
retain the focused and full checks. Next: coordinator integration.

## MCP duplicate-name protection — C3, October 18

`GUI-MCP-DUPLICATE-NAME` passes Linux native acceptance. Original fix
`42eb97903` (merge `373d706c7`) rejects a new connection whose trimmed name
already exists before saving. Native Save with a different draft command
shows the plain duplicate-name alert and retains the draft in Dark 1500×1000
and Light 1024×800, including a name padded with spaces. Both inspected
screenshots are readable without horizontal overflow. Cancel closes the draft
and returns to the original inactive connection and its saved command/options.
Baseline, post-rejection and final configuration bytes match. The private app
initialized zero MCP servers; an inactive official Browser entry was added by
the app before the baseline snapshot.

The rejection handler, relevant fields/controls, route name list and save
binding match retained native source `ed68c7443`. Current component, route and
tests match C7's **11 focused PASS** and ONE `make verify` PASS: **3,459 app,
127 extension, 1,275 native**, six coverage floors. This evidence-only branch
reuses those gates and passes `git diff --check`.
[Source binding](../../out/c3-mcp-duplicate-name-20261018/source-binding.json)
and [result](../../out/c3-mcp-duplicate-name-20261018/result.json) retain the
comparison, observations and two screenshots. Native input used XTest;
the inspector only read state. No tool, account, model/GPU or Windows
acceptance is claimed.

Owned worktree `/ai/gchat-worktrees/c3-mcp-duplicate-name-20261018`, branch
`docs/c3-mcp-duplicate-name-20261018`, base `bb194ff03`. Private S1 app/Host,
keyring/D-Bus, Xvfb and observer stopped; owned SSD root
`/media/ron/SSD_RAID/ai/tmp-c3-mcp-duplicate-name-20261018` removed.
CPU96–103 booking3211 canceled; returned09:30Z. Donors unchanged, no hold.
Only small evidence remains. Next: coordinator integration and row closure.

## MCP required-field guidance — C3, October 18

`GUI-MCP-REQUIRED-FIELDS` passes Linux native acceptance. The merged fix
`bbd2b1358` (`d47f08051`) rejects blank STDIO commands and HTTP/SSE addresses
with plain provider-instruction alerts before saving. Native Save keeps the
named draft open in Dark 1500×1000 and Light 1024×800. All six inspected
screenshots show readable guidance and controls without horizontal overflow.
Cancel closes the draft and returns to the empty visible connection list;
no probe connection is saved. After-dark and final configuration bytes match.
The sole config entry is the app-generated inactive official Browser tool.

The rejection handler, required-field labels, alert and Save/Cancel controls
are unchanged between retained native source `ed68c7443` and base `f15627195`.
Current component/tests exactly match the retained **11 focused PASS** and
ONE `make verify` PASS: **3,459 app, 127 extension, 1,275 native**, six coverage
floors. This evidence-only branch reuses those gates and passes
`git diff --check`. [Source binding](../../out/c3-mcp-required-fields-20261018/source-binding.json)
and [result](../../out/c3-mcp-required-fields-20261018/result.json) retain the
comparison, observations and six screenshots.

Native input used XTest; the inspector only read state. Preparation first
seeded one directory above the app's actual data directory, allowing default
Exa initialization without tool calls. The app was stopped and corrected
before accepted capture; that launch initialized zero MCP servers. No valid
connection, tool process, account, model, GPU or Windows acceptance is claimed.

Owned worktree `/ai/gchat-worktrees/c3-mcp-required-fields-20261018`, branch
`docs/c3-mcp-required-fields-20261018`. Private S1 app/Host/keyring/D-Bus/Xvfb
and observer are stopped. Owned SSD root
`/media/ron/SSD_RAID/ai/tmp-c3-mcp-required-fields-20261018` was removed;
CPU96–103 booking3202 canceled, returned09:25Z. The inactive RC donor is
unchanged, without a hold. Only small evidence remains. Next: coordinator
integration and canonical row closure.
## Missing hardware profile recovery guidance — Gchat 3, October 18

`GUI-NO-PROFILE-MESSAGE` now directs a rejected launch to the current controls:
**Advanced graphics-card setup options** when shown, then **Graphics-card
setup**, card selection, and **Measure graphics cards** or **Measure again**.
During unfinished local setup the advanced section contains these controls;
afterward and on remote Hosts they appear directly. Profile measurement,
launch policy and model settings are unchanged.

The real `HostProcesses::validate_launch` regression reproduces the old
message as one expected failure. The candidate reports the current controls;
a saved profile then permits validation without spawning an Engine. Focused
Host tests pass **8 / 2 existing ignores**; affected all-targets check and
clippy pass. ONE `make verify` passed **3,520 app tests / 6 skips**, lint
(five existing warnings), types and preceding guards, then stopped because
the isolated dependency copy omitted the extension workspace's Vitest.
After copying that exact workspace from the untouched donor, only the
unfinished stages continued: **127 extension tests, six coverage floors,
1,285 native tests / 28 ignores**, all passing. The original full command
exited 2; completion is its passing prefix plus this bounded continuation.
App coverage was preserved and not rerun. Future isolated copies must include
`extensions/ginfer-extension/node_modules` and check its Vitest entrypoint.
[Result and limits](../../out/gchat3-missing-profile-guidance-20261018/test-result.json).
Only isolated Linux automated behavior is claimed; installed GUI and Windows
acceptance remain outside this wording fix.

Owner Gchat 3; branch `fix/gchat3-missing-profile-guidance-20261018`, worktree
`/ai/gchat-worktrees/gchat3-missing-profile-guidance-20261018`, base `121977256`.
Independent S1 test root
`/media/ron/SSD_RAID/ai/tmp-gchat3-missing-profile-guidance-tests-20261018`
used the inactive RC donor read-only, CPU104–111/socket1 shared lock,
nice10/max8 and four explicit approved catalogs. Tests finished 09:35Z;
booking3214 returned 09:36Z. Parent inspected the raw results; the 38.22GB owned fixture and three terminal
containers were retired at 09:39Z, retaining only result JSON and short summary.
No GPU, shared catalog or Ron install was used. Next: merge the patch; native
Windows SM86/SM89 bundled-Host qualification has priority over catalog mirror.
## Pairing storage prerequisite — Gchat 3, October 18 hourly evidence batch

`GUI-PAIR-NEEDS-STORAGE-HINT` passes the retained Linux visible-hint leaf.
The inspected [native Hosts capture](../../out/host-address-native-20261018/storage-hint.png)
shows both discovered **Pair** controls and manual **Pair host** disabled,
each with: “Pairing needs secure storage. Choose Check secure storage above
first.” **Check secure storage** is visible above them. The English Dark
1200×800 capture is from release `ed68c7443`, after source fix `7fb91b098`
(merge `086a037f0`). It establishes readable guidance beside the controls;
no pairing action was taken.

The current route, its tests and `CredentialSetup` match passing gate
`d16521c19` at this batch's base `121977256`. Retained tests cover discovered
and manual controls, accessible descriptions, readiness enabling pairing and
dispatch, and Skip preserving the prerequisite. The discovered-control test
also checks removal of its description after readiness. The existing ONE
`make verify` passed **3,469 app, 127 extension and 1,276 native tests**, with
six frontend skips and 28 Rust ignores. No suite or app was repeated.

This closes the observed visible-hint defect. It does not claim a complete
native Check-to-Pair transition, pairing success, screen-reader speech,
Light appearance or Windows acceptance. The cited isolated fixtures are
already stopped and retired. This documentation-only hourly batch uses
`git diff --check`; no new build, HOME, booking or SSD root was allocated.
Owner Gchat 3; branch `docs/gchat3-gui-evidence-batch-20261018-09`, worktree
`/ai/gchat-worktrees/gchat3-gui-evidence-batch-20261018-09`. The visible-hint
result is ready for the hourly evidence handoff.

## Select appearance in Light — Gchat 3, October 18
## Collapsed-section spacing recovery — C3, October 18

`GUI-CLOSED-DETAILS-GAP` is owned by C3 on
`docs/c3-closed-details-gap-20261018`, worktree
`/ai/gchat-worktrees/c3-closed-details-gap-20261018`, base `a7ab6dc02`.
The original fix `6fb07b18c` (merged `d54a0db25`) remains ineffective: its
closed-summary override sits in Tailwind's base layer, below the utilities
layer that supplies `space-y-3`. The source-text assertion passes despite
the cascade defect; the original reported 66→54 px reduction does not
establish the retained product's behavior.

Native baseline source `ed68c7443` demonstrates the extra 12 px. The closed
manual-Host box is **74 px** high: a 20 px summary, 20 px padding on each
side, 1 px borders and a 12 px summary margin. Closed **Launch Server
Instance** and **Server details** boxes are **66 px** high with the same
20 px summary, 16 px padding, 1 px borders and 12 px margin. A native pointer
click opens the manual section to **210 px**; its first label begins 12 px
after the summary, preserving the intended open-content spacing.
[Closed geometry](../../out/c3-closed-details-gap-20261018/baseline-closed.json)
and [open geometry](../../out/c3-closed-details-gap-20261018/baseline-open.json)
retain these measurements.

Candidate `9ff124a55` moves the closed-state override from base to utilities
and removes the ineffective source-text assertion. **72 focused checks PASS**;
ONE `make verify` PASS: 3,518 app / 6 skipped, 127 extension, 1,284 native /
28 ignored, six coverage floors, lint, types and quality guards. All six
stages exit 0, including the frontend and native desktop/Host builds.

Implementation and Linux native acceptance are **complete**. In Dark
1500×1000 and Light 1024×800, closed sections have **zero summary margin**:
manual Host is **62 px** (baseline 74), **Start a model with saved settings**
and **Model and memory settings** are **54 px** (baseline 66), and advanced
sections are **20 px** (baseline 32). No horizontal overflow is present;
inspected screenshots are readable. Real pointer and Space open/close checks
pass. Space on the focused manual summary closes it to 62 px with zero margin.
[Dark closed geometry](../../out/c3-closed-details-gap-20261018/candidate-closed-dark-wide.json),
[light narrow geometry](../../out/c3-closed-details-gap-20261018/candidate-closed-light-narrow.json),
[dark model geometry](../../out/c3-closed-details-gap-20261018/candidate-models-closed-dark-wide.json),
[light narrow model geometry](../../out/c3-closed-details-gap-20261018/candidate-models-closed-light-narrow.json)
and [keyboard close](../../out/c3-closed-details-gap-20261018/candidate-keyboard-close.json)
retain these checks.

Open sections retain **12 px summary margin and content gap**. Measured open
heights are manual Host 242 px, saved settings 373 px, model/memory settings
194 px, nested **Choose model settings** 658 px, and hardware advanced 606 px.
The actual model advanced section also opens with 12 px summary margin.
Total open height depends on content; the preserved summary-to-content gap
is the acceptance criterion.
[Manual open](../../out/c3-closed-details-gap-20261018/candidate-open-dark-wide.json),
[saved settings open](../../out/c3-closed-details-gap-20261018/candidate-model-open-light-narrow.json),
[model/memory open](../../out/c3-closed-details-gap-20261018/candidate-settings-open-dark-wide.json),
[nested settings open](../../out/c3-closed-details-gap-20261018/candidate-nested-open-dark-wide.json),
[hardware advanced open](../../out/c3-closed-details-gap-20261018/candidate-advanced-open-light-narrow.json)
and [model advanced open](../../out/c3-closed-details-gap-20261018/candidate-model-advanced-open-dark-wide.json)
retain the open-state measurements.

The independent private S1 fixture, Host, keyring/D-Bus, Xvfb and SSH observer
are stopped. Owned root
`/media/ron/SSD_RAID/ai/tmp-c3-closed-details-gap-20261018` and its build
container were removed; CPU80–87 returned09:15Z and booking3180 canceled.
The inactive Gchat 3 RC donor was unchanged, with no remaining hold. Only
small evidence remains in
[the result packet](../../out/c3-closed-details-gap-20261018/result.json).
Next action: merge the fix and evidence. Windows, model/download/profile/GPU
execution and setup behavior remain outside this CSS spacing leaf.

## First-run button spacing — C3, October 18

`GUI-NATIVE-SELECT-LOOK` is closed by the later shared dropdown replacement
and retained Linux native evidence. Original styling `b4bc8692e`, merged as
`3466b0157`, was superseded by `ChoiceSelect` in merge `01b14d5bd`; its native
select CSS and chevron assertion were removed. The current Hosts, Benchmark
and Workspace connections fields use the app-rendered control.

The inspected [Light 1024×800 Hosts capture](../../out/c3-host-locator-deleted-runtime-20261018/native-model-settings-light-narrow.png)
shows Installed model, Reply speedup and Conversation memory format beside
readable input fields. The retained [Light open-menu capture](../../out/c7-dropdown-host-selectors-20261018/after-light-medium-serving.png)
shows readable choices, wrapping and the app palette. These close the remaining
light-theme visual check. The existing
[dropdown acceptance](../../out/c7-dropdown-host-selectors-20261018/result.json)
retains Dark/Light keyboard and popup evidence; no new route-specific native
claim is made for Benchmark or Workspace connections.

`ChoiceSelect`, its dropdown primitive and theme stylesheet are identical at
native sources `8f4d0724f` and `82f17a1ac`, later passing full gate `d16521c19`
and this branch base `a89302f19`. Retain the replacement's **42 focused PASS**
and later ONE `make verify`: **3,469 app, 127 extension, 1,276 native PASS**,
six frontend skips, 28 Rust ignores, lint/types/coverage PASS. This evidence-only
closure uses `git diff --check`, with no repeated tests, app launch or compute.

Owner Gchat 3; branch `docs/gchat3-native-select-look-20261018`, worktree
`/ai/gchat-worktrees/gchat3-native-select-look-20261018`. Only small evidence is
retained in [the result](../../out/gchat3-native-select-look-20261018/result.json).
No new booking, build, private HOME or SSD fixture was allocated. The cited
fixtures are already stopped and retired. Windows native UI remains unqualified.

## Empty project direction — C7, October 18

`GUI-PROJECT-EMPTY-ABOVE` passes its remaining Linux native empty-project
leaf. The [retained screenshot](../../out/c7-project-empty-above-20261018/empty-project.png)
shows the message box above the card and the instruction “Start a new
conversation with ProjectMembershipProbe above”. Original fix `df86386aa`
merged as `d7bfbb629`; its 14 translated direction strings need no further
change. [Result and limits](../../out/c7-project-empty-above-20261018/result.json).

The project route/test and all 14 direction strings match native source
`d7de423c2`, passing gate base `6b7f42daf` and this branch base `23d0f3236`.
That existing ONE `make verify` includes the project copy/order test and
passes 3,513 app, 127 extension and 1,284 native tests, lint/types/guards and
coverage floors. This evidence-only closure uses `git diff --check`; no
repeated fixture, build or suite. Only English native empty-project rendering
is claimed; other locale strings are source-checked. Windows, populated
projects, model loading and inference are outside this leaf.

Owner C7; branch `test/c7-project-empty-above-native-20261018`, worktree
`/ai/gchat-worktrees/c7-project-empty-above-native-20261018`. Only small
PNG/JSON/Markdown evidence remains. No new compute, app, booking, SSD root or
donor custody was allocated. The original isolated native fixture was stopped
06:52Z. Next: merge this closure and take the next open row under rule13.

## Downloads initial inventory — C7, October 18

`GUI-DOWNLOADS-LOADING-STATE` is fixed on
`test/c7-downloads-loading-native-20261018` from `6b7f42daf`.
Before the first successful Host inventory, Models → Downloads now withholds
byte totals and empty-list claims. Checking remains visible while waiting;
an initial failure shows the existing readable error and Refresh downloads.
After a successful refresh, the real inventory and totals appear.

Both regressions fail against unchanged source and pass with the fix:
**50 focused Models/store tests**, affected ESLint and the matching
frontend/Host/desktop build pass. ONE `make verify` passes:
**3,513 app / 6 skipped, 127 extension, 1,284 native / 28 ignored**, lint
(five existing warnings), types, quality guards and six critical coverage floors.
Native Linux screenshots cover [pending](../../out/c7-downloads-loading-20261018/pending.png),
[first failure](../../out/c7-downloads-loading-20261018/failure.png) and
[recovery](../../out/c7-downloads-loading-20261018/recovery.png).
The failure fixture pauses only its own detached private Host; a native
Refresh click followed by resuming that Host recovers the confirmed empty
inventory. Background polling remains enabled, so this does not attribute
recovery exclusively to the click; the focused regression proves that button path.
[Result and limits](../../out/c7-downloads-loading-20261018/result.json).

Owner C7; worktree `/ai/gchat-worktrees/c7-downloads-loading-native-20261018`.
Independent AppDir/HOME/XDG/runtime700, D-Bus/keyring and Xvfb ran on S1
CPU88–95 booking3164. Owned processes stopped by verified PIDs; the disposable root
`/media/ron/SSD_RAID/ai/tmp-c7-downloads-loading-20261018` was removed.
CPU88–95 returned08:53Z and booking3164 canceled.
Read-only donors remain unchanged. Windows, model transfers, payload integrity
and inference are outside this inventory leaf. Main `a7ab6dc02` was merged without rebase, retaining its adjacent failed-download
recovery fix. The combined code passes **54 focused tests and affected ESLint**;
the inventory rendering matches the native-tested build. No second full gate
or native rerun. The temporary merge-check SSD copy was removed, booking3182 canceled and CPUs
returned08:56Z. Next: merge the source/evidence branch.

## Benchmark plain intro — C7, October 18

`GUI-BENCHMARK-PLAIN-INTRO` passes its remaining Linux native wording leaf.
A fresh private release session reached Benchmark by native sidebar click and
wheel scrolling. At 1200×800 the intro, Cold PP, Warm PP / request, C1–C8,
TG definitions and synthetic best-case caveat are readable together without
clipping. [Native screenshot](../../out/c7-benchmark-plain-intro-20261018/benchmark.png)
and [result](../../out/c7-benchmark-plain-intro-20261018/result.json) retain the
capture, source match and limits.

Original fix `a7a4cc588` merged as `00b451755`. Retained native release
`ed68c7443` has the same intro, definitions, caveat and visibility classes as
branch base `85bf776ce`; its later saved-result selector differences are
excluded. The original **12 focused PASS** and later ONE `make verify` at
`71abf1708` (**3,409 app, 127 extension, 1,267 native / 28 ignored**,
lint/types/coverage pass) are retained. The entire Benchmark route/test is
unchanged between that full gate and this branch base. This documentation-only
closure uses `git diff --check`; no repeated build or test gate.

Owner C7; branch `test/c7-benchmark-plain-intro-native-20261018`, worktree
`/ai/gchat-worktrees/c7-benchmark-plain-intro-native-20261018`. Independent
AppDir/HOME/XDG/runtime700, D-Bus/keyring and Xvfb on S1 were stopped by owned
PIDs; CPU88–95 returned08:31Z and booking3160 canceled. The disposable root
`/media/ron/SSD_RAID/ai/tmp-c7-benchmark-plain-intro-20261018` was removed;
only small evidence remains and the donor was unchanged. Windows, model load,
benchmark execution, scoring, performance and later selector/restart controls
are outside this intro leaf. The older scripted-navigation screenshot is
supporting history only.

## First-run model reasons — Gchat 3, October 18

`GUI-FIRST-RUN-MODEL-REASONS` passes its remaining Linux native wording
leaf. The actual **Hosts → Use selected graphics cards** model-choice path
shows a recommended Qwen card with: “Fits your graphics card and free disk
space. GInfer still checks the download and measures your hardware before it
can start.” The inspected dark 1200×800
[native screenshot](../../out/gchat3-first-run-model-reasons-20261018/model-reasons-wide.png)
and [DOM](../../out/gchat3-first-run-model-reasons-20261018/model-reasons-dom.json)
show the complete reason without clipping. The
[final Host state](../../out/gchat3-first-run-model-reasons-20261018/host-final-sanitized.json)
confirms a loaded catalog, zero downloads/instances and idle hardware
measurement. Model choices
were not saved and no download, Ensure, profiling or model start occurred.

Original fix `5b0e37f16` merged as `dd62b4607`. The Host recommendation file
is identical between passing gate `71abf1708` and native source `3928dda90`;
its reason rendering is also unchanged in the 08:55Z main comparison.
Original focused **17 PASS** and the retained ONE `make verify` are reused:
**3,409 web/core, 127 extension, 1,267 Rust PASS**, six frontend skips and
28 Rust ignores; lint, types and coverage floors PASS. This evidence-only
closure uses `git diff --check`, without repeating the suites.

Owner Gchat 3; branch `docs/gchat3-first-run-model-reasons-20261018`, worktree
`/ai/gchat-worktrees/gchat3-first-run-model-reasons-20261018`. Frontend,
debug Host and desktop were built from `3928dda90` on S1 using an independent
copy of inactive RC dependencies, CPUs 72–79 and the socket-1 shared compile
lock. Restoring generated icons omitted by the source archive allowed the
failed desktop stage to resume. The private HOME/runtime700, D-Bus/keyring
and Xvfb app used the read-only development LAN catalog and its own Host at
`https://127.0.0.1:17543`. No GPU or native exclusive lock was held.

The owned fixture
`/media/ron/SSD_RAID/ai/tmp-gchat3-first-run-model-reasons-20261018` stopped
and CPUs 72–79 returned 09:05Z; booking3179 was canceled. Its build, app and
private HOME were removed 09:06Z, releasing 48.84 GB of logical files. Only
small evidence remains in
[the result](../../out/gchat3-first-run-model-reasons-20261018/result.json).
This qualifies development native wording only. Public/release catalog
admission, launch-profile bounds, payload transfer, Engine execution and
Windows are outside this leaf; the shared catalog and inactive donor remain
unchanged.

## Missing saved-settings guidance — Gchat 3, October 18

`GUI-PROFILE-MISSING-WORDING` passes its remaining Linux native leaf. With
one real read-only Qwen 3.8 27B NVFP4 model and no saved settings, **Start a
model with saved settings** explains that nothing fits yet and points to
**Graphics-card setup**, adding matching saved settings and refreshing, or
choosing the model settings below. **Saved model settings** and **Start model**
are disabled. The old draft-format/TP prose is absent. Native dark captures
at 1200×800 and 1024×800 show readable wrapping without horizontal overflow.

Source `fc08e7cbb` merged as `3b4d46f8f`; later wording `2ca421a66` and
selector `c6b7d2bb6` are included. The picker and its regression file are
byte-identical at the passing gate `71abf1708`, native donor `8f7d18f6f`
and closure base `f333b3b47`. Original focused 18 PASS and the later full
gate are reused: 3,409 web/core, 127 extension and 1,267 Rust PASS, six frontend
skips and 28 Rust ignores; lint, types and coverage floors PASS. This evidence-only
branch uses `git diff --check`; no rebuild or repeated suite.

Owner Gchat 3; branch `docs/gchat3-profile-missing-wording-20261018`, worktree
`/ai/gchat-worktrees/gchat3-profile-missing-wording-20261018`. Gchat 1's
immutable output copy returned 08:30Z. The private S1 app connected to the
real bundled Host through its supported installed-menu connection and native
Refresh. Final Host state was one model, zero profiles/instances, no error and
idle hardware preparation. The software-only fixture required that explicit
connection because automatic desktop attach was hardware-guarded. The retained
Host uses its original provider/engine configuration; this is a source-native
frontend leaf, not current Host, multiarch or packaged-release qualification.

The owned fixture
`/media/ron/SSD_RAID/ai/tmp-gchat3-profile-missing-wording-20261018` stopped
and CPU72–79 returned 08:40Z; its app/resources/private HOME were removed
08:41Z. Protected model and donor stayed unchanged. No setup measurement,
Ensure, model start, inference, Engine change or Windows work occurred.
Only small evidence remains in
[the result](../../out/gchat3-profile-missing-wording-20261018/result.json)
and [short summary](../../out/gchat3-profile-missing-wording-20261018/summary.md).
Next action is merging this evidence closure.
## Failed-download recovery controls — C3, October 18

`GUI-FAILED-DOWNLOAD-WORDING` is fixed on
`fix/c3-failed-download-wording-20261018`, worktree
`/ai/gchat-worktrees/c3-failed-download-wording-20261018`, base `16a63c18e`.
Recoverable failed cards now name the visible **Retry download** button.
Known checksum/invalid-format failures offer **Delete partial download**, then
direct users to start again from **Recommended**. Paused jobs retain Resume;
raw diagnostics remain inside closed Technical details.

Host resume preserves partial bytes. A complete corrupt partial therefore skips
HTTP and fails validation again; removing Retry on these cards prevents that
ineffective action. Three rendered regressions fail against unchanged source.
The candidate passes **98 focused checks**, including Retry preserving bytes
and Delete followed by a fresh zero-byte download. Two initial fixture failures
were corrected to match the mocked GPU; no production hardware gate changed.
ONE `make verify` passes at source `203f80fa9`: **3,516 app / 6 skipped,
127 extension, 1,276 native / 28 ignored**; lint (five existing warnings), types,
quality, contracts/assets and six critical coverage floors pass.

Native Linux saved-state cards pass the exact guidance/control check,
Technical details expansion, initially focused Cancel, Cancel preserving both
jobs, and confirmed Delete removing only the checksum journal entry. Dark
1500×1000 and 1024×800 layouts are readable without horizontal overflow.
Fixtures establish native wording and commands, not actual corruption,
disk exhaustion or transfer correctness; no new light-theme or Windows claim.
The initial native build omitted generated 32x32.png. Existing
`build:icon:linux` supplied it before continuing only unfinished Rust/staging;
the build then passed without repeating the frontend or verification gate.

Evidence, screenshots, command receipts and binary hashes:
[`out/c3-failed-download-wording-20261018/result.json`](../../out/c3-failed-download-wording-20261018/result.json).
Original native baseline remains in `out/c7-models-plain-wording-20261018/`.
Owner C3; no Host/Engine source, Chat/Agents, live transfer or model/GPU work.
C7 owns the separate Downloads loading-state leaf with no failed-card overlap.
The independent S1 private processes, forward, five stopped containers and
`/media/ron/SSD_RAID/ai/tmp-c3-failed-download-wording-20261018` build/fixture root
are removed; CPU80–87 returned **08:45Z**. Only small evidence remains.
Source and regressions are merge-ready; no acceptance work remains.
Evidence closure merged as `3928dda90`.

## Advanced launch-field labels recovery — C3, October 18

`GUI-LAUNCH-FIELD-LABELS` passes its remaining Linux native leaf using the
retained `native-model-advanced-dark-wide.png`,
`native-model-advanced-light-narrow.png` and `native-model-settings.json` in
`out/c3-host-locator-deleted-runtime-20261018/`. At 06:16Z the ordinary
**Model and memory settings → Choose model settings → Advanced model settings**
path showed **Draft ahead length (tokens)**, **Drafting graphics cards (TP)**
and **Input batch size (tokens)**. The inspected dark 1500×1000 and light
1024×800 screenshots show readable labels without raw keys or horizontal
overflow. Native controls were exercised and defaults restored.

Original fix `ad5f06640` merged as `f1de0eb2e`; later wording `2ca421a66`
established these current names. Both are ancestors of native source
`82f17a1ac` and closure base `9f2e2e81b`. The label map and input-rendering line
are unchanged between those sources. The entire component has other Host
feedback and appended Flash-control changes, which this evidence does not
qualify. The rendered accessible-label regression remains in
`EngineHostModels.test.tsx`. Original **33 focused PASS** and the later
`d16521c19` full gate (**3,469 app, 127 extension, 1,276 native / 28 ignored**)
are retained. `c48538a27` predates the fix and is not attributed to it.

Owner C3; branch `docs/c3-launch-field-labels-20261018`, worktree
`/ai/gchat-worktrees/c3-launch-field-labels-20261018`. No source/test change,
new build, native session, dependency copy, compute or large disk allocation.
The private native app/helpers stopped 06:18Z; its owned S1 root was removed
07:06Z after borrower returns. Only small evidence remains. C7 released the
duplicate row claim without running a fixture. This documentation-only
closure uses `git diff --check`; no repeated gate. Evidence and limitations:
[`out/c3-launch-field-labels-20261018/result.json`](../../out/c3-launch-field-labels-20261018/result.json).
Windows, model Check/Start, new Flash controls and GPU execution are outside
this label leaf. The remaining action is merging this evidence closure.

## Paused first-run download feedback — C3, October 18

`GUI-FIRST-RUN-PAUSED-ERROR` is fixed. A deliberately paused Host download
carries an informational diagnostic; Welcome previously rendered it as a red
failure directing users to absent Try again/Choose a different model buttons.
Failure panels now require failed status. Paused downloads keep their progress
and Resume downloads. Genuine failure, retry and model reselection remain
covered by the focused file.

The native baseline is retained in
`out/c3-first-run-download-status-20261018/native/paused.png`. The new rendered
paused-to-resumed regression fails against unchanged source, then passes with
`f119c04a9`, preserving all 297,664,406 downloaded bytes. Focused: **33 PASS**.
ONE `make verify` completed with **3,506 app / 6 skipped, 127 extension,
1,276 native / 28 ignored**; lint (five existing warnings), types, quality,
contracts/assets and six critical coverage floors pass. The original gate
stopped on stale external launch catalogs (92,832 versus admitted 82,944).
Only four owned inputs were refreshed from merged GInfer `5825c2e39`; the
failed assertion and unrun native targets then passed, with passed stages
retained. No second full gate. Results, original failure and continuation logs:
[`out/c3-first-run-paused-error-20261018/result.json`](../../out/c3-first-run-paused-error-20261018/result.json).

Owner C3; branch `fix/c3-first-run-paused-error-20261018`, worktree
`/ai/gchat-worktrees/c3-first-run-paused-error-20261018`. Four stopped containers
and the independent S1 SSD cache/build root
`/media/ron/SSD_RAID/ai/tmp-c3-first-run-paused-error-20261018` are removed;
CPU80–87 returned 08:15Z. Inactive Gchat 3 donor unchanged. Only small evidence
remains. No Host/Engine source, Chat/Agents, selected-artifact, Windows,
new native GUI launch or GPU work. Source and regression are merge-ready.
## Small download sizes — C7, October 18

`GUI-SMALL-DOWNLOAD-SIZES` passes the remaining Linux installed leaf.
The retained real-transfer [native screenshot](../../out/c7-managed-downloads-native-20261018/native/downloading-popover.png)
shows **107 MiB / 18.4 GiB** in both Models and its Downloads popover;
the paused capture and DOM show **149 MiB / 18.4 GiB**. The corresponding
Host receipt has 155,975,468 retained bytes. This establishes readable nonzero
progress below 1 GiB without repeating the transfer.

Original source `51c1ee068` merged as `bcf86d320`. The formatter and both
Models/popover components are unchanged between tested native source
`71abf1708` and this branch base `70606ac23`. The retained regression checks
50 MiB and 9.9 GiB; the original focused pass and later ONE `make verify`
(3,409 web, 127 extension, 1,267 Rust; lint/types/coverage pass) remain valid.
See [verification summary](../../out/c7-managed-downloads-native-20261018/verification-summary.json)
and [native result](../../out/c7-managed-downloads-native-20261018/native/result.json).
This documentation-only recovery uses `git diff --check`; no gate repeats.

Owner C7; worktree `/ai/gchat-worktrees/c7-small-download-sizes-native-20261018`,
branch `test/c7-small-download-sizes-native-20261018`. No new build, app,
transfer, booking or scratch copy was allocated. The original private Linux
session stopped and returned 06:39Z; its SSD root/partial were removed. The
shared read-only development catalog remains available. Windows, completed
model integrity and inference qualification remain outside this leaf.

## Assistants empty state — C7, October 18

`GUI-ASSISTANTS-EMPTY-STATE`: deleting the last assistant now explains how to
add another and that chatting still works. The empty default selector says
**No assistant** and is unavailable. Adding an assistant restores selection.
If the saved default was deleted, Settings displays the first assistant, matching
the fallback already used by new chats. Chat behavior is unchanged.

The earlier English guidance was shadowed by a duplicate translation key;
the old test mocked translation keys and missed it. The Settings guidance now
has a distinct key. Regression tests use the actual English resource, reactive
assistant store and delete confirmation. The test-only baseline reproduces both
defects (two failures, two existing passes); all four candidate cases pass.
Affected route lint and the frontend/private desktop/Host builds pass.

Native Linux acceptance passes the real delete confirmation, readable empty
guidance, disabled **No assistant**, enabled **Add Assistant**, and saving
**Writing helper**, which removes the guidance and restores selection. All
input used native clicks and typing; the inspector only read page state.
Screenshots and concise results are in
`out/c7-assistants-empty-state-20261018/`. ONE `make verify` passes without
retry: web3503/6skipped, extension127, Rust1276/28ignored; lint, typecheck,
quality checks and all critical coverage floors pass. The gate uses private
copies of the four corrected catalogs from GInfer `5825c2e39`.

Owner C7; branch `fix/c7-assistants-empty-state-20261018`, worktree
`/ai/gchat-worktrees/c7-assistants-empty-native-20261018`, base `5ce4bab65`.
The private S1 independent AppDir/HOME/XDG/runtime/dbus/keyring/Xvfb session
is stopped; CPU88–95 returned08:14Z. No model, GPU,
Windows installation or shared app data is involved. The disposable SSD root
`/media/ron/SSD_RAID/ai/tmp-c7-assistants-empty-state-20261018` was removed
08:16Z. Only small results, logs and three screenshots remain. Windows remains
unqualified.

## MCP dialog row buttons — C7, October 18

`GUI-MCP-DIALOG-ROW-BUTTONS`: command-option reorder handles are native named
buttons with visible keyboard focus. Options have stable drag and React IDs,
so Space/ArrowDown/Space moves alpha below beta and keeps focus on alpha.
Previously the index-based identity left focus on beta after the same move.
Add/remove controls for options, settings and headers also show keyboard focus.

The original baseline `6aad35fc3` fails the native-button regression. The first
button candidate reproduces the wrong-row focus in both the native app and a
rendered test using the real keyboard sensor. The final candidate passes all
11 focused tests and lint (no errors), plus its frontend and desktop builds.
Private native Linux acceptance passes keyboard reorder, visible focus,
add/remove without submitting, Save/reopen ordering, and Cancel preserving the
saved connection. Screenshots and concise results are in
`out/c7-mcp-dialog-row-buttons-20261018/`. ONE `make verify` passed without
retry: web3459/6skipped, extension127, Rust1275/28ignored; lint, typecheck,
quality checks and critical coverage floors passed.

Owner worktree `/ai/gchat-worktrees/c7-mcp-dialog-row-buttons-20261018`, branch
`fix/c7-mcp-dialog-row-buttons-20261018`. The S1 fixture uses an independent
AppDir and private HOME/XDG/runtime, dbus, keyring and Xvfb. The inert
`/usr/bin/true` connection is inactive at final capture; the existing parent
route enables connections on Save, so it was disabled again natively. No real
connector, model, GPU, Windows or shared app data is used. Native app/helpers
are stopped; CPU88–95 returned07:49Z. The inactive40G SSD build/cache root
`/media/ron/SSD_RAID/ai/tmp-c7-mcp-dialog-row-buttons-20261018` was removed
07:51Z. Only small results, logs and four screenshots remain. Windows is
unqualified. Source, regression tests and native evidence are merge-ready
together on the named branch.
## First-run download status recovery — C3, October 18

`GUI-FIRST-RUN-DOWNLOAD-STATUS` passes the remaining Linux native card-rendering
leaf. A real partial transfer displayed **Downloading model · 0.5%** with speed;
native Models Pause and Welcome navigation then displayed **Paused; resume to
continue · 1.5%**. Evidence and scope are in
[`out/c3-first-run-download-status-20261018/result.json`](../../out/c3-first-run-download-status-20261018/result.json)
and its two native screenshots/DOM observations. Original source `94c43ef24`
and corrected tests `80a2aa885` are merged. The original 20 focused cases and
later full gate (3,470 app, 127 extension, 1,275 native, 28 ignored; lint,
types and coverage pass) remain valid; failed/retry/verifying are covered by
retained rendered regressions. This documentation-only closure repeats no gate.

Source-compatible development desktop `11ce0355d` and debug Host `71abf1708`
were copied independently on S1. Their affected UI/Host sources are unchanged
against base `9bc105c26`; hashes and comparisons are retained. The desktop embeds
a production frontend that rejects private HTTP package URLs. Therefore the
authenticated private Host first-run API admitted the real transfer as fixture
setup; this qualifies native status rendering, not the frontend model-choice
or download-admission flow. Private HOME/XDG, D-Bus/keyring, Xauthority/Xvfb and
native pointer input were used; inspector access observed only. No Windows,
complete-download integrity, hardware profile, model load or GPU claim is made.

The paused card also showed misleading failure guidance pointing at absent
buttons. That separate defect is recorded as `GUI-FIRST-RUN-PAUSED-ERROR` and
is fixed above. Owner C3; branch
`fix/c3-first-run-download-status-20261018`, worktree
`/ai/gchat-worktrees/c3-first-run-download-status-20261018`. Private app, Host and
helpers stopped, the 297 MB partial and own S1 root
`/media/ron/SSD_RAID/ai/tmp-c3-first-run-download-status-20261018` were removed,
and CPUs returned 08:01Z. Donors/shared catalog remain untouched. Only small
evidence and source remain. Check: `git diff --check`; merged main `0b98adfc5`.

## Secure-storage Check-first recovery — C3, October 18

`GUI-SECURE-STORAGE-CHECK-FIRST` passes its remaining Linux installed leaf using
the retained packaged acceptance in
[`out/secure-storage-feedback-native-20261018/result.json`](../../out/secure-storage-feedback-native-20261018/result.json).
The inspected `check-before.png` shows the initial storage card with primary
**Check secure storage**, secondary **Skip for now**, and no setup button.
Native pointer navigation then reached Hosts, where the newly mounted card was
unchecked; an explicit Check reached **Secure storage is ready.** at 03:05:40Z
and remained visible at 03:07:06Z in `hosts-check-settled.png`. The initial
Hosts state is recorded in the packet, rather than a separate screenshot.

Original source fix `9cc84a6b9` is an ancestor of both the tested release
`ed68c7443` and current base `faa9c326b`. The same `CredentialSetup` is mounted
by Hosts. Its Check-first condition, primary-button variant, explicit-check
handler and ready panel are unchanged. Current component differences are the
unchecked hint wording and clearing a vault message on Cancel; other Hosts
controls have changed but its storage-card integration is unchanged. Neither
difference changes this acceptance. The retained UI does not qualify the new
hint wording or Welcome card order.

The original 10 focused cases passed (Bubbs mailbox, October 17 17:26:47Z).
The retained regression still covers `can_install: true`: no setup button
while unchecked, then setup offered after an explicit unavailable result.
Native keyring installation/admin approval was not exercised. The earlier
`c48538a27` full gate predates this fix and is not its verification; the later
passing full gate at `d16521c19`, containing the fix and current component,
is retained in `out/c3-host-residency-controls-20261018/result.json`.
No source or test changed; this documentation-only recovery uses
`git diff --check` and repeats no gate or native session.

Owner C3; branch `docs/c3-secure-storage-check-first-20261018`, worktree
`/ai/gchat-worktrees/c3-secure-storage-check-first-20261018`, base `faa9c326b`.
Gchat 1 and Gchat 3 were notified by row ID. No new compute, build, app session,
dependency copy or disk allocation is required. The original private fixture
was removed at 03:07Z and its CPUs returned; its donor was untouched. Windows,
locked-keyring prompts, passphrase-vault setup and readiness across remount or
restart remain outside this leaf. The accepted locked-keyring launch campaign
is reused, not repeated. Next: merge this closure record and archive the row.

## Host residency controls — C3, October 18

`GCHAT-HOST-RESIDENCY-CONTROLS` is source-complete and passes its signed
acceptance. The shared Host API and desktop/Fleet custom startup settings now
expose optional `flash_host_ram_headroom_gib` and `expert_lfu` (default true).
Blank/null inherits the Engine’s 4 GiB headroom. Explicit whole-GiB values are
forwarded unchanged; the Engine owns limits and admission. Zero warns that no
computer-memory floor is reserved. Edit, save and restart preserve zero/false.
Tested profiles retain their own launch values. Engine code/defaults are unchanged.
Arch signed this shared Linux/Windows contract at 07:16Z on October 18.

Focused verification passed 61 desktop and 58 Fleet rendered cases, typed-option
validation/forwarding and authenticated Host API persistence, restart, quote and
normal child-launch argument regressions, Cargo check and Clippy. ONE `make verify`
on `d16521c19` passed lint, types, quality guards, 3,469 app cases, 127 extension
cases, 1,276 native cases (28 ignored) and all coverage floors. After a normal
merge of main `bd10e0e66` including the separate hardware-feedback fix, all 86
combined Host screen/store cases and `make typecheck` pass on `e549c330b`.
An initially invalid root `yarn typecheck` command was corrected to the documented
Make target; only that check continued. The full gate was not repeated.

These checks use rendered UI/service mocks and the existing fake Engine child
fixture. No installed GUI, Windows runtime, GPU inference, performance, new
profiling or release packaging qualification is claimed. The current Engine
`8c3911145` authority confirms the flat 4 GiB default, explicit zero and LFU on;
an older AUTO design was rejected during recovery before implementation.
Results and effective commands:
[`out/c3-host-residency-controls-20261018/`](../../out/c3-host-residency-controls-20261018/).

Owner C3; branch `fix/c3-host-residency-controls-20261018`, source `497840b01`,
worktree `/ai/gchat-worktrees/c3-host-residency-controls-20261018`.
S1 `AIS-2-8592-L01` used independent copies of Gchat 3's inactive RC dependencies,
CPUs 80–87, nice10/max8 jobs and the socket1 shared lock; no GPU or app session.
CPUs returned 07:36Z. Three stopped containers and the 31.51 GB private SSD root
`/media/ron/SSD_RAID/ai/tmp-c3-host-residency-controls-20261018` were retired;
the donor remains untouched. Only small evidence and the source worktree remain.
Merged as `faa9c326b`; the canonical row is closed and archived.

## Recovered W8 chat-send closures — C3, October 18

`GUI-CHAT-STALE-LOAD-ERROR-SEND-20261017` and
`GUI-CHAT-SMALL-CONTEXT-SEND-BLOCKED-20261017` retained obsolete merge-ready
states after their source fixes and release acceptance had completed. C3
recovered the abandoned Claude RC rows; Gchat 1 confirmed no overlap by row ID.
Both source tips (`47048c447`, `b1c098a17`) are ancestors of current main and
release `ed68c7443`. Existing focused checks (31 and 87 cases respectively)
and each row's single passing `make verify` remain recorded in
`out/stale-load-error-clear-20261017/result.json` and
`out/context-output-reserve-20261017/result.json`; no source or test changed.

The optimized release packet
`out/linux-rc-final-20261017/current-ed68c7443-e2282c336-release/result.json`
and its cited
`local5090-ed68c7443-e2282c336-release-flash-high/gui-dom-evidence.jsonl`
resolve both pending Linux packaged retests. On October 17 the private native
session recorded the ordinary Installed Load failure at 19:17Z (lines 12–13),
then a custom Host with context 8192/C1/vision off/spec none (line 18), Ready
at 19:21:56Z (line 30). New Chat selected the Host instance, retained the visible
prompt with reasoning High, and submitted successfully at 19:22:13Z
(lines 31–36). The completed answer was `RC_OK` at 19:22:25Z (line 39). Thus the
prior Installed Load failure did not block Send after the later successful
Host load, and the 8192-context request succeeded. The native log does not retain
the internal prompt/output reservation counts; no exact budget claim is made.

This closes the two reproduced Linux defects using retained native evidence;
it does not qualify Windows or the unavailable automatic RTX5090 catalog
profile. The model was stopped via the GUI, the app closed normally and the
private Host/helpers exited in the existing shutdown record. C3 allocated no
new compute, model, build or profile. Only this small documentation worktree
`/ai/gchat-worktrees/c3-w8-send-recovery-20261018` and the existing small
result/evidence files are retained. Documentation gate: `git diff --check`.

## Saved model settings editor completion — Gchat 3, October 18

`GUI-HOST-MODEL-EDITOR-SAVE-RESULT-20261018`: after an accepted Save-and-restart,
the editor keeps the old session ID and remains open. A second save sends that
old ID even though the native Host correctly created a replacement session.
Close the completed editor and clear its editing identity/session after an
accepted save, including when only the following host-list read fails. A new
Edit captures the current profile and session. A rejected save or canceled
confirmation must retain the editor and draft for deliberate correction/retry.

Acceptance: reproduce the completed-editor failure on base `2c9b06ba4`; rendered
success/read-failure/reopen and rejection/cancellation coverage; pending actions
cannot repeat the save. Focused tests, lint and ONE `make verify`. Preserve
native stale-session checks, launch settings and Engine behavior. No installed
GUI, real model, GPU or Windows qualification.

Owner `/ai/gchat-worktrees/gchat3-host-model-editor-save-result-20261018`, branch
`fix/gchat3-host-model-editor-save-result-20261018`. Source inspection confirmed
the stale `editingSession` in `EngineHostModels.tsx` and native replacement/
conflict semantics in `ginfer-host/src/service.rs`. The focused repair now
awaits the accepted save before clearing the editing identity/session and
closing the editor. Two rendered regressions cover replacement-session reuse,
failed subsequent reads, cancellation/rejection and explicit retry. Source
and tests are frozen for baseline reproduction and candidate verification.
Private S1 test root
`/media/ron/SSD_RAID/ai/tmp-gchat3-host-model-editor-tests-20261018` is prepared:
35 dependency inputs match the retained offline recipe; preparation booking
3086 returned06:27Z. The coordinator reviewed the effective baseline/candidate
commands, including shell quoting, isolated cache paths, pinned image and the
focused/lint/ONE-verify stages. Baseline execution started06:28Z under booking
3087, CPUs120–127 through06:48Z, socket1 shared compile lock, nice10/max8 jobs.
The baseline with only the frozen test failed both new cases at the accepted
save leaving the editor open (48 existing tests skipped). All 50 fixed-source
component tests pass; lint passes with five existing warnings and no errors.
ONE `make verify` passed typecheck, quality checks, 3,414 app tests (six skipped),
127 extension tests and all six coverage floors. All 1,266 native tests pass
(28 ignored, 23 summaries); the single full gate exited 0 at06:37Z without OOM.
The coordinator reviewed the terminal raw results and confirmed both frozen
source hashes still match. CPUs returned06:38Z and booking3087 was canceled.
Owned-fixture cleanup completed06:39Z: removed the 42.33 GB SSD fixture, two
terminal containers and 286.09 MB of local disposable inputs/raw output.
The read-only RC donor remains intact. Fix `f6e609a2c` merged as `014df1845`.
Use independent copies of the inactive RC donor; retain only
`out/host-model-editor-save-result-20261018/test-result.json` and adjacent
summary after cleanup. No installed or Windows acceptance is claimed.

## Laptop context admission catalog prerequisite — Gchat 3, October 18

Bubbs prioritized `LAPTOP-CONTEXT-ADMISSION` ahead of the hardware-feedback
candidate. Land these four Arch-approved full-Text context bounds with or
before GInfer Engine fix `18865fd1d` (accepted packet `dbf4674c4`):

| Exact profile ID | Previous context | Admitted context |
| --- | ---: | ---: |
| `rtx3090-qwen38-groupwise-int-dflash2-q4-tp1-c1-168k-int8` | 172032 | 161792 |
| `rtx4090-qwen38-groupwise-int-dflash2-q4-tp1-c1-149069-int8` | 149069 | 138240 |
| `rtx3090-qwen38-groupwise-int-dflash2-q4-tp1-c1-168k-int8-vision-calculated` | 92832 | 82944 |
| `rtx4090-qwen38-groupwise-int-dflash2-q4-tp1-c1-149069-int8-vision-calculated` | 69423 | 60416 |

The four owning files are GInfer `config/launch-profiles/linux-rtx{3090,4090}-qwen38-groupwise-int-dflash2-q4{,-vision}.json`.
Correct their displayed contexts too; retain IDs, package identity, arenas,
options and historical evidence tiers. The numeric-risk report and signed
disposition are on Codex 1's branch in `docs/laptop-natural-c4-soak/README.md`
and `bench/reports/laptop-context-admission-20261018/gchat-numeric-risk.json`.
This metadata repair adds no model/device/Vision qualification.

The private catalog generator input mirrors all four entries. The selected
live catalog contains only the two Text entries; its pending Vision entries
remain omitted. C7 and C4 authorized a metadata-only atomic overlay during the
active package GET: preserve the service PID, URLs, payload identity and exact
263298-byte catalog size. Context values were overlaid at 07:13Z and display
names at 07:18Z. A fresh coordinator GET returned 200 with the same 263298 bytes
and the two corrected Text profiles. The service and package symlinks are
unchanged. Original generation receipts remain historical evidence; separate
value and name overlay receipts record the changed metadata.

Acceptance: focused existing Host supplied-catalog validation with all four
corrected source catalogs, exact mirror comparison, and ONE `make verify`.
No native Engine code, installed GUI, GPU/model run or Windows qualification.
Owner source trees are `/ai/gchat-worktrees/gchat3-context-profile-bounds-20261018`
(base `cf670bced`) and `/ai/ginfer-worktrees/gchat3-context-profile-bounds-20261018`
(base `8c3911145`), both on `fix/gchat3-context-profile-bounds-20261018`.
Results live in `out/laptop-context-admission-20261018/`. The independent S1
SSD fixture `/media/ron/SSD_RAID/ai/tmp-gchat3-context-profile-bounds-tests-20261018`
uses the inactive RC donor without writes to it. All 35 dependency inputs and
the six frozen source/catalog inputs match; all four owning catalogs equal
their generator-input copies. The coordinator inspected the effective argv:
existing Python packaging tests, the exact Host supplied-catalog test, then
ONE `make verify`, retaining the explicit four-file `GINFER_PROFILE_CATALOGS`
through every stage. The durable run started 07:19Z under booking 3123,
S1 CPUs 120–127/socket1 shared compile lock, nice 10/max 8 jobs, no GPU.
The exact supplied-catalog test passed (one executed, 280 filtered); the
existing packaging suite passed five cases and skipped five Windows-only
cases. ONE full gate passed lint (zero errors, five existing warnings),
typecheck, quality checks, all six coverage floors, 3441 app/core tests (six
skipped), 127 extension tests and 1275 native tests (28 ignored, 23 summaries).
It exited 0 at 07:27Z without OOM; CPUs returned 07:28Z. The coordinator
reviewed raw results, exit bytes and all six unchanged source/catalog hashes.
The normal build staged all 38 profiles as an exact ordered merge of the four
sources, including the four corrected bounds and names. Cleanup finished
07:30Z: removed the 42.34 GB owned S1 fixture, its terminal container and
288.87 MB of local disposable inputs/raw output. The inactive RC donor is
untouched. Retain only the result JSON, short summary and two metadata-overlay
receipts. Both branches are ready for handoff before the Engine source merge.

## Host model controls and host-list read feedback — Gchat 3, October 18

`GUI-HOST-MODEL-CONTROL-RESULT-20261018`: the shared action handler discarded
successful lifecycle snapshots, caught subsequent host-list read failures as
command failures, and stopped multi-copy launches after an accepted copy when
only the read failed. Accepted command feedback now stays separate from
list-read recovery. Start/Stop/Restart/Save-and-restart return snapshots;
new-copy and saved-profile launches return acceptance receipts and must never
be published as snapshots. Acceptance means a request was accepted, not Ready.

Acceptance: baseline rendered regression; publish lifecycle snapshots before
reading; accepted model-control feedback survives failed reads; read-only retry
never repeats a command; new-copy batches continue after read failure; genuine
rejection remains actionable and pending actions cannot duplicate. Run focused
rendered tests, lint and ONE `make verify`. No native, live protocol, GPU,
Engine, installed GUI or Windows qualification. Native behavior is unchanged.

Owner `/ai/gchat-worktrees/gchat3-host-model-control-result-20261018`, branch
`fix/gchat3-host-model-control-result-20261018`, base `dc1ba5028`.
Disposable S1 fixture
`/media/ron/SSD_RAID/ai/tmp-gchat3-host-model-control-tests-20261018`
used independent copies of the inactive RC caches on verified `AIS-2-8592-L01`.
All 35 dependency inputs match the retained recipe. CPUs120–127, the shared
socket1 compile lock, nice10/max8 jobs and no GPU devices were used. Retain only
`out/host-model-control-result-20261018/test-result.json` and adjacent summary
after coordinator raw review and cleanup. The six rendered regressions cover Start, Stop, Restart, actual
Save-and-restart confirmation, two-copy launch receipts and rejected Start with
explicit retry. All six regressions fail on the exact baseline: four lifecycle
cases lack snapshot publication, the second copy never launches after the first
read fails, and the accepted retry lacks feedback. The 42 existing cases were
skipped in that baseline screen. All 48 fixed focused cases and lint pass
(zero errors, five existing warnings). The one full gate stopped at coverage:
3,404 passed, one route test failed, six skipped, with three uncaught errors.
Existing engines route lifecycle mocks returned incomplete snapshots; immediate
publication exposed the invalid fixture at HostCard models.find. Native lifecycle
responses are complete snapshots. Corrected only those route mocks, then ran
the focused route file/lint, failed coverage stage and remaining Rust stage;
the full gate was not restarted. All 25 route tests, lint, 3,405 app tests
(six skipped), 127 extension tests, all six floors and 1,258 Rust tests
(28 ignored) pass. Earlier gate stages, including typecheck and quality checks,
passed. Frozen source/test hashes match before and after verification. The
coordinator reviewed the raw results, including the original failure. S1 CPUs
returned06:20Z and booking3077 was canceled. The owned 42.33GB S1 fixture,
three terminal containers and 286MB disposable local archive/raw files were
removed after review; only the concise result and summary remain. Fix
`a346be937` merged as `2c9b06ba4`. The inactive RC source/node/cargo/debug donor was separately
granted to C7 for independent read-copy and is retained unchanged.
## Retire the reset local Host connection — C3, October 18

`GUI-RESET-STALE-LOCAL-HOST-CONNECTION`: the completed private installed walk
found a stale saved Host beside **This computer**. Reset deletes the selected
`ginfer/host/host.json`, while the per-user `ginfer/hosts.json` is outside App
Data and retains that UUID and certificate. The next local Host receives a new
identity. An obsolete connection cannot authenticate to the replacement.

Acceptance: a successful reset removes only the selected deleted identity from
the shared saved registry; the replacement appears once, and unrelated paired
Hosts and concurrent Manager edits survive. An incomplete or refused reset
preserves the saved connection. Missing identity must never trigger URL-based
removal, discovery, bootstrap or vault access. Keep the existing Agent drain,
Host/Engine teardown and relocation fence. No GPU/model/profile rerun is needed.
See the [registration ownership decision](../decisions/2026-10-18-retire-deleted-local-host-registration-after-reset.md).

The reset reservation captures UUID and certificate only after the selected
Host releases ownership. Completion first verifies its identity file is gone,
then locks and reloads the shared registry before removing an exact match and
its in-memory routes/credentials. It preserves a concurrently changed pin and
all other records. The system reset calls completion after its existing data
deletion and binary restoration. Failures return an actionable error instead
of claiming restart completed. The command restores its windows on failure so
errors after window hiding remain visible and the user can retry.

Owner/inventory: `/ai/gchat-worktrees/c3-reset-stale-host-connection-20261018`,
branch `fix/c3-reset-stale-host-connection-20261018`, baseline `04866d698`.
Evidence is `out/c3-reset-stale-host-connection-20261018/`. Source
`63f9e8a49` merged through `4514dfc73`. Arch signed the registry lifecycle (`7007c37fd`)
at06:26Z and window recovery at06:34Z. Focused Host regressions pass4;
reset cases pass9 with one existing live-GPU ignore. Library check/Clippy
and lint pass. ONE make verify passes:3,406 app tests (six skipped),127
extension tests, all six coverage floors, and1,270 native tests (28 ignored).
Production web and desktop/Host builds pass. Missing generated icons were
prepared using existing `yarn build:icon`; only the failed native build was
continued. All3,239 source and35 dependency bindings matched; exported
binaries matched their built targets. No passed gate was repeated.

Isolated native acceptance passes at06:59Z. Ordinary UI removed the prior
orphan. Making only the private selected Host directory non-writable forced
cleanup refusal: GChat restored its window, showed the exact actionable error,
and retained the identity, saved registration and configuration. Restoring
permissions and ordinary retry restarted GChat. The registry now has exactly
one connected local identity, `08d55660-11dc-471c-817c-b855428dff50`; both prior
UUIDs are absent, and selected App Data configuration is byte-identical.
Reviewed screenshots cover Light1024×800 refusal and Dark1500×1000 replacement.
Remote/concurrent registry preservation is covered by focused tests.

The native debug candidate is distinct from the earlier installed release;
bundled-file preparation is not a release startup speed measurement. Its
restart outlived the private DBus fixture, so the post-restart secure-storage
card was unavailable; local attachment still succeeded without vault access.
No GPU/model/profile or real account/remote enrollment was run. All private
native processes stopped and CPUs64–71 returned07:01Z (build CPUs 80–87
returned06:47Z). Inactive independent source/build/cache copies under
`/media/ron/SSD_RAID/ai/tmp-c3-reset-stale-host-connection-20261018` were retired
(31.82GB logical bytes). After merge, both literal owned S1 roots were retired
at07:06Z, removing another21.68GB logical bytes and eight exited C3 containers.
The tested candidate, private profiles, release and copied resources are gone;
small failure/native logs and screenshots remain with `final-retirement.json`.
External donors and model inputs are unchanged. No job or resource loan remains.
Next: the separate support-link row awaits Ron's destination decision.

## Gbot task-control failure recovery — October 18

`GBOT-TASK-ACTION-INLINE-ERRORS`: rejected **Stop** and **Resume** requests
previously produced only a short raw-error toast. Each task now keeps plain,
action-specific failure guidance beneath its controls, with technical details
closed until requested. Settings and the companion pass errors to these
controls while retaining their normal refresh. Explicit retry preserves the
same task and action; pending requests still block duplicates and opposites.

Baseline `e0a67a528`; all four rendered Stop/Resume regressions fail at the
missing alert. Fixed focused tests pass 129 cases in three files. ONE
`make verify` passed on S1 CPUs40–47, 05:39:10–05:46:53Z: lint, typecheck,
quality guards, 3,386 app tests (six skipped), 127 extension tests, all six
coverage floors and 1,247 Rust tests (28 ignored). Private offline caches,
socket0 shared lock, nice10/max8 jobs; source, tests and documentation hashes
matched before and after the gate. Private remote scratch was removed and
booking3043 canceled; CPUs returned05:47Z. No task state, approval policy or
backend behavior changed. No VM, native Windows, model or live task was run.
FRESH/OLD remain OFF/original XML/custody Gchat2. Windows not built (dev phase).

Result: `out/gchat2-task-action-inline-errors-20261018/result.json`, with
`SUMMARY.md` beside it. Branch `fix/gchat2-task-action-inline-errors-20261018`.
## Reset preserves relocated App Data selection — C3, October 18

`GUI-RESET-RELOCATED-DATA-RESURRECTION`: the installed release `d0a8d06bf`
retained its old data copy during native relocation around 05:00Z. A subsequent
factory reset cleared the selected `relocated-data` folder but rewrote its
configuration to select the retained default folder, exposing old data after
restart. The coordinator owns that native evidence in the ongoing
`out/c3-current-main-release-20261018/` walkthrough packet; no new native run is
claimed here.

The source candidate preserves installation configuration, including App Data
location and startup preference. It reads the authoritative selection under the
existing relocation write fence, then uses the unchanged Agent/Host/MCP reset
lifecycle and deletion list. No settings file means the normal default folder;
malformed, unreadable or unsafe saved settings return an actionable error before
Host shutdown, window hiding or deletion. Ordinary desktop/CLI fallback behavior
is unchanged. See the [ownership decision](../decisions/2026-10-18-preserve-selected-data-folder-during-reset.md).

Acceptance: reset removes selected threads/models, preserves the old default
sentinel and saved configuration, and subsequent resolution still selects the
cleared folder. Four added native reset regressions cover that case, missing
settings, invalid settings without fallback deletion, and a relocation commit
while reset waits for the write fence. Existing Agent cancellation/timeout and
Host teardown regressions remain intact. All nine focused reset cases passed (one existing live-GPU ignore), as did
eight folder resolver cases, scoped library check/Clippy and lint (zero errors,
five existing warnings). ONE `make verify` passed at05:50:45Z: 3,382 app tests
(six skipped), 127 extension tests, all six coverage floors and 1,251 native
tests (28 ignored). No failure or continuation occurred. Vite/default-desktop
debug build passed at05:52:26Z. The candidate ELF, private pre-install, resource
link and all45 source bindings were checked. Native Reset/confirmation/restart passed05:55Z on the private selected sibling. The selected log sentinel was removed, the retained default sentinel survived and installation configuration bytes stayed identical. General reported the selected sibling after restart; Dark wide/narrow selected-folder and wide confirmation screenshots were reviewed. The old invalid Desktop locator bytes and missing runtimes stayed unchanged. See `out/c3-reset-relocated-data-20261018/native-result.json`. No new GPU/model/profile work,
deletion categories, unselected-path cleanup or cross-device Engine-binary
preservation changes are in scope.

Source self-check: `git diff --check`, scoped Rust parse/format checks and new
decision-link target checks pass. The focused command was `cargo test
--manifest-path src-tauri/Cargo.toml --lib --no-default-features --features
test-tauri,cli factory_reset_ -- --test-threads=1`; the real-GPU case keeps its
existing ignored status. Existing app-folder resolver cases also passed.

Source inventory: owner C3, local worktree
`/ai/gchat-worktrees/c3-reset-relocated-data-20261018`, branch
`fix/c3-reset-relocated-data-20261018`, base `072655126`. The private S1 root
`/media/ron/SSD_RAID/ai/tmp-c3-first-user-setup-20261018` reuses inactive source,
dependencies and debug target after C4 completed its read-copy at 05:41Z.
Booking3051 CPUs 80–87 returned05:53Z after the container and disposable local/
remote source archives were removed. The socket1 shared build ran at nice10.
Packet `out/c3-reset-relocated-data-20261018/` retains commands, source bindings
and results. Retain the worktree for gates and review; the installed baseline
remains owned by the broad walkthrough. Current main `e0a67a528` is merged
normally before gates. The adjacent
native test insertion conflict retains all four reset tests and main's folder
reveal worker regression; the decision index retains both sets of entries.
All35 dependency manifests matched the retained cache. The tested export is
`reset-relocated-candidate/bin/gchat` (SHA256
`70e9aef690f23040ea45b5f3f6cd2f5db40efb993ff683bd6c95f5c2a669c131`),
with a private pre-install copy and linkage to retained runnable resources.
Native app/session/display stopped and booking3039 returned05:56Z. The source and native acceptance are merge-ready; the exported binary is retained until merge.
Shared source/cache is handed serially to the Host-locator gate; the installed
AppDir/home, reset/autostart/folder/badge candidates, runnable resources and
tools remain protected. No GPU/model run is needed.

## Graphics-card setup command results — Gchat 3, October 18

`GUI-HOST-HARDWARE-SETUP-RESULT-20261018`: HostCard discards the accepted
status returned by Measure, Measure again, Continue and Stop setup. If the
following host-list read fails, the controls retain their previous state and
give no accepted-request feedback. Publish the typed hardware status onto the
latest existing host snapshot, then report acceptance separately from read
recovery. Acceptance does not establish completed measurements.

Acceptance: reproduce the missing result on branch base `3399f6768`; rendered coverage
for all four actions, pending protection, failed subsequent reads, read-only
retry and genuine rejection/retry. Store coverage must preserve newer polled
model/instance data, failed-read errors, full lifecycle publications and changed
Host boots; later polling must replace the acknowledged status normally.
Focused rendered/store tests, lint and ONE `make verify`. No native protocol,
Engine, real setup/model, GPU, installed GUI or Windows qualification changes.

Owner `/ai/gchat-worktrees/gchat3-host-model-editor-save-result-20261018`, reused
only after its clean editor fix merged, now branch
`fix/gchat3-host-hardware-setup-result-20261018`, based on `3399f6768` (the
four affected source/test files match `014df1845`). Native inspection confirms
hardware commands return `HardwareProfileStatus`, without snapshot revision or
boot ID. The store distinguishes full lifecycle publication from a partial
hardware update, preserving independent fields and connection errors. The independent S1 offline fixture
`/media/ron/SSD_RAID/ai/tmp-gchat3-host-hardware-tests-20261018` copied the
inactive RC dependencies06:50–06:51Z on CPUs120–127; booking3105 returned06:52Z.
Source was streamed directly to S1 after the local timed work returned. The
first baseline screen found ambiguous setup/model GPU checkbox labels and
queued mock responses leaking after early test failures. Scope selectors to
the setup region and reset response queues between cases; that screen does
not establish all regressions. The corrected baseline finished06:59Z with
16 intended failures and 59 existing cases skipped: eight missing store
publications and eight rendered accepted-result failures. The coordinator
reviewed every failure and the exact baseline/test hashes; no selector or
queued-response failure remains. Booking3112 returned06:59Z. Candidate focused
tests, lint and ONE full gate launched07:04Z on verified S1 under booking3115,
CPUs120–127 through07:18Z, socket1 shared compile lock, nice10/max8 jobs.
Only the two production files were overlaid; all four frozen inputs and 35
dependency bindings match. All 75 focused tests pass (17 store, 58 rendered);
lint has zero errors and five existing warnings. ONE `make verify` passed
typecheck, quality checks, 3443 app/core tests (six skipped), 127 extension
tests, all six coverage floors and 1271 native tests (28 ignored). It exited 0
at 07:12Z without OOM. The coordinator reviewed the terminal raw results,
exit bytes and frozen source hashes. CPUs returned 07:13Z. Cleanup completed
07:19Z: removed the 42.05 GB owned fixture and three terminal containers after
checking no live jobs or readers; the inactive RC donor remains untouched.
Retain only `out/host-hardware-setup-result-20261018/test-result.json` and its
short summary. The priority context catalog prerequisite has been handed off
as GInfer `5825c2e39` and GChat `2b6f00370`; this fix is ready for merge review.

## Host model inventory scan feedback — Gchat 3, October 18

`GUI-HOST-SCAN-REFRESH-RESULT-20261018`: Refresh model list now publishes the
Host's returned inventory before reading the host list. A failed list read
keeps **Model list refreshed.** and the updated model choices, with separate
read-error feedback and a read-only **Refresh host list** retry. That retry
never repeats the scan. A rejected scan keeps its recovery guidance, original
inventory and explicit retry; pending input cannot duplicate either operation.
The native scan route returns a snapshot and also cancels draft-width tuning,
so retrying a list read must not invoke it again. No native behavior changed.

Acceptance: rendered baseline reproduction; authoritative inventory publication
before the read; persistent separate accepted/read outcomes; read-only retry,
genuine scan rejection and pending protection; focused tests, lint and ONE
`make verify`. Both new regressions fail on base `d4ec7abab` (40 skipped).
The fixed focused file passes all 42 cases; lint has zero errors and five
existing warnings. ONE verify passed 05:46:24–05:54:24Z: typecheck, quality and
contract checks, 3,395 app tests (six skipped), 127 extension tests, all six
coverage floors and 1,252 Rust tests (28 ignored, 23 summaries). The coordinator
reviewed actual logs, independently summed native results and checked the
matching post-gate component/test bindings. These checks establish rendered
mocked-command behavior and the Linux source gate. No installed GUI, live
scan, Engine, GPU, Windows or installer qualification is claimed.

Owner `/ai/gchat-worktrees/gchat3-host-scan-refresh-result-20261018`, branch
`fix/gchat3-host-scan-refresh-result-20261018`. The independent eight-CPU S1
fixture `/media/ron/SSD_RAID/ai/tmp-gchat3-host-scan-refresh-tests-20261018`
used the inactive RC donor read-only; all 35 dependency inputs matched the
offline recipe. It ran on AIS-2-8592-L01 CPUs120–127 under the shared socket-1
compile lock, nice10/max8 jobs, without GPU devices. Booking3054 canceled;
returned 05:54Z. The owned SSD fixture (42.33 GB), two exited containers and
285 MB local source archive were removed by 05:56Z. The RC donor is untouched;
only `out/host-scan-refresh-result-20261018/test-result.json` and adjacent
`test-summary.md` remain. Current main has no intervening changes to either
owned source/test file. Status: MERGE READY; next unresolved action is Bubbs’s merge.
## Refresh desktop registration after runtime replacement — C3, October 18

`GUI-HOST-LOCATOR-DELETED-RUNTIME`: the private installed `d0a8d06bf` walk
found Models/Downloads failing with **Runtime for 12.0 must be an existing
absolute executable path**. The saved desktop locator still named the
reset-deleted relocated runtime set. The current default-folder runtime files
existed and the running Host used those valid paths. At 05:21Z, retained path
and process evidence distinguished a stale registration from a deleted live
executable, an incomplete installer or a merely stale UI error:
`out/c3-current-main-release-20261018/remainder-runtime-locator-diagnosis.json`.

The candidate separates strict locator JSON/schema decoding from validation
of saved runtime files. An explicit, fully validated desktop seed replaces
obsolete desktop paths under the existing registration lock. Matching roots
retain their saved management port; the resulting seed is validated again.
A changed configured root registers its own paths without opening, copying,
deleting or stopping the previous root. Discovery without a desktop seed still
rejects unusable saved runtimes. Service registration validation and first-owner
behavior remain intact.

After a successful desktop connection, refresh updates identity/endpoint metadata
only while the locked registration still names the same root. It keeps the
latest registered paths so an older connected client cannot undo a newer
same-root seed, and does not revalidate obsolete files from the saved record.
A concurrently registered different desktop root or a service entry is
preserved. Corrupt JSON, unknown fields and unsupported schemas remain errors,
never silent replacement.
Decision: [Refresh desktop Host registration from current runtime](../decisions/2026-10-18-refresh-desktop-host-registration-from-current-runtime.md).

Acceptance: same-root runtime upgrades and changed-root reset/relocation recover
through a valid seed after the old runtime is deleted; discovery alone refuses
that old registration; connected refresh succeeds without taking over another
owner or reverting a newer same-root seed. Regression cases also preserve
retained old-root data, strict schema/service checks and rejection of an invalid
replacement seed.
All nine registry cases now pass, including all four new behavioral regressions.
Frozen normal merge `82f17a1ac` includes main `d4ec7abab`; the registry source
is unchanged from the original candidate. Host check/Clippy and lint pass.
ONE `make verify` ran 05:54:34–05:58:50Z: its frontend results are valid
(3,393 app tests, six skipped; 127 extension tests; all six coverage floors).

The initial Rust result and native export were invalid: Cargo reused a cached
five-test registry executable despite the correct nine-test source. Git archive
had restored the 05:47:20 commit timestamp, older than the retained 05:49 Cargo
fingerprint. The original zero-exit outcome remains recorded in
`out/c3-host-locator-deleted-runtime-20261018/cargo-cache-mismatch.json`.
After that build ended, all 3,232 regular archived tracked inputs received fresh
mtimes without content changes; all 44 source bindings still matched. Future
archive staging must normalize tracked-input mtimes before retained target
reuse and confirm the changed regression names in focused output.

The bounded continuation ran 06:01:23–06:05:51Z: the nine focused registry tests,
Host check/Clippy, the original seven `make test-rust` suites and desktop/Host
native rebuild all pass. Corrected native verification reports 1,256 passes and
28 existing ignores, including the four cases absent from the stale result.
No second full verification ran; the valid frontend and Vite results were
retained. Changed-source native acceptance passed06:11–06:18Z.

Owner Codex 3; worktree `/ai/gchat-worktrees/c3-host-locator-deleted-runtime-20261018`,
branch `fix/c3-host-locator-deleted-runtime-20261018`, frozen source `82f17a1ac`.
Only the registry source and subject/decision records change. The private S1 root
`/media/ron/SSD_RAID/ai/tmp-c3-first-user-setup-20261018` reused source,
dependencies and debug target; all 35 dependency manifests and 44 source bindings
matched. Booking 3062 used CPUs 80–87, socket1 shared lock, nice10/max8 jobs,
pinned container and routed offline dependencies. Both exited containers and
local/remote source archives are removed; returned 06:07Z.

Immutable exports are `host-locator-candidate/bin/gchat` (256,470,416 bytes)
and `host-locator-candidate/bin/ginfer-host` (56,649,776 bytes) beneath that root.
Both are checked ELF files with private pre-install and retained runnable
resource linkage. Packet `out/c3-host-locator-deleted-runtime-20261018/` holds
`result.json`, `terminal.json`, `summary.md`, the first outcome and corrected
logs. The whole shared source/target/cache stage is handed back to parent;
exports remain pending merge; the inactive source/debug/dependency cache stage
was retired06:12Z (34.7GiB allocated). C4 and C7 donor copies are terminal.
No GPU, model or new dependency ran in these gates.

Native acceptance used the same private HOME with its untouched stale locator.
A candidate-only resource overlay supplied the corrected Host to the ordinary
startup installer. The saved Desktop registration now names the selected root,
all four selected runtime executables exist, and the running Host uses them;
the old four deleted runtime paths remain absent. Models and Downloads refresh
complete without alerts. Connect account service succeeds and shows the Google
and Microsoft setup cards with no connected accounts; no OAuth sign-in ran.
The no-model Host settings and advanced controls were exercised and restored.
Dark1500×1000 and Light1024×800 screenshots were visually reviewed: readable,
without horizontal overflow. Model Check/Start stay disabled without a model.
The unoptimized debug resource hashing delay is not release timing evidence.
Native3073 returned06:18Z. Receipts and screenshots are in the same packet;
next is the architecture/merge handoff and retirement of the remaining fixture.
owned source/test file. Status: CLOSED scoped source row; source c2bd37df0 merged as dc1ba5028, ancestry verified.

## Gbot permission decision failure recovery — October 18

`GBOT-APPROVAL-INLINE-ERRORS`: failed **Allow** and **Deny** requests previously
produced only a short raw-error toast, leaving the permission card without
persistent recovery guidance. The card now explains which decision failed,
keeps the error beside the original request and offers the same decision for
an explicit retry. Technical details stay closed until requested. Settings and
the companion pass failures to this card while retaining their normal refresh.
Pending decisions still prevent duplicate or opposite submissions.

Baseline `4ead3f88f`; all four rendered Allow/Deny regressions fail on the
missing alert. The fixed focused run passes 123 tests in three files. ONE
`make verify` passed on S1 CPUs40–47, 05:26:40–05:34:20Z: lint, typecheck,
quality guards, 3,379 app tests (six skipped), 127 extension tests, all six
coverage floors and 1,229 Rust tests (28 ignored). Private offline caches,
socket0 shared lock, nice10/max8 jobs; source, test and documentation hashes
matched before and after the gate. The private remote tree was removed and
booking3033 canceled; CPUs returned05:35Z. No approval policy or backend
behavior changed. No VM, native Windows, model or live permission was exercised.
FRESH/OLD remain OFF/original XML/custody Gchat2. Windows not built (dev phase).

Result: `out/gchat2-approval-inline-errors-20261018/result.json`, with
`SUMMARY.md` beside it. Branch `fix/gchat2-approval-inline-errors-20261018`.

## Linux Launch at startup XDG path — October 18

`GUI-LINUX-AUTOSTART-XDG-PATH` is merge ready with focused, full-gate, build
and private native acceptance passing. The installed Linux release `d0a8d06bf` launched through
its normal AppRun with a private HOME, `XDG_CONFIG_HOME=$HOME/config`, and no
`$HOME/.config`. Enabling **Settings → General → Launch at startup** produced
a visible failure. The exact console error at 04:50:19Z, `No such file or
directory (os error 2)`, was captured from badge candidate `72c76c51a`, whose
startup source is identical to that release. The saved console observation is
`out/c3-current-main-release-20261018/autostart-console.json`. The cached
`auto-launch 0.5.0` implementation ignores XDG config and calls nonrecursive
`create_dir` for `HOME/.config/autostart`, establishing the missing-parent cause.

The candidate owns Linux's `autostart/GChat.desktop` beneath Tauri's resolved
configuration directory and recursively creates its parents. Enable records
the AppImage, extracted AppDir's AppRun, or ordinary executable as one quoted
Exec argument. Read and disable use that same entry; failures identify the
affected directory or file. Settings and startup reconciliation share the
native commands, read back the actual state, and save the preference only after
success. Windows keeps the existing plugin registry owner. The existing opt-in
policy remains in force. See the
[ownership decision](../decisions/2026-10-18-own-linux-xdg-autostart-registration.md).

Acceptance: in a disposable private installed Linux session with the reported
HOME/XDG layout, enable must create only the selected XDG startup entry, show
enabled after reopening General, and record the packaged launch target.
Disable must remove only GChat's entry and show disabled after reopening.
Filesystem rejection must report failure and restore
actual state without persisting success. No login/reboot, Windows runtime,
fresh installer, GPU or model qualification is claimed by this source change.

Five native regressions cover fresh missing parents, a supplied XDG config
root, filesystem failures, packaged/ordinary launch targets, and literal Exec
escaping. Shared-service tests cover command routing, readback and failure
without saving success; rendered General tests exercise enable/disable and
failed-toggle recovery. The focused commands were:

```bash
yarn workspace @gchat/web-app test src/lib/__tests__/launchAtStartup.test.ts src/routes/settings/__tests__/general.test.tsx src/providers/__tests__/DataProvider.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml --lib --no-default-features --features test-tauri,cli linux_autostart -- --test-threads=1
```

Inventory: C3 worktree
`/ai/gchat-worktrees/c3-linux-autostart-xdg-20261018`, branch
`fix/c3-linux-autostart-xdg-20261018`. Current main `4ead3f88f` was merged
normally before gates. The first focused run retained 48 passes and two failures:
the existing General fixture replaced JSDOM's real Window with an object spread,
which drops its non-enumerable `document`; the new asynchronous startup checks
therefore had no default container. The fixture now assigns only the mocked
`core` property onto the real Window. Product code and assertions are unchanged.
Original log: `out/c3-linux-autostart-xdg-20261018/focused-frontend-first-failure.log`.

Corrected source `7e49b9d0d` is pushed. All 50 focused frontend cases and five
native cases pass; scoped library check/Clippy and lint pass. ONE `make verify`
ran05:32:01–05:37:04Z and passed 3,380 app tests (six skipped), 127 extension
tests, all six coverage floors and 1,234 native tests (28 ignored). No second
full verify ran. Vite/default desktop build passed05:38:41Z.

The immutable `autostart-candidate/bin/gchat` beneath the existing S1 root is
255,728,432 bytes, SHA256
`6110349de61393d7022452a0757157630f73200f65882c135c223dff29136889`.
ELF, private pre-install and runnable-resource link were checked05:38:54Z;
46 source/dependency bindings still matched. Both exited containers and local/
remote disposable source archives are removed; booking3036 returned. Shared
source/dependency/target caches remain for the serial reset/locator work.
The tested candidate is retained pending merge; AppDir/home, tools and runnable
assets remain protected. No GPU or model ran in these gates.

Private native acceptance passed05:40–05:41Z using that export and the original
HOME/XDG layout. Enable created `XDG_CONFIG_HOME/autostart/GChat.desktop` with
the immutable AppDir/AppRun target while `HOME/.config` remained absent.
Reopening General retained On. Disable removed the entry, and reopening retained
Off; the installation preference is restored to disabled. Reviewed Light1500×1000
and Dark1024×800 views are readable without horizontal overflow. Filesystem
rejection remains covered by the focused native/rendered cases; no GUI rejection
was injected. App/private session returned05:41Z; Xvfb remains for the next two
checks. No login/reboot or Windows runtime is claimed. Next: coordinator merge.
Packet: `out/c3-linux-autostart-xdg-20261018/{result.json,terminal.json,summary.md}`.
## First-run Retry after background recovery — C4, October 18

`GUI-FIRST-RUN-RETRY-FOLLOWUPS` fixes both follow-ups to merged `16a4b2f25`.
Retry now wakes retained maintenance failures at GPU and complete as well as
storage and models, preserving saved choices. If the monitor clears the error
before the click arrives, Retry quietly returns current status without writing
unchanged progress or waking maintenance. Explicit download, profiling and
startup Resume actions retain their existing behavior.

The two Host regressions cover GPU/complete recovery and the stale-click race
at GPU/storage/models/complete; the latter prevents disk publication to verify
that refreshing status needs no write. Focused native Linux Host tests passed
19 cases (one existing disk-specific case ignored), with Cargo check and strict
Clippy also passing. ONE `make verify` stopped at root coverage because the
fresh private source stage omitted generated `core/dist`. Its preceding lint,
typecheck and contract stages passed. After building core from the exact staged
source, only the failed coverage stage and remaining Rust suites were run:
3,378 app/core tests, 127 extension tests, all six coverage floors and 1,249
Rust tests passed (28 ignored). The original failed invocation is retained in
the result; no second `make verify` was run. Fresh isolated source stages must
build core before these gates.

Owner C4; branch `fix/c4-first-run-retry-followups-20261018`, baseline
`50aa7e1cc`, local worktree
`/ai/gchat-worktrees/c4-first-run-retry-followups-20261018`. Source hashes matched
before and after the native gate. S1 used CPUs112–119, socket1 shared, nice10
and offline dependencies in a private SSD source/cache copy. The inactive C3
donor was unchanged and returned immediately after copying. Checks finished
05:53:31Z; the two stopped containers and owned 21 GiB SSD root
`/media/ron/SSD_RAID/ai/tmp-c4-first-run-retry-followups-20261018` were retired,
and booking3047 returned. No GUI, Windows, GPU or model run was performed.
No Engine source changed; Engine CTest is not required. Native test evidence:
`out/c4-first-run-retry-followups-20261018/result.json`, with a short summary
and exact commands beside it. Next: coordinator merge.

## Gbot companion task-load retry — October 18

`GBOT-COMPANION-TASK-LOAD-RETRY`: a failed task or approval read previously
cleared the companion history and disabled Send without a recovery control,
even for a connected bot with a saved model. The companion now explains that
tasks and approval requests could not load and offers **Retry loading tasks**.
The retry reads state, tasks and approvals; it sends no task action. It disables
the retry while loading, preserves the unsent draft through repeated failures,
and restores history, approval requests and Send after a successful read.
The raw cause remains in closed Details; misleading setup and empty-history
prompts stay hidden while loading has failed.

Baseline `ca25804f6`; rendered cases cover failures of each read, repeated
failure, duplicate-click prevention, draft preservation and successful recovery.
Both regressions fail baseline because Retry is absent; all 40 focused tests
pass. ONE `make verify` passed on S1 CPUs96–103, 05:14:10–05:21:54Z:
lint, typecheck, quality guards, 3,371 app tests (six skipped), 127 extension
tests, all six coverage floors and 1,229 Rust tests (28 ignored). Source and
test hashes matched before and after the gate. The private remote tree was
removed and booking3020 canceled; CPUs returned05:22Z before the next booking.
No backend, approval policy or task state changed.
No VM, native Windows, model or live task was run. FRESH/OLD remain OFF with
original XML, in Gchat 2 custody. Windows: not built (dev phase).

Result: `out/gchat2-companion-task-load-retry-20261018/result.json`, with
`SUMMARY.md` beside it. Branch `fix/gchat2-companion-task-load-retry-20261018`.
## Packaged CLI terminal-install detection — C3, October 18

`GUI-CLI-PACKAGED-PATH-DETECTION` corrects Settings → General → terminal
command detection. The private current-main release `d0a8d06bf` reproduced
**Installed at …/current-main-appdir/usr/bin//gchat-cli** with only Uninstall
available, although the inherited terminal PATH had no `gchat-cli`. The
packaged AppRun prepends its private directories to PATH; `which` therefore
mistook the bundled executable for a terminal installation. Baseline receipt:
`out/c3-current-main-release-20261018/cli-false-installed.json`.

The candidate traverses PATH directly for the platform's CLI executable,
excluding the private `resources/bin` directory and, on Linux, the AppDir
captured by Tauri from `APPDIR`. The approved GTK AppRun hook also sets
`APPDIR` when running an extracted AppDir. Directory canonicalization excludes
aliases into the bundle while retaining an external installed file symlink;
the executable target itself is not canonicalized. Detection continues past
the bundle to the first external executable. Without an AppDir, a real system
`/usr/bin` installation remains eligible. Windows checks `gchat-cli.exe` on
PATH without `where`'s implicit current-directory lookup; the separate per-user
desktop-linked launcher remains eligible. Install, uninstall and launcher
ownership are unchanged; C4 owns the separate standalone-launcher work.

Acceptance requires the packaged-only native case to offer Install, a real
terminal installation to report its external path, and existing CLI install
and uninstall behavior to remain intact. Five filesystem regressions cover
bundle-only lookup, PATH ordering after AppRun, system installation without
AppDir, directory aliases versus installed file symlinks, and missing or
non-executable commands. Focused command:
`cargo test --manifest-path src-tauri/Cargo.toml --lib --no-default-features --features test-tauri,cli cli_install_detection -- --test-threads=1`.
The five focused Rust regressions, library-scope Cargo check/Clippy and lint
passed. ONE `make verify` passed on S1 CPUs 80–87 (booking3025): 3,369 app tests
(six skipped), 127 extension tests, all six coverage floors and 1,234 native
tests (28 ignored). There was no gate failure or continuation. Vite and the
default desktop debug build passed at 05:25:46Z. The exported source-native
`cli-candidate/bin/gchat` is bound to source `86c3068ad`; ELF, private pre-install
and retained resource linkage were verified. Installed-layout acceptance passed
at 05:32Z with explicit APPDIR and bundled-first PATH: Install was offered, the
CLI installed in private HOME/.local/bin, and reopening General retained the
external Installed path. Uninstall removed the private CLI executable; reopening
General offered Install again. The system bin directory was unwritable. Viewed
Light 1500×1000 and Dark 1024×800 screenshots show readable controls without
horizontal overflow. Windows is not built or exercised.

Current main `b9a56c96c` was merged normally before gates. Its retained
first-run disk-full test already includes the exact folder hydration wait;
all first-run regressions are preserved without another source correction.
The Interface candidate is immutable and excluded from this CLI source.

Inventory: owner C3, branch
`fix/c3-cli-packaged-path-detection-20261018`, baseline `bbc81c2ec`, worktree
`/ai/gchat-worktrees/c3-cli-packaged-path-detection-20261018`. Only
`src-tauri/src/core/system/commands.rs` and this authority are owned by this
row. The shared S1 source/dependencies/native target were returned at 05:26Z; app,
idle Host and private session returned at 05:32Z. The tested CLI export is retained
for integration, and shared private Xvfb remains in use for the next candidate.
Next: coordinator integration, then retire this candidate. Native acceptance
used private HOME and explicit APPDIR/bundled PATH; no GPU,
model, profile, host install or shared terminal PATH mutation. Reuse pinned
routed-offline dependencies only after all retained manifests match. Preserve
current-main AppDir/home, Interface/folder/badge candidates and runnable assets.
Packet: `out/c3-cli-packaged-path-detection-20261018/{result.json,summary.md}`.
## Saved-host connection and refresh feedback — Gchat 3, October 18

`GUI-HOST-CONNECT-REFRESH-RESULT-20261018`: on base `c63557f3b`, Connect
discards its successful Host snapshot and catches a subsequent list-read failure
as a connection failure. The candidate publishes that authoritative snapshot,
preserves the accepted result and gives a separate read-only Refresh host list
retry. A genuine Connect rejection retains its existing recovery/details
and requires an explicit Connect retry. Pending actions cannot duplicate.

Acceptance: rendered baseline reproduction, authoritative publication before
the read, distinct persistent command/read outcomes, read-only retry and pending
protection, then focused tests, lint and ONE `make verify`. No native/protocol,
Engine, installed GUI, network, GPU, Windows or installer changes/qualification.
Owner: `/ai/gchat-worktrees/gchat3-host-connect-refresh-result-20261018`, branch
`fix/gchat3-host-connect-refresh-result-20261018`. Execution uses an independent
booked eight-CPU S1 fixture at
`/media/ron/SSD_RAID/ai/tmp-gchat3-host-connect-refresh-tests-20261018`, then
removes owned copies/builds after results are reviewed. Retain only
`out/host-connect-refresh-result-20261018/test-result.json` and adjacent
`test-summary.md`. Source and two rendered regressions are frozen for the
baseline comparison and gate. The independent fixture preparation passed;
booking3031 returned 05:23Z. Baseline execution started 05:26Z on S1
AIS-2-8592-L01 CPUs120–127, booking3035, with the socket-1 shared compile lock.
Only the frozen tests were overlaid on the exact base for that phase. Both
regressions failed as expected (38 skipped): accepted Connect followed by a
failed read never published its snapshot, and an explicit successful retry
still left the card Not connected. The coordinator reviewed the actual log.
All 40 focused cases pass with the frozen fix; lint passes with zero errors
and five existing warnings. ONE `make verify` passes: 3,374 app tests (six
skipped), 127 extension tests, all six critical coverage floors and 1,229 Rust
tests (28 ignored). The candidate ran 05:27:43–05:35:38Z, exit zero without OOM.
The coordinator reviewed actual logs, terminal states, source/test diffs and
matching post-gate source bindings. Current main has no intervening changes
to either owned source/test file. Booking3035 is canceled; returned 05:37Z.
The owned SSD fixture (42.33 GB), two exited containers and local source archive
were removed by 05:39Z. The RC donor is untouched and only the concise result
and summary remain. Status: CLOSED; source `1fee4844a` merged as `63e13d812`.
These checks establish rendered mocked-command behavior and the Linux source
gate; they do not establish native connection, installed GUI or Windows acceptance.

## Gbot human-help failure recovery — October 18

`GBOT-HUMAN-HELP-INLINE-ERRORS`: Gbot settings and the companion previously
caught failed **Send reply** and **Decline** requests before their help cards
could display the error. Both views now pass these failures to the existing
card handler. The error stays beside the request through normal task refreshes,
the unsent reply remains available, and either action can be retried. Successful
responses still refresh and show the saved reply or declined outcome.

Four rendered integration regressions cover both actions in both views,
including pending feedback, duplicate prevention, preserved drafts, refresh and
retry with the original task/request/response. They fail on baseline
`84d6b23f0` because the inline alert is absent. All 110 focused tests pass.
One `make verify` passed lint, typecheck, quality, hardening, manager and assets
checks, then stopped at an unrelated first-run folder-hydration test race.
The failed coverage and unrun Rust stages pass with
`make test-coverage-critical test-rust`: 3,361 app tests, 121 extension tests,
1,228 Rust tests and all six coverage floors; six app skips and 28 Rust ignores.
This continuation reused Codex 3’s exact timing correction `7fd01cf0a` as a test
source overlay; that separately owned change must accompany integration.
The human-help source hashes remained unchanged through verification.
No backend, task-control or approval policy changed.
No VM, native Windows, model or live task was run. FRESH/OLD remain OFF with
original XML, in Gchat 2 custody. Windows: not built (dev phase).

Result: `out/gchat2-human-help-inline-errors-20261018/result.json`, with
`SUMMARY.md` beside it. Branch `fix/gchat2-human-help-inline-errors-20261018`.
## Interface reset restores the theme — C3, October 18

`GUI-INTERFACE-RESET-KEEPS-THEME`: Settings → Interface promised to reset all
interface settings, but its reset only restored font size and the accent preset.
The independently persisted Light/System theme stayed selected. The candidate
restores the existing Dark default through the shared theme service before
resetting the font to Medium. It waits for completion, disables another reset
while pending and shows failure feedback if the theme service rejects. The
description names the defaults that Reset restores.

Outcome and acceptance: ordinary Reset from Light with a larger text size
restores Dark/Medium, reports success after completion, and preserves the
chosen settings on a rejected theme operation. Existing hook and rendered-route
tests cover those behaviors. The changed-source Linux native acceptance is
**PASS** and the row is **MERGE READY**.

Owner Codex 3; worktree
`/ai/gchat-worktrees/c3-interface-reset-theme-20261018`, branch
`fix/c3-interface-reset-theme-20261018`, original base `d0a8d06bf`, source
`18c405b1d`. Current main `072655126` was merged normally before gates.
Main still lacked the known first-run disk-full test synchronization correction:
the alert can commit before the folder hydration effect. This branch includes
only the same one-line `waitFor` before Retry, preserving all assertions; the
unrelated folder-reveal runtime fix is excluded.

Source `5c53a6cc2` is pushed. Focused Interface hook/route/theme and first-run
suites passed 60 cases; lint passed with zero errors and five existing warnings.
The first and only `make verify` stopped at TS2367: the new default constant
narrowed `initialState.activeTheme` to Dark. The original failure is retained.
The approved correction annotates `initialState: ThemeState`, preserving Auto.
Affected theme9/typecheck and every original unrun guard/coverage/native stage
passed: 3,367 app/core tests (six skipped), 121 extension tests, six floors,
1,228 native tests (28 ignored). Passed stages were reused; no second full
verify ran. Vite and default desktop/custom-protocol debug build passed.

The parent launched the checked candidate at 05:14:21Z with the private
`current-main-home`, preserving Light/Extra Large. Actual Settings → Interface
showed those values. An ordinary Reset click changed them to Dark/Medium; the
retained post-action DOM has the root `dark` class, `--font-size-base: 16px`,
visible Dark/Medium controls and no horizontal overflow at 1500×1000.
The parent reviewed all three screenshots: Light/Extra Large before Reset at
1500×1000, then Dark/Medium at 1500×1000 and 1024×800. Wording and controls are
readable without overflow. Evidence:
`out/c3-interface-reset-theme-20261018/{native-after-reset-wide.json,native-before-light-xl-wide.png,native-after-dark-medium-wide.png,native-after-dark-medium-narrow.png}`.
Packet:
`out/c3-interface-reset-theme-20261018/{result.json,summary.md}`. Immutable
`/media/ron/SSD_RAID/ai/tmp-c3-first-user-setup-20261018/interface-candidate/bin/gchat`
is 255,482,456 bytes, SHA256
`81e922c84d7912bbb239ac3c7f11ba30790f5fbf564eeace2ef7adaea4463eaa`.
Its private pre-install and runnable-resource link were checked at 05:13:59Z.
Both terminal containers and disposable local/remote source archives are
removed; booking3010 returned. Candidate, concise logs and existing shared
source/dependency/target caches remain for parent integration and serial CLI
gates. Native app PID3080914 stopped at 05:15:22Z and its private session ended;
no Host launched. The parent's Xvfb:79 remains retained under booking3001 through
05:32Z. Launch and stop receipts are `native-launch.json` and
`native-terminal.json` in the same packet; only the completed build booking3010
is claimed returned here.
Installed current-main AppDir/home, folder/badge candidates and runnable
resources were preserved. This debug build does not refresh installer qualification.
No dependencies, model/profile, GPU or native settings service change. Next:
merge integration; no further test or build is needed.
## Discovered-host pairing failure guidance — Gchat 3, October 18

`GUI-HOST-NEARBY-PAIR-ERROR-GUIDANCE-20261018`: a rejected Pair for a discovered
host now leaves recovery guidance beside that host. It names sharing on the
other computer and explicit Pair retry, keeps the diagnostic in closed details,
and describes the Pair button accessibly. Refresh and actions on another host
preserve the failure; explicit retry clears only that host's message. Existing
pending protection and accepted-pair/read-failure behavior remain intact.
No native or protocol behavior changes.

The allocated base `072655126` reproduces both rendered defects (two failed,
23 skipped), each at its host card's missing alert. The fixed route passes all
25 focused cases. Lint passes with zero errors and five existing warnings.
ONE `make verify` passes: 3,365 app tests (six skipped), 121 extension tests,
all six critical coverage floors and 1,228 Rust tests (28 ignored). The candidate
chain ran 05:06:30–05:14:36Z, exit zero. Source/test hashes match before and after
the gate. The coordinator reviewed the actual logs, effective commands and
source/test diffs. Main `5c00b46ea` has no intervening change to either owned file.

Owner: `/ai/gchat-worktrees/gchat3-host-nearby-pair-error-guidance-20261018`,
branch `fix/gchat3-host-nearby-pair-error-guidance-20261018`, base `072655126`.
Retained evidence: `out/host-nearby-pair-error-guidance-20261018/test-result.json`
and adjacent `test-summary.md`. S1 AIS-2-8592-L01 CPUs104–111, booking 3009,
used independent offline dependency/cache copies from the unchanged RC donor.
The owned SSD fixture (42.33 GB), two exited containers and local source
archive were removed; returned 05:15Z and booking canceled. Only the concise
result and summary remain. Rendered mocked-command behavior and the Linux
source gate are qualified; live native pairing/network, installed GUI, account,
Engine/GPU, Windows and installer qualification remain separate.

## Gbot Hand back and task resume guidance — October 18

`GBOT-HAND-BACK-RESUME-GUIDANCE`: the desktop viewer and companion previously
implied that **Hand back** continues a paused task. It restores bot control,
while the task remains paused until explicitly resumed. The viewer now explains
that distinction, and companion hints name **Hand back** in Desktop followed
by **Resume task** in Conversation. The service contract and task controls are
unchanged.

All 100 existing settings and companion cases pass, including input closure
and the requirement to resume tasks explicitly. ONE `make verify` passed on
S1 CPUs96–103, 04:43:20–04:51:02Z: lint, typecheck, quality guards, 3,353 app
tests (six skipped), 121 extension tests, all six coverage floors and 1,222
Rust tests (28 ignored). Source hashes matched before and after the gate.
Baseline `fdc7f3a96`; only three UI hints and the matching documentation changed.
No VM, native Windows, model or live task was run.
FRESH/OLD remain OFF/original XML/custody Gchat 2.
Windows: not built (dev phase); shared frontend copy only.

Result: `out/gchat2-hand-back-resume-guidance-20261018/result.json`, with
`SUMMARY.md` beside it. Branch `fix/gchat2-hand-back-resume-guidance-20261018`.
## Network sharing command and refresh feedback — Gchat 3, October 18

`GUI-HOST-SHARING-REFRESH-RESULT-20261018`: a successful sharing change now
publishes the command's authoritative Host snapshot before refreshing the host
list. A failed read preserves the accepted switch setting and completed-action
message, with separate persistent guidance for read and command failures.
Refresh retries only the read; a later authoritative snapshot still controls the
switch. Another sharing change requires an explicit action. No native sharing
or Engine contract changes.

The allocated base `4ba089a88` reproduces all three rendered defects (three
failed, 21 skipped): accepted OFF/ON leave the old setting and a rejected command
lacks persistent guidance. The fixed route passes all 24 focused cases, including
pending duplicate prevention and explicit retry. Lint passes with zero errors
and five existing warnings. ONE `make verify` passed: 3,359 app tests (six
skipped), 121 extension tests, all six critical coverage floors and 1,222 Rust
tests (28 ignored). Candidate chain: 04:49:11–04:57:18Z, exit zero; frozen
source/test hashes match afterward. The coordinator reviewed the actual logs,
effective commands and source/test diffs. Current main `70c61dfb0` has no
intervening changes to either owned file.

Owner: `/ai/gchat-worktrees/gchat3-host-sharing-refresh-result-20261018`, branch
`fix/gchat3-host-sharing-refresh-result-20261018`, base `4ba089a88`.
Retained evidence: `out/host-sharing-refresh-result-20261018/test-result.json`
and adjacent `test-summary.md`. S1 AIS-2-8592-L01 CPUs104–111, booking 2996,
used independent offline dependency/cache copies from the unchanged RC donor.
The owned root `/media/ron/SSD_RAID/ai/tmp-gchat3-host-sharing-refresh-tests-20261018`
(42.32 GB), two containers and local source archive were removed; returned
04:59Z and booking canceled. Only concise result/summary evidence remains.
Source `0f91c1dd2` merged as `072655126`. Rendered mocked behavior and the Linux
source gate are qualified; live sharing/network, installed GUI, account/pairing,
Engine/GPU, Windows and installer qualification remain separate.
## Folder reveal runtime crash — C3, October 18

`GUI-FOLDER-REVEAL-NESTED-RUNTIME`: the pinned current-main release
`d0a8d06bf` crashed at 04:38:54Z when General → Diagnostic logs →
**Open Containing Folder** was clicked. Opener 2.5.3 executes synchronous Linux
`zbus::blocking` inside its async command; Tokio's nested-runtime guard aborts
the app. The app now owns a native reveal command that calls the same
cross-platform opener from `spawn_blocking`, and the frontend uses that command.
Folder selection semantics and file-manager errors are preserved.

Acceptance: the real private folder handler receives the logs folder, GChat
stays responsive, and an unavailable handler returns an error without panic.
Frontend IPC2 and the real-opener Linux runtime-worker regression1 passed.
Corrected library check/clippy and lint passed. The original check command
incorrectly combined all targets with CLI features, disabling the desktop
entry point; that failure is retained and corrected to library scope.

The first/only `make verify` stopped at a new background disk-full test:
3351 app tests passed, one failed, six skipped. Its alert renders directly from
`flow`, while a later `useEffect([flow])` hydrates the retained folder. The test
now waits for the same `/models` assertion before Retry; all assertions remain.
This synchronization correction is pushed in `7fd01cf0a`; the original verify
failure is retained. Authorized continuation passed the first-run file32, app
coverage3352 (six skipped), extension121, all six coverage floors and1223 native
tests (28 ignored). No second `make verify` ran and no passed stage was repeated.
Vite/default desktop custom-protocol build passed05:00:08Z; checked candidate
`/media/ron/SSD_RAID/ai/tmp-c3-first-user-setup-20261018/folder-reveal-candidate/bin/gchat`.
Native Linux acceptance passed05:04–05:08Z: ordinary pointer input opened
private Nautilus in the correct data root with **logs** selected. Its HOME,
runtime, display and D-Bus matched the isolated app. The screenshot was visually
reviewed; subsequent ordinary Interface navigation proved responsiveness.
The real-opener worker test covers an unavailable handler returning an ordinary
error. No native GUI handler failure is claimed. The first direct candidate
launch inherited AppRun libraries and failed before UI at a relative WebKit
child path; using the host desktop environment corrected the fixture. This is
a changed-source custom-protocol debug binary, not a fresh installer/Windows
qualification. Source gates were not repeated. The result is merge-ready.
No model, profile or GPU workload is needed.

Owner/source: Codex 3,
`/ai/gchat-worktrees/c3-folder-reveal-runtime-20261018`, branch
`fix/c3-folder-reveal-runtime-20261018`, baseline `bbc81c2ec`.
The shared S1 stage was handed off after download-count build04:41:46Z.
CPU80–87 booking2993 returned05:01Z; all owned gate containers exited/removed.
Local/remote disposable source archives were removed after checked candidate copy.
The shared stage is handed to Interface; immutable folder candidate is retained.
Execution used socket1 shared lock and nice10;
all35 retained manifests/locks/config matched before exact source staging.
The installed AppDir/home, badge candidate, downloads home, runnable resources
and tools are protected. Evidence:
`out/c3-current-main-release-20261018/{folder-reveal-crash.json,folder-reveal-panic.txt}`;
fix result `out/c3-folder-reveal-runtime-20261018/result.json`.
## GInfer settings ownership — C7, October 18

`GUI-GINFER-PROVIDER-SETTINGS-ADVANCED` is implemented by source commits
`d3c3f77d6` and `dbb8ee2b9`, based on main `25459ffc2`. Models owns ordinary
Load/Stop and package management; GInfer Hosts owns custom startup settings
and saved profiles. Settings retains four application preferences and direct
links to Models and GInfer Hosts. Chat/API automatic loading selects complete
tested profiles and preserves explicit GPU constraints. Superseded global
startup overrides and their extension consumption are removed.

Arch signed at04:46Z. Focused verification passed 57 web, 34 extension and one
native screened-profile regression. ONE `make verify` passed 3,354 app,
127 extension and 1,223 Rust tests, lint, types, guards and coverage floors.
An incomplete focused-test mock was corrected before the full gate. The web
build and native debug build passed; missing ignored generated icon inputs
were supplied from a retained donor before continuing only the native build.

The isolated native Linux check displayed exactly four preferences and used
pointer clicks to reach Models and GInfer Hosts. Screenshots and concise
receipts are in `out/c7-ginfer-settings-owner-20261018/` in this source branch.
This qualifies Settings display/navigation; the fresh fixture remained
Preparing GInfer, so no Host readiness, installed release or model-start claim
is made. Windows was not built (development phase). No model/GPU was used.
All private processes stopped and CPUs64–71 returned at05:08Z.

C7 owns worktree `/ai/gchat-worktrees/c7-ginfer-settings-owner-20261018`, branch
`fix/c7-ginfer-settings-owner-20261018`. The source and native evidence are
ready for merge. Private S1 build/cache root
`/media/ron/SSD_RAID/ai/tmp-c7-ginfer-settings-owner-20261018` is retained only
for immediate reuse by the assigned OpenCode provisioning fix; disposable GUI
HOME/stage were removed after evidence capture.

### Architecture decision — signed04:46Z

Approved ownership: Models owns ordinary Load/Stop and package management;
GInfer Hosts owns custom per-instance startup settings and saved hardware
profiles. Settings > GInfer keeps application behavior (load timeout and
automatic unloading), storage discovery and engine-program location, with
direct links to Models and GInfer Hosts. Remove its global Vision/speculation,
helper, KV, prefill, concurrency and CUDA-Graph controls and their extension
configuration consumption rather than leaving invisible persisted overrides.
The per-model GInfer settings gear is already absent.

The decision also covers ordinary chat/API loading: these currently use
global settings plus the model's native context, whereas Installed Load asks
for a complete tested Host profile. Ordinary automatic starts
use that same tested-profile selection and retain explicit GPU constraints;
already attached running sessions keep their current saved Host settings.
Models' explicit tested-profile Load retains its existing matching-resident
rule. Custom settings remain available through Hosts and its existing
instance attachment path. Do not silently start an unqualified custom profile
or change any tested profile's context, concurrency or options.

Relevant paths are `web-app/src/services/models/default.ts:startModel`,
`extensions/ginfer-extension/src/index.ts:buildGinferConfig`, and
`src-tauri/plugins/tauri-plugin-ginfer/src/managed.rs:load_on_control`.
`use_profile_defaults` already discards provider launch options in native
`options` and chooses an eligible complete profile. HostCard builds independent
instance settings from its own form/saved profile and consumes no provider
launch settings. CLI/native explicit `GinferConfig` remains supported; the
obsolete desktop global configuration is the removed path.

Risks to check: chat/API must not reject a valid non-native tested context;
explicit GPU/order constraints and missing-profile rejection must survive;
an existing custom Host session must not restart or change on a Settings save;
storage/binary/timeout/unload settings must retain their existing behavior.
Source tests should cover these supported transitions and Settings navigation.
No HostCard edits are proposed because Gchat 3 owns its sharing-result work.

## Scheduled tasks brain setup guidance — October 18

`GBOT-SCHEDULE-BRAIN-SETUP-GUIDANCE`: the disabled schedule form previously
said “Save this bot’s inference assignment,” although the adjacent setup uses
**Next: choose a brain** and **Save brain settings**. The hint now says “Choose
a brain, then click Save brain settings before creating a schedule.” It names
the visible action needed to enable scheduling.

The existing rendered missing-settings case checks the new wording and retains
its disabled prompt/Create schedule and blocked submit assertions. All 15
focused tests pass. ONE full `make verify` passed on S1 CPUs96–103,
04:15:30–04:23:16Z: lint, typecheck, quality guards, 3,341 app tests (six
skipped), 121 extension tests, all six coverage floors and 1,220 Rust tests
(28 ignored). Pre/post source hashes matched. Baseline `d0a8d06bf`; copy and
its existing expectation changed only. No VM, native Windows, model or live
scheduled task was run. FRESH/OLD remain OFF/original XML/custody Gchat 2.
Windows: not built (dev phase); shared frontend copy only.

Result: `out/gchat2-schedule-brain-guidance-20261018/result.json`, with
`SUMMARY.md` beside it. Branch `fix/gchat2-schedule-brain-guidance-20261018`.
## Gbot task interruption reason — October 18

`GBOT-TASK-HISTORY-INTERRUPTION-REASON`: task cards previously showed
**Interrupted** and **Resume** without the cause saved by the service. The
Gbot settings and companion conversation now display the latest persisted
interruption reason beneath the task state through one shared component.
For an empty model answer this includes “resume the task to try again.”
The most recent matching event is selected by insertion order because event
timestamps use whole seconds. Completed tasks do not retain stale interruption
guidance, and older records without history still render normally.

The rendered regression checks the latest reason across bot selection and
reopening, preserves the saved prompt and dispatches Resume for the correct
task. It fails on baseline `98a814b13`; the completed-task case passes there.
The companion case also fails on the old code and checks Resume, clearing
the message on completion and older records without history. All 100 focused
settings/companion cases pass. ONE `make verify` passed the initial settings
snapshot on S1 CPUs96–103, 04:27:57–04:35:45Z: lint, typecheck, quality guards,
3,347 app cases (six skipped), 121 extension cases, six coverage floors and
1,220 Rust cases (28 ignored). The final shared-component/companion change
then passed a refreshed `make verify-fast` (3,348 app cases, six skipped;
121 extension cases; six floors); Rust source was unchanged. Source hashes
matched before and after each gate. This uses existing serialized task history;
backend state and recovery behavior are unchanged. No VM, native Windows, model or live task
was run. FRESH/OLD remain OFF/original XML/custody Gchat 2.
Windows: not built (dev phase).

Result: `out/gchat2-task-interruption-reason-20261018/result.json`, with
`SUMMARY.md` beside it. Branch `fix/gchat2-task-interruption-reason-20261018`.
## Remove connection survives list-refresh failure — Gchat 3, October 18

`GUI-HOST-REMOVE-REFRESH-RESULT-20261018`: preserve a successful saved-connection
removal when the following host-list read fails. On base `98a814b13`, both
operations share one error boundary: the native command persists removal, but
an unsuccessful list refresh reports removal failure and enables Remove again.
The next removal then rejects because the host is no longer registered. A saved
sign-in cleanup warning is also replaced by the unrelated list error.

The candidate gives removal its own accepted state. A stale card confirms that
the connection was removed, prevents further host actions and preserves any
cleanup warning. A separate list error offers Refresh host list, which reads
status without repeating removal. An actual removal rejection retains the
connection and enables an explicit retry.

Acceptance: reproduce the refresh-failure case against the base using the
existing rendered HostCard tests; qualify preserved success, cleanup warning,
read-only refresh retry and genuine removal-error retry. Run the focused suite,
lint and ONE `make verify`. No Engine, native account, live pairing, model/GPU,
Windows or installer qualification is claimed. The frozen regressions reproduce
the base defect: both cases fail at the missing successful-removal status
(2 failed, 37 skipped). Only the fixed component was then overlaid: all 39
focused cases pass, and lint passes with zero errors and five existing warnings.
ONE `make verify` passed lint, typecheck, quality guards, 3348 app cases
(six skipped), 121 extension cases, six coverage floors and 1220 native cases
(28 ignored). The candidate chain ran 04:29:09–04:37:04Z. The coordinator
reviewed the actual logs, effective commands and unchanged frozen source hashes;
no further gate is required before branch integration.

Owner worktree `/ai/gchat-worktrees/gchat3-host-remove-refresh-result-20261018`,
branch `fix/gchat3-host-remove-refresh-result-20261018`, allocated main
`98a814b13`. Canonical local evidence:
`out/host-remove-refresh-result-20261018/{test-result.json,test-summary.md}`.
The private S1 test root was
`/media/ron/SSD_RAID/ai/tmp-gchat3-host-remove-refresh-tests-20261018`,
CPU112–119. Preparation booking 2976 returned at 04:27Z; gate booking 2979
returned at 04:38Z and was canceled. The owned 42.32 GB SSD copy, two exited
containers and disposable local source archive were removed. Concise results
and logs remain; the retained RC dependency donor stayed read-only. No GPU use
or newly built installed-GUI qualification is claimed.
## Models download-count wording — C3, October 18

`GUI-DOWNLOADS-TRANSFER-COUNT-WORDING` passes source verification, its changed
build and native acceptance. The accepted paused-status candidate `4e635c35a` showed
**1 transfers** beside Models in both Light and Dark. Existing evidence:
`out/c3-downloads-popover-status-20261018/{status-light-wide.png,status-dark-narrow.png}`.

The badge now reads **1 download** or **2 downloads**, with the title **Active or
incomplete model downloads**. Counting is unchanged: incomplete local journal
entries count once, the mirrored local Host snapshot is excluded, remote entries
count separately even for the same model, and installed entries do not count.
Rendered NavMain regressions cover singular paused/verifying entries, the mixed
local/remote plural including an installed remote entry, and removal when the
local download installs while its Host snapshot remains stale. Chat, Gbot,
transfer actions and routing are outside this wording change.

All 14 focused NavMain cases and lint pass (zero errors, five existing warnings).
The ONE `make verify` passes typecheck, the 356-file quality guard, 3,338 app
cases, 121 extension cases, 1,220 native cases and all six coverage floors. Six
app cases are skipped and 28 native cases ignored. No failure or continuation
occurred. The production Vite build takes 22.19 seconds and the debug
custom-protocol shell builds in 54.22 seconds. Result and command:
`out/c3-download-count-wording-20261018/{result.json,command.json,summary.md}`.

Owner: Codex 3. Baseline `3bbea776c`; source commit `72c76c51a` in
`/ai/gchat-worktrees/c3-download-count-wording-20261018`, branch
`fix/c3-download-count-wording-20261018`. Only NavMain, its existing rendered
tests and this subject record change. The current-main release helper handed
over the S1 source/build stage and caches after its checked AppDir completed
at 04:33Z. Its immutable AppDir and the coordinator's private installed-build
walk stay separate from this changed-source candidate. No GPU or model is used.
All 35 retained dependency manifests/locks/config files match before reuse;
no dependencies were downloaded. S1 CPU 80–87 ran with nice 10 and the shared
socket 1 lock from 04:34Z to build completion at 04:41:46Z, returned 04:42Z.
The stopped container and disposable source archives are removed. The shared
source, native target and caches pass to the next authorized owner. Candidate
`/media/ron/SSD_RAID/ai/tmp-c3-first-user-setup-20261018/badge-candidate`
retains the checked Linux x86_64 binary, a resource link to immutable `runnable`
and its own pre-install copy for coordinator acceptance. The private
`downloads-home`, current-main AppDir/HOME, runnable and tools remain intact.

Native acceptance passes on the exact changed build (SHA256
`b88355fb5130d627400d3ccef6b5109e86aba5c13d1e30ca549b4e4290d3b878`).
Actual xdotool input shows **1 download** in Light1500×1000 and Dark1024×800,
then **2 downloads** in Dark1024×800. The tooltip is **Active or incomplete
model downloads** and neither width overflows. All three retained screenshots
were visually reviewed. The private journal contains inert paused entries;
no transfer, model or GPU was used. App and idle private Host stopped at04:54Z.
The shared isolated display/profile and immutable resources remain for the
next acceptance; the stopped badge binary is disposable after integration.

Next: coordinator integration. No further source gates are needed. This is
Linux source-native acceptance, with no installed-release or Windows claim.

## Google client ID validation — Gchat 3 native acceptance, October 18

`GUI-GOOGLE-CLIENT-ID-SHAPE` passes its remaining native Linux negative leaf.
One ordinary manual Save with client ID `abc` and an inert dummy secret stayed
on step 5, named the required `.apps.googleusercontent.com` suffix and directed
the user to Google Auth Platform → Clients. The ID and masked secret drafts
remained; Save stayed enabled for correction. The 1200×800 Dark screenshot was
visually reviewed. Private `workspace-connections.json` remained absent and
both private keyring files were byte-identical before/after; the provider cards
showed no connected accounts. No registration or account was saved.

Allocated main `548d73ed8`; source `5beb06da2` merged `98136eded`.
The retained `ed68c7443` AppDir has identical GoogleRegistration wizard,
service and native account persistence paths; only unrelated outer startup
error presentation differs. Accepted source tests and the valid Save/import
and persistence result in `out/google-setup-native-20261018/result.json` were
reused without rerun. This observation qualifies only malformed manual client
ID rejection. Real Google consent/OAuth, account/service access, Windows and a
fresh installer remain unqualified. No source change, external browser,
Google account Connect, GPU/model or Ron profile action occurred.

Owner worktree `/ai/gchat-worktrees/gchat3-google-client-id-native-20261018`,
branch `test/gchat3-google-client-id-native-20261018`. Canonical result,
summary, source binding, before/after storage proof, observation and screenshot:
`out/google-client-id-native-20261018/{result.json,summary.md}`.
Verified S1 `AIS-2-8592-L01` used CPU 120–127, private HOME/runtime0700,
D-Bus/unlocked keyring, uid-1000 container and Xvfb :198. Native pointer/keyboard
drove the controls; WebKit only observed. At 03:59:29Z the exact owned root
`/media/ron/SSD_RAID/ai/tmp-gchat3-google-client-id-native-20261018` and its
session/container/sockets were absent; 3.44 GB was released, inspector forward
ended and booking 2952 canceled. The release donor remains read-only at
`/media/ron/SSD_RAID/ai/tmp-gchat3-linux-rc-refresh-20261017/packages-current-ed68c7443-e2282c336-release/app-stage`.
Coordinator evidence, visual and documentation review is complete. Docs-only
`git diff --check` passes. Next: branch integration; no further gate is required.
## Saved Gbot cloud setup removal confirmation — October 18

`GBOT-CLOUD-SETUP-REMOVE-CONFIRMATION`: **Remove saved review** previously
called the removal service immediately. That service discards the provider
access key and optional SSH key as well as the saved setup. The control now
says **Remove saved setup** and opens the shared confirmation dialog, names the
setup, explains which keys are removed and says the access key must be entered
again to restart setup. Cancel receives initial focus. Accepting after leaving
the page cannot dispatch removal. Existing cloud-resource and workspace
eligibility checks remain in place.

Four rendered regressions exercise Cancel, confirmed single submission while
removal is pending, service rejection followed by an explicitly confirmed retry,
and leaving the page before answering. All four fail on baseline `36c278f28`;
all 77 route tests and three shared-dialog tests pass with the fix. ONE
`make verify` passed on S1 CPUs96–103, 04:05:10–04:12:41Z: lint, typecheck,
quality guards, 3,319 app tests (six skipped), 121 extension tests, all six
coverage floors and 1,220 Rust tests (28 ignored). Pre/post source hashes
matched. The service is mocked: no real cloud setup or stored credential was
removed. FRESH/OLD stayed OFF with original XML, in Gchat 2
custody. Windows: not built (dev phase); the change uses shared frontend APIs.

Result: `out/gchat2-cloud-setup-remove-confirmation-20261018/result.json`, with
`SUMMARY.md` beside it. Branch `fix/gchat2-cloud-setup-remove-confirmation-20261018`.
## Passphrase-vault feedback — Gchat 3 native acceptance, October 18

`GCHAT-SECURE-STORAGE-SETUP-FEEDBACK-20261017`: native Linux vault creation,
Lock, wrong-Unlock feedback and correct retry pass in a fresh private profile.
Matching drafts followed by Cancel close the form and clear both fields.
Mismatched drafts retain the form and show “The passphrases do not match.”
Cancel after that error reproduced a defect: the form disappeared but the error
remained on the native-ready card. Cancel now clears the discarded error along
with both secret drafts. Reopening creation shows blank fields and dispatches
no vault action. The rendered regression fails against the unchanged base
(1 failed, 10 skipped), then the corrected component suite passes all 11 cases.
Lint passes with zero errors and five existing warnings. ONE `make verify`
passes: 3316 app cases with 6 skipped, 121 extension cases, 1220 native cases
with 28 ignored, and all six critical coverage floors.

Explicit Check secure storage showed native ready. Creating an inert passphrase
vault showed ready and Lock vault; Lock showed the locked state and Unlock
form. Wrong Unlock displayed the actionable error and cleared the secret field;
correct retry returned ready. A new process with the same complete private
profile started locked, then unlocked correctly. The encrypted vault remained
byte-identical across Lock, failed/correct Unlock and that restart. The attempted
`xdotool windowclose` destroyed the X window and caused GTK BadDrawable:
new-process persistence is qualified, clean normal shutdown is excluded.
Future close checks must use the supported app exit or window-manager close
protocol, rather than XDestroyWindow. No additional lifecycle repeat is needed.

Allocated base `36c278f28`, branch
`test/gchat3-passphrase-vault-native-20261018`, worktree
`/ai/gchat-worktrees/gchat3-passphrase-vault-native-20261018`.
The retained `ed68c7443` AppDir has unchanged vault handlers, native storage,
credential-control and relevant initialization paths. Its only CredentialSetup
difference before the correction is the unchecked hint; adapter reset/model/
Windows differences are outside this leaf. The installed donor stayed unchanged:
these observations reproduce the original Cancel behavior and qualify the
existing vault route, not native rendering of the correction. Accepted
native backend lifecycle gates are reused; the new frontend regression and
focused/lint/full checks qualify the source correction.

The private vault was 0600, active passphrase, with zero records/references and
no migration. Private `gbot/service.json`, workspace-connections metadata and
Host identity stayed absent. The unchanged credential-control path returns
without starting that service when its configuration is absent. Existing
credential migration, accounts, Host pairing, model/GPU, external services,
Windows and installer behavior remain unqualified.

Canonical result, short summary, source binding, six visually reviewed masked
screenshots and storage/isolation/cleanup receipts:
`out/passphrase-vault-native-20261018/{result.json,summary.md}`.
S1 `AIS-2-8592-L01` used CPU104–111, private HOME/runtime0700,
D-Bus/unlocked keyring, Xvfb and a uid-1000 container with all capabilities
dropped and software rendering. Native pointer/keyboard drove controls;
WebKit only observed. At 04:11:25Z the exact owned root
`/media/ron/SSD_RAID/ai/tmp-gchat3-passphrase-vault-native-20261018`,
container, private helpers and display socket were retired; 3.43 GB was released,
the inspector forward closed and booking 2960 returned. The read-only donor at
`/media/ron/SSD_RAID/ai/tmp-gchat3-linux-rc-refresh-20261017/packages-current-ed68c7443-e2282c336-release/app-stage`
was untouched. The separate correction gate ran 04:12:35–04:20:26Z on S1
CPU112–119 with an independent offline dependency copy. Its owned SSD fixture
(42.31 GB logical file lengths), two exited containers and local source archive
were removed; booking 2964 returned at 04:22Z. Source bindings, expected baseline
failure, full logs and cleanup are in `test-result.json` and `test-summary.md`
beside the native packet. The correction and scoped native acceptance are ready
for branch integration. Windows and installed rendering of the correction
remain unqualified.

## Model deletion confirmation — Gchat 3 native acceptance, October 18

`GUI-MODEL-DELETE-RESULT-20261017` passes its remaining native Linux
confirmation leaf. In Settings → GInfer → Models, the dialog initially focused
Cancel. Ordinary Cancel closed it and preserved both inert fixture files,
including their bytes and modification times. With the owned directory set to
0500, an actual uid-1000 unlink failed with EACCES; native Delete showed
“Permission denied (os error 13)”, retained the dialog, files and model row,
and reenabled Delete. Restoring 0700 and retrying in that same dialog removed
the fixture, closed the dialog, removed its row and showed the success toast.
Four Dark-theme screenshots at 1200×800 app size were visually reviewed.

Allocated main `7b17e06da`; source `625eceba0` merged `95b351d54`.
The retained `ed68c7443` release AppDir has identical DeleteModel, shared deletion,
model service, provider inventory and provider-store source. Main adds an
external-registration branch; this `source: local` fixture has no managed
journal and uses the unchanged direct-directory deletion route. Provider layout
changes do not alter this dialog call. The accepted 11 focused cases and full
source gates in `out/c4-model-delete-result-20261017/result.json` were reused,
including their recorded command-environment correction; no gates were rerun.
This observation qualifies the private native Linux confirmation workflow,
not valid-model loading, external/managed registrations, pending/double-submit
timing, Windows or a fresh installer. No product source change or real model,
shared cache, account, Host pairing, GPU or inference action occurred.

The initial synthetic manifest contained literal newline escapes and discovery
rejected it; that setup is excluded. The owned manifest was corrected and
ordinary Refresh installed models confirmed discovery before deletion. An early
Cancel observation captured the closing animation and cannot prove closure.
Only that missing observation was repeated with an identical inert fixture;
the settled dialog-absent state, retained row and unchanged files establish
Cancel. Future checks must parse the fixture and wait for settled dialog state.

Canonical result, short summary, four screenshots, source binding, permission
proof and state/cleanup receipts: `out/model-delete-native-20261018/{result.json,summary.md}`.
Owner worktree `/ai/gchat-worktrees/gchat3-model-delete-native-20261018`, branch
`test/gchat3-model-delete-native-20261018`. Verified S1 `AIS-2-8592-L01` used
CPU 112–119, private HOME/runtime0700, D-Bus/unlocked keyring, Xvfb and a
uid-1000 container; native pointer/keyboard drove controls and WebKit only
observed. At 03:50Z the exact owned root
`/media/ron/SSD_RAID/ai/tmp-gchat3-model-delete-native-20261018` and all owned
session processes, sockets and inspector forward were absent; 3.45 GB was
released and booking 2938 canceled. The donor remains read-only at
`/media/ron/SSD_RAID/ai/tmp-gchat3-linux-rc-refresh-20261017/packages-current-ed68c7443-e2282c336-release/app-stage`.
Coordinator reviewed the evidence and docs diff; docs-only `git diff --check`
passes. This acceptance is ready for branch integration.
## Gbot connection controls wait for refreshed status — October 18

`GBOT-WORKSPACE-ACTION-REFRESH-PENDING`: Connect and Disconnect remain disabled
until their action and follow-up refresh finish. Previously, the action released
the controls before reading the new status. A slow status response exposed the
old Connect button; clicking it again generated another session identity, which
could replace the working SSH session. The pending controls now cover that gap
and become available with the refreshed connection status.

Two rendered regressions delay the status response after Connect and Disconnect,
try a second ordinary click, and then finish the refresh. Each dispatches its
connection action once and enables the correct control after the response.
Against main `e6b28e8d4`, both cases fail with two dispatched requests (71 other
cases skipped). The fixed Gbot page suite passes all 73 cases.

Commands: baseline `yarn test web-app/src/routes/gbot/index.test.tsx -t 'holds
connection controls through the status refresh'`; focused `yarn test
web-app/src/routes/gbot/index.test.tsx`; full `make verify`.

The ONE `make verify` passes: 3310 passed | 6 skipped (3316); 121 passed (121)
extension cases; 1220 Rust cases, with 28 ignored; all six coverage
floors. Lint has zero errors and five existing warnings; type checking and
quality guards pass. Source and test hashes match before and after the gate.
The gate ran 03:51:39–03:59:14 UTC on private S1 SSD caches, CPU 96–103,
nice 10 and at most eight build jobs, without a GPU.

Evidence: `out/gchat2-workspace-action-refresh-20261018/{result.json,SUMMARY.md}`.
The tests use a mocked service. No new native VM, Windows, GPU or live model
qualification is claimed. Windows was not built; this shared frontend change
uses no platform-specific API. FRESH and OLD remained off with their original
XML and Gchat 2 custody.
## Pairing saved but Host refresh fails — Gchat 3, October 18

`GUI-HOST-PAIR-REFRESH-RESULT-20261018` fixes false pairing-failure feedback.
A successful pair command is now reported immediately and its credential-cleanup
warning is preserved. If the subsequent Host-list read fails, a persistent
message explains that pairing succeeded and points to Refresh. Both manual and
nearby pairing use this behavior. A failed Refresh preserves the message;
a successful Refresh clears it without submitting another pairing request.
Genuine pairing failures retain the existing error and draft behavior.

Both new rendered cases failed against base `7b17e06da`, reproducing the manual
false pairing error and missing nearby feedback. The final affected route suite
passes all 21 cases. Two initial new assertions omitted the displayed `Error:`
prefix; only those assertions changed, and both failed cases then passed while
reusing the 19 earlier passes. Lint passed with zero errors and five existing
warnings. The ONE `make verify` completed at 03:58:42Z: 3,307 app cases,
121 extension cases, all six critical coverage floors and 1,220 native cases
passed; six app cases were skipped and 28 native cases ignored. No full rerun
was needed. Commands and list failures are mocked; native pairing, Windows,
account sign-in and installer acceptance are outside this result. No Host
service, credential format, startup or Engine behavior changes.

Owner worktree `/ai/gchat-worktrees/gchat3-host-pair-refresh-result-20261018`,
branch `fix/gchat3-host-pair-refresh-result-20261018`. Canonical result, concise
summary, source binding and verification receipts:
`out/host-pair-refresh-result-20261018/{result.json,summary.md,verification-summary.json}`.
CPU-only S1 fixture
`/media/ron/SSD_RAID/ai/tmp-gchat3-host-pair-refresh-result-20261018` and its
three exited containers were removed at 03:59:59Z, releasing 42.31 GB; the
280 MB disposable source archive was also removed. Read-only donors remain.
CPU 88–95 booking 2944 was canceled; returned 04:00Z. Next: reviewed branch
integration; no further test run is required.
## Shared private development catalog and Downloads native acceptance

Bubbs authorized one shared read-only S1 LAN fixture on October 18 for
`GUI-DOWNLOADS-POPOVER-MANAGED` and the other development lanes. It is generated
from `/mnt/nas/AltaStratusAI/GInfer/artifacts/release-waves/v1`, using recorded
package SHA-256 values and existing launch profiles. Only packages with matching
profiles are offered; this fixture adds no model or hardware qualification.
No package is copied, repacked or published. The public release-catalog gate
and production download admission remain unchanged.

The development-only private-catalog route in `71abf1708` extends its
configured literal IPv4 origin from loopback to
RFC1918 LAN addresses. Frontend development mode and a debug Host must both be
used. Catalog and `.ginfer` URLs use the same explicit origin, with no credentials,
query or fragment; Host private requests use neither proxies nor redirects.
Full size, hash, identity, launch-profile and hardware checks remain in force.
The fixture must never be uploaded or configured in a release build.

The shared URL is **`http://192.168.1.109:18761/catalog.json`**, live since
06:18 UTC on October 18. Its durable S1 root is
`/media/ron/SSD_RAID/ai/gchat-private-dev-catalog-v1`, separate from disposable
lane builds. It offers seven packages and 112 unchanged profiles: 107
full-context-tested, four calculated-startup-smoke and one screened-startup;
166 pending profiles are omitted. Packages are explicit symlinks into the NAS
wave. The service binds only S1's LAN address, permits GET/HEAD on the catalog
and selected package names, supports byte ranges, and limits each transfer to
8 MiB/s. Directory/internal routes return 404 and writes are unsupported.
Catalog and a 16-byte package range passed from both S1 and another LAN host.
The catalog route also accepts the existing loader's numeric `t` cache-buster;
other query keys and package queries return 404.
Bubbs received the live URL for reuse by the other lanes.

For a development frontend, set
`VITE_MODEL_CATALOG_URL=http://192.168.1.109:18761/catalog.json` when building
or starting Vite. A packaged development frontend also needs
`NODE_ENV=development`; `vite build --mode development` alone does not make
`import.meta.env.DEV` true. Use a debug `ginfer-host` and set
`GINFER_MODEL_CATALOG_URL=http://192.168.1.109:18761/catalog.json` in its runtime
environment. GChat's child Host inherits that environment. Both sides must use
the same origin and include the transport change above. Keep each lane's HOME,
XDG directories, D-Bus, keyring and model download directory private. Do not set
these values in release build settings.

C7 owns the shared service, intentionally retained for the other lanes. Its
PID is recorded in `service.pid` under the durable root (PID 3708693 at acceptance);
output is `service.log`. Restart only after confirming that process is gone:
`nohup python3 /media/ron/SSD_RAID/ai/gchat-private-dev-catalog-v1/srv.py >service.log 2>&1 &`
from the durable root, then record the new PID. Stop only that verified PID
when the shared fixture is retired. Do not regenerate or replace the fixture
during another lane's transfer. Definition and generation/service receipts are
in `out/c7-managed-downloads-native-20261018/shared-fixture/`.

Focused frontend checks (47), Host download checks (33), Host check and strict
all-target Clippy passed. ONE `make verify` passed: 3,409 web/core tests,
127 extension tests and 1,267 Rust tests (28 ignored). The development frontend,
current extensions and debug desktop/Host builds passed. The release profile
explicitly sets `debug-assertions = false`; no release profile override enables
it. Arch accepted the development transport at 06:15 UTC, confirmed at 06:29.
Both requested actual `--release` checks passed, one test each: the private
catalog URL is rejected, and private package URLs are rejected even when a
catalog argument is supplied. The latter test exists only without debug
assertions, so its execution also confirms the effective release configuration.

Native acceptance passed in an isolated Linux desktop session: Models started
a real Muse Glimmer INT transfer from the shared NAS fixture, and the sidebar
popover showed 107 MiB of progress. Native Pause retained 155,975,468 bytes;
both Models and the popover showed Paused. Native Delete partial download
showed its confirmation, then removed the partial file and Host journal entry;
Models and the popover returned to their empty states. The package SHA-256 is
`46b5d54ee64ccd278f2a1a4d2c6d5aa9fc9097e8db0c3d165179aee5f2cb5b66`.
This checks partial-transfer UI behavior; no model load, completed-package
validation or GPU inference was performed. Screenshots and concise receipts
are in `out/c7-managed-downloads-native-20261018/native/`; verification and
release receipts are beside them.

Owner C7, branch `test/c7-managed-downloads-native-20261018`, worktree
`/ai/gchat-worktrees/c7-managed-downloads-native-20261018`; current baseline is
main `96172afb5`, normally merged as `dc67f5df7`. The tested source is
`71abf1708`. The native app, Host and private display/session processes stopped
by verified PID; CPUs 88–95 returned 06:39Z. The disposable private HOME,
4.1 GB AppDir and Xvfb closure were removed. Codex 4 completed an independent
read-copy of the debug Host at 06:36Z, so it holds no donor. The shared service
and NAS inputs remain available. After retaining the release receipts, the
entire 33.06 GB build scratch was removed; CPUs 104–111 returned 06:39Z.
No large binary or model is kept as evidence.


## Downloads popover transfer status — C3, October 18

`GUI-DOWNLOADS-POPOVER-STATUS` is fixed and merge-ready. The private native
first-user walk reproduced a paused Host-managed transfer under the generic
Downloading heading with no
per-job status. Models Downloads correctly showed Paused and Resume for the
same retained journal. Baseline evidence is
`out/c3-first-user-setup-20261018/{downloads-popover-baseline.png,downloads-paused-baseline.png}`;
the active row is 222 in the GInfer open-work authority.

The candidate labels the popover Downloads and shows each managed transfer's
existing plain-language Models status: Waiting to download, Downloading model,
Saving progress before pausing, Paused; resume to continue, Checking the
downloaded file, or Download stopped. Each status is associated with its model
for assistive technology. Rendered polling coverage retains distinct labels
when only status changes and byte count/job count stay unchanged. Progress,
transfer actions and the separate Manage destination fix are unchanged.

All 56 focused cases in the three existing Downloads/Models suites pass. Lint
passes with zero errors and five existing warnings. The ONE `make verify`
passes typecheck, the 355-file quality guard, 3319 app cases, 121 extension cases,
1220 native cases and all six coverage floors. Six app cases are skipped and
28 native cases ignored. No failure, retry or continuation occurred. The
production Vite frontend and debug custom-protocol native candidate build
passes. Native Linux acceptance also passes: real pointer/keyboard opened the
popover over the retained paused journal and showed Downloads plus Paused;
resume to continue. The accessible status is associated with Paused navigation
fixture. The coordinator reviewed Light 1500×1000 and Dark 1024×740 screenshots
with no horizontal overflow. No Resume/Delete, transfer, model or GPU action
occurred. This is source-native Linux evidence; no installed-release or Windows
claim. Evidence: `out/c3-downloads-popover-status-20261018/` contains
`result.json`, `native-result.json`, `summary.md`, `status-light-wide.png` and
`status-dark-narrow.png`. Next: coordinator merges the reviewed branch.

Owner/source `/ai/gchat-worktrees/c3-downloads-popover-status-20261018`, branch
`fix/c3-downloads-popover-status-20261018`, baseline `7b17e06da`, source commit
`909a8a7e9`, normal main merge `4e635c35a` including accepted Manage `d4b0b9c8c`.
Only the popover, its existing managed rendered tests and this subject section
change. S1 `AIS-2-8592-L01` CPU 112–119 ran nice 10 with the shared socket 1 lock,
03:54:24–04:01:24Z. Booking 2948 was returned at 04:02:56Z. All 35 retained
dependency manifests/locks matched. The terminal container and owned local/remote
280156160-byte source archives are removed; concise command/stage/results are
retained, with raw passing logs remote until coordinator cleanup.

The existing root `/media/ron/SSD_RAID/ai/tmp-c3-first-user-setup-20261018`
retains the accepted `status-candidate/{bin/gchat,lib/GChat,pre-install}`;
its resource symlink targets `runnable/lib/GChat`. The gate preserved the
accepted Manage donor, runnable resources, launch profiles, dependencies and
native cache. Native app, private Host and Xvfb received TERM; at 04:10Z the
coordinator verified no processes or mounts using downloads-home/status-candidate
and returned GUI booking 2957 CPU 8–15. Accepted candidate/home evidence remains
through merge. Shared `gchat`/`native-target`, caches and AppDir are handed to the
current-main release refresh helper. Parent owns retained-build cleanup.

## Conversation Rename keyboard — Gchat 3 native acceptance, October 18

`GUI-THREAD-RENAME-KEYBOARD` passes its remaining native Linux leaf. Ordinary
Enter on unchanged, trimmed-unchanged and whitespace-only titles left Rename
disabled, the dialog open and saved thread bytes/mtime unchanged. A pointer
click on disabled Rename also did not save. Valid Enter trimmed the new title;
valid Rename-button input saved a second title. Both closed the dialog, updated
the sidebar and private `thread.json`, and showed the success toast. Five Dark
theme screenshots at 1200×800 app size were visually reviewed.

The retained `ed68c7443` release AppDir ran on verified S1 `AIS-2-8592-L01`.
Its `RenameThreadDialog.tsx`, `ThreadList.tsx` and `useThreads.ts` match allocated
main `80424bb41` exactly. Source `c1ead69b2` merged as `8c83d852b`; the accepted
nine focused cases and full verification were reused without rerun. One synthetic
thread was seeded in private app data before launch, with no messages or model.
Native pointer/keyboard drove the controls; WebKit only observed state. This
observation does not requalify pending/error callbacks, Windows or an installer.
No product source change, model/request, real user conversation, account or Host
pairing action occurred. Initial observer focus loss was corrected by explicitly
focusing and confirming each draft; those invalid later drafts were excluded.

At 03:35Z the app also reloaded the final saved title from the byte-identical
200-byte `thread.json`. Ancillary private app state was fresh after the first
cleanup; this checks saved-thread rehydration, not a full profile restart.

Result, concise summary, five screenshots and relevant state/storage receipts:
`out/thread-rename-native-20261018/{result.json,summary.md}`. Owner worktree
`/ai/gchat-worktrees/gchat3-thread-rename-native-20261018`, branch
`test/gchat3-thread-rename-native-20261018`. The private S1 container, HOME,
runtime/cache, keyring/D-Bus, Xvfb and inspector forward were removed after each
run, last at 03:35Z; bookings 2923/2930 on CPU 120–127 were canceled, with no GPU
or build. The exact owned root
`/media/ron/SSD_RAID/ai/tmp-gchat3-thread-rename-native-20261018` is absent
(3.45 GB and 3.42 GB of disposable app data released). The retained read-only
AppDir donor remains in place.
Docs-only acceptance is recorded; merge is pending.
## Support issue destination — C3, October 18

`GUI-SETTINGS-SUPPORT-LINK-404` is **WAITING ON W12 PUBLICATION**. Ron confirmed
on October 18 that the GitHub repositories exist but are private; the anonymous
404 is expected until they become public at release. Keep
`https://github.com/SectileLabs/gchat/issues` as the support destination, shared
by the existing `GCHAT_ISSUES_URL` constant. No code change is required.

The [W12 release checklist](../installer-refresh/README.md#support-link-publication-check--w12)
requires the release owner, once the repositories are public, to confirm that
Issues is enabled on the linked repository and that Settings → Open an issue
opens it successfully. This check remains pending; no publication or live-link
acceptance is claimed.

The private first-user walk opened that URL through the native browser and
observed GitHub 404. The browser keyring prompt was canceled without secrets,
then the private browser received normal TERM. Evidence:
`out/c3-first-user-setup-20261018/private-browser-after-cancel.png`.

The active link now shares one named `GCHAT_ISSUES_URL` constant between its
`href` and external-opener action. The destination and observable behavior are
unchanged; the 404 is not fixed. Hidden links and unrelated support targets are
outside this change. Reuse the existing native 404 observation; no fresh native
build or GUI run is required for this constant extraction.

Acceptance: existing General route tests, lint and one `make verify`; no test
for private constant shape. All 26 General cases pass. Lint passes with zero
errors and five existing warnings. The ONE `make verify` passes 3297 app cases,
121 extension cases, 1220 native cases and all six coverage floors; six app cases
are skipped and 28 native cases ignored. No failure, retry or continuation was
needed. Reuse the existing native 404 evidence; public access awaits W12.
Results: `out/c3-support-url-constant-20261018/{result.json,summary.md}`.

Owner/source:
`/ai/gchat-worktrees/c3-support-url-constant-20261018`, branch
`fix/c3-support-url-constant-20261018`, baseline `80424bb41`. Reuse the retained
S1 root `/media/ron/SSD_RAID/ai/tmp-c3-first-user-setup-20261018`, dependency cache
and native target under the pinned routed, dependency-offline build fixture.
All 35 dependency manifests/locks match before reuse. S1 CPUs 88–95 used nice 10
and the shared socket 1 lock; returned 03:38Z. The container and both disposable
source archives are removed. The runnable baseline binary is unchanged; the
coordinator removed the closed older candidates independently. Source,
dependencies, native target and caches pass to the next owned GUI gate. No new
build, model, GPU, browser or dependency-install work. This bounded source change
was merged as `78ce5f45f`. Next: the W12 release owner completes the public
Issues check above. This documentation-only decision passes `git diff --check`;
no build, test rerun, fixture, browser session or publication was needed.
## Gbot tools and SSH checks — Gchat2, October 18

`GBOT-LAN-TOOLS-SSH-CHECK-OVERLAP`: Rechecking SSH while Check tools or Prepare
tools was pending could detach that work; its late result could enable Continue
beside an SSH failure.
[LanSetup](../../web-app/src/components/GbotSetup/LanSetup.tsx) now tracks child
tool work synchronously and disables SSH rechecking until it finishes.
The [LAN setup
regressions](../../web-app/src/components/GbotSetup/LanSetup.test.tsx) cover Check
and Prepare overlap, and the [wizard
regression](../../web-app/src/components/GbotSetup/index.test.tsx) keeps Continue
unavailable until SSH and tools checks finish in order.
The unfixed regression run had **3 failures / 29 skipped**; the fixed focused run
passed **36 tests**:
`yarn test web-app/src/components/GbotSetup/LanSetup.test.tsx web-app/src/components/GbotSetup/LanTools.test.tsx web-app/src/components/GbotSetup/index.test.tsx`.
Qualification on main `1d80da074`: **ONE `make verify` passed** on S1
CPU96–103, 03:38:26–03:46:12 UTC: 3,303 application tests (6 skipped),
121 extension tests, 1,220 Rust tests (28 ignored), all six coverage floors,
lint (0 errors, 5 existing warnings), type checking and quality checks.
Changed source hashes matched before and after the gate.
Evidence:
[`out/gchat2-lan-tools-ssh-overlap-20261018/result.json`](../../out/gchat2-lan-tools-ssh-overlap-20261018/result.json).
These rendered tests use a mocked service. FRESH/OLD remained OFF with original
XML; this records no native, Windows or live-service qualification.
## Downloads Manage destination — C3, October 18

`GUI-DOWNLOADS-MANAGE-WRONG-TAB` is fixed. The sidebar Downloads popover's
**Manage** action opens `/hub/?tab=Downloads`, exposing the transfer controls.
The validated Models route owns the selected tab: direct links and browser
Back/Forward select the corresponding panel, and later user tab choices update
that route state. Missing or invalid tab values default to Installed. Existing
model search parameters are preserved; transfer actions and payloads are
unchanged.

All 48 focused Models/control cases and lint pass (zero errors, five existing
warnings). The ONE `make verify` passes typecheck, the 355-file quality guard,
3304 app cases, 121 extension cases, 1220 native cases and all six critical
coverage floors. Six app cases are skipped and 28 native cases ignored. The
changed-source frontend/native candidate builds. No failure or retry occurred.

Native Linux acceptance passes with real pointer/keyboard input. The baseline
`201f46712` reproduces Manage opening Installed with Resume absent; selecting
Downloads manually exposes the same paused journal's controls. The candidate
opens Downloads with enabled Resume visible and closes the popover. Actual
Alt+Left/Right preserves later tab choices. Reviewed screenshots cover Dark
1500×1000 and Light 1024×740 without horizontal overflow. No Resume/Delete,
actual transfer, model or GPU execution occurred. This is English source-native
Vite/debug custom-protocol evidence; Windows, installers and release builds
remain unqualified. The separate paused-status wording row remains unchanged.

Owner/source `/ai/gchat-worktrees/c3-downloads-manage-tab-20261018`, branch
`fix/c3-downloads-manage-tab-20261018`, base `be69f9190`. Results, native receipt,
command/dependency receipts, candidate screenshots and a short summary are in
`out/c3-downloads-manage-tab-20261018`; baseline screenshots remain in
`out/c3-first-user-setup-20261018`. S1 fixture:
`/media/ron/SSD_RAID/ai/tmp-c3-first-user-setup-20261018`, candidate
`downloads-manage-candidate/bin/gchat`. CPU-only gates used the pinned offline
image/cache, nice 10 and shared socket 1 compile lock. Build CPUs 88–95 returned
03:44Z. The container and owned local/remote source archives are removed. The
private native app, Host and Xvfb 79 are stopped and GUI CPUs 64–71 returned.
The parent retains the shared stage, candidate/resources, private
`downloads-home` and remote passing logs for the next paused-status candidate,
then retires those disposable outputs. The private launch/config receipt is
`downloads-native-launch.json` under the S1 root. No active job remains for
this navigation fix.

## Physical graphics-card inventory — C3, October 18

`GUI-HARDWARE-IDENTICAL-CARDS-COLLAPSED`: the fresh private native main
`201f46712` walk showed one card in Hardware and System Monitor on S1 despite
two physical PRO 6000 cards with distinct NVML UUIDs and indices. The frontend
collapsed every matching vendor/name/memory tuple. That heuristic also hid real
cards after the native probe had correctly distinguished them.

The candidate reconciles NVML/Vulkan aliases by exact PCI domain/bus/device/
function, preserving NVML identity for telemetry. UUID is used when a comparable
PCI address is unavailable. Two different PCI addresses remain separate even
if their UUID strings match. Missing shared identity cannot prove an alias, so
such entries remain separate. PCI identity stays internal to the native plugin.
Both UI views now render the physical inventory without tuple collapse.

Acceptance: rendered regressions for both views with the retained two-card
identities, native alias/unknown/conflicting-PCI regressions, focused plugin
check/Clippy, lint, one `make verify`, and changed-source native two-card
rendering. No model load, GPU profiling, numerical or performance claim.
Focused Hardware cases (8), lint, and plugin tests (16), check and Clippy pass.
The ONE `make verify` stopped on an existing stale first-run Cancel label test.
Its selectors now match the existing Stop setup wording. The affected first-run
suite (28 cases), coverage stage (3,275 frontend and121 extension cases) and all
six coverage floors then passed. The native continuation stopped at a desktop
GPU fixture missing the new internal PCI field; the fixture now explicitly uses
`None`. Both failures remain recorded and the full verify is not repeated.
The seven original native suites then passed (1,220 tests,28 ignored), and
the changed-source frontend/native build passed. Native Linux acceptance also
passes: real pointer input opened Hardware and System Monitor, each showing
two physical PRO 6000 cards with95.59GB. Reviewed Dark-theme screenshots cover
Hardware1500×1000 and Monitor1000×1000/800×650. No horizontal overflow.
Live GPU statistics remain unavailable in this fixture; no GPU work was run.
Windows, installers and release builds remain unqualified. Result and summary:
`out/c3-hardware-card-identity-20261018/{result.json,summary.md}`.
The requested merge of main `394ba2f1f` preserves all first-run cases, including
action-error persistence, preparation readiness and expandable error details.
The focused `EngineFirstRun.test.tsx` passes all31 cases after resolution;
the file matches main. No full verify was repeated for this merge. Receipt:
`out/c3-hardware-card-identity-20261018/merge-focused-result.json`.
Next action: push the resolved merge and return it for integration.

Owner/source `/ai/gchat-worktrees/c3-hardware-card-identity-20261018`, branch
`fix/c3-hardware-card-identity-20261018`, base `832fddb85`. Reuse the owned
`/media/ron/SSD_RAID/ai/tmp-c3-first-user-setup-20261018` CPU-only build fixture
and private dependency cache; preserve baseline and preparation binaries.
The tested binary is retained at `hardware-candidate/bin/gchat`. No new GPU
booking or model process is needed. Build copies retire when this walk and its
native candidates finish; result JSON and short summary remain.
## Manual Host address — Gchat 3 focused fix and native acceptance, October 18

`GUI-HOST-MANUAL-ADDRESS-GUIDANCE` passes its focused Linux field-feedback leaf.
Ordinary native entry on retained release `ed68c7443` reproduced the defect:
**not-a-host** reached Pair and showed only the disappearing parser toast
**relative URL without a base**. An HTTP address showed a temporary policy toast.
Draft/retry survived; empty and whitespace input correctly disabled Pair.
The relevant manual controls and native validator bind to allocated main
`394ba2f1f`; unrelated runtime-preparation/Refresh changes are outside this
baseline visual evidence.

The owning route now gives persistent HTTPS-origin correction guidance, disables
malformed addresses before pairing, and retains actionable failure feedback with
the draft and retry control. Technical error details stay closed initially.
Native validation remains authoritative. Two meaningful regressions protect
invalid-input correction and failed-pairing draft/feedback/retry through Refresh;
all 19 route cases pass. Valid endpoints and connection failures were mocked only.

The changed-source custom-protocol debug app passed ordinary native empty,
whitespace, `not-a-host` and HTTP entry. Pair remained disabled; invalid fields
had linked guidance and `aria-invalid`. The malformed draft and guidance remained
visible for 26.7 seconds; whitespace cleared the invalid alert. Pointer/keyboard
input drove the app; WebKit only observed. Three screenshots were visually
inspected: `postfix-empty.png`, `postfix-invalid.png`, `postfix-http.png`.
Baseline reproducers are `malformed-error.png` and `http-error.png`; the existing
storage prerequisite explanation is retained as `storage-hint.png`.
No valid endpoint was submitted natively and nearby C7 Pair/Ignore stayed untouched.
Runtime preparation continued during this field check; no runtime readiness or
speed claim is made.

ONE `make verify` passed lint/typecheck/quality/critical coverage, 3,288 frontend
cases (6 skipped), 121 extension cases and the desktop library's 729 cases
(8 ignored), then exited 2: the supplied empty `CUDA_VISIBLE_DEVICES` masked an
existing synthetic-GPU fixture. The failed receipt is retained. Leaving the mask
unset while Docker still exposed no physical GPU, only the failed command and
five unexecuted native commands ran: 487 passed, 20 ignored. Combined completed
native coverage is 1,216 passed, 28 ignored; the full verify was not repeated.
The candidate frontend built. Initial Cargo context generation failed on a
missing generated icon; its retained Cargo-only retry used the same existing
`icon.png` bundle override as native tests and passed in 46.02 seconds.
Prevention: preserve synthetic-device visibility and carry the explicit fixture
icon override into native candidate builds. Dependency access remained offline;
bridge routing supported local network tests. Five existing lint warnings remain.

Owner worktree `/ai/gchat-worktrees/gchat3-host-address-native-20261018`, branch
`test/gchat3-host-address-native-20261018`; only the owning route, its tests and
this record changed. Canonical `out/host-address-native-20261018` retains
`result.json`, `SUMMARY.md`, commands, actual focused/full/continuation/build logs,
DOM observations and screenshots. The baseline private GUI was removed at
03:15:20Z (3,426,720,790 logical bytes; booking 2909 canceled). After normal
changed-app shutdown, the exact private Xvfb/display, D-Bus/keyring session,
relay and exited build containers were cleaned up. No owned processes remained.
Private S1 GUI and build/cache roots `tmp-gchat3-host-address-native-20261018` and
`tmp-gchat3-host-address-build-20261018` were removed at 03:34:26Z, reclaiming
43,116,667,421 logical bytes; CPU80–87 booking 2912 was canceled. Read-only
`tmp-gchat3-linux-rc-refresh-20261017` donors stayed untouched. The candidate
binary/cache was disposable; source and concise evidence are retained.

Scope is English, Dark-theme native Linux. Real pairing/account connections,
Google consent, Windows, screen-reader speech, GPU/model/profiling and performance
remain unqualified. The private keyring was explicitly unlocked; the existing
updater's 404 excludes a whole-app offline claim. Parent owns shared row state.

## Secure-storage Check feedback — Gchat 3 native acceptance, October 18

`GCHAT-SECURE-STORAGE-SETUP-FEEDBACK-20261017` passes its remaining Linux
native visible-feedback leaf. Ordinary **Check secure storage** on Welcome and
Hosts showed **Secure storage is ready.** as a status with the explanatory
success panel. Welcome stayed ready through native scrolling and settling;
Hosts remained ready for 86 seconds. Three accepted screenshots were visually
inspected. Native pointer/wheel input drove the app; WebKit only observed state.

Retained packaged release `ed68c7443` is bound to allocated main `4b3a70853`:
the explicit check handler, ready panel, Hosts route and native credential paths
are unchanged. Current main changes the unchecked hint wording and Welcome card
order; those changes are outside this retained visual evidence. Persistence
means while the component is mounted: navigating to Hosts creates an unchecked
card until another explicit Check. No readiness-across-restart claim is made.

C3's native Check success at 02:33:48Z on `201f46712` is reused; his 03:04:19Z
handoff lacked a success screenshot and left this visual leaf to Gchat 3. His
fixture was untouched. Passive launch/status does not probe or unlock storage;
that claim reuses the accepted installed locked-keyring evidence in
[agent-runtime acceptance](../agent-runtime/remaining-acceptance.md#installed-linux-locked-keyring-launch-and-explicit-connect--october-17)
and the [explicit-storage decision](../decisions/2026-10-16-open-secure-storage-only-for-explicit-connections.md),
without repeating that campaign. This leaf covers English, Dark-theme packaged
Linux with a private unlocked keyring. Windows and passphrase-vault feedback
remain unqualified. No account/host connection was attempted; nearby C7
Pair/Ignore controls were untouched. Startup's existing updater returned 404;
no whole-app offline claim is made.

Worktree `/ai/gchat-worktrees/gchat3-secure-storage-feedback-native-20261018`,
branch `test/gchat3-secure-storage-feedback-native-20261018`, retains documentation
only. Result, summary and three screenshots are retained in canonical GChat
`out/secure-storage-feedback-native-20261018` and the ignored worktree `out/`.
The private S1 container, HOME/cache/keyring, D-Bus/display and relay are removed;
no owned processes remain and 3,451,232,455 bytes were reclaimed. CPUs 80–87
booking line2901 was canceled at 03:07:29Z; no GPU/model/build was used. The
read-only donor under
`/media/ron/SSD_RAID/ai/tmp-gchat3-linux-rc-refresh-20261017/packages-current-ed68c7443-e2282c336-release/app-stage`
remains untouched. The documentation-only gate is `git diff --check`.
## GInfer advanced option units — C3, October 18

Settings → GInfer → **Advanced engine options** described **Helper draft
length** and **Prompt processing block size** as word counts. Both values
are token counts: the extension forwards `draft_tokens` and `prefill_chunk`
to the corresponding GInfer launch arguments without a word conversion.
The copy now calls tokens pieces of text, retains Auto guidance and the
existing draft range, and states the positive-multiple-of-128 constraint for
an explicit prompt block size. Controls, stored values and launch payloads
are unchanged. The separately owned
`GUI-GINFER-PROVIDER-SETTINGS-ADVANCED` structural work remains outside this fix.

The rendered provider route opens Advanced and shows both token descriptions
with their labels, Auto guidance and constraints. All4 focused cases and lint
pass (zero errors, five existing warnings). One `make verify` passes3279 app
cases,121 extension cases,1216 native cases and all six coverage floors; six app
cases are skipped and28 native cases ignored. The native candidate builds.
No repeat gate or retry was needed.

Native acceptance passes on private Linux at1500×1000 Light and1024×740 Dark.
Real pointer input opens Advanced engine options; both descriptions are readable
and the page has no horizontal overflow. The narrow page scrolls to reveal the
prompt-block description. Inputs remain at their existing values; no model is
loaded or restarted. This is an English source-native custom-protocol build,
not installer, Windows or inference qualification. Source evidence is
`extensions/ginfer-extension/src/index.ts` (`buildGinferConfig`) and
`src-tauri/ginfer-host/src/engine_host.rs` (`LaunchOptions` command arguments).

Owned source `/ai/gchat-worktrees/c3-ginfer-token-units-20261018`, branch
`fix/c3-ginfer-token-units-20261018`, baseline `a7dadf6c2`. Results are in
`out/c3-ginfer-token-units-20261018/{result.json,summary.md}`. S1 CPU64–71,
nice10/shared socket1 lock, pinned offline image and retained dependencies;
returned03:20Z. The container is removed. Private candidate
`/media/ron/SSD_RAID/ai/tmp-c3-first-user-setup-20261018/token-units-candidate`
and profile remain only while the parent walk continues, then owned disposable
copies are removed. Three earlier candidate/baseline binaries remain unchanged.
Next: push this source branch for coordinator integration.

## Google setup credential save/import — Gchat 3 native acceptance, October 18

`GCHAT-GOOGLE-WORKSPACE-SETUP-WIZARD-20261017` passes its remaining Linux
native registration-save/import leaf. In the retained packaged app, native JSON
file selection and manual client ID/secret **Save** each reached **Step 6 of 6 —
Google setup is saved**, explicitly stating that the account was not connected.
**Choose services** returned to Workspace connections; selecting Gmail enabled
**Connect Google Workspace** with Read only selected and no connected accounts.
Connect was untouched. Returning to the manual form showed an empty secret field.

After stopping and relaunching the private app/container with the same profile
and keyring, explicitly reconnecting the local account service restored the saved
card and **Review Google setup** opened the guide. Public registration metadata
was mode 0600, recorded a saved secret and zero accounts, and contained no secret
material. Successful native configuration acknowledges the vault write; this
check does not independently read back the secret or establish credential validity.

Retained release `ed68c7443` is bound to allocated main `832fddb85`: the wizard,
import/Save service and native account/vault persistence paths are unchanged.
The route difference formats outer startup errors and does not affect this leaf.
C3's `201f46712` guide steps 1–5/manual-disabled-Save walkthrough is reused
(`out/c3-first-user-setup-20261018/google-manual-narrow.png`); his fixture was
untouched. Pointer/keyboard and GTK file selection were native; WebKit only
observed state. Four accepted screenshots were visually inspected. Results and
short summary: `out/google-setup-native-20261018/{result.json,SUMMARY.md}`.

This covers English, Dark-theme packaged Linux. Real Google consent, OAuth
callback, connected-account/token persistence, service access and Windows remain
unqualified. The first-run **Check secure storage** action belongs to its separate
row. Startup's existing updater request returned 404; no whole-app offline claim
is made. An initial file-picker driver command/path mistake was corrected using
separate native type/key calls and the actual private HOME path; no source changed.

Worktree `/ai/gchat-worktrees/gchat3-google-setup-native-20261018`, branch
`test/gchat3-google-setup-native-20261018`, retains documentation only. The S1
private container, HOME/cache/keyring, DBus/display and relay are removed; no
private processes remain and 3,425,223,923 bytes were reclaimed. CPUs 80–87 booking
was canceled at 03:00Z; no GPU/model was used. The read-only release donor under
`/media/ron/SSD_RAID/ai/tmp-gchat3-linux-rc-refresh-20261017/packages-current-ed68c7443-e2282c336-release/app-stage`
remains untouched. Only concise result/summary and four screenshots are retained
in the canonical GChat `out/` receipt folder and ignored worktree `out/`. The
documentation-only gate is `git diff --check`; no source test gate was repeated.
## Runtime preparation on first launch — C3, October 18

`GUI-SETUP-RUNTIME-INSTALL-PROGRESS`: during the fresh native `201f46712` walk,
Welcome reported that GInfer could not connect after 30 s while bundled runtime
verification was still running. Models correctly showed preparation. Hosts
had an empty list and disabled Refresh without an explanation. The private Host
connected after resource preparation completed. Debug hashing duration is not
release performance evidence.

The fix uses the existing retained `useBundledResources` state on Welcome and
Hosts. Preparation stays visible until completion; only then does the local
Host connection grace begin. An installation failure explains restart/reinstall
and keeps technical details closed. Existing setup action errors remain intact.
Hosts explains why Refresh is waiting.

Acceptance: regressions cover preparation beyond 30 s, transition to ready and
its connection grace, installation failure and Host Refresh explanation; focused
checks plus one `make verify`, then an actual changed-source private native
pending-to-ready check. No GPU/model workload, Engine numerical change or release
speed claim. Focused suites and lint pass: 48 affected cases plus three retained resource-state
cases. The ONE `make verify` passed 3,276 frontend and 121 extension cases and six
critical coverage groups, then failed an existing Fleet lib test with
`NetworkUnreachable`: the offline container had `--network=none`. Its failure is
retained. All seven original native commands then passed with container routing
and dependency access still offline (1,216 passed, 28 ignored); the full verify
was not repeated. The changed debug custom-protocol candidate built successfully.
A fresh private native launch at 02:55:02Z retained preparation past 30 s on
Welcome and Hosts; Refresh is disabled with its explanation associated by
`aria-describedby`. At 02:58:35Z preparation cleared and its private Host connected; Welcome
then showed graphics-card setup with no false error. This passes the changed-source
Linux native check (English/Dark); installation-error rendering is covered by tests. The
independent fresh walk continues in `c3-first-user-setup-20261018`.

Merged `origin/main` at `b56d94faa` without rebasing after the conflict with
Gchat 2’s setup-error persistence test (`ae9c3bed2`). The resolution keeps the
runtime-preparation cases and the actionable alert plus expanded diagnostics
through status polls. All31 focused first-run cases pass; neither affected
product source file changed during this merge, so native acceptance is retained.

Owner/source `/ai/gchat-worktrees/c3-setup-runtime-progress-20261018`, branch
`fix/c3-setup-runtime-progress-20261018`, base `4ce2a2615`. S1 private root
`/media/ron/SSD_RAID/ai/tmp-c3-first-user-setup-20261018` retains baseline native201
at `runnable/bin/gchat`; the changed candidate is at `candidate/bin/gchat`.
The fresh candidate profile is `runtime-progress-home`, with private display80
and its own loopback Host7443 (baseline display79/Host17733). The desktop rewrote the seeded17734 locator and launched PID1945362 with all
paths under the private profile. Existing private offline
dependencies and pinned image are reused. CPU64–71,
shared socket1 compile lock and nice10; no GPU held. Retain this root until the
fresh walk, hardware candidate and merge review finish, then remove owned private copies and
retain only result JSON and short summary. Read-only donor remains Claude's.
## Fresh first-time-user walk — C3, October 18

**Requested controls exercised; thirteen fixes merged.** The final follow-up
`GUI-RESET-STALE-LOCAL-HOST-CONNECTION` passed source gates and native acceptance;
merge `4514dfc73` contains signed source `63f9e8a49`. Permission-refusal recovery,
ordinary reset retry and exactly one connected replacement local Host passed.
The private session stopped and CPU booking3100 returned at 07:01Z. Both
owned S1 roots and eight exited containers retired at 07:06:23Z; concise
evidence is retained locally. The separate local donor retired after all
borrowers released it. Support destination remains
**WAITING ON RON**. This does not qualify prerequisite-dependent operations.

The requested scope was setup, Models, Downloads, Engine/Host settings,
hardware-profile controls, Fleet/connections and Settings, with actual
pointer/keyboard input, readable wording and narrow/wide Light/Dark layouts.
Chat/agents belongs to Gchat 1 and Gbot to Gchat 2. Existing GUI rows retain
their owners. Current control outcomes and individual evidence paths are in
`out/c3-first-user-setup-20261018/{result.json,summary.md}`.

The earlier source-native baseline was main `201f46712`, using an optimized
Vite frontend in a debug Rust custom-protocol shell. The installed-layout
release baseline is pinned once at
`d0a8d06bf0592b4b2d522c7e3385f08375558124`; later changed-source debug candidates
have separate evidence and are not included in that immutable AppDir. Its one
release sequence passed all seven stages at 04:31:29Z; the checked AppDir was
ready at 04:33:05Z and packaged `AppRun` launched at 04:33:32Z. All 35 dependency
manifests matched before reuse. The private refresh retained the accepted
ed68/e228 GIO, Gbot and four-family Engine closure and unchanged release
profile/AppRun hooks, while refreshing frontend, core/extensions, CLI/Host/app,
32 skill files and 23 catalogs/175 profile metadata entries. These metadata
counts do not qualify models or hardware profiles. No Engine rebuild, fresh
installer, system installation, package publication, Windows acceptance or
release-performance claim occurred. Build, payload and launch receipts are in
`out/c3-current-main-release-20261018/`.

All thirteen rows below have source gates, changed-source native acceptance and
merged source. Packet paths are under `out/`; each packet retains its detailed
counts, commands and screenshots.

| Row | Merged source | Evidence packet |
| --- | --- | --- |
| `GUI-SETUP-RUNTIME-INSTALL-PROGRESS` | `a7dadf6c2` | `c3-setup-runtime-progress-20261018/runtime-progress-result.json` |
| `GUI-HARDWARE-IDENTICAL-CARDS-COLLAPSED` | `ae6f5992f` | `c3-hardware-card-identity-20261018/result.json` |
| `GUI-GINFER-SETTINGS-TOKEN-UNITS` | `22033ee11` | `c3-ginfer-token-units-20261018/result.json` |
| `GUI-DOWNLOADS-MANAGE-WRONG-TAB` | `d4b0b9c8c` | `c3-downloads-manage-tab-20261018/result.json` |
| `GUI-DOWNLOADS-POPOVER-STATUS` | `3bbea776c` | `c3-downloads-popover-status-20261018/result.json` |
| `GUI-DOWNLOADS-TRANSFER-COUNT-WORDING` | handoff `1d07d8848`, verified in main `d4ec7abab` | `c3-download-count-wording-20261018/result.json` |
| `GUI-FOLDER-REVEAL-NESTED-RUNTIME` | handoff `ab8d451e9`, verified in main `d4ec7abab` | `c3-folder-reveal-runtime-20261018/result.json` |
| `GUI-INTERFACE-RESET-KEEPS-THEME` | `5c00b46ea` | `c3-interface-reset-theme-20261018/result.json` |
| `GUI-CLI-PACKAGED-PATH-DETECTION` | `5bf460fa8` | `c3-cli-packaged-path-detection-20261018/result.json` |
| `GUI-LINUX-AUTOSTART-XDG-PATH` | handoff `92868d3fd`, merged in main `d4ec7abab` | `c3-linux-autostart-xdg-20261018/result.json` |
| `GUI-RESET-RELOCATED-DATA-RESURRECTION` | handoff `5693c8b8f`, merge `eebad02f2` | `c3-reset-relocated-data-20261018/result.json` |
| `GUI-HOST-LOCATOR-DELETED-RUNTIME` | handoff `d262658e2`, merge `04866d698`; Arch signed 06:19:08Z | `c3-host-locator-deleted-runtime-20261018/result.json` |
| `GUI-RESET-STALE-LOCAL-HOST-CONNECTION` | source `63f9e8a49`, merge `4514dfc73`; final handoff `4b451e91a` | `c3-reset-stale-host-connection-20261018/result.json` |

Original failures remain visible in their packets. Setup's single verify hit a
network-none Fleet self-route failure; the original native commands passed in
a routed, dependency-offline continuation. Hardware retained its stale Stop
setup label failure and missing-PCI fixture compile failure, followed only by
corrected focused and remaining stages. Folder reveal retained its check-scope
and single-verify failures. Interface retained TS2367 before its corrected
remaining-stage continuation; autostart retained its initial Window fixture
failure. Each bounded correction and final build/native outcome is recorded;
no second full verify was run for those failures.

Locator source `82f17a1ac` initially reused a five-test Rust executable despite
nine frozen registry cases, because archived source mtimes preceded retained
Cargo fingerprints. That Rust/build qualification is invalid. Frontend 3,393,
extension 127 and six coverage floors remain valid. The bounded correction
normalized tracked-input mtimes without changing content, then passed all nine
registry cases, check/Clippy, seven native suites (1,256 passed, 28 existing
ignores) and desktop/Host builds. Builder booking3062 returned 06:07Z. The
candidate-only resource overlay supplied the corrected Host through the normal
startup installer; this was explicit fixture preparation. Native acceptance
replaced the stale Desktop locator without editing it manually, while all four
old runtime paths stayed absent and the selected-root replacements were
executable. Models and Downloads Refresh then completed without alerts, and
account-service Connect showed Google/Microsoft setup cards without signing in.
See `out/c3-host-locator-deleted-runtime-20261018/` receipts
`native-recovery.json`, `native-models-refresh.json`,
`native-downloads-refresh.json` and `native-account-service.json`.

The reset follow-up source `63f9e8a49` amends `7007c37fd`: exact deleted
UUID/certificate retirement preserves paired remote Hosts and concurrent Manager
edits; any returned reset error restores hidden windows. Arch signed the original
at 06:26:43Z and the amendment at 06:34:34Z. Four focused Host tests and nine
focused desktop tests passed, with one existing GPU ignore; these helper tests
are unchanged by the outer-command amendment. Check, Clippy and lint passed.
ONE `make verify` passed at 06:44:00Z: 3,406 app tests, 127 extension tests,
1,270 native tests, six app skips, 28 native ignores and six coverage floors.
The Vite build passed. The first default-desktop build lacked generated
`icons/32x32.png`; standard `yarn build:icon` corrected fixture preparation, then
only the failed native desktop/Host build resumed and passed at 06:46:48Z.
No source change or second verify was used. Future archived default-desktop
fixtures must run that existing icon-generation step before Cargo. Build
booking3084 returned 06:47Z and both exited containers were removed.

Native acceptance deliberately made the selected Host directory mode500. Actual
Reset at 06:54:44Z returned a readable preserved-identity error and restored the
same app process at Light 1024×800; saved local UUID `5a7f8db3…` and configuration
SHA stayed unchanged. The first error observation missed the brief toast because
the WebKit promise observation returned `{}`; only that inconclusive capture was
repeated. The second screenshot was visually reviewed PASS. After restoring
mode775, ordinary retry at 06:54:56Z restarted the app. At 06:54:59Z the old
identity was absent, the saved registry empty and configuration bytes unchanged.
At 06:59:51Z, the restarted app showed exactly one connected This computer.
Replacement UUID `08d55660-11dc-471c-817c-b855428dff50` was the sole saved registry
entry and matched the selected identity; both old UUIDs were absent. Selected
configuration bytes and folder stayed unchanged (SHA `106ad635…`). The Light
1024×800 refusal screenshot and Dark 1500×1000 replacement screenshot were
visually reviewed PASS. The ended fixture D-Bus left secure-storage readiness
unavailable, but did not prevent local attachment; no relaunch was needed.
App, Host, Xvfb, guard and inspector forward stopped and CPU booking3100
returned at 07:01Z. Evidence:
`out/c3-reset-stale-host-connection-20261018/{result.json,native-result.json}`.
These changed-source debug-candidate checks do not modify the pinned release.

The completed control observations are:

- Welcome preparation, Choose a model, Continue without loading a model and
  Connect a network host reached the expected unloaded/connection pages. No
  pairing or inference was submitted. The pinned release's visually reviewed
  Dark 1500×1000 `secure-storage-ready-dark-wide.png` explicitly shows “Secure
  storage is ready”, readable continuation guidance and both physical cards.
- Models Installed/Recommended/Downloads, searches, card selection, unavailable
  model explanations and native import chooser/Cancel were exercised. Downloads
  Manage now selects Downloads, closes the popover and preserves real Back/
  Forward tab history. Paused status and singular/plural transfer counts passed
  reviewed Light/Dark layouts. The paused native journal was never resumed or
  deleted; no real transfer ran.
- Hosts' **Model and memory settings** and nested **Choose model settings**
  were actually expanded in the final session. Model/GPU selectors,
  conversation/request/copies controls, image/format switches, Off/Automatic/
  DFlash and Automatic/BF16/INT8/NVFP4 menus were exercised and restored. The
  expanded Advanced guide, draft-ahead, drafting GPUs, input batch, CPU/GPU
  conversation-memory controls and CUDA Graph switch were exercised/restored.
  Check/Start remained disabled without an installed model. Dark 1500×1000 and
  Light 1024×800 ordinary/advanced screenshots were reviewed as readable without
  horizontal overflow: `native-model-settings.json` and the four model-settings/
  advanced PNGs in `out/c3-host-locator-deleted-runtime-20261018/`.
- Hardware Refresh and the actual System Monitor showed both physical PRO 6000
  cards, readable CPU/RAM values and unavailable-stat explanations, including
  reviewed `remainder-monitor-native-light-narrow.png`. No profile was launched.
  Manager passed private Pair/secure-storage/Cancel, GPU select/clear,
  Fleet/coordinator dialog/Cancel, Models Scan, unchanged Storage Save, available
  downloads refresh, Sharing off, Rename/Cancel and paired-client/request
  inspection. Dark 1500×1000 and 800×650 were readable; Manager Light was not
  available. No nearby Host or Fleet membership was changed.
- General exercised computer-name Save, data-path Copy, private data chooser/
  Cancel, Open Logs, language list, empty-token Show/Hide/Verify, spellcheck and
  default-model switches, reset Cancel by Enter and the separate confirmed
  reset regressions. Changed-source CLI Install/reopen/Uninstall/reopen passed
  with the AppDir first on PATH; only the private user-bin CLI was installed.
  Uninstall retains existing Host/launcher support files by contract. Folder
  reveal selected `logs` through the private FileManager1 handler and subsequent
  Interface navigation remained responsive. Autostart passed XDG enable/reopen
  On/disable/remove/reopen Off with HOME/.config absent and packaged AppRun in
  the entry. Interface Reset restored Dark/Medium from Light/Extra Large;
  wide/narrow screenshots were reviewed. The locator session left Light/Medium.
- Workspace connections exercised the private account service, Google import/
  manual guide, Google/Microsoft service choices, Read only/Read write and
  unchanged Save without real credentials. Attachments, Shortcuts, Proxy and
  MCP controls/instructions were read and reversible settings restored. No new
  npx tool was launched; the app's bundled exa HTTP MCP connects automatically.
  Two input-command mistakes entered follow-on command text into private fields;
  the fields were cleared and defaults verified. These were execution errors,
  not product defects; bad intermediate evidence is excluded.

Pinned release General reproduced the bundled-CLI false Installed state,
Interface Reset retaining Light, folder-reveal abort, autostart failure and
reset returning to the retained original default data folder after relocation.
Exact autostart ENOENT console evidence at 04:50:19Z came from badge candidate
`72c76c51a`, whose startup source matched the release; the release click had the
same visible failure. Native relocation copied/restarted at the selected root
and retained its old copy. The changed-source reset then deleted the selected
sentinel, preserved the old-default sentinel and configuration bytes, and
restarted at the same selected root. No seeded-chat resurrection was exercised.
Historical failure receipts remain in `out/c3-current-main-release-20261018/`:
`cli-false-installed.json`, `autostart-console.json`,
`factory-reset-relocation.json`, `folder-reveal-crash.json` and
`remainder-runtime-locator-diagnosis.json`.

The remaining prerequisite-dependent leaves need a published download
descriptor, installed model, prepared/booked GPU group, owned account credentials
or configured Fleet coordinator. No model load, inference, profiling, GPU work,
OAuth/account sign-in or conditional enrollment/assignment was performed.
Earlier saved-instance settings acceptance remains separately attributed in
`out/c3-engine-settings-native-20261018/result.json`. The structural GInfer
provider redesign and updater404 retain their existing owners/rows. Settings →
Open an issue opened the private browser at the current public issue URL and
rendered GitHub404. `GUI-SETTINGS-SUPPORT-LINK-404` waits for Ron's destination
decision; the URL constant was merged through `78ce5f45f` without inventing a
replacement. Evidence: `private-browser-after-cancel.png` in the broad packet.

Owner: Codex 3; worktree `/ai/gchat-worktrees/c3-first-user-setup-20261018`,
branch `fix/c3-first-user-setup-20261018`. S1 root:
`/media/ron/SSD_RAID/ai/tmp-c3-first-user-setup-20261018`. Native isolation used
private HOME/XDG700/Xauthority/Xvfb, D-Bus, an unlocked private keyring and
WAYLAND unset; inspectors only observed state. The locator app, Host, keyring,
D-Bus and Xvfb stopped and native booking3073 CPU88–95 returned 06:18Z. C7's
AppDir read-copy ended 06:07Z and tools custody released 06:15Z. C4's
copies/displays are terminal. The separate reset-regression app, Host, Xvfb,
guard and inspector forward stopped and booking3100 CPU64–71 returned 07:01Z.
Final candidate/profile retirement completed at 07:06:23Z after the verified merge.

At 06:12Z, reference/link checks preceded retirement of owned `gchat`,
`native-target`, `cargo-home`, `yarn-cache`, `status-candidate` and the release
source archive: 37,217,689,600 allocated bytes (34.7 GiB), not a physical
free-space claim across reflinks. Receipt:
`out/c3-current-main-release-20261018/build-cache-cleanup-0610.json`. Earlier
merged candidate exports were retired with concise evidence retained in
`merged-export-cleanup-0548.json` and `merged-reset-export-cleanup-0601.json`;
Interface/CLI exports had already retired at 05:34:57Z. No shared build/cache
stage remained after that step. The separate reset build root was
`/media/ron/SSD_RAID/ai/tmp-c3-reset-stale-host-connection-20261018`; its source,
Cargo cache, target and staging inputs retired at 06:58Z (31,818,774,811 logical
bytes; `out/c3-reset-stale-host-connection-20261018/build-retirement.json`).

Final reference checks found no live process or inbound dependency. At
07:06:23Z both literal C3 S1 roots were removed, including the immutable AppDir,
runnable/tools, private profiles and accepted candidate exports. This final
step retired 21,675,034,149 logical bytes and eight exited C3 containers;
reflink sharing means this is not a physical free-space claim. The coordinator
preserved 127 small metadata, failure and native/Host-locator evidence files
locally. Receipt:
`out/c3-reset-stale-host-connection-20261018/final-retirement.json`. All paths
above now identify historical fixtures; no campaign build/native job or S1
resource remains. External donors and model inputs were untouched.

The separate local donor `out/c3-chat-area-hands-on-20261017/runnable`
retired at 07:04Z after C6, C7 and Claude Arch returned all loans. Its inbound SC
resource link was confirmed to point into the C3 donor; no independent copy was
needed after closure. Accessible process references, mounts and active Docker
mounts were empty; inaccessible process fields were supplemented by explicit
owner releases. Only the literal C3 runnable was removed: 4,122,204,474 logical
bytes. SC/C6 trees and their released symlink files were untouched. The existing
`out/c3-chat-area-hands-on-20261017/rule22-local-cleanup-20261018.json` records
8,968,724,608 total logical bytes retired across that scoped cleanup.

The walk and its owned resource retirement are complete. Support destination
selection remains with Ron; prerequisite-dependent operations remain excluded.
The original duplicate-card evidence remains in `out/c3-host-locator-deleted-runtime-20261018/native-model-settings.json`.
No further native check is required for this completed control walk.

## Connect service-selection hint — Gchat 2 native acceptance, October 18

`GUI-CONNECT-NEEDS-SERVICE-HINT` passes its Linux native check in the
OLD VM. Settings → Workspace connections first showed the cold account-service
prompt. After explicitly connecting the local service in a private profile,
Microsoft 365 had no selected services and showed **Select at least one service
above to continue.** The disabled **Sign in with Microsoft** button referenced
that hint through `aria-describedby`. Selecting Outlook mail removed the hint
and enabled sign-in; trusted native Space input cleared the checkbox and
restored both the hint and disabled state. The screenshot is readable. Both
providers retained Read only and no connected accounts.

The retained release `ed68c7443` contains source fix `c632d22d3`, merged in
`9564df2af`. The provider card, service fieldset and relevant controls match
through baseline main `800e07fef`; later startup-error formatting is outside
this acceptance. The recorded 29 focused cases and subsequent single
`make verify` at `dbec106e4` passed (3,102 frontend,119 extension and Rust;
exit0). This evidence-only change uses `git diff --check`, with no repeated
source gate. Result and summary:
`out/gchat2-connect-service-hint-native-20261018/{result.json,SUMMARY.md}`.

This covers English, Dark-theme native Linux. Google was unconfigured; no
Google setup, configuration Save, browser sign-in, OAuth consent, account
connection or model action was performed. Windows, screen-reader speech and
startup-error formatting remain unqualified. WebKit observed state and
screenshots; pointer and keyboard actions used the native window.

Worktree `/ai/gchat-worktrees/gchat2-connect-service-hint-native-20261018`,
branch `test/gchat2-connect-service-hint-native-20261018`, retains documentation
only. All 15 private session/service processes, the private guest AppDir,
HOME/runtime and S1 scratch are removed. OLD is OFF with original XML restored;
FRESH was untouched. Relay ended and booking was canceled: returned02:11Z.
Only result JSON and short summary remain; the read-only donor stays with
Gchat 3.

## Downloads button — Gchat 2 native acceptance, October 18

`GUI-DOWNLOADS-BUTTON-LABEL` passes the remaining Linux native check in the
OLD VM. With the sidebar expanded and collapsed, the icon has the accessible
name and native hover tooltip **Downloads**. Real Tab/Shift+Tab input shows its
focus ring; Enter and Space open the idle download popover. Escape closes it
and retains focus on the trigger without changing the page. WebKit inspection
observed state and screenshots; recorded keyboard events were trusted.

The retained release `ed68c7443` contains source fix `fe6f156d9` (merged in
`c48538a27`). The component, placements, shared controls, translation and download
stores are unchanged through main `301ca645a`. Its recorded focused case and
the original combined `make verify` passed; this evidence-only update uses
`git diff --check` and repeats no source gate. Result and short summary:
`out/gchat2-downloads-button-native-20261018/{result.json,SUMMARY.md}`.

This acceptance covers the English, Dark-theme idle button on Linux. Actual
screen-reader speech, Windows and active Host-managed transfers remain outside
this check; the latter belongs to `GUI-DOWNLOADS-POPOVER-MANAGED`. No download,
model setup or account action was performed. A desktop color-device
authentication prompt received no input. One observation assertion initially
compared the popover's line break literally; whitespace normalization confirmed
the expected visible text without changing the app.

Worktree `/ai/gchat-worktrees/gchat2-downloads-button-native-20261018`, branch
`test/gchat2-downloads-button-native-20261018`, baseline `301ca645a`, retains this
documentation only. The private guest AppDir, HOME, runtime and session processes
are removed. OLD is OFF with its original XML; FRESH was untouched. The owned
S1 scratch and relay are removed, booking canceled: returned02:06Z. The retained
read-only donor remains with Gchat 3; only result JSON and short summary remain.

## Models plain wording — C7 retained native scopes, October 18
## Models plain wording — source fix, October 18

C7 rewrites the remaining Models states, errors and actions for a first-time
user: recommendations, download recovery, startup, remote model servers,
graphics-card setup, saved memory/settings, sharing/access and removal.
Primary errors explain recovery; original diagnostics remain in closed details.
Refresh downloads now refreshes transfer jobs rather than rescanning installed
models. Source and evidence share `fix/c7-models-plain-wording-20261018`,
baseline `19e9064ab`.

245 focused frontend cases, 54 manager cases, typecheck and lint pass. The one
`make verify` stopped at four old-label benchmark assertions. Correcting those
expectations preserved behavior/payload/session checks; the failed and remaining
stages then passed: 3,256 frontend, 121 extension and 1,210 Rust tests, all six
coverage floors. The original command remains exit2. Two final computer-location
text changes passed 79 affected cases and final frontend/native builds.

Seven checked native Linux screenshots cover Installed/removal, recommendations,
paused/interrupted/full-disk downloads, optional diagnostics, setup and saved
settings. Native pointer input used isolated HOME/XDG, X11, dbus and keyring.
Catalog and saved transfer fixtures establish presentation; transient/older-Host
states have rendered tests. No payload download, model load or GPU work;
Windows and installers remain unqualified. Evidence:
`out/c7-models-plain-wording-20261018/{result.json,summary.md}` and PNGs.

Owned source worktree remains `/ai/gchat-worktrees/c7-models-plain-wording-20261018`.
The 41.2 GB S1 build/runtime and nine terminal containers were removed; all
private processes stopped and CPUs0–7 returned02:32Z, booking canceled.
Read-only donors and the external model package were preserved. No live job
or booking remains; only concise evidence and screenshots are newly retained.

## Sidebar transfer count — C7 closure, October 18

`GUI-TRANSFER-COUNT` is complete in merged source `39174a0eb`. The sidebar
previously added local model jobs to all Host snapshots, counting the local
Host's mirror a second time. It now adds only registered remote Host jobs to
the local count. Separate computers downloading the same model remain separate
transfers; installed jobs are excluded.

The original exact-source 13 rendered tests passed, including one mirrored
local job, a separate remote same-model job, and removal despite a stale local
snapshot. One `make verify` completed October 17 at16:52:40Z with exit0:
3,043 frontend tests (six skipped),119 extension tests and1,075 Rust tests
(27 ignored); all six critical coverage floors passed. Lint had zero errors
and five existing warnings. These stored logs and exit files were recovered;
`NavMain.tsx` is unchanged through main `24661cd22`. This documentation-only
closure uses `git diff --check`; no gate was repeated. Evidence:
`out/c7-model-transfer-count-20261017/{result.json,summary.md}`.

This closes the source/rendered regression row. No additional installed-app,
Windows, download, model or GPU acceptance is claimed. C7 owns documentation
worktree `/ai/gchat-worktrees/c7-transfer-count-closure-20261018`, branch
`docs/c7-transfer-count-closure-20261018`, baseline `24661cd22`. No new build,
runtime or booking was allocated. The old exited test container and superseded
source archive are retired. The private catalog baseline/dependency cache
at `/media/ron/SSD_RAID/ai/tmp-c7-private-catalog-gate-20261017` was reused for
the account-service regression gate, then retired after its final passing gate
on 18 October at 04:38 UTC. Result JSON and a short summary retain the outcomes.

## Readable installed model names — C7 native acceptance, closed October 18

`GUI-MODEL-READABLE-NAME` passes its remaining Linux installed leaf in retained
release `ed68c7443`. A private manifest points read-only to the genuine Qwen 27B
**2-bit mix** package
`ab1ddc96b0f43e772468059567262d4dcc0fd38e9f402d589ad697070a83ad61` at
`/media/ron/SSD_RAID/ai/gbot-models/qwen38_27b_smol_df2.ginfer`.
Models Installed, GInfer provider settings and the Hermes runtime-model picker
all show **Qwen 27B 2-bit mix**. Real pointer and typing input searched and
selected that name; the closed picker retained it. The package hash remains
its internal ID/title rather than the visible label. WebKit inspection only
observed DOM state and screenshots; native click events were trusted.

Source fix `f0f511b92`, 55 focused cases and combined full gate `c48538a27`
are reused. Manifest enumeration, runtime display-name mapping and the Hermes
route/hook/store match current `0b370ec2a` for this manifest. The newer plain-name
suffix cleanup does not change this plain label. This documentation-only leaf
uses `git diff --check`. Evidence:
`out/c7-model-readable-name-installed-20261018/{result.json,summary.md}`.

This qualifies Installed, the provider list and the actual Hermes model picker
on Linux. No catalog download, Save connection or model load was performed.
The chat picker filters unloaded GInfer models and was not exercised; Windows
and release-wide acceptance are outside this observation.

C7 retains worktree `/ai/gchat-worktrees/c7-model-readable-name-installed-20261018`,
branch `test/c7-model-readable-name-installed-20261018`, baseline `07bbd912b`.
S1 CPUs40–47 returned01:45Z. All private app/Host/session and forwarding processes
stopped by verified PID, the 7.80GB runtime root
`/media/ron/SSD_RAID/ai/tmp-c7-model-readable-name-installed-20261018` was removed,
and the booking was canceled. The read-only release donor and external package
were preserved. Only result JSON and short summary are newly retained; no live
job or booking remains. No GPU workload or shared profile was used.
## Factory reset unloads Host instances — C3, October 18

Active priority P2 on `991a55e74`, merged `0b370ec2a`: the removed frontend
unload has no native replacement; session-map cleanup leaves loaded Host
instances and GPU allocations alive through reset deletion. Native reset must
stop and await every loaded Host instance before clearing handles or deleting
data, after Agent admission is fenced and active tools have drained. Teardown
failure must refuse deletion and remain visible to the user.

Acceptance: a loaded native Host instance is stopped through the production
reset path before data deletion; its owning process and GPU allocation are
gone. Add a meaningful regression, run focused tests/check/Clippy and one full
`make verify`, send Codex 8 the result, then mail Bubbs merge-ready. Reuse the
retained exact Engine/model donor for one private S1 native GPU check if needed.

Owner/source: `/ai/gchat-worktrees/c3-reset-host-unload-20261018`, branch
`fix/c3-reset-host-unload-20261018`, base `910fcd6ac`, source `94d641302`.
All five focused reset cases, Rust check and strict Clippy pass. One full
`make verify` passes: 3,207 frontend, 121 extension and 1,212 native tests,
zero failures, six frontend skips, 28 native ignores and all six critical
coverage floors. The real GPU allocation/release check also passes.
Reset owns only the selected
local desktop Host; paired remote Hosts retain their independent ownership.
Its fresh native snapshot covers Ready and still-starting sessions absent from
the plugin map. Stop waits for Engine exit, then idle Host Stop seals admission
and reset retains the Host ownership lock through deletion.

S1 GPU1's real Muse Engine held 19,256 MiB at Ready (19,274 MiB total).
Production native reset stopped it before deletion: the sentinel remained
present while compute apps and reservations were empty and GPU memory returned
to the 10 MiB baseline. After deletion no compute apps remained and usage was
still 10 MiB. The regression uses the real TLS Host fixture and mock Tauri
handle; no installer, GUI or Windows qualification is claimed. Arch signed
the source with full/GPU conditions now satisfied; Codex 8 review was requested.

Private build root: `/media/ron/SSD_RAID/ai/tmp-c3-reset-host-unload-20261018`,
S1 CPUs24–31 used01:48–01:59Z, offline read-only dependencies from
`/media/ron/SSD_RAID/ai/tmp-claude-gchat-finish-20261017/tool-source` and its
Cargo cache; pinned image `sha256:ad7f9bf020d7699a6e87f38a57612413478a6364dd503de5e09805001d44ff14`.
Only private copies are mutated. CPU24–31 uses the shared native build lock
(socket 0), nice10 and eight Cargo jobs. The separate GPU1 test used CPUs8–15;
returned01:58Z. The private 24 GiB build and two stopped containers are removed; build CPUs
returned01:59Z. Only [result](../../out/c3-reset-host-unload-20261018/result.json) and
[summary](../../out/c3-reset-host-unload-20261018/summary.md) are retained.
Next: Codex 8 follow-up and Bubbs merge; resume the startup-quote native row.

## Launch form initial error — C7 installed acceptance, closed October 18

`GUI-LAUNCH-ERROR-EARLY` passes its native Linux installed recheck. In retained
release `ed68c7443`, real pointer input opened **Hosts → Server details → Custom
server settings**. With no model selected and Context tokens blank, no number
error appeared. **Check startup settings** and **Load model** remained disabled.
The connected private Host had no loaded models. WebKit inspection observed the
state and did not synthesize the acceptance input.

The release contains source fix `a929b3d48`; the relevant selection, numeric
validation and alert condition match main `1f2124845`. Existing 32 focused cases
and combined full gate `c48538a27` are reused. This documentation-only leaf uses
`git diff --check`. Evidence: `out/c7-launch-error-installed-20261018/`
`{result.json,summary.md}`. This qualifies the initial no-model form in that
Linux release; Windows, selected-model validation and release-wide acceptance
are outside this observation.

C7 retains worktree `/ai/gchat-worktrees/c7-launch-error-installed-20261018`,
branch `test/c7-launch-error-installed-20261018`. S1 CPUs40–47 returned01:37Z;
all private app/Host/session and forwarding processes stopped by recorded PID,
and the 7.80GB private runtime root
`/media/ron/SSD_RAID/ai/tmp-c7-launch-error-installed-20261018` was removed.
The read-only release donor was preserved. Only result JSON and short summary
remain; no live job or booking remains. No model load, hardware Ensure, startup
check, pairing, sharing, installer, Windows account or shared app data was used.
## Factory reset drains active Agents — C3, October 18

Bubbs's priority P2 on merged `9d0a61124`: hiding the last window avoids the
ordinary close event, leaving shared Agent tools running during reset deletion.
Fence new shared Agent turns, cancel existing turns and wait for their cleanup
and durable writes before hiding windows, stopping dependencies or deleting data.
A drain timeout must preserve the data and return an error. Keep the successful
native reset lifecycle from `c681367eb`.

Acceptance: an actual active Agent tool is cancelled and drained before the
production reset data path deletes disposable data; admission remains closed;
no late write recreates deleted content. Run focused lifecycle regressions,
Rust check and Clippy, and one full `make verify`, then send Codex 8 the branch
for the requested follow-up and mail Bubbs merge-ready. No model/GUI/release or
profiling run is needed for this backend lifetime correction.

Owner/source: C3, `/ai/gchat-worktrees/c3-reset-agent-drain-20261018`, branch
`fix/c3-reset-agent-drain-20261018`, baseline `29c301aeb`. S1 private
build root `/media/ron/SSD_RAID/ai/tmp-c3-reset-agent-drain-20261018`, offline
read-only dependency donor `/media/ron/SSD_RAID/ai/tmp-claude-gchat-finish-20261017/tool-source`,
pinned image `sha256:ad7f9bf020d7699a6e87f38a57612413478a6364dd503de5e09805001d44ff14`.
S1 CPUs104–111 used 01:31–01:41Z for private dependency preparation and gates,
under the shared socket-1 compile lock at nice10; no GPU allocation. The native
reset now requires shared Agent shutdown success before hiding windows or
tearing down dependencies. Frontend reset leaves engine shutdown to that ordered native path and
preserves preferences when drain fails. The pending reset flag is consumed
before store hydration on a successful restart, rather than clearing preferences
while Agent cleanup is pending. All 15 focused Agent lifecycle tests pass,
including the active native shell and paused-clock timeout regressions; Rust
check and Clippy pass. All 56 focused frontend cases pass across reset service,
settings, confirmation and early boot. The first frontend collection lacked
the compiled core entry point; copied the unchanged donor's core build before
continuing the uncollected suites. Future private frontend staging must include
the core build as well as dependency directories. One full `make verify` passes:
3,207 frontend, 121 extension and 1,210 Rust tests, zero failures, six frontend
skips, 27 Rust ignores and all six critical coverage floors. This is Linux
backend/component qualification; no installer rebuild or native Windows GUI run.
The 25 GiB private S1 build and three stopped gate containers were removed;
CPUs returned 01:41Z. Retain only the
[result](../../out/c3-reset-agent-drain-20261018/result.json) and
[summary](../../out/c3-reset-agent-drain-20261018/summary.md).
Next: Codex 8 follow-up review and Bubbs's merge; continue the paused startup
quote native acceptance separately.
## Native radio arrow-key focus — Gchat 2, October 18

`GUI-CHECKBOX-THEME`: the retained Linux release from `ed68c7443` has the
same native-control CSS and test as main `29c301aeb`. In OLD's private app
profile, real XTest input passed 16px Models checkbox checked/unchecked,
Tab and Space controls in Light and Dark. Gbot's **Service computer** radios
changed selection with Right/Left, but WebKit reported `:focus-visible` false
and removed the focus ring in both themes. Tab or Space restored it.

Native radios now use `:focus`; checkboxes retain `:focus-visible`.
The existing stylesheet regression checks that selector and its outline.
Six focused cases and one full `make verify` pass: 3,200 frontend, 121 extension
and 1,208 Rust tests, with six frontend skips and 27 Rust ignores. All six
critical coverage floors pass; all 3,100 tracked source files remain unchanged
across verification. No Engine code changed.

The production release candidate passes native Right/Left radio selection in
Light and Dark: the selected radio retains its visible 2px theme ring even when
WebKit reports `:focus-visible` false. Models checkboxes also pass real Tab/Space,
checked and unchecked, in both themes. All observed XTest key events are trusted;
native viewport snapshots were visually inspected. Dark was restored.

The private app/profile and owned SSD build/cache root were removed. OLD is OFF
with its original XML restored and hash matched; FRESH was untouched. CPUs
returned after replay. This is limited to Linux Models checkboxes and Gbot
service-computer radios; connected Host, signed-in Workspace and disabled
controls remain unqualified, as does Windows.
No model, setup, sign-in, Ensure, save or service-computer confirmation was run.
Evidence: [native-control result](../../out/gchat2-checkbox-native-20261018/result.json).
## Startup-check result through native polling — C3, closed October 18

`GCHAT-STARTUP-QUOTE-POLL-REVISION-20261017` passes its remaining native Linux
acceptance. The source fix `a08e2b053` removes ordinary snapshot revision from
quote identity while retaining the selected Host, boot, artifact, devices and
launch settings. The retained release `ed68c7443` has the same quote identity
and lifecycle logic, verified by the affected source diff; it was used read-only.

In the isolated native AppRun on S1 `AIS-2-8592-L01`, real xdotool input selected
the actual installed Muse groupwise-Q4 TP1 artifact and invoked **Check startup
settings** once at its full 131,072-token context. The successful result remained
visible for 25.236 seconds through ordinary five-second polling, including Host
revision 7 → 8. Four observations retain identical launch inputs and result text,
unchanged boot ID and zero loaded instances. The real Engine quote reported
83,446,686,976 bytes GPU KV per instance. The inspector only observed state.

The one completed artifact-scoped native hardware profile passed in 124.508
seconds on S1 GPU1, Engine `e2282c336`; no model server or inference was started.
Existing source evidence remains valid: 30 focused cases and lint passed, and
one `make verify` passed (2,740 frontend, 119 extension, 1,073 native tests; all
six critical coverage floors). This evidence-only closure uses `git diff --check`.
Results: `out/c3-startup-quote-poll-native-20261018/{result.json,summary.md}`;
source gates: `out/c3-startup-quote-poll-revision-20261017/result.json`.

Owned source record is `/ai/gchat-worktrees/c3-startup-quote-poll-native-20261018`,
branch `test/c3-startup-quote-poll-native-20261018`, base `9d0a61124`.
The private S1 app, Host, display and keyring stopped; its 3.3GiB private SSD
root was removed, preserving the retained AppDir, runtime and model donors.
GPU1 had no compute process and returned to its 10MiB baseline. GPU1/CPUs8–15
returned02:08Z. Only result JSON and this short summary are retained locally.
The unchanged Linux startup-check behavior is qualified; Windows is outside
this acceptance. Next action: coordinator merge of this closure record.

## Confirmation replacement focus — October 18

`GUI-NATIVE-CONFIRM-DIALOGS` already uses the shared themed confirmation dialog
merged in `b04ff4e25` / `89590531e`. If a second request replaces an open prompt
while **Confirm** is focused, the replacement now resets focus to **Cancel**.
The first promise resolves `false`; pressing Enter then declines the second
request. Explicit confirmation and Escape retain their existing behavior.
The regression reproduced as one failure and two passes before the fix; all
three focused cases pass with the fix. One full `make verify` passes on S1
CPUs104–111: 3,199 frontend, 120 extension and 1,208 Rust tests (six frontend
skips, 27 Rust ignores); all six critical coverage floors pass. The source
postcheck passes for all 3,100 tracked files. This qualifies the rendered
component on Linux.
Evidence: [replacement-focus result](../../out/gui-confirm-replacement-focus-20261018/result.json).
## Local import preserves native context — C7, fixed October 18

`GUI-MODELS-LOCAL-IMPORT` follow-up resolves Codex 8's P2: external registration
assigned UUID catalog IDs but omitted the artifact identity used by the
extension to discover native context. The new manifest persists the Host-admitted
`entry.metadata.identity` at top level. A fresh UUID registration therefore
retains its package context through provider discovery and auto-load.

The Rust registration/reopen fixture checks the serialized identity. The
extension regression uses an external UUID entry with Muse identity and a
misleading Qwen filename/display label; list, get and context lookup all return
131,072. The original provider/model regression checked that this context
reached auto-load. The October 18 settings-ownership decision above supersedes
that startup forwarding: ordinary automatic loads now select a complete tested
Host profile, whose context may differ from the artifact's native context.
Manifest identity and native-context discovery remain preserved.

All 81 focused cases pass (24 extension, 49 provider/model, eight Rust), as do
Rust check and Clippy. One `make verify` exited 0: 3,199 frontend tests and
121 extension tests passed, six skipped; 1,208 native tests passed, 27 ignored.
All six critical coverage floors passed. Lint has zero errors and five existing
warnings. Results: `out/c7-local-import-context-20261018/{result.json,summary.md}`.

C7 owns `/ai/gchat-worktrees/c7-local-import-context-20261018`, branch
`fix/c7-local-import-context-20261018`, based on main `18603aeb7`. Verification
ran on S1 `AIS-2-8592-L01` CPUs88–95 in pinned image `ad7f9bf020d7` with private
offline caches and retained read-only launch profiles. The exited container and
private SSD build root `/media/ron/SSD_RAID/ai/tmp-c7-local-import-context-20261018`
are removed; the existing C7 private-catalog donor remains unchanged for its
retained campaign. Only the result JSON and short summary are newly retained.
No app, model, GPU, installer, Windows account or shared app data was involved.
CPUs returned 01:15Z. Next: Codex 8 review and coordinator merge.
## Local models under a symlinked data folder — C3, October 18

`GUI-MODELS-SYMLINK-DATA-ROOT-20261018` fixes the empty Installed list after a
successful external-model registration when the configured data folder uses a
symlink. The installed-DEB walk used a short HOME alias for Gbot's libvirt socket
path limit. Registration wrote `model.yml`, and catalog discovery returned its
canonical SSD path; YAML reads compared that path against the lexical data root
and failed, so provider discovery returned no models.

YAML reads and writes now resolve the configured root and requested path before
checking containment. Legitimate canonical, lexical and relative rooted paths
remain usable. Existing dangling links fail resolution; outside paths and
symlink escapes remain rejected. The regression uses actual model enumeration
through a symlinked data folder, reads and updates the discovered manifest, and
creates a new rooted YAML file. The containment fixture also verifies that
outside files remain unchanged and outside destinations are not created.

Eight focused filesystem tests, Rust check and library Clippy pass. One full
`make verify` passes: 3,596 frontend tests, 127 extension tests and 1,290 native
tests; six frontend skips and 28 native ignores. All six critical coverage
floors pass; lint has zero errors and five existing warnings. An initial Clippy
invocation selected unsupported desktop binary tests alongside CLI-only
features and hit an existing unrelated test lint; the corrected library target
passes without source changes or lint waivers. The full gate was not repeated.
Evidence: `out/c3-models-symlink-data-root-20261018/{verification-result.json,
summary.md,verify.log,focused.log,check.log,clippy-lib.log,clippy.log}`.

The fresh Vite frontend and normal default-feature debug desktop build pass on
S1 `AIS-2-8592-L01`, using seven frozen catalog inputs with 41 bundled profiles.
The exported `native/bin/gchat` uses Tauri's sibling `../lib/GChat/resources`
layout, with owned copied resources. Effective commands and the exported binary
hash are in `native-build-command.json` and `native-export-result.json` beside
the gate evidence. Native acceptance then used private HOME `/tmp/c3ym18/home`,
an alias to the owned SSD fixture, with only the existing external-model
manifest copied. Models → This computer → Installed shows
`qwen38_27b_int_df2` before and after the native Refresh installed models action.
Bundled runtime preparation and Refresh both completed; the refreshed control
is enabled and the card remains visible. The coordinator inspected the final
pixels. No model was copied, reimported or loaded, and no inference ran.
Evidence: `native-acceptance-result.json`, `installed-after-refresh.json` and
`installed-after-refresh.png` beside the gate evidence.

The initial fixture launch failed because Xvfb was absent from PATH and DISPLAY
was missing. An explicit copied Xvfb path and `DISPLAY=:175` repaired that
private launch. The app then exited through native tray Quit, with completed
cleanup in `native-lifecycle.log`. Refresh had started an idle private Host;
it stopped through its supported SIGTERM shutdown handler, then the private
Xvfb stopped. The private HOME and short alias are removed. The installed-DEB
fixture, primary display, Hosts, GPU workloads and resource donors were not changed.

C3 owns branch `fix/c3-models-symlink-data-root-20261018`, worktree
`/ai/gchat-worktrees/c3-models-symlink-data-root-20261018`, based on main
`585a854058ecbdc3e6923d7c5533cdd9778d1fd8`. The private S1 source, caches, build
and native export are retained at
`/media/ron/SSD_RAID/ai/tmp-c3-models-symlink-data-root-20261018` for coordinator
merge, with no live jobs. CPUs88–95 returned 13:12Z; native acceptance CPUs104–111
returned 13:24Z. Next: coordinator merge; remove disposable owned build bytes
when the item closes.

## Installed dropdown acceptance — C7, October 18

`GUI-DROPDOWN-THEME-CONSISTENCY-20261017` now replaces native select popups
with the existing app-rendered Radix radio menus through `ChoiceSelect`. Native
WebKitGTK reproduced a white serving popup in Dark mode despite dark computed
option styles, so CSS color-scheme alone did not meet the contract. The shared
control preserves values, disabled choices and callbacks, focuses the checked
choice, restores focus on Escape, and advances on Tab or Shift-Tab. It explicitly
skips controls inside closed details: WebKit reports rectangles for them even
though they cannot receive focus. The serving field and action buttons wrap so
long labels retain a usable width.

Native Linux acceptance on S1 `AIS-2-8592-L01` uses source `8f4d0724f`, two
actually paired private Hosts and two saved, stopped instances. OS screenshots
show readable serving-instance, saved-profile and Fleet-coordinator popups in
Light/Medium (Geist 14px) and Dark/Large (15.75px), with app palette colors and
wrapped long choices. Trusted XTest keyboard input selects another stopped
server, a saved profile and a coordinator draft. Escape restores trigger focus;
Tab reaches Start model without activating it; Shift-Tab reaches the preceding
visible summary instead of a hidden setting. The shared Theme/Font Size native
acceptance in retained release `ed68c7443` remains valid. Results and seven
native screenshots are in `out/c7-dropdown-host-selectors-20261018/` in this
source branch.

One `make verify` invocation stopped on an unsupported Radix lifecycle prop.
After that correction, the remaining stages found and corrected tests that used
native-select interaction and split eight reasoning-effort saves into independent
cases with unchanged payload assertions and timeout. All verification stages
then pass: 3,298 frontend tests, 121 extension tests, all six critical coverage
floors and 1,216 Rust tests (six frontend skips, 28 Rust ignores); lint has zero
errors and five existing warnings. After the native layout/focus corrections,
42 focused tests, typecheck, production-control lint and frontend/native builds
pass. This is a continued stage result, not a second full verification run.

C7 owns `/ai/gchat-worktrees/c7-dropdown-host-selectors-20261018`, branch
`test/c7-dropdown-host-selectors-20261018`, based on `d03667c8d`. The native
session and all fixture services are stopped. The 39 GiB private SSD build/cache
and five stopped containers are removed; CPUs104–111 returned04:04Z. Merge of
main `548d73ed8` at `45354f116` preserves both adjacent regression suites and
passes 214 focused cases across six affected files plus typecheck. Read-only
ed68 AppDir and Flash Next pure 2-bit donors
were unchanged (package SHA256
`8bbb85bf6ba669157045bac0a6fdd623dd87694b7b1fe09b7f2150fc3636ab08`).
No model start, GPU computation, Fleet authority change, Windows account change
or release-wide qualification is claimed. Windows native UI remains unqualified.
The earlier FRESH VM is OFF with original XML and its private stage removed.
Source and native evidence merged as `01b14d5bd`. This replacement also closes
the historical `GUI-NATIVE-SELECT-LOOK` row's remaining Light appearance check.

## Models tabs installed keyboard acceptance — C7, closed October 18

`GUI-MODELS-TABS-KEYBOARD` passes the remaining native Linux keyboard leaf.
The source fix (`6d604972a`, merge `ca11ad8c0`) and its 27 focused cases were
already merged. Retained release AppDir source
`ed68c7443d3d782869dad89736ca049631f8a157` has the same tab order, map and
keyboard handler as current source `d8ce59320`; no rebuild was needed.

On S1 `AIS-2-8592-L01`, real xdotool/XTest input reached the native WebView
in a private Xvfb display. Observed key events were trusted. Fourteen states
establish one selected tab and one tab stop, Right/Left wrap, Home/End selection,
and Tab/Shift-Tab into and out of Installed, Recommended and Downloads. Focus,
`aria-selected` and visible panel content stayed consistent; Tab reached each
panel's refresh control. The inspector observed DOM state and did not synthesize
keyboard input. Results are
`out/c7-models-tabs-installed-20261018/{result.json,summary.md}`.

The app used a private HOME/XDG, session bus and unlocked keyring. All owned
processes stopped by recorded PID, and its 3.28GiB private runtime/profile/tool
root `/media/ron/SSD_RAID/ai/tmp-c7-models-tabs-installed-20261018` was removed.
CPUs96–103 returned00:58Z. Gchat3's retained AppDir was read-only; no build,
model load, profile, download, benchmark or GPU allocation was needed.
This establishes the unchanged tab behavior in that Linux release. Windows
WebView, later local-import controls and release-wide qualification are outside
this result. Ron's installation and shared app data were untouched.

Owned source worktree
`/ai/gchat-worktrees/c7-models-tabs-installed-20261018`, branch
`test/c7-models-tabs-installed-20261018`, remains for review. Only the result JSON
and short summary are retained as new local artifacts; no live job or booking
remains. This documentation-only closure uses `git diff --check`; source gates
were reused. Next action: coordinator merge of the closure record.

## Connected Gbot desktop, approvals and history — Gchat 2

`GBOT-DESKTOP-TASKS-APPROVALS-WALK`, October 17–18, 2026: the previously
unreached connected-bot screens were exercised in the lane's FRESH and OLD
Linux VM fixtures, one running at a time. Each native app used its own HOME,
runtime directory, dbus session and unlocked keyring on the fixture's display.
The baseline production frontend/native app was built from main `9e75fc31e`;
the corrected candidate is based on main `c0a1b5a95`.

Both fixtures streamed the real 1920×1080 bot desktop in view-only and human
control modes. Hand back restored bot control. FRESH also passed the native
keyboard escape shortcut. Both completed a real, individually approved
`list_windows` task, refused a denied action without a guest effect, resumed
to another approval, and cancelled that pending action with Stop. OLD retained
history across disconnect/reconnect; switching its selected bot isolated the
history. FRESH retained its pre-existing completed task and document.

Five findings have separate fix branches:

| Finding | Corrected behavior | Branch |
| --- | --- | --- |
| Missing LAN tools referred to an administrator command that was not displayed. | Explains the dedicated Debian 13 prerequisite, installation consent, Prepare tools and subsequent Check tools; a missing install marker receives the same guidance. | `fix/gbot-lan-tools-install-guidance-20261017` |
| Settings task history had no speaker names. | Labels user-role messages **You** and assistant messages with the selected bot's name. | `fix/gbot-task-history-speakers-20261017` |
| Refresh and task/control updates closed the open desktop viewer. | Retains the last successful setup while refreshing; confirmed setup failure, incompleteness or service changes still close the viewer. | `fix/gbot-desktop-refresh-continuity-20261017` |
| A reasoning-only model reply with empty answer text became Completed. | Preserves the raw reply and leaves the task Interrupted, available to resume. | `fix/gbot-empty-model-reply-20261017` |
| Take over changed an already Cancelled task to Paused. | Skips terminal saved records while retaining the active actor's normal takeover and replanning path. | `fix/gbot-preserve-terminal-task-pause-20261018` |

The inference run used Qwen3.8 27B **2-bit mix**, package SHA-256
`ab1ddc96b0f43e772468059567262d4dcc0fd38e9f402d589ad697070a83ad61`,
149,069 context tokens and the unchanged normal sampler/output settings.
The retained Engine payload was `d96742554`; this is Gbot desktop acceptance,
not a new Engine, installer or Windows qualification. Desktop audio and LAN
installation were not run. The negative LAN tool check used a disposable
connection to the fixture itself; Prepare tools was not authorized or invoked.
Message names follow stored roles: the existing task format also stores internal
resume observations as user-role content and cannot distinguish their author.

Combined source `a0358f591` passes all 69 focused UI cases, the empty-answer,
terminal-history and active-actor regressions, Rust check/Clippy and one full
`make verify` (1,203 native tests passed, 27 ignored; frontend gates and all six
critical coverage floors passed). All 3,099 tracked source blobs and modes were
verified before and after the S1 build/test copy. The LAN guidance branch also
has its own focused/check/Clippy/full-gate pass; initial environment and test
fixture failures remain identified in its result rather than hidden.

The production native candidate from `a0358f591` passed the patched walkthrough
in both fixtures (app SHA-256
`c13c04b52d000c796ea9a729278cacd1f0e6aaeb52391520599e84a09c3a1c79`).
Both retained the streaming canvas through Refresh and displayed the corrected
speaker names. OLD also retained that canvas through Take over and Hand back;
a newly cancelled task in its current session remained byte-identical. That
regression task used the supported API with an unavailable loopback model
endpoint, made no guest calls and was cancelled before the native control check.
FRESH displayed the corrected missing-tools guidance after a successful SSH
check; installation consent remained unchecked and Prepare tools disabled.

The scratch LAN bot/key were removed, original brain assignments restored,
and the original completed-task file and 17-byte document verified unchanged.
Both fixtures were returned off with their original VM definitions; private
app copies and owned build outputs were removed. The retained result and short
summary are `out/gbot-desktop-tasks-approvals-walk-20261017/result.json` and
`out/gbot-desktop-tasks-approvals-walk-20261017/SUMMARY.md`.

## Hardware-profile novice guidance — C3, closed October 17

`GCHAT-HARDWARE-PROFILE-NOVICE-GUIDANCE-20261017` is closed for the
requested purpose, GPU-combination instructions, duration, next actions and
installed Linux layout. Guidance source `79163635b` and the single-selection
setup change `1e65674cf` (merge `87e95bf98`) are already in main. The retained
hardware-card 7/7 and first-run 14/14 focused cases passed; the consolidated
controls passed 58 focused cases and one `make verify`, recorded in
`out/hardware-setup-controls-20261017/result.json`. No tests were repeated for
this evidence-only closure; `git diff --check` is its gate.

Retained native evidence resolves the previously pending layout check:

- `out/claude-gui-models-20261017/hosts2.png` shows one guided GPU selection,
  why a profile helps, the 1/2/4 matching-card rule, one profile per combination,
  and **Use selected graphics cards**. **Graphics card details** and
  **Advanced hardware profile options** are collapsed.
- `out/claude-gui-models-20261017/hp1.png` shows the expanded manual profile
  card. Its purpose, **Build profile** action, graphics-card explanation,
  “10 minutes to an hour or longer” allowance and ability to close the window
  are readable at 1280×900 without clipping or overlap. **Technical details**
  remains collapsed; UUIDs, executable paths and raw producer details do not
  displace the instructions. Build is disabled before a card is selected.
- The release RC `ed68c7443` / Engine `e2282c336` independently retains the
  guided text and GPU → folder → model progression in
  `out/linux-rc-final-20261017/local5090-ed68c7443-e2282c336-release-flash-high/gui-dom-evidence.jsonl`
  (`hosts-poll-1` and the next four snapshots). C7's private native walkthrough
  at `77ccd3624` also records the advanced duration/prerequisite text in
  `out/c7-models-hub-engine-hardware-20261017/result.json`.

These are retained private Linux desktop observations. They establish this
wording/layout result; measured profiling, later journey/progress changes and
Windows/release-wide acceptance keep their own gates. No new app, model,
profile, benchmark or build was launched. C3 owns only the small documentation
tree `/ai/gchat-worktrees/c3-hardware-profile-guidance-evidence-20261017`,
branch `docs/c3-hardware-profile-guidance-evidence-20261017`, retained for merge.
The cited evidence remains with its existing owners; there is no new live job
or disposable output. Next action: coordinator merge of this closure record.

## Factory-reset native lifecycle — C3, October 18

Current C3 row: `GUI-RESET-CONFIRMATION-KEYBOARD-20261017`, the oldest owned
GUI row. Source `c2ae7a5df` is merged and present in retained Linux release
`ed68c7443` / Engine `e2282c336`. Its eight focused cases and full source gate
remain valid. Native XTest input on S1 confirmed Cancel autofocus, Enter on
Cancel, Escape, keyboard Close, trigger-focus restoration and explicit Reset
focus. Dismissal preserved both localStorage and a disposable data-file sentinel.

The single explicit reset at 01:06:12Z failed: native `factory_reset` closed
the last window before awaiting MCP shutdown; the application exited before
deleting the sentinel or restarting. The command logs reset intent once, followed
by window destruction and process shutdown. MCP shutdown has an unconditional
200 ms await. Pinned Tauri exits when the final window is destroyed unless exit
is prevented. Base `18603aeb7` retains that path. This is a reset lifecycle defect,
not a keyboard double activation. The command now hides and retains windows
until reset reaches its intentional restart. Ordinary close/quit stays unchanged.
The unsafe-path check now runs before hiding or shutdown.

The candidate's real native regression passed at 01:16:58Z. Enter on Cancel
preserved both sentinels and returned focus to Reset. Reopening again focused
Cancel; Tab explicitly selected **Delete data and reset**. One Enter invoked
native reset once, deleted the disposable file and restarted the application
(PID 1240049 to 1256243) at Welcome. The localStorage sentinel and reset-pending
marker were absent. The log also confirms Engine-binary preservation/restoration.
The production frontend and custom-protocol debug native binary were built
offline from `18603aeb7` plus this fix. Eight focused keyboard cases, Rust check
and Clippy pass. The single `make verify` passed frontend/extension checks and
six coverage floors, then stopped after 722 native passes at the fleet
coordinator test's UDP route discovery (`NetworkUnreachable`, line 887).
The build container's `--network=none` cannot provide the non-loopback route
that fixture requires. The exact failed case passed on Docker's isolated
bridge, followed by the six unreached Rust crates once, with the same offline
inputs and no published ports. Together the original run and bounded continuation
completed 1,208 unique Rust passes, 27 ignored. The original gate failure remains
recorded; there was no second full gate run. Tauri's mock runtime does not implement
close/hide lifetime, so the native regression supplies the lifecycle evidence.
This is Linux AppDir acceptance, not Windows or release-wide qualification. No model, profile or inference ran.

Inventory: `/ai/gchat-worktrees/c3-reset-keyboard-installed-20261018`, branch
`fix/c3-factory-reset-lifecycle-20261018`, baseline `18603aeb7`, is retained
for review. Private processes stopped after acceptance. Both owned S1 roots
`/media/ron/SSD_RAID/ai/tmp-c3-reset-keyboard-installed-20261018` and
`/media/ron/SSD_RAID/ai/tmp-c3-reset-lifecycle-build-20261018` are removed,
including the 28 GiB build copy and its two exited containers. CPUs0–7
returned01:24Z. Gchat3's retained AppDir donor was read-only. Only the result
JSON and short summary remain in
`out/c3-reset-keyboard-installed-20261018/{result.json,summary.md}`.
Next: coordinator merge of this native fix. Project-save installed retry
acceptance remains a separate owned row.

## Project storage failures reach the save dialog — C3

The installed acceptance for `GUI-PROJECT-SAVE-ASYNC-RESULT-20261017`
found a remaining failure beneath the merged dialog fix (`68cc55bba`). In the
selected Linux release RC (`ed68c7443` / Engine `e2282c336`), creating a project
under a real WebKit localStorage quota failure still reported success, cleared
the draft and navigated to **Project Not Found**. The saved project list was
unchanged. This used a disposable private profile, no model, and the ordinary
New Project/Create controls. Removing only the disposable quota-filling key
allowed a manually re-entered project to save normally.

`DefaultProjectsService` caught storage-write errors and resolved its mutation
promises successfully. It now propagates the original error to callers, allowing
the existing dialog failure handling to retain the draft and offer retry.
Five service regressions cover ordinary creation and quota rejection, preserved
stored projects and successful retry for create/update/delete/list replacement.
The existing rendered dialog tests cover pending, retained draft and retry.

Owned source: `/ai/gchat-worktrees/c3-project-storage-rejection-20261017`, branch
`fix/c3-project-storage-rejection-20261017`, from main `9e75fc31e`.
Focused lint and all five focused cases pass. The required single `make verify`
completed the frontend, extension and most native suites, then exited 2 in the
unrelated Gbot test
`ssh_loopback::cua_idle_revival_and_refused_start_never_dispatches_actions`.
Its fixture shutdown at `src-tauri/gbot-service/tests/ssh_loopback.rs:1279`
expected the released loopback port to refuse a connection. A narrow gate
continuation passed that failed case in isolation, then completed the remaining
Gbot doc tests, hardware and utility suites. The initial failure remains recorded;
its exact nondeterministic cause is unestablished. Completed coverage is
3,182 frontend cases (six skipped), 120 extension cases and 1,200 native cases
(27 ignored), plus all six critical coverage floors. All compilation ran on
S1 CPUs104–111 in a private SSD copy with pinned image `ad7f9bf020d7`, offline
caches and read-only launch profiles; the booking was returned at 23:51Z.
No local root-disk build or Engine/model run is involved. Evidence and final
verification results:
`/ai/gchat/out/c3-project-storage-rejection-20261017/`. Source `95f122e1f` is merged in `fe0c2cb6a`.

Native corrected-source acceptance is **PASS** (2026-10-18). The retained Linux
runnable `d8ce59320` contains that fix; its binary matches the retained build
receipt and the affected project source is unchanged from the fix. In a
private S1 HOME/XDG, dbus, unlocked keyring and Xvfb session, real XTest Create
and Edit each encountered native WebKit `QuotaExceededError`. Both kept the
dialog and exact draft open, showed the error, preserved the persisted project
list byte for byte and kept the current location. Removing only the disposable
quota-filling key allowed the same draft to save once without re-entry; Edit
retained its project ID. No false success or Project Not Found occurred.
The existing rendered tests supply delayed-save and repeated-input coverage.

Evidence-only branch `test/c3-project-save-native-20261018` starts at
`7bf20d7ff`; no source changes or repeated gates. Packet:
`/ai/gchat/out/c3-project-save-native-20261018/{result.json,summary.md}`.
Private app, auxiliary processes, observer forward and owned SSD profile are
removed; CPU booking cancelled, returned02:15Z. No model, hardware profile,
inference, shared app data or Windows action. This qualifies the corrected
native Linux runnable; it does not qualify a new installer or Windows build.
The old selected `ed68c7443` RC remains the recorded before-fix reproduction.

## Hardware live statistics wording — C7

`GUI-HARDWARE-LIVE-STATS-WORDING-20261017` corrects the Hardware and system
monitor message shown below detected GPU details. The first private desktop
walkthrough observed a stale llama.cpp explanation. Both consumers show this
message without observing a backend failure, so it must state only that live
memory statistics are unavailable and that the displayed details come from
hardware detection. The four supported translations share that meaning.

Owned tree: `/ai/gchat-worktrees/c7-hardware-live-stats-wording-20261017`, branch
`fix/c7-hardware-live-stats-wording-20261017`, from main `7ac349d05`.
Acceptance: corrected localized wording, the existing rendered Hardware tests,
and one `make verify`; then push merge-ready. No new test for a static string,
Engine/model/GPU execution, backend behavior or resource installation change.
Implementation `2742956bd` passes all six existing rendered Hardware tests.
One full `make verify` exited 0 at 16:11:49Z October 17: 3,092 JavaScript
and 1,079 Rust tests passed, six were skipped and 27 ignored. Lint and types
passed; lint retains four existing warnings. No Engine or model was run.

Verification used S1 CPU48–55 nice10 in pinned image `ad7f9bf020d7`, private
offline caches and retained read-only launch profiles. Returned 16:12Z;
booking2646 canceled. The private S1 copy and container are retired; the donor
is unchanged. Results are retained in
`/ai/gchat/out/hardware-live-stats-wording-20261017/{result.json,summary.md}`.
Next: coordinator merge. The private-catalog walkthrough continues separately.
## Chat output reservation on small servers — claude-gchat-rc

`GUI-CHAT-SMALL-CONTEXT-SEND-BLOCKED-20261017` was observed in the private Linux
RC acceptance of GChat `87628b891` / Engine `e2282c336`: a Flash pure 2-bit
custom server with 8,192 context reached Ready, but the first chat send was
refused with "Context settings conflict" before any Engine request. GChat
reserved its full 8,192-token default output plus 256 safety tokens before
counting the prompt, and the suggested remedy (lower the requested output
tokens) has no control in the chat.

The reservation is now planned from the server's context and the counted
prompt: the requested or default output is kept in full when it fits beside the
prompt, otherwise it shrinks to what the prompt leaves, never below a quarter of
the usable context. A prompt beyond its three-quarter share is compacted as
before. Large servers keep the 8,192 reservation. The reservation alone never
blocks a send, and no setting is changed.

Owned tree: `/ai/gchat-worktrees/context-output-reserve-20261017`, branch
`fix/gchat-context-output-reserve-20261017`, from main `dbec106e4`.
Acceptance: focused smart-context, transport, context-control and error tests,
then one `make verify`; packaged retest in the next Linux RC.
## Empty chat model picker — C3

`GUI-CHAT-MODEL-PICKER-EMPTY-20261017` was observed in a private first-run
native desktop at source `77ccd3624`: opening **Select a model** shows an empty
panel and only **Download a model**. The component is unchanged on the candidate
base `0d1b43307`. Explain that no chat model is available and direct the user to
**Open Models** to download or load a local model. Keep model availability,
selection and search behavior unchanged.

Acceptance: rendered empty-state/action regressions, preserved favorites and
search results, focused lint/tests and one `make verify`. No model, Engine,
Host, provider request or existing user data is involved. Next: coordinator merge
and continued chat walkthrough; post-fix installed and Windows acceptance remain open.

Owned source: `/ai/gchat-worktrees/c3-chat-model-picker-empty-20261017`, branch
`fix/c3-chat-model-picker-empty-20261017`; component and English strings are
owned by one implementation agent, the existing provider-order test by another,
and integration/docs/verification by C3. Native evidence and the retained
read-only runnable belong to `/ai/gchat/out/c3-chat-area-hands-on-20261017/`;
`native-model-picker.png` records the observed state. Source verification and
temporary build inventory will be retained in
`/ai/gchat/out/c3-chat-model-picker-empty-20261017/{result.json,summary.md}`.
The private desktop closed normally at16:17Z. Focused lint and all seven focused
cases passed; the favorites assertion needed menu scoping because the selected
model also appears in the trigger, and only that failed case was resumed.
One `make verify` passed at16:21:52Z: 3,003 frontend, 119 extension, 1,079 Rust
and 59 Node tests; six frontend tests were skipped and 27 Rust tests ignored.
Types, quality guards and all six coverage floors passed; lint retains four
existing warnings. S1 CPUs64–71 returned16:22Z, booking2652 canceled. The private
verification copy is retired after collection; the read-only donor and C7's
shared runnable remain retained.
## Attachment field labels — C4

`GUI-SETTINGS-CONTROL-LABELS` also affected attachment numeric fields: their
visible translated titles were not passed to the shared input controls. This
caller fix passes each existing title through C6's `DynamicControllerSetting`
API, giving the fields accessible names without changing values, validation or
persistence. C6's tested shared/provider change is `3d6c4c760`; shared controls
and provider behavior remain C6-owned.

Acceptance: rendered checks find fields by their visible translated names,
edit the named file limit and verify persistence after navigation; attachment
availability and durability checks plus one full `make verify` must pass.
The combined candidate `5a46f3fb5` includes accepted attachment durability,
the separate availability and sidebar fixes, and C6's tested label change.
All 51 focused cases across five files and one full `make verify` passed:
2,995 frontend tests, 119 extension tests, 1,079 Rust tests and 59 Node
contracts. Six frontend tests were skipped and 27 Rust tests ignored; lint
has four warnings and no errors. Types, quality and coverage checks passed.
The production frontend and native desktop builds also passed; the receipt is
`/ai/gchat/out/c4-settings-sweep-20261017/final-combined/result.json`.

The private OLD replay at 16:24Z on `5a46f3fb5` found all attachment fields by
their translated accessible names and confirmed that a named numeric edit
survives quick navigation. Evidence is in `final-attachment-controls.json`
and `final-attachment-quick-navigation.json` beneath the evidence directory.
The follow-up source `0c598c378` separates the Hermes settings link from its
compact enable label. Its 16 focused cases and one full `make verify` passed
(2,996 frontend tests; the extension, Rust and Node counts above are unchanged).
Production frontend/native builds passed, and the native screenshot confirms
the link occupies a separate line with providers visible. Evidence:
`final-attachments-sidebar-corrected.png`, `final-hermes-corrected-layout.json`
and `final-combined/spacing-followup/result.json` beneath the evidence root.
Returned 16:39Z: OLD is OFF and its original XML restored; custody is back
with Gchat2. Next: coordinator merge.

Owned source: `/ai/gchat-worktrees/c4-settings-attachment-labels-20261017`,
branch `fix/c4-settings-attachment-labels-20261017`. Evidence belongs to
`/ai/gchat/out/c4-settings-sweep-20261017/`. No model, Engine, provider request
or retained user profile operation is required. The owned generated S1 cache
is being retired after the final native replay;
concise results and screenshots remain in the evidence directory.

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
attachment-durability fix.
All 11 focused rendered cases and one full `make verify` pass: 2,982 frontend
tests, 119 extension tests, 1,079 Rust tests and 59 Node contracts. Six frontend
tests were skipped and 27 Rust tests ignored; lint has no errors and four
warnings. Types, quality checks and all six coverage floors passed. Saved-mode
recovery, hidden preferences, quick navigation and numeric bounds are covered.
The candidate includes current main and the accepted attachment-durability fix.
Returned 16:13Z; booking2650 canceled. The final private OLD native replay at
16:24Z passed on source `5a46f3fb5`: the named document-text select offers only
`auto`, `inline` and `prompt`; the unavailable-search explanation is visible,
and inactive retrieval, chunk and search controls are absent. Evidence:
`/ai/gchat/out/c4-settings-sweep-20261017/final-attachment-controls.json` and
`/ai/gchat/out/c4-settings-sweep-20261017/final-attachments-sidebar.png`.
`/ai/gchat/out/c4-settings-sweep-20261017/final-attachments-sidebar-corrected.png`.

Owned source: `/ai/gchat-worktrees/c4-settings-attachment-availability-20261017`,
branch `fix/c4-settings-attachment-availability-20261017`. The original evidence is retained in
`/ai/gchat/out/c4-settings-sweep-20261017/{attachment-parse-options.json,settings-attachment-unsupported-mode.png}`.
No new model or fixture resource is allocated.

## Compact Settings sidebar — C4

`GUI-SETTINGS-SIDEBAR-DENSITY` was reproduced in the native Linux Settings
walkthrough: the built-in tool descriptions push provider navigation below the
initial window. Settings now shows compact switch rows and a keyboard-accessible
Help button to expand their descriptions. Stop status/errors and the Hermes
settings link remain visible. The Launch page retains the full descriptions.
C7's provider keyboard links from `da2fe1f1e` are preserved.

Acceptance: rendered help keyboard and switch persistence/stop/retry cases in
both layouts, one full `make verify`, and a native screenshot at the original
window size showing the provider section. Source is
`/ai/gchat-worktrees/c4-settings-sidebar-density-20261017`, branch
`fix/c4-settings-sidebar-density-20261017`. Evidence belongs to
`/ai/gchat/out/c4-settings-sweep-20261017/sidebar-density/`. The candidate includes
the tested attachment-durability fix and current main. All 35 focused cases
and one full `make verify` pass: 2,981 frontend tests, 119 extension tests,
1,079 Rust tests and 59 Node contracts. Six frontend tests were skipped and
27 Rust tests ignored; lint, types, quality checks and all six critical
coverage floors passed. Lint retains four warnings. Returned 16:07Z;
booking2647 canceled, with the private cache retained for the remaining gates.
The final Hermes link correction is included in sidebar source `7eba3f873`.
Its controls, controls test and SettingsMenu files are identical to combined
source `0c598c378`, which passed 16 focused cases and one full `make verify`
(2,996 frontend tests, 119 extension tests, 1,079 Rust tests and 59 Node
contracts), plus production frontend/native builds. The native replay confirms
providers visible and the Hermes link on its own line at the original window
size. Keyboard Help expands the three descriptions and Enter opens OpenAI.
See `/ai/gchat/out/c4-settings-sweep-20261017/final-attachments-sidebar-corrected.png`,
`final-hermes-corrected-layout.json` and `final-combined/spacing-followup/result.json`.
Returned 16:39Z: OLD OFF/original XML restored. The owned generated S1 cache
is being retired; concise results and screenshots are retained. Next: coordinator merge.
The combined `5a46f3fb5` gate and native replay also passed. At the original
window size, provider entries were visible, the keyboard Help button expanded
all three descriptions, and Enter on the OpenAI link opened its Settings page.
Evidence is in `final-attachments-sidebar.png`,
`final-sidebar-keyboard-help.json` and `final-provider-keyboard-result.json`
beneath the evidence root. The replay exposed adjacent Hermes enable/link
wording; `1f00011aa` places the link on a separate line. The final
`0c598c378` gate passed all 16 focused cases and one full
`make verify` (2,996 frontend tests, 119 extension tests, 1,079 Rust tests and
59 Node contracts). Its production native replay confirms the Hermes link
on its own line and provider entries visible at the original window size;
see `final-attachments-sidebar-corrected.png` and
`final-hermes-corrected-layout.json`. Returned 16:39Z: OLD OFF/original XML
restored. Next: coordinator merge.
No Engine, model, provider request or real user-data action is in scope.

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

The fix merged as `7ac349d05`. The private OLD native replay at 16:24Z on
combined source `5a46f3fb5` confirmed 20→21, navigation after 50 ms and 21 on
return; the value was restored to 20. The result is retained in
`final-attachment-quick-navigation.json` beneath the evidence directory.
The private S1 cache at `/media/ron/SSD_RAID/ai/tmp-c4-settings-sweep-20261017/`
is retained for the remaining isolated Settings fixes. Next: coordinator merge,
then replay the accepted Settings changes in the private native app. Provider
labels are owned separately by C6, provider keyboard navigation by C7;
unsupported attachment choices and sidebar density remain separate findings in
Gchat3's shared GUI list.
## Retrying an image preview

If a workspace image cannot be displayed, GChat shows an error instead of an
empty preview. Check that the file is still available, then choose **Retry
preview**. The same file stays selected while GChat tries again.

Linux native acceptance on October 18 used an owned PNG made unreadable before
its first preview. GChat showed the error, **Retry preview**, and the filename
in **Details**. Restoring the original permissions and pressing Space on the
focused retry button loaded that same image tab at 1200×800. This model-free
pass used retained source `11ce` with the relevant paths identical to main
`3b449da5f`; no model, GPU or Send was involved. All 17 saved records, 45 skills
and both workspace files stayed unchanged; the temporary folder reference was
removed through the GUI and the original image permissions restored. Evidence:
`/ai/gchat/out/gchat-agent-image-preview-recovery-20261018/`.

is being retired after the final native replay; concise evidence is retained.
Provider labels remain C6-owned and provider keyboard navigation C7-owned; availability,
sidebar and attachment labels retain their separate findings in Gchat3's list.

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

## Provider settings keyboard navigation — C7

`GUI-SETTINGS-PROVIDER-KEYBOARD` fixes the ordinary Settings provider entries
observed as clickable divs that keyboard users cannot reach. Use native router
links for active and hidden providers, keeping the current destinations, remote
setup search, provider ordering, selected-model marker and sidebar layout.
Keyboard focus must be visible and Enter must open the selected provider.

Acceptance: focused rendered navigation regressions and one `make verify`, then
push the isolated branch merge-ready. The initial native finding is retained in
`/ai/gchat/out/c4-settings-sweep-20261017/provider-navigation-semantics.json`.
The ordinary Linux native keyboard leaf passed in the later C4 replay below.
No provider setup, model, GPU, Engine, install or existing user data is involved
in this source fix.

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
Source merged in `c68027c6b`; the pending installed-keyboard wording is
superseded by C4's retained native Linux replay on `5a46f3fb5`.
`final-provider-keyboard-focus.json` records the OpenAI link focused;
`final-provider-keyboard-result.json` records `/settings/providers/openai`, its
heading and API Key/Base URL fields after Enter. The compact-sidebar account
above records the native keyboard action. The final `0c598c378` replay preserves
this result and confirms providers visible at the original 1200×800 viewport;
its only follow-up changes Hermes link spacing. OLD returned OFF with its
original XML at 16:39Z. This closes the ordinary Linux provider-navigation leaf.

Gchat2 reconciled these existing receipts on 2026-10-18 without another app,
build or test run; the documentation-only change passes `git diff --check`.
Receipt hashes and scope are retained in
`/ai/gchat/out/gchat2-provider-keyboard-closure-20261018/{result.json,SUMMARY.md}`.
This result does not qualify Windows, live provider setup/sign-in or the broader
Models/Hub/Engine/Hardware workflows.
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
## Starting a conversation

Your first **Send** creates the conversation before starting the response.
Repeated Send actions are blocked while creation is pending. If creation fails,
GChat shows an error and keeps your draft and attached files so you can retry.
Once the conversation is created, GChat sends the text and files you submitted
when you pressed Send, even if you have since edited the composer.

## Sending in an existing conversation

**Send** waits for GChat to finish preparing the conversation before starting
the response. Repeated Send actions are blocked while preparation is pending.
If preparation fails, GChat shows an error and keeps your draft and attachments
so you can retry.

Text or attachments you add while an earlier Send is pending stay in the
composer when that preparation finishes; its completion does not clear your
newer changes.

When a preview or Files panel leaves a narrow chat column, the composer
controls wrap onto additional rows inside the input border. The input grows
to fit those rows, keeping the saved-agent choice, Approvals, reasoning and
Send controls separate and available.

## Preparing another agent run

In **Agent Studio → Runs**, choose **Re-run** to reuse a finished run's task
and workspace. **Continue as new run…** prepares the selected unfinished run's
goal, saved result and output location. Cancel closes either setup without
starting a run. Changing sections must not open an earlier setup later.

Linux acceptance (`GUI-AGENT-RUN-SETUP-LIFETIME-NATIVE-20261018`): finished
Private Host recovery → Re-run → Cancel, then incomplete General Agent →
Continue → Cancel showed each run's own task and workspace, with no earlier
task or reply in the continuation. Leaving and returning to Runs opened no
late dialog. All 17 saved records, 45 skill files, two workspace inputs and
disabled-state bytes/modes stayed unchanged; resources returned at 09:36Z.
Retained `8f7d18f6f` matches the relevant chain at `81c453224`. Evidence:
[`out/gchat-agent-run-setup-lifetime-native-20261018/`](../../out/gchat-agent-run-setup-lifetime-native-20261018/).
The original 25 focused cases and ONE `make verify` PASS remain qualified.
Delayed request ordering remains source-test coverage; Windows was not exercised.

## Reading workspace instructions

In run setup, enter a workspace and choose **View AGENTS.md** to read its
instructions. Changing the workspace clears the previous result. A folder
without that optional file shows **No AGENTS.md file; workspace instructions
are optional.**

Linux acceptance (`GUI-WORKSPACE-INSTRUCTIONS-SELECTION-NATIVE-20261018`):
A → View showed exact file text; changing to file-free B cleared A, and View
showed the optional-file message. Returning to A cleared B and restored A's
exact text. Cancel and leaving/returning to Runs opened no late result. All
17 saved records, 45 skill files, two existing inputs and disabled-state
bytes/modes stayed unchanged; resources returned at 09:41Z. Retained
`8f7d18f6f` matches the relevant chain at `a74eeace3`. Evidence:
[`out/gchat-workspace-instructions-selection-native-20261018/`](../../out/gchat-workspace-instructions-selection-native-20261018/).
The original 14 focused cases and ONE `make verify` PASS remain qualified.
Delayed request ordering remains source-test coverage; Windows was not exercised.

## Reading workspace folders

If GChat cannot read your workspace folder, the **Files** panel opens so you
can see the problem. Choose **Retry folder** to try again. You can close the
panel while you work; another failed check will not keep reopening it.

The same recovery works for a folder inside the workspace. Expand **Details**
to see the underlying error, restore access to the folder, then choose
**Retry folder**. A failed retry leaves the control available. Recovered
contents remain available when you collapse and reopen that folder.

Private native Linux acceptance on 2026-10-18 covered a nested permission
error, another failed retry, permission restoration and keyboard activation of
**Retry folder**, then collapse/reopen of the recovered listing. The temporary
external-folder reference was removed through **Remove from Agent**; its files
were retained. All 17 saved records, 45 Skills and two existing workspace inputs
remained byte unchanged. The app stopped at 08:15Z. Evidence:
`/ai/gchat/out/gchat-agent-nested-folder-read-native-20261018/summary.json`.

An expanded empty folder shows **This folder is empty** inside that folder.
Collapsing it hides the message; reopening shows it again. Choose **Refresh**
after adding or removing files outside GChat to update the listing.

`GUI-AGENT-EMPTY-FOLDER-NATIVE-20261018` passed private native Linux acceptance
at 08:20–08:21Z on October 18. Space opened, collapsed and reopened an empty
child, showing, hiding and restoring its local status. Refresh discovered
`refresh-note.txt` and removed the empty status; after the input was moved
outside the folder, Refresh removed the stale entry and restored that status.
Refresh stayed enabled with no alerts. **Remove from Agent** removed the root
reference while preserving the test input. The retained `8f7d18f6f` candidate
has identical relevant folder sources to base `70606ac23`; this qualifies that
Linux interaction, not a full latest-main binary, GPU or Windows run. The app
stopped and booking 3157 was canceled at 08:21Z. Evidence:
`/ai/gchat/out/gchat-agent-empty-folder-native-20261018/summary.json`.

## Choosing image or audio attachments

If the image or audio file window fails, GChat shows an error and keeps your
draft and existing attachments. Use the attachment button again to retry.
Canceling the file window without choosing a file shows no error.

If an image cannot be read, GChat names the file and asks you to choose it
again. Your draft and other attachments stay in place.

## Generated HTML previews

If a generated HTML preview cannot load, GChat shows an error. Choose
**Retry preview** to try again. **Code** remains available so you can read
the HTML while the preview is unavailable.

When you make the window narrower, the preview panel shrinks so the chat
keeps room to work in. A panel you already made narrower is never widened
automatically.

## Copying generated HTML

Choose **Copy** to copy the generated HTML source. If copying fails, GChat
shows an error. Try **Copy** again, or open **Code** and select the text.

## Saving generated HTML

Choose **Download** to select where to save the generated HTML. If saving
fails, GChat shows an error; choose **Download** again to retry. Canceling
the save window leaves the generated code available.

## Printing generated HTML

Choose **Print / Save as PDF** to open the print window. If opening it
fails, try **Print / Save as PDF** again or use **Download** to save the HTML.

## Choosing a skill with the keyboard

Type `/` in the composer to see available skills. Use the up and down arrow
keys to choose a skill, then press Enter or Tab to select it. The selected
skill stays visible as you move through a long list.

Linux acceptance (`GUI-CHAT-SKILL-SLASH-NATIVE-20261018`): with 42 available
skills, native ArrowUp wrapped from the first option to the last and ArrowDown
wrapped back. Moving down 20 options kept the selected skill fully visible in
the scrolling list. Typing `/keyboard-24` filtered to one option; Tab selected
it, closed the menu and kept composer focus. Backspace removed the selected
skill from the empty composer. No message or model was started. All 17 saved
records, 45 `SKILL.md` files and two workspace inputs stayed unchanged.
Retained build `8f7d18f6f` matches the relevant Chat/Skills source at
`e9566246a`; resources returned at 08:44Z. Evidence:
[`out/gchat-chat-skill-slash-native-20261018/`](../../out/gchat-chat-skill-slash-native-20261018/).
The source fix retains its 62 focused tests and one cumulative `make verify`
PASS at `df99cac4f`; this acceptance adds native Linux coverage only. Windows,
spoken assistive output and model dispatch were not exercised.

In **Agent Studio → Agents & flows**, Tab to a skill and press Space or Enter
to include or remove it. Each skill announces whether it is selected, including
skills assigned to a specialist or workflow stage. Choose **Save definition**
to keep the assignment. Reopening that definition restores its selected skills.

Linux acceptance (`GUI-AGENT-SKILL-SELECTION-STATE-20261018`): native Space
toggles `aria-pressed` and keeps focus. Saving, switching definitions and
reopening restores agent and workflow stage selections independently. Original
assignments were restored; 17 saved records, 45 skill files and two workspace
inputs remained byte unchanged. Focused 74 tests, lint and ONE verification gate
passed after refreshing four stale external catalog fixtures from their merged
source; the original failure and bounded resume are recorded separately in
[`out/gchat-agent-skill-assignment-20261018/`](../../out/gchat-agent-skill-assignment-20261018/).
This covers Linux keyboard and DOM semantics; spoken assistive output and
Windows were not exercised.

In **Agent Studio → Skills**, select a skill to read its **Instructions**.
**Refresh** reloads the selected skill and keeps its instructions with that
selection.

Linux acceptance (`GUI-AGENT-SKILL-SELECTION-LIFETIME-NATIVE-20261018`): native
Space selected `lifecycle-probe`, then `keyboard-01`, each with its matching
Instructions. Refresh kept `keyboard-01` selected with its matching body;
selecting and refreshing `lifecycle-probe` did the same. All 17 saved records,
45 skill files, two workspace inputs and disabled-state bytes/modes stayed
unchanged. Retained `8f7d18f6f` matches the selection/Refresh path at `bb194ff03`;
the recorded switch-only difference was outside this read-only journey.
Resources returned at 09:32Z. Evidence:
[`out/gchat-agent-skill-selection-lifetime-native-20261018/`](../../out/gchat-agent-skill-selection-lifetime-native-20261018/).
The source fix retains its 10 focused cases and ONE `make verify` PASS. Delayed
request ordering remains source-test qualification; Windows was not exercised.

## Enabling and disabling skills

In **Agent Studio → Skills**, focus a skill's switch and press Space to enable
or disable it. Focus stays on that switch while GChat saves the change; repeated
activation waits for the current save. If saving fails, the switch keeps its
saved state and you can press Space again to retry. Other skills remain usable.

## Creating and editing skills

After you choose **Create** or **Save**, the button shows **Creating skill…**
or **Saving skill…** until the request finishes. Wait for the dialog to close
before using the saved skill. If saving fails, your entries stay in the dialog
and the button becomes available so you can try again.

Linux acceptance (`GUI-AGENT-SKILL-EDIT-TARGET-NATIVE-20261018`): with
`lifecycle-probe` selected, opening a disposable skill’s **Skill actions → Edit
skill** showed the disposable skill’s name, description and instructions. Save
persisted its changed description and preserved its instructions. Reselecting
`lifecycle-probe` showed its original instructions. The disposable skill was
then uninstalled; all 17 saved records, 45 original `SKILL.md` files and two
workspace inputs stayed byte unchanged, with the original skill inventory
restored. Retained build `8f7d18f6f` matches the relevant source at `42d039f6e`;
resources returned at 09:05Z. Evidence:
[`out/gchat-agent-skill-edit-target-native-20261018/`](../../out/gchat-agent-skill-edit-target-native-20261018/).
The source fix retains its 25 focused cases and ONE `make verify` PASS. Pending
races retain source qualification; Windows was not exercised.

Linux acceptance (`GUI-AGENT-SKILL-CREATE-RECOVERY-NATIVE-20261018`): a real
permission error kept the Create dialog open with its name, description and
instructions unchanged, and re-enabled Create. Restoring the owned directory's
original permission and retrying in the same dialog saved the exact skill file.
The disposable skill was then uninstalled; all 17 saved records, 45 original
`SKILL.md` files, two workspace inputs and disabled-state bytes stayed unchanged.
Retained build `8f7d18f6f` matches the relevant Create source at `a89302f19`;
resources returned at 09:16Z. Evidence:
[`out/gchat-agent-skill-create-recovery-native-20261018/`](../../out/gchat-agent-skill-create-recovery-native-20261018/).
The source fix retains its four focused cases and corrected ONE `make verify`
PASS. Pending dismissal and duplicate races retain source-test qualification;
Windows was not exercised.

Linux acceptance (`GUI-AGENT-SKILL-EDIT-RECOVERY-NATIVE-20261018`): a real
permission error kept the Edit dialog open with its changed description and
instructions intact, and re-enabled Save. Restoring the disposable skill
directory's original permission and retrying in that same dialog saved both
fields; reopening Edit confirmed their exact values. The disposable skill was
then uninstalled; all 17 saved records, 45 original `SKILL.md` files, two
workspace inputs and disabled-state bytes and modes stayed unchanged. Retained
build `8f7d18f6f` matches the bounded Edit source at `1a64ac2e9`; resources
returned at 09:26Z. Evidence:
[`out/gchat-agent-skill-edit-recovery-native-20261018/`](../../out/gchat-agent-skill-edit-recovery-native-20261018/).
Source `172bf8b2c` retains its four focused cases and ONE `make verify` PASS.
Pending dismissal and duplicate races retain source-test qualification;
Windows was not exercised.

## Removing a custom skill

In **Agent Studio → Skills**, open **Skill actions → Uninstall**. The
confirmation names the skill and initially focuses Cancel. Choose **Delete**
to remove it. If deletion fails, the dialog keeps the error and allows a retry.

Linux acceptance (`GUI-AGENT-SKILL-DELETE-NATIVE-20261018`): deleting a newly
created disposable skill from its owned read-only directory returned a real
permission error inside **Delete skill**. The skill and its instructions stayed
present; Cancel and Delete recovered with `aria-busy=false`. Restoring the
original directory permission and pressing Space on Delete in that same dialog
removed the disposable skill and closed the dialog. Its old detail was replaced
by the ordinary first-skill fallback. All 17 saved records, 45 original
`SKILL.md` files and two workspace inputs stayed unchanged; the disposable
directory was absent. Retained build `8f7d18f6f` matches the relevant source at
`7070d5856`; resources returned at 08:47Z. Evidence:
[`out/gchat-agent-skill-delete-native-20261018/`](../../out/gchat-agent-skill-delete-native-20261018/).
The source fix retains its 19 focused tests and ONE `make verify` PASS. Pending
races and dismissal guards retain source-only qualification; Windows was not
exercised.

## Importing a skill

In **Agent Studio → Skills**, choose **Create new → Upload a skill**, then
**Drag and drop or click to upload**. Choose a Markdown skill definition or a
`.zip` or `.skill` archive containing `SKILL.md`. Canceling the native file
window returns to Upload without an error. If import fails, the error appears
and Upload stays open so you can choose another file.

Linux acceptance (`GUI-AGENT-SKILL-IMPORT-NATIVE-20261018`): the native
**Skill files** chooser showed **Choose a skill file…** while open. Cancel
cleared that status silently and enabled the chooser button. Selecting the
owned `lifecycle-probe` export showed **A skill named `lifecycle-probe` already
exists**; Upload stayed open with its button enabled and `aria-busy=false`.
Reopening the native chooser and canceling again passed. All 17 saved records,
45 `SKILL.md` files, two workspace inputs and the 231-byte archive stayed
unchanged. Retained build `8f7d18f6f` matches the relevant import source at
`b12c7e98f`; resources returned at 08:38Z. Evidence:
[`out/gchat-agent-skill-import-native-20261018/`](../../out/gchat-agent-skill-import-native-20261018/).
This covers ordinary Linux cancellation and duplicate-name rejection/retry
readiness; chooser exceptions, successful import recovery and Windows were
not exercised.

## Downloading a skill

In **Agent Studio → Skills**, open the skill's **Skill actions** menu and choose
**Download**. Choose where to save its `.skill` archive in the native Save
window. **Cancel** returns to Skills without exporting; open **Download** again
when you are ready to save. A successful save shows **Skill exported**.

Linux acceptance (`GUI-AGENT-SKILL-EXPORT-NATIVE-20261018`): Download opened
the native Save window with `lifecycle-probe.skill` and the **GChat Skill**
filter. Cancel cleared the saving status silently, and Download became available
again. Reopening and saving to an owned destination showed **Skill exported**;
the valid archive contained `SKILL.md` byte identical to its source. The saving
status cleared and Download was available after success. All 17 saved records,
45 `SKILL.md` files and two workspace inputs stayed unchanged. The retained
`8f7d18f6f` build matches the relevant source at `f333b3b47`.
Evidence: [`out/gchat-agent-skill-export-native-20261018/`](../../out/gchat-agent-skill-export-native-20261018/).
This covers ordinary Linux Cancel and Save; delayed duplicate submissions,
export failures and Windows remain outside this native check.

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
| C4 / local | `/ai/gchat-worktrees/c4-settings-attachment-labels-20261017`, branch `fix/c4-settings-attachment-labels-20261017` | Combined source `0c598c378`: focused/full gates and native replay PASS |
| C4 / S1 | `/media/ron/SSD_RAID/ai/tmp-c4-settings-sweep-20261017` | Owned generated dependency/build cache being retired; donor untouched |
| C4 / OLD | `/home/gchat/c4-settings-sweep-20261017` | Private native app/home; returned16:39Z OFF/original XML restored, custody back with Gchat2 |
| C4 / evidence | `/ai/gchat/out/c4-settings-sweep-20261017/` | Before/after screenshots, native control results and source validation; no real token used |

Token privacy merged as `513f2ab30` and attachment edit durability as
`7ac349d05`. Durability, availability, sidebar and labels each passed their
focused/full gates; combined source `5a46f3fb5` passed 51 focused cases, one
full `make verify` and production frontend/native builds. The 16:24Z private
OLD replay confirmed durable quick-navigation edits, supported attachment
choices and explanation, named fields, reachable provider entries and keyboard
Help/provider links. Native `final-*.json` and screenshots retain those results.
The final `0c598c378` follow-up also passed focused/full gates and native
replay, including the separate-line Hermes screenshot. Returned16:39Z, OLD
OFF/original XML restored. Next: coordinator merge of the remaining fixes. Assistant create/update remains C7-owned; existing Engine and Hardware
work remains with its owners. No model or shared FRESH fixture is in scope.
## Models, Hub, Engine and Hardware walkthrough — C7

`GUI-MODELS-HUB-ENGINE-HARDWARE-20261017` is an ordinary first-user walkthrough
of Models/Hub, GInfer Hosts, Hardware and Benchmark: discovery, download,
installation, Load/Unload, profiling, progress, errors and next-action wording.
The initial observation deliverable was sent before 16:00Z October 17. No model,
measured profile, benchmark or current-Engine qualification is implied.

The frozen current-main `77ccd3624` desktop/Host/resources closure came from
Codex 3's read-only build 2616. Its genuine bundled Engine is retained `5af502f1e`.
The sole staged copy used a fresh HOME/XDG and session bus on local Linux/WSLg;
actual desktop and Host dependencies resolve. Tauri's Linux resource layout is
`lib/GChat/resources`; correcting lowercase `lib/gchat` only in the owned raw
copy was launch preparation. The donor and existing user data were unchanged.

Observed ordinary behavior:

- Bundled runtime installation completed normally at 15:59:03Z. The private Host
  then connected on 7443. Earlier “Preparing local model runtime…” was an active
  installation state, not a defect.
- Models identifies the RTX 5090. Installed and Downloads are empty. Recommended
  explains that no release with verified compatibility metadata is published.
- Hosts explains local setup, GPU selection, and advanced profile duration and
  prerequisites. No measured hardware profile was started.
- Benchmark explains the missing loaded model and disables Run.
- Hardware incorrectly attributes unavailable live GPU statistics to a llama.cpp
  backend. That confirmed wording defect is corrected separately in
  `fix/c7-hardware-live-stats-wording-20261017`, implementation `2742956bd`,
  across all four translations; its focused and full gates are separate.

The genuine empty catalog and absence of installed models leave download
verification, Load/Unload, measured profiling and benchmark execution
**unqualified**. No catalog/model was injected and no expensive operation was
substituted. This is not Windows/RC or current Engine evidence. Findings and
limits were sent to Gchat 3's shared GUI list. Windows host-port collision remains
a separate leaf awaiting Gchat 2's installed-app handoff.

Owned source is `/ai/gchat-worktrees/c7-models-hub-engine-hardware-20261017`,
branch `test/c7-models-hub-engine-hardware-20261017`. Concise rendered results
are `/ai/gchat/out/c7-models-hub-engine-hardware-20261017/{result.json,summary.md}`.
Normal desktop close and termination of its verified idle private Host completed;
returned 16:05Z, booking 1357 canceled. Owned runtime/private copies and transient captures are retired; Codex 3's
immutable donor remains with its owner. Next: finish the separate wording gate; parent execution leaves need
an actual catalog/model and resource admission.

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
Gchat 3 completed the remaining Linux native keyboard/Cancel leaf on
October 18. The ordinary project Conversation menu opens the
confirmation with Cancel focused; Enter and Escape preserve the private dummy
conversations; explicitly activating Delete all removes only that project's
conversations and preserves an unrelated dummy conversation and the project.
The existing rendered evidence covers pending/rejected operations; a fast
native filesystem operation cannot establish those cases. No Windows or
installed-package qualification is claimed by this source-native check.
Windows host-port collision remains pending Gchat 2's installed-app handoff.

| Owner / host | Path | Status / retention |
| --- | --- | --- |
| C7 / local | `/ai/gchat-worktrees/c7-project-threads-delete-single-submit-20261017`, branch `fix/c7-project-threads-delete-single-submit-20261017` | From main `a08e2b053`; dialog implementation and six dedicated regression cases frozen at `79b06e217` |
| C7 / S1 | `/media/ron/SSD_RAID/ai/tmp-c7-project-threads-delete-single-submit-20261017/` | Private source/dependency/native cache retired after verification; booking 2563 canceled, returned 14:12Z |
| C7 / evidence | `/ai/gchat/out/project-threads-delete-single-submit-20261017/{result.json,summary.md}` | Passing focused and full verification result retained here |
| Gchat 3 / local | `/ai/gchat-worktrees/gchat3-project-delete-native-20261018`, branch `docs/gchat3-project-delete-native-20261018`, base `ec6d2ba1f` | Evidence-only native acceptance; no implementation changes |
| Gchat 3 / S1, verified `AIS-2-8592-L01` | `/media/ron/SSD_RAID/ai/tmp-gchat3-project-delete-native-20261018` | Native input acceptance PASS13:18Z; private runnable/HOME retired (8.52GB), returned13:19Z; no GPU/model |

The six focused rendered regression cases pass. The single full `make verify`
exited 0 at 14:10:39Z on S1 in pinned image `ad7f9bf020d7`: lint, frontend
types, contracts and critical coverage floors passed, with 2,796 frontend tests,
119 extension tests and 1,076 Rust tests. Six frontend tests were skipped and
27 Rust tests ignored. The gate used private offline caches and 22 retained
profile catalogs; generated local-core archive references changed only inside
the disposable copy. Source dependency files and the read-only donor are
unchanged. The private build copy is retired and the implementation is merged.
The granted inactive desktop donor was built from `cf9124a1e`, binary SHA256
`ce13ab7f462504eaf031448503e8332bd35164366acaaaae618bbd00cc11ee6b`.
Its dialog, button/dialog/dropdown primitives, project route, thread hook,
project/thread services, conversational extension and native thread storage
match `ec6d2ba1f` (18 source files). The independent copy ran with private
HOME, unlocked keyring, D-Bus and Xvfb `:202`, software rendering and no GPU.
Through the ordinary project Conversation menu, native XTest input opened
the confirmation with Cancel focused. Enter canceled and Escape dismissed a
reopened confirmation; both times all three dummy thread files were unchanged.
Tab moved focus from Cancel to Delete All; Enter removed the two project thread
directories. The project remained in storage and the unrelated conversation
retained its original file hash. Screenshots, DOM observations and filesystem
receipts are retained in
`/ai/gchat/out/project-delete-native-20261018/`. An initial X11 authorization
failure stopped before app startup; the private Xauthority entry was corrected
for the container hostname before this successful execution. The private fixture
was retired and CPU booking3305 canceled at13:19Z; the donor is unchanged.

The accepted focused/full gates above were reused. This evidence-only branch
adds no implementation change and uses `git diff --check` only. Windows and
installed-release package acceptance remain outside this source-native result.

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

## Claude GUI pass, October 17 (Linux, private isolated session)

Found in a first-run native Linux session and fixed one branch each. Each has focused
tests; the first nine passed one combined `make verify`.

- `GUI-CHAT-HINT-DISMISS`: composer hint is `role="alert"` with a real Close button.
- `GUI-SETTINGS-PROVIDER-START-HINT`: visible reason Start is disabled without an API key.
- `GUI-CHAT-APPROVAL-WORDING`: composer reads "Approvals: manual / skipped".
- `GUI-CHAT-ATTACH-MENU`: plus button named; disabled documents item says why.
- `GUI-SETTINGS-SWITCH-DROPDOWN-NAMES`: switches and dropdowns named by their row title.
- `GUI-SETTINGS-ICON-BUTTON-NAMES`: Downloads, Add provider, Add model, Refresh named.
- `GUI-SETTINGS-HERMES-SAVE-NO-MODEL`: Save with no model does not start the server.
- `GUI-SETTINGS-ATTACH-RATIO-WORDING`: states the 0.05 to 1 fraction input.
- `GUI-SETUP-CARD-SPACING`: first-run cards share one shape.
- `GUI-CHAT-THREAD-ACTIONS-NAME`: each thread's menu button is named "More actions for <title>".
- `GUI-CHAT-MEMORY-EDIT-WORDING`: "Remember this" is now "Save to Memory"; the disabled Edit button's tooltip says to select a model.
- `GUI-SIDEBAR-SERVER-NAME`: the sidebar status reads "Local API server stopped / running".
- `GUI-SETTINGS-HEADING-LEVELS`: card titles are `h2` and row titles `h3` instead of all `h1`.

`GUI-SETUP-SECURE-STORAGE-CHECKING` did not reproduce. The "Checking..." state that
lasted over a minute came from a session without its own unlocked keyring. In a session
with private dbus, HOME, XDG_RUNTIME_DIR and an unlocked keyring, Check secure storage
returns "Secure storage is ready." within seconds. Test launches must set the private
`XDG_RUNTIME_DIR` before starting `gnome-keyring-daemon`, or the daemon talks to the real one.

## Send stays disabled after a failed load — claude-gchat-rc

`GUI-CHAT-STALE-LOAD-ERROR-SEND-20261017` was observed in the private Linux RC
acceptance of GChat `87628b891` / Engine `e2282c336`. An Installed Load of
Flash pure 2-bit failed (no qualified automatic profile for the RTX 5090), and
the same model was then started successfully from GInfer Hosts custom settings.
New Chat still kept Send disabled with no message while the sidebar said Model
loaded: the stored load error for the installed model id was never cleared,
because the Hosts start runs outside `switchToModel` and the running instance
appears under its Host instance id.

A stored load error now describes only the latest failed start: it is cleared
when a model newly becomes active through any load path or when the server
status changes. A new failure is still recorded after its status update.

Owned tree: `/ai/gchat-worktrees/stale-load-error-clear-20261017`, branch
`fix/gchat-stale-load-error-clear-20261017`, from main `dbec106e4`.
Acceptance: focused app-state, provider-page and switch-model tests, then one
`make verify`; packaged retest in the next Linux RC.

## Gbot and Agent Studio first-time-user pass — claude-gui-gbot-agents

Walked on GChat `87628b891` and `8b9f177e9` (Linux desktop build, private `HOME`,
`XDG_RUNTIME_DIR`, dbus session and unlocked keyring; no provider sign-in, no model).
Agent Studio: Agents & flows editor and run setup, Templates, Skills, Worker Pools,
Runs. Gbot: enable, start service, Add bot wizard (name, service, computer, LAN
connection, local VM review, cloud and Microsoft 365 pages), saved LAN bot page,
Linked accounts, Scheduled tasks, brain, companion pane. A saved LAN bot was created
against a real SSH host key (identity check only; no login). The desktop viewer, tool
check, approvals and task history need a connected bot computer and were not reached.

Fixed, one branch each (all merged or merge-ready with `make verify` PASS):

- `GBOT-SERVICE-NOT-RUNNING-MESSAGE`: "Gbot service is not running or is disconnected. Use the
  service button at the top of the Gbot page to start or connect it."; hidden while the service starts.
- `GBOT-SERVICE-EXIT-REASON`: a service that exits before it is ready shows its own last log line.
- `GBOT-SECURE-STORAGE-START-GUIDANCE`: locked or unavailable secure storage says to choose Check
  secure storage in GChat and start Gbot again.
- `GUI-SKILLS-ERROR-NOT-EMPTY`: a load error no longer shows beside "No skills are installed."
- `GUI-WORKER-POOLS-FIRST-USE`: plain explanation instead of a red alert and a pointless Retry.
- `GUI-AGENT-RUNS-PANE-HEIGHT`: the Runs and Agents panes fill the page height.
- `GBOT-SSH-PLAIN-ERRORS`: SSH connection failures name the bot's computer and what to check
  (previously "Guest SSH connection or liveness check timed out").
- `GBOT-LAN-DISABLED-BUTTON-HINTS`: Create bot key and Continue say why they are off.
- `GBOT-SCHEDULES-INTRO-INSIDE`: the schedule explanation sits inside its collapsed section, as Linked accounts does.
- `GBOT-SERVICE-CHOOSER-COPY`: the Service computer panel no longer promises "the next step".
- `GUI-AGENT-EDITOR-FIELD-LABELS`: Identifier, Description, Instructions, Output contract and the
  step and token limits are programmatically tied to their labels.
- `GBOT-VAULT-WORDING`: Gbot setup text says secure storage, matching the rest of GChat.
- `GBOT-LAN-BOT-NO-REMOVE`: a saved LAN bot can now be renamed and removed (Rename bot, Remove bot with the shared confirm dialog). The service routes `workspaces/ssh/rename` and `workspaces/ssh/remove` refuse while the bot is connected, has unfinished tasks or active schedules, or has linked accounts; removal deletes the bot record, its model assignment and its saved connection key, never the computer.

Open, not fixed (product or design decisions):

- `GBOT-SETUP-STEP-COUNT-CHANGES`: the wizard says "Step 2 of 5" and then "Step 4 of 4" once a VM,
  cloud or Microsoft 365 computer is chosen, because the total depends on that choice.
- `GBOT-SETUP-STEP-COUNT-CHANGES`: setup shows "Step N · Name" with no total, so the number never changes when the computer type is chosen.
- `GBOT-LINKED-ACCOUNTS-EMPTY-SAVE`: Save linked accounts is disabled, with the visible reason "No accounts are connected to GChat yet", when no accounts exist and none are linked; it stays enabled to unlink a disconnected account.

Open, not fixed (product or design decisions):

- `GBOT-LAN-BOT-NO-REMOVE`: a saved LAN bot cannot be renamed or removed; the service has no
  workspace delete or rename route (local VM and cloud setups have removal).

- `GBOT-LINKED-ACCOUNTS-EMPTY-SAVE`: with no connected accounts, Linked accounts still offers Save
  linked accounts. Low severity; saving an empty selection may be intended to unlink everything.
- `GBOT-SETUP-STEP-COUNT-CHANGES`: the wizard says "Step 2 of 5" and then "Step 4 of 4" once a VM,
  cloud or Microsoft 365 computer is chosen, because the total depends on that choice.

Test-isolation notes: a launch must set a private `XDG_RUNTIME_DIR` and unset `WAYLAND_DISPLAY`;
Browse on a bare private session opens a file chooser on the real display through the portal.

## First-run journey, October 17 (claude-gui-journey)

Release build of GChat `a8e2b7347` (private development catalog variant; see below), empty profile, private
`HOME`, `XDG_RUNTIME_DIR` and keyring, no Wayland or X11 display of the user's (an Xvfb in a container served the
window). Steps from a fresh launch, in UTC on October 17:

| Step | Time |
|---|---|
| Launch to Welcome visible | 6 s |
| Engine runtime install and Host start (first launch) | 12 s |
| Pick graphics card, folder, model (clicks) | under 1 min |
| Download 10.7 GB Qwen 27B 2-bit mix from the local NAS | 28 s (about 460 MiB/s) |
| Checking the download (SHA256) | 18 s |
| Hardware profile (clean run, with the loop fix) | 177 s |
| Finish local setup, Start to Ready | under 1 s, 9 s |
| First message to answer | 1.4 s (209 tok/s) |
| Stop to idle (draft calibration then ran 71 s on the GPU) | 7 s |

Fixed (one branch each, rows in the open-work list):

- `GUI-JOURNEY-PROFILE-INSTALL-LOOP`: idle profile completion no longer counts as first-run work. The cancel/restart
  loop wrote a 2 MB profile copy about 50 times a second (12 GB in four minutes, then the app exited on
  'No space left on device'; a restart repeated it).
- `GUI-JOURNEY-CONNECTING-GRACE`: 'Starting GInfer on this computer' for the first 30 seconds instead of
  'could not connect'.
- `GUI-JOURNEY-INTAKE-LOCAL-HOST`: this computer's own host is not '1 paired host'.
- `GUI-JOURNEY-WIZARD-STEP-COPY`: instructions name the button that is on screen.
- `GUI-JOURNEY-DISK-SPACE-CRASH`: the model list warns in plain words when the chosen models plus about 2 GB of
  working space do not fit the free space (and blocks the download when the models alone do not fit); an
  out-of-space error from the Host (HTTP error, setup status, log) now reads 'The disk is full. Free some space,
  then try again.' Background first-run maintenance failures are now retained in Host memory and exposed
  on Welcome with Retry setup; a successful maintenance retry clears the alert. The original exit was
  also caused by the profile-copy loop fixed under `GUI-JOURNEY-PROFILE-INSTALL-LOOP`.
- `GUI-JOURNEY-PROFILE-PROGRESS-LAYOUT`: the profiling bar and Cancel profiling no longer overlap.
- `GUI-JOURNEY-NO-RECOMMENDATION-CONTRADICTS`: Welcome and Models share `releaseVerified` (`lib/model-release.ts`); a release
  without a tested launch profile is not offered on Welcome (plain empty state) and is not downloadable in Models.

Open: `GUI-JOURNEY-WELCOME-BELOW-FOLD`, `GUI-JOURNEY-FAILED-DOWNLOAD-STUCK`, `GUI-JOURNEY-MODEL-NOT-SELECTED`,
`GUI-JOURNEY-LOAD-WITHOUT-PROFILE`, `GUI-JOURNEY-JARGON`,
- `GUI-JOURNEY-FAILED-DOWNLOAD-STUCK`: a failed selected download shows 'Try again' and 'Choose a different model'
  (new first-run action `reselect`, which also discards the failed partial and returns to model choice). A selected
  download deleted on Models releases the whole selection (`first_run::reconcile`), so it no longer pins Welcome or
  is silently re-downloaded.
- `GUI-JOURNEY-WELCOME-BELOW-FOLD`: the local setup card scrolls back into view when a step changes or is saved;
  local model setup now sits above secure storage on Welcome.

Open: `GUI-JOURNEY-FAILED-DOWNLOAD-STUCK`, `GUI-JOURNEY-MODEL-NOT-SELECTED`,
- `GUI-JOURNEY-MODEL-NOT-SELECTED`: when a Host projection has exactly one ready model and no chat model is
  selected, that model is selected (`engine-hosts-store.ts`); an explicit choice is never replaced.

Open: `GUI-JOURNEY-WELCOME-BELOW-FOLD`, `GUI-JOURNEY-FAILED-DOWNLOAD-STUCK`,
`GUI-JOURNEY-LOAD-WITHOUT-PROFILE`, `GUI-JOURNEY-NO-RECOMMENDATION-CONTRADICTS`, `GUI-JOURNEY-JARGON`,
- `GUI-JOURNEY-LOAD-WITHOUT-PROFILE`: Load on a model with no saved startup settings names the model and links to GInfer Hosts.

Open: `GUI-JOURNEY-WELCOME-BELOW-FOLD`, `GUI-JOURNEY-FAILED-DOWNLOAD-STUCK`, `GUI-JOURNEY-MODEL-NOT-SELECTED`,
`GUI-JOURNEY-LOAD-WITHOUT-PROFILE`, `GUI-JOURNEY-NO-RECOMMENDATION-CONTRADICTS`, `GUI-JOURNEY-JARGON`,
`GUI-JOURNEY-POST-STOP-GPU-BUSY`, `GUI-JOURNEY-UPDATER-404`.
`GUI-JOURNEY-NO-RECOMMENDATION-CONTRADICTS`, `GUI-JOURNEY-JARGON`,
- `GUI-JOURNEY-JARGON`: plain words for the per-card memory note, the load card list, card names without UUIDs
  ("card n of m" only for identical cards), readable startup model names, the secure-storage button name and the
  sidebar states ('No local model running', 'Local model: loaded', 'Local model: running'). '1 transfers' has another owner.

Open: `GUI-JOURNEY-WELCOME-BELOW-FOLD`, `GUI-JOURNEY-FAILED-DOWNLOAD-STUCK`, `GUI-JOURNEY-MODEL-NOT-SELECTED`,
`GUI-JOURNEY-LOAD-WITHOUT-PROFILE`, `GUI-JOURNEY-NO-RECOMMENDATION-CONTRADICTS`,
`GUI-JOURNEY-DISK-SPACE-CRASH`, `GUI-JOURNEY-POST-STOP-GPU-BUSY`, `GUI-JOURNEY-UPDATER-404`.
- `GUI-JOURNEY-POST-STOP-GPU-BUSY`: the Host card shows 'Finishing GPU speed tuning (about 1 minute)' while the Host's
  existing `draft_width_calibrations` status reports a running job (no Host change).

Open: `GUI-JOURNEY-WELCOME-BELOW-FOLD`, `GUI-JOURNEY-MODEL-NOT-SELECTED`,
`GUI-JOURNEY-LOAD-WITHOUT-PROFILE`, `GUI-JOURNEY-NO-RECOMMENDATION-CONTRADICTS`, `GUI-JOURNEY-JARGON`,
`GUI-JOURNEY-DISK-SPACE-CRASH`, `GUI-JOURNEY-UPDATER-404`.

Method note: release Host and frontend accept only commit-pinned Hugging Face package URLs, so the download
steps used the release profile with debug assertions, a development frontend and the private loopback catalog
(`c6a23a4d4`); the pure release build stops at 'No model downloads are available for these graphics cards'.

## C4 first-run journey native acceptance — October 18

Owner: Codex 4. Seven orphaned journey leaves pass their merged source fixes;
the eighth needed the background-maintenance error correction `21a30afa5`.
This single **evidence branch** retains their isolated native acceptance and
reuses the passing source gates. The eight rows are
WELCOME-BELOW-FOLD, FAILED-DOWNLOAD-STUCK, MODEL-NOT-SELECTED,
LOAD-WITHOUT-PROFILE, NO-RECOMMENDATION-CONTRADICTS, JARGON, DISK-SPACE-CRASH,
and POST-STOP-GPU-BUSY, all prefixed `GUI-JOURNEY-`.

Acceptance: exercise the changed controls in one isolated Linux native session,
retain observed results and limitations, and close demonstrated rows on GInfer
`docs/open-work`. All eight native leaves now pass at the recorded scope. The
background-maintenance failure reporting fix merged as `16a4b2f25` from
`810e9e7bb`; all eight canonical rows are CLOSED at GInfer `816a6ffb4`. The
earlier warning change alone did not resolve that gap.

Source: `origin/main@e6b28e8d4`; the retained C3 native donor is `be69f9190`
plus Downloads source `f928613b1`. The journey components, release predicate,
selection store and first-run Host source compare identically. Its successful
focused/full source gate is retained in
`out/c3-downloads-manage-tab-20261018/result.json` (one make verify, frontend
3304 and native 1220 passing). Evidence-only changes need `git diff --check`.

Observed so far: at 1200×800 the local setup card precedes Secure storage;
choosing the second physical PRO advances and scrolls storage controls into
view. The private SSD folder is accepted and saved. With the published catalog
empty, Welcome explains that downloads are optional and links the installed-model
route. Models agrees that no tested recommendation exists; showing unavailable
packages leaves all four Download buttons disabled. These native observations
support the welcome, wording and recommendation leaves. A privately seeded failed
transfer displayed Try again and Choose a different model; the latter cleared the
saved transfer and selection and returned to model choice. Adding a metadata-only
`.ginfer` through the native file picker and selecting Load displayed the model's
missing-startup-settings explanation and Open GInfer Hosts action, before any
Engine startup. The real Qwen instance then reached Ready after native
artifact-scoped Ensure. Chat retained the earlier fixture choice; removing that
disposable inventory entry cleared the choice and the sole ready Qwen was
selected automatically, without opening the picker. Models showed Running with
Load disabled and Stop enabled. Native Models Stop returned it to Installed;
Hosts showed Stopped and the graphics-card speed-tuning explanation while the
real native calibration child was running. Calibration completed; the optional
remaining-formats profiler was stopped through Stop setup. GPU1 returned at
04:16 UTC. Shared C7 Models acceptance is retained in
`out/c4-journey-native-20261018/models-host-running-result.json` with screenshots. C7 visually accepted this scoped leaf and owns its canonical
open-work closure against this evidence commit. The registered 2-bit mix package
SHA-256 is `ab1ddc96b0f43e772468059567262d4dcc0fd38e9f402d589ad697070a83ad61`
(existing registry value, no rehash).
The separate maintenance-error source fix `21a30afa5` passes its focused checks,
one verification gate plus bounded failed-stage continuation, and the native
fault/retry acceptance described below.

Owned native inventory: S1
`/media/ron/SSD_RAID/ai/tmp-c4-gui-journey-20261018` held the copied native
candidate and fresh private HOME, XDG, DBus, unlocked keyring, Xauthority and
1200×800 Xvfb display; Wayland is unset. CPU-only at initial launch, then GPU1
booking 2962 (04:07–04:16 UTC, canceled at return) covered Ensure, startup, Stop and tuning;
the independent GPU0 fit is untouched. No disk filling, real download or changes
to another user's profile. Native pointer/keyboard input; inspector observation only.
The completed native root and separate disk-fix build root are retired after
retaining the result JSON and screenshots; no donor or model input is removed.

Completed real-lifecycle gate: the existing read-only
`/media/ron/SSD_RAID/ai/gbot-models/qwen38_27b_smol_df2.ginfer` was imported
using the native file picker. Custom settings selected only physical GPU1,
262144 tokens, one request/copy, images enabled and automatic speculation/KV.
The retained C3 hardware profile seeded this private Host; native artifact-scoped
Ensure passed and the instance reached Ready. This checks model projection and
post-Stop tuning visibility, not inference quality or speed. The same private
session then accepted the separately fixed maintenance-error candidate. After
the Host opened valid state, blocking atomic publication with an empty directory
at its private state-file path produced a visible setup error and enabled Retry
setup without exiting. Restoring state publication exposed a stable folder error
from a disposable regular file at the unchanged requested folder. After restoring
the original private directory, native Retry setup accepted that same folder and
cleared both maintenance and storage errors. The deliberately failed catalog
request retained its separate catalog error; no Engine child ran. Three reviewed
1200×800 screenshots and the concise result are in
`out/c4-disk-native-20261018/result.json`. This checks actual publication and
folder failures plus recovery, with existing ENOSPC mapping/rendered regressions;
no disk was filled and no native ENOSPC is claimed. App, idle Host, keyring, D-Bus,
listener, inspector forward and Xvfb are stopped; CPU80–87 returned at04:29 UTC.
The source fix is merged and its canonical row is CLOSED. Both verified-inactive
owned roots, `tmp-c4-gui-journey-20261018` (7.3 GiB allocated) and
`tmp-c4-gui-maintenance-disk-error-20261018` (31 GiB allocated), were removed
from S1 after acceptance. Concise results and screenshots remain in this branch;
the read-only model and dependency donors remain unchanged. Next: continue the
separately owned Linux CLI archive first-run walk.

## Engine settings native acceptance — C3

`GUI-ENGINE-SETTINGS-GUIDANCE` source `38b97a33e` merged `51842219e`;
14 focused cases and the required source gate are retained in
`/ai/gchat/out/c3-engine-settings-guidance-20261017/result.json`. The earlier
installed recheck stopped before reaching an instance and remains a fixture
limitation, not passing acceptance.

Native acceptance PASS (2026-10-18): real XTest opened Runtime details and
Technical details, checked requested versus reported values and purpose/help,
and changed draft context 131072 to 65536. Cancel closed the editor; reopening
restored 131072. The authenticated Host instance snapshot and complete saved
Host document were unchanged, status stopped and session null. No Apply,
reload, inference, remote mutation or Windows action. Ready-engine reported
values were not exercised. Packet:
`/ai/gchat/out/c3-engine-settings-native-20261018/{result.json,summary.md}`.
Reuse the existing source gates; evidence-only diff check.

Owned source `/ai/gchat-worktrees/c3-engine-settings-native-20261018`, branch
`test/c3-engine-settings-native-20261018`, baseline `fd897c5d7`. Retained
`ed68c7443` AppDir on S1 has identical EngineInstanceSettings source; editor
edit/cancel path is unchanged (later apply confirmation changes are outside
this no-apply check). Fixture decision: a real Host projects a saved LaunchRequest with no live
process as a stopped instance (service.rs). Use an explicitly seeded stopped
Muse profile, not a Ready claim or measured hardware profile. Acceptance
checks the truthful unreported-runtime state and configured values. No GPU
is needed. S1 private scratch `/media/ron/SSD_RAID/ai/tmp-c3-engine-settings-native-20261018`;
CPU8–15 booked at launch, with private Xvfb/HOME/XDG/dbus/keyring. Retain
only result JSON and short summary after cleanup. Private app/Host/Xvfb and
supporting processes stopped, private mounts and SSH forward gone, owned SSD
scratch removed, retained donor untouched; returned 02:24Z.
## Setup action errors, October 18 (Gchat 2)

`GUI-FIRST-RUN-ACTION-ERROR-PERSISTENCE`: a rejected Cancel profiling or folder change showed its error only
until the next successful two-second status poll. Setup now keeps action errors visible until the user tries
again. Temporary connection errors still clear when status reads recover; folder edits and retry controls are kept.

Evidence on main baseline `624df980d`: two rendered regression cases failed after two successful polls; a
connection-recovery control passed. After separating action errors from status-read errors, all 26 tests in
`EngineFirstRun.test.tsx` passed, including successful Cancel and folder retries. One `make verify` passed:
lint, type checking, quality checks, 3,220 app tests, 121 extension tests, 1,212 Rust tests and all six coverage
floors (six app tests skipped, 28 Rust tests ignored). The two changed source/test hashes matched locally and
on S1 before and after verification. These are rendered React tests with mocked Host responses; this change
makes no new native VM or Windows acceptance claim.

## Schedule action errors, October 18 (Gchat 2)

`GBOT-SCHEDULE-ACTION-ERROR-PERSISTENCE`: successful background list reads used to erase errors from rejected
Create, Enable and Disable actions. Any bot task or approval can trigger that refresh; a list read does not
acknowledge a failed action. Scheduled tasks now keeps action errors visible until the user tries again,
while temporary list errors clear when reads recover. Failed creation keeps the prompt and start time.

On main baseline `ae9c3bed2`, all three action-error regressions failed after a task-update refresh and the
connection-recovery control passed. With separate action and refresh errors, all 15 rendered schedule tests
pass, including successful retries and existing stale-response guards. One `make verify` passed: lint, type
checking, quality checks, 3,221 app tests, 121 extension tests, 1,212 Rust tests and all six coverage
floors (six app tests skipped, 28 Rust tests ignored). Changed source/test hashes matched locally and on S1
before and after the gate. These are rendered React tests with mocked service responses; there is no new
native VM or Windows acceptance claim.

## Removing the last disconnected bot account, October 18 (Gchat 2)

`GBOT-LINKED-ACCOUNTS-UNLINK-LAST-DISCONNECTED`: clearing the last disconnected account checkbox disabled
Save linked accounts before the change could be saved. The bot kept its old saved account reference. Save now
remains available while saved references need removal, including an empty selection. After a successful save,
the existing empty-account explanation and disabled Save state return.

The rendered regression follows the checkbox through saving an empty account list and receiving the saved
response. On baseline `08e49496d`, removal failed at the disabled Save button while the empty-account control
passed. The fix passes all 12 account tests.

One `make verify` passed lint, type checking and quality checks, then stopped on a stale setup regression
after an independent wording change. That existing test now uses Stop setup and checks the plain error plus
expandable details through polling and retry; all 28 setup tests pass. Only the failed coverage and remaining
Rust stages were continued: 3,272 app tests, 121 extension tests, 1,216 Rust tests and all six coverage floors
pass (six app skips, 28 Rust ignores). The first failure remains recorded; no second full gate was run.
Changed source/test hashes matched locally and on S1 before and after the continuation. Private build data
was removed and CPUs returned at 02:54 UTC. These are mocked-service React checks, with no new native VM,
Windows or live sign-in acceptance claim.

## Stopping unfinished bot tasks, October 18 (Gchat 2)

`GBOT-TASK-HISTORY-STOP-PAUSED-INTERRUPTED`: ready, paused and interrupted tasks offered only Resume. If
the model was unavailable or a person held control, that button was disabled and the user could not stop the
task. The shared history control now offers Stop alongside Resume for those states. Stop uses the existing
service cancellation operation; Resume retains its readiness checks. Both buttons lock during either request,
including same-tick clicks, and a failed action remains available for an explicit retry.

On main baseline `b56d94faa`, five rendered cases failed because Stop was absent; ten controls passed.
All 15 focused cases pass with the fix, covering cancellation without model/control readiness, pending feedback
through a task-state change, duplicate requests, retries and terminal states. Settings' surrounding setup
restriction is unchanged. Backend cancellation still retains task history and marks unresolved effects for
review. These are rendered React tests with inert task callbacks; there is no new native VM or Windows claim.

One `make verify` passed: lint, type checking, quality checks, 3,281 app tests, 121 extension tests, 1,216 Rust
tests and all six coverage floors (six app skips, 28 Rust ignores). Changed source/test hashes matched locally
and on S1 before and after verification. Private build data was removed and CPUs returned at 03:07 UTC.
Commands and results: `/ai/gchat/out/gchat2-stop-paused-tasks-20261018/result.json`.


## Cancelling brain edits restores task readiness, October 18 (Gchat 2)

`GBOT-BRAIN-CANCEL-EDITS-RESTORE-READINESS`: opening Edit brain and choosing Cancel edits
restored the visible saved brain but created an unsaved draft in the parent page, even if no field
was changed. Run and Resume then stayed disabled with instructions to save settings that were
no longer visible. Cancellation now explicitly discards the selected bot's draft. The page returns
to its saved assignment, keeps the task text and permits Run or Resume when the bot is ready.
Other bots' drafts and saved API-key handling retain their existing behavior.

Both new route cases fail on main baseline `faa818658`: cancel with unchanged fields and cancel
a changed model. With the fix, all 82 route and brain-component tests pass, including restored
Run/Resume readiness, retained task text and a subsequent task start without saving an assignment.
The component cases retain cancellation during pending/busy operations and saved-key coverage.
These are rendered React checks against a mocked service; no new native VM, Windows or live
model acceptance is claimed. Commands and results:
`/ai/gchat/out/gchat2-brain-cancel-readiness-20261018/result.json`.

One `make verify` passed: lint, type checking, quality checks, 3,288 app tests, 121 extension tests,
1,216 Rust tests and all six coverage floors (six app skips, 28 Rust ignores). Changed source/test
hashes matched locally and on S1 before and after verification. Private build data was removed
and CPUs returned at 03:20 UTC.


## Confirming deletion of a bot computer, October 18 (Gchat 2)

`GBOT-LOCAL-COMPUTER-REMOVE-CONFIRMATION`: Remove owned computer previously sent the
removal request immediately. The service then stopped/unregistered the owned VM and
deleted its disk, saved files and connection. The control now opens the existing app
confirmation dialog, names the saved bot, explains that all files are permanently
deleted and requires an explicit Delete computer action. Cancel sends no removal
request. Leaving setup before accepting also prevents removal.

Both ready-computer and unfinished-setup regressions fail on main baseline `9c3e7603a`
at the premature removal request. With the fix,
`yarn test web-app/src/components/GbotSetup/KvmSetup.test.tsx` passes all 15 cases, including
Cancel, explicit acceptance, exact saved identity, duplicate-action protection, pending
refreshes, late status replies and acceptance after unmount. The existing shared dialog
provides initial Cancel focus and Escape cancellation. Backend ownership and in-use
checks retain their existing behavior. No real VM was deleted during qualification.
These are rendered React tests using a mocked service; no new native VM or Windows
acceptance is claimed. Commands and results:
`/ai/gchat/out/gchat2-computer-remove-confirmation-20261018/result.json`.

One `make verify` passed: lint, type checking, quality checks, 3,294 app tests,
121 extension tests, 1,220 Rust tests and all six coverage floors (six app skips,
28 Rust ignores). Changed source/test hashes matched locally and on S1 before
and after the gate. Private build data was removed and CPUs returned at 03:33 UTC.


## Background setup disk errors — Codex 4, October 18

`GUI-JOURNEY-DISK-SPACE-CRASH` keeps the existing disk-capacity warning and fixes
its remaining background error reporting gap. First-run maintenance publishes its
last failure in process-local setup status, even when `host.json` cannot be
written. Welcome displays the actionable disk-full message and Retry setup using
the existing Resume action. Successful maintenance clears the failure; waiting
for an active profile or model does not. Saved choices and Engine admission are
unchanged. See the [ownership decision](../decisions/2026-10-18-surface-background-setup-failures.md).

Acceptance: a failed atomic state publication remains visible without a second
state write, retry retains the chosen folder and clears the failure; the rendered
UI exposes the disk-full action and clears it on success. Both Host regressions,
the existing maintenance cases, Host check/Clippy and all 32 setup UI cases pass.
No disk filling, model load or GPU work occurred in these checks.

The one S1 `make verify` passed lint, types, quality checks, 3,314 app cases,
121 extension cases and all six coverage floors. Its first Rust stage passed
728 cases and stopped at the shared-address fixture's UDP route discovery:
the container's `--network=none` caused `NetworkUnreachable`. The exact failed
case and every remaining Rust stage pass with Docker bridge networking and
Cargo/Yarn dependency access still disabled. Together the gate and this bounded
continuation pass 1,222 distinct Rust cases (28 ignored). The passed stages and
full gate were not repeated. Future private gate containers must retain a route
for the existing UDP address-discovery fixture while keeping dependency access
offline. Commands and results: `/ai/gchat/out/c4-gui-maintenance-disk-error-20261018/result.json`.

| Owner / host | Exact path | Purpose / status |
| --- | --- | --- |
| Codex 4 / local | `/ai/gchat-worktrees/c4-gui-maintenance-disk-error-20261018`, `fix/c4-gui-maintenance-disk-error-20261018` | Candidate from `548d73ed8`; no main merge |
| Codex 4 / S1 | `/media/ron/SSD_RAID/ai/tmp-c4-gui-maintenance-disk-error-20261018` | Isolated SSD source/cache copy and matched native export; initial CPU lease returned at 04:10 UTC, continuation/build returned at 04:20 UTC; nice 10, maximum eight jobs, socket 1 shared; no GPU |

Dependency locks and Host manifest match retained `tmp-gchat3-gui-novice-20261017`;
its older workspace lacks only the subsequently added Tokio test utility feature.
Reused caches are private copies; tracked source is the current candidate.

The matched native export completed at 04:19:48 UTC from the same verified source.
`candidate/bin/gchat` embeds the production frontend through Tauri's custom
protocol; `candidate/bin/ginfer-host` is the newly built Host. Both are native
development-profile binaries with complete shared-library dependencies. The
export references the retained runtime resources in
`tmp-c4-gui-journey-20261018/candidate/lib/GChat/resources`, overriding only the
bundled Host with this build. It copies no Engine or model. The standalone
frontend is also retained at `candidate/frontend`.

| Export | SHA-256 |
| --- | --- |
| `candidate/bin/gchat` | `bf3c0a851e91c84ed451cc80776972b180d9fadae989c40df52e808a64d4a037` |
| `candidate/bin/ginfer-host` | `c0a15137ad2d4ea880faba677ba5010c267dd7e8b83e30db28201403b7163281` |

Native acceptance passed in the existing isolated C4 journey session at04:29 UTC.
After valid Host startup, a private directory at its state-file path blocked
atomic publication: the app stayed open, showed the error with Retry setup and
retained the requested folder. Restoring state publication exposed a stable
error from a disposable regular file at that folder. Restoring the original
private directory and selecting Retry setup natively accepted the same path and
cleared maintenance/storage errors. The deliberately failed private catalog
request retained its independent error; no Engine child or GPU work occurred.

The three reviewed 1200×800 screenshots and detailed receipts are retained on
the single journey evidence branch `test/c4-journey-native-evidence-20261018`
at `f917c9d61`, under `out/c4-disk-native-20261018`. This source branch also retains
`out/c4-gui-maintenance-disk-error-20261018/native-result.json`, binding the native
acceptance to this exact implementation and that evidence commit. No disk was
filled and no native ENOSPC is claimed; actual publication/storage failures and
recovery complement the existing ENOSPC mapping/rendered regressions. Windows,
installer, inference quality and performance are outside this acceptance.

App, idle Host, private keyring/D-Bus, listener, Xvfb and inspector forward are
terminal; CPU80–87 booking2974 was canceled at04:29 UTC. The independent GPU0 fit
is untouched. The S1 build root retains the tested app/Host and private caches
pending integration; the donor is untouched. Build/binding evidence:
`/ai/gchat/out/c4-gui-maintenance-disk-error-20261018/native-export.json`.
Next action: coordinator review/integration and canonical row closure; retire
owned disposable build copies after retaining this tested candidate and packet.

## Switch keyboard focus — C7 native acceptance

`GUI-SWITCH-FOCUS-RING` passed native Linux acceptance on October 18. The shared
Switch fix `cc59fd5db`, rebuilt at `014df1845` with its production frontend,
shows a visible keyboard-focus ring in Light and Dark. Native Tab/Shift-Tab
reached the General setting **Load default model on startup**; Space changed
its state and retained focus and the three-pixel ring in both themes. In Skills,
a disposable invalid skill provided a disabled switch: Tab/Shift-Tab skipped it,
and clicking it left its state unchanged. Screenshots and read-only DOM/style
observations agree. All input used native XTest; the inspector only read state.

The relevant Switch, CSS, General and Skills source is unchanged from `71abf1708`,
whose ONE `make verify` passed. This evidence-only branch adds no source changes
and passes `git diff --check`. Windows remains outside this Linux acceptance.
No model load, account sign-in or shared catalog mutation occurred.

Candidate: `/ai/gchat-worktrees/c7-switch-focus-native-20261018`, branch
`test/c7-switch-focus-native-20261018`. The small packet is
[`out/c7-switch-focus-native-20261018/`](../../out/c7-switch-focus-native-20261018/),
including `native-result.json`, build receipts and five screenshots. The private
S1 app, D-Bus, keyring, Xvfb and inspector session are stopped; CPUs were returned
at 07:00 UTC. The owned S1 source/build/AppDir/HOME/tools root
`/media/ron/SSD_RAID/ai/tmp-c7-switch-focus-native-20261018` was retired,
removing 41.42 GB. The shared development catalog is retained. Next: coordinator
integration and canonical Linux leaf closure.

## MCP control names — C7 native acceptance

`GUI-MCP-CONTROL-NAMES` passes native Linux acceptance on source `cf670bced`,
including merged fix `ee5c2a4db`. Two private connection rows expose distinct
server-specific names for Advanced, Edit, Remove and Use controls. Native
Shift+Tab reaches the controls; Enter opens the matching Advanced, Edit and
Remove dialogs. Space enables the focused connection switch and preserves its
focus. A real disposable stdio MCP child completes its handshake and reports no
tools; its green connected indicator exposes `role="img"` and the accessible
name `MCP server connected`. The Remove dialog initially focuses Cancel and
Escape cancels without deleting the connection.

All input used native XTest in a private S1 Xvfb desktop; the inspector only
read DOM/ARIA state. Initial fixture preparation needed Python `-I` to ignore
the AppDir's Python environment. A migration-added default Exa connection was
removed before acceptance; it initialized during preparation but no tools were
called. Acceptance used only the private local fixture, with no account,
model, GPU or shared development catalog dependency.

The MCP route, tests, dialog and English copy are unchanged from `71abf1708`,
whose ONE `make verify` passed. This evidence-only branch passes
`git diff --check`. Windows and spoken screen-reader output remain outside this
Linux control/semantics leaf.

Candidate: `/ai/gchat-worktrees/c7-mcp-control-names-native-20261018`, branch
`test/c7-mcp-control-names-native-20261018`. The small packet is
[`out/c7-mcp-control-names-native-20261018/`](../../out/c7-mcp-control-names-native-20261018/),
with five screenshots, native observations and build receipts. The private app,
Host, D-Bus, keyring, Xvfb and inspector session are stopped; CPUs were returned
at 07:15 UTC. The owned S1 source/build/AppDir/HOME/tools root
`/media/ron/SSD_RAID/ai/tmp-c7-mcp-control-names-native-20261018` is retired.
The shared development catalog remains live. Next: coordinator integration and
canonical Linux leaf closure.

## Consumer Qwen 27B 2-bit mix launch catalog — GChat integration

`CONSUMER-LAUNCH-PROFILES` mirrors the signed Linux RTX 5090, RTX 4090 and
RTX 3080 Ti Laptop settings for package `483343c2` (full SHA-256
`483343c28912ae5db3d00478f16fffb10dcbb0c1317f8c90c09c396fcb6e4ca4`,
10,667,321,600 bytes). The exact source catalogs come from GInfer `7d275e026`
(RTX 5090) and merged `7792f3ac3` (RTX 4090/laptop). Each remains
**screened-startup**: TP1, C8, Text, fixed DFlash7, INT8 KV, automatic KV arena,
300 MiB reserve, CUDA graphs/prefix defaults, zero full-context requests.
The admitted contexts are 131,072 for RTX 5090/4090 and 53,248 for the laptop.
The evidence and qualification revision stay bound to Engine `aa1c48016`;
these entries do not qualify a different Engine revision or promise a
simultaneous full-length cohort. See the existing
[screened-profile decision](../decisions/2026-10-16-label-screened-startup-launch-profiles.md).

The Host's existing supplied-release-catalog test now checks all three exact
artifact identities, device/memory/context bounds, launch options and startup
qualification records. The runtime/parser and frontend need no change. The
release builder already consumes `GINFER_PROFILE_CATALOGS`; its generated
`resources/bin/launch-profiles.json` is a build output, not a tracked source
catalog. Acceptance uses seven explicit, nonempty frozen inputs: the three
signed files plus the four previously corrected Text/Vision catalogs. Their
ordered merge must equal all 41 merged profile objects (old 38 plus new 3)
exactly, retaining the four prior context lowerings. The existing screened-profile frontend
regression runs within ONE `make verify`.

Candidate: `/ai/gchat-worktrees/gchat3-consumer-launch-profiles-20261018`, branch
`fix/gchat3-consumer-launch-profiles-20261018`, base `7727db673`.
The small source/input bindings and test evidence are in
[`out/consumer-launch-profiles-20261018/`](../../out/consumer-launch-profiles-20261018/).
The focused supplied-catalog test passes (one test); Host check and clippy
also pass. ONE `make verify` completed at 12:11:54 UTC with 3,569 app tests
(six skipped), 127 extension tests, 1,288 native tests (28 ignored across 23
summaries), and all six coverage floors passing. Lint has zero errors and five
existing warnings. The actual generated catalog is 86,734 bytes, 41 profiles,
and exactly equals the seven inputs' ordered JSON merge, preserving every
profile field. Its SHA-256 is
`2093fb22efc904555e42be272d4a6ebdf9c07987510441ecf890b30b9197a3a3`.
The tested Host source is unchanged after execution.

The S1 gate used CPUs 96–103, a shared socket-1 compile lock, nice 10 and max
eight jobs, with no GPU. Booking 3272 was returned at 12:12 UTC. The terminal
container and owned fixture
`/media/ron/SSD_RAID/ai/tmp-gchat3-consumer-launch-profiles-tests-20261018`
were retired at 12:14 UTC after retaining the small result, summary and raw
logs and verifying no readers or live jobs. This removed 29.11 GB of allocated
owned source/dependency/build copies. The inactive RC donor
`/media/ron/SSD_RAID/ai/tmp-gchat3-linux-rc-refresh-20261017/app`
remains protected and was used only for independent read-copy.
The coordinator owns private DEV publication and Linux RC input handoff; no
live catalog mutation is part of this source/test fixture. Its independent
private DEV generation completed at 11:58:04 UTC with eight packages and 115
selected profiles: all prior seven packages/112 selected profiles are unchanged.
The 272,545-byte catalog is bound in `private-dev-deployment-result.json`.
Coordinator HTTP acceptance passed at 12:03:39 UTC: the live catalog equals
that generated output, all three new profiles equal the frozen signed sources,
and all eight payload routes pass exact-length HEAD and one-byte Range checks.
See `private-dev-http-acceptance.json`; no payload, option, qualification label
or existing profile was changed. The seven frozen inputs and
`gchat-catalog-binding.json` were handed to Codex3 at 12:04 UTC for inclusion
with the other current Linux catalogs in the next RC. Codex3 owns that release
build; this gate does not claim that an RC has already been rebuilt. Source
and private DEV integration are complete and ready for coordinator merge.


### Consumer Flash pure 2-bit RTX 5090 mirror — Gchat 3

Current assignment: mirror the completed signed GInfer `9bfcec0bb` Flash
profile into the GChat release catalog inputs and shared private DEV catalog,
while preserving the three accepted Qwen profiles and four context lowerings.
The exact Flash package is `8bbb85bf6ba669157045bac0a6fdd623dd87694b7b1fe09b7f2150fc3636ab08`
(70,247,086,080 bytes). Its RTX 5090 profile remains screened-startup,
262,144 context/C8, TP1, fixed MTP3, INT8 KV, automatic placement/KV,
300 MiB KV reserve, 10 GiB Host headroom, graphs/prefix/LFU on, Text with
Vision and structured outputs off; zero full-context requests and eight smoke requests.
Engine qualification remains bound to `aa1c48016`; this mirror makes no
new hardware or full-context qualification claim.

Acceptance: extend the existing supplied-catalog Host regression, focused
test plus Host check/clippy and ONE `make verify` with eight explicit inputs;
require the generated release catalog to preserve all 41 existing profiles
and add the exact signed Flash object. Coordinate C7's idle/zero-GET service
boundary, preserve old generator/inputs/www/receipts, run the existing DEV
generator once, restart the unchanged service and accept exact catalog plus
payload HEAD/Range routes. No payload mutation or numerical change.

Candidate: `/ai/gchat-worktrees/gchat3-consumer-flash-profile-20261018`,
branch `fix/gchat3-consumer-flash-profile-20261018`, base `e15807324`.
Small evidence: `/ai/gchat/out/consumer-flash-profile-20261018/`.
The independent test fixture launched at 13:27 UTC on S1 SSD at
`/media/ron/SSD_RAID/ai/tmp-gchat3-consumer-flash-profile-tests-20261018`,
using eight booked socket-1 CPUs and the protected inactive RC read-copy
donor; no GPU/model. The shared DEV root remains
`/media/ron/SSD_RAID/ai/gchat-private-dev-catalog-v1`; parent owns the
bounded generator/input update and acceptance, C7 owns service stop/start.
C3, C4 and Gchat2 confirmed consumer idle. C7 stopped the service at
13:29 UTC after a fresh zero-GET check. The existing generator ran once at
13:31 UTC, producing eight packages/116 profiles (277,094 bytes, SHA-256
`2262186803e08a65d4fee4b99a8ba1f5e0ccbe87ef66b02a22c2bb5382a4931c`).
All 115 existing profile objects, the other seven release records and all
payload symlink targets are unchanged. The Flash release adds the signed
profile, derives its 32,606 MiB minimum and uses the pure 2-bit package label.
The prior generator, inputs, www and receipts are retained under the shared
root at `mirror-before-flash5090-20261018T133140Z`; no payload was copied or
rehashed. See `private-dev-deployment-result.json`. C7 restarted the unchanged
service at 13:32 UTC. HTTP acceptance passed at 13:32:43 UTC: exact generated
catalog, the signed Flash object and all 115 prior profiles; all eight payload
routes passed exact-length HEAD and one-byte Range (206). Only eight payload
bytes were read. See `private-dev-http-acceptance.json`. Consumers may resume.
The frozen eighth input/source binding was handed to Codex3 for its pending
Linux RC build, preserving the prior seven inputs and Engine. The accepted
42-profile build binding followed at 13:39 UTC; Codex3 owns RC assembly.

The focused supplied-catalog regression passed one test; Host check and final
all-target clippy passed. ONE `make verify` completed at 13:35:35 UTC with
3,603 app tests (six skipped), 127 extension tests and 1,288 native tests
(28 ignored across 23 summaries); all six coverage floors passed. Lint has
zero errors and five existing warnings. The final explicit Flash assertion
removed a redundant default struct update before the native verification
phase; final clippy was the only follow-up gate. The actual generated release
catalog is 90,917 bytes with 42 profiles, exactly the ordered eight-input
merge, preserving all 41 prior objects and the signed Flash object. SHA-256:
`2da2c9adb6d2bf034e4b4e0a35a14a26eeeb0728f9119ab513ac3202142e0598`.
See `catalog-staged-proof.json`, `terminal-result.json` and the retained raw
logs. CPUs 112–119 booking 3310 returned at 13:38 UTC. The owned S1 fixture,
prep log and both exited containers were retired at 13:39 UTC, removing
28.05 GB of logical file bytes; the inactive RC donor remains protected.
The retained generated JSON was reconstructed after cleanup from the eight
frozen inputs and matches the original staged SHA-256 exactly. Source,
private DEV publication and the Linux RC input handoff are complete.

### Consumer profiles — first use on RTX 4090 and laptop

Codex 5 is checking development GChat from main `770f3c03d` on RTX 4090 and
RTX 3080 Ti Laptop. The ordinary flow is catalog Download, Automatic selection
and Load for Qwen 27B 2-bit mix `483343c2` and Muse 30B 2-bit mix `9d4ca1b2`,
followed by 600 seconds each at client C1 and C4 through GChat's API. Acceptance
records selected profile ID and Ready time, zero serving HTTP 4xx/5xx and no
new swap activity or app/Engine swap. Bubbs waived per-seed IDs; the exact
profiles already have Engine identity evidence. No Host diagnostic route is
added. Fixes are limited to GChat selection or catalog defects; Engine failures
go to Bubbs.

Current state: Ada Qwen, Ada Muse and laptop Muse passed. Laptop Qwen is
**BLOCKED before Ready** by startup memory-quote admission. Its ordinary
Download completed20:05:20 UTC. The first Load was canceled when the coordinator
navigated away; a later attempt exposed an incomplete artifact hardware-profile
scope. Normal GInfer Hosts Continue setup completed that same Qwen scope in
3.205 seconds, confirmed20:23 UTC. The final native Automatic Load at
20:23:41 UTC failed before creating an Engine instance. The unique frozen
Automatic candidate is53248/C8; no instance selected-profile ID was published. No laptop Qwen API natural was launched and no Ready time
or serving PASS is claimed. Retained evidence records the
[completed artifact setup](evidence/consumer-first-use-20261018/laptop/laptop-qwen-profile-resumed.json)
and [pre-Ready rejection](evidence/consumer-first-use-20261018/laptop/laptop-qwen-load-r2-rejected.json).
The retained error is:

> GPU rank0: free15761145856 bytes; non-KV17209084416 bytes; headroom314572800
> bytes; minimum KV276891648 bytes; available KV0 bytes.

The derived Automatic candidate is
`rtx3080ti-laptop-qwen38-smol-q2g64-mix-dflash2-q4-tp1-c8-52k-int8-screened`.
Source inspection found no Automatic/catalog mapping defect: the catalog's
53248/C8, fixedDF7, INT8, Vision off, graphs enabled, prefill0 and automatic
arena are retained. Runtime eb777 resolves prefill0 to1024 before both quote
and live construction, so AUTO prefill divergence is ruled out. The leading
explanation is the quote/live graph-accounting difference: Qwen's layout marks
graph allowance as conservative diagnostic telemetry and excludes it from live
construction backing, while the Engine emits it and Host admission adds it to
mandatory non-KV bytes. The error retains only the total; the already-produced
quote's weights/state/graph breakdown is not retained here, so the source
finding does not establish the cause or amount of overestimation. Relevant
source is frozen GChat770f3c03d `engine_host.rs:624–634` and
`service.rs:1664–1669`, plus GInfer eb777 Qwen `layouts_impl.h:1057–1080`
and `api_impl.h:97–99`. Route the
Engine/Host quote contract to Bubbs; selection/catalog-only authority does not
cover changing memory admission or bypassing it. No retry or input substitution
is authorized by this finding.

Laptop returned20:30 UTC: booking413 canceled, GPU guard released, no Engine
or quote process, Qwen instance count0 and unchanged swap counters468/775.
The isolated app and Host remain idle for evidence recovery. Ada's separate
signed72153 native Qwen natural also passed and returned20:30 UTC with783
canceled; its C1/C4 phases ran602.619/609.291 seconds,202HTTP200 and198 exact
seeded comparisons, with no swap. These resize results do not replace the
frozen eb777 app check. Selected small evidence relays wait for Gchat3's
local5090 native Muse1498 return; C4 then owns three no-load Flash quotes and
C5 one live C8 witness per card. C6's direct S1-to-Ada model-free pair may use
its separately coordinated untimed boundary. No C5 target resource is held.

Ada Qwen returned at
16:07 UTC after normal app API and model Stop. Its selected profile is
`rtx4090-qwen38-smol-q2g64-mix-dflash2-q4-tp1-c8-128k-int8-screened`.
C1 ran 600.867 seconds/86 waves and C4 ran 608.817 seconds/29 waves. All 202
requests returned HTTP200, request errors were zero, system swap counters stayed
zero and app VmSwap was zero. The driver completed at 16:04:02 UTC. Evidence is
[the request guard](evidence/consumer-first-use-20261018/ada/ada-qwen-natural-guard.json)
and [normal Stop](evidence/consumer-first-use-20261018/ada/ada-qwen-stopped.json); full responses and telemetry remain in the owned
Ada fixture. C6's bounded drafter Op returned at 16:14 UTC. The ordinary
Muse Download started at 16:16 UTC after verifying no compute process and
66.6 GB free native Linux space, and completed before the 16:47 UTC check.
Native Load with Automatic started at 16:47:47 UTC; Engine Ready was
16:47:54 UTC (6.614 seconds), and the Host snapshot confirmed Ready at
16:48:07 UTC. The effective settings are 131072 context/C8, INT8 KV,
fixed seven-token DFlash2, automatic arena, 300 MiB headroom and Vision off.
Its derived catalog source is
`rtx4090-muse-smol-q2g64-mix-dflash-q4-tp1-c8-128k-int8-calculated`;
the instance qualification ID is null after Automatic replaces the explicit
catalog arena. The normal app API advertised the exact Muse package and the
unchanged 600-second C1/C4 attach started at 16:48:28 UTC. C1 completed at
16:58:30 UTC after 602.107 seconds/146 waves, all HTTP200 with no request errors
or new swap activity; app, Host and Engine VmSwap remained zero. C4 completed
at 17:08:35 UTC after 605.083 seconds/86 waves. All 490 serving requests across
both phases returned HTTP200 with zero errors; system swap counters remained
zero and app, Host and Engine VmSwap were zero at the terminal check. Normal
model and API Stop completed through the app controls at 17:10 UTC, both Host
instances report stopped with no last error, and the Engine process exited.
Booking767 was canceled and Ada returned at 17:10 UTC. The GPU guard was held
before download completion through model Stop; the request deadline was
17:16 UTC. Small terminal evidence was relayed at 17:23 UTC:
[request guard](evidence/consumer-first-use-20261018/ada/ada-muse-natural-guard.json),
[selected settings](evidence/consumer-first-use-20261018/ada/ada-muse-installed.json)
and [normal Stop](evidence/consumer-first-use-20261018/ada/ada-muse-stopped.json).
Laptop has an isolated app and configured private API key. Its ordinary Muse
Download started at 17:48:28 UTC, after Ada resize
returned at 17:38 UTC, S1's timed standard returned at 17:41 UTC, the short Ada
Flash quote returned at 17:45 UTC and C6's Op gate returned at 17:47 UTC.
The UI confirmed Download complete and the local model loaded at18:19:56 UTC.
The existing Host snapshot confirmed Ready at18:20:08 UTC; Automatic selected
131072 context/C1, INT8 KV, fixed seven-token DFlash2, prefill1024, automatic
arena,300MiB headroom and Vision off. Its qualification ID is null after the
Automatic arena override. The unique compatible catalog source is
`rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4-tp1-c1-128k-int8-calculated`.
This is a derived source ID. The normal Integrations control started the API;
at18:22:41 UTC, `/v1/models` returned HTTP200 and the exact Muse package hash.
Booking408 began at18:06 UTC through18:55 UTC; the canonical laptop GPU
guard was acquired before completion triggered Automatic load. At Download
terminal, C6's queued three-minute S1 Op pair preceded the laptop app and
Ada native Muse naturals.
At18:07 UTC before model load, app and Host VmSwap were zero; system counters
were pswpin468/pswpout775, with the existing1816KiB allocated swap unchanged.
The load check at18:20 UTC found unchanged system swap counters, and app,
Host and Engine VmSwap were zero at18:23 UTC. The final chat check compares
deltas from the same baseline. C1 returned Ada at18:08 UTC; C7's final CPU-only
isolation check returned18:18 UTC. C6's S1 pair returned18:24 UTC with
terminal0 and3489 canceled. The coordinator cleared the prepared laptop app
and Ada native Muse naturals to start together after that direct return.
Laptop C4 measures four app clients queued through the selected C1 Engine.
The unchanged attach driver started18:25:09 UTC under booking408 and the
held canonical GPU guard, with an18:55 UTC deadline,600-second C1 then
600-second C4 phases, uncapped responses and a3GiB system memory floor.
Laptop C1 completed at 18:35:10 UTC after 600.659 seconds/73 waves; C4 completed
at 18:45:19 UTC after 609.114 seconds/22 waves. All 161 serving requests returned
HTTP200 with zero request errors. System pswpin 468/pswpout 775 remained
unchanged, and app, Host and Engine VmSwap were zero at the terminal check.
The sidebar Stop server control stopped both the API and owned model; at
18:48:10 UTC the Host instance was stopped with no last error, the Engine had
exited and port 1337 had no listener. Booking 408 was canceled and the laptop
returned at 18:48 UTC. Small evidence is retained in the
[request guard](evidence/consumer-first-use-20261018/laptop/laptop-muse-natural-guard.json),
[selected settings](evidence/consumer-first-use-20261018/laptop/laptop-muse-installed.json),
[attach start](evidence/consumer-first-use-20261018/laptop/laptop-muse-attach-start.json)
and [normal Stop](evidence/consumer-first-use-20261018/laptop/laptop-muse-stopped.json).
Two coordinator checks were early because elapsed time was estimated from
waits. Mailbox checks now compare clock UTC with the stored previous-check
UTC and skip the read below300 seconds; the guard was exercised successfully
without reading the mailbox at19:37 UTC.
Ada's independent signed 72153 Muse native natural reached Ready
at 18:27:09 UTC in 9.032 seconds under booking 776 and completed at 18:47:15 UTC.
Its C1/C4 phases ran 601.726/603.807 seconds, with exact-ID comparisons and all
native/lifecycle/health exits zero and no swap. Ada returned at 18:48 UTC and
booking 776 was canceled. Its Qwen natural completed20:28:32 UTC after the
laptop Qwen Download completed20:05 UTC; Ada returned20:30 UTC. Arch corrected
the resize context interpretation at19:52 UTC:
profile context is the configured value witnessed at Ready, before the
Engine's standard 512-token request reserve. Ada Qwen's entry is therefore
131072/C8 using its existing evidence; the resize owner applied the same
rule across all entries before the final natural. These native resize checks
remain separate from app first-use.
Before requests, the two laptop natural request files were corrected from target-family
names to the exact package IDs advertised by the app; the maintained
28,116-character prompt and uncapped output remain unchanged.

Bubbs added parallel requalification after GInfer `c09b5315b`: resize the Ada
and laptop Qwen/Muse bounds and retry laptop Muse C8, with admitted bounds,
standard C1/C4/C8, natural, exact IDs and Arch sign. The GInfer authority is
`docs/consumer-launch-profiles/README.md` in the worker's separate branch.
Arch's 15:08 UTC hold required explicit admission to match that startup's own
final Automatic arena. Arch signed the correction at 15:48 UTC; Bubbs merged
`72153af01` and cleared resize at 15:49 UTC. The accepted SM86/SM89 builds are
retained on S1. Laptop Muse 8192/C8 and Qwen 75776/C8 have Arch's numeric sign;
their standard C1/C4/C8 runs passed exact IDs and no swap. Laptop Muse natural
reached Ready at 16:36 UTC but failed before requests because a maintained
Python helper was missing. Normal native exit and the failed evidence were
retained. The target Python then passed the complete helper import preflight;
the unchanged retry reached Ready at 16:37:44 UTC and completed at 16:57:49 UTC.
Its C1/C4 phases ran 604.187/600.770 seconds, all 250 requests returned HTTP200,
identity matched and native/lifecycle/health exits were zero with no new swap.
Qwen natural reached Ready at 17:00:15 UTC in 27.063 seconds and completed at
17:20:35 UTC. C1/C4 ran 601.217/618.294 seconds with 23/15 waves; all 83
requests returned HTTP200, exact-ID comparisons matched, all lifecycle exits
were zero and no new swap was recorded. Laptop returned at 17:22 UTC and
booking405 was canceled. Ada first-use returned at 17:10 UTC and was handed
to the resize worker. Frozen SM89/helpers, isolated Flash ELFs and small raw
evidence transfers finished by 17:24 UTC. Ada sizing and standard checks completed
before laptop's ordinary Muse Download; matching app/native natural checks
then ran on separate hosts after Download finished. The final Qwen pair
completed the Ada native natural while laptop app Load was rejected pre-Ready. The Windows RC owner was notified of the complete transfer
return before its quiet native build.
Ada Muse sizing, C8 smoke and the canonical standard passed at 131072/C8,
with exact IDs, no new swap and its own explicit Automatic arena of
9091153920 bytes; Arch signed at 17:33 UTC. Qwen capacity reached Ready with
configured context 131072/C8; its separate maximum request horizon is 130560.
The earlier interpretation rounded that horizon down to 130048. Arch corrected
it at 19:52 UTC: the profile and prepared natural use configured 131072/C8,
with the same retained capacity and standard evidence. The canonical standard
completed at 17:36:31 UTC, with 52 arrays/26000 IDs exact, all lifecycle exits
zero and no new swap. Laptop Qwen's configured context remains 75776, with
request horizon 75264. No full-context request was measured.
The separate Ada and laptop Flash metadata-only quote searches overlap the
ordinary app Download, with CUDA and GPU release required by 18:07 UTC before
download completion can trigger app auto-load. Laptop context 81920/C8 hit an
Engine planner geometry error before quote JSON; Bubbs received the retained
packet for Engine diagnosis, and laptop boundary qualification is held. This
is distinct from a Host RAM fit rejection. No Flash Engine or witness has
started. Ada quotes found a provisional 140288/C8 Host fit and rejected the
next 141312 granule; Ada returned at 17:53 UTC. Physical witness and numeric
sign remain pending. No bulk Download or relay overlaps speed timing.
Arch signed the Flash planner correction source `5d46a8664`; its owner is
building SM86 and will replay only the no-load C8/81920 crash quote plus
C8/262144 after booking408 returns and the shared native build has ended.
The corrected SM86 efb41bfe1 serving ELF is ready, 317409464 bytes. Neither
cross-host SSH direction authenticates, the earlier transient HTTP route is
retired and the private catalog service accepts only catalog/model paths.
Native booking 1489 returned at 18:54:25 UTC and was canceled. Its owner
started the established parent-mediated relay at 18:58 UTC, followed by the
two no-load laptop quotes. The 81920 quote fit with native exit zero; the
262144 quote started at 19:08 UTC. The second quote returned at the19:38 UTC cutoff as INCOMPLETE, with no JSON
or model load. Per Bubbs's19:30 UTC priority, ordinary laptop
Qwen Download follows its normal return before the deferred
C6 pair and C4 native RC checks; no key or
installation changes, Flash model load or timing gate belong to this handoff.
Arch accepted the shortfall-guided correction direction at 19:42 UTC. C4
owns source `270a8b6a05bced225495eaf8e02a240e645e3f43` and the next three
no-load quotes: laptop C8 at 262144 and 81920, and Ada C8 at 262144, with a
sub-60-second target at 262144. They run after the paired Qwen naturals return. All three native builds passed; the immutable SM89 serving donor is S1 `/media/ron/SSD_RAID/ai/tmp-c4-quote-capacity-result-20261018/sm89-270a8b6a05bced225495eaf8e02a240e645e3f43/ginfer-serve` (292625752 bytes, SHA-256 `0f299f1aba8a57dcbe1019f9dd60ab16bd6d9f73218e69ffe17cbce9797f2b64`).
C5 then witnesses each demonstrated conservative bound once at C8. Any live
rejection blocks merge-ready; no Flash bound is promoted from the old quotes.
Existing signed catalog entries and the eb777 bundle remain the first-use
inputs until replacement bounds are signed and coordinated with Gchat 3.

The frozen private catalog is
`http://192.168.1.109:18761/catalog.json`, accepted at 14:31:45 UTC with nine
packages and 122 profiles, SHA-256
`19a1d986fc6ec1510ea78b9d340e006ff8179a16f8e6b0acc69c8e4af6154309`.
Its 11 inputs and binding are in
`/ai/gchat/out/consumer-muse-profiles-20261018/catalog-input` and
`catalog-binding.json`. The complete runtime set uses clean GInfer
`eb777ab9570fad1c8301635617f0923f2b820424` across SM80/86/89/120a. S1 app/Host
and runtime builds passed; maintained runtime staging and AppDir assembly passed
at 15:03 UTC. Earlier e2282/b26ec5b8f runtimes do not satisfy the Muse gate.
Initial orchestration stopped before compilation on a stale relative receipt
path and then lost SSH quoting. The corrected path assertion, identifier-only
substitution and parsed command newlines produced the successful build.

The existing natural driver gained the authorized opt-in `--attach` mode in
GInfer `bab1814fd`, merged as `a0a795e8c`. Python 3.11 compilation and focused
success/HTTP503 lifecycle tests passed, including attached GPU telemetry. It
leaves app load and Stop ownership with GChat, uses uncapped responses, and
measures new system swap activity separately from previously allocated swap.
Laptop began with 1,816 KiB allocated swap; this alone is not new activity.

The selected profile comes from the existing authenticated Host snapshot.
Ada Qwen reports
`rtx4090-qwen38-smol-q2g64-mix-dflash2-q4-tp1-c8-128k-int8-screened`, with
131072 context, C8, INT8 KV and fixed seven-token DFlash2. Its managed Download
started at 15:16:17 UTC and verified successfully. Download refresh emits
`onModelImported`; `DataProvider` selects the first usable model and calls
`switchToModel(isAutoStart: true)`. This ordinary path started the model at
15:39:51 UTC without another Load click. Engine Ready was 15:40:07 UTC after
15.6172 seconds; the app and Host snapshot confirmed Ready at 15:40:20 UTC.
No user-click-to-Ready latency is claimed. This start preceded GPU-flock
acquisition, though booking764 covered the interval and no foreign compute was
observed. Subsequent downloads must acquire the GPU guard before completion.
The normal Integrations control started the API at 15:43 UTC. It advertises
the package hash as the local model ID. Attach started at 15:43:52 UTC with
600-second phases, a 16:08 UTC request deadline and a 3 GiB memory floor.
The startup updater's absent GitHub `latest.json` returned HTTP404 before the
serving interval; it is outside the model-serving acceptance.

Automatic ranks context before concurrency. Frozen Muse candidates are Ada
`rtx4090-muse-smol-q2g64-mix-dflash-q4-tp1-c8-128k-int8-calculated` and laptop
`rtx3080ti-laptop-muse-smol-q2g64-mix-dflash-q4-tp1-c1-128k-int8-calculated`.
Laptop C4 therefore means four app clients queueing through the selected C1
Engine. Automatic overrides explicit catalog arenas with automatic sizing;
those instances may report a null qualification ID. Retain effective options
and the uniquely matching catalog candidate, labelling its source ID as derived.
A null qualification ID alone does not establish a selection defect.
Application Ready, Engine startup duration and API readiness are separate facts.
The blocked laptop Qwen first-use candidate in this frozen catalog is
`rtx3080ti-laptop-qwen38-smol-q2g64-mix-dflash2-q4-tp1-c8-52k-int8-screened`,
53248 context/C8 with automatic KV. Its final native Automatic Load at20:23:41 UTC
failed pre-Ready at quote admission, as recorded above.
The separately signed 72153 resize point is 75776/C8; it does not replace the
frozen first-use input before this check completes.

Owned inventory:

| Host | Path and purpose | Status / retention |
| --- | --- | --- |
| local5090 | `/ai/gchat-worktrees/c5-consumer-first-use-20261018`, branch `test/c5-consumer-first-use-20261018` | Documentation/evidence integration; no local model or build |
| S1 | `/media/ron/SSD_RAID/ai/tmp-c5-consumer-first-use-20261018` | Accepted app/Host/runtime builds and 4.65 GB AppDir donor; retain through first-use |
| Ada | `/home/ron/tmp-c5-consumer-first-use-20261018` | Isolated AppDir/tools/controls, private HOME/run/tmp, managed Qwen and Muse; Qwen and Muse app natural PASS, both models/API stopped; retain small evidence and fixture through integration |
| laptop | `/home/ron/tmp-c5-consumer-first-use-20261018` | Isolated app/API settings; ordinary Muse Download and Automatic load passed, C1/C4 app natural COMPLETE with 161 HTTP200; Muse model/API stopped; Qwen Download and artifact setup complete, final Load blocked pre-Ready by quote admission;413 canceled/returned20:30 UTC, app/Host idle; retain failure evidence pending Bubbs |
| Ada | `/tmp/c5x/xkbcomp` | Owned compiler symlink for private Xvfb; remove with fixture |

Both targets use private mode-700 runtime directories, private HOME/XDG,
D-Bus, unlocked keyring and Xvfb, with WAYLAND_DISPLAY unset. The portable
Xvfb copy uses the owned keyboard-compiler prefix because Ada has no system
`xkbcomp`; the original tool is unchanged. Native controlled text inputs use
paced typing: zero-delay typing dropped characters in the laptop API key field;
replacement at 20 ms per character verified its full length. Secrets remain
only in the private target fixtures. Native disk checks resolved Ada's earlier
space blocker and both deployments passed; free space is checked before each
Download. Protected model inputs, raw profiler evidence and immutable profile
donors outside these app roots are excluded from cleanup.

### Consumer Muse 30B 2-bit mix mirror — Gchat 3

Result: mirrored the six signed Muse launch profiles from GInfer
`7560e24d0` (RTX 5090, accepted as `bdd282447`) and `09e4a8871`
(RTX 4090/laptop, accepted as `d1ac9e391`) into release inputs and private DEV.
Package SHA-256 is
`9d4ca1b204b993e3a5dd9e52c8eda0d804801dd4ded664dd37b81641fcb44a2c`,
13,838,508,544 bytes. These remain calculated-startup-smoke profiles bound to
Engine `eb777ab9570fad1c8301635617f0923f2b820424`, with zero full-context
requests. RTX 5090/4090 admit 131,072 context/C8. Laptop points are
131,072/C1, 117,760/C2, 31,744/C4 and 4,096/C7; laptop C8 remains a gap.
The laptop natural gate covers only the C4 configuration. Exact explicit
arenas, fixed DFlash7, INT8 KV, Text, graphs and 300 MiB reserve are preserved.

Acceptance: the existing supplied-catalog Host regression checks the signed
settings; focused tests, Host check/clippy and ONE `make verify` consume eleven
explicit inputs, producing exactly 48 profiles while preserving the prior 42
objects and four context lowerings. For private DEV, coordinate C7's idle and
zero-GET stop boundary, preserve generator/inputs/www/receipts, run the existing
generator once and restart unchanged srv.py. Require exact signed additions,
all 116 prior profiles and eight release records preserved, plus payload HEAD
and one-byte Range acceptance before C5's first-use download. No Engine gate,
payload mutation or new hardware qualification is assigned.

Candidate: `/ai/gchat-worktrees/gchat3-consumer-muse-profiles-20261018`, branch
`fix/gchat3-consumer-muse-profiles-20261018`, base `770f3c03d`. Small frozen
inputs and evidence: `/ai/gchat/out/consumer-muse-profiles-20261018/`.
The source change extends only the supplied-catalog regression in
`ginfer-host/src/launch_profiles.rs`; execution used independent S1 SSD copies under
`/media/ron/SSD_RAID/ai/tmp-gchat3-consumer-muse-profiles-tests-20261018`.
The inactive RC donor remains protected. Independent preparation started at
14:28:42 UTC, booking 3333 on CPUs 96–103 with the shared socket-1 compile
lock; the effective focused/check/clippy/ONE-verify command and eleven frozen
inputs were reviewed before launch. The focused supplied-catalog regression,
Host check and all-target clippy passed. The sole `make verify` stopped at
14:34 UTC after 3,630 app tests passed, six skipped and one unrelated Agent
Studio stage-ID typing test exceeded its existing five-second timeout
(5,361 ms); no assertion failure or OOM was reported. Booking 3333 returned
at 14:36 UTC. Source and eleven inputs remain frozen. Vitest emitted no
coverage reports after the failure. The bounded continuation passed that same
failed case unchanged (1,504 ms), regenerated missing critical coverage with
the six existing critical-flow test files and their two provider-store
consumers (109 passes), and passed the previously unrun extension coverage
(127), all six unchanged floors and Rust (1,308 passes, 28 ignored across
23 summaries). This gives 3,631 unique passing app tests and six skips; the
109 repeated coverage cases are not added to that total. No second full app
suite or `make verify`, timeout increase or source edit occurred. The original
command remains recorded as failed in `test-verify.log` and
`test-terminal-failure.json`; `test-result.json` records the successful bounded
continuation separately. Coordinator review checked the retained stage logs
and actual Rust summaries.
Parent owns DEV generator/input replacement and acceptance; C7 owns service
stop/start. Shared root is `/media/ron/SSD_RAID/ai/gchat-private-dev-catalog-v1`.
C7 stopped PID 1558479 at 14:29:52 UTC after all consumer-idle confirmations,
base hashes and a fresh zero-GET check, verifying PID and listener absent. The
prepared bounded generator/input replacement is staged at
`mirror-ready-muse-20261018`; its preserved base is the eight-package,
116-profile catalog (277,094 bytes, SHA-256
`2262186803e08a65d4fee4b99a8ba1f5e0ccbe87ef66b02a22c2bb5382a4931c`).
The existing generator ran once at 14:30:48 UTC, producing nine packages and
122 profiles (298,602 bytes, SHA-256
`19a1d986fc6ec1510ea78b9d340e006ff8179a16f8e6b0acc69c8e4af6154309`).
All 116 existing profile objects, eight release records and eight payload
symlink targets match the preserved base. All six new profiles exactly match
the signed source objects. The base is retained at
`mirror-before-muse-20261018T143048Z`; payloads were neither copied nor
rehashed and srv.py is unchanged. See `private-dev-deployment-result.json`.
C7 restarted unchanged srv.py at 14:31:22 UTC as PID 1854374. HTTP acceptance
passed at 14:31:45 UTC: catalog bytes match the generated output, all nine
payload routes return exact-length HEAD and one-byte Range (206), with nine
payload bytes read in total. See `private-dev-http-acceptance.json`. C5/C4/C7
received the stable acceptance and frozen eleven-input binding; consumers may
resume. There is no retained current DEV native app/inspector/XTest donor in
this lane or C7; the inactive RC dependency donor remains read-copy-safe.
C5's first-use DEV build is pinned to `770f3c03d`; the bound Muse gate uses
the `eb777` Engine requirement rather than the retained `e228` bootstrap.
C3's already assembled Linux RC remains frozen at `3e32`/`b26` with eight
inputs/42 profiles for its final installed defect acceptance. The Muse packet
is retained for its next refreshed consumer build, not retroactively included.
The actual staged release catalog is 109,527 bytes, SHA-256
`3db18a5713f3d66876c2951a49aeee27d8d7f1f83a54ac41af27c5e93ad308a0`.
Independent review confirmed the exact ordered eleven-input merge, all 42
prior profile objects unchanged and exactly six signed additions. The bounded
continuation terminated successfully at 14:46:34 UTC; booking 3342 returned
at 14:47 UTC. Source, all eleven input hashes and the staged output remained
unchanged after execution. See `catalog-staged-proof.json`,
`test-continuation-terminal.json` and `test-result.json`. The accepted frozen
inputs remain available to the next release build; no model or GPU gate was
run for this catalog-only change.
The owned S1 test root, its preparation log and both exited test containers
were removed at 14:52:20 UTC (29,850,680,192 logical bytes); the protected RC
donor and stable DEV service were untouched. Small input, generated-catalog
and raw-log evidence remains in the output folder. Ready for reviewed merge;
the next release refresh consumes the retained eleven-input packet.

## Host name save and refresh results, October 18 (Codex 7)

`GUI-HOST-NAME-SAVE-RESULT` preserves a successful Host rename when the
following registry refresh fails. The accepted name remains visible and Save
stays disabled for it, even with a stale snapshot. **Retry status** performs
only the read. A rejected save retains the draft with persistent plain retry
guidance and closed technical details. Save and status retry show pending
feedback and block duplicate submissions.

Both new failure regressions failed against the unchanged base. All eight
candidate rendered tests passed. Exactly one `make verify` passed lint (zero
errors, five existing unrelated warnings), TypeScript and quality/contract/asset
guards, then stopped at an unrelated Agent Studio five-second typing timeout:
3,659 app tests passed, one failed and six skipped. The unchanged failed case
passed its targeted continuation. Only the existing coverage prerequisites
(109 tests) and unexecuted extension (127 tests), six coverage floors and native
stages continued. Native results: 1,309 passed, zero failed, 28 ignored across
23 summaries. The original full-gate failure remains recorded; no timeout,
unrelated source or full gate was changed or repeated.

Candidate: `/ai/gchat-worktrees/c7-host-name-save-result-20261018`, branch
`fix/c7-host-name-save-result-20261018`, base `fe0630a14`. Source/test bindings
matched the executed copy after verification. S1 CPUs 104–111 returned
15:47 UTC, booking 3369 canceled. The owned SSD fixture and three exited
containers were removed (27,822,125,840 logical bytes); the dependency donor
was preserved. Small evidence: `out/c7-host-name-save-result-20261018/`.
No Host protocol, model, inference, native GUI rename or Windows qualification
is changed or claimed. Next: reviewed merge, then continue the owned GUI queue.
