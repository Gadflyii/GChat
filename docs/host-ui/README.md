# GInfer host UI

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
The read-only RC donor remains intact. The source fix is ready for merge review.
Use independent copies of the inactive RC donor; retain only
`out/host-model-editor-save-result-20261018/test-result.json` and adjacent
summary after cleanup. No installed or Windows acceptance is claimed.

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
`63f9e8a49` is pushed. Arch signed the registry lifecycle (`7007c37fd`)
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
native processes stopped and CPUs64–71 returned07:03Z (build CPUs80–87
returned06:47Z). Inactive independent source/build/cache copies under
`/media/ron/SSD_RAID/ai/tmp-c3-reset-stale-host-connection-20261018` were retired
(31.82GB logical bytes). The tested candidate and required stopped resources
under `tmp-c3-first-user-setup-20261018` remain only until source merge, then
retire. Next: Bubbs merges the signed branch; C3 retires those owned copies.

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
Booking3051 CPUs80–87 returned05:53Z after the container and disposable local/
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
passed. ONE `make verify` passed on S1 CPUs80–87 (booking3025): 3,369 app tests
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

`GUI-SETTINGS-SUPPORT-LINK-404` is **WAITING ON RON** for the supported public
support destination. The private first-user walk opened Settings → Open an
issue through the native browser at `https://github.com/SectileLabs/gchat/issues`
and observed GitHub 404. OI110 designates the repository artifacts-only; no
replacement public issue URL has been supplied. The browser keyring prompt was
canceled without secrets, then the private browser received normal TERM.
Evidence: `out/c3-first-user-setup-20261018/private-browser-after-cancel.png`.

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
needed. Reuse the existing native 404 evidence; the URL is still unresolved.
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
is merge-ready for coordinator integration. Next: Ron chooses the supported
public support destination; do not claim that the 404 is fixed.
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

The native first-user walk uses main `201f46712` with a private first-run
profile. Scope: setup, Models, Downloads, Engine/Host settings, Hardware profile,
Fleet/connections and Settings, in narrow/wide windows and Light/Dark themes.
Real pointer/keyboard input exercises visible controls and wording. Reproducible
defects are recorded on `docs/open-work` and fixed in separate source branches.
Chat/agents belongs to Gchat 1 and Gbot to Gchat 2; existing GUI rows retain
their owners.

Acceptance: every requested control and sentence is exercised or its concrete
prerequisite is recorded. Each new source fix needs focused checks, one
`make verify` and native acceptance using its changed build. The baseline and
candidates use optimized bundled Vite frontends in debug Rust shells with custom
protocol. This is Linux source-native evidence; the requested installed-current-main
walk remains pending. GChat and Manager builds pass. The next private release
refresh will reuse the accepted Linux AppDir runtime closure without changing
Ron's installation or publishing packages; release performance is not claimed.
No model, hardware profile or GPU workload has run during the walk.

Three reproduced defects now have tested, merged source fixes:

- `GUI-SETUP-RUNTIME-INSTALL-PROGRESS`: Welcome's false connection failure after
  30 seconds and Hosts' unexplained disabled Refresh now follow native resource
  preparation state. The changed-source private launch retained preparation
  beyond 30 seconds, then connected its Host and cleared the message. Focused
  48 plus 3 resource-state cases and lint passed. The single `make verify`
  retained its network-none Fleet route failure; all seven original native
  commands passed in the routed, dependency-offline continuation, followed by
  the candidate build. Merge `ed40f2579` preserves both first-run suites
  (31 cases) and landed in main through `a7dadf6c2`.
- `GUI-HARDWARE-IDENTICAL-CARDS-COLLAPSED`: matching model/memory tuples no
  longer collapse the two physical S1 PRO 6000 cards. PCI identity reconciliation
  passes rendered/plugin checks and changed-source Hardware/System Monitor
  acceptance at wide and narrow sizes. The original single verify's stale-label
  failure and subsequent missing-PCI fixture compile failure remain retained;
  corrected focused and remaining native/build stages passed. Normal merge
  `8913bc14f` of main `394ba2f1f` was pushed, mailed and integrated through
  `ae6f5992f`. All 31 first-run cases pass after the merge; no full verify was
  repeated.
- `GUI-GINFER-SETTINGS-TOKEN-UNITS`: `293f49538` was pushed, mailed and merged
  through `22033ee11`. The two advanced descriptions now explain model tokens.
  Four focused rendered cases, lint, one complete `make verify` and the native build
  passed: 3,279 frontend cases, 121 extension cases, all six coverage floors and
  1,216 native cases (28 ignored). Real pointer input opened Advanced; both
  descriptions were readable in Light 1500×1000 and Dark 1024×740 with scrolling
  and no horizontal overflow. No setting values changed. The structural provider
  redesign remains a separate row.

Fix evidence is retained in
`out/c3-setup-runtime-progress-20261018/{runtime-progress-result.json,summary.md,merge-focused-result.json}`,
`out/c3-hardware-card-identity-20261018/{result.json,summary.md,merge-focused-result.json}`
and `out/c3-ginfer-token-units-20261018/{result.json,summary.md}`. The original
hardware incident is `out/c3-first-user-setup-20261018/hardware-result.json`.
Debug preparation duration is not a release speed claim.

Welcome → Choose a model navigated to Models and completed onboarding. Returning
to New Chat showed the expected unloaded-model composer; no inference was sent.
The separate retained preparing profile passed Welcome → Continue without
loading a model and reached the unloaded composer. A fresh native profile at
03:37:38Z also exercised Welcome → Connect a network host and reached Hosts
with address and secure-storage guidance; no pairing or credentials submitted.
Hosts Refresh returned to connected with its button enabled.

Models Installed/Recommended/Downloads, searches, card selection,
unavailable-model explanations and the idle Downloads popover were exercised.
Published releases have no qualified download descriptor, so no live download
is available. Private secure storage succeeded at 02:33:48Z with an unlocked
keyring. Settings exercised computer-name Save, data-path Copy, reset-dialog
Cancel by Enter, language list, empty-token Show/Hide, spellcheck/default-model
toggles and Interface font sizes/themes. Small, Medium, Large, Extra Large and
System/Light/Dark selections were readable; Medium was restored. Factory reset
and OS startup/CLI installation were not invoked.

Workspace connections connected its private account service and displayed the
Google guide through import/manual registration. Google/Microsoft service
checkboxes and Read only/Read write selections were restored. Actual account
import/sign-in requires owned credentials; credential-dependent leaves remain
with Gchat 3. The proxy remained off. An input-command mistake entered follow-on
command text into its private address field; that text was cleared, and all
four fields and proxy/certificate switches were verified empty/off. This was an
execution error, not a product defect.

The native data-folder and local-model import choosers opened on the verified
private GTK portal. Cancel preserved the data path and imported no model.
Installed is readable in Light and Downloads in Dark at 1024×740. Manager's
private window passed Pair → Check secure storage → Cancel and Secure storage
→ Check again → Cancel. Fleet and the coordinator dialog are reachable; pool,
assignment and enrollment actions require a configured instance/coordinator.
Manager is readable in Dark at 1500×1000 and 800×650 without horizontal overflow.
Show available downloads refreshed and reported no published package for this
GPU group. Sharing stayed off; Rename → Cancel preserved the private name.
Paired clients showed one local administrator and zero active requests. No
nearby Host was paired or changed. Model-dependent Manager actions remain gated
by an installed model and prepared hardware.

Settings → Open an issue launched the exact private browser at
`https://github.com/SectileLabs/gchat/issues`, which rendered GitHub 404. Current
main uses the same URL; OI110 designates the repository artifacts-only, and no
supported public issue URL is known. This is tracked separately as
`GUI-SETTINGS-SUPPORT-LINK-404`, **WAITING ON RON**. Bubbs confirmed that Ron
selects the public destination; unchanged URL constant `5b8cff5ae` merged through
`78ce5f45f`. Evidence:
`out/c3-first-user-setup-20261018/private-browser-after-cancel.png`. The private
browser keyring prompt was canceled without secrets, then the browser received
normal TERM.

The final control/theme/window matrix is retained in
`out/c3-first-user-setup-20261018/{result.json,summary.md}`. Conditional actions
requiring a published descriptor, installed model, owned account credentials,
prepared/booked GPU group or configured Fleet coordinator were not invoked.
General's OS autostart/CLI installation, destructive reset/relocation and
file-manager links remain unexercised. Existing reset regression and engine-settings
acceptance packets are retained under their own rows; this walk does not relabel
them as fresh execution. The updater 404 remains its existing separate row.

Downloads Manage is fixed in `f928613b1`, merged through `d4b0b9c8c`. Focused48,
lint, ONE verify, changed-source build and private native history/theme/layout
checks pass. See `out/c3-downloads-manage-tab-20261018/{result.json,native-result.json,summary.md}`.
The next defect is `GUI-DOWNLOADS-POPOVER-STATUS`: a paused journal entry is
presented as Downloading. Its source is prepared; focused/lint/ONE verify and
changed-source native acceptance come next. No real transfer or model is needed.

After that source fix merges, pin current main for a private release AppDir
refresh and finish the installed-build walk at the requested sizes/themes.
The accepted `ed68c7443` Linux release predates current GUI changes; its
GIO/Gbot/four-family Engine closure is a read-only donor, not current-main
evidence. Reuse approved `e2282c336` Engine payloads and existing release commands;
refresh the frontend/core/extensions, CLI/Host/app and bundled skills/catalogs.
Keep Cargo release settings unchanged. S1 has1.5TiB free; no duplicate Engine
build or package publication is needed. Conditional model/account/Fleet actions
retain their stated prerequisites. Support destination remains waiting on Ron.

Owner: Codex 3. Source `/ai/gchat-worktrees/c3-first-user-setup-20261018`, branch
`fix/c3-first-user-setup-20261018`; baseline `201f46712`. Private apps, Hosts and
services stopped; returned03:30Z. Displays and inspector forwards stopped; no
private mounts remain. Closed candidate binaries, source archives and private homes were removed
after evidence retention. The S1 root
`/media/ron/SSD_RAID/ai/tmp-c3-first-user-setup-20261018` retains `runnable`,
`gchat`, `native-target`, `cargo-home`, `yarn-cache`, resources and launch profiles
as the active next-fix stage, now exclusively assigned to the paused-status
gate/build. The stopped `downloads-home` is retained for that native check;
`downloads-manage-candidate` remains read-only until C4 finishes donor copying.
Manage apps/Host/display stopped and CPUs returned03:50Z; no GUI job remains. Dependency donor remains owned by
Claude at `tmp-claude-gchat-finish-20261017/tool-source` and is untouched. No
model/profile/GPU job ran in this walk.


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
Next: coordinator review and merge of source and native evidence together.

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

## Reading workspace folders

If GChat cannot read your workspace folder, the **Files** panel opens so you
can see the problem. Choose **Retry folder** to try again. You can close the
panel while you work; another failed check will not keep reopening it.

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

## Creating and editing skills

After you choose **Create** or **Save**, the button shows **Creating skill…**
or **Saving skill…** until the request finishes. Wait for the dialog to close
before using the saved skill. If saving fails, your entries stay in the dialog
and the button becomes available so you can try again.

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
