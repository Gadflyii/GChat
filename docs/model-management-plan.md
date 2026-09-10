# Host-aware model management

Status: host-aware management foundation implemented and verified. On 2026-09-09
the user expanded this same goal to build the missing profile system and interactive
launcher, with shared multi-instance lifecycle and complete GChat remote controls.
The missing preset interface is now implementation work, not an external prerequisite.

Current handoff: the user explicitly authorized committing, merging into `main`,
and pushing both repositories now, after the other session's integration, with
remaining qualification gaps documented. Cleanup is explicitly deferred: retain
all worktrees, branches, builds and temporary files. GInfer's other-session
commits through `7fddd09` are already on local and remote main; this implementation
is integrated on top without changing their benchmark results.

C8 graph choices: the user explicitly approved offering both graph-enabled and
no-graph profiles when each can be physically qualified. Investigate a smaller
context for the graph-enabled option before concluding it cannot fit; startup
graph reservation and runtime KV capacity are distinct constraints. Label the
execution mode clearly. The user has prohibited performance measurement on this
outdated engine build. Limit remaining GPU checks to resource fit, full-context
execution, correctness/accounting and headroom; do not run timing comparisons or
performance repetitions. Existing timing fields are not release performance
evidence. Revalidate resource profiles against the updated engine before claiming
they qualify that revision.
Graph-enabled Qwen C8 failed startup reservation on RTX4090 at 8192, 4096,
2048 and 512 context. Even the 512-context probe requested 6,785,633,536 bytes
against 5,891,972,608 available. No graph-enabled C8 profile is qualified on this
revision. Keep the qualified no-graph C8 option and graph-enabled C1/C2/C4
choices; revisit C8 with the updated engine instead of further shrinking context
or changing the obsolete planner.

## Outcome

Models is a lightweight control surface for this computer and paired GInfer hosts.
Select a destination, see installed models or compatible published recommendations,
and manage transfers on that destination. Do not copy LAN downloads through GChat.

Typing `ginfer` without arguments opens a simple text menu showing detected hardware
and compatible installed-model profiles. Selecting a profile starts serving without
requiring the user to calculate context, concurrency, or KV memory. The launcher and
GChat operate the same host-managed instances; advanced explicit CLI usage remains.

## Ownership

- GInfer owns executable artifact compatibility, topology validation, and runtime
  presets. Saved host launch configurations are not hardware-qualified presets.
- Release metadata owns exact package identity, SM qualification, per-rank memory
  requirements, TP degree, immutable source URL, bytes, and SHA256. Unpublished or
  incomplete entries must not become download actions.
- ginfer-host owns durable transfers and managed storage. Existing inventory roots
  remain read-only. Authenticated management does not expose arbitrary shell commands.
  It also owns instance persistence, GPU reservations, port assignment and process
  lifecycle, independently of any running ginfer-serve or connected GChat window.
- The launcher is a client of that host lifecycle, not a second process supervisor.
  GInfer's profile contract is shared by launcher, host and GChat; the desktop does
  not duplicate memory tables. Profile production and qualification belong to the
  producer/engine workflow, not runtime weight conversion or repacking.
- GChat owns host selection, recommendations, progress, explanations, and explicit
  lifecycle actions. Unknown capabilities are not guessed from GPU names.

## Implementation sequence

1. Add exact hardware/release compatibility contracts and tests; expose actual SM.
2. Add persistent bounded host transfers with resume, cancellation, checksum and
   artifact inspection before atomic publication. Preserve incomplete jobs on restart.
3. Expose host model management through the authenticated desktop bridge.
4. Build host-scoped Installed / Recommended / Downloads views, reusing lifecycle
   controls, with unavailable/offline reasons and advanced settings disclosure.
5. Connect local storage and download management without changing model ownership.
6. Define and implement the shared prebuilt profile contract and machine-readable
   profile listing/resolution. Update affected GInfer authorities and packaging as
   part of this explicitly approved cross-repository product change.
7. Build and qualify profiles by artifact, SM, per-GPU VRAM tier and TP degree;
   never mark an unmeasured configuration qualified. See the profile rules below.
8. Implement host-owned GPU/port reservations and lifecycle reconciliation, then
   connect the no-argument `ginfer` menu to that same authority. Package the host
   service with the launcher; preserve explicit inference commands and --help.
9. Extend GChat's existing host panel with profile selection and complete instance
   controls. Use the same service for local and remote managed instances and
   destination-owned downloads; remove competing project-owned supervision paths.
10. Verify the profile/launcher/host/GChat path end to end, including multiple
    instances, disruptive changes, restart recovery and supported platform packaging.

## Prebuilt profile rules

- Cover 16, 24, 32 and 64+ GB per-GPU tiers where a registered, available artifact
  has a qualified fit. Offer multiple concurrency/context choices, bounded by the
  engine's C1..8 contract, and TP1/TP2/TP4 where topology and exact packages allow.
- A profile identifies the exact artifact/storage and draft configuration, SM and
  GPU-group requirements, context limit, concurrency, KV policy and required runtime
  options. No summed VRAM, inferred TP package or runtime weight splitting.
- Keep profiles in standalone, human-editable JSON catalogs, not compiled tables.
  Document their location and refresh workflow; adding or revising a catalog must
  not require rebuilding GInfer or GChat. Changes need corresponding qualification.
- Record the qualified platform explicitly. Linux/WSL measurements do not qualify
  Windows; the host excludes other-platform profiles from GPU choices and launch.
- Qualified allocation leaves 1 GiB free per GPU after weights, workspaces, CUDA
  Graphs and KV allocation. Actual usable memory and TP rank requirements govern fit.
- Context is the profile's supported limit, not necessarily the model's native max.
  A profile that supports 128K loads at 128K normally, with no warning merely because
  the model supports more. Show resolved settings; do not silently replace the
  user's selected profile under unexpected memory pressure.
- Blank/auto options use the selected prebuilt configuration; explicit advanced
  overrides are validated and shown as custom settings, not qualified profile values.
- Multiple instances use exclusive GPU groups by default: four TP1, two TP2,
  one TP4, or TP2 plus two TP1 can coexist on four suitable GPUs. Sharing one GPU
  between serving processes is not part of the simple profile path.

## Launcher and remote-control acceptance

- No-argument interactive launch shows hardware, compatible installed-model profiles
  and GPU availability, accepts a simple selection, then shows server address/status
  and stop instructions. Noninteractive CLI use must not hang on a menu prompt.
- Reserve a GPU group atomically before startup and allocate a nonconflicting port.
  Concurrent CLI/GChat starts cannot claim the same group; failed startup and process
  exit release ownership. Reconcile real process state after host restart rather
  than trusting stale reservations or terminating unrelated GPU users.
- Every launcher-started instance appears through the paired host in GChat, with
  model, profile, GPUs, TP, context, concurrency, port, lifecycle state and metrics.
- GChat can download to the destination host; create/start, stop and restart an
  instance; load/change/reload its model; and switch profiles (including C1 to C4).
  Restart ginfer-serve when startup-fixed settings change. Other instances continue.
- Confirm interruption of active requests before disruptive changes. Report loading,
  stopping, restarting and failure states accurately; do not publish the new model
  or profile as running before readiness succeeds.
- ginfer-host remains discoverable and controllable when all serving processes are
  stopped. Closing GChat or leaving the launcher does not kill managed serving or
  host-owned downloads. Service restart reconciles saved instances and transfers.
- Focused behavioral tests cover resolution, reservation races, unavailable groups,
  failed starts, model/profile restart and recovery. Real-device evidence must support
  each released profile's context/concurrency/headroom claim. A real CLI-to-GChat
  lifecycle check must demonstrate discovery, metrics and remote controls; mocked
  tests alone do not establish that integration or physical TP qualification.

## Acceptance

No invented release URLs or Smol artifacts, no aggregate-VRAM fit assumptions, no
automatic interruption of inference, no deletion of external model roots, no new
runtime dependency, and no commit/push unless requested. Existing uncommitted polish
work is preserved. Transfers survive closing the desktop; remote work requires no
desktop proxy. Public inference protocol behavior is unchanged.

## Delivered and verified

- Host-scoped Installed / Recommended / Downloads, shared host lifecycle controls,
  explicit unavailable/offline states, and a cross-host transfer count in navigation.
- Hardware matching from actual SM and per-GPU memory, with no VRAM summation or
  invented published packages. Exact release metadata gates every managed transfer.
- Durable destination-owned transfers, bounded streaming, HTTP Range resume,
  checksum/identity/TP checks, pause/retry, and explicit incomplete-file cleanup.
- Atomic local manifest/weights publication; existing first-model/default import
  policy is preserved without replaying old completed jobs on startup.
- Safe installed-package removal; loaded models are not automatically interrupted.
  External host inventory roots remain read-only. Fresh hosts can start without
  preinstalled models. First-run setup and reminders use the shared model manager.
- Shared polling and unchanged-state suppression. Superseded Hub filters, their
  tests/coverage target, and the old split onboarding picker were retired.

Validation: final `CARGO_INCREMENTAL=0 make verify` passed; GInfer extension build
passed; three Linux installer/preview checks passed; `git diff --check` passed.
Transfer tests cover resume, integrity rejection, restart, managed deletion,
atomic local publication/recovery, and default-import notification/deduplication.
The new NVIDIA query was checked on the local RTX 5090: SM 12.0, 32,607 MiB.

## Current integration evidence

The profiles below are text-only resource-fit checks on engine
`c8e0d4fd9e36c55789fda739a87d08ecf3de084b`, not performance claims and not
qualification for a newer engine. All use TP1/DTP1, DFlash with four draft tokens,
INT8 KV, and at least 1 GiB sampled free memory per GPU. Context is per request.

| Platform / GPU | Artifact | Recorded choices |
| --- | --- | --- |
| Linux/WSL RTX5090 | Qwen NVFP4 + DFlash2 Q4 | C1/128K, C2/64K, C4/32K, C8/16K, graphs |
| Linux/WSL RTX5090 | Muse NVFP4 with DFlash | C1/C2/C4/C8 at 128K, graphs |
| Windows RTX5090 | Qwen NVFP4 + DFlash2 Q4 | C1/128K, C2/64K, C4/32K, C8/16K, graphs |
| Linux/WSL RTX4090 | Qwen groupwise INT + DFlash2 Q4 | C1/64K, C2/32K, C4/16K graphs; C8/8K no graphs |
| Linux/WSL RTX4090 | Muse groupwise INT + DFlash Q4 | C1/C2/C4 at 128K, graphs |
| Linux RTX3090 | Qwen groupwise INT + DFlash2 Q4 | C1/64K, C2/32K, C4/16K graphs; C8/8K no graphs |
| Linux RTX3090 | Muse groupwise INT + DFlash Q4 | C1/128K, graphs |

Exact artifact, pool, platform, revision, headroom and evidence paths are recorded
in GInfer's editable `config/launch-profiles/` catalogs. Selected reports,
resource observations, logs and telemetry are archived and byte-verified under
`/mnt/nas/AltaStratusAI/GInfer/qualification/launch-profile-qualification-20260909/profiles/`.
No build trees or binaries were archived.

The RTX3090 Muse C1 check used one full-context wave, no warmup or repetitions:
131,009 computed prompt tokens, 64 returned tokens, 63 committed decode tokens,
13 graph decode rounds and 2,375,024,640 bytes minimum sampled free memory.
Earlier passing cells used two full-context waves with matching per-lane output
digests. Windows Qwen digests matched the corresponding Linux results.

Failed configurations are not catalog entries. Qwen C8 graph startup failures
are described above. RTX5090 Qwen at 262K failed either headroom or an admission
invariant; the latter was reported to the engine owner. Oversized pools that
failed headroom were replaced with independently checked smaller pools.

### Shared launcher and owner

- One private per-user `local-host.json` locator is implemented. Concurrent first
  registration, preservation of malformed records and adoption of an existing
  owner passed on Linux and native Windows. Explicit state-directory commands
  remain isolated. Existing engine and model/cache roots are preserved.
- The no-argument GInfer menu delegates to ginfer-host. Real Linux PTY tests
  checked cold bootstrap, hardware/menu display, noninteractive rejection,
  second-install adoption and host persistence after quitting.
- A real Linux RTX5090 profile test launched C1/128K through the menu, completed
  host-routed chat, verified persistence after quit, restarted to a new session,
  and stopped serving without stopping the host. A release-host test switched
  the same instance from C1/128K to C4/32K and checked resolved settings and
  forwarded Engine metrics. This tests the API used by GChat, not WebView clicks.
- Host state locking and the engine owner pipe prevent competing owners and
  orphan serving processes. Focused tests cover lock release, child lifetime,
  duplicate starts, restart, saved settings, authenticated forwarding and SSE.
- GChat model load/unload, CLI forwarding and downloads use the shared owner.
  Superseded direct-child/PID supervision was removed. Transfer tests cover
  resume, exact publication, inventory visibility, preservation and removal.
- Windows bootstrap and PowerShell pipeline tests verified client exit while
  the detached host stayed alive. Native Windows host tests and desktop
  compilation passed. No live Windows installer or WebView walkthrough was run.
- A temporary real host on WSL4090 passed LAN access from this workstation:
  certificate-pinned TLS pairing, unauthenticated snapshot rejection, one-use
  code replay rejection, authenticated snapshot/scan and actual RTX4090 inventory.
  No credentials appeared in its public snapshot, and no instance or model was
  started. An opt-in real-LAN test then exercised GChat's native `Discovery`
  implementation and resolved the remote host ID and expected LAN HTTPS origin
  through mDNS. Both owned temporary host runs were stopped afterward. This is
  real LAN discovery and transport/control evidence, not WebView interaction or
  remote inference lifecycle qualification. Re-run the discovery check with
  explicit `GINFER_LAN_HOST_ID` and `GINFER_LAN_HOST_URL` using
  `cargo test --manifest-path src-tauri/ginfer-host/Cargo.toml --test discovery_live -- --ignored`.

### Packaging and verification

- Standalone Windows and Linux setup offer editable approved per-user paths,
  preserve an existing owner, verify runtime integrity and refuse overwrites.
  Fixture tests cover installation, preview and second-install adoption without
  changing live user configuration, PATH or models.
- Linux staging copies explicit CLI/server builds, private FFmpeg/CUDA libraries
  and licenses, fixes relative library paths on copies and checks resolution.
  The relocated runtime and temporary installed CLI/server/host help routes
  passed. The helper is now integrated into primary GInfer at
  `tools/stage_linux_runtime.py`; focused package/setup tests passed.
  The integrated primary-source build was subsequently staged and packaged with
  the release host and eight matching RTX5090 profiles. The combined archive at
  `/tmp/ginfer-linux-packaging.N0Qs8EIu/distribution-integrated/ginfer-bundle-0.1.0-linux-x86_64.tar.gz`
  passed extraction and installation into dedicated temporary directories; all
  three installed executable help routes and the installed catalog were checked.
  Other-SM profiles were not bundled with this SM120a-only runtime. Live user
  installation, PATH, model roots and host registration were unchanged.
- The isolated Windows integration tree includes the native port on engine c8,
  including exact MSVC service-cost arithmetic. Native builds, arithmetic and
  owner-pipe tests passed. The port is now integrated into the primary GInfer
  working tree, preserving its newer launcher documentation and existing edits.
  Integrated implementation files match the native-tested isolated source.
  Linux scheduler arithmetic, termination, owner-pipe and artifact-reader checks
  (including concurrent positional and short-tail reads) passed directly from
  the primary source. The integrated primary source then passed a native
  SM120a/CUDA13.3 Release build of CLI/server and six focused CTest checks:
  artifact reader, scheduler arithmetic, termination, request logs, owner pipe
  and serving options. Both executable help routes passed without inference.
  Git commit/merge and final release checks remain pending.
  Preservation audit of `/ai/ginfer-windows`: the branch has no commits absent
  from main. Its 32 modified tracked files and 13 new files are represented in
  the integrated tree. Differences were reviewed: Linux retains main's private
  FFmpeg contract, Windows uses the same `ginfer_ffmpeg` target; shared exact
  service-cost arithmetic supersedes the older inline MSVC implementation;
  active launcher/serving documentation is more complete; token-count test
  differences are formatting only. No unique implementation was left behind.
  Keep the old checkout until the integrated source is committed and pushed;
  then its stale port/build copy is eligible for the requested cleanup.
- GChat 2.0.27 NSIS and MSI rebuilt with that explicit SM120a runtime and four
  Windows Qwen profiles. Runtime integrity and MSI profile inclusion were
  checked. No installer was executed in the live environment.
- Catalog delivery is implemented for standalone/OS-service installers and
  GChat desktop resources. Explicit same-platform catalogs combine beside the
  host; a state-directory override wins, including an intentional empty catalog.
  Invalid overrides remain visible errors. Downloaded release profiles contribute
  only after exact artifact publication and disappear on managed removal.
- Full GChat `make verify` passed with 19 Linux entries, including both
  no-graph Qwen C8 profiles. The subsequent RTX3090 Muse entry passed JSON
  validation; `cargo check` then passed with all 20 entries explicitly selected,
  and the staged resource includes that entry. Full `make verify` subsequently
  passed with all 20 entries after adding the opt-in real-LAN discovery test;
  that opt-in test also passed separately against WSL4090. Package/setup
  tests and `git diff --check` also passed after Linux staging integration.
  Clippy was installed with user approval and passed with existing style warnings.

## Remaining completion gates

1. Finish verification and commit integration of the Windows port and Linux
   launcher/packaging changes now in the primary working tree, preserving
   other-session changes.
   Reconcile against the engine revision selected for release; old fit results
   must not be relabeled as new-engine qualification.
2. Complete supported resource-profile coverage where exact artifacts and authorized
   hardware exist: remaining Muse concurrency choices, native Windows Muse,
   64+ GiB and homogeneous TP2/TP4. No 16 GiB Smol package or homogeneous TP4
   inventory is available in this task. Server1 is excluded from execution;
   Server2's heterogeneous GPUs are independent TP1 devices, never a TP2 group.
   The SM80 lane's thermal/input-length constraints must be resolved before use.
3. Complete the real multi-host launcher-to-GChat control walkthrough and native
   Windows installer/menu/WebView walkthrough. Mocked tests and single-host
   API evidence do not establish those results. Coordinate host ownership before
   deployment; do not disturb other sessions or their inference processes.
4. Assemble final selected-platform bundles with all accepted catalogs and the
   selected engine runtime. Check the packaged contents and rerun affected
   integration checks. Existing archives have different catalog selections;
   do not treat every old archive as the final distribution.
5. Commit and push the integrated implementation on both main branches under the
   user's current authorization; these remaining qualification checks do not block
   that source handoff. Do not perform cleanup. A later, separately authorized
   hygiene pass must coordinate ownership and preserve source, selected evidence,
   models, active jobs and other-session work.

Public release feeds and exact published model URLs remain producer-owned release
inputs. No URLs, Smol packages, hardware measurements or qualification were invented.
The goal remains active; packaging success alone does not complete it.
