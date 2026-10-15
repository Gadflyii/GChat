# GInfer Server Manager

Repository: GChat. Owner: GChat coordinator. Subject: `docs/ginfer-manager/`.
Open defects and TODOs belong in the [master list](../open-work.md); this record
retains Manager decisions, implementation and evidence. The fixed-pool startup
issue is OI-066; remaining acceptance is OI-056 and OI-068 through OI-072.
Installed Windows Manager producer is `574d73df7`, with actual installation,
byte/state and stopped/no-alert presentation evidence below. The accepted Linux
package binds Manager `6b199362d` and Host `257252131`; handoff `09e7b2fb6`
contains their reviewed source and current acceptance account. Earlier package
and Linux evidence remains scoped to its tested producer. The tray diagnosis is closed: native
Linux registration and Hide work; Open/Exit remain owed to Ron's desktop release
walkthrough. No application registration failure was established. Documentation and harness fixes reuse
the accepted binaries.

## Fresh startup quotes — October 15

Merged source `16a338aff` addresses
`GINFER-HOST-PROFILE-DEFAULT-STARTUP-20261015`. Single-instance starts on idle
GPUs and saved-instance Start, Restart and Reload previously bypassed the
placement quote. Selecting a catalog profile could also retain historical KV
bytes after the Host enabled structured outputs, changing startup memory needs.

Every serving start now obtains `ginfer-serve --quote-only` from the selected
runtime with the final GPU group, package, context, concurrency and startup
options, including structured outputs and headroom. Replacements quote after
the old instance stops. No quote is reused across starts, so an Engine build or
settings change is accounted for on the next start. Catalog KV bytes are
historical evidence, not a current allocation: profile selection uses Automatic
unless the user explicitly supplies a byte budget.

Automatic sizing derives an aligned explicit arena from the fresh quote and
passes it only to that Engine launch. The saved request retains Automatic, so
later starts quote and size again. A positive user budget retains its exact
meaning; Host checks it against the fresh quote and refuses an oversized value
before loading the model. Existing saved positive values have no provenance
that distinguishes a user choice from an older derived value. If one no longer
fits, select Custom settings and clear the GPU KV budget to return to Automatic.
Host does not silently shrink an exact request. Changed runtime options do not
inherit historical profile qualification.

Flash with graphs enabled has one bootstrap exception. If a solo Automatic
start has no matching graph-memory receipt, its quote reports an unknown graph
allowance. Host leaves the arena automatic for that Engine start; a successful
Ready receipt then permits quote-derived explicit sizing with the same recipe.
An explicit arena or shared placement requires known graph memory. No unknown
graph allowance is treated as measured capacity.

One merged-Host RTX 5090 startup passes with source `16a338aff` (Host SHA
`d4863c80…`) and Engine `5af502f1`: C1, context 262144, structured outputs on,
unchanged 524288000-byte headroom and a fresh 7080309760-byte effective KV arena.
Saved state retains Automatic. The observed quote and serving arguments match
the selected settings; Ready and normal session-bound Host Stop pass with zero
active requests. The engine reports a maximum request context of 261632 tokens,
below the configured 262144. Owned engine, Host and guard processes are absent
and resource locks are released. This is standalone native Host/Manager API
startup acceptance.

Ada's installed UI startup also passes with production Host `93143951d` (SHA
`66caef75…`) and Engine `5af502f1`: C1, context 149069, structured outputs off,
314572800-byte headroom and an effective 4695700992-byte KV arena after catalog
reselection. Saved state retains Automatic. UI Ready, normal UI Stop and owned
process/resource release pass. The engine reports a maximum request context of
132096 tokens, below the configured 149069. This uses the frozen installed DEB
with isolated Host/runtime replacements. The earlier historical-arena failures
remain retained. Neither startup qualifies inference, full-context capacity or a
fresh installer; OI-068 remains PARTIAL.

The merged production implementation is `93143951d`, unchanged by fixture
corrections. `611fc26e9` passes all
11 plugin tests; `7d92bad30` passes the complete Host suite, with 172 tests passed
and 19 ignored. The composed Linux source gate passes using these full affected
suite reruns and retained passing `make verify` targets from `93143951d`.
This is a composed gate, not one final `make verify` invocation.
The [runtime acceptance record](../agent-runtime/remaining-acceptance.md#oi-068-native-near-full-context-startup--october-15)
links the startup, Stop, cleanup and verification evidence. A quote samples free
memory and planner allowances; it does not reserve VRAM, guarantee startup
against other allocations or qualify full-context inference.

## Shared first-run setup — October 15

`FIRST-RUN-WIZARD` and `MODEL-STORAGE-FASTEST-DISK` share one Host-owned workflow on branch
`feat/gchat-shared-first-run-wizard`, based on `3681810c4`. Linux installer
continuation, Manager's **Set up local GInfer** and GChat Welcome use the same
durable state. The sequence is explicit GPU-group selection, native profiling,
storage selection, published package selection and download, startup review, then
completion. No GPU is selected automatically. Selected release identities are
saved before download admission; reopening a client resumes partial admission and
existing jobs. The workflow saves instances stopped and leaves Start explicit.
See the [decision](../decisions/2026-10-15-own-first-run-setup-and-measured-model-storage-in-host.md)
and [operator steps](guide.md#complete-local-setup).

Authenticated `GET /host/v1/first-run` returns `step`, `gpu_uuids`,
`hardware_profile`, `storage`, `models`, `selected_downloads` and
`startup_profiles`. Storage includes the requested `path`, `recommended_path`,
live `available_bytes`, existing downloads and candidate eligibility/reasons.
`POST /host/v1/first-run` accepts these actions:

| Action | Inputs and behavior |
| --- | --- |
| `profile` | Explicit `gpu_uuids`; require a compatible supported group of 1, 2 or 4 GPUs and prepare its saved native profile. |
| `storage` | Absolute `path`; persist a writable native managed-download root. |
| `move` | Installed managed `download_id`; explicitly move it to the selected storage root, rejecting active sources. |
| `refresh_catalog` | Refresh the configured published release catalog. |
| `models` | Exact `release_ids`; durably retain selection and admit compatible downloads after a live capacity check. |
| `resume` | Continue interrupted profiling, download admission or startup review. |
| `startup` | `download_id`, `concurrency`, `max_context`, `instance_count`, optional `kv_arena_bytes`; obtain a fresh Engine quote. |
| `complete` | Save reviewed startup configurations as stopped instances. |

Storage ranking reads native `schema_version: 2` disk rows, using
`disks[].sequential_read.value` in bytes/second only when its status is
`measured`, `direct_io` is true and `sequential_read_supported` is true. Saved
filesystem UUID, model and a live serial when available must match the actual
disk; a path or device number alone cannot authorize reuse of a rate. Live free
space, a native filesystem check and a temporary zero-byte write check determine
eligibility. Unmeasured, replaced, ambiguous, full or unwritable candidates show
their reason. There is no recommendation-time read benchmark. A requested root
on the winning filesystem keeps its exact path; another measured disk offers
`<measured-directory>/ginfer/models`. A writable native override remains available.
WSL Windows-backed storage is ineligible for managed placement.

Changing storage leaves existing models at their current locations. An explicit
managed move copies and syncs into owned staging, verifies size, SHA-256 and
artifact identities, publishes without overwriting a target, and commits the
download journal durably before deleting the original. Host retains its lifecycle
lock through an admitted move even if the calling client disconnects. The original
inventory UUID and saved instance references survive relocation and restart.
External discovered models are not moved by this action. An error before journal
commit retains the original; an error removing it after commit reports the
remaining copy.

Model suggestions use saved native RAM/VRAM facts and current disk capacity.
Startup review uses Engine `ginfer-serve --quote-only` for each package's own
context, concurrency and instance count. These are per-package estimates; they
do not qualify simultaneous placement of all selected packages or full-context
operation. Changing settings requests another quote. Finishing setup does not
start inference.

Candidate `bbcf3e3d3` passes composed `make verify`, including the frontend gates
and 865 Rust tests; affected all-target Cargo check and Clippy also pass. Focused
Host workflow, storage and managed-move tests pass on S1, including move
cancellation and inventory identity across restart. The existing CPU-only Engine
`hardware_profile_reader` CTest passes from source `09aadd9c5`.

Both opt-in Linux native tests pass against the same saved profile after the
authorized disk-only refresh from merged Engine `16e5aca45`, which contains the
tested warning-preservation fix `38b8dce5d`. Its two distinct live filesystems have
genuine saved direct-I/O read rates: NVMe 7,252,739,669 bytes/second and RAID
1,178,470,152 bytes/second. Live identity, free-space and write checks select the
eligible NVMe disk; the recommendation API retains exact override paths on both
filesystems without creating directories. One actual Host storage override leaves
the existing model untouched until an explicit move. The cross-filesystem move
verifies a valid 4,096-byte package and retains its inventory UUID and saved stopped
instance references across Host restart. These tests execute no model or GPU work;
the rates are storage-policy inputs under recorded background build and C1
activity, with no isolated performance or inference speed comparison claimed.

The protected donor remains unchanged. Strict non-disk equality passes: only disk
rows, the exact `disk_elapsed_seconds` and `disk_timestamp_utc` source stamps, and
the exact obsolete `/mnt/ssd2` unmeasured-disk warning are excluded. Every other
field and saved warning value, order and count remains exact, including CPU, GPU,
NUMA, calibration and fingerprint data. The passive CPU/NUMA diagnostic remains
visible in producer output without being added to saved warnings. Both Host tests
leave the refreshed profile unchanged.

The earlier Engine `265514f0a` capture remains historical: both functional tests
passed, while strict warning preservation failed because an additional CPU/NUMA
diagnostic was saved. That capture is retained unchanged beside the newly
authorized corrected-source result; no profile was manually edited. New evidence
uses `warning-fix-*` receipts under
`/ai/gchat/out/first-run-wizard-20261015/`. Linux acceptance passes and the GChat
candidate awaits merge. Windows shares this implementation's source; no new
Windows binary or runtime acceptance is claimed.

## Multiple instances on one GPU — October 15

Active `MULTI-INSTANCE`, Gchat, deadline 17:00Z. Candidate
`/ai/gchat-worktrees/manager-multi-instance-c8d`, branch
`feat/gchat-manager-multi-instance-c8d`, starts from main `9a25287a4`.
Manager must place N copies of an installed package on the selected GPU group,
each with its own identity, port and per-instance concurrency. Existing instances
retain their allocations. The Engine's `ginfer-serve --quote-only` owns the
startup memory facts; Host reserves each remaining sibling's weights/state/graph
requirement and headroom before splitting the remaining KV equally. Manager
keeps Automatic selected throughout the batch; Host freshly splits the current
remaining capacity at each placement. A user may instead enter
an explicit KV byte budget per new instance. Startup is serialized through Ready
so the next quote sees the preceding allocation. A changed KV allocation is a
custom deployment and does not inherit the profile's qualification claim.

For Flash, Custom settings also expose the Engine's per-rank weight residency
budget in bytes; this covers dense/expert weights, with KV, state and graphs
accounted separately. Shared placement requires that explicit budget and a
matching graph-memory receipt. Start the package once by itself with the same
GPU group and settings, wait for Ready, then place instances with those settings.
Host retains the maximum graph allocation reported per rank and persists the
maximum across ranks only after Ready. Changing the startup recipe or the
artifact/runtime/hardware-profile file metadata invalidates the receipt. An
unknown graph allowance produces an actionable error before a shared launch.
Flash quotes are supported by this contract; Flash native acceptance remains
separate from the Qwen gate below.

The replaced restrictions are `service.rs::prepare_launch` (GPU group reused as
instance identity), startup duplicate consolidation, and
`engine_host.rs::validate_launch` (GPU overlap refused along with port overlap).
New starts receive fresh identities; explicit existing IDs select lifecycle
operations, and live instance/port conflicts remain errors. Package publication
qualification is evidence rather than a package/GPU admission rule: INT and SMOL
are selectable on every supported family; NVFP4 requires Blackwell sm_120.
The [shared-GPU instance decision](../decisions/2026-10-15-place-independent-instances-on-shared-gpus.md)
supersedes the September one-instance-per-GPU-group decision.

Focused Host process/HTTP placement and Flash receipt tests, all 39 Manager DOM
cases, strict Host/Manager Clippy and full `make verify` pass on this candidate.
The full gate passes 2,309 root tests, 114 extension tests and 848 Rust tests
(6 JavaScript skips and 25 Rust ignores). The two stale Host assertions about
spawn argument order and occupied catalog groups are fixed in `e0bd23014`.
The Ready compatibility follow-up uses Engine `019ad0c92` without its removed flag.

Native acceptance passes on S1 PRO GPU 0 using the actual Manager Start form:
four independent Qwen 27B INT instances, all Ready, ports 40317 / 45371 / 33107 /
43993, each with context 8181, C4, INT8 KV, DFlash fixed K7 and explicit KV
1,564,135,168 bytes. Four concurrent native GBench C4 requests through the Host
proxy each use prompt 2048, output 500, one warmup and one measured round.
All 16 phase waves pass: 32,000 output token IDs have the expected lengths and
match exactly across corresponding lanes of all four instances. HTTP execution
overlaps by 26.82 seconds and measured warm generation by 3.61 seconds. All four
retain their original Ready sessions with zero active requests afterwards, then
stop normally through Manager; no engine children remain.

Evidence: `out/multi-instance-manager-20261015/native-validation.json`, native
Start/Ready/Stop receipts and the retained `s1/` native v2 reports; full gate log
`out/multi-instance-manager-20261015-placed-ready-build-verify.log`.
This is the requested four-server C4 shared-GPU acceptance with explicit KV,
not the standalone C8 Max Perf scoreboard or a GChat leaderboard submission.
No speed comparison or Flash native acceptance is claimed. Existing artifacts,
the shared locked Rust cache and C3's handed-over Engine cache were reused.

## Shared pool capacity

A pool member's `worker_limit` caps the aggregate workers using that instance
across all GChat clients. Issuing another client grant adds no capacity. When
multiple pools reference an instance, its lowest configured limit applies.
The coordinator admits each worker before tools or inference; a full instance
queues the caller. Completion, cancellation or client disconnect releases the
admission, and losing its live connection cancels the worker. See the
[coordinator admission decision](../decisions/2026-10-15-admit-pool-workers-at-the-coordinator.md).

The October 15 OI-069 native Linux gate passes on two independent workstations
with distinct grants: one shared slot, cross-client queuing, queued cancellation,
release and both final replies. The served instance retained concurrency 3;
its pool worker limit was 1. The focused two-client TLS test, Rust check,
strict Clippy and rebuilt desktop/Host also pass. See the
[acceptance record](../agent-runtime/remaining-acceptance.md#accepted-oi-069-independent-workstation-capacity)
for producer hashes, evidence and full-suite limitations.

## Idle draft-width calibration

`GCHAT-DRAFT-WIDTH-SETUP`: Host queues native calibration for saved AUTO DFlash deployments after their exact GPU group has a complete hardware profile.
Artifact/runtime, GPU group, context, concurrency, TP, KV, graph and Vision changes queue a new recipe; no saved profile means no guessed calibration.
Launches cancel and reap calibration first; interrupted jobs resume queued, completed jobs persist, and failures remain visible in GChat and Manager.
The engine owns the calibration corpus (mixed real text), policy and matching record; its shipped default applies until that record exists.
Source gate: 4 Host cases, 1 Manager case and 1 Chat case PASS; TypeScript, affected lint and strict Host Clippy PASS.
Evidence and owned inventory: `out/draft-width-setup-20261014/result.json`; [decision](../decisions/2026-10-14-own-idle-draft-width-calibration-in-host.md).
Candidate `/ai/gchat-worktrees/draft-width-setup-4884`, branch `feat/gchat-draft-width-setup-4884`, retains the saved deployment recipe and composes with accepted main `f3d77b8f0`. The native gate reuses the shared Host build cache and C2’s tested SM80 CLI; no model copy is allocated.
Native Host gate PASS: S2 CMP 170HX, saved TP1/C8/8181/INT8 deployment, using merged capacity fix `43d524da2` (`7d80cd51f`). The unchanged native mixed-real-text corpus completed in 434.74 seconds; Host persisted the calibration record and completed job with no child PID or error. The isolated Host stopped normally, guards returned and its test root retired. Evidence: `native-result.json` and `native-cleanup.json` under the result folder above. Next: review and merge this candidate. Windows normal/cancel/Host-loss lifetime cases remain owed to the release gate.
No new dependencies, model copies, native Windows build, release or publication.

## Ready waits for completed placement

GInfer `019ad0c92` owns settled Ready on every supported card. Host no longer
injects the removed `--wait-for-residency-fill` flag or chooses a startup policy
from GPU names or VRAM size. Custom, catalog, restored and GBench Max Perf
launches use the Engine default. An explicit `progressive_ready` launch option
maps to the Engine's `--progressive-ready` opt-in; omission waits for placement.
This supersedes the October 14 small-VRAM Flash and earlier selected-CMP rules.
Source checks cover default and explicit opt-in argv through restored launches
for dense INT and all Flash weight classes on small, CMP and PRO fixtures.
Engine physical qualification remains owned by the Engine lane.

## Accepted native credential cleanup warning — October 15

`GCHAT-MANAGER-FORGET-CREDENTIAL-WARNING` is closed for its original Linux
Manager presentation scope. Source `b6bc99f2f`, finalized by `82e6411b2`, is
incorporated in current main. The existing two owning DOM cases remain accepted
(2/2, 566 ms): successful host removal with a warning, persistence across unrelated
snapshots and refresh errors, and ordinary null-warning success.

The remaining native failure gate passed at **2026-10-15T10:14:57.764Z** using
retained standalone Manager/Host binaries from accepted source `0705f31a6`.
Their SHA-256 values match the existing Linux package receipt:
Manager `6e4e76e853cfe670c79f54596a477f63f5805ad6302136c0e0a1240cca88dc1c`;
Host `7c15bba0e5f3e9a53d07552bb15ab9a15ab598ea7e600d7b8b47d7bf788ee659`.
The Manager embeds the exact fixed UI bytes. No rebuild was needed.

Actual native Pair saved one remote host and a credential in a private, unlocked
Secret Service. Reloading that private D-Bus session's policy denied only
`org.freedesktop.Secret.Item.Delete`; it kept the session alive and used the
unchanged native vault. Ordinary **Forget this host → Forget host** removed saved
metadata from one host to zero and rendered **Host forgotten** together with
**OS credential cleanup needs attention: Platform secure storage failure: DBus
error: Rejected send message…**. Both remained through automatic native
snapshots. The credential still existed after Forget, independently confirming
the deletion failure. Responses were not mocked.

Setup corrections are retained in the result: a loopback-only standalone Host
correctly refused pairing before ordinary discoverable sharing was enabled;
disconnecting the initial private bus exited Manager before Forget was reached.
The corrected live-session policy gate ran the Forget action once. Afterward,
the scoped grants were revoked and the orphaned private credential was deleted
through Secret Service after restoring the private policy. Exact owned native
processes/helpers were terminated and private state retired (100,876 bytes).
CPU bookings 713/714 were returned; the physical desktop keyring was untouched.
Window-close/Exit and tray behavior are not qualified by this gate.

Evidence: `out/manager-forget-native-20261015/{result.json,summary.md}`;
original focused evidence: `out/manager-forget-credential-warning-20261011/result.json`;
package receipt: `out/oi057-linux-packages-20261011/manager/SHA256SUMS`.
The accepted shared baseline binaries remain in `src-tauri/target/release/`.
No source/test change, model, GPU workload, package-manager install, newer
credential-tier, Windows, signing or publication qualification is claimed.

## Linux AppIndicator dependency deprecation

`GCHAT-LINUX-APPINDICATOR-DEPRECATION`: closed by the approved dependency decision; warning retained.
Locked `tray-icon` 0.21.3 → `libappindicator`/`libappindicator-sys` 0.9.0 calls Ayatana's deprecated constructor, which emits the retained warning unconditionally ([owning source](https://github.com/AyatanaIndicators/libayatana-appindicator/blob/master/src/app-indicator.c)).
The [replacement API](https://github.com/AyatanaIndicators/libayatana-appindicator-glib/blob/main/src/ayatana-appindicator.h) requires `GMenu`/`GSimpleActionGroup`; the current backend passes `GtkMenu`, so changing a library name cannot deliver the migration.
Dependency decision (approved October 13): keep Tauri's current tray backend and `libayatana-appindicator3-1` for this release. `tray-icon` 0.21.3 and its `libappindicator`/`libappindicator-sys` 0.9.0 Rust wrappers are MIT/Apache-2.0; the [legacy Ayatana indicator API](https://github.com/AyatanaIndicators/libayatana-appindicator/blob/master/src/app-indicator.h) offers LGPL-2.1/LGPL-3.0. The existing loader prefers Ayatana and falls back to Canonical `libappindicator3-1`; neither needs a crate change, and disabling `backcompat` does not migrate the API or remove Ayatana's warning. Returning to Canonical is a legacy dependency choice, not the replacement API. The [new Ayatana GLib API is GPL-3.0-only](https://github.com/AyatanaIndicators/libayatana-appindicator-glib/blob/main/src/ayatana-appindicator.h); adopting it requires new Rust bindings/backend work, `GMenu`/`GSimpleActionGroup` export, and [runtime `libayatana-appindicator-glib2` plus build package `libayatana-appindicator-glib-dev`](https://github.com/AyatanaIndicators/libayatana-appindicator-glib/blob/main/debian/control). There is no existing Tauri feature switch for that migration. Its GPL license is outside our approved closure. Keep the working tray and visible warning; revisit a permitted backend when approved. No dependency, package or runtime change is authorized by this note.
Docs-only disposition; `git diff --check` passes. Evidence and owned source inventory: `/ai/gchat/out/gchat-focused-burndown-20261013/appindicator/result.json`.

## Closed Linux tray registration diagnosis

`GCHAT-MANAGER-LINUX-TRAY-NO-SNI` is closed by the October 11 15:44Z decision:
**Linux tray works; Open/Exit owed to Ron's desktop release walkthrough.**
No further tray gates or application builds are authorized for this item.
Source baseline is accepted Manager `6b199362d` and Host `257252131`, composed
into handoff `09e7b2fb6`. The corrected harness is merged to main at `abc02aae3`. The clean, pushed
`/ai/gchat-worktrees/linux-tray-registration-09e` candidate is retired; its
`fix/gchat-linux-tray-registration-09e` branch and evidence remain in Git.
Subject authority is this folder. Evidence remains in
`out/linux-tray-registration-20261011/`.

Original retries 874/877 falsely report missing ownership: GNOME serializes
registrations as `service@/object/path`; the old helper passes `service@` to
GetNameOwner and discards the failure before PID matching. Those absence claims
are invalidated. `scripts/ginfer_sni_identity.py` supplies the corrected shared
parser; its three focused cases pass. There is no demonstrated app registration
failure and no product patch or rebuild.

FIFO 882 at 14:42:55–57Z proves fresh exact-Manager SNI registration and native
Alt+F4 Hide while the Host remains alive. Its accessibility finder excludes the
actual Shell Window root; FIFO 885 at 15:19:39–41Z corrects that traversal but
still excludes the tray's Menu role. GNOME 46 assigns PanelMenu.Button its
accessible name and Menu role. These are probe failures, not failed product
Open/Exit actions. The superseded accessibility iterator and fixture are removed
from the current candidate. Earlier passing traversal evidence stays historical.

The one approved public-contract gate is **FIFO 888**, not 887. It runs
15:38:41.895–15:38:43.288Z with unchanged accepted binaries. Fresh SNI `:1.384`
belongs to exact Manager 3897905; Host 3897869 remains alive until cleanup.
The harness stops at `s2-tray-contract.py:276`, whose unconditional preflight
asserts Activate has signature `(ii) -> ()`. It records no actual signature.
WMClose, Activate, Open and Exit are all **unreached**; no method behavior is
qualified by this run. The installed Ayatana library exposes a different SNI
method inventory, including no Activate method; the failed live introspection
response was not retained and is not claimed as a measured signature.
The concrete execution correction is to stop assuming optional provider methods
and retain provider observations before an assertion. This item does not launch
another probe to obtain them.

All three gates preserve the four original configuration/binary fingerprints,
stop their exact owned processes and shut down the Host normally with code 0.
FIFO 888's retained `native-888-evidence/root-lifetime-audit.json` confirms both
child PIDs and launcher/controller PIDs are absent, their process group is empty
and private port 17443 is free. Its 11 raw evidence files match retained copies.
Raw 882/885 evidence, watcher-format and Shell-traversal diagnosis remain linked
beside the controls. No model, calibration, Pair, Windows change or user-data
write occurs in this item.

Owned inventory: the source candidate is merged and retired. Retain the accepted
four-file baseline archive and concise cited evidence. The disposable S2 882/885
fixtures are retired after lifetime audits, freeing 35,692,544 available bytes
combined. The FIFO 888 fixture is retired at 15:46Z after evidence retention and its
scoped lifetime audit, freeing 17,817,600 available bytes. Its retirement receipt
retains the audit scope. Total S2 fixture retirement frees 53,510,144 bytes. Shared tray files, models,
profiles and other owners' paths remain intact. Next work is the structured
ON/OFF pair with C1's current-tip runtime; Open/Exit is a release walkthrough
obligation, not a pending development gate.

## Current S2 pairing and tray acceptance — OI-069 / OI-071

Repository `/ai/gchat`; subject `docs/ginfer-manager/`; baseline main `058702dd8`.
Candidate `/ai/gchat-worktrees/s2-acceptance-058`, branch
`fix/gchat-s2-acceptance-058`, composes the reviewed tray source with current main
at pushed `6b199362d`. Component check, strict Clippy and Manager build pass;
the exact four-file package and its accepted Host `257252131` are verified.
No Windows, release, signing, calibration or model copies are included.

Native GChat pairing on S2 passes using the actual Secret Service. FIFO worker
878 starts the private Host and GChat in Ron's active X11 session 8475. Pair
at 12:50:42Z issues client `789bcdb4-4fa1-4618-8dc4-a9803adb430f` for the private
local coordinator. Ordinary Close exits 0; the tracked restart at 12:51:53Z
preserves the private XDG scope and saved grant. The restarted process retrieves
an authenticated snapshot at 12:56:23Z using the same Host, client, certificate
and origin. Its client last-seen time advances beyond the restart time; no
second Pair is performed. This qualifies native GChat saved-grant restoration,
not Manager tray interaction or local WSLg remote pairing.

Ordinary Forget at 13:02:20Z returns no credential cleanup warning. UUID-scoped
Secret Service metadata changes from one item to zero at 13:03:05Z, and the
coordinator's ordinary revoke endpoint removes only that disposable grant.
No secret contents are inspected. The worker's final normal Close and graceful
Host shutdown finish at 13:03:37Z. Final process/port verification passes; retained
small evidence is recorded in `out/s2-acceptance-20261011/native-worker-evidence/`.
This successful native cleanup does not exercise the credential-deletion error
branch. The separate Manager presentation correction is covered by the focused
DOM cases above; main integration and installed presentation remain unclaimed.

Linux Manager tray registration and native Hide are accepted by the October 11
15:44Z decision. Original 874/877 missing-registration claims were probe false
negatives. The closed diagnosis above retains corrected 882/885 evidence and
FIFO 888's preflight failure. Open/Exit remains owed to Ron's desktop release
walkthrough; no further development tray gate is scheduled.

The real two-worker gate is blocked before Ready. Exact clean GInfer `66452662d`
builds its app-only SM86 server in FIFO 872 at 12:22:41Z; its native ELF closure
resolves without a donor overlay. It uses the in-place v3 SMOL artifact and
complete 3090 v2 profile. Its unchanged C1/131072/INT8/fixed3 MTP/AUTO-arena
launch fails at 13:00:26Z with `Flash actual Host owners cannot preserve
whole-host RAM headroom`. No S2 inference or shared-worker qualification follows.

The local accepted `670` runtime also fails expert-refill startup at 12:59:40Z:
CUDA free 936,992,768 bytes is below the configured 1 GiB headroom. Its model
exits and both canonical locks return at 13:00:22Z. This older runtime predates
the current startup fixes; it is historical evidence, not a new current-engine
claim. The 13:01Z decision authorizes exactly one unchanged local launch with
C3's accepted `candidate-ready-quote-4c63-120a/apps/ginfer-serve` and its matching
sibling library closure (source-equivalent to `8317c64f2`). That launch reaches
Ready with exactly the same request settings and stops normally at 13:12:28Z;
both guards are reacquired/released and booking 496 is cancelled. No inference
claim follows from this startup check. The old local failure is not current.
Next unresolved action: C3 diagnoses the saved current S2 RAM-headroom failure;
full shared catalog/assignments, simultaneous two-host dispatch, saturation,
cancellation and disconnect/recovery require two actual Ready instances.

The local WSLg client uses its genuine service-owner local grant; S2 uses its
native-vault grant. Both see the same coordinator before models are Ready.
That observation does not qualify assigned pools or real worker dispatch.
No instance IDs, capacity witnesses, model settings or limits are fabricated.

Evidence: `/ai/gchat/out/s2-acceptance-20261011/` contains source/package gates,
`serve-664-build-verified-readonly.json`, `s2-pair-restored.json`,
`s2-native-forget.json`, `paired-grant-revoked.json`, `local-model-status.json`,
`s2-model-status-final.json`, and the two native evidence subfolders.

| Owner / host | Exact path | Purpose / retention |
| --- | --- | --- |
| GChat coordinator / local | `/ai/gchat-worktrees/s2-acceptance-058` | Current candidate; retain until reviewed integration |
| GChat coordinator / local | `/ai/gchat/out/s2-acceptance-20261011` | Concise gate evidence and current UI candidate; retain accepted evidence |
| GChat coordinator / S2 | `/mnt/data/ai/gchat-oi071-pair-tray-20261011` | Retired after native process/port audit and local evidence retention |
| GChat coordinator / S2 | `/mnt/data/ai/gchat-oi069-serve-66452662d` | Retired; clean source is an ancestor of official dev/next, failed runtime evidence retained |
| GChat coordinator / S2 | `/mnt/data/ai/gchat-oi069-worker-20261011` | Retired after grant cleanup and retained cited evidence; no user data |
| GChat coordinator / local | `/ai/gchat/out/s2-acceptance-20261011/local-worker` | Retired after ordinary app/Host exit; public configuration receipts retained in local-evidence/ |
| C3 / local and S2 | Exact artifact/profile/runtime paths in evidence | Read-only borrowed prerequisites; never delete |

Cleanup completes after both native apps/Hosts exit and owned listeners close.
The S2 source/build/fixtures free 4,971,196,416 available bytes; private local
fixtures and staging copies are removed separately. Cited small evidence,
accepted desktop baselines and the corrected UI candidate remain. Models,
profiles and other owners' paths are untouched. The copied source's stale S2
remote is not used as ancestry authority: its clean commit is verified against
the official GInfer dev/next reference before deletion. Receipts are
`s2-retirement-result.json`, `local-retirement-result.json` and
`native-worker-evidence/source-retirement-authority.json`.

Source review also identifies a separate Host settings mismatch: the zero
`host_kv_cache_bytes` request is omitted from argv, so current Flash selects an
AUTO prefix pool instead of explicit disabled zero. It is recorded as
GCHAT-HOST-ZERO-PREFIX-CACHE. This is not established as the S2 startup cause;
no setting, argv fix, guard or additional run is applied in this gate.

## Structured outputs in Host deployments

Current item: `GCHAT-STRUCTURED-OUTPUT-ENABLEMENT`, approved October 11.
Deliverable: agent-capable Host deployments enable the existing Engine
structured-output flag by default, with an explicit saved deployment setting to
disable it. GChat and Manager expose the same control. Ron has now selected
Engine/CLI default ON with an explicit off flag; C1 owns that Engine change. An omitted Host setting means ON, and explicit
OFF survives profile save, reload and restart. A preset override must retain
model/GPU/payload validation and stop claiming qualification when its options
differ from the recorded catalog. Historical profile evidence does not qualify
this changed startup setting.

The touched-file audit also identifies `GCHAT-HOST-ZERO-PREFIX-CACHE`: an omitted
Host cache limit selects AUTO, explicit zero disables it, and a positive value
selects exact bytes. Preserve those three values through API, saved deployment,
UI and argv instead of filtering zero out. This mismatch is not an established
cause of the separate S2 RAM-headroom failure.

Acceptance: focused Host argv/default/persistence cases, then one real
schema-valid request with structured outputs ON and the same otherwise-valid
request receiving the typed disabled rejection with OFF. Existing small owning
UI cases cover the explicit controls; no full suite or model matrix. Use one
isolated Linux Host and the accepted local SMOL artifact/profile/runtime in
place; keep admission guards, context, concurrency, KV dtype and speculation
unchanged. No Engine build, hardware calibration, native Windows change,
installer/release/signing/publication or Gbot implementation.

Owned candidate: `/ai/gchat-worktrees/structured-outputs-058`, branch
`fix/gchat-structured-outputs-058`, baseline main `058702dd8`. Evidence and accepted
Host build belong in `/ai/gchat/out/structured-output-20261011/`; retain concise
results and the accepted build, retire the private state after normal stop.
Source `e65778645` is frozen. Three exact Host cases PASS (argv/serde,
validated preset/save/restart/reopen, recorded catalog defaults), plus five
GChat and seven Manager cases. Strict Host/plugin Clippy, plugin check,
affected frontend lint/typecheck and the Linux Host build PASS. Retained Host:
`/ai/gchat/out/structured-output-20261011/accepted-host/ginfer-host`;
[focused results](../../../out/structured-output-20261011/host-gate-result.json)
and [UI results](../../../out/structured-output-20261011/frontend-manager-acceptance.json).

The real pair is unblocked by C1's Engine fixes merged as `a59c489ad` on October 11.
The earlier Flash mask-width failure expected 7760 padded words but supplied 7753
semantic words; the old `4c63` runtime is excluded from this gate. Its Ready/Stop
evidence did not qualify constrained sampling.

Real acceptance **PASS** at 16:02:34–16:03:37Z on the local RTX 5090:

- ON omits the Host setting; actual argv includes `--structured-outputs`.
  The single strict-schema request returns HTTP 200 with `{"ok":true}` and
  `finish_reason: stop`.
- OFF explicitly saves false; this tested Engine receives no enable flag.
  The same request returns HTTP 400, code `structured_outputs_not_supported`,
  type `invalid_request_error`. Saved OFF remains false.

The accepted Host uses C1's clean Release/SM120a server `2cc592d46`, containing
`a59c489ad`, with its receiving loader closure. Runtime location:
`/ai/kernel-agent/run_workdir/local/c1-structured-io-check-20261011/gchat-sm120a-2cc592d46/apps/ginfer-serve`.
Actual process executable and mapped providers agree with C1's nine-file loader
receipt. Both cases preserve the same in-place SMOL artifact/v2 profile and
TP1/C1/131072/INT8/fixed3 MTP/AUTO arena/1 GiB device headroom, graphs ON and
explicit disabled Host prefix cache. Only structured-output enablement differs.
This is a functional check, not model quality, speed, release or full-context
qualification.

The first controller attempt stops before a schema request: Start correctly
returns HTTP 202 Accepted, while the harness expects 200. The owning API also
requires a JSON object for Stop. The control is corrected against
`service.rs:1941–1948` and `body_json`; failed-attempt evidence is retained in
`attempt1-accepted-status/`. No product or model setting is changed. The real
pair then runs once; passing source/component cases are reused.

Ordinary Stop leaves both exact Engine PIDs absent between cases. Host exits 0,
its private listener closes, both canonical guards return and booking 507 is
cancelled. Private Host state and generated credentials are retired after the
root audit; accepted Host, cited public results, borrowed runtime/model/profile
sources remain. Evidence: `out/structured-output-20261011/{live-pair-result.json,
on-response.json,off-response.json,saved-settings-observation.json,
runtime-binding.json,private-fixture-retirement.json}`.

The 15:52Z decision approves the unchanged product Host AUTO launch; the
schedule's explicit Host-RAM flag guidance governs engine bench runs. This
runtime's documented default is flat 4 GiB, not the older 25% formula. The
existing controller retains the local emergency backstop, finite deadline and
exact process/lock lifetime. There is no wrapper or new Host setting.

Next action: reviewed main integration of this accepted change. Ron's subsequent
Engine-default-ON decision requires Host false to emit C1's explicit off flag;
the tested `2cc592d46` still defaults OFF. Coordinate that flag mapping with C1
before the new Engine default becomes the product runtime. These results do not
claim that a saved OFF works by omission against a default-ON Engine. The Linux
tray diagnosis is already merged/closed; Open/Exit is owed to Ron's desktop
release walkthrough. Gbot's design is approved separately, with source-only
SSH/vault/session work allowed while development VMs await setup.

## Accepted hardware profile installation

Deliverable: one Host-owned resumable profile-v2 job, invoked by the GChat
installer and hardware-inventory refresh, visible in GChat and Manager. Model
launches are held while it measures; ordinary Engine startup only reads the
saved profile. Use the existing producer's matching-profile fast path and
durable `<output>.install-state.json` resume without replacing it with a partial
accepted profile. Explicit authenticated inventory Scan runs Ensure for saved
groups. At Engine launch, the existing reader fingerprint rejection marks the exact group stale;
the UI offers an explicit re-profile action. No automatic change detection,
periodic profiling or duplicated fingerprint implementation is claimed.
Keep exact invocation inputs, including `--reprofile` when an interrupted forced
refresh must resume. The producer owns fingerprint/completeness decisions.

Approved October 11 gates: focused Host, installer and UI fixtures; one installed
local5090 invocation reusing its existing complete v2 profile; one short bounded
measurement interrupt/resume check. No full calibration, model/full-context
qualification, publication/signing, new dependency or Engine measurement recipe
change. CPU/GPU booking covers only actual measurement. C3 has already validated
complete 22–73 minute installs; paths and source authority are in
`/ai/coordination/flash-next/profile-v2-paths.md`.

Candidate `/ai/gchat-worktrees/hardware-profile-install-e91`, branch
`feat/gchat-hardware-profile-install-e91`, baseline main `e91c7c136`; source
`d2994568f` is committed and pushed. Reuse the accepted OI105 node/core graph
read-only. Focused evidence is retained in
`/ai/gchat/out/hardware-profile-install-20261011/`.
October 11 ownership correction: mixed-SM hosts use profiles bound to an exact
selected device group and its compatible CLI image, not a merged all-host
profile. The architect binds exactly one configured deployment: its visible GPU UUID
set (TP1 or its homogeneous TP group), with a canonical profile under the Host
profile root keyed by the sorted UUID set. This is a Host deployment binding:
the v2 reader fingerprints sorted physical inventory and checks selected-rank
membership; it does not enforce exact deployment-set equality. C3 supplied the
accepted full v2 CLI closure. The Host preserves the exact visible GPU set, runtime,
output and
forced-refresh setting through interruption; selected launch order remains a
deployment input, not a separate profile identity. Ordinary snapshot polling stays
read-only. New jobs retain failed checkpoints in their original workspace;
only a producer-completed profile can replace the accepted group profile.

Source review corrected crash lifetime, configured-path propagation, forced
refresh recovery, publication-only retries and post-spawn queue ownership.
Stale detection matches the actual native diagnostic's inline suffix and the
launched profile path. The first-install bootstrap shares the desktop path
resolver, retaining custom data folders and registered providers. Fresh installs
prepare Host/runtime and display **Choose GPU group**, without
a default even on a one-GPU machine. The user explicitly selects an ordered,
same-SM group, sees the expected duration, saves that deployment and starts its
one job. Existing deployments install the saved exact group; no combinations
are enumerated automatically. A model is not admitted without that group's
complete profile. Recent complete installs took 22–73 minutes; this integration
does not shorten the recipe. The installer waits only for verified file setup
and Host handoff, not the long calibration.

Explicit Scan and installer preparation process only saved deployment groups,
serially under one reservation. Cancel retains the current recipe and pending
groups; Resume continues them. Reader rejection is matched to the launched
group's actual profile path. Profiling status is separate from model-capacity
qualification.

The October 15 [fresh Linux acceptance](../agent-runtime/remaining-acceptance.md)
uses the retained DEB's native first launch with empty managed data. Automatic
runtime installation hands off to a live Host and returns `idle` until an exact
GPU group is selected, consistent with this contract. The booked local 5090 was
then selected through the packaged native preparation command. Its first
Host-owned job completed and published schema v2 in 725.317 seconds, with no
error or pending/stale groups. The private fixture and booking were retired.
This qualifies the native payload handoff and CLI selection path; desktop
GPU-picker interaction and system package-manager installation remain separate.

Focused frontend checks pass: five hardware-profile UI cases, one picker guard,
six typed IPC cases, four Manager cases and one Linux installer fixture. A
Manager expression syntax error and a Vitest hook returning its IPC mock were
fixed before the affected reruns; passing unrelated cases were reused. Focused
frontend/Manager lint and frontend type checking pass. Shared status helpers now
live outside React component exports, removing the Fast Refresh warning.

Focused native proofs pass: six Host lifecycle/publication/queue/stale checks,
one registry check, one GPU configuration preservation check and two owning
installer checks. Host/Manager strict Clippy, GChat CLI checking and Linux-hosted
Windows GNU checking pass. The native test helper and one MSRV-compatible
Clippy correction were fixed before the affected checks.

The first installed Linux handoff failed before profiling: the Host exited with
`Address already in use (os error 98)`. Actual bind probes show 7443 and 7444
occupied although Linux `ss` lists no listener; the existing mirrored Windows
owner is left untouched. The isolated installed gate uses verified-free 17443
in its private configuration and locator. This gate does not qualify default-port
coexistence. C3's accepted full CLI and server use production670 with their exact
six-library closure; inherited donor RPATHs require explicit installed-library
preloads for this development gate, not a release relocation claim.

Installed Linux acceptance passes at October 11 04:43:38–04:43:50 UTC:
matching complete-v2 Ensure reused the original profile byte-for-byte. A bounded
forced refresh wrote a 798,631-byte native checkpoint. Actual Host `SIGKILL`
stopped its profiler; the replacement installed Host kept the interrupted recipe.
Resume used the same workspace, GPU grant and forced-refresh setting and emitted
`Hardware install resume`. This checkpoint retained platform/GPU measurements
and **zero completed CPU node/format groups**; no completed CPU-format retention
or full calibration is claimed. Cancel reaped the resumed native child and kept
the checkpoint. Both accepted and original profiles remained unchanged, and all
owned Host/profiler processes and canonical guards were released. Evidence:
`installed-gate-d2994568f/reuse-resume-result.json` and its public status records
under the subject evidence directory.

Merged and pushed on GChat main `b55f1f73f`. Ron's standing rule
excludes native Windows development builds/runs. The already installed Windows GNU target passes from Linux; normal
completion, cancellation, actual Host-loss lifetime, MSVC and native installer
checks remain owed to his scheduled pre-release Windows gate.

Owned inventory: the clean merged hardware-profile source tree was retired
after publication, ancestry and live-use checks; branch/source and tested Host
binary remain retained. The accepted OI105 node/core graph stays read-only. Merged clean OI076 and OI072 candidate trees were
retired October 11 after ancestry/publication and live-job checks, reclaiming
555,421,696 allocated bytes; branches and external evidence remain. No owned
profiling job is running. The shared Rust cache remains at
`/ai/gchat/src-tauri/target`; bounded owning checks use the accepted Rust image
and canonical build guard. The original complete local v2 profile and Ron's
canonical profile, locator and model state remained read-only. The installed gate
used a separate owned prefix and the same CPU0–31/Mem0/GPU UUID grant. Its tested
d299 Host binary, native checkpoint and concise status/log evidence are retained;
duplicate bundle/runtime/installed Engine copies and the private launcher were
retired after all owned processes exited, reclaiming 1,723,944,960 allocated
bytes (1.606 GiB). C3's original CLI/server/library closure and shared caches
remain intact. The retired prefix is evidence, not an active deployment. See
`installed-gate-d2994568f/cleanup.json`.

## Outcome and acceptance

The standalone Manager requested in
`/ai/faceless-video/tmp/briefs/ginfer-server-manager-gchat.md` is delivered:
Windows tray and Linux X11 window, local/paired model start/stop/reload,
models/downloads, sharing, pairing, client grants and shared fleet work pools.
The [design](../ginfer-manager.md),
[decision](../decisions/2026-10-08-share-host-management-and-fleet-pools.md)
and [operator guide](guide.md) define its behavior.

The latest correction exposes automatic or exact GPU KV budgets in custom
launch/reload. Acceptance covers explicit null/fixed byte payloads, preserving
context/concurrency/headroom, unchanged saved-profile selection, independent
review, required source checks and the installed Windows control. Engine changes,
profile requalification, full-context/model qualification and Server 2 work are
excluded. The earlier neutral per-host Offline/Online fix remains delivered.

## Current decision and next action

### Linux tray lifecycle — OI-071

The accepted Linux `54c931c68` Manager gates initial
background hiding and close-to-tray handling behind Windows-only compilation.
Linux therefore closes the Manager on `WM_DELETE_WINDOW` even after creating
its tray. Reviewed source `deaf467a1` shares those existing tray-conditioned paths
between Windows and Linux: a nonempty Host snapshot on the first refresh hides
the window by default, `--window` retains initial visibility, and close hides
and prevents window destruction when the tray was created. On Linux, construction
first requires an available StatusNotifierWatcher. Missing/unreachable watcher,
missing probe tool, `--no-tray` and tray-construction failure retain a visible
window and ordinary close behavior.
Tray Open restores the window; Exit ends only Manager and retains Host.

Candidate `/ai/gchat-worktrees/oi071-linux-tray`, branch
`fix/gchat-oi071-linux-tray`, starts at `85f0bac2047c70cfa219ea8ef334367faf966138`.
The runtime removes the two superseded Windows-only gates and their unused-value
suppressions, and adds one Linux startup watcher probe before tray construction.
Tauri/Tao/Wry and keyring do not expose usable GIO/D-Bus APIs through their public
reexports; the probe uses optional installed `gdbus` with fixed arguments to call
the session bus daemon's `org.freedesktop.DBus.NameHasOwner` for
`org.kde.StatusNotifierWatcher`. It does not activate a provider. Only a successful
`(true,)` reply enables tray construction. The existing Tokio runtime bounds the
whole command/output wait to one second, including bus connection, and kills a
timed-out child with a further bounded 250 ms reap attempt and kill-on-drop
backstop. That deadline does not prove reaping; any residual child remains owned
by Tokio's existing Unix reaper.
There is no repeated availability polling or new declared runtime dependency.
Tray construction alone is insufficient: cached `tray-icon` GTK construction
sets the indicator active and writes the icon without requiring a watcher.
X11 tray selection alone also does not prove AppIndicator availability.
Windows installed producer `574d73df7`, accepted Linux packages, Host lifecycle,
existing snapshot polling, settings and model/profile controls remain retained.

Independent source review, compilation, strict Clippy and package verification
pass. The probe owns its child through success, failure and cancellation;
synchronous setup uses Tauri's existing multithread runtime. Native verification
remains pending: with a real watcher/tray, verify default
background startup, `--window`, close/hide, tray reopen and Exit while retaining
the same Host; verify visible startup and ordinary close on an actual missing
watcher desktop, and the explicit `--no-tray` fallback. Verify absent-tool and
unreachable-bus fallback within the probe deadline. No candidate native
operation has run; provider/dependency changes and model loads remain excluded
from this tray check.

October 10 admission: S2 Ron's X11 session remains active with the recovered
session bus and XAUTHORITY path; current desktop tools and 50.6 GiB free disk
are verified in `out/remaining-acceptance-20261009/oi071/s2-remote-admission-readonly-20261010.json`.
A separate campaign owns its running Engine and FIFO slot. No GChat process is
running there before this screen. FIFO row 806 ran the accepted `54c931c68`
Manager in a fresh child-local XDG fixture from 14:34:43 to 14:42:43 UTC.
The actual Pair dialog's Check secure storage reported ready; Cancel dismissed
the dialog without pairing. The fixed 480-second timeout ended the process
with code 124, and its exact PID was absent afterward. Native tray Open/Exit
remains unqualified because automation could not safely identify its icon.
The installed AT-SPI typelib and already-running accessibility registry now
provide a possible exact-name/bounds route for native tray clicks. Actual item
exposure remains unproven; use no guessed coordinates or private callbacks.
Evidence: `out/remaining-acceptance-20261009/oi071/s2-row806-native-storage-tray-20261010.json`.
This baseline screen created no Host, model, pairing grant or fleet catalog,
used no original state, and does not qualify the new Hide behavior. The archive
remains staged at `/home/ron/.local/share/GInfer/oi071-manager-54c931c68`.
Keep the same fixture available for the corrected
artifact's full pairing/restart/lifetime check. The corrected Linux Manager now passes focused check, strict Clippy and the
Manager/Host build in booking365. The four-member archive matches both produced
binaries, guide and font license; both ELF64 x86-64 binaries require at most
glibc 2.39. Product source is `deaf467a1`, compiled from clean `14592d330`.
The first check failed because Tauri writes `ginfer-manager/gen/schemas` while
both source aliases were read-only. A narrow writable generated-directory mount
at each alias corrected this build setup; product files were unchanged.
Check took 3.41 seconds, Clippy 2.01 seconds and build 52.76 seconds.
The exact owned container was removed at 16:37:49 UTC and the canonical build
guard was reacquired and released. No Engine, frontend, dependency or model build
ran. The archive is retained at
`out/remaining-acceptance-20261009/oi071/build-365-deaf467a1-proposed/output-r2/manager/`
with `manager-package-verification.json` beside that directory. First-failure
logs remain in `output/`. This component pass does not qualify native tray,
pairing or saved-grant restoration; the next action is the bounded S2 FIFO
screen using this candidate and the existing isolated fixture.

The prepared native gate now verifies the candidate's live registered tray
owner, fresh accessible target and point hit before each action. Open requires
actual window focus and menu closure; Exit requires the original PID absent.
An unavailable owned-menu image is recorded without weakening those checks.
This remains source preparation, with no new S2 launch or FIFO row.
Read-only inspection of S2's Ubuntu appindicator extension shows its accessible
name comes from icon description or Title, with no Id fallback. The original
locked GTK tray backend ignores the Manager's tooltip, supplies description `icon`,
and maps its `title` option to panel text. Adding that option would not provide
the intended accessible name. Actual candidate exposure remains unmeasured;
use only fresh candidate-linked properties and targets for the native gate.
Evidence: `out/remaining-acceptance-20261009/oi071/s2-tray-accessible-name-source-20261010.json`.

The Pair dialog's secure-storage readiness message incorrectly used error
styling. The reviewed correction uses neutral status text for readiness, a red
alert only after failure, and clears the previous failure on retry. A focused
DOM fixture covers success, failure and recovery and passed once on composed
`6b199362d` (519 ms), recorded in `out/s2-acceptance-20261011/source-gates.json`.
Native successful-vault presentation remains owed to the release walkthrough.
No secure-storage or pairing contract changes. This source correction does not
qualify the physical tray or saved-grant lifecycle.

Ron explicitly approved the reviewed `tray-icon` source override under GChat
`AGENTS.md` §6.6. `src-tauri/vendor/tray-icon` now contains the locked 0.21.3
source from upstream `a0081a3b833ab3382d2c8d2142df76ccaabaadf6`, with both
licenses retained. Its GTK backend owns the configured tooltip and applies it
as the native icon description at construction, tooltip changes and subsequent
icon replacement. Existing main-thread and mutable AppIndicator ownership remain
intact; no raw-pointer access or panel text is introduced. Non-Linux code,
dependency versions and edges are unchanged. The workspace override also binds
GChat's transitive tray dependency to this source.

The static lock change removes only tray-icon's registry source/checksum. Offline
resolution, Linux Manager check/strict Clippy and package generation passed on
`6b199362d`, recorded in `out/s2-acceptance-20261011/source-gates.json` and the
linked `manager-build-6b199362d-120030/` packet. Own SNI registration and native
Hide passed; native accessible-name/Open/Exit remain release-walkthrough checks,
with no further tray finder gates. Ron selected Manager's
existing canonical `src-tauri/icons/icon.png` as the shared application icon.
Manager already selects `../icons/icon.png` in its Tauri bundle configuration;
locked code generation embeds that PNG as the default window icon, which the
tray builder uses. Its UI brand and Windows icon producer use the same PNG.
The Manager route is retained without a second decode or new asset; GChat's
explicit shared-icon routing is handled separately. Icon assets are unchanged.
The reviewed integration manifest and
patch remain in `out/remaining-acceptance-20261009/oi071/` as
`tray-icon-backend-integration-proposed.txt` and
`tray-icon-0.21.3-gtk-accessible-name-proposed.patch`.

Booking364's installed Windows desktop renders the embedded app correctly at
`http://tauri.localhost`. The visible Code Stop reaches backend Exited and all
four Code children exit, but the UI remains Stopping after 26 seconds; the new
`GCHAT-CODE-STOP-STUCK-UI` row owns that separate defect. Normal nondebug GChat
restart and saved-state/component preservation pass at 16:31:17 UTC; its guards
are released at 16:31:58 UTC. No model or installer ran in booking364.
Separate NSIS367 packaging and independent package verification now pass.
The actual bundle-call/validation interval was 159.902512 seconds, with the
owned packager using 99.7% of one logical CPU during its two-second sample.
Booking353 measured 4m28s compilation and left at most 84 seconds for packaging;
it did not measure a 13-minute NSIS run. No packaging performance defect is
demonstrated by these results.

The wrapper's final success allowlist omitted `NSIS_ONLY_PASS`: body exit 0,
normal Job0 and fresh package PASS coexist with its actual controller exit 1.
That exit is preserved rather than relabelled. The native body/controller and
four observed children are absent; apps and settings remain unchanged, with
zero Engine/API processes. Both guards were released at 17:04:53.939 UTC and
booking367 was cancelled. Evidence is
`out/remaining-acceptance-20261009/oi068-windows-20261010/nsis-367-current-result.json`.
The one-line next-use correction is independently reviewed and retained as
`nsis-controller-next-use-allowlist.patch` in that packet; the expired booking's
original script and raw exit remain unchanged. No successful bundle was rerun.
The installer retains Manager349/Host/CLI/Engine/profile closure and verifies
the fresh embedded desktop; it excludes the new Code UI ordering fix.
Native S2 tray/grant acceptance and that fix's installed replay remain pending.

### Retained instance diagnostics — GCHAT-MANAGER-STOPPED-ERROR-ALERT

The October 10 public Host snapshot reports the saved instance stopped with zero
active requests while retaining its October 9 startup error. Manager rendered
that entire saved diagnostic as a current red error. Source now keeps stopped
and other historical diagnostics in neutral, collapsed **Previous startup
error** details. An online failed instance keeps a short visible failure alert
and collapsed **Startup or runtime error details**. The complete diagnostic
remains available in a bounded, scrollable text area; no Host error, cached
snapshot, model profile or stored data is cleared or changed.

Diagnostic details use the existing section-state map, keyed by Host, instance
and current versus previous phase. Unrelated live snapshot updates preserve an
open diagnostic while it is being read. A phase change starts collapsed, including
a round trip back to a previous startup error.

The reviewed code is integrated and pushed through root source `574d73df7`.
Actual focused Manager Node checks pass **24/24** at October 10 10:36:08 UTC,
covering stopped versus failed presentation, offline cached diagnostics, full
retained text, reading state across unrelated snapshot updates and collapsed
phase transitions. CPU-only booking346 closed at 10:44:12 with no jobs or
guards remaining. New Manager `574d73df7` is now installed; neither its component
checks nor successful presentation repair the separate Engine profile/startup issue.

Evidence: `/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/host-current-error-341.json`
records `stopped`, zero active requests and the retained 9,009-byte diagnostic.
Actual gate evidence is
`/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/manager-ui-574d73df7-346.log`.
Booking349's actual `PRODUCTION_PASS` at 11:26:00.6625612 UTC completes the
Manager embed build from `574d73df7` and NSIS-only bundle refresh. Accepted
compiled 7d9 GChat/Host/CLI, Engine and frontend payloads retain their original
producer provenance. The production body exits 0 and its job is empty after
the identified VCTIP helper teardown. Package verification passes, Manager R3
installation passes at 11:43:08 UTC, and full installed byte/state verification
passes at 11:45:47 UTC. Actual Manager CDP at 11:46 shows
`http://tauri.localhost/`, stopped, zero active requests and no alerts. These
observations do not qualify every diagnostic interaction. The candidate GChat
frontend opened a directory listing because an absolute Windows `frontendDist`
parsed as a `C:` URL and left assets unembedded. Exact `0f06ba433` desktop-only
restoration passes at 11:56:54.9219517 UTC, with ordinary GChat UI, seven original
saved threads and unchanged selected protected state. Manager 24796/hash
`1b9f0173…` and 7d9 Host/CLI/2ef Engine remain intact; Engine/API counts are zero
and guards are released. CPU-only booking353, 15:05–15:15 UTC, compiled the
corrected desktop: relative `frontendDist`
`../../../windows-build/source/web-app/dist` resolves to the exact 832 accepted
assets as a Directory. Cargo passed from 15:07:07.607 to 15:11:35.887 UTC
(4m28s). NSIS packaging remained incomplete when the independent 15:13 UTC
deadline killed the owned job, only about 84 seconds after Cargo finished. The
overall result remains `BOUNDED_ABORT`, not a package pass. The job is empty;
fresh controller/body/helper absence is proven at 15:13:44 UTC, and the own
keeper released at 15:14:21 UTC. No installation or new candidate UI result is
claimed. Retain `production-terminal-353.json`, `release-verified-353.json` and
native `native-574d73df7-353-frontend-directory` under the existing
`oi068-windows-20261010` evidence roots. The user approves this compiled
`574d73df7` desktop for desktop-only UI verification at 16:20–16:35 UTC,
retaining installed Manager, Host, Engine and saved state. Separate NSIS
packaging at 16:55–17:20 UTC remains pending and does not gate that UI check.
Native tray qualification and model-backed acceptance remain pending.
The [remaining acceptance authority](../agent-runtime/remaining-acceptance.md)
owns package/installation admission and preservation checks.

Earlier installed Windows client `0f06ba433` passes with retained Manager producer
`43c8d71cf` and clean Engine `2ef56a52a`. Composed `make verify`, native build,
package verification and installed payload/user-state preservation pass.
Seven original threads, all models/profiles, credentials and Host identity are
preserved. Actual sidebar Stop stays stopped with zero Engines/API listeners;
Start and Reload reach distinct Ready sessions with selected alias/Server
running retained. Continued Chat returns 30,000 ready/stop after compaction
from 26,366 to 1,705 tokens; final GUI Stop returns to zero. Supported
Reload/Stop restores the original profile exactly and normal apps are restored
without debug ports. Evidence:
`/ai/gchat/out/oi106-final-update-20261009/installed-verification.json` and
`installed-lifecycle-acceptance.json`. Reviewed code is merged and pushed on
Windows main `e2521e33`; that accepted desktop is now restored alongside the newer
Manager and Host/CLI. Linux
assembly, both-format independent package verification and actual native X11
lifecycle acceptance pass at `02d369e8a`, as recorded below. Completed OI-106 and profile
source trees are retired; source branches and evidence remain. This C4/32K
functional acceptance leaves the original fixed-arena
128K startup failure and physical qualification requirements below unchanged.

### Current Engine profile repair — OI-072

October 13 cutover audit: the source-only catalog/evidence audit is complete. Physical
qualification is pending the release gate Ron schedules; the changing development
Engine is not qualified tonight. The pending configuration is Muse TP1,
C4/131,072, NVFP4 long KV and all-Q4 DFlash2 from
`muse_glimmer_30b_nvfp4_df2q4.ginfer` (`muse-glimmer-30b/nvfp4`), prefill 1,024, graphs
and public prefix reuse enabled, Vision off and the unchanged 300 MiB guard.
The release gate selects and records the actual Engine, exact package and GPU
group before the retained cold four-request/full-context check. AUTO functional
authorization stays in force; neither Ready nor a short lifecycle pass promotes
capacity evidence. Native-NVFP4-drafter measurements remain historical.
OI-072-RUNTIME is separately closed as an unreproduced external residency drop.
No Engine, catalog value, profile tier or launch behavior changed in this audit.

Host validation checks the declared tier's counts/calculation/headroom facts;
it does not read archived measurements or compare `engine_revision` with the
selected executable. Availability matches identity, TP/draft degree and size.
Launch then verifies the exact payload SHA256, context/concurrency/options and
platform/SKU/SM/selected GPU group. Engine startup owns live memory and topology.
These checks preserve historical settings; they do not make historical evidence
current qualification. GChat, Manager and the text launcher already show the
recorded Engine/workload and changed-Engine disclaimer. Any future current-match
verdict must come from Host observations, not guessed client version comparison.
Flash filename matching now uses the completed `qwen38_flash_next_180b_*` cutover.
Container identities, exact artifact paths and capacity settings are unchanged;
the rename neither rebinds historical qualification nor creates a tested tier.
Owning paths: `ginfer-host/src/{launch_profiles.rs,service.rs,engine_host.rs}`,
`EngineProfilePicker.tsx` and `ginfer-manager/ui/manager.js`.

Saved Windows `catalogs.json` contains 103 entries: 23 full-context-tested, four
startup/smoke and 76 calculated/pending. The native Muse C1–C8 resource reports
are September passes, not in-progress tests or qualification of a later Engine.
Its C4 record uses package SHA256
`6d6cc348c75a75c60ca011d267eb389dcbb8530f6c51a680dad911d25365b61f`,
22,447,498,752 bytes, RTX5090 and Engine `922e5a879`: four 131,009-token prompts,
256 returned/252 decode tokens, 13 B4 graph rounds, zero reuse and 373,293,056
minimum free bytes. That direct placement workload used full reset with no
public checkpoint reservation. It does not qualify the current prefix-enabled
public route. October 9 AUTO startup/lifecycle passed on `2ef56a52a`; its cold
wave aborted below the same guard. October 10's four completed responses used
53 prefix tokens on one lane and do not close cold-independent qualification.
Retained evidence remains linked below and in
[profile evidence](../model-profile-evidence.md).

Audit candidate: `/ai/gchat-worktrees/oi072-evidence-d9b`, branch
`docs/gchat-oi072-evidence-d9b`, baseline `d9b802e4c`; docs only, no build/model
or live job. Historical GInfer catalog source
`/ai/ginfer-worktrees/gchat-oi072-catalog` at `61c62903e` remains clean and
retained. Next ONE item is resumable profile-v2 installation from the GChat
installer and hardware-change refresh; no new OI-072 physical run is authorized
before Ron's release gate.

The retained October 9 repair used native `2ef56a52a`. The original fixed-pool
profile was saved exactly and restored stopped after those checks. Its required
configuration was Muse TP1, C4/131,072,
NVFP4 long KV and native NVFP4 DFlash, 1,024-token prefill, graphs enabled and
Vision disabled through the public prefix-enabled serving route. Context,
concurrency, the 300 MiB guard and sampling behavior are not reduced. Engine
memory admission remains the authority; the earlier fixed-pool rejection is
retained evidence, not a reason to weaken that guard.

The source candidate keeps the September fixed profile unchanged and adds a
distinct automatic-pool profile, initially `calculated-pending-validation`.
Automatic sizing uses current post-startup availability minus the same guard;
it maximizes the shared arena instead of reserving yesterday's unused capacity.
GChat already forwards and persists null/omitted versus positive fixed arena
bytes correctly. Catalogs are owned by GInfer's `config/launch-profiles/`.
The 104-profile Windows catalog is installed with the distinct automatic entry
still calculated/pending; original 103 profile values are retained exactly.
Supported lifecycle tests restore the original saved profile. No private
`host.json` edit or capacity promotion is used.

Frozen `2ef56a52a` source selects a 2,208-token native tail containing
8,366,592 bytes, including 256-byte plane alignment and the 15-token BF16 V
microtail. The startup minimum is only four such capture tails (33,466,368
bytes); reaching Ready with automatic sizing cannot establish C4 full-context
capacity. The September placement harness disabled prefix reuse. Its exact
2,139,451,392 measured arena bytes are reproduced by 63 full tails and one
2,048-token tail per lane, and exclude public-serving checkpoint reservations.
Those histories left 9,858,355,200 of the fixed arena's bytes unused.

For the public route, one Muse compound checkpoint reserves 85,406,720 bytes
per lane: 43,450,368 sliding INT8 bytes, 41,943,040 draft BF16 bytes and 13,312
BF16 continuation-hidden bytes. Sliding/draft live rings and pending state are
fixed allocations made before the final arena, while this checkpoint image
belongs inside it. Publishing a prompt checkpoint seals its terminal tail, so
output requires another tail. A conservative cold full-context C4 calculation
uses 64 preferred tails per lane, one extra tail for that seal, one largest
atomic-growth tail and one compound checkpoint: 2,550,407,168 arena bytes and
268 segment slots. This is a calculated bound for four independent cold text
requests; retained fragmented histories and physical allocator state are checked
by the Engine's reservation transactions. It is not a fixed pool cap or a
current measured available budget.

Actual October 9, 19:40–19:41 UTC Host automatic Reload/Ready/Stop passes with
the exact C4/131,072 settings and 300 MiB guard. The separate direct Engine
also reaches Ready: JSONL records an automatic 10,400,743,424-byte arena and
9,198 slots, adaptive/15, prefix reuse and graphs enabled. Its sole event is
`server_start`; no inference ran. Preparation doubled the retained text past
the frontend's capacity and received typed HTTP 400 `context_length_exceeded`
for a 152,381-token prompt. The helper incorrectly aborted that expected upper
bracket. Supported cleanup restores the exact original stopped profile and
zero native Engines, with no cleanup error. Evidence:
`/ai/gchat/out/code-hygiene-20261009/integration/native-c4-128k-20261009/`.

The correction preserves HTTP status and JSON body in a typed transport failure.
Only preparation opts into recognizing HTTP 400 with a valid error object,
string `context_length_exceeded` / `invalid_request_error` / `messages` fields
and a nonempty string message as an above-target sentinel. It never parses a
token count from prose or records the sentinel as a measured count. All other
errors and `RunC4` exact-count validation still fail. All three preparation
count paths keep 96 calls per lane / 600 seconds total, four distinct early
markers, exact 131,009-token acceptance, 64 requested outputs and omitted
public defaults.
Native PowerShell 5.1 parser/Add-Type and ten bounded component cases pass,
including actual HTTP/PS exception wrapping, wrong status/code/type/parameter,
malformed JSON/object fields and default exact-validation rejection. The fixture
uses an opaque message without token numbers. It executes extracted production
transport/count code only; no Host, Engine or GPU execution. Receipt:
`/ai/gchat/out/oi072-current-profiles/count-upper-bound-component.json`;
its sibling fixture source is retained for this reproduced regression.

The corrected October 9, 19:56–19:57 UTC execution passes Host automatic
Reload/Ready/Stop again. Its separate direct Engine records a new automatic
10,638,176,256-byte arena (9.91 GiB) and 9,198 slots, with the same adaptive/15,
graphs and prefix reuse. Preparation succeeds for all four distinct inputs at
exactly 131,009 tokens: 24 public count calls per lane, 2.035 seconds total.
Each body requests 64 outputs for the retained 63-decode-input control; no
outputs were returned.

The actual wave is stopped after 13.537 seconds by the helper's unchanged
300 MiB physical-free-memory guard: the device-wide samples start at 410 MiB
and end at 292 MiB, with intervening variation up to 436 MiB. JSONL contains
four `request_start` and three `throughput` events. Its last scheduler sample
shows four running/prefilling lanes, zero waiting/decode-ready lanes and
524,036 logical input tokens. Aggregate represented prefill is 96,564 tokens,
including 96,507 computed prefill tokens; complete histories are not reached.
All decode/B4 counters are zero, there are no responses, and no Engine error,
completion, OOM or admission error is recorded. Supported cleanup restores the
exact original stopped configuration, with no native Engine or cleanup error.
Evidence: `/ai/gchat/out/code-hygiene-20261009/integration/native-c4-128k-corrected-20261009/`.

The current decision is to retain `calculated-pending-validation`: automatic
startup and exact preparation pass, but full C4 capacity has not passed the
physical guard. No retry, margin change or profile promotion is authorized.
The device-wide free-memory change during prefill does not establish the
allocating owner, Engine payload growth, Windows residency/spill or an external
client cause. The saved receipts lack paired live Engine allocation/CUDA-free,
Engine PID local committed/resident and other-client counters. Runtime
attribution is handed to the native owner under master OI-072-RUNTIME; these
missing observations are the next unresolved evidence. The direct JSONL is
separate Engine evidence and does not prove Host telemetry or model quality.

Remaining physical acceptance uses four distinct inputs counted at exactly
131,009 tokens through the loaded public frontend. The retained 63-decode-input
qualification workload may serve
as the matched control (64 returned outputs, 63 decode inputs); it does not change
a product output limit. Early EOS leaves this matched-wave evidence incomplete;
it does not establish a product bug or authorize changing stop/sampling defaults
or retries to force a chosen result. Capture both
the Engine scheduler's four admitted lanes and batch-four decode counters;
four active Host HTTP requests alone cannot prove the requested concurrency.
The existing startup and 32K functional screens do not satisfy this acceptance.
Preserve the original profile and stopped state after the check. No additional
GPU run, native build, server change or remote administration is authorized in
this documentation handoff. Historical residency attribution remains separately
unresolved under OI-066 and is not a prerequisite for correcting the excessive
fixed reservation.

Owned source candidates are `/ai/gchat-worktrees/oi072-current-profiles` from
`104d4ec6e` and `/ai/ginfer-worktrees/gchat-oi072-catalog` from origin/dev/next
`a6dc193fb`. Retain source/evidence until reviewed integration; no model copy,
build or live job is owned by this item. The accepted installed `2ef56a52a`
payload is reused. Required physical acceptance remains open.

The existing `/ai/gchat/out/oi056-current-engine/host-request.ps1` is adapted
into `scripts/ginfer-host-request.ps1` for four distinct bodies, exact
public counts, a 600-second wave deadline (the retained wave took 199.45
seconds), direct loopback transport and JSONL evidence. The retained qualification
source bank is recovered from `922e5a8:tools/bench/make_bench_corpus.py`; its
5,815 UTF-8 bytes match the retained manifest's `source_bank.sha256` exactly.
The adaptation tiles that text with an early lane marker and counts the full
`role=user` request with reasoning and sampling fields omitted. It establishes
capacity/lifecycle evidence, not new model-quality evidence. Source preparation
creates no native/GPU job; actual execution and exact process ownership/cleanup
belong to the coordinator's booked window.

The direct command uses the exact retained native `2ef56a52a` executable and
the original profile's artifact. The coordinator supplies the booked port and
new diagnostic path; its reviewed argument vector is:

```powershell
$serveArgs = @($artifact, '--host', '127.0.0.1', '--port', $port,
  '--model-id', 'muse-glimmer-30b/nvfp4-dflash-nvfp4',
  '--tp', '1', '--max-context', '131072', '--max-concurrency', '4',
  '--spec', 'dflash', '--draft-policy', 'auto', '--draft-tokens', '4',
  '--draft-tp', '1', '--kv-dtype', 'nvfp4',
  '--kv-arena-headroom-bytes', '314572800', '--prefill-chunk', '1024',
  '--request-log-jsonl', $requestLog)
# Same UUID as Host; same runtime directory/dependency environment.
$env:CUDA_VISIBLE_DEVICES = 'GPU-92a61cb1-6b5e-cc7b-b669-72b2662d9d6e'
```

Omit fixed-arena, Vision, graph-disable, reasoning, sampling and stop overrides.
The direct public model ID is explicit and distinct from Host alias ownership.
The helper does not launch a process. The caller retains its exact PID, creation
time and image, wraps launch/preparation/run in `finally` cleanup, and stops that
owned direct process before restoring the Host profile. Host lifecycle calls
carry `expected_session_id` and have a 600-second transport deadline because
the retained original-artifact hash exceeded 30 seconds. Snapshot calls remain
bounded to 30 seconds; no automatic retry or duplicate launch is introduced.

Use helper `PrepareC4` with the direct origin and owned output directory, then
`RunC4` with its four `c4-lane-0.json` through `c4-lane-3.json` bodies, that
origin, `RequestLogJsonl`, `EngineProcessId`, and `ExpectedEnginePath`.
Preparation is bounded to 96 exact-count calls per lane and 600 seconds in
total. Wave failure aborts its HTTP requests and stops only that unchanged
caller-owned PID; earlier preflight failure and normal cleanup remain the
caller's responsibility. Keep raw JSONL and the helper's input/result/event
receipts in the booked output. `server_start.memory` supplies the measured
arena and descriptor capacity; `throughput.scheduler.running` must show four
admitted lanes, and `decode_batch.rounds_by_batch[3]` /
`committed_tokens_by_batch[3]` must show actual B4 work. Require four 64-token
responses and 252 committed decode inputs total, with zero prefix-hit credit.

Frozen Muse AUTO resolution is preserved: requested `auto`/four draft tokens
can resolve to adaptive/15 or calibrated fixed families. The helper checks
requested CLI arguments separately from JSONL's resolved policy/window and
records both. The 85,406,720-byte checkpoint uses fixed 2,048-token cyclic
rings plus continuation hidden; the native tail's 15-value microtail belongs
to the KV codec, independent of draft width. At most 16 staged tokens fit well
below the 2,208-token preferred tail, so one such tail still bounds atomic
growth. Independent review confirms the calculated 2,550,407,168-byte / 268-slot
cold-cohort requirement remains valid. Runtime width-dependent pending state,
workspace and graphs precede automatic arena sizing; their actual residency
is measured by the physical check, not assumed from this KV calculation.
Earlier source pressure review corrected the JSONL `auto_max` spelling,
requested/resolved AUTO distinction, explicit direct model ID and lifecycle
deadline. Actual preparation exposed the upper-bracket failure above; source
review and startup alone did not establish the full helper or capacity result.
The measured adaptive/15 startup does not change the calculated bound. The
corrected wave demonstrates four admitted prefill lanes; full-context completion
and B4 decode evidence remain unachieved after the physical guard abort.

The coordinator's owned execution adapter is
`/ai/gchat/out/code-hygiene-20261009/integration/c4-profile-capacity.ps1`.
It references the committed helper/bank and retained
`original-profile-public.json`, checks the live booking and coordinator-owned
canonical locks, and inspects the installed native manifest/version, GPU and
actual Host child arguments. It performs automatic custom-profile Reload
(which already starts the instance), Ready and Stop, then owns the separate
direct process on `127.0.0.1:9537`. Credentials remain in memory; the direct
process reuses the Host-generated Engine key and native public model label,
with separate alias ownership. Its approved lifecycle difference omits the
Host-only `--exit-on-stdin-close`; exact PID, creation time and image checks
govern direct cleanup. Engine inference parameters remain the same, with the
new JSONL diagnostics recorded explicitly.

The adapter's `finally` covers earlier API/preparation/preflight failures and
successful waves, stops the exact direct process, and restores the exact saved
flat original configuration through supported Reload/Stop. It checks stopped
idle state, original identity/certificate and absence of native Engines. The
coordinator supplies the existing outer RAM/hard-deadline guard. Native `2ef`
uses `%LOCALAPPDATA%\GInfer\hardware.json` with no Host profile override;
startup can refresh stale NUMA facts, so the adapter compares that same existing
path/hash after each startup and stops the same-settings comparison if it
changes. It does not copy that profile or introduce `--no-profile`.
The actual first capacity attempt used local5090 booking 279, October 9,
19:30–20:30 UTC, owned by GChat. The adapter requires fresh bounds and line/PID
parameters for any later coordinator run. It is a retained execution artifact;
the startup/lifecycle evidence above does not complete physical capacity.
Independent source pressure review found no concrete blocker in the composed
adapter/helper/bank and confirmed that the actual Host public label comes from
the artifact identity/weights, while the saved UUID is only its inventory lookup.
The final receipt is written only to a directory created by this invocation;
rejecting a reused output directory cannot overwrite retained evidence.

Source verification: nineteen Manager DOM tests and sixteen focused desktop
picker/benchmark tests pass, with product ESLint, release `tsc -b` and both
repository diff checks. The catalog's original eight entries compare exactly
with its base; independent integer layout arithmetic reproduces the retained
wave and the new pending requirement. The focused offline Host gate passed
13 catalog tests and three launcher tests under the canonical build and GPU
locks in 6.69 seconds, reusing `/ai/gchat/src-tauri/target`. The real
`ProfileCatalog::read` accepted the exact nine-entry GInfer candidate with
the pending automatic policy and evidence intact. Receipt:
`/ai/gchat/out/oi072-current-profiles/focused-host-gate.log`; its disposable
validator source and binary were removed. Independent review found no blocker
in the evidence-label changes. The composed `make verify` at `0f06ba433` now
passes; source verification does not qualify full-context capacity. Candidate
source is represented in published main and its completed tree is retired
after fresh live-use checks; source branches and external evidence remain. No disposable model,
build or GPU output was created by this source-preparation work.

### Retained startup diagnosis — OI-066

The October 9 measurement establishes the OI-066 startup admission rejection.
The owner of the baseline difference and its reclaimability remain unresolved. The
saved tested profile and Host command match: Muse native-NVFP4 text, TP1,
C4/131,072, DFlash K4, NVFP4 KV, 1,024-token prefill, CUDA graphs enabled,
Vision disabled, 11,997,806,592 fixed arena bytes and 314,572,800 headroom bytes.
The catalog records engine `922e5a8`; the installed executable is `6138913f`.
No `--structured-outputs` flag is passed and its installed default is false.
Disk/NUMA warnings are nonfatal. The actual rejected reservation is the whole
fixed pool; it is separate from the memory needed by four 128K requests.

One bounded native startup reproduced the exact failure without changing saved
options or sending an inference request. The original qualification used the
same RTX 5090 UUID, artifact, fixed arena, headroom and C4/context/KV settings.
Its retained telemetry distinguishes physical NVML availability from the old
benchmark's CUDA-only startup counter:

| Physical GPU free memory / reservation | Passing September test | October 9 retry |
| --- | ---: | ---: |
| Before engine startup | 30,963 MiB | 30,104 MiB |
| Last observed before pool allocation / failure cleanup | 11,831 MiB | 10,983 MiB |
| Fixed arena | 11,442 MiB | 11,442 MiB |
| Required safety margin | 300 MiB | 300 MiB |
| Free required for arena plus margin | 11,742 MiB | 11,742 MiB |
| Spare above requirement / shortfall | +89 MiB | −759 MiB |
| Startup consumption between those phases | 19,132 MiB | 19,121 MiB |

The current GPU already had 859 MiB less free memory before loading. The
pre-pool difference is 848 MiB; these samples show essentially unchanged startup
consumption, not a new 1 GiB Engine allocation. The failed process exited and
free memory returned to its 30,104 MiB starting level. A later read-only check
found no engine and 30,092 MiB free. The extra baseline usage remains after
Engine cleanup. The old GPU-client list has no per-client memory amounts, and
current Windows process memory counters do not reconcile with physical NVML
usage, so a particular application cannot be named as the owner of that delta.

The user requested attribution of the additional VRAM. A subsequent read-only
Windows query of the same 5090's local memory segment reports 1,185,017,856
Allocated bytes (1,130.121 MiB), 840,577,024 Modified bytes (801.637 MiB), and
no Zero or Standby bytes. Allocated plus Modified approximately matches nearby
NVML 1,918 MiB Used, with asynchronous changes between queries. This is a
specific OS-managed residency bucket worth investigating; it does not establish
that this bucket grew by the historical 859 MiB. The original test did not record
these buckets. Direct process queries also differ substantially from the normal
performance counters. Protected DWM/csrss/System/vmwp inspection is access-denied
without elevation; no applications were closed and no UAC prompt was raised.

The installed SDK defines `ModifiedBytes` separately but does not define its
reclamation contract. Microsoft documents dynamic WDDM residency budgets and
trimming; NVIDIA distinguishes WDDM OS management from Linux/TCC channel
accounting. Neither guarantees that these specific local Modified pages are
recoverable for this arena. Conversely, current NVML free alone does not prove
an irreducible allocation shortage. `src/runtime/engine/kv_arena_capacity.cpp`
rejects before attempting the final CUDA arena allocation. The demonstrated
cause is the admission policy's free-memory comparison; whether that policy
rejects recoverable residency without host spill remains an unproven hypothesis.
The failed engine returned memory to its baseline, but that observation does not
prove Windows cannot reclaim the remaining pages later.

At the user's shutdown drain request, finer attribution and the reclamation
question are parked in OI-066. Resume from these retained measurements after the
RAM installation; do not repeat qualification to recover missing context.
Evidence: `gpu-direct-process-memory-20261009.json` and
`gpu-protected-process-memory-20261009.json` beside the measured startup trace.
Relevant primary contracts: [NVIDIA NVML memory queries](https://docs.nvidia.com/deploy/nvml-api/latest/api/group__nvmlDeviceQueries.html),
[Microsoft residency budgets](https://learn.microsoft.com/en-us/windows-hardware/drivers/display/process-residency-budgets),
and [the reserved statistics interface](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/d3dkmthk/ne-d3dkmthk-d3dkmt_querystatistics_type).

In `6138913f`, `registry.cpp` releases the temporary capture arena before
querying memory and resolving pool capacity. The four native NVFP4 capture
tails total 33,466,368 bytes (31.916 MiB); even crediting the entire payload again
after the last 10,983 MiB sample leaves a 727.084 MiB shortfall. Capture release
also destroys 64 CUDA events whose driver-owned bytes are not quantified.
The final error is after release, so temporary capture storage does not explain
away the physical shortage. Requested sampling is 50 ms, effective roughly
64 ms: the 759 MiB shortfall is a nearby observation, not the exact private
CUDA/NVML pair at the check.

Commit `32cf870caa` changed the final query from CUDA-only free bytes to the
minimum of CUDA process and NVML device-wide free bytes. The original
qualification reported 12,295 MiB CUDA-free at startup while nearby physical
telemetry had 11,831 MiB free, a 464 MiB difference. Its apparent CUDA surplus
of 553 MiB was only 89 MiB of physically observed spare above the required
reservation. Both the ambient baseline and accounting changed; query change
alone is not demonstrated as the cause. Source comparison also finds a smaller
dominant prefill workspace, not the material allocation growth previously
suspected. HTTP queue settings are host-side and warmup follows construction.

The profile was tested and passed. Its fixed whole-pool reservation has little
physical tolerance for a busier Windows desktop. OI-066 is parked for the shutdown drain. Resolve attribution and reclaimability
before the owning Host/profile/engine decision on current-memory pool sizing, preserving
the user's C4/131,072/NVFP4 workload. No catalog, installed binary, headroom or
saved settings were changed by this diagnosis. Automatic sizing is exposed by
the installed Manager control from `ce6a6c0e6`; it is a workaround, not proof of
current full-context qualification or a completed profile fix. Server 2 was
untouched.

Measured evidence: `/ai/gchat/out/manager-kv-startup-20261008/` contains
`c4-startup-measured.json`, `c4-startup-gpu.csv`, `c4-diagnosis-summary.json`,
the pinned repeat snapshot and the redacted effective command. The matched old
qualification is
`/mnt/nas/AltaStratusAI/GInfer/qualification/launch-profile-qualification-20260909/profiles/windows-sm120a/rtx5090/muse-native-nvfp4-c4-ctx131072-explicit-margin300m-fit/`.
Its benchmark, physical telemetry and resource observation remain unchanged.
The local GPU booking was released at the run's actual end; no owned GPU job
or lock remains. Available system RAM stayed above 8 GiB throughout the retry.

### C1 and C4 VRAM arithmetic

Read-only calculation: `/ai/gchat/out/manager-kv-startup-20261008/kv-math.py`
and `kv-math.json`, using Python 3.11. Only the installed artifact's 273,074-byte
directory and 16-byte header were read; no weight payload was copied or changed.
Muse has 13 full-attention layers, two KV heads and 128 dimensions. NVFP4 stores
one byte per two values plus one byte of scale per sixteen values:

`13 × 2 × 128 × 2 (K/V) × (1/2 + 1/16) = 3,744 bytes/token`.

At C1/131,072, full-history payload is 490,733,568 bytes (468 MiB). The 39
2,048-token INT8 sliding rings, FP16 scales and BF16 open V groups add
43,450,368 bytes (41.4375 MiB). Five 2,048-token BF16 draft rings with eight KV
heads add 41,943,040 bytes (40 MiB). Combined cache payload is 576,126,976 bytes
(549.4375 MiB / 0.537 GiB) for C1 and 2,304,507,904 bytes
(2,197.75 MiB / 2.146 GiB) for C4. Segmented allocation overhead, retained
prefixes, pending state, workspaces, graphs and driver allocations are additional;
these payloads are not exact physical arena minima or launch qualification.

The installed artifact has 627 Text weights, two FP32 KV normalization arrays
and 81 draft tensors. Their 256-byte-aligned device residency upper bound is
18,575,123,200 bytes (17.299 GiB); the old benchmark reports 18,575,122,948 bytes,
252 bytes lower from the last allocation's unused tail padding. Vision, disabled
in this failure, would add 3,843,814,400 weight bytes (3.580 GiB) and workspaces.
Native NVFP4 weights still include W8 vocabulary and BF16 tensors; sliding and
draft KV formats are separate from the full-attention NVFP4 cache.

The earlier October 8 C1 failure requested a different 12,467,568,640-byte
(11.611 GiB) pool with the same 300 MiB headroom. Its post-failure free memory
was 30,021 MiB, not a failure-time measurement; that evidence did not establish
a changed startup allocation. The October 9 matched C4 measurement above now
establishes whole-pool fit under the actual current device-wide memory state.

At 16,384 tokens, C1 combined cache payload is 139.9375 MiB. Hypothetical
162,000- and 165,888-token payloads are 659.868 and 673.75 MiB respectively;
both exceed Muse's supported 131,072-token context and are only arithmetic
comparisons. The user's repeated launch was C4/131,072, not either larger value.

## Ownership and fleet contract

Manager shares GChat's locked registry and native credential vault. The Host owns
launch, downloads, grants and sharing. Opening Manager does not start a model or
replace another owner's Host. Closing/exiting Manager leaves hosts running.

One selected coordinator owns durable revision/CAS pools and client assignments.
Paired clients resolve its pinned locator through fleet members. Hosts receive
read-only projections of their own membership. Studio browses the full catalog;
assignments constrain runnable placement. Runs freeze their validated catalog
and instance/session affinity. Offline catalogs are read-only and cannot start
new pooled work. Exact migration receipts prevent deleted pools returning;
canonical physical identity preserves overlapping worker limits.

## Verification and limits

Required source checks pass at `ce6a6c0e6`: lint/typecheck, contract/assets,
2,067 frontend tests (six skipped), 102 extension tests, nineteen Manager DOM tests,
all six critical coverage floors and supported Rust suites, including 547 desktop
tests (seven ignored), 62 Host units and eight real TLS/Host-client checks.
`make verify` initially stopped on missing candidate extension dependencies;
its missing coverage/Rust targets passed after linking the existing caches. A real ten-second credential-stall regression retains an
actual cached pool, reports an actionable coordinator issue and verifies recovery.
Earlier unchanged Rust source passed separate GChat and Host/Manager Clippy with
warnings denied; the current change is UI/documentation only and native compilation
emitted no warnings. All five
code-session tests pass after a test-only lint correction. Independent source
review findings were implemented; root reviewed the actual changes and receipts.

Windows package:
`/ai/gchat/out/ginfer-manager/windows/ginfer-manager-windows-x64.zip`.
Current native Rust/MSVC compilation took 1m37s with one Cargo job and the standard
release profile. Source staging, four archive members, current guide and hashes
pass. The installed normal window and original pinned HTTPS identity/grant pass.
The native memory guard stayed above its 4 GiB floor after the unchanged 8 GiB
start preflight; minimum available RAM was
6,689,947,648 bytes. Shared compiler/dependency caches were preserved.

Earlier native tray, pairing/vault, Scan, saved-pair restart, no-tray and LAN-port
proof is retained in the Windows package's `native-smoke/` and
`native-smoke-status/`. This is baseline evidence, not replay of the current PE.
Private fixtures and superseded native source/output were retired. The current
acceptance does not claim inference/GPU qualification.

Linux refresh packet:
`/ai/gchat-worktrees/oi074-frontend-packages/out/oi070-linux-refresh/`.
Its `manager/ginfer-manager-linux-x64.tar.gz` contains the Manager and matching
Host compiled from `54c931c68`; accepted assembly source `02d369e8a` only
changes the cached AppImage runtime environment. Ubuntu 24.04 native compilation
and both client package formats pass. The outer archive postcopy's ownership
failure was recovered with unique temporary archive/checksum files and atomic
replacement, terminal 0; see `assembly-final-status.json`.
Root promotes the accepted Manager archive/guide/checksums to
`/ai/gchat/out/ginfer-manager/linux/` and retains the evidence packet at
`/ai/gchat/out/oi070-linux-refresh/`, with the old packet path as a stable
symlink to the same files. The earlier `2a6e21ff2` pinned HTTPS/sharing proof
remains historical evidence rather than a replay of this binary.

Independent DEB and AppImage package closure/ABI, companion and Manager
archive verification pass in `package-verification.json`. Actual dark X11
startup, four installed-runtime verification, Models Scan showing Inventory
refreshed, and Manager close/reopen pass for both formats. `WM_DELETE_WINDOW`
exits Manager; its new process returns online with the same shared Host
PID/UUID. DEB uses Host 1055553 / `726abf22-f807-483f-9098-d067f84ef9f9`;
AppImage's actual wrapper 1061283 launches desktop 1061355 and Host 1065499 /
`38674ad7-0bb9-4148-9a6b-fe048702e729`. Each has zero models, instances and
requests; see `native-acceptance.json` and `evidence/native/`.

The fixture uses public locator `127.0.0.1:17443` because mirrored Windows
Host PID 23052 owns 7443/7444 and native default binding returns `EADDRINUSE`.
This does not qualify default-port coexistence or LAN sharing. All owned native
app/Manager/Host/wrapper processes are absent after shutdown and port 17443 is
free. Original Windows PIDs 40160/15224/23052 remain unchanged, with zero
Engines. The leftover 2,117,107,712-byte AppImage extraction was explicitly
retired after a privileged live-use scan found no references or uninspectable
processes. Canonical guard 1043205 terminated/released; booking 287 was canceled
at actual END 22:57 UTC.

The Ubuntu 24.04 build's ELFs require at most GLIBC 2.39; current native checks
on Ubuntu 26.04 are not a fresh clean-Ubuntu 24.04 qualification. GTK3,
WebKit2GTK 4.1 and Soup3 remain prerequisites. Linux tray and Secret Service
pairing acceptance (OI-071) are unrun. Client packages retain Engine `05a286ba`,
four exact 167-payload images, 22 catalogs / 174 Qwen/Muse profiles and six
version-matched offline documents. That historical Engine reports unknown
embedded commit/dirty fields; exact baseline bytes/manifests establish its
provenance. There is no Flash, new Engine capacity, model or GPU qualification
claim, and Server 2 is untouched. See [installer refresh](../installer-refresh/README.md).
Linux package/window lifecycle acceptance remains accepted baseline evidence.
The real-tray lifecycle correction and verification above are the next OI-071
action; the historical window-only check does not qualify that behavior.

Both packages contain Manager, matching Host, guide and font license. They
contain no inference engine or models. Registered service/Desktop ownership
continues to select the actual Host and engine independently of these companions.

## Execution corrections

Fresh candidates need existing root/core/web and extension workspace dependency
links before checking. Two early gate attempts lacked the extension state/package
links; restoring them, without installation, produced passing extension coverage
and all remaining Rust checks. Future candidate preparation includes these links.

The first updater correctly refused a remembered Host PID before changing files.
Actual inspection found all apps closed, not a replacement Host process. The update
uses the verified current process inventory; normal Manager startup owns a new
registered Host process while retaining its identity. Native number inputs report
as UIAutomation Spinners. Do not use numeric ValuePattern editing in a live launch
form during user testing: the 21:37:59 Reload attribution remains unresolved, and
such automation has stopped. Use DOM payload regressions and read-only native
control inspection; no successful automated native clearing claim is retained.

The final review corrected an inaccurate eight-second baseline claim by checking
the original code and preserving its ten-second deadline. Credential preparation
and network timeout classification now differ before errors become text. The
shared transport implementation removes the divergent snapshot route. Regression
checks protect cached pools, recovery and blocking unknown-host legacy migration.

Direct Cargo checks require the public resource-stub target. Typed errors are
mapped at existing String IPC boundaries. A live membership fixture releases its
data lock before awaiting delivery. A pre-existing test-only clone warning uses a
borrowed slice; its focused tests and warning check pass.

Combined GChat test-tauri/Manager feature unification was an invalid check
configuration; separate product Clippy commands are authoritative. Native scripts
use actual `wslpath` output and the verified Ubuntu distribution. Guarded native
startup waits for actual Windows headroom after WSL file-page advice; one refused
preflight started no compiler. Shared cache files, toolchains, release profiles and guard
floors were preserved. Earlier low-headroom compiles stopped only their owned
Cargo trees; pinned Process handles retain the real PowerShell 5.1 exit status.

## Owned inventory

| Owner / host | Exact path | Purpose and retention |
| --- | --- | --- |
| GChat / RON-9950X3D2 | `/ai/gchat` | Stable main delivery checkout |
| S2 native provider fixture / GChat coordinator | `/home/ron/.local/share/GInfer/oi071-manager-54c931c68` | Accepted54 baseline; FIFO806 completed with native secure-storage readiness PASS, timeout124 and exact Manager absent. Tray Open/Exit remains unqualified. Retain fixture/evidence for corrected-artifact pairing/lifetime acceptance; original Host/state/models preserved, no Host/model/grant created. |
| Linux tray lifecycle / GChat coordinator | `/ai/gchat-worktrees/oi071-linux-tray` | Source candidate from `85f0bac2047c70cfa219ea8ef334367faf966138`, branch `fix/gchat-oi071-linux-tray`; product `deaf467a1`, compiled from `14592d330`. Component/package gates pass; retain unmerged source for native tray/grant acceptance. No live job or model. |
| Linux tray build365 / GChat coordinator | `/ai/gchat/out/remaining-acceptance-20261009/oi071/build-365-deaf467a1-proposed/` | `output-r2/manager/` retains the accepted 5,085,204-byte four-file candidate archive. Both binaries require at most glibc2.39. `output/` retains the read-only generated-directory setup failure. Exact container is removed; shared Cargo cache remains. |
| Retired stopped-error UI / GChat coordinator | `/ai/gchat-worktrees/manager-stopped-error-7d9` | Removed October 10 after clean/upstream/live-use checks; source is integrated at `574d73df7`, and branch `fix/gchat-manager-stopped-error-7d9` remains published at `ce6b9ff40`. Installed and focused-check evidence retained. |
| Retired current-user NSIS / GChat coordinator | `/ai/gchat-worktrees/current-user-nsis-7d9` | Removed October 10 after clean/upstream/live-use checks; product patch is integrated at `1a9044e65`, and branch `fix/gchat-current-user-nsis-7d9` remains published at `d6da84677`. Both retired trees released 551,276,544 allocated file bytes; accepted packages, active candidates and shared caches remain intact. |
| Diagnosis clarification | `/ai/gchat-worktrees/manager-kv-diagnosis` | Documentation-only correction on `6ea7dc9d4`; source in Git and checkout retirement in task `diagnosis-cleanup.json` |
| C4 startup diagnosis | `/ai/gchat-worktrees/manager-kv-math` | Documentation branch from `fbe10c93d`; attribution follow-up retained beside existing KV evidence, checkout retirement in `math-worktree-cleanup.json` |
| KV budget candidate | `/ai/gchat-worktrees/manager-kv-budget` | Accepted `ce6a6c0e6` retained in Git; checkout disposition in task `worktree-cleanup.json` |
| KV budget evidence | `/ai/gchat/out/manager-kv-startup-20261008/` | Pinned public snapshot/catalogs, review and source/native checks; no credentials or model copy |
| KV native candidate | `C:\Users\Ron\AppData\Local\GChat\windows-build\manager-kv-startup-20261008` | Retired after accepted Windows package/install; shared cache junction detached first |
| Offline source candidate | `/ai/gchat-worktrees/manager-offline-status` | Reviewed source retained in Git; checkout disposition in task `worktree-cleanup.json` |
| Windows accepted package/proof | `/ai/gchat/out/ginfer-manager/windows/` | Current archive/guide/hashes and earlier public native proof |
| Windows desktop/NSIS / GChat coordinator | `/ai/gchat/out/remaining-acceptance-20261009/oi068-windows-20261010/` and native `%LOCALAPPDATA%/GChat/remaining-acceptance-20261010/production-nsis-only-574d73df7-proposed/` | Retain compiled353 desktop, installed364 embedded UI/split Code Stop evidence, fresh367 568,903,887-byte installer and package proof, actual wrapper exit1 and correction, terminal/release receipts. Original353 packaging abort stays historical. All build processes are absent and guards released; original state, component baseline and shared cache retained. |
| Linux accepted package/proof | `/ai/gchat/out/ginfer-manager/linux/` | Refreshed Manager compiled `54c931c68`, guide/checksums; earlier native proof retained as historical evidence |
| Linux refresh packet | `/ai/gchat/out/oi070-linux-refresh/` | Accepted `02d369e8a` assembly, compiled `54c931c68`, independent package/native proof; old packet path retained as stable symlink |
| Offline task evidence | `/ai/gchat/out/manager-offline-status-20261008/` | Required gate, Clippy, native build, installed UI/identity, cleanup receipts |
| Native task mirror | `C:\Users\Ron\AppData\Local\GChat\windows-build\manager-offline-status-20261008` | Retired after package/install acceptance; detached shared-cache junction first |
| Superseded native baseline | `C:\Users\Ron\AppData\Local\GChat\windows-build\ginfer-manager` | Retired; public proof preserved beside accepted Windows package |
| Shared caches | `/ai/gchat/node_modules`, `/ai/gchat/src-tauri/target`, native `windows-build/source/src-tauri/target` | Preserved dependencies/compiler cache |
| Earlier source candidates | `/ai/gchat-worktrees/ginfer-manager`, `/ai/gchat-worktrees/unified-sessions`, `/ai/gchat-worktrees/local-update-20261008` | Retired; source commits and accepted evidence retained |

Earlier Manager-specific Linux/Windows compiler targets were retired after their
acceptance. The October 9 shutdown drain also retired duplicate Windows staging
artifacts and the parked documentation checkout. Six other owners' unmerged
worktrees, shared caches, installed apps/data, engine artifacts and evidence remain.
The scoped read-only GChat survey reached S1, Ada, S2 and the laptop; no remote
deletions or fleet-wide cleanliness claim are made. The retained-path list and
cleanup receipts are in `/ai/gchat/out/manager-kv-startup-20261008/`, including
`drain-hygiene-not-deleted.md` and `drain-cleanup-result.json`.
GInfer's separate operations-manual handoff is tracked in
[Agent runtime](../agent-runtime/README.md).
