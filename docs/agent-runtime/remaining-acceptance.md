# Remaining installed acceptance

Repository: `/ai/gchat`; subject: `docs/agent-runtime/`. The GInfer
`docs/maintainer/open-work.md` is the sole issue-status authority. This record
owns acceptance scope, preserved evidence and actual prerequisites.

## Current implementation and test plan — October 12

This reconciliation uses reviewed main `13f88c042`, including background ownership and seed repair, plus `ec21a1874`
(guest delivery) and `e49219967` (native reports), the master rows and saved
receipts. A source fix, a focused fixture and an installed acceptance gate are
separate claims. Passing evidence is reused; no broad suite or repeat GPU run
is part of this plan. The master list remains the sole issue-status authority.

### Implementation still required

| Item | Current behavior / remaining work | Smallest useful gate |
| --- | --- | --- |
| General agent delegation from Chat | Main `8440b5f7a` supports asynchronous independent workers through the shared runner, inherited permissions/placement, result collection and targeted cancellation. One native lifecycle case and nine frontend cases PASS. | Real-model/installed Chat check remains; native persisted result/reopen and independent cancellation are covered. |
| Gbot enable and guided setup | Baseline sidebar ignored enablement and Add bot was a manual SSH form. Main `8440b5f7a` adds opt-in and a guided existing-LAN connection with review; 39 focused cases pass. Settings enable now navigates to Gbot, where first setup opens; disable/startup leave it closed. Three focused cases, types and affected lint PASS. Installed presentation is still untested. | Settings migration, conditional sidebar, disabled-route isolation, wizard validation/review/retry. |
| Automatic bot computer setup | Main `b1502528b` wires the KVM adapter to resumable product onboarding; accepted bundle/seed and diagnostic fixes provide pinned delivery and actionable failures. Corrected readiness keyboard arguments pass the owning adapter case, check and strict Clippy. One dedicated S1 guest reached Ready through the authenticated API after service restart/resume; input/save, independent readback and view-only media pass. Guest and private roots are retired. Installed wizard/bootstrap, Hyper-V, cloud creation/live cost review, M365 and remote service selection remain unfinished. | Installed wizard presentation separately; Windows/M365 at the release window. No person's desktop. |
| Per-bot connectors and research | Main `8440b5f7a` links explicit existing accounts per bot, scopes native tools and persists provider receipts; none are inherited. Two native/service cases and six frontend cases PASS, with combined types/check/Clippy. | Live OAuth read after app registration; research reuses shared tools. |
| Scheduled/background Gbot work | Main `b1502528b` owns once/interval scheduling with persisted occurrence IDs, explicit bot assignments, create/list/disable UI and conservative restart recovery. Main `500a5f2cb` includes separate service ownership `a2b0053a9`, which passes one process and eleven UI cases plus owning checks; installed/native/AppImage lifetime, client-exit/sleep and live dispatch are unrun. | Focused injected-time due/disabled/missed-run/ambiguous-dispatch fixtures plus fake executor and UI controls pass; independent service acceptance remains separate. |
| Browser tools | Typed browser catalog/schema and one real isolated Chromium form pass: exact native window binding, navigation, typing and trusted input submission, independently verified over pinned-host system SSH. | Broader browser tasks and installed presentation remain separate; no model or performance claim. |

### Bugs, decisions and incomplete diagnostics

| Master item | What remains | Next evidence / dependency |
| --- | --- | --- |
| GBOT-SETUP-CREDENTIAL-ORPHAN | Main `8440b5f7a` replaces the two requests with a service-owned transaction and stable vault slot. | Five service failure/retry cases and five route cases PASS, with service check/strict Clippy. Native endpoint admission PASS. Cross-store power-loss/reload recovery is not qualified. |
| GCHAT-GBENCH-NATIVE-V2-REPORT | Accepted `e49219967` consumes the current native report and preserves measured cold PP, warm PP per request, cached TTFT and exact-concurrency TG. Stored v1 retains its historical meaning. Native v2 public submission is refused pending the site's approved contract. | Eight owning Rust cases and 34 frontend cases, check/strict Clippy/types/lint PASS; captured real report fixture. Public schema/scoring is a site-owner decision. |
| OI-069 | Pair/restart/grant restore passed; shared-pool queue, cancellation and recovery across two Ready hosts did not. | Resolve the worker startup/RAM blocker, then one two-host job lifecycle. |
| OI-072-RUNTIME | Muse runtime memory loss has no demonstrated allocation owner/fix. | Reuse capture evidence; one admitted candidate and an ownership timeline only when authorized. |
| OI-076 | Continued-chat context/format warning's original cause remains unknown. | Diagnostics merged in `36ac89441`; collect exact trigger on the next occurrence. No speculative fix. |
| OI-066 | Guard diagnosis is closed; fit-message correction `85bc3d087` is not in origin/dev/next. | Owning CPU/syntax fixtures pass; reviewed engine landing remains pending. Profile qualification is OI-072. |
| OI-110 / GCHAT-UPDATER-SIGNATURE | Routing/metadata source is accepted; all 19 existing offline metadata cases PASS on S1. The live feed is not published. | Exact final-payload signature and signed artifact/feed acceptance at Ron's release gate. SectileLabs repo is artifacts only. |
| GCHAT-GBENCH-MTP-SITE-CONTRACT | Ron's local site correction awaits upload confirmation. | Ron/site owner confirmation; no site edits or publication here. |
| GCHAT-LINUX-ANN-STARTUP-UNAVAILABLE | RAG startup unconditionally probed VectorDB despite the disabled embedding feature. Main `8440b5f7a` removes that probe and awaits settings initialization. | Focused startup case and frontend types PASS; native installed check is not claimed. Explicit VectorDB diagnostics remain available. |
| GCHAT-LINUX-DRI3-STARTUP-WARNING / GCHAT-LINUX-APPINDICATOR-DEPRECATION | Recorded diagnostics; functional Linux acceptance passes. | Keep separate from functional failures; fix in the owning initialization/dependency only if actionable. |
| OI-074 / GCHAT-BROWSER-BASELINE-DATA | Large frontend chunk and stale browser-data advisories remain. | One affected bundle/tooling check after a source change; no unrelated upgrades. |
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
| OI-068 installed app walkthrough | Linux Chat, Code and builder/run routes; repeat-save, definition refresh and persisted tool errors corrected. | Native Windows and Hermes, active-worker checkpoint/recovery. |
| OI-071 / Manager tray rows | Linux own SNI registration and native Hide. | Open/Exit on Ron's desktop release walkthrough; vault restoration across a real logout/login. No further finder loops. |
| Manager credential presentation | Forget warning DOM cases; vault success/failure/retry component fixture. | Native successful-vault style and actual failed credential deletion presentation. |
| GCHAT-SHARED-APP-ICON | Shared source/icon overlay accepted. | Installed GChat and Manager windows/trays show the same intended icon. |
| GCHAT-HARDWARE-PROFILE-INSTALL | Linux exact-group reuse, interrupt/resume and cancellation. | Native Windows normal/cancel/Host-loss lifetime and MSVC release build. |
| GCHAT-UNIX-PTY-PIXEL-GEOMETRY | Source is merged; Linux TUI/input acceptance covers a different parser fix. | Named pixel-only resize fixture PASS (one case); native geometry/mouse behavior is not qualified. |
| OI-072 model/profile qualification | Historical evidence and source binding audit. | Exact current Muse TP1 C4/131072 NVFP4 KV + Q4 DFlash2 artifact/engine at the scheduled release gate. |
| Google / Microsoft connectors | 36 focused auth/provider/runtime/UI cases. | App registration, real OAuth consent/refresh/revocation and read operations. |
| Gbot Linux executor | Exact desktop overwrite + two actual Cua file evaluators passed. | Broader task set and Vision; new cua-bench dependency closure is not approved. |
| Gbot runtime/media | Linux packaged runtime; physical frame, 440 Hz audio, view-only/takeover/revocation passed. | Browser playback/audio permission behavior; Windows/M365 runtime and media. |
| Gbot guest persistence | Fresh dedicated guest setup, persisted service restart/resume to Ready and product guest/key retirement passed. | Guest reboot/reconnect and installed independent background lifetime. |
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
`readiness-physical/`. Next: installed wizard/bootstrap and background lifetime;
Hyper-V/cloud/M365 and remote service selection remain explicit source gaps.

Coordinator tree: `fix/gbot-readiness-detail-500a` in
`/ai/gchat-worktrees/gbot-browser-physical-2e735`, based on main `13f88c042`, which includes background ownership, seed repair and `ec21a1874` / `e49219967`.
The first wave (opt-in/LAN setup, transactional credential creation, Chat workers,
per-bot connectors and disabled-embedding startup) is merged there. The second wave
integrates schedules (`f769d1ead`), KVM onboarding (`89e4a22f4`) and the complete
updater source (`c36e3862c`). Focused component cases and the combined native route
fixture, frontend types, native check and strict native/service Clippy pass.
Component receipts and `wave2-*` logs are in
`/ai/gchat/out/gchat-open-items-20261012/`. Reuse passing first-wave evidence;
no installed UI, new VM, live OAuth or active-worker recovery qualification is
claimed for these changes. Schedules now belong to the independent service; installed client-exit continuity
remains unqualified. KVM refuses missing
host prerequisites/assets and does not install tools or substitute another PC.

The disabled-embedding startup correction has one focused case and frontend types
PASS (`ann-test.log` / `ann-types.log`). Explicit VectorDB diagnostics remain.
The PTY geometry fixture passes (`pty-geometry-test.log`), without a native mouse
or blank-TUI cause claim. First-wave agent worktrees are retired after main merge;
second-wave source is merged and its owned trees can retire after live-use checks.
User-authorized cleanup retired seven clean merged trees and freed 73.60 GB
allocated Cargo cache; the target is 26.81 GB. Source cleanup freed 1.35 GB apparent
size from the first five trees and 0.55 GB allocated from the final two.
Current closures, accepted packages and evidence remain. Inventory:
`/ai/gchat/out/gchat-open-items-20261012/disk-cleanup.md`.

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
Retain the stopped S1 `/ai/gbot-vms/gchat-linux-accept` disk/clean-os snapshot,
accepted packages and concise evidence as the Linux desktop baseline. The
docs-only candidate is `/ai/gchat-worktrees/oi057-desktop-result-e15`; retire it
after merge. Those subsequent items are now accepted; current implementation
and unrun scope are listed above.

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

Repository `/ai/gchat`, subject `docs/agent-runtime/`, owner GChat coordinator.
Candidate `/ai/gchat-worktrees/oi075-linux-93e2`, branch
`docs/gchat-oi075-linux-93e2`, from reviewed source/documentation `93e2ba9b9`.
The preceding OI-116/118 change is merge-ready; no failing check remains.

Ron/bubbs's October 11 07:05 decision authorizes a generated Linux history matching
the selected twelve-message history's shape: message count, per-message byte
sizes, attachment/code-block kinds and total bytes. Original content is excluded;
no Windows history copy, shared user-data-folder launch or synthetic inference.
Use one isolated folder, run one native WebKitGTK open/programmatic traversal/
30-second foreground idle observation under WSLg, then delete that folder.
The output qualifies the generated Linux/WSLg WebKit workload only, not S2,
the original conversation, cross-OS equivalence, many-message scaling or a gain.

Reuse accepted desktop/frontend `54c931c68`, packaged by `02d369e8a`, from
`/ai/gchat/out/linux/GChat_2.0.42_amd64.deb`; prior X11 extraction/fixture paths
are retired. No rebuild, install, dependency change, model load, calibration or
Windows run is selected. The existing six OI-075 browser phase expressions own
the measurement. Adapt only native inspector transport and process endpoint
counters; unknown WebKit long-task support is unavailable, never zero.
The actual native WebKitGTK 2.52.6 page is `tauri://localhost`, title GChat,
with the Tauri bridge, sole generated sidebar link and a 1200×800/DPR1 viewport.
Its loopback HTTP inspector supplies one WebPage over a persistent WebSocket;
page-target multiplexing and `Runtime.awaitPromise` execute the existing phases.
No inspector window is opened. Fixture-only saved startup flags are off before
measurement; no original settings or data are used.

Acceptance: metadata-only generated shape check, actual native page/build/window
identity, completed opening and full traversal, stable foreground/viewport/
expansion through the30s idle interval, pinned process-group CPU/memory endpoint
counts and observer/process/data cleanup. No new performance floor or cap.
CPU counters use actual monotonic elapsed and PID/start identities; Linux
private resident/PSS retain their meanings rather than Windows private commit.

The one requested observation runs October 11 at 07:20:26–07:20:57 UTC.
Generated shape verification passes: 12 messages, 107,089 JSONL bytes,
101,857 compact content bytes, largest 79,574, reasoning parts, 12 tool calls,
one unknown-language code fence and no attachments. Per-message row/content
sizes match the read-only metadata; every identifier/body/tool payload is
generated. This does not establish equivalent semantic/rendering content.

First sidebar open reaches all 12 wrappers plus another frame in 110 ms; cache
state is unknown, and this is not GPU-present timing. Settled full programmatic
traversal takes 113 ms, six scroll steps, seven retained frame gaps with median
and maximum 16 ms. It does not measure wheel/input latency. Passive browser idle
lasts 30.047 s around the native 30.0001 s sample with no continuous frame sampling;
route, 12 wrappers, viewport, foreground/focus and collapsed expansion remain
unchanged. WebKit long-task support is unavailable, not zero.

Native counters are **partial**. The sampler exits 1 `FAIL_UNSTABLE_COHORT`:
two `bwrap` wrappers and their `glycin-image-rs` image loader are present at the
first endpoint and absent at the second. Their final CPU/memory cannot be
recovered. The three stable processes (GChat, WebKitNetwork and WebKitWeb) use
a summed 2.06616% of one logical core; their private resident bytes are
320,131,072 before and 307,961,856 after. Those are partial-component counters,
not full descendant-group totals, private commit, a peak or a memory-gain claim.
No rendering cause, cross-OS improvement or physical S2 qualification follows.

The runner stops before phase 05 because the sampler rejects the cohort.
Phase 06 cleanup preserves the actual passive idle observation as `interrupted`;
its retained state checks pass. Raw sampler/runner failure remains unchanged;
the derived result is `ONE_REQUESTED_OBSERVATION_COMPLETE_WITH_PARTIAL_PROCESS_COUNTERS`,
not an overall performance-gate PASS. No opening, traversal or idle rerun occurs.
Any future complete-group measurement must finish transient image loading
before its endpoint bracket; it is not part of this one-observation mandate.

Inventory: accepted package and previous Windows results retained. Metadata,
generator/measurement inputs, exact raw observations and derived result belong to
`/ai/gchat/out/remaining-acceptance-20261009/oi075/linux-shaped-20261011/`;
`shape-verification.json`, `result.json`, `native-idle.json` and phase01–04/06
receipts support the scope above. Exact owned application/WebKit/image-loader
identities are absent at 07:21:54.883 UTC; the canonical build guard is returned
and CPU booking 450 cancelled. No GPU/model/Windows run occurs.
After live-reference checks, the entire isolated `fixture/` data/runtime/package
folder is deleted at 07:22:51.536, removing 3,532,132,352 allocated bytes; 508 KiB
of metadata/scripts/evidence remains. `process-return.json` and
`resource-return.json` record cleanup. Shared caches, original conversation/
settings, accepted packages, models and other owners are untouched.
The requested generated Linux/WSLg observation is complete with the stated
counter limitation. Broader original-content, many-message and complete-group
qualification stays incomplete; no new rendering fix is justified by this screen.
Next authorized item after this docs/master handoff: OI-073 app public-delete
control, with its prepared source and unrun focused gates recovered first.

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
attribution claim. Linux native open/scroll/idle remains unmeasured. Preserve the
same selected history and record the actual Linux build/window/workload before
comparison; no numerical performance floor or conversation cap is set. The
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
