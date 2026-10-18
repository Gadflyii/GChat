# Chat and Agent runtime

General Agent dispatch from Chat is accepted for Linux: the native two-worker
fixture covers inherited policy, result collection, independent cancellation
and persisted reopening. Installed model-backed two-worker collection/reopen
and the corrected October 15 targeted Stop replay qualify those transitions
separately. The [acceptance record](remaining-acceptance.md#accepted-general-agent-dispatch-from-chat--october-15)
closes `GCHAT-CHAT-GENERAL-AGENT-DISPATCH`. OI-068 now has separate Linux passes for live-worker checkpoint continuity and
a correct eight-file task after compaction. The finished record also survives a
normal app exit/restart. Active-worker cancellation, durable state and ordinary
Studio reopening also pass after normal exit. Interrupted-run history now has a
[passing bounded invocation-loss regression](#interrupted-studio-run-history--october-16);
the [October 17 native desktop-death check](#native-desktop-process-death-and-new-run-continuation--october-17)
also passes incomplete-history discovery and explicitly approved new-run
continuation. A separate [idle Host termination check](#native-idle-host-termination-and-explicit-new-run-continuation--october-17)
passes Stop cancellation and explicit new-run recovery. An
[in-flight Engine-loss check](#native-in-flight-engine-loss-and-new-run-recovery--october-17)
passes visible failure and explicit restart/new-run recovery. The
[October 18 active Host-loss check](#native-active-host-loss-and-explicit-new-run-recovery--october-18)
also passes visible failure after abrupt Host death during inference, followed
by explicit same-profile restart and a distinct GUI run. Automatic resume,
broader crash recovery, power-loss recovery and Windows remain unqualified;
OI-068 remains PARTIAL.

## Unavailable assignment in run setup — October 18

An isolated native Linux **Re-run** pass at 1200×800 reproduced horizontal
overflow when the saved instance was unavailable. Its long assignment label
expanded the dialog's implicit grid column to about 836 pixels inside a
672-pixel dialog, clipping **Browse**, **Cancel** and **Run**. Editing the task,
cancelling and reopening restored the original task with the save-defaults
checkbox unchecked; the layout defect was separate. The affected setup, dialog,
choice and workspace components are unchanged from retained native source
`f1c7c73b0` through branch base `df96d39bd`.

Run setup now uses one grid column with a zero minimum width, allowing the
existing assignment-label truncation to constrain the content to the dialog.
The baseline used a private HOME/XDG, Xvfb, D-Bus and unlocked test keyring,
without a model or GPU. The viewed screenshot `reopened.png` and DOM bounds
(`setup-layout-rects`) are in
`/ai/gchat/out/gchat-agent-rerun-cancel-20261018/`.

All ten existing focused `AgentRunSetup` tests, one `make verify` and the
frontend/native builds passed on frozen source `2a3ff696b`. The full gate passed
3,397 app, 127 extension and 1,258 Rust tests (6 skipped, 28 ignored). The
corrected native replays at 1200×800 and 1024×740 both have matching 670-pixel
client and scroll widths. Browse, the assignment and footer controls fit
horizontally; ordinary vertical scrolling exposes the smaller-window footer.
The complete unavailable identifier remains in the selected-label title and
keyboard-opened menu. Cancel returns to history, with all 17 saved definition,
run/context and thread/session/message files byte-identical. The viewed
screenshots and receipts are in
`/ai/gchat/out/gchat-agent-run-setup-overflow-20261018/`. This qualifies the Linux
debug candidate; Windows not built (dev phase).

## Chat creation date during history actions — October 18

An isolated native Linux pass found that favoriting a saved chat, adding it to
a project, removing it and unfavoriting it overwrote its persisted creation
date with the update time. All messages and the other saved thread files were
unchanged. The affected service is identical between native source
`f1c7c73b0` and main `d4ec7abab`.

Thread updates now preserve the existing creation date and refresh only the
update date. All 23 focused tests passed, including a persisted favorite/project
roundtrip regression; the unchanged-source negative control failed that
regression as expected. One `make verify` passed on frozen source `40573bd8a`
(3,394 app, 127 extension and 1,252 Rust tests), followed by passing frontend
and native builds.

The corrected native replay favorited the chat, moved it into and out of a
project, opened its retained HTML preview and unfavorited it. All four updates
preserved `created` while advancing `updated`. The seven other saved
thread/message/session files remained byte-identical. The isolated HOME/XDG,
Xvfb, D-Bus and unlocked test-keyring replay used no model or GPU; CPUs were
returned at 06:04Z. Baseline evidence is in
`/ai/gchat/out/gchat-chat-project-membership-20261018/`; the fix packet is
`/ai/gchat/out/gchat-chat-created-timestamp-20261018/`. This is a Linux debug
desktop check; Windows was not built (dev phase), and installer behavior was
not checked.

## Chat search query selection — October 18

An isolated native Linux pass reproduced a stale keyboard selection when a new
search query returned the same number of chats. After selecting the second
match for `a`, replacing the query with `v` kept the second position selected
even though the matching chats changed. Enter opened that chat instead of the
first match. The Search dialog and sidebar are unchanged between the observed
native source `edcd74e49` and main `beee1f2f9`.

Search now resets selection when its items change and scrolls the selected
item into view when results change. Arrow navigation within the current results
is preserved. Three focused regressions, one `make verify`, the frontend build
and the native build passed on frozen source `3c0a8ba45`. The unchanged-source
negative control failed the selection regression as expected; its other two
tests passed.

The corrected native Linux replay selected the first `v` result after changing
an equal-count query, kept it visible, and opened the expected saved HTML chat
with Enter. Recent-chat reopening and Clear also passed. All eight saved
thread/session files were unchanged. Candidate SHA256:
`4b15c5a4df9fd73d581bb931f8de890a74e5425031c5306668315b5a08861e98`.
The isolated HOME/XDG, Xvfb, D-Bus and unlocked test-keyring replay used no model
or GPU; CPUs were returned at 04:55Z. Evidence is in
`/ai/gchat/out/gchat-chat-search-keyboard-20261018/`. This qualifies the Linux
debug desktop interaction; Windows was not built (dev phase), and installer
behavior was not checked.

## Archive OpenCode provisioning — C7, October 18

Codex 8's failed-setup P2 is corrected on
`fix/c7-opencode-atomic-install-20261018`, tested source `e9a5cac36` from
`e0a67a528`. Setup verifies a private temporary installation before publishing
its runtime and completion marker. Readiness ignores unpublished shims, permits
reinstall and retains native PATH fallback. Failed updates preserve the last
working managed copy. Arch signed this correction at 05:40:41Z.

The new readiness regression fails against the old runtime and all 30 candidate
focused library/CLI tests, Rust check and strict Clippy pass. The one
`make verify` invocation passed frontend/coverage but stopped on a fixture
requiring a network route. A continuation also exposed an empty CUDA mask
excluding a synthetic GPU. Both exact fixtures and every unreached Rust suite
passed with private bridge networking and CUDA visibility unset. Source and
assertions were unchanged, successful stages were not repeated, and the
original `make verify` exit 2 remains recorded. Completed scope: 3,382 frontend,
127 extension and 1,251 Rust tests passed; six frontend skips and 28 Rust ignores.
Future private test containers must retain those fixture-compatible settings.

The [result](../../out/c7-opencode-atomic-install-20261018/result.json) records
both environment corrections and the passing stages. This is Linux CPU-only
acceptance; Windows filesystem execution and native GUI replay were not run.
C7 retains the source worktree and concise result. CPUs were returned at 06:01Z;
the private 20-GiB S1 build/cache and stopped containers were removed at 06:03Z
after result inspection. Raw logs were discarded; the concise JSON is retained.
Downloads native acceptance resumes after this priority handoff.

`GUI-FIRST-USER-OPENCODE-PROVISIONING` is implemented on
`fix/c7-opencode-private-prefix-20261018`, source `13125b2ab` from main
`d31e328d6`. Clean archive startup previously ran a global npm installation and
failed with EACCES creating `/usr/local/lib/node_modules`. C3's original npm
receipt and donor remain read-only. A private native baseline reproduced the
same failure using a denied global prefix inside disposable app data.

OpenCode installs with `--global=false` into a temporary prefix inside
`<selected-data>/code/opencode/`, with cache at
`<selected-data>/code/opencode/npm-cache`. After npm and runtime verification,
the complete directory and its verification marker are renamed to
`<selected-data>/code/opencode/runtime`. One resolver chooses custom, verified
managed, then native executables for readiness, embedded/external launch, CLI
and offline session deletion. Unmarked leftovers remain eligible for repair
and cannot hide a native PATH installation. Existing sessions retain their
executable. Managed updates use the same staging and publication path; external
updates show the installation's own command and
offer explicit **Use managed copy**. Missing or broken Node/npm asks the user to
install Node.js LTS. GChat does not install system tools for OpenCode. Arch
[signed this design](../decisions/2026-10-18-install-managed-opencode-in-the-gchat-data-folder.md)
at 04:58:46Z.

Frozen source passed 39 focused frontend and 32 focused Rust tests, Rust check
and strict Clippy. The single `make verify` passed at 05:24:32Z: 3,367 app,
121 extension and 1,241 Rust tests passed, with six app skips and 28 Rust
ignores; lint, types, quality guards and coverage floors passed. Frontend and
desktop builds passed. CLI-only check/Clippy explicitly select the library and
`gchat-cli`; the desktop builds separately with normal features.

The clean native Linux replay automatically installed real OpenCode 1.19.3
inside its private data folder while OpenCode was absent from the launch PATH.
The Code page recognized the installed program and asked for a model to be
selected. The denied global prefix stayed empty. Screenshots and concise
receipts are in the [same-branch evidence](../../out/c7-opencode-private-prefix-20261018/result.json).
This qualifies the Linux debug archive-style provisioning path. Model-backed
Code sessions, installer packaging and Windows are outside this acceptance;
no model or GPU was used and no installed user profile was touched.

C7 retains this source worktree and concise evidence. All private fixture
processes stopped and CPUs were returned at 05:31Z. The 25-GiB S1 build, cache
and profile root `/media/ron/SSD_RAID/ai/tmp-c7-ginfer-settings-owner-20261018`
was removed at 05:33Z after checking for live users and mounts. C3's fixture and
the retained ed68 resource donor remain unchanged.

## First-use duplicate agent names — October 17

An isolated native Linux pass of main `9e75fc31e` reproduced silent replacement:
creating two new agents named Travel Helper generated `travel-helper` for both,
and saving the second replaced the first. New agents now receive an unused
identifier (`travel-helper-2`, then the next available suffix). Generated IDs also
avoid reserved `general` and use `agent` when the name has no ASCII slug. Saving
an existing agent retains its identifier; a blank name requires correction.

The pass used a private HOME/XDG profile, unlocked test keyring, authenticated
Xvfb and D-Bus session on S1; it did not touch an installed user profile. The
focused Agent Studio suite passed 39 tests. `make verify` passed lint, types,
quality/coverage gates, all JavaScript tests, main Rust and Host suites, then
failed the unrelated Gbot SSH fixture shutdown assertion at
`tests/ssh_loopback.rs:1279`. That exact test passed its single retry; the skipped
Gbot doc, hardware and utilities suites passed separately. The native candidate
built successfully. Its native replay preserved both Travel Helper agents with
distinct IDs and descriptions; renaming the second retained `travel-helper-2`.
The baseline also completed a real chat, contextual follow-up and one-step saved
agent Reply on a private Qwen3.8-27B NVFP4 artifact; completed run history
reopened after app restart. Artifact staging was a retained-fixture copy, not
an import/download qualification. GPU0 was stopped and returned at 23:56:52Z.
Evidence:
`/ai/gchat/out/gchat1-chat-agents-pass-20261017/` (launch receipt, duplicate-name
screenshot and gate receipts). This is a debug desktop check, not installer or
Windows qualification.

## Typing an agent identifier — October 18

An isolated native Linux Studio pass reproduced the main **Identifier** field
dropping a hyphen during ordinary typing: `keyboard-helper` became
`keyboardhelper`, in both an existing draft and a new agent. Focus remained in
the field. The affected editor is byte-identical from retained native source
`edcd74e49` through main `25459ffc2`.

The field now retains a trailing separator while editing and normalizes it on
blur, matching the role identifier controls. Native baseline DOM captures and
the viewed screenshot are in
`/ai/gchat/out/gchat-agent-identifier-keyboard-20261018/`.
The focused Studio suite passed 65 tests; the sole `make verify`, frontend
build and native build passed on frozen source `6e6286019`. The first native
build linked a stale Host dependency and stopped on missing imports. A bounded
native-only recovery refreshed two staged source timestamps; all 3,151 frozen
source hashes remained unchanged, and the rebuilt Host resolved both imports.

The corrected native replay retained `keyboard-helper` and focus in both new
and existing drafts, kept a trailing `-` while editing, and normalized it on
Tab. Save and reselect preserved the identifier. All ten prior definitions were
unchanged; only the private `IdentifierKeyboardProbe` fixture was added.
Candidate SHA256 is
`651c447194dcefdb12bd601c7fecbc7c37ec34465072f3807762151b54e8543c`.
Both passes used a private HOME/XDG profile, authenticated Xvfb, D-Bus and an
unlocked test keyring, with no model or GPU request. The corrected screenshot
was viewed and CPUs were returned at 05:08Z. This qualifies the Linux debug
editor interaction; installer behavior was not checked.
Windows: not built (dev phase).

## Required numeric keyboard editing — October 18

An isolated native Linux Studio pass reproduced a leading zero while replacing
required numeric values. Clearing **Maximum tool steps** immediately inserted
`0`, so typing `12` displayed `012`. Goal Loop **Maximum cycles** similarly
showed `04`. Saving and reselecting the tool-step limit correctly retained `12`;
the defect affects editing rather than stored numeric values. The affected
editor is unchanged from native source `6e6286019` through main `b9a56c96c`.
The viewed screenshot, DOM captures and stopped private session are in
`/ai/gchat/out/gchat-agent-numeric-editing-20261018/`.

The required tool-step, cycle, parallel-worker and role-step controls retain
blank text while editing and normalize on blur. Their numeric validation and
saved contract remain unchanged. The optional output budget retains its Auto
behavior. Five regressions cover clear/type/save, blur normalization, role
limits, external clamping and selecting another saved agent. The focused Studio
suite passed all 70 tests on frozen source `f1c7c73b0`; the unchanged-source
negative control failed the four clear-edit cases as expected. The initial
focused run stopped on four leading-zero assertions caused by the test driver's
number-input coercion. Those raw-value events now use `fireEvent.change`;
ordinary keyboard interactions remain covered by `userEvent`.

The first `make verify` stopped at typecheck because the retained staging folder
contained two settings files deleted from the frozen source. Removing only
those two stale scratch files restored the exact 3,220-file source manifest.
The clean-staging `make verify` passed: 3,374 root/web tests, 127 extension tests
and 1,229 Rust tests, with six JavaScript skips and 28 Rust ignores. The focused
suite and negative control were not repeated during this environment recovery.
The frontend and native builds passed. The corrected native replay kept all
four required controls blank when cleared, accepted replacement values, and
normalized native `04` and `09` to `4` and `9` on Tab. Save and reselect preserved
the workflow stage’s `9` steps; clearing the optional output budget reopened as
Auto. The eleven other definitions were unchanged. The corrected screenshot
was viewed; the private app stopped and CPUs returned at 05:39Z. Candidate
SHA256 is
`ab6efa376859b0ac417b41963ad72a29e42c8554d1fb57f3eb1a9d68c688166f`.
Evidence is in `/ai/gchat/out/gchat-agent-numeric-keyboard-20261018/`.
The later main merge did not change the tested editor or regression file.
This qualifies the frozen Linux debug candidate’s editor interaction; no model
or agent run was requested.
Windows: not built (dev phase).

## Skill slash-menu keyboard visibility — October 18

An isolated native Linux Chat pass qualified the pending keyboard interaction
for `GCHAT-SKILL-SLASH-KEYBOARD-VISIBILITY-20261017`. With 24 enabled private
`keyboard-01` through `keyboard-24` skills, Up/Down wrapped between the first
and last entries while keeping the selection visible. Twelve Down presses
selected `keyboard-13` fully inside the scrolled menu. Filtering to
`/keyboard-2` selected `keyboard-20` among five matches; adding `4` selected
the sole `keyboard-24` match. Composer focus remained intact. Tab inserted the
inline `/keyboard-24` token; Backspace removed it from the empty composer.
Backspace after a bare `/` closed the menu, and Escape closed the menu while
preserving the typed query. The private draft was cleared without sending.

The original source stack `4d60afdf1`, merged by `5d153ae12`, passed 62 focused
tests and one cumulative `make verify`; those existing receipts remain in
`/ai/gchat/out/skill-slash-keyboard-visibility-20261017/result.json`.
The native pass used retained binary source `edcd74e49`, SHA256
`bba3976355aca7a8c8721866f2eb5f3376be33181ae067dc12e4efb82d1a63be`.
Its four slash-menu surfaces are byte-identical through `59dfad250`.
Native DOM receipts, the viewed scrolling screenshot and the stopped-session
record are in `/ai/gchat/out/gchat-skill-slash-native-20261018/`. This qualifies
the Linux debug interaction with retained sidecars and a private HOME/XDG,
Xvfb, D-Bus and unlocked test keyring. No model or GPU was used; CPU resources
were returned at 04:44Z. Installer behavior was not checked.
Windows: not built (dev phase).

## Adding roles after removal — October 18

An isolated native Linux Studio pass reproduced duplicate generated IDs after
removing a middle role and adding another: `deliver, stage-2, stage-3` became
`deliver, stage-3, stage-3`, and the workflow could not save. Coordinator Team
specialists reproduced the same collision with `specialist-3`. Both Add handlers
are unchanged between native source `a7debe294` and main `bca080b71`.

Add stage and Add specialist now advance past IDs already in the current draft,
including manually renamed IDs. Existing role IDs and workflow handoffs remain
unchanged. Four rendered regressions cover middle removal and manual collisions
for both kinds. The focused Studio suite passed 63 tests; one `make verify`,
frontend build and native build passed on frozen source `edcd74e49`.

Native Linux replay created `stage-4` / `specialist-4` after middle removal,
then skipped manually occupied `*-4` IDs to create `stage-5` / `specialist-5`.
Both definitions saved and reselected with the expected IDs; the workflow
retained both handoff edges, and all eight prior definitions were unchanged.
The candidate SHA256 is
`bba3976355aca7a8c8721866f2eb5f3376be33181ae067dc12e4efb82d1a63be`.
The private HOME/XDG, Xvfb, D-Bus and unlocked test keyring replay used no model
or GPU and returned CPUs at 04:32Z. Evidence is in
`/ai/gchat/out/gchat-appended-role-identifiers-20261018/`.
This qualifies the Linux debug desktop interaction; Windows was not built
(dev phase), and installer behavior was not checked.

## Workflow dependency keyboard entry — October 18

An isolated native Linux Studio pass reproduced a dependency editor that removed
commas and separators during typing: entering `deliver, stage-2` produced
`deliverstage2`. The affected Workflow editor is byte-identical between observed
candidate source `3818d7a2` and main `548d73ed8`.

The correction keeps the typed dependency text until blur and updates canonical
workflow edges on every edit, so saving uses the current dependencies. External
stage renames, removals and workflow selection refresh the displayed values.
Rendered regressions cover per-character punctuation and focus, blur formatting,
exact saved edges, removal and selection. The revised focused suite passed 52
tests; its sole `make verify`, frontend build and native build passed. The first
coverage attempt timed out the new test; the revised test uses a direct fixture
and fewer repeated queries, retaining the unchanged five-second limit. The typing
case then took 1.32 seconds under coverage.

Native Linux replay retained `deliver, stage-2` and focus, saved both expected
edges while the field was focused, and preserved a trailing `-` until Tab.
Renaming the upstream stage refreshed the dependent field; removing the first
stage, saving and reselecting the workflow retained only
`research-stage` → `stage-3`. All seven existing definitions remained unchanged.
Candidate SHA256 is
`b5ece4cc00fd09d6fcb2d380ac65cd9777c0525a1b2b89d95313de9a4a0d3162`
(source `a7debe294`). Main `3bbea776c` was subsequently merged without conflicts;
the corrected dependency input remained byte-identical, and all 59 composed
Agent Studio tests passed. The native binary predates that merge.

Baseline, gate, native DOM and saved-definition receipts, plus the viewed typing
screenshot, are in `/ai/gchat/out/gchat-workflow-dependency-keyboard-20261018/`.
This is an isolated Linux debug editor check with retained sidecars and no GPU or
model request. CPU resources were returned at 04:15Z.
Windows: not built (dev phase).

## Untouched Coordinator Team defaults — October 18

An isolated native Linux Studio pass found that **New agent** → **Coordinator
Team** created one `researcher` specialist but set **Maximum parallel workers**
to 2. Selecting **Save definition** without editing these defaults displayed
“Coordinator parallelism must be between 1 and the worker count.” The affected
`withKind` helper was byte-identical from observed role-ID candidate
`26608cb72d2f` (base `80424bb41`) through main `ff3361720`.

New Coordinator Teams now start at parallelism 1. Native replay saved the
untouched definition with one `researcher` and `maxParallel: 1`. Adding a second
specialist, typing 2 in **Maximum parallel workers**, and saving retained
`researcher`, `specialist-2`, and `maxParallel: 2`. Existing definitions were
preserved. The focused suite passed 49 tests; the sole `make verify`, frontend
build and native build passed. Candidate SHA256 is
`939d6296703854ade1633f84aa86fd2871f6b15b74eff73685ac10b3932f241c`
(source `3818d7a2`).

Baseline receipts, native DOM captures, saved-definition snapshots and the
accepted two-specialist screenshot are in
`/ai/gchat/out/gchat-coordinator-default-parallelism-20261018/`. This is an
isolated Linux debug editor check with retained sidecars and no GPU or model
request. CPU resources were returned at 03:54Z. Windows: not built (dev phase).

## Role identifiers retain keyboard focus — October 18

An isolated native Linux Studio pass found that typing `review-stage` into a
Workflow **Stage ID**, or `risk-reviewer` into a Coordinator **Specialist ID**,
retained only the first `r` and moved focus to the page body. After refocusing,
a trailing minus was discarded even while the input retained focus. The affected
slug helper and role editors are byte-identical from the observed identifier
candidate (`2264e2200f`, source `e2ff6de49`) through main `80424bb41`.

The correction preserves focus as role IDs change, retains a trailing separator
during typing, and normalizes on blur. Native Linux replay typed `review-stage`
with ordinary keyboard input while retaining the same Stage ID control; adding
`-` preserved it until Tab. The dependent stage followed both edits, and saving
retained `review-stage` → `stage-2`. Coordinator replay likewise retained focus
for `risk-reviewer`, preserved its trailing `-` until Tab, and saved it alongside
`specialist-2`. Removing the first worker showed the remaining worker's own ID;
renaming it to `evidence-reader` with display name `EvidenceReader` saved only
that worker with maximum parallelism 1.

The focused suite passed 48 tests; the sole `make verify`, frontend build and
native build passed. Candidate SHA256 is
`26608cb72d2f4b27b6b3f5586388022f114693c3b39b8003d57e6f64e63151c5`
(base `80424bb41` plus this correction). Evidence and the viewed workflow and
specialist screenshots are in
`/ai/gchat/out/gchat-role-id-keyboard-20261018/`. This is an isolated Linux debug
editor check with retained sidecars and no GPU or model requests, not a full
sidecar rebuild or installer qualification. Windows: not built (dev phase).

## Uncollected Chat worker history — October 18

A worker dispatched through Chat's `agent_spawn` could disappear from its
parent conversation after a cold desktop restart if its result had not been
collected. Saved spawn responses now retain run attribution;
reopening also recognizes the raw spawn identity saved by earlier versions and
reconciles that referenced worker with its durable runtime outcome. A saved
outcome takes precedence over stale live progress, unrelated runs are excluded,
and collected detailed results remain intact. An incomplete run without a
recorded finish reason displays **Run interrupted** with an expandable
explanation, including when no tool or stage completed.

The isolated S1 reproduction used a private profile and a real Chat-dispatched
Qwen3.8-27B NVFP4 worker (artifact SHA256
`4689bdc908d989170106b07e91d81e0898bfe5c5e2cca98ae1d7350276d715a6`)
paused at an `os.fs.read` folder-access request. X11
window destruction produced a GDK BadDrawable exit; cold process restart then
reproduced the missing card. This was not a graceful-close check. GPU1 was
returned at 01:55Z; candidate history reopening uses the saved fixture without
inference. No continuation or automatic replay is qualified by this check.
Evidence: `/ai/gchat/out/gchat-spawn-history-20261018/` (saved baseline history,
native DOM captures, screenshots and candidate gate/build receipts).

The corrected candidate passed 31 focused tests, `make verify`, and the native
build. Native reopening displayed one **Run interrupted** card, retained the
worker ID and parent reply, and expanded to the saved-work explanation. No
active indicator, Stop worker or stale approval control remained. The first
candidate exposed only a duration and was rejected before this correction.
Windows: not built (dev phase).

A follow-up native pass found that leaving Chat for Studio and returning to the
cached conversation changed **Run interrupted** back to **Working...** with a
Stop worker control. The saved outcome lived only in the destroyed Chat route,
while the conversation cache retained the original running spawn response.
Referenced durable outcomes now share that conversation cache and are discarded
when its session is removed or cleared. The regression checks cached reopening,
isolation from another conversation, and session removal/clearing.
Native Linux replay passed cold open, Studio continuation setup/cancel, and
switching conversations: one **Run interrupted** card, the retained reply and
worker ID, no Working/Stop or approval controls, and the saved-work explanation.
Focused tests passed 24/24 and the sole `make verify` passed; the rebuilt native
candidate and evidence are in
`/ai/gchat/out/gchat-worker-history-navigation-20261018/`. No inference or new-run
execution was qualified by this replay. Windows: not built (dev phase).

## Client tools and native request capability errors — release scope

Inference-server hosted retrieval, `file_search`, `web_search` and MCP are
unsupported. Unsupported tool, input-content and output-format declarations
return an explicit error; adapters must not remove them and continue generation.
GChat client tools execute separately from unsupported inference-server hosted
tools. The Linux release includes trusted static-credential MCP, web search/fetch
and local file search, with the qualifications below. OAuth MCP and semantic
indexed RAG are post-release. These are native Linux development qualifications;
Windows and installer qualification remain separate.

The Linux release includes
trusted STDIO and HTTP/SSE connectors with static credentials. Linux native
development GUI checks pass with real servers: discovery, approval and denial,
disabled-tool enforcement, invocation, Stop cancellation and saved configuration
across normal app restart. The shared Chat executor drives these model-free
checks; model-led tool selection and installer qualification are separate.
OAuth MCP is post-release. Configured connectors
execute client function tools through the shared approval and cancellation
executor. STDIO servers run with the user's permissions, and saved environment
variables and headers are plaintext configuration, not a credential vault.
See the [MCP setup guide](../src/pages/docs/desktop/integrations/mcp-servers.mdx)
for the current GUI and trust boundaries.

The Linux release includes native `os.web.search` and
`os.web.fetch` from ordinary Chat and saved Standard Agents. The globe controls
both tools and persists their thread setting; availability reflects the selected
model and native catalog. Real-network primary Exa search/page reading and an
induced Exa transport failure with DuckDuckGo search/direct-HTTP page reading
pass in both. A missing public page returns HTTP 404 and an honest Chat error.
Agent Network Ask approval, denial, Network Block, public-address rejection
and in-flight Stop are checked separately. Regression checks cover cancellation
before fallback. Direct connections retain all validated DNS addresses. Initial fetch targets are validated before Exa; redirects
followed by hosted extraction remain outside local visibility. These are native
Linux development checks; Windows and installer qualification are separate.
Evidence: `/ai/gchat/out/web-search-qualify-20261015/{result.json,summary.md}`.

The Linux release includes client-side direct
PDF/DOCX/spreadsheet text extraction, filename globbing and raw-text grep through
`gchat-native` tools. It uses the shared Chat/Agent executor and workspace folder
permissions; an outside-folder Allow grants the displayed folder **CAN EDIT**
access. Short text PDFs are valid; textless PDFs explicitly require unsupported
OCR. Malformed DOCX and unreadable worksheets or directory traversal return
errors rather than silently reporting partial success. Native reads cap returned
text, but document parsing still reads the full input and does not immediately
observe cancellation. Pending permission requests can be cancelled with Stop.
Semantic indexed retrieval/RAG is post-release and remains unavailable without embeddings. See the
[file guide](../src/pages/docs/desktop/file-upload.mdx) for Auto references,
inline fallback, disabled tools and privacy boundaries. Model-led answers and
installer qualification are separate from model-free native GUI checks.

Native tool discovery does not wait for Gbot's bundled-resource installation.
While installation is pending, the catalog includes native tools and available
MCP tools; Google Workspace and Microsoft 365 connector tools remain withheld.
Installation completion refreshes the catalog so connected-account tools become
available without restarting the app. Resource failures remain explicit, and
connector execution still checks service readiness and account authorization.

The Host checks unsupported hosted-tool and output declarations for Manager,
standalone and registered GChat instances. Native engine validation owns the
supported protocol schemas and structured-output settings. Legacy Responses
translation rejects inputs and controls it cannot represent. Native Messages
errors are returned unchanged; remote Messages translation is attempted only
when the provider lacks that endpoint (HTTP 404/405), and rejects unsupported
capabilities before issuing a translated request. Remote native passthrough
retains the provider's own capabilities and errors.

## Native near-full-input task — October 15

One native Standard Agent run passes with 241364 counted input tokens at C1,
context 262144, High reasoning, Auto output and the default 25 decisions. It
returns the three embedded archive codes exactly in one Reply decision, with
20480 tokens reserved and zero compactions. Engine and durable history agree on
241364 prefilled and 183 generated tokens. Ordinary saved-run selection reopens
the exact reply, completed stage and metrics; live Context/Working evidence and
the full semantic transcript are retained separately.

This uses S1 GPU0, an RTX PRO 6000 Blackwell Workstation Edition, and Qwen 27B
NVFP4 package SHA `4689bdc908d989170106b07e91d81e0898bfe5c5e2cca98ae1d7350276d715a6`,
with speculation disabled and structured outputs enabled. Normal UI Stop leaves
the engine absent; the owned Host and guard then exit, with compute empty and the
GPU lock released. The private desktop closes normally and its resources are
released. This qualifies measured near-full input; literal 262144-token input,
full reserved output, fresh-install, Hermes, Windows and broader crash recovery remain
unqualified, so OI-068 remains PARTIAL.
[Exact recipe and evidence](remaining-acceptance.md#oi-068-native-near-full-input-task--october-15).

## Native near-full-context startup — October 15

The local RTX 5090 native full-input gate failed before Ready with both packaged
Engine `9f8fb8ff9` and current Engine `5af502f1` while Host supplied a historical
explicit KV arena. Normal Host Stop completed for both attempts. Host source
`93143951d`, merged on `16a338aff`, now quotes current startup settings. The
merged Host (SHA `d4863c80…`) passes one standalone native Host/Manager API startup
with Engine `5af502f1` and an effective 7080309760-byte KV arena while saved state
keeps Automatic. C1, context 262144, structured outputs and 524288000-byte headroom
are unchanged. The observed quote and serving arguments match; normal session-bound
Host Stop leaves zero active requests, owned processes absent and locks released.
The engine reports maximum request context 261632, below configured 262144.

Ada's installed UI startup and normal Stop pass separately with production Host
`93143951d` (SHA `66caef75…`), Engine `5af502f1`, C1, context 149069, structured
outputs off, 314572800-byte headroom and effective KV 4695700992. Saved state keeps
Automatic after catalog reselection. Its engine reports maximum request context
132096, below configured 149069. This is a frozen installed DEB with isolated
Host/runtime replacements; the owned fixture and resources are released.

Production implementation is unchanged by fixture corrections. `611fc26e9` passes all
11 plugin tests; `7d92bad30` passes the complete 172-test Host suite after a further
client-fixture correction. The composed Linux source gate passes using those
reruns and the retained passing checks of unchanged production source. These
startup receipts establish Ready and normal Stop. The later near-full-input task
above separately qualifies counting and inference; fresh-install acceptance
remains separate and OI-068 remains PARTIAL.
[Exact scope and retained evidence](remaining-acceptance.md#oi-068-native-near-full-context-startup--october-15).

## Linux Hermes home override — October 15

GChat previously ignored a nonempty `HERMES_HOME` on Linux while the Hermes
child inherited it. Setup, reset, readiness, skins and updates could therefore
use `~/.hermes` while Hermes used the selected home. The shared resolver now
honors that override; absent or empty overrides retain the existing default,
and Windows registry precedence is unchanged.

The regression checks configure and clear against the selected home, preserving
the other home's files, with child-only environment settings. Native checking,
strict Clippy and `make verify` pass, including that regression. Actual Hermes
inference, tools and continuation remain deferred;
this change does not provision Hermes or qualify its installed walkthrough.
[Scope and remaining acceptance](remaining-acceptance.md#oi-068-linux-hermes-home-override--october-15).

## Agent Studio minimum-window layout — October 17

The isolated native GUI pass on `9e75fc31e` reproduced a clipped execution
inspector and Save controls at the supported minimum window size, 1024 × 740.
The 240 px navigation sidebar leaves 784 px, while the Studio columns required
890 px. Evidence: `/ai/gchat/out/gchat1-chat-agents-pass-20261017/05-editor-minimum-clipped.png`.
The pass used a private HOME, private mode-700 runtime directory, its own
DBus/keyring and X display, with `WAYLAND_DISPLAY` unset.

The candidate changes four CSS class strings: the grid uses 180/360-minimum/240 px
columns below 1100 px viewport width and 220/360-minimum/260 px from 1100 px;
the existing extra-large columns remain. The grid and its three children gain
`min-w-0`. This preserves the editor's 360 px minimum while fitting the inspector.
The isolated branch is based on `fee25e419`; changes after the reproduced main
revision were documentation-only and the Agent Studio source was identical.

`git diff --check`, focused lint and all 35 Agent Studio tests pass. The full
`make verify` passes, including JavaScript coverage and the platform Rust suites.
The separate native candidate passes at 1024 × 740 and 1200 × 800. The page has
no horizontal overflow at either size. At minimum size, ordinary vertical
scrolling exposes the complete Save controls (right edge 1008 px); saving
reports success. The preserved agents and descriptions remain readable.
Screenshots `11`–`13`, gate logs and candidate receipts are retained in
`/ai/gchat/out/gchat1-chat-agents-pass-20261017`. This qualifies the Linux debug
desktop layout; installer and Windows qualification remain separate.

## Studio drafts preserve saved agent identity — October 18

A private native pass saved “Control probe A”, created a new “Control probe B”
and entered A’s identifier in B’s Identifier field. The unsaved draft incorrectly
offered Delete, and Save definition silently replaced A. The baseline screenshot
and ordinary-input transcript are retained in
`/ai/gchat/out/gchat-chat-agent-controls-20261018/`.

The editor now keeps the saved record identity separate from the editable
identifier. A new or copied draft remains Discard, and saving an identifier used
by another saved agent reports a collision before changing any definition or
opening run setup. Delete on an edited saved agent targets that original record.
The focused Agent Studio file passes all 44 tests, and one full `make verify`
passes (3283 web tests, six skipped; 121 extension/core tests; platform Rust
suites, lint, typecheck, quality guards and coverage floors).

The separate Linux native candidate passes the original collision flow. Both
Save definition and Save & run show the correction message while preserving A
and the unsaved B draft; run setup does not open. Changing B to an unused
identifier saves both agents. Editing saved B to A’s identifier and choosing
Delete removes original B while preserving A’s identifier and name. The new
draft offers Discard throughout the collision. Ordinary-input transcripts,
viewed screenshots and saved definitions are retained in
`/ai/gchat/out/gchat-agent-identifier-collision-20261018/`.

The desktop was rebuilt from `dd064f1d5` plus this correction; its SHA-256 is
`2264e2200faf1f341b84ff4009eeae2a17d88f26e9051db8c09dde91b2214a31`.
Retained sidecars were not rebuilt, so this qualifies the Studio controls only.
No model requests or GPU use. Windows not built (dev phase).

## Studio run selection starts at its overview — October 18

In the native 1024 × 740 pass with the sidebar expanded, reading the bottom of a
finished run and selecting a failed run retained the previous 430 px scroll
position. The selected run’s result overview and continuation controls were above
the visible pane. The details pane now starts at the top when the selected saved
run changes. Selecting records does not change their saved contents.

The regression selects another run after scrolling, then returns to the original
and checks each new selection starts at its result overview. All 40 focused
Studio tests passed. The isolated native candidate passed finished, failed and
incomplete saved-run transitions at 1024 × 740, plus a larger 1200 × 800 replay:
each selection opened at scrollTop 0 with its overview and actions visible and
no horizontal overflow. No inference or continuation execution occurred.

Full `make verify` passed on the combined branch after merging the setup polling
test reconciliation and current main. The original failed gate remains in the
packet. The native replay used the earlier candidate with identical scroll
implementation and regression bytes; no new desktop build was needed.
Evidence and gate results:
`/ai/gchat/out/gchat-run-selection-scroll-20261018/`. Windows not built (dev phase).

## Studio worker exit persistence — October 15

Normal app exit now tracks direct Studio turns alongside Chat and Code workers,
closes admission and cancels active turns before model teardown. The shared
shutdown waits up to 15 seconds for their run records, semantic sessions and
pending-request cleanup. Factory reset uses this same admission fence and drain
before hiding windows, stopping model/MCP dependencies or deleting data. Unlike
ordinary best-effort exit, a reset timeout returns an error and preserves data
and dependencies; admission stays closed while unfinished cleanup drains. A
closed Studio event channel during exit no longer changes a cancelled run into
failed history.
The active-shell and drain-timeout reset regressions and full gate pass;
[reset verification](../host-ui/README.md#factory-reset-drains-active-agents--c3-october-18)
records their scope and retained evidence.

The existing mock-app, TestFleet and scripted-engine regression checks an
active Studio turn through a completed file read, pending approval, window-channel
closure, cancelled persistence and fresh-app reopening without replay. One native
Standard Agent also read a file and reached shell approval before normal window
Close. The cancelled record, original task and completed read survived same-data
relaunch and ordinary Studio Runs reopening; the unapproved command never ran.
The separate [October 17 desktop-death check](#native-desktop-process-death-and-new-run-continuation--october-17)
passes its bounded scope, as do the idle Host termination, in-flight Engine-loss
and [active Host-loss checks](#native-active-host-loss-and-explicit-new-run-recovery--october-18)
below. Automatic resume and power-loss recovery remain unqualified.
[Evidence and remaining scope](remaining-acceptance.md#oi-068-studio-worker-exit-persistence--october-15).

## Interrupted Studio run history — October 16

Studio now saves an admission record after preflight and session loading, before
model or tool execution. It keeps the existing run-history schema 3 and records
the task, workspace and archive location. A terminal result replaces the same
record. Active records stay out of saved history and cannot be deleted or pruned
while their invocation is still completing persistence and cleanup; retention
keeps the newest 100 inactive records in addition to active records.

When fresh application state finds an admission without a recorded completion,
it appears as incomplete history. Its warning asks the user to inspect saved run
files and verify completed work before continuing as a new run. The saved archive
location provides access to any outputs already written. Continue as new run
creates fresh run and session identities; execution, pending approvals and
interrupted session working state are not restored automatically.
The history view labels completion and progress as not recorded instead of
presenting zero steps or a zero duration as measured results.

The model-free invocation-loss regression passes. Library-only checking and
strict Clippy, followed by full `make verify`, also pass at `2b7fae9a2`.
The regression drops the invocation
future after a completed file read and a pending, unapproved shell request, then
reopens the same data with fresh application state. Its scope is invocation loss
and durable-history discoverability. A follow-up at `1449c42ea` retires only the
ending invocation's Live entry. The extended same-process regression checks that
the original entry disappears, an unrelated active entry retains its text, and
completed history remains available. The focused regression, library-only
checking, strict Clippy and full `make verify` pass for this follow-up.
The source follow-up at `512412edd` also cancels the ending invocation and removes
its cancellation sender, tool approvals and folder-access prompts from the
original application state. Admission for the same run ID stays fenced until
that asynchronous cleanup completes. The extended regression holds an original
state mutex across invocation drop to check that fence, then checks cleanup,
unrelated-run preservation, same-ID reuse and ordinary Stop. Verification of
this follow-up passed the focused regression, library checking, strict Clippy
and full `make verify` on Linux with Docker `--init`. The first gate without an
init process failed two descendant-liveness tests; the approved unchanged-source
rerun passed. That environment failure and both logs are retained under
`out/studio-pending-drop-cleanup-20261016/`.
The separate native desktop-death check below passes incomplete-history
discovery and explicit new-run continuation; the later idle Host termination
check covers Stop and a fresh run after managed Host replacement. The in-flight
Engine-loss and [active Host-loss checks](#native-active-host-loss-and-explicit-new-run-recovery--october-18)
below cover visible failure and an explicit new run. Automatic resume and
power-loss recovery remain unqualified; the normal-close acceptance above
remains valid.
See the [decision](../decisions/2026-10-16-persist-interrupted-studio-run-history.md).

## Native desktop process-death and new-run continuation — October 17

One real Linux Standard Agent completed a file read and waited for shell
approval before the desktop alone was killed. Ordinary Runs reopening after
relaunch showed the same original record as INCOMPLETE, with completion and
steps not recorded. Its saved artifacts were unchanged, and the unapproved
command did not run or replay. The Host survived the desktop death, but the
Engine later disappeared; a normal new INT Start was required before continuing.

Ordinary Continue as new run created a distinct run with fresh folder and shell
approvals. The approved `touch` succeeded once. The model requested another
`touch`, which the human denied; the new run finished in eight steps and reopened
as FINISHED while the original remained INCOMPLETE. This qualifies that explicit
continuation path, not automatic resume or exactly-once execution. Separate Host
and Engine checks below cover their bounded recovery paths. Power loss and Windows
remain unqualified; OI-068 remains PARTIAL.
[Settings, evidence and limits](remaining-acceptance.md#oi-068-native-desktop-process-death-and-continuation--october-17).

## Native idle Host termination and explicit new-run continuation — October 17

On the retained d31 Linux AppImage, a real Standard Agent completed a read and
waited for shell approval. SIGTERM to the idle managed Host followed by ordinary
Stop cancelled the run in about five seconds, removed the approval and left the
marker absent. Managed Host replacement was automatic; starting the same model
profile was explicit. The original reopened as CANCELLED with two steps.

Continue as new run preserved the goal and workspace while creating distinct
run and session identities. A fresh Allow once executed one `touch` successfully.
The new run reopened as FINISHED with five steps; all four original archive files
retained their hashes and sizes. Its final reply falsely attributed the marker
to the cancelled run and claimed no new changes. Recovery is qualified by the
observed tool outcomes and run identities, not that reply's factual accuracy.

This passes idle Host SIGTERM, Stop and explicit new-run recovery only. The separate
Engine-loss and [active Host-loss checks](#native-active-host-loss-and-explicit-new-run-recovery--october-18)
below cover bounded interruptions during inference. Automatic resume, power loss
and Windows remain unqualified; OI-068 remains PARTIAL.
[Settings, evidence and limits](remaining-acceptance.md#oi-068-native-idle-host-termination-and-continuation--october-17).

## Native in-flight Engine loss and new-run recovery — October 17

On the retained d31 Linux AppImage, the Engine alone was killed while Ready with
one active request. The original Standard Agent run visibly failed with a
connection-closed error and zero completed steps. It did not retry automatically.

An ordinary Start of the same saved model profile followed by a separate Run
completed the read-only goal in two steps: read `observation.txt`, then Reply with
its exact contents. Ordinary Runs showed the original FAILED record and the
distinct FINISHED record. Normal model Stop and desktop exit followed.

This qualifies visible failure and explicit same-profile restart/new-run recovery.
The separate [active Host-loss check](#native-active-host-loss-and-explicit-new-run-recovery--october-18)
below covers abrupt Host death during inference. Automatic resume, power loss
and Windows remain unqualified; OI-068 remains PARTIAL. Configured context was
131072; the explicit KV arena limited the Engine's request context to 77824,
so this was a short recovery task.
[Settings, evidence and limits](remaining-acceptance.md#oi-068-native-in-flight-engine-loss-and-explicit-restart--october-17).

## Native active Host loss and explicit new-run recovery — October 18

The retained Linux native desktop from source `824042e0a`, its `d8ce59320`
Host resource and Engine `e2282c336` ran Qwen3.8 27B NVFP4 on physical S1 GPU1
(PRO 6000, UI GPU2), using a private HOME/XDG/runtime, D-Bus session, keyring
and Xvfb191. The profile
used C1, context 32768 (effective 32256), a 5368709120-byte KV arena and no
speculation. This was a short read-only Standard Agent task, with mutating,
shell and web tools denied.

After fresh Ready and one active request, only the Host received SIGKILL at
01:35:40.333228Z. Its Engine, launched with `--exit-on-stdin-close`, was observed
exited at 01:35:40.584752Z without a direct Engine kill. The original run failed
with zero steps and unexpected EOF; no automatic retry was observed.

Opening GInfer Hosts replaced the managed Host automatically. Ordinary Refresh
and Start of the same profile reached Ready, then a distinct **Save & run** read
`observation.txt` and replied with its exact line in two steps. Ordinary history
reopening retained the original FAILED record and the new FINISHED record. The
two original archive files kept their hashes and sizes; the workspace contained
only the observation fixture.

Normal model Stop reached stopped with no active request or Engine. The Host
then automatically resumed its complete-remaining-formats profiler. Initial idle
Host SIGTERM was insufficient: the open desktop recreated the Host and profiler.
The desktop exited before final replacement cleanup at 01:39:40.251255Z. Returned
01:40Z corrects the earlier premature return; a two-minute cleanup booking covered
the final teardown. This qualifier remains part of the result.

This passes bounded active Host-loss reporting and explicit restart/new-run
recovery. Automatic resume or replay, exactly-once execution, broader crash recovery, power loss,
literal 262144-token input, Hermes and fresh installation remain unqualified.
Windows: not built (dev phase). No performance claim; OI-068 remains PARTIAL.
[Settings, identities, evidence and limits](remaining-acceptance.md#oi-068-native-active-host-loss-and-explicit-restart--october-18).

## Native attachment chooser uses current tools — October 17

In an existing Linux conversation, the document reader was disabled before the
native chooser opened and enabled while that same chooser remained open.
Confirming `short.pdf` then retained an Auto raw-path attachment without inline
processing or an ingestion prompt. This passes the causal current-tools check
for `GCHAT-ATTACHMENT-PICKER-STALE-TOOL-SNAPSHOT-20261015`; it does not qualify
sending the PDF or reading its contents. The preliminary New Chat attempt did
not exercise the relevant processing branch and is not a causal pass.
[Native procedure and evidence](remaining-acceptance.md#native-attachment-chooser-current-tools--october-17).
The separate [October 18 PDF Send check](#native-pdf-send-and-folder-permission--october-18)
passes the bounded send, folder permission and answer path.

## Native PDF Send and folder permission — October 18

An isolated Linux native Chat selected the correct `short.pdf` (585 bytes)
through the ordinary attachment chooser and sent a prompt containing no answer
code. The folder dialog named `os.fs.read_document`; after **Allow folder**, the
answer included the expected `ORCHID-472`. Saved messages record the exact PDF
path passed to `os_fs_read_document` and its untruncated 12-character result.
The dialog disclosed that the grant
adds the folder to External with **CAN EDIT** access for that session. Expanded
final tool details were not captured before shutdown.

This uses the retained `832fddb85` desktop plus the run-selection-scroll fix and
retained sidecars. It does not qualify all latest sidecars, Windows or a fresh
installation. The initial CPU-profile mismatch and live-cpuset NVIDIA failure,
corrected restart, and GPU return at 03:17Z after the 03:16Z cutoff remain part
of the record. No timing claim; broader OI-068 remains PARTIAL.
[Procedure, identities and evidence](remaining-acceptance.md#oi-068-native-pdf-send-and-folder-permission--october-18).

## Worker review follow-up

The October 17 disposition closes the factual-accuracy row as a known model
limitation. In one matched run per package, INT did better than NVFP4; neither
result establishes reliability on complex code reviews. See the
[release known issues](../installer-refresh/README.md#known-issues). The earlier
guidance acceptance below retains its recorded scope.

`GCHAT-WORKER-REVIEW-INSTRUCTION-FOLLOWING` owns the remaining task-quality
failures from the retained fresh-read review. The candidate clarifies that the
task's requested order and one-call decisions take priority over general batching,
and asks the worker to verify source conditions and return paths before stating
behavior. This is general worker guidance; it supplies no task-specific answer.
Prompt guidance alone does not establish the cause or correction of a model error.

One native default-worker review used the same read-only eight-file task with
`qwen3.8-27b/nvfp4-dflash2-nvfp4` (`qwen38_27b_nvfp4_df2.ginfer`), C1,
262144 context, speculation disabled, high reasoning, Auto output and the default
25 steps. It finished in 11 decisions, inspected all eight files in order and made
exactly one tool call per decision. The exact answer survived ordinary Studio
navigation and saved-run reopening.

The task still fails factual accuracy: the answer again says manual Compact does
nothing whenever input fits, overlooking the earlier checkpoint attempt. It also
misstates the cut indices. This guidance therefore qualifies sequential inspection
in this run, not resolution of the review-quality defect. At that point the row remained open; the October 17 known-limitation
disposition above supersedes that status. No new checkpoint, restart or
post-compaction task acceptance is claimed by that review.

Evidence: `/ai/gchat/out/worker-review-guidance-20261015/{result.json,summary.md}`.
Full `make verify`, native check, strict Clippy and build pass. The candidate uses
desktop base `a0336f7d5`, accepted Host `44e80b7c1` and Engine `9f8fb8ff9`; this is
a native functional gate, not a rebuilt installer gate. Normal Host Stop returned
zero active requests, private credential removal passed and owned processes and
S1 booking 1841 are released. The previous retention and checkpoint evidence
remains valid at its recorded scope.

## Correct multi-file task after compaction — October 15

A native worker completed a read-only eight-file maintainer reference correctly
with the same Qwen NVFP4 package and normal settings above. Ordinary UI Compact
installed a checkpoint after step 5: counted input fell from 32584 to 17211 tokens
and nine older entries were replaced. The same worker preserved its task,
identity and reserve, then performed six more bounded source reads and Reply.
Independent source review passed all eight rows; the run finished in 13 decisions
with one tool call per decision.

The exact answer reopened through ordinary Studio navigation. After completion,
a normal native window close and app relaunch preserved the same finished record,
working state and transcript without hash changes. The native Host instance then
stopped with zero active requests, its pairing disappeared from the private app,
and owned fixture processes and resource bookings were released.

[Acceptance details](remaining-acceptance.md#oi-068-factual-multi-file-task-after-checkpoint--october-15)
and evidence: `/ai/gchat/out/worker-post-compact-20261015/{result.json,summary.md}`.
This qualifies successful post-compaction task execution and terminal-record
persistence. The original harder review is a known accuracy limitation; broader
active-worker restart recovery, full 262144-token capacity, Hermes and Windows
remain unqualified;
OI-068 remains PARTIAL.

## Worker file-read ranges — October 15

`GCHAT-WORKER-FILE-READ-STRING-RANGE`: `os.fs.read` now accepts unsigned JSON
numbers and decimal strings for byte offset and limit. Missing, invalid or zero
limits retain the existing default; the 16000-byte cap remains. Other tools'
numeric argument handling is unchanged. The real filesystem-tool regression
reproduces the old fallback and checks the requested nonzero chunk, numeric
arguments, defaults and the cap.

This worktree's Yarn state and core archive are rebuilt, the extension lockfile
matches that archive, and the ReasoningToggle test supplies the browser observer
required by its real tooltip. [Fresh-worktree setup](../../CONTRIBUTING.md#testing)
records the preparation. Verification:
`/ai/gchat/out/worker-read-range-20261015/{result.json,summary.md}`.
The composed `make verify` gate, `cargo check` and strict Clippy pass.
The failed eight-file review remains separate work
under `GCHAT-WORKER-UNSUPPORTED-REPLY-MARKUP`.

## Worker retrieval content — October 15

`GCHAT-WORKER-FRESH-READ-COMPRESSION`: successful file reads, grep,
document extraction and archive-entry reads now retain their tool-bounded
content in the next model request and durable session. Previously, the session
boundary reduced a fresh 16000-byte excerpt to a 400-character summary,
including when the worker reread its full-result artifact. Other tool
observations retain their existing compression. Context budgeting and
safe-boundary checkpoint compaction continue to bound inference history.

The real-tool regression checks complete retrieved text in the next completion
and saved-session reopening for all four retrieval tools and a full-result JSON
reread. It fails before the change and passes after it. Full `make verify` passes
(2309 root and 114 extension tests; 850 Rust tests, 25 ignored). Production
frontend, native desktop check, strict Clippy and build also pass. The existing
Protobuf compiler wrapper and host OpenSSL avoid a foreign-owned vendored
OpenSSL cache without changing that cache.

One native default-worker review on S1's PRO reached `finished` / `reply` after
10 decisions. All eight requested files were inspected; all 11 successful read
results (7157–16000 characters each) survive verbatim in the durable working
context, with their full-result artifact pointers. The finished record and exact
answer survive ordinary Studio navigation and reopening.

The strict review task still failed: two decisions batched reads despite the
sequential instruction, and the answer incorrectly says a manual Compact request
returns `nothing_to_compact` whenever input already fits. The implementation
first tries to install a smaller safe-boundary checkpoint. This remaining review
quality is tracked separately as `GCHAT-WORKER-REVIEW-INSTRUCTION-FOLLOWING`.
No new compaction, restart recovery or successful post-compaction task is claimed.

Evidence: `/ai/gchat/out/worker-fresh-reads-20261015/{result.json,summary.md}`.
The desktop is source `35640ed50` in an extracted accepted resource closure;
the remote Host is `44e80b7c1` and Engine `9f8fb8ff9`. This is a native functional
gate, not installer acceptance. Normal Host Stop passed with zero requests;
private pairing and owned processes are retired, 9.21 GB of disposable state
is removed, and S1 booking 1832 is returned.

## Worker repair markup — October 15

`GCHAT-WORKER-UNSUPPORTED-REPLY-MARKUP`: the retained eight-file review's first
invalid tool completion was followed by another unsupported XML tool call in
repair. The ordinary-worker plain-text fallback accepted that markup as Reply,
so the failed task was recorded as finished. The fallback now rejects text
beginning with a markup tag or code fence, matching the existing authoring
boundary; it does not execute unsupported XML calls.

The regression uses the exact recorded repair and checks a failed tool-call
status, no published answer and one repair request. It fails before the change
and passes after it; genuine plain-text repair remains covered. Full
`make verify` passes (2295 root and 114 extension tests; 846 Rust tests,
25 ignored). Native desktop check, strict Clippy, production frontend and build
also pass.

One native default-worker eight-file review ended as `finished` / `reply` after
16 decisions and survived ordinary Studio reopening. It did not emit repair
markup, so the exact rejection is established by the regression. The review
task still failed: it batched reads despite the one-call-per-decision instruction
and incorrectly claimed a fixed 30000-token automatic-compaction threshold.
Fresh reads and archive rereads reached the prompt as 400-character summaries;
`GCHAT-WORKER-FRESH-READ-COMPRESSION` owns that separate observed defect. No
successful multi-file task or new checkpoint acceptance is claimed.

Evidence: `/ai/gchat/out/worker-reply-markup-20261015/{result.json,summary.md}`.
Normal Host Stop passed with zero requests; private pairing and owned processes
are retired, and booking 717 is returned. The earlier checkpoint-continuity
pass remains accepted at its recorded scope.

## OI-068 live-worker checkpoint continuity — October 15

The retained Linux developer DEB (desktop/CLI/Host `7e33222e8`, Engine
`38ff80e0c`) reached Ready with unchanged normal Qwen 262144 configuration.
An ordinary live-run **Compact** request installed a checkpoint at the next
safe boundary: input fell from 12662 to 11567 tokens and 19 older entries
were replaced. The task, session/context identity, default 25-step limit,
high reasoning and 20480-token reserve were preserved. The same worker then
executed 16 further non-reply tools and Reply; full tool outputs and transcript
remained archived. Its terminal record survived ordinary Studio reopening.

This qualifies live-worker checkpoint installation and continuation, not task
success. The requested eight-file review failed: the worker repeatedly read the
first document and ended after 22 decisions as `finished` / `reply`, returning
unsupported tool markup. String-valued `limit` / `offset` silently took numeric
defaults; `GCHAT-WORKER-FILE-READ-STRING-RANGE` tracks that reproduced defect.
The first, earlier Compact request returned `nothing_to_compact` and is not
counted as a checkpoint. No app-exit/restart recovery or full-context capacity
claim is made; broader OI-068 remains PARTIAL.

Evidence: `/ai/gchat/out/worker-compaction-20261015/{result.json,summary.md}`.
The prior accepted hardware profile was reused without calibration or a build.
Normal Host Stop passed with zero requests; the private credential, processes
and 7.47 GB of disposable state are retired, and booking 715 is returned.
The physical desktop keyring and retained package/model/profile are unchanged.

## OI-068 live-worker cancellation and new-run continuation — accepted

The four-image current Linux CLI/serve runtime set and Engine-only DEB/AppImage refresh pass. Engine source is `38ff80e0c` on requested `415eaa2b5`; accepted desktop/CLI/Host bytes remain `7e33222e8`. The packaged CLI generated the exact local5090 profile in 760.4 seconds.

The unchanged normal model configuration reached Ready. Cancelling an actively generating General Agent worker stopped its Engine request and finished its parent Chat turn. The cancelled run and exact Chat history survived reopening. Studio's **Continue as new run** completed in nine steps, returned its final answer and preserved its finished record across reopening. Normal Host Stop passed. This qualifies first-step cancellation and new-run continuation; broader active-worker compaction and Windows remain unqualified. The UI also displayed an erroneous cancellation-failure toast despite the durable cancelled outcome; `GCHAT-WORKER-CANCEL-FALSE-ERROR` tracks that separate defect.

Results and retained receipts: `/ai/gchat/out/gchat-open-items-20261013/oi068-chat-workers/live-cancel-20261014/{result.json,summary.md}`. Package manifests/integrity and the focused runtime-document staging fixture pass. The resume-time `make verify` attempt stops at lint because this worktree lacks Yarn's dependency state; no dependency installation was performed. No desktop source, saved model setting, signing or publication changed.

Owned app/Host/Engine/profile jobs are absent; bookings and canonical build/GPU locks are released. Disposable package stages, isolated client state and superseded installers are retired; current installers, the generated profile, runtime set and evidence remain. Source branches are ready for coordinator review. Do not rebuild or repeat passing gates.

[Remaining acceptance and prepared checks](remaining-acceptance.md) records physical
prerequisites and distinguishes saved source evidence from installed replay.

## Current worker Stop correction

`GCHAT-WORKER-CANCEL-FALSE-ERROR`: parent Stop aborts outstanding capability
calls and explicitly cancels the active workers. Both paths can send
`agent_cancel_turn` for the same run. The first consumes its cancellation sender;
the second previously returned an inactive-run error that could trigger the failure
toast. A worker finishing before its Stop request has the same inactive-run race.

Native Stop is idempotent: it signals an active run once, clears its pending
prompts and accepts a run that is already inactive. An unrelated active run is preserved.
The new native regression passes duplicate and late Stop requests, prompt cleanup
and preservation of an unrelated active run. The existing real-worker preflight
cancellation and delegated cancellation/reopen regressions also pass in the 631-case
Chat library suite (seven ignored); `cargo check` and strict Clippy pass. The
correction and test-quality fixes are merged in `22ae47c0b`. This source diagnosis
does not establish which race caused the retained single-click OI-068 toast.

The October 15 native Linux replay passes on production desktop source
`22ae47c0b`, built into a private extracted AppImage resource closure with accepted
CLI/Host `7e33222e8` and Engine `38ff80e0c`. Fresh profiling of the actual 115 GiB
host and CPU grant 8–31 completed in 752.9 seconds. The unchanged saved 262144
configuration reached Ready. One Stop click at 07:09:17Z cancelled the actively
generating worker's Engine request; the parent completed normally and no failure
toast appeared. The cancelled record and exact Chat history survived reopening,
and Studio displayed the saved cancelled run. Normal Host Stop passed with zero
active requests. This is functional worker Stop acceptance, not a full 262144-token
capacity qualification or a rebuilt installer gate. Broader OI-068 remains partial;
Windows and Hermes remain owed. The separate live-worker checkpoint result
above supersedes this replay's compaction exclusion without repeating Stop.

Evidence: `/ai/gchat-worktrees/worker-replay-22ae/out/worker-acceptance-20261015/{result.json,summary.md}`.
Owned desktop/Host/Engine/Gbot processes are stopped; CPU/GPU bookings and canonical
guards are released. No Windows build, signing or publication was performed.

GCHAT-CLI-FEATURE-CLIPPY is fixed: desktop startup helpers compile only for
the desktop feature; shared headless installation and completion remain available.
The three existing bundled-resource fixtures and strict CLI/desktop Clippy pass.
Evidence: `/ai/gchat/out/gchat-cli-feature-clippy/result.json`. The candidate
`fix/gchat-cli-setup-ownership-357c` awaits reviewed merge; retire its tree afterwards.

GCHAT-WINDOWS-FIRST-RENDER-RESOURCES now schedules Windows desktop runtime
installation through the existing retained background resource gate. The
manifest-verifying installer and resource/data paths are unchanged; consumers
still wait for completion and receive retained installation failures. This is
source-only: Linux startup is unchanged, Linux Rust gates are pending, and no
native Windows build, run or first-render validation has been performed.

GCHAT-LINUX-DRI3-STARTUP-WARNING is an external Mesa/Xwayland diagnostic.
Mesa's X11 EGL device-open failure emits the retained warning; current WSLg
`:0` advertises no DRI3. Retained native TUI rendering and typed input pass.
The existing crash-prevention DMA-BUF policy does not supply that extension.
No product fix is demonstrated; final renderer acceleration remains unmeasured.
Evidence: `/ai/gchat/out/gchat-focused-burndown-20261013/dri3/result.json`.

[Credential-store tiers](../decisions/2026-10-13-credential-store-tiers.md) is the
approved shared-store design. Linux now supports Secret Service or an explicit
passphrase-encrypted vault; WSL uses these Linux tiers until the Windows helper
release gate. The native Linux missing-provider/passphrase setup gate passes,
including lock, rejected passphrase and unlock after restart. The installed d31
Linux Secret Service check also passes silent locked-keyring launch and explicit
saved-Host Connect prompting, with a clear locked-storage error after Cancel.
A fresh isolated-keyring follow-up also passes ordinary unlock, stored-credential
retrieval and reconnection after restart. The installed Linux Gbot local service
token also passes creation and retrieval after GUI and normal service-process
restart, with silent locked launch and Gbot navigation. Synthetic SSH-key import
and stored-key retrieval after GUI restart also pass, displaying the same public key.
SSH authentication/provider credential use, crash recovery and Windows remain
unqualified.
[Evidence and limits](remaining-acceptance.md#installed-linux-locked-keyring-launch-and-explicit-connect--october-17).
OI-069's two-Host worker gate and October 15 independent-workstation gate pass.
Two native Linux clients with distinct grants share one instance-wide worker
limit: the second queues, queued cancellation completes, and a fresh request
finishes after the first releases its slot. Both native clients retain their
finished replies and return to zero usage. The coordinator accounting correction
and exact producer/evidence are recorded in the
[acceptance record](remaining-acceptance.md#accepted-oi-069-independent-workstation-capacity).

The [updater offline metadata gate](remaining-acceptance.md#updater-offline-metadata-gate--october-12)
passes all 19 existing cases against accepted source `874cbc98d` using existing
S1 jq/Python. Cryptographic final-payload verification and signed release/feed
acceptance remain pending; no source or publication change was needed.

The [installed Ubuntu Desktop acceptance](remaining-acceptance.md#accepted-ubuntu-desktop-packages--oi-057)
passes for retained GChat 2.0.42 DEB/AppImage on native GNOME Wayland and Xorg:
visible rendering, ordinary Chat through the accepted Host, saved-answer reopen
across app restart and normal exit. The model/Host/private VM are stopped and
bookings released. This is functional desktop acceptance; the packages' historical
Engine bundle and release qualification remain separate. Evidence and the private
keyring-fixture limitation are recorded in that section.

Current source-only terminal work is [whole-window Unix PTY geometry](remaining-acceptance.md#current-unix-pty-window-geometry-correction).
The frontend now sends full container pixels and reports pixel-only changes at
unchanged rows/columns. The named pixel-only resize fixture passes in retained
`pty-geometry-test.log`; native mouse/geometry acceptance remains unqualified. This is separate from the accepted Linux Code TUI fix.

The accepted [Linux Code TUI correction](remaining-acceptance.md#current-linux-code-tui-correction):
the reproduced esbuild lowering defect is corrected in tested source `f2de958f3`.
The production-bundled parser fixture passes 1/1; affected lint, frontend
typecheck/build and the corrected Linux desktop build pass. The named live Linux
gate passes at 11:36Z: the TUI renders, one typed prompt persists, and the same
session answers `ok` with normal completion and no tools. The full requested
marker was not returned; no model-quality claim is made. Normal Code/Host Stop,
app/Host exit, closed private listeners, unchanged standalone configuration and
guard return are verified. The private test root is removed; the correction is merged/pushed on main `058702dd8` and its source tree is retired.
No Windows or release change occurred. The existing frontend chunk
warning remains an OI-074 item. Configuration ownership is
merged and pushed on main `7fe8363b1`; its eight focused checks and actual
unchanged-HOME configuration/model/bridge routing evidence remain accepted.
Its source tree is retired; tested desktop/resources and evidence are preserved.

The [three walkthrough defect corrections](remaining-acceptance.md#accepted-walkthrough-defect-correction)
are merged/pushed on main1e61155b4: Builder finishes after its successful reviewed save, mounted
Chat refreshes created/updated definitions, and failed-tool history preserves its
terminal state and exact error. All19 focused cases, corrected Linux desktop
build and one targeted real-model three-step check pass. Independent review
accepts source and saved live evidence. Normal Stop and private-root cleanup are
complete; no owned model/app/Host/guard/booking remains. No Windows or release change.

The [accepted OI-068 baseline](remaining-acceptance.md#accepted-oi-068-linux-smol-functional-walkthrough)
on main869a368b1 preserves actual Host Ready, Chat MD/XLSX reading/continuation,
reviewed saved-agent execution, manual Chat compaction/continuation and final Stop.
Main `1e61155b4` corrects its three agent/history defects. The named Linux Code
TUI scope now passes; OI-068 remains PARTIAL for Hermes/Windows and broader
active-worker compaction scope. The prior walkthrough reproduced the global
OpenCode write. The correction above prevents
it in the new check; the earlier before-image remains unknown and no restoration
is claimed.

OI-075's one generated Linux/WSLg WebKit observation is now measured: opening
110 ms, full programmatic traversal 113 ms and stable foreground idle 30.047 s.
Native process counters are partial because temporary image-loader children
exit during the interval; there is no complete-group total or cross-OS gain.
The [current OI-075 record](remaining-acceptance.md#current-oi-075-linux-rendering-observation)
owns metadata-only generation, exact results, limitations and deleted fixture.

The delegated Chat worker-card restoration now passes 25 focused cases and one
isolated native Linux reload: every saved run returns once, with live updates
merged by run ID and terminal state preserved. The correction is merged on
main `585c95484`; [the acceptance record](remaining-acceptance.md) owns scope and evidence.

## Current acceptance

OI-073's new public-removal control passes its focused source/native gates and
one actual Linux candidate-app submit/read/delete. The confirmation removes only
the receipt-owned public result, keeping local history and unrelated ownership.
All12 official series/36 points remain unchanged. The disposable row and private
fixture are removed; source is merged/pushed on maina4bebb2e1. The [current deletion record](remaining-acceptance.md#current-oi-073-app-public-deletion-gate-accepted)
owns exact scope, evidence and the deferred Windows release gate.

Installer routing follows the [validated current-user NSIS decision](../decisions/2026-10-10-prefer-current-user-nsis-owner.md).

## Earlier Windows installation evidence

The receipts below describe earlier installed artifacts, not current main.
Historical source baseline is `bd4dba841`. Host correctness fixes OI-111–114
and OI-120–122 retain their composed Rust gate. Windows now has the accepted
`3aff66d62` desktop, retained `574d73df7` Manager, 7d9 Host/CLI and2ef Engine.
The installed embedded UI loads correctly. Ron accepts Code Stop/Restart after
fresh-window392 shows Exited and then Running with output and connected tools,
with both saved startup flags off. Normal recovery/state preservation passes;
no model, API or debug listener remains and both guards are released. Reconnect is now corrected by `f111810ec`: the one installed reload preserves
output and prompt with connected tools and no lost-screen warning. Normal recovery
and resource return pass at23:59:56 UTC. The source awaits coordinator main merge. [Remaining acceptance](remaining-acceptance.md)
owns exact receipts, next action and incomplete broader OI-068 checks.

Frozen source `7d9a8f689` passes actual native production at 09:37:44 UTC and
independent package verification at 09:40 UTC. Its Code Stop correction retains
four native ConPTY passes, including cursor-query reply and natural exit 7;
focused Host, Unix and native all-target check/strict Clippy evidence is reused.
The obsolete NSIS process-killing pre-uninstall hook is removed; optional
post-uninstall data behavior is unchanged. Receipts are in the existing
`out/remaining-acceptance-20261009/oi068-windows-20261010/` packet:
`production-terminal-337.json` and
`production-9a4caa1c3-337/package-verification.json`. These accepted artifacts
precede the integrated installer-template and Manager presentation corrections.
Booking349 completes the Manager embed and NSIS bundle refresh from `574d73df7`
at 11:26:00.6625612 UTC. Existing compiled 7d9 GChat/Host/CLI, Engine and frontend
payloads retain their original producer provenance.

Earlier booking 337 ended at 09:58:48 UTC with
Engine/API0 and both guards released. Booking 341 ended at 10:19:18.993484 UTC;
its installer preflight rejected genuine MSI migration before any app stop or
NSIS launch, and both guards are released. The baseline apps survived that
attempt. Ron's bring-to-front request succeeded: native Manager Document
visibility passed at 10:10:41.
The tray had no clickable point; no agent tray click or Exit occurred.
The exact valid HKCU64 NSIS owner coexists with a genuine same-path MSI record.
Template `d6da84677` is integrated/pushed as `1a9044e65`; Manager historical-error
and retained-reading-state fixes are integrated/pushed as `c20217d22` and
`574d73df7`. Independent source reviews accept the template/follow-up; focused
Manager Node checks pass 24/24 at 10:36:08 UTC. Pure preservation classifier
checks pass 10/10 with two zero-error AST parses at 10:44:11.6667562 UTC;
this is component evidence, not an installed update. CPU-only booking346 closed
at 10:44:12 UTC with no jobs or guards remaining.
Booking349's actual `PRODUCTION_PASS` proves body exit 0 and an empty job after
the identified VCTIP helper teardown, with settings/apps unchanged and no model
started. Its package verification passes. GChat R2 body/NSIS exit 0, but its
original parent classifier FAIL remains retained alongside separate preservation
adjudication. Manager R3 passes at 11:43:08; full installed byte/state verification
passes at 11:45:47. Actual Manager CDP shows `http://tauri.localhost/`, stopped,
zero active requests and no alerts.

The candidate GChat desktop opened a directory listing at
`file:///C:/Users/Ron/AppData/Local/GChat/windows-build/source/web-app/dist/`.
The production config's absolute Windows `frontendDist` parses as a `C:` URL,
so those frontend assets were not embedded. Byte/state verification does not
establish frontend loading. Exact baseline `0f06ba433` desktop (`1761bdea…`)
restoration passes at 11:56:54.9219517 UTC: GChat loads `http://tauri.localhost/`,
shows all seven original saved threads and has no alerts. Selected protected
state is unchanged; new Manager, 7d9 Host/CLI and 2ef Engine remain intact.
Engine/API counts are zero and guards are released. CPU-only booking353,
15:05–15:15 UTC, used the accepted source proposal: relative
`frontendDist` `../../../windows-build/source/web-app/dist` resolves to the
exact 832 accepted assets as a Directory. The compiled desktop's provenance and
ordinary embedded UI are verified under booking364; NSIS completion remains
separate. Code Stop at 16:25:45 reports Exited/code 1 for generation 1 while
the visible UI remains Stopping at 16:26:11. Normal restart succeeds at
16:31:17 with Engine/API0 and protected state preserved.
The isolated `fix/gchat-terminal-stop-ui` candidate starts from `88ba8b762`
(product-identical to `574d73df7`) and orders shared terminal snapshots/events
by native generation and sequence. Independent source review accepts product
`2684a6c70` and fixture tip `57507c234`. Root's final focused run passes 21/21
without act warnings; typecheck, affected hook/type lint and Linux all-target
release check/strict Clippy pass. The full web suite passes 1,962 tests across
227 files with five skipped and unrelated diagnostics retained. These checks
are source evidence. The composed `make verify` gate now passes on clean
`210d642ba`: 2,120 root/frontend and 102 extension tests, all six critical
coverage floors and all six supported Rust suite commands. Existing test
diagnostics remain visible. Two corrected runner prerequisites (Yarn's
extension-root state and a nonloopback local TLS route) and the actual final
PASS are retained in the OI-068 packet. Its exact container is removed at
17:39:49 UTC; both canonical guards are verified free and booking369 is returned
early. Windows IPC and desktop build now pass in380; installed Stop/Restart passes
in392. Reconnect remains open separately. Booking374 applies the exact native `1ccde5715` source overlay,
but compilation is stopped at 18:35 UTC by the root-selected deadline before
the four tests run. Its Job is empty, the pinned body and controller are exited,
and both canonical guards are verified free at 18:36:44; apps and settings are
unchanged. Booking380 reserves 22:20–22:50 UTC for compilation, tests, desktop
build and installed replay, with cleanup by 22:49. The compile allowance is
increased to avoid repeating that execution failure. The installed `574d73df7`
UI still fails Stop despite native exit. [Remaining acceptance](remaining-acceptance.md#embedded-terminal-status-ordering)
links the exact receipts and retained original warning log.
[Remaining acceptance](remaining-acceptance.md) records the exact owners and
supported scan evidence. Ron authorized keeping the existing AUTO Muse profile
after preservation verification; functional replay still requires fresh Ready
capacity, and final Stop keeps AUTO without attempting the known failing fixed
startup. The narrow installed Code lifecycle passes; broader model-backed Code acceptance
has not passed.

The installed baseline's composed source gate at `0f06ba433` passes `make verify` at
21:17 UTC: 2,112 frontend/core checks (six skipped), 102 extension checks,
all six coverage floors, 553 desktop, 86 Host, six managed-adapter, 12 hardware
and 29 utility tests. Strict Clippy results are reused for unchanged Rust.
Native Windows build exits 0 at 21:30 UTC; independent package verification
passes at 21:34 UTC for the 125-payload Engine runtime, 104 profiles including
103 unchanged original entries, and retained Manager `43c8d71cf`.
Receipts: `/ai/gchat/out/oi106-final-update-20261009/composed-final-gate.json`
and `package-verification.json`. Prior installed `0f06ba433` passes preservation
and actual OI-106 lifecycle/selection and continued Chat acceptance. Seven
original threads, all models/profiles, credentials and Host identity survive.
Receipts in the same folder are `installed-verification.json` and
`installed-lifecycle-acceptance.json`.

Earlier installed Windows GChat `7d9eb55f9`, retained Manager `43c8d71cf` and
Engine `2ef56a52a` pass package, payload and user-state preservation verification:
`/ai/gchat/out/remediation-final-20261009/installed-verification.json`.
The original workbook/discovery/history checks below retain that installed
scope; the ordinary continuation now also passes on `0f06ba433`.

Actual saved Chat reads the Budget workbook through native local document
extraction after approval of precisely the fixture folder, discovers saved-agent
and Studio tools and the enabled Agent Builder, and continues after compaction.
The current `0f06ba433` continuation saves message `QXr1fqK7RSTetk3Y` with
30,000, `finishReason=stop` and ready/idle UI after automatic compaction from
26,366 to 1,705 input tokens. The observed turn works for 4.614 seconds. Evidence is retained in
`/ai/gchat/out/remediation-native-correction-20261009/actual-chat-acceptance.json`
and `/ai/gchat/out/oi106-final-update-20261009/installed-lifecycle-acceptance.json`.
This validates native workbook extraction; no installed XLSX skill is claimed.
Real Code, running-worker, configured-connector and Hermes acceptance remains
partial; [remaining acceptance](remaining-acceptance.md) owns those prerequisites.

Earlier installed `7d9eb55f9` sidebar Stop closes the facade and unloads the
local Host, while explicit Start reaches Ready/API serving with blank selection
and stale sidebar status. The OI-106 correction is integrated in `0f06ba433`;
source/build/package and actual installed Stop/Start/Reload now pass. Start
and Reload reach distinct Ready sessions with selection and Server running
retained; final GUI Stop leaves zero Engines/API listeners and remains stable.
Supported Reload/Stop restores the exact original profile; its known fixed-arena
startup failure remains separate. Normal apps are restored without debug ports.
The [integration authority](../code-hygiene/README.md) records accepted Linux
package/X11 scope, retained evidence and current source/build/job inventory. No
original long agent run is rerun.

## OI-067 — accepted outcome correction

Overall Coordinator status now retains incomplete planning/workers through
synthesis, records loop fallback as `loop_detected`, persists returned failures,
and applies the same propagation to Workflow and Goal Loop. Final output and
individual stage outcomes remain available. Read-time history correction uses
only explicit limiting stage/finish reasons; it preserves raw history bytes and
does not infer failure from missing data or earlier recoverable Goal Loop cycles.
Step budgets, sampling, permissions and saved definitions are unchanged.

Focused frontend checks pass 29 cases; focused Rust checks pass 18 cases covering
orchestration, history/persistence and the actual loop breaker. Independent
read-only review found no blocking defect, and the composed gate above passes.
Actual installed Agent Studio opens the original saved run
`eeaff6d8-0e7f-46d3-bb0c-a9695d7c9f8b` as **INCOMPLETE · STEP LIMIT REACHED**
after its original 45 steps, with final synthesis output, limiting stage outcomes
and model-instance metrics visible. The original raw history is preserved; this
is installed read-time correction, not a replay of the run. Receipt:
`/ai/gchat/out/remediation-native-correction-20261009/ui-original-history-and-server-menu.json`.
The original October 1 incidents remain under `out/agent-recovery-20261001/`.

Two focused frontend fixture failures were corrected by using `AgentRunRecord`
with required metrics and testing actual automatic selection. The Rust script
now supplies the runner's existing output-limit retry, uses an absolute fixture
path and distinguishes logical steps from completion attempts. The corrective
checks exercised the actual paths without changing budgets.

## OI-091 — accepted compact discovery source and Chat

Chat advertises three compact capability tools plus its existing skill/agent
controls. Discovery/schema reads use the cached catalog; invocation re-enters
`capability_execute` for fresh permission, workspace, disabled-tool, approval and
cancellation checks. Agent uses frequent native schemas and rare schemas loaded
by `tool.view`; MCP uses compact discovery/schema reads and approval-gated exact
connector calls. Code exposes compact search/read/call tools and rechecks the
originating session policy. RAG, skills, saved-agent/pool orchestration and
restricted Studio schemas retain their execution ownership and controls.
No catalog tool or runtime context capacity was removed or changed.

The original installed Muse failure prepared 40,666 tokens against 32,768 loaded
capacity (`out/oi056-current-engine/muse-chat-response-ui.json`). Installed Chat
now prepares its fresh short request at 1,514 tokens and completes the actual
workbook/discovery/continuation sequence above. The 21 scripted SDK harness
checks include native/MCP search/read/call/final-answer chains and changed policy
after schema lookup; they do not establish real connector or Code acceptance.
Presenter checks pass six cases and TypeScript passes.

The earlier 306-test Agent/Code run used main rather than the candidate and is
not candidate evidence. Composition corrected two borrowed-string mismatches
and the missing `json!` import, then passed the composed Rust gate above. Actual
Code/worker/connector checks remain scoped in the existing acceptance reference.

| Owner / host | Exact path | Purpose / retention |
| --- | --- | --- |
| GChat / coordinator | `/ai/gchat-worktrees/remediation-integration`, `dev/gchat-remediation-104d4ec6` | Composed candidate; active source, build and job inventory in the integration authority |
| Completed OI-067/OI-091 | `/ai/gchat-worktrees/oi067-agent-outcomes`, `/ai/gchat-worktrees/oi091-lazy-tools` | Owned trees retired after remote/tip/live-use checks; source branches and evidence retained |
| Stable / shared caches | `/ai/gchat`, `/ai/gchat/node_modules`, `/ai/gchat/src-tauri/target` | Baseline and reused dependencies/compiler cache |
| Evidence | `/ai/gchat/out/agent-recovery-20261001/`, `/ai/gchat/out/oi091-lazy-tools/`, `/ai/gchat/out/remediation-native-correction-20261009/`, `/ai/gchat/out/remediation-final-20261009/` | Original incidents, focused/source checks and actual installed evidence; preserve raw histories |

## Unified sessions and Code capabilities — accepted October 8 source

The user's shared conversation design is implemented: ordinary replies, native
local-machine tools and delegated agents use one conversation runtime; Agent
Studio remains for authoring. Saved Code sessions appear in the shared sidebar
with typed icons, retain the stock OpenCode transcript authority and restore after
restart. `/compact` is intercepted in Chat, workers and Code at the appropriate
control boundary. Code exposes Studio definitions, invocation, shared skills,
native tools and configured connectors through the shared executor.

Permissions follow the actual stock OpenCode caller, including background child
sessions. A public server plugin supplies caller identity; native code verifies
the workspace/parent chain and applies the saved top-level conversation policy.
Switching the visible session does not alter a background run's permissions.
Discovery does not supply a permissive execution policy. Explicit denials remain.

The reported Windows Desktop file was Excel, but its original error is unavailable.
Native document extraction already supports `.xls` and `.xlsx`. The demonstrated
content-loss defect selected metadata `details` instead of extracted `summary`;
the shared result now carries both. A real XLSX regression verifies content and
folder approval/continuation. This establishes the corrected shared access path,
not the exact cause of the user's unreproducible incident. Document intake retains
local-file references without requiring feature-disabled embeddings. Image names
remain available through submission, saved messages, reload and agent staging.

Current fleet/NAS model package stems are accepted by profile/model matching.
The twelve inventoried fixtures and installer-refresh path references are updated;
registered artifact identities and engine inference behavior remain unchanged.
Flash has independent family/context facts instead of inheriting Qwen 27B facts.
Paired-host compaction uses the exact ready instance's loaded capacity.

The combined candidate passed `make verify` at `d1821fa5c`: 2,060 frontend tests
(six skipped), 102 extension tests, all six critical coverage floors and supported
Rust suites, including 543 desktop tests (seven ignored). Independent source
review accepted the result. Stock OpenCode 1.18.21 public hook injection, transcript
restart and session-selection screens passed with isolated storage and no model.
Retained evidence is in `/ai/gchat/out/unified-sessions-20261008/`.

Two concrete gate failures were corrected before acceptance: a mock-only Code
assertion was replaced by retained output/state/navigation behavior, and an IPC
fixture's explicit command set was updated for the four registered Code commands.
Review also corrected draft loss: submission waits for successful restoration,
while drafts, attachments and selected skills remain editable. Failure receipts
explain these corrections; no quality exception was added.

Accepted implementation/review record `217b88409` and cleanup record `6eacebfff`
are pushed on main. Five clean completed delegated worktrees were removed after
checking live use, releasing about 1.3 GiB. Their source commits remain in Git.
No installer rebuild, installed Windows replay or GPU inference is claimed for
this batch. Unrelated owners and fleet machines were not cleaned.

| Owner / host | Exact path | Purpose / retention |
| --- | --- | --- |
| GChat / Ron-9950X3D2 | `/ai/gchat` | Accepted stable source; later Manager integration tracked separately |
| Unified sessions / coordinator | `/ai/gchat-worktrees/unified-sessions` | Superseded clean candidate retired at Manager handoff; source commits and external evidence retained |
| Shared caches | `/ai/gchat/node_modules`, `/ai/gchat/src-tauri/target` | Reuse dependencies/compiler cache; preserve accepted installers |
| Verification | `/ai/gchat/out/unified-sessions-20261008/` | Passing gate, corrected failure receipts and stock-session proof |

The separately authorized standalone Server Manager and shared fleet pools are
implemented under [their current subject record](../ginfer-manager/README.md).
That record owns Linux/Windows assembly, review and any remaining native checks.
Installer updates and real-model Windows replay remain outside this source batch.
The subsequent authorized [October 8 local Windows update](../installer-refresh/README.md)
now includes this source and current GChat/Host; normal startup and preserved user
state pass. The October 9 Chat workbook/discovery/compaction/continuation
acceptance is recorded above; real Code, worker and connector walkthroughs
remain partial.

GInfer's source-audited operations manual and six-entry offline release payload
are accepted at `66f52a0e2`, handoff `8d0b1a4d1`. Linux staging and native
PowerShell archive/link/hash checks passed. October 9 ancestry inspection confirms
that implementation is already integrated into `dev/next` at `848fbc624`; the
earlier pending-integration statement is obsolete. OI-056 in the
[master list](../open-work.md) owns final selected-engine/Host/client assembly
and checking its offline documentation payload. This does not qualify current
development builds or update the older installed engine. The retained authority
is `/ai/ginfer-worktrees/operations-manual/docs/operations/README.md`.

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
remains uninstalled. October 9 installed acceptance opens the original saved
agent without replay and continues ordinary Chat, as recorded above. Real Code/worker acceptance remains
distinct from scripted verification. Ask Chat to list saved agents, or type
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
The October 9 installed continued Chat acceptance is recorded above.
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
loop exits, not demonstrated engine crashes. The historical implementation followed synthesis and obscured incomplete
workers. The accepted OI-067 correction above fixes that reporting; this paragraph
retains the original incident rather than describing current candidate behavior.
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
