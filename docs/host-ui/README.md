# GInfer host UI

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
source archive are retired. Existing private catalog baseline/dependency data
at `/media/ron/SSD_RAID/ai/tmp-c7-private-catalog-gate-20261017` remains retained
for that separate campaign; it has no live transfer-count job. Result JSON and
a short summary retain the gate outcome.

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
131,072. The provider/model regression calls the real provider discovery and
`DefaultModelsService.startModel`, asserting `max_context: 131072` reaches load.
Existing explicit context settings retain their meaning.

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

`GUI-DROPDOWN-THEME-CONSISTENCY-20261017` passes the shared Theme and Font
Size menu scope in retained Linux release `ed68c7443`. Real trusted keyboard
input opened the menus, selected Light/Dark and Medium/Large, closed with
Escape and moved focus with Tab. Visual inspection confirmed readable Geist
text and app colors in both themes; menu text followed Medium (14px) and
Large (15.75px). A rapid Escape/Tab/Enter sequence did not reach its intended
control and is excluded; separately observed Escape and Tab steps passed.

The serving-instance, launch-profile and Fleet-coordinator selectors remain
**unqualified**. The isolated profile has no connected Host inventory or paired
Fleet computer, so those controls were absent. Shared-menu acceptance does
not establish native HTML select popup rendering. The next required fixture
is an isolated profile with a real connected Host, multiple recorded instances,
launch inventory and a paired Fleet computer. No pairing, setup or model load
was performed. Windows and release-wide qualification remain outside this leaf.

The shared menu, Interface and CSS source is unchanged at main `29c301aeb`;
the affected Host/Fleet selectors retain the same styling and handlers. Source
fix `05669cea1` / merge `7ad61917c` and existing focused/full and CSS-render
gates are reused. This documentation-only result uses `git diff --check`.
Evidence is retained at
`out/c7-dropdown-installed-20261018/{result.json,summary.md}`.

S1 FRESH returned OFF with its original XML restored and verified. CPUs40–47
returned01:28Z. All private app/session and forwarding processes stopped by
recorded PID; the private guest copy/profile and S1 runtime root were removed.
The original fixture data and read-only release donor were preserved. No live
job or booking remains. C7 retains source worktree
`/ai/gchat-worktrees/c7-dropdown-installed-20261018`, branch
`test/c7-dropdown-installed-20261018`, and only the result JSON and short
summary as new local artifacts. The row stays open for the missing Host/Fleet
selector acceptance.

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
  then try again.' Not done: a maintenance-time out-of-space error is only logged, and the original exit was
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
