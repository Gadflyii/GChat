# Models on this computer and LAN hosts

Open **Models**, select **This computer** or a paired host, then choose
**Installed**, **Recommended**, or **Downloads**. The same host lifecycle controls
are available in Engines. Offline inventories are last-known information; their
mutation controls are disabled. Downloading does not interrupt inference.

Recommendations require actual NVIDIA compute capability, enough memory on every
participating GPU, and a release-declared homogeneous TP1/TP2/TP4 group. GPU names
do not imply compute capability; memory is never summed to estimate a single-GPU
fit. TP peer connectivity and package binding remain final engine startup checks.
There is no downloadable Smol entry until that package is published and qualified.

## Release feed

Models are published under [SectileLabs on Hugging Face](https://huggingface.co/SectileLabs).
Code and application releases belong under [SectileLabs on GitHub](https://github.com/SectileLabs).
Bundled model repository names are unpublished catalog placeholders, not evidence
that a package is available. Downloads require the exact published release metadata below.

The existing `VITE_MODEL_CATALOG_URL` build setting may identify a GInfer release
catalog using the existing catalog envelope. Without it, bundled model families
appear only as unavailable unless their release metadata is complete. The Models
page does not query the old upstream multi-backend catalog. Publication is a
producer task; this implementation does not invent a public registry URL.

Each `models[]` entry has `library_name: "ginfer"` and optional `releases[]`:

| Field | Contract |
| --- | --- |
| `name` | Human-readable package name |
| `identity` | Exact `model_id` and `weights_id` from the artifact |
| `url` | Public HTTPS Hugging Face `.ginfer` URL pinned to a 40-character commit |
| `sha256`, `bytes` | Exact complete-file checksum and size |
| `tp` | Exact package degree, 1, 2, or 4 |
| `qualified_sm` | Actual compute capabilities, e.g. `8.6` or `12.0`; not guessed compile-image names |
| `min_vram_mib_per_gpu` | Qualified minimum memory on each participating GPU |
| `capabilities` | Published capabilities, e.g. tools, reasoning, vision |

`min_vram_mib_per_gpu` is a measured usable-memory requirement, not the marketing
capacity converted to MiB. For example, the local 32 GB RTX 5090 reports 32,607
MiB through NVIDIA inventory. A qualified 32 GB-class release must account for
that reservation; the client must not round available memory up to claim a fit.

This describes producer-final singleton containers, including exact TP payloads.
It does not split or repack weights and does not infer artifact-set siblings.
Manually configured deployment descriptors retain their existing inventory route.

## Storage and transfer lifecycle

LAN downloads run in ginfer-host and continue when GChat closes. One active
transfer per destination bounds buffers and disk contention. Pause retains partial
bytes; resume uses an exact HTTP Range response or restarts if the server ignores
Range. A stalled request fails visibly. Verification streams the complete checksum
and inspects artifact identity/degree before publication. Service restart pauses
unfinished transfers for explicit resume.

The host writes only its dedicated `<host-state>/managed-models` directory.
Configured external inventory roots remain read-only. Local downloads install the
normal model manifest and weights together under `<data>/ginfer/models/<sha256>`.
Local application exit interrupts local work; it can resume on the next launch.
Completed local downloads enter the existing model-import/default-selection flow;
past completed jobs are not re-emitted as fresh imports on startup. The Models
sidebar badge counts active or incomplete transfers across the local machine and
paired hosts. Snapshot and local-transfer polling are shared, not repeated by
every management view.

Removal is explicit: pause before removing incomplete files, and stop instances
before deleting an installed model. Host removal rejects files outside managed
storage. Removing a managed package also removes its stopped host launch profiles.
No automatic model eviction, pruning of external roots, or engine update occurs.

## Host management protocol

All mutation endpoints require the existing pinned, paired host credential:

- `POST /host/v1/downloads`: exact release object; returns a durable download job.
- `GET /host/v1/downloads`: list persistent jobs without fetching model inventory.
- `POST /host/v1/download-actions`: `{id, action}`; pause, resume, or discard.
- `POST /host/v1/remove-model`: `{model_id}`; remove an unused managed package.
- Existing snapshots expose `model_management.version = 1`, managed root and jobs.
- `POST /host/v1/instances/{id}/start`: start saved settings; reject an already-live instance.
- `POST /host/v1/instances/{id}/restart`: restart with saved settings after draining requests.
- `POST /host/v1/instances/{id}/reload`: validate replacement `configuration` before stopping
  the existing process, then launch it. Omitting configuration reuses saved settings.
- Start/restart do not accept replacement configuration. Stop/restart/reload affect
  only the selected instance; `force: true` explicitly cancels tracked requests.
- GPU snapshots include optional `compute_capability`; unknown SM does not match.

The desktop uses the existing `engine_hosts_command` bridge. Local
`local_model_download*` operations bootstrap and call the host; the desktop does
not create a transfer manager. These are management
operations, not additions to the OpenAI inference API.

## Runtime presets

GInfer qualification owns context, concurrency and KV settings. GChat contains no
VRAM-to-settings table. ginfer-host reads producer-supplied `launch-profiles.json`
from its service state directory during inventory scan. Missing catalogs produce
no recommendations; invalid catalogs are rejected and shown as `profile_error`.
No production profiles ship until the physical measurements exist.

### Editing and adding profiles

Profiles are ordinary UTF-8 JSON, not Rust/C++ tables or compiled resources. The
editable local catalog is `<host-data-dir>/launch-profiles.json`, beside
`host.json`. For a service installation, `<host-data-dir>` is the directory passed
to `ginfer-host --data-dir`; for a desktop-owned host it is the provider's `host/`
directory. The installed `ginfer-launch.json` also records this exact `data_dir`.
Version-controlled source catalogs live in GInfer's `config/launch-profiles/`,
grouped by platform, GPU and artifact. Keep measurement logs on the NAS, separate
from those small JSON files. Install only a catalog qualified for the destination.

Add entries to the catalog's `profiles` array. Give each distinct configuration a
unique descriptive `id` and a user-facing `name`; keep the artifact digest, GPU
requirements and launch settings explicit. Save the JSON, then Refresh the host
inventory in GChat or the text launcher. No application rebuild or host restart is
needed. Refresh does not restart a running model; select the revised profile and
confirm the configuration change to apply it.

Do not edit the download journal to change a shipped profile. A local variant
needs its own ID: conflicting definitions of the same ID are rejected. Changed
context, concurrency, KV, draft or other runtime settings need matching physical
qualification evidence before publication as a qualified profile. Do not copy the
old qualification claim onto unmeasured settings. Use advanced custom launch
settings while qualifying the new entry.

Release metadata can carry `launch_profiles`, using the same profile contract.
Each must match the release's exact identity, SHA256, byte count, TP and qualified
SM; artifact inspection also checks draft TP before publication. Profiles remain
unavailable while a transfer is incomplete. Once verified and installed, the host
merges them into its profile inventory from the durable download journal. Removing
the managed package removes those profile contributions. Duplicate IDs with
different contents are reported as catalog errors, not silently overwritten.
An unprofiled release remains available for advanced explicit configuration; it
does not acquire an invented automatic preset.

The catalog envelope is `{ "schema": "ginfer-launch-profiles-v1", "profiles": [...] }`.
Each profile requires:

| Fields | Meaning |
| --- | --- |
| `id`, `name` | Stable catalog key and menu label; IDs must be unique |
| `platform` | Physically qualified operating system: `linux` (including WSL) or `windows`; other-platform entries cannot launch |
| `identity`, `artifact_sha256`, `artifact_bytes` | Exact artifact identity and qualified payload |
| `tp`, `draft_tp` | Producer-final target and draft degrees |
| `gpu_name`, `compute_capability` | Exact physically qualified GPU SKU and SM |
| `vram_tier_gib`, `min_memory_mib_per_gpu` | Display tier and measured usable-memory requirement per rank |
| `max_context`, `concurrency` | Qualified per-request context and full-context request count |
| `options` | Host launch options, including `kv_arena_headroom_bytes` (default 1 GiB) |
| `qualification` | `evidence`, `engine_revision`, minimum `free_bytes_per_gpu`, and `full_context_requests` |

Qualification must record at least 1 GiB free on every GPU at the full-context
concurrency point. The recorded request count must equal the profile concurrency;
the engine headroom setting must also reserve at least 1 GiB. A smaller context
than the model maximum is ordinary profile behavior, not a warning. These metadata
checks do not create qualification: producers must retain the actual physical evidence.

Snapshots expose `launch_profiles` with matching installed `model_id`, free
`gpu_groups`, and hardware-compatible `compatible_gpu_groups` for changing an
existing instance. Host reservations are enforced again at launch. Physical P2P
and current free-memory validation remain engine startup responsibilities.

`POST /host/v1/profile-launch` accepts `profile_id`, `model_id`, `gpu_uuids`, optional
`instance_id`, and `force` (false by default). It resolves settings on the host and
verifies the exact artifact checksum on a blocking worker before stopping an existing
instance. Declared TP-set members resolve explicitly; no sibling package is guessed.
Invalid profile/payload/GPU selections leave the existing process running. A later
engine startup failure is reported normally; it is not represented as a successful switch.

GChat's Launch profiles panel uses this endpoint for new instances and confirmed
model/profile changes. Saved configurations retain `qualified_profile_id`; subsequent
restarts validate that their settings still match the catalog. Editing settings without
that ID uses the explicit custom route, not a qualification claim. Profile publication
and unified local supervisor work remain in the current
[implementation plan](model-management-plan.md).

## Text launcher

### Native local-client bridge

Local administrator clients can register a selected absolute `.ginfer` path through
`POST /host/v1/local-artifacts`. The host validates and persists an exact read-only
inventory reference, returning its stable model ID. It does not copy, convert or
delete the artifact. Paired LAN credentials cannot add arbitrary local paths.

`POST /host/v1/local-engine` lets a local administrator select an existing absolute
serving executable after installation. Changing its path requires all instances
to be stopped; selecting the already configured path leaves running instances
untouched. This selection applies to the current host process. Downloads and
inventory remain available before the engine is installed.

For a ready instance, `POST /host/v1/instances/{id}/local-connection` returns a
loopback port, session ID and inference-only API key. This local-administrator-only
operation never exposes the administrator key. The endpoint forwards the existing
host-supported inference routes through its request tracking and session checks;
it is not a direct engine connection or a management endpoint. Stopped or replaced
sessions fail closed. A replacement session receives a new connection and key.
Snapshots contain neither local connection keys nor administrator credentials.

Lifecycle requests can carry `expected_session_id`. The host checks it under the
lifecycle lock before stop, restart, reload or profile replacement; a changed
session returns HTTP 409 without touching the replacement. GChat and the menu
send the displayed session identity for disruptive actions. An open settings form
retains the session it was opened against instead of following later restarts.

The desktop plugin uses these native APIs for model load and unload. It bootstraps
the local host using `<data>/ginfer/host` as private
host state, registers the selected artifact read-only, and stores host/session
references instead of owning an inference child. Closing the desktop releases its
references without stopping host serving. Reopening can attach to one matching
resident instance; ambiguous matches or changed settings require explicit control.
The headless GChat CLI uses the same host owner. Its selected `--port` and
`--api-key` configure a CLI-owned forwarding endpoint, not a second engine process.
Explicit Ctrl+C/SIGTERM stop requests drain the captured host session. An agent's
normal exit closes its CLI endpoint without stopping managed serving. Session handles
are not OS PIDs; the adapters never signal an engine by PID.

Windows and Linux desktop builds include `resources/bin/ginfer-host[.exe]` as a
GChat-owned executable. It is built from this repository, not inserted into or
validated as part of the separately supplied engine runtime archive. Bundling the
executable is started on demand by desktop model loading. It is not yet installed
as an automatic OS service by the desktop installer.

`ginfer-host --ensure-running --data-dir /absolute/state --engine
/absolute/ginfer-serve --listen 127.0.0.1:7443` provides native bootstrap. It returns
the pinned owner's snapshot, starting a detached host only when no owner is found.
Concurrent clients converge on the same state-directory owner. Startup diagnostics
are written to private `host.log`; a readiness timeout leaves a live owner intact.
Startup arguments configure a newly started host, not an already running one.
This operation does not install an OS service or enable boot-time startup.

The host publishes its actual management origin in private `host.json` after
binding. GChat automatically registers that owner during host-list refresh, using
the private local credential in native memory rather than provisioning a keyring
entry or requesting a pairing code. Public host listings and `hosts.json` contain
connection metadata only, never that credential. The Engines panel labels the
automatic entry “Local host” and does not offer Forget; instance controls remain
available. Remote pairing and its OS-vault requirements are unchanged.

Host identity and lifecycle state live below `<data>/ginfer/host`. With
`--desktop-provider <data>/ginfer`, that owner takes over the existing
`model-downloads.json` journal and `models` cache in the provider directory,
preserving job IDs, partial bytes and model manifests. Interrupted jobs return as
paused and can be resumed. Desktop-provider mode requires that provider's dedicated
`host` state directory, so the service owner lock also protects its transfer owner.
The host can inventory and download before the configured serving executable is
installed; model launch validates the executable before changing a live instance.

### Menu usage

The GInfer CLI opens the host menu when invoked with no arguments. The installed
`ginfer-host` must be beside `ginfer` or on PATH. Host installers create
`ginfer-launch.json` beside ginfer-host with the absolute `data_dir` and HTTPS
`host_url`; it contains no credentials. Advanced invocation is
`ginfer-host --menu --data-dir /absolute/host/state --host-url https://127.0.0.1:7443`.
The menu rejects redirected stdin rather than hanging unattended commands.

Desktop CLI installation adds `desktop: { provider, engine }` to that
configuration, using absolute paths. The menu reconnects or starts the provider's
independent local host before displaying hardware and profiles, even if the engine
has not been installed yet. It does not start inference automatically. Omitting
`desktop` selects an already installed service; the menu does not replace service
management. Explicit `--data-dir` menu commands likewise connect without bootstrap.
Windows desktop CLI files live in `%LOCALAPPDATA%\GChat\bin`, independently of
the desktop installation directory, so launcher configuration does not require
administrator access. This directory is added to the user's PATH. Updating an
in-use Windows CLI/host executable fails explicitly; it never terminates that host.

The Linux installer previews by default. `--install` installs, enables and starts
the per-user service; `--install --no-start` stages it without starting. Starting
the service does not load a model. Inventory initialization can take a moment
before the menu can connect.

The launcher reads the local administrator credential and pins the host certificate
from private host state. That credential authorizes local administration; it is never
issued to paired GChat clients or included in snapshots. On the current Windows
system-service installation, the menu requires an elevated terminal to access that
state. Ordinary desktop users continue to use paired credentials. Packaging a
touchless ordinary-user entry point remains part of the shared local-host work.

The service holds an exclusive OS file lock on its state directory for its lifetime.
A second service process using that directory is rejected before opening or mutating
the host registry. The OS releases ownership when the process exits; the lock file
is retained and never treated as proof that a process is alive. This protects one
installed host's state, not separate administrator-created state directories or
unmanaged engine processes; shared local supervision remains required.

Hosted ginfer-serve receives `--exit-on-stdin-close` and an open owner pipe. If the
host dies, closure of that pipe terminates the child even if Rust cleanup cannot run.
After service restart, saved configurations are presented as stopped and can be
started again; no stale PID is adopted or killed. Normal requested stop/restart
still drains tracked requests first. This requires the matching updated engine;
older engines that lack the option are not silently launched without ownership.

Menu choices list hardware and the host's qualified profiles, not locally estimated
settings. Start submits a profile selection, Manage provides start/stop/restart/profile
switch, Refresh rescans models and profiles, and Pair GChat creates a short-lived
pairing code. Quitting the menu leaves host-owned processes and downloads running.
The menu shows starting state until a refreshed snapshot reports ready or failed.
