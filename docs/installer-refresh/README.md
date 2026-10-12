# GChat installer refresh

## SectileLabs updater feed — OI-110

All GChat check/download paths and release asset URLs use the configured feed:
`https://github.com/SectileLabs/gchat/releases/latest/download/latest.json`.
Ron explicitly designates the private, empty `SectileLabs/gchat` repository
for release artifacts only when ready. Development source and the build/tag
workflow remain in `Gadflyii/GChat`; do not push source code to the destination.
The source-only routing correction is implemented and independently reviewed in
this owned candidate. It is not release-qualified.

`.github/workflows/release.yml` requires execution in `Gadflyii/GChat`, with
source `GITHUB_TOKEN` Contents-read permissions. Draft creation explicitly targets
`SectileLabs/gchat`; all six payload/signature/manifest uploads use that draft's
upload URL and separate `SECTILE_RELEASE_TOKEN`. Previous published-release queries
and draft-body edits also explicitly target the destination. Release-note git
history, contributors and commit links remain in the development repository;
published style examples are read separately from the artifact repository.
Destination-generated git notes are disabled so artifact-repository history is
not presented as development history. Draft-only behavior and exact final
payload/signature gates remain unchanged; no source mirror or forced tag is added.

The release owner must configure `SECTILE_RELEASE_TOKEN` in the development
repository with Contents-write access scoped only to `SectileLabs/gchat`; the
workflow fails before draft creation when absent. Configuration/access is
unverified: no credential was read, provisioned or used. Check the destination's
default branch and release-tag readiness without copying development source.
Destination readiness and anonymous access to the configured updater feed must be established for the next
approved release without placing credentials in the app. Signing/publication
remain separately gated; this correction does not resolve the live404 itself.

Ron authorized local unsigned preparation; signing/publication await his next
release. The release workflow and `src-tauri/latest.json.template` cover only
the supported Windows/Linux products; macOS jobs and manifest branches are removed.
Its unsigned copy is `/ai/gchat/out/remaining-acceptance-20261009/oi110-latest.unsigned.json`.
Version, date/notes, selected platforms, final asset names and signatures remain
pending; this empty preparation artifact is not an installable manifest. Each
published entry needs a nonempty signature verified against the unchanged key
and exact payload. CI now requires one nonempty final updater payload and its
nonblank freshly generated signature; metadata uses the exact re-signed path,
and manifest generation rejects successful platforms with blank signatures.

GCHAT-UPDATER-SIGNATURE's original blank-signature rejection is already inherited
from `f7b2f43fe`. The independently reviewed follow-up also rejects an absent or
whitespace-only final asset name for a successful platform and incomplete version,
using the shared production `scripts/updater-manifest.jq` filter. Skipped/failed
platform entries remain omitted; valid signatures, URLs, notes and supported
platform structure are preserved. Exact post-signing NSIS/AppImage selection,
required regular nonempty signature files, credentials and existing key are
unchanged. The manifest job now gates the production filter through
`tests/test_updater_manifest.py`: 19 offline cases cover complete Windows/Linux/
combined metadata, failed/skipped omission, blank signatures/names and version.
Sentinel signatures establish metadata admission only, never cryptographic validity.

YAML/Python syntax and shell syntax checks pass; behavioral execution is deferred
until the CPU quiet period ends at22:20Z. Local `jq` is absent and must be supplied
by an already admitted environment, without dependency installation. Focused next
check: `python3 -m unittest discover -s tests -p test_updater_manifest.py` with jq
available. This tests the changed production filter; reuse passing routing/syntax
evidence and run no full suite. The older prepared
aggregate fixture must stage the new shared filter before running its copied
workflow step; no fixture PASS or release qualification is claimed yet. This
source-only follow-up passes coordinator and independent diff review; behavioral
acceptance remains pending.

Actual cryptographic acceptance against the unchanged public key and downloaded
payload remains a scheduled-release gate. The recorded live 404 remains open.

Retain `/ai/gchat-worktrees/oi110-sectile-feed-bd4` on
`fix/oi110-sectile-feed-bd4` (baseline `bd4dba841`) for coordinator review and the
unsigned copy for release preparation. Prior endpoint/repository evidence is in
`out/remaining-acceptance-20261009/`: `oi110-endpoint-20261010T0433Z.json` and
`oi110-release-location-20261010T0436Z.json`. Focused local checks pass: YAML 1.2
parsing, `bash -n` on all 25 Linux/explicit Bash run blocks, Python syntax and
offline source/destination routing assertions
including all six uploads and unchanged signature/metadata/manifest gate blocks.
`git diff --check` passes. These are local syntax/source checks, not CI execution
or credential/publication acceptance; no build, native execution, signing or
publication ran. Later metadata/JQ release admission checks are prepared in
`/ai/gchat/out/remaining-acceptance-20261009/oi110-release-gate-checks.txt`.

## Current engine acceptance — OI-056/OI-083, October 9, 2026

Repository: GChat; subject: `docs/installer-refresh/`. Owner: GChat coordinator.
Ron approved a current native Windows engine build and end-to-end testing on
RON-9950X3D2, superseding the intervening Linux-only instruction. Acceptance:
normal GChat/Manager startup; Qwen 27B and Muse load; actual Chat replies finish
and return idle; four overlapping requests finish; Reload reaches Ready in a
new session; Stop leaves no engine or automatic reload. Preserve user data and
the original saved Muse profile. Server 2 and unrelated Engine performance/numerical work remain excluded.
The user subsequently approved controlled React/parser/Vitest alignment; see
[the composed remediation](../code-hygiene/README.md) for current scope.

The physical local GPU is RTX 5090 UUID
`GPU-92a61cb1-6b5e-cc7b-b669-72b2662d9d6e`; Windows reports 128 GB RAM.
Installed desktop source is `0f06ba433`; Manager source `43c8d71cf` is reused
with explicit unchanged-input provenance. Native clean `2ef56a52a` is installed
in active and bundled runtime roots; all 125 payloads match. Actual Chat and
continued replies finish idle, XLSX local document access returns exact fixture
values, agent definitions/calling tools are discoverable, and manual/automatic
compaction preserves continued context. The original step-limited Coordinator
history displays incomplete with its available output intact. Original threads,
model files, settings, owner, runs, Host identity/certificate and all 103 original
profile values survive; the distinct automatic candidate is pending qualification.

Reviewed source `68315e6a3`, integrated as `0f06ba433`, preserves Ready
aliases, rejects stale picker reads and shares native startup across sidebar,
Host readiness and persisted provider hydration. Stop invalidates delayed local
or paired intake and waits for an already dispatched native start before
shutting down the singleton. Paired remote aliases receive no native model
mutation. All 85 focused cases and composed `make verify` pass: 2,112 frontend/
core checks, 102 extension checks, six coverage floors and supported Rust suites.
Native build exits 0 at 21:30 UTC; independent package verification passes at
21:34 UTC. Installed payload/preservation and actual lifecycle acceptance pass.

Real sidebar Stop leaves the Host stopped with zero Engines/API listeners and
remains stable on a later check. Start reaches fresh Ready session
`11ba8c36-0426-4912-a089-083cfca2b86f` with selected alias/Server running and one
Engine/API listener. Reload reaches distinct Ready session
`3b3bf837-f98b-400b-bf19-b9c05c334d21` with selection/status retained. Continued
Chat saves `QXr1fqK7RSTetk3Y` ready/stop with 30,000 after automatic compaction
from 26,366 to 1,705 tokens; the 4.614-second turn returns idle. Final GUI Stop
returns to zero Engines/API listeners. Supported Reload/Stop restores the exact
original profile; its existing fixed-arena startup failure remains OI-072.
Normal apps are restored without debug listeners. Evidence:
`out/oi106-final-update-20261009/installed-verification.json` and
`installed-lifecycle-acceptance.json`. This is C4/32K functional acceptance,
not a new 128K capacity pass. Earlier `7d9eb55f9` Start reached Ready/API serving
with blank selection/stale status; that failure remains historical evidence.
Windows reviewed source and metadata are published on main `e2521e33`;
installed Windows product remains `0f06ba433`. Linux assembly is complete at
`02d369e8a`; independent package and actual native X11 acceptance pass below. Completed OI-106
and profile source trees are retired; source branches and evidence remain.

GInfer `docs/installer-refresh/README.md` owns OI-058's portability build:
frozen production source matches requested `f9af4cff4`, current base `f6d097566`,
MSVC 19.44/CUDA 13.3.73 Release/SM120a, native build `2ef56a52a`, branch
`dev/oi058-msvc-f6d09756` tip `4f47bb3f9` (documentation only after the build).
Native compile/link, help, server version, closed ZIP, PE dependencies and all
six offline operator docs pass; final compiler/linker warnings are zero.
Bubbs merged the portability branch as `634a16e16`: all four Linux images
and tests passed, with zero new warnings and 228 SM120a CTest cases. Future
Windows engine builds start from `dev/next`. The tested native `2ef56a52a`
payload is retained without a redundant rebuild. Use `ginfer-serve --version`; the CLI has no version flag.

Actual Manager Start with the original Muse C4/131072/NVFP4 fixed pool still
fails before Ready (OI-066/OI-072). For bounded functional checks, reuse the
previously tested C4/32768 automatic-pool controls; they do not qualify 128K
capacity. Both Qwen and Muse reach Ready. Each completes four overlapping
responses with normal stop finishes, peak four active requests and zero after
drain. Manager Reload reaches a new Ready engine session for each; Manager Stop
leaves both stopped with no native engine. The original fixed profile is restored exactly through supported Reload/Stop;
the final snapshot is stopped with zero active requests and no native engine.

OI-083 reproduces a local Host instance missing from ordinary Chat's picker.
The native alias route supports local instances; frontend projection and facade
readiness exclude them. The fix exposes online Ready local and paired instances
through the same opaque aliases and labels the provider GInfer Hosts. Stopped
instances/offline hosts remain unavailable. Source `a40d7221` passed full
`make verify`; native NSIS/MSI assembly and the local update passed. Independent
installed checks confirm the desktop's accepted three-byte bundle tag, exact
CLI/Host bytes, both 125-payload runtimes and all 103 profile values. Seven
original thread IDs, original model files, settings, owner, saved runs and Host
identity/certificate are retained. The actual picker now exposes the Ready local
instance and the facade starts; OI-083's behavior is verified.

OI-091 compact capability discovery replaces the former 40,666-token tool
payload with exact schema loading through the shared permission runtime. The
actual first installed Chat request used 1,514 input tokens and completed; all
four continued replies ended normally. Automatic compaction reduced 25,988 to
5,419 prompt tokens; manual compaction reclaimed 20,569. These checks establish
ordinary Chat behavior, not maximum-context capacity. The original saved Muse
profile is restored exactly and stopped, with zero native engines.

The corrected public C4/128K attempt reaches Ready and prepares four distinct
131,009-token inputs, but device-wide free memory drops to 292 MiB during
prefill, below the unchanged 300 MiB guard. The runner aborts and restores the
original stopped profile successfully. No decode completes; no Engine OOM or
KV/admission error is logged. Allocation ownership is unresolved because the
saved telemetry lacks live process-residency/allocation counters. OI-072 remains
open; no reduced margin, retry or capacity promotion is authorized by this result.
Evidence: `out/code-hygiene-20261009/integration/` and
`out/remediation-native-correction-20261009/`.

Windows main is `e2521e33`; installed product remains `0f06ba433` with the
same reviewed runtime code. Both clean
merged OI-056 source worktrees are retired; their committed branches and remote
ancestors remain. Current remediation is coordinated in
[code hygiene](../code-hygiene/README.md).
Evidence: `/ai/gchat/out/oi056-current-engine/`, including original-profile-public,
original-start-final-snapshot, both four-concurrent results, both UI Reload/Stop
snapshots and runtime-update-result. Cleanup released 2.479 GB net allocation; exact latest native installers and
checksums are promoted to `/ai/gchat/out/windows`. Native baseline caches and
evidence remain. See `cleanup-result-current.json`. The exact tested Engine
archive `%LOCALAPPDATA%/GInfer/gchat-oi056-f9af4/output/ginfer-windows-x64-sm120a.zip`
and retained debug evidence remain; its superseded build/stage/export directories
are retired. [Code hygiene](../code-hygiene/README.md) owns that cleanup receipt
and current disk inventory.
App rebuild uses the existing `%LOCALAPPDATA%/GChat/windows-build/` cache and the
exact verified 2ef archive; cached 613 resources must be replaced by the builder.
Qwen inventory registration references its existing release-1003 artifact;
no model bytes were copied or downloaded. Retain that useful registration.

Use only `/ai/coordination/locks/local-5090-gpu.lock` and
`/ai/coordination/locks/local-build.lock`, held for the actual run. The old owned
launcher was updated; no `/tmp` GPU/build lock is used. Windows source/build/package and actual lifecycle acceptance are complete;
Linux assembly, independent package verification and native X11 acceptance pass. Keep the physical RAM floor and compile/load exclusion.
Failures go in GInfer's sole master `docs/maintainer/open-work.md` under its edit
lock. Ron's newer in-session instruction authorizes the post-Windows-merge GChat bug
and review phase now. Windows source is merged and pushed and Linux package/X11
acceptance passes; next continue the Host/Manager review requested
in Bubbs’s 22:43 handoff. Retire only verified owned completed trees.
Remaining physical work stays in the sole master list. Preserve
other owners' trees and the accepted installed/build baseline; leave Server 2 alone.

## Local workstation update — accepted October 8, 2026

GChat 2.0.42 and its owning Host are updated on RON-9950X3D2. The standalone
GInfer Server Manager is installed and open using the normal shared registry,
real user configuration and GChat-owned Host. The local host is online at
`https://127.0.0.1:7443`; its original identity and managed data root are preserved.
At acceptance, desktop PID 14424, Manager PID 3424 and Host PID 36616 are running;
the saved instance is stopped, with zero requests and no engine process.
Server 2 received no administration, deployment or test jobs.

The user authorized this local update after Manager acceptance. Deliver current
GChat/Host and the accepted standalone Manager, preserve user state, and verify
normal startup. Native packaging, installed bytes, shared-host attachment and
preservation checks pass. Next: the user's local click testing of shared sessions,
Code capabilities, document access, compaction and model lifecycle. Fleet pools
remain unconfigured; select a coordinator before testing shared assignments.
Real-model replay and remote-fleet behavior are not established by this update.

### Source, runtime and verification

Accepted main baseline is `cca5168ef`; the owned candidate is
`fix/local-update-20261008`. Native code is frozen at `de0edde34`.
Packaging correction `d41032c87` uses the canonical shared workspace Host output
in Windows, Make and CI recipes. Correction `de0edde34` preserves native Bun/uv
during the source mirror and replaces generated extension assets with the exact
current producer set. Both changes passed independent review. Actual native
production-argument mirror and byte-level asset regressions pass.

Required `make verify` passed at `de0edde34`: 2,067 frontend tests (six skipped),
102 extension tests, thirteen Manager DOM tests, all six critical coverage floors
and supported Rust suites, including 546 desktop tests (seven ignored), 62 Host
units and real TLS/client/fleet regressions. Later changes are documentation only.
The accepted Manager binaries at runtime source `2a6e21ff2` are reused.

NSIS/MSI assembly exited zero at 19:02 UTC; the local NSIS update exited zero at
19:06 UTC without elevation. Installed desktop matches the produced PE except
Tauri's three-byte NSIS tag; CLI and Host match canonical produced/staged bytes.
Both bundled and active engine runtimes verify all 120 payloads at clean source
`6138913fcdca5891e072c6ca34d79ce7ffa30498`, Windows x64/SM120a/CUDA 13.3.
The exact installed runtime was recovered into a closed 121-member input archive;
this is neither an engine rebuild nor new qualification. All 103 profiles from
fourteen explicit catalogs are unchanged. Six bundled archives, six active
extension entrypoints and their fingerprint match. No dependency upgrade, model
download, GPU inference or engine build was performed. Native Rust emitted no
compiler warnings; the existing Vite large-chunk advisory remains.

Post-startup checks preserve two installed Muse models (four model/config files,
44,808,326,736 bytes), all nine conversation IDs and nine saved run IDs, agent
definitions, settings, MCP configuration and legacy pairing references. The remote
host ID, client ID, certificate pin and readable native vault grant are preserved
without exporting credentials. The local shared client now uses the Host's stable
`local_client_id`; the original local administrator reference remains in the
unchanged legacy registry. Original local Host identity and certificate pin remain.

### Execution corrections

The initial archive selection was stale October 1 source `74780ea1`. Preflight
caught the possible downgrade before building; delivery preserves installed `6138913f`.
The first native attempt exposed Robocopy deleting cached helpers when their source
directory was absent. Its actual parent-directory fixture and destination exclusion
verify the correction. The obsolete ginfer-extension 0.1.0 archive left by NSIS
was removed only after its exact old bytes and current 0.1.1 replacement were verified.
User extension folders were not manually removed.

The second attempt crossed the unchanged 4 GiB Windows running-memory floor and
stopped only its owned compiler tree; no installer ran. The successful continuation
reused completed stages with one Cargo job and the standard fat-LTO/codegen1 profile,
requiring 12 GiB fresh Windows headroom and a quiet WSL interval. Sampled native
private memory peaked at 7,234,605,056 bytes; minimum available Windows memory was
7,237,103,616 bytes. File-scoped clean-page advice retained every owned cache file;
no global cache purge or profile change was used. CPU booking and build lock are released.

Normal startup rejected the old locator's retired `owner.hardware_profile` field.
The exact local upgrade migration validated its prior hash, retained the original
record and removed only that field, preserving every other value and the referenced
hardware-profile file. No compatibility alias or source change was added. Disabled
autostart leaves GChat Home's Host lazy; opening Manager or the supported Host/Models
view attaches the existing owner and starts its controller, without loading a model.
Pinned HTTPS and actual windows verify both apps resolve that same updated Host.

### Owned inventory

| Owner / host | Exact path | Purpose / retention |
| --- | --- | --- |
| GChat / Ron-9950X3D2 | `/ai/gchat` | Reviewed source and current acceptance record integrated into stable main |
| Local update / coordinator | `/ai/gchat-worktrees/local-update-20261008` | Accepted candidate; release at final handoff after reviewed merge/push, preserving source in Git |
| Prior Manager candidate | `/ai/gchat-worktrees/ginfer-manager` | Superseded clean tree retired; six focused logs preserved in `out/ginfer-manager/focused/` |
| Local update evidence | `/ai/gchat/out/local-update-20261008/` | Retain gate, input/payload proofs, resource-failure evidence, migration backup, install/startup receipts and final Manager image |
| Accepted installers | `/ai/gchat/out/windows/` | Current NSIS/MSI and valid adjacent checksums; duplicate native staging copies retired October 9 |
| Native shared build | `%LOCALAPPDATA%/GChat/windows-build/source` | Accepted release/dependency cache; preserve |
| Native task | `%LOCALAPPDATA%/GChat/windows-build/local-update-20261008` | Disposable wrappers/fixtures retired after evidence copy and live-use checks; 837,401 bytes released |
| Recovered engine input | `/ai/gchat/out/local-update-20261008/recovered-installed-runtime-6138913f.zip` | Exact current manifest and 120 installed payloads; retain reproducible input |
| Installed GChat | `%LOCALAPPDATA%/GChat`, `%APPDATA%/GChat/data` | Updated desktop/Host and retained normal user state |
| Installed Manager | `%LOCALAPPDATA%/Programs/GInfer Server Manager` | Four accepted files and per-user Start Menu shortcut; shared real Host |
| Shared caches and Manager packages | `/ai/gchat/node_modules`, `/ai/gchat/src-tauri/target`, `/ai/gchat/out/ginfer-manager/` | Retain dependencies, compiler cache, accepted packages and evidence |
| Server 2 and unrelated owners | Existing app/data/host state and other worktrees | Outside this update and cleanup |

Concise acceptance and exact receipts: `/ai/gchat/out/local-update-20261008/HANDOFF.md`,
`artifact-promotion.json`, `installed-verification.json`, `normal-state-verification.json`,
`normal-local-host.json`, `normal-credential-preservation.json` and `manager-normal-window.png`.
Cleanup receipts record actual retirement; normal installed apps remain open.
The prior Manager worktree released 310,585,359 bytes; its focused logs remain.

### October 9 shutdown drain

The drain removed 1,384,909,864 nominal bytes of outside-cache Windows installer
and runtime duplicates after exact comparison with retained canonical files.
Two stale staging checksum sidecars were also retired; canonical installer
checksums and promotion receipts remain valid. The owned documentation checkout
is retired after its parked branch is committed and pushed.

Six other coordinators' code branches remain unmerged into main: `dev/fn-product-host`,
`dev/fn-product-installers`, `dev/fn-product-native-lifecycle`, `dev/fn-product-gchat-ui`,
`dev/fn-trash-contract-platform`, and `dev/gbench-engine-telemetry`. Their worktrees
are preserved. Installed Manager `ce6a6c0e6` and desktop `de0edde34` are already
ancestors of main. This coordinator's remaining handoff is documentation only.

Shared caches remain. The superseded 7.15 GB Linux private target remains because
process-inspection permissions prevented a complete live-use check. The scoped
GChat survey reached S1, Ada, S2 and the laptop; no remote files were deleted.
Retained paths and publication status are recorded in
`/ai/gchat/out/manager-kv-startup-20261008/drain-hygiene-not-deleted.md`, with actual
deletions in `drain-cleanup-result.json`. No builds or GPU tests were started.

## Offline host status Windows update — accepted October 1, 2026

The local Windows app is updated and open with source `d3199048d`. Offline host
cards show muted **GInfer offline** without the raw red connection error; cached
inventory and disabled loading remain. The 12 host-page tests and full `make verify`
pass. See [host UI evidence](../host-ui/README.md).

NSIS/MSI assembly and the authorized update exited 0 on RON-9950X3D2. Installed
desktop matches the build except Tauri's three-byte NSIS tag; CLI and host match.
Both 120-file runtimes verify against unchanged engine
`74780ea1415ac8d3bb440d58442ac4f81a5dfde3`, with the unchanged 103 profiles.
Four models (44,808,326,736 bytes), eight conversations, nine saved runs and agent
definitions are preserved. Visible desktop PID 40660 / host PID 37580 and local
HTTPS identity pass startup verification. Server 2 remains uninstalled.

Retain `out/offline-host-status-20261001/` and current
`out/windows/GChat_2.0.42_x64-setup.exe` / `GChat_2.0.42_x64_en-US.msi` with
adjacent checksums. The owned native task directory is removed; accepted build
caches remain. Candidate retirement is recorded in the handoff receipt. Native
Rust emitted no compiler warnings; existing Vite large-chunk warnings remain.
The offline host card is the next interactive check.

## Agent follow-up Windows update — accepted October 1, 2026

The local Windows app is updated and open with source `a5d2e35f7`. Delegated agent
results now omit absent JSON fields so streaming Chat can continue after finished,
incomplete or failed runs. The production SDK and ThreadMessage reload regression,
full `make verify` and independent review pass. The user confirms Stop works;
task budgets are unchanged. See [runtime evidence](../agent-runtime/README.md).

NSIS/MSI assembly and the authorized update exited 0 on RON-9950X3D2. Installed
desktop matches the accepted build except Tauri's three-byte NSIS tag; CLI and
host match their payloads. All 120 members of bundled/active runtimes and the
unchanged 103 profiles from 14 explicit catalogs verify. Engine source remains
`74780ea1415ac8d3bb440d58442ac4f81a5dfde3`. Four model files (44,808,326,736 bytes),
eight conversations, eight saved runs and agent definitions are preserved.
Visible desktop PID 2900 / host PID 21120 and local HTTPS identity passed startup
verification. No model was started by these checks. Server 2 remains uninstalled.

An elevated old host survived the first non-elevated update. Payload verification
caught it; after the user's UAC approval, the elevated retry replaced the host.
The retained updater now refuses an inaccessible host before NSIS and checks
termination. Installer exit 0 alone is insufficient acceptance.

Retain `out/agent-followup-20261001/` and current
`out/windows/GChat_2.0.42_x64-setup.exe` / `GChat_2.0.42_x64_en-US.msi` with adjacent
checksums. The owned native task directory is released; compiler/dependency
caches remain in `%LOCALAPPDATA%/GChat/windows-build/source`. Candidate cleanup
is recorded at handoff. Native Rust emitted no compiler warnings; existing Vite
large-chunk warnings remain. User replay of the same agent/continued conversation
is the next interactive check.

## Shared capabilities Windows update — October 1, 2026

The local Windows app is updated and open with source `f39cee7ed`. Streaming
Chat now discovers native skills/saved agents and MCP tools through the shared
capability runtime; per-thread permissions/folders and cancellation propagate
to native tasks. Sidebar Stop suppresses idle model restart and serializes with
model switches. Full source verification and independent review passed;
implementation/evidence are tracked in [agent-runtime](../agent-runtime/README.md).

Both NSIS/MSI assembly and the in-place update exited 0. The unchanged accepted
engine is `74780ea1415ac8d3bb440d58442ac4f81a5dfde3`; all 120 members of both
bundled and active runtimes verified, along with the unchanged 103 profiles
from 14 explicit catalogs. Installed desktop matches the build except Tauri's
three-byte NSIS bundle tag; CLI and host match their payloads. Visible desktop
PID 38412 / host PID 28832 and local HTTPS protocol version 1 passed startup
checks. Four models (44,808,326,736 bytes), eight conversations, seven runs and
saved agent definitions are preserved. Live Stop/skill replay remains the user's
acceptance check. Server 2 remains uninstalled.

Retain `out/shared-capabilities-20261001/` evidence and the current
`out/windows/GChat_2.0.42_x64-setup.exe` / `GChat_2.0.42_x64_en-US.msi` with
adjacent checksums. These replace the earlier October 1 installers. Reuse
`%LOCALAPPDATA%/GChat/windows-build/source` accepted release/dependency caches;
release the owned candidate and native `windows-build/shared-capabilities-20261001`
task directory after evidence is copied. Existing Vite large-chunk warnings
remain; native Rust emitted no compiler warnings. No engine qualification was
performed or claimed by this app update.

## Accepted Windows update — October 1, 2026

The Windows NSIS/MSI installers include the agent/chat fixes from `9540ac7e1`
and the sidebar Stop server fix. The shortcut now stops the API and unloads the
active local model; when the API is already stopped, Stop model remains available.
API-specific settings retain their independent control. Step budgets and overall
Agent Finished reporting are unchanged. Server 2 remains uninstalled.

Native assembly from `69cfa81146ffadbd972bf6872754f4e16f3b3aa7` exited 0 with
accepted engine `74780ea1415ac8d3bb440d58442ac4f81a5dfde3` and the unchanged
103 Windows profiles. Independent review and full `make verify` passed: 2,042
frontend tests, 15 extension tests, coverage floors and supported Rust suites.
The native mirror matches all 27 changed production files. Four sidebar regressions
cover scoped unload, an unload failure, an already-stopped API and an API stop failure.

The authorized in-place NSIS update exited 0 on Ron-9950X3D2. The installed desktop
matches the accepted build except for Tauri's three-byte NSIS bundle tag; installed
CLI and host binaries match their build payloads. Both bundled and active engine
runtimes have all 120 manifest members verified. The visible GChat desktop started
with its host, whose local HTTPS identity endpoint responds with protocol version 1.
Models are unchanged: four files totaling 44,808,326,736 bytes. All seven thread IDs,
seven saved run IDs and the unchanged agent definition file remain.

Acceptance evidence is retained under `out/windows/acceptance-20261001/`, including
build/install results, runtime/data verification and the final full verification log.
The installed app is ready for the user's continued-chat replay, throughput check
and real sidebar stop/unload check; those interactive checks remain open.

The initial source mirror failed because Windows exposed WSL dependency links as
files. The builder now excludes `node_modules` as both a directory and a file.
A native mirror regression preserved dependency contents while updating/removing
source files. Only verified zero-byte failed-staging placeholders were removed;
the corrected retry passed. Retain the concise failure summary and regression
result. The superseded staging log, temporary mirror fixture and duplicate native
acceptance directory are retired at handoff. The unused native debug caches
(about 11.1 GiB) were removed after confirming no compiler/debug job uses them;
the accepted release builds remain. The owned candidate is retired after integration;
unrelated worktrees and user data remain untouched.

| Owner / host | Exact path | Purpose / retention |
| --- | --- | --- |
| GChat / workstation | `/ai/gchat` | Reviewed source integration; accepted Windows runtime code `69cfa8114` |
| Windows refresh | `/ai/gchat-worktrees/windows-refresh`, `fix/windows-refresh-20261001` | Retired during final integration; evidence retained in main output directory |
| Windows release | `/ai/gchat/out/windows/GChat_2.0.42_x64-setup.exe`, `GChat_2.0.42_x64_en-US.msi` | Accepted installers and adjacent checksums; supersede September 30 copies |
| Windows acceptance | `/ai/gchat/out/windows/acceptance-20261001/` | Retain concise verification, installation and startup evidence |
| Windows build / Ron-9950X3D2 | `%LOCALAPPDATA%/GChat/windows-build/source` | Accepted release builds and native dependencies retained; idle debug caches removed; no live build |
| Windows refresh | `%LOCALAPPDATA%/GChat/windows-build/acceptance-20261001/` | Retired at handoff after evidence retained in main; no live job |
| Windows release / Ron-9950X3D2 | `%LOCALAPPDATA%/GChat/release-output` | Accepted native installer copies |
| Installed Windows / Ron-9950X3D2 | `%LOCALAPPDATA%/GChat`; app PID 39788, host PID 41000 at acceptance | Updated visible desktop and persistent host; no model loaded by acceptance checks |
| GInfer | `/ai/ginfer/out/windows/ginfer-windows-x64-sm120a.zip` | Accepted unchanged 120-member engine runtime |

## OI-074 frontend loading and OI-070 Linux refresh — current work

Owner: frontend/package agent; candidate
`/ai/gchat-worktrees/oi074-frontend-packages`, branch
`dev/oi074-frontend-packages-104d4ec6`, baseline `104d4ec6e`.
OI-074 source acceptance passes. The existing 500 kB warning threshold and
locked dependencies are unchanged. Source defers unused locales, emoji picker,
terminal hosts, syntax engines and Mermaid. Visited terminal hosts stay mounted
through navigation. Saved initial language loads before React renders; language
switches publish only the newest completed selection. JSON-only editors preserve
Prism JSON token classes and editing, while omitting unrelated editor grammars.
Every Shiki language and alias remains supported. Shared grammar data and exact
Oniguruma WASM bytes ship as offline assets, fetched on demand. The agent page is
private to its route, allowing the router's existing automatic split.

Final Linux/Tauri frontend build: Node 22.22.1 / Vite 6.3.2, 14.63 seconds, no
large-chunk advisory. Actual largest JS is 499,377 bytes (deferred Mermaid), entry
485,905 bytes. Bootstrap static closure is 14 JS files / 2,141,685 bytes;
bootstrap plus home route is 33 files / 2,795,678 bytes. Neither closure includes
terminal rendering, emoji picker, syntax engines, Mermaid or unused locales.
The saved Windows baseline main alone is 4,679.49 kB (gzip 1,401.26 kB); this
comparison describes emitted/loading bytes, not measured desktop startup speed.
The final graph has zero chunk cycles. Shared grammar data: 250 assets /
7,091,778 bytes, deduplicated across embedded-language dependencies.

Typecheck, focused ESLint, exact all-language reconstruction and WASM-byte tests,
Markdown, both terminal hosts, route behavior, locale cold-start/races, JSON editor
and stale-highlight regressions pass (50 tests across the focused sets). A
GPU-disabled Edge 154 fixture loads actual emitted files: Russian locale,
JSON/C++/Emacs Lisp colors and preserved text in light/dark themes, Streamdown's
JavaScript regex engine, and Mermaid SVG all pass; external resource requests
are zero. This is frontend asset acceptance, not installed application acceptance.
The coordinator runs full `make verify` after integrating the bugfix branches.

One initial harness used repository cwd, which prevented router generation;
only subsequent builds from `web-app/` are valid measurements. Manual grouping
initially introduced an HTML-parser/Markdown cycle, caught by the actual browser
before source promotion. Concrete prevention: HTML representation/construction
and parser ownership stay together; AST/file utilities and module glue are
independent leaves. Distinct Mermaid math retains its installed version and stays
outside startup. Do not regroup these solely to hit a chunk size.

Evidence: `out/oi074-frontend-packages/` contains the final build log, chunk graph,
loading measurements and actual browser receipt/request list/launch arguments.
Candidate owns 22 MB frontend output and small evidence only; no copied engine,
model or native build. Native Edge used a disposable profile at
`%LOCALAPPDATA%/GChat/oi074-frontend-assets/`; its observed launch includes
`--disable-gpu` and software WARP rendering. Its process exits normally.
The fixture server and profile are retired after preserving the receipt.

The retained Linux log and composed Windows build both contain an unsupported
`onlyExplicitManualChunks` output-option warning. Both actually use cached Rollup
4.40.0, which ignores that property and includes unassigned static dependencies
in manual chunks. The earlier explicit-ownership intention was not applied.
Remove the ignored property and correct its comment; this preserves the behavior
already measured by both builds, including the lazy features and chunk bounds.
The no-large-chunk claim remains valid; these builds were not warning-free.
Prevent recurrence by reading complete build stdout/stderr before acceptance,
not only matching the large-chunk advisory. Source/config checks and the final
coordinator frontend/native check complete this correction.

Linux assembly passes at source `02d369e8a`; native/frontend compilation is
from `54c931c68`. The later source delta only selects the supported cached
AppImage runtime environment. Ubuntu 24.04 / Node 22 image
`gchat-linux-installer-build:ubuntu24` reused the approved aligned dependencies
and shared compiler caches. Native compilation, DEB, and gzip AppImage assembly
exit 0. The outer postcopy wrapper initially exited 2 because its owned Manager
archive was root-owned. A unique temporary archive/checksum followed by atomic
replacement recovered postcopy with terminal 0; no product rebuild was needed.
The exact packet is
`/ai/gchat-worktrees/oi074-frontend-packages/out/oi070-linux-refresh/`, with
`assembly-final-status.json` and `linux-source-admission.json` recording that
source distinction and recovery. Independent package verification and actual
X11 acceptance pass for both formats. Root publishes the evidence packet to
`/ai/gchat/out/oi070-linux-refresh/`, retaining the old path as a stable symlink
to the same files, and promotes the accepted packages to `/ai/gchat/out/linux/`
and `/ai/gchat/out/ginfer-manager/linux/`.

The packet's `linux/` contains `GChat_2.0.42_amd64.deb` and
`GChat_2.0.42_amd64.AppImage` with checksums; `manager/` contains the matching
Manager/Host archive and guide. Both packages retain the exact four-image
`/ai/ginfer/out/linux-installer-20260930/runtime-set/` from Engine source
`05a286ba574114e2ef4dfb00b4015e07ab8c26a5`, 167 payloads per image, and the
`b8d8ea49` catalogs: 22 Linux files / 174 Qwen/Muse profiles. Windows's 104
profiles are a separate platform set. These historical Linux Engines support
Qwen/Muse only, with no Flash or new current-Engine/capacity qualification.
Their embedded server version reports `1.0.0.0-unknown` and unknown commit/dirty
fields; exact baseline payload hashes and manifests establish source provenance,
not those embedded fields. Native checks run on Ubuntu 26.04; the Ubuntu 24.04
build and maximum GLIBC 2.39 are verified ABI evidence, not a fresh clean-Ubuntu
24.04 desktop qualification.

Six offline GInfer documents match the retained `05a286ba` Engine: package
README and the documentation index, CLI, serving, operations and versioning
references. The packet's `operator-docs/provenance.json` records source and
sizes/SHA256. Assembly requires `--operator-docs-directory` (or
`GINFER_OPERATOR_DOCS_DIRECTORY`), checks the six hashes and offline links
against the selected runtime source, and stages `resources/ginfer/docs/` for
both formats. Newer Windows Engine documentation is not substituted. Markdown
uses normal AppImage resource bundling; verified Engine runtime directories
bypass linuxdeploy rewriting. The immutable four-image runtime set is unchanged.

Independent DEB and AppImage payload/closure, ABI, companion help/version,
profile, Manager archive and six-document verification pass in
`package-verification.json`, with format receipts under `evidence/package-check/`.
The final emitted
frontend's offline browser fixture passes at 22:37 UTC: largest JS 499,377 bytes,
entry 489,712 bytes, fourteen bootstrap files / 2,153,867 bytes and bootstrap
plus home 33 files / 2,808,043 bytes. This is asset/loading evidence, not a
measured startup-speed improvement. See `frontend-final-measurements.json` and
`evidence/frontend-fixture/`.

Actual DEB and AppImage X11 clients start dark and install all four verified
runtimes. Manager is online against each format's shared Host. DEB uses Host
PID 1055553 / UUID `726abf22-f807-483f-9098-d067f84ef9f9`; the actual AppImage
wrapper PID 1061283 launches desktop PID 1061355 and Host PID 1065499 / UUID
`38674ad7-0bb9-4148-9a6b-fe048702e729`. Actual Models Scan displays Inventory
refreshed. `WM_DELETE_WINDOW` closes each Manager; reopening is online against
the same Host PID/UUID for that format. Both retain zero models, instances and
requests. Evidence is `native-acceptance.json` and `evidence/native/`.

WSL's mirrored Windows Host PID 23052 owns default ports 7443/7444; native
binding returned `EADDRINUSE` even though Linux socket listing did not expose
that owner. The isolated native fixture uses public locator `127.0.0.1:17443`.
It does not qualify default-port coexistence or LAN sharing. Linux tray and
Secret Service acceptance (OI-071) remain unrun. Server 2 is untouched; there
is no model, GPU, capacity or numerical acceptance claim.

All owned app/Manager/Host/wrapper PIDs are absent after shutdown, with zero
Linux Engines and port 17443 free. Original Windows app/Manager/Host PIDs
40160/15224/23052 remain alive unchanged, with zero Windows Engines. AppImage
left a 2,117,107,712-byte extracted temporary tree; an exact privileged live-use
scan found zero references and zero uninspectable processes before explicit
retirement. Canonical guard PID 1043205 terminated with status 143 and released
its locks; booking 287 was canceled at actual END 22:57 UTC.

The runner and standalone Manager use the canonical
`/ai/coordination/locks/local-build.lock`; the container holds build before GPU
and supplies its open build descriptor to Manager. The bounded inherited-lock
fixture passes; evidence remains `inputs.json`, `aligned-toolchain-preflight.log`
and `lock-fixture/receipt.json`. Windows Manager source is unchanged. Linux
package and native lifecycle acceptance are complete; next proceed to the
Host/Manager review in Bubbs’s 22:43 handoff and scoped owned-output retirement.
Windows installed acceptance and OI-072 remain unchanged.

## Accepted Linux installers — September 30, 2026

The complete Linux release is ready for an Ubuntu 24.04+ x86-64 desktop with a
compatible NVIDIA driver. Both packages contain GChat, its persistent host and
CLI, Bun/uv, launch profiles, and separate SM80, SM86, SM89 and SM120a GInfer
engines with private FFmpeg/CUDA/library dependencies. No separate engine or CUDA
toolkit installation is required. Model weights remain normal app downloads.

- Recommended: [GChat_2.0.42_amd64.deb](../../out/linux/GChat_2.0.42_amd64.deb)
- Portable: [GChat_2.0.42_amd64.AppImage](../../out/linux/GChat_2.0.42_amd64.AppImage)
- Both files have adjacent `.sha256` checksums; the retained release copies pass.

```sh
sudo apt install ./GChat_2.0.42_amd64.deb
```

For AppImage, make the file executable and launch it. Systems without FUSE can use
`APPIMAGE_EXTRACT_AND_RUN=1 ./GChat_2.0.42_amd64.AppImage`.

## Verification and limits

- Both exact packages passed engine integrity verification, all eight engine
  executable `--help` checks, and bundled host/CLI/Bun/uv startup checks.
- Debian installed through apt in clean Ubuntu 24.04. Its X11 desktop initialized,
  installed all four persistent runtimes, and started its persistent host. The host
  inventoried the real RTX 5090; no model was loaded on that occupied GPU.
- AppImage passed the same desktop, runtime and host checks in Ubuntu 24.04 with
  Xvfb and normal desktop Wayland/EGL/font libraries. It ran in extract-and-run
  mode because the container has no FUSE device. FUSE mounting was not tested.
- Every engine image also passes startup in plain Ubuntu 24.04 without optional
  apt packages, with only NVIDIA driver libraries mounted. Each manifest has
  167 verified payload files and exact architecture cubins; maximum GLIBC is 2.39.
- Frontend verification passed 2,029 tests and 15 extension tests, lint, typecheck
  and coverage gates. After correcting two old-path assertions, all platform Rust
  suites passed via `make test-rust`; desktop Clippy passed. Installer tests cover
  fresh install, no-op, corrupt-upgrade rejection, successful upgrade and model
  preservation. Registry and routing tests cover owner retention and exact GPU
  architecture selection.
- The packaged SM80 engine loaded the existing Muse artifact on Server 2's idle
  64-GiB CMP 170HX, driver 610.43.03. It used the shipped
  `cmp170hx-muse-groupwise-int-dflash-q4-tp1-c1-128k-int8` profile settings and a
  bounded 64-token text smoke. Native DFlash ran, the response was `READY`, and the
  process exited 0. GPU memory returned to 14 MiB. This is startup/generation
  evidence, not numerical, performance, media or all-GPU qualification.

The September 30 real-GPU check used the Muse INT TP1 package before the
October 8 filename rename. Its current Server 2 location is
`/media/ron/SSD_RAID/ai/ginfer-artifacts/qwen38-muse-tp1-tp2-tp4-2026-09-02-r1/muse_glimmer_30b_int_df2.ginfer`.
The October 8 rename receipt and a read-only check on `AIS-1-2950X-L02`
confirm that path (19,776,776,704 bytes). This filename/location update does
not constitute new engine or model qualification.
Its temporary `/home/ron/.local/state/gchat-linux-installer-check-20260930` engine
and logs were removed after evidence was retained locally. Server 2 remains
uninstalled; its independent RTX 3090 process and model files were untouched.
The Windows installation was unchanged.

## Packaging decisions and reproduction

Use [the Linux release script](../../scripts/build-linux-release.sh) inside
[the Ubuntu 24.04 / Node 22 build image](../../scripts/linux-release.Dockerfile),
with the explicit runtime set, profile catalog directory and version-matched
operator documentation directory; see
[DEVELOP.md](../../DEVELOP.md#complete-linux-release).

The extension install refreshes its generated local core-tarball reference while
root external dependencies remain locked. Engine manifests are verified before
staging. Linuxdeploy runs in extract mode, without engine or static Bun/uv files;
those files are injected afterward so their bytes and private RPATHs stay intact.
Failed Tauri runs retain `bundle/appimage_deb`, so assembly removes that owned
intermediate before each AppImage build. Each format starts from the unpatched
desktop executable, which is restored on exit. These address the observed Node
syntax, generated-tarball lock, static-ELF scan, stale-staging and bundle-metadata
failures without changing inference behavior.

See [the runtime-install ADR](../decisions/2026-09-30-bundle-linux-ginfer-runtimes-by-gpu-architecture.md).
An already-running older single-engine host must restart to acquire the new
routing map. Independently registered standalone hosts retain ownership.

## Retained inventory and status

| Owner/host | Exact path | Purpose / retention |
| --- | --- | --- |
| GChat / Ron-9950X3D2 | `/ai/gchat/out/linux/GChat_2.0.42_amd64.{deb,AppImage}` | Accepted installers and adjacent checksums |
| GChat | `/ai/gchat/out/linux/acceptance-20260930/` | Build/check logs, package acceptance and SM80 smoke evidence |
| GInfer | `/ai/ginfer/out/linux-installer-20260930/runtime-set/` | Accepted engine baseline, source `05a286ba574114e2ef4dfb00b4015e07ab8c26a5` |
| GInfer | `/ai/ginfer/out/linux-installer-20260930/` | Concise engine/FFmpeg build evidence |
| GChat | `/ai/gchat/src-tauri/target`, `/ai/gchat/src-tauri/ginfer-host/target` | Existing caches with accepted desktop/host builds retained |
| Build environments | `gchat-linux-installer-build:ubuntu24`, `ginfer-linux-release-build:ubuntu24` | Reusable accepted toolchains |

The runtime code was built from GChat `82b855870`; subsequent changes correct
packaging/reproduction and record acceptance. Implementation and final packaging
changes are merged to main for handoff. Task candidate worktrees, their private
build/dependency copies, disposable acceptance containers/images and unpacked
bundle staging are retired during final handoff. The prior host-only AppImage is
replaced and the separate glibc-2.43 runtime archive is superseded and removed.
Unrelated worktrees, model files, Windows builds and other sessions' jobs remain.
The September 30 installer work completed after its documented commit/push and
cleanup; the October refresh's current state is recorded above.

## Completed Windows update and Server 2 removal

The September 30 Windows NSIS/MSI update used GChat `bf7cde6f7` and clean engine
`74780ea1`. NSIS exited 0, the desktop and host run, and all 120 active runtime
members match the manifest. Model cache preserved: two `.ginfer` artifacts plus
two config files, 44,808,326,736 bytes total. `make verify` passed. Windows engine
compile/socket/provenance corrections were merged and pushed. See GInfer's
`docs/installer-refresh/README.md` for that accepted build's evidence.

Windows installers remain under `/ai/gchat/out/windows` and native copies under
`%LOCALAPPDATA%/GChat/release-output`. The October 1 refresh above supersedes
the September 30 Windows installer after acceptance.

Server 2's GChat app, host and desktop registration were removed recoverably into
`/home/ron/.local/state/gchat-uninstall-2026-09-30` (561 MiB). User data, models,
standalone host and independent engine builds remain. Its prior installation does
not validate the new Linux package.

## References

- [Development and platform paths](../../DEVELOP.md)
- [Host setup](../lan-host-setup.md)
- [Open work](../open-work.md)
- GInfer `docs/installer-refresh/README.md`, `tools/stage_linux_runtime.py`
