# GInfer Server Manager

Standalone Tauri application in `src-tauri/ginfer-manager`, using the existing
`ginfer-host` crate. Linux X11 first, then native Windows tray. Embedded static
assets require no Node at runtime. GChat, the manager and the no-argument GInfer
menu connect to the sole registered local host; closing the manager never stops
that host or its inference instances. Current acceptance and owned resources are
in [manager status](ginfer-manager/README.md).

## Window and tray

The window lists this computer and paired hosts, with a small nearby-host area
offering **Pair** and **Ignore**. Selecting a host shows compact instance cards:
state, installed model/package, GPU group, API address and active requests.
Start, Stop and Reload use the host's existing guarded lifecycle operations.
Installed models, downloadable releases, storage, paired clients and work pools
are separate collapsible sections. Offline hosts show **GInfer offline** and
last-known inventory; actions that require connectivity are disabled.

This computer has **Share this host** and an editable hostname. Its paired-client
list shows names, active requests and last seen, with **Revoke**. Saved profile
selection and explicit model/GPU settings use the host's exact inventory and
validation. The displayed Engine port is allocated by the host, not a new user
setting. Reload confirms interruption only when active requests require force.

Tray menu: **Open Server Manager**, **Refresh**, **Share this host**, and **Exit
Manager**. Windows close hides to the tray. Linux supports the tray where the
desktop provides it, with a visible window fallback. No model starts at app launch.
Use GChat's default dark theme and its existing color tokens regardless of the
desktop's light/dark preference.

## Shared controls and ownership

Extract the portable paired-host client from GChat's `core/engine_hosts.rs` into
`ginfer_host::client`. Both applications use its registry, enrollment, discovery,
pinned transport and snapshot reconciliation. Tauri adapters supply OS-vault
operations; headless host builds do not acquire a desktop/keyring dependency.
Persist shared same-user connection metadata atomically under the existing
GInfer configuration root, with an OS file lock and reload across processes.
Import existing GChat registrations once, retaining the same vault service and
grant IDs. Tokens never enter UI state or fleet documents.
Local administrator transport remains independent of the desktop vault. Add
local-admin `POST /host/v1/local-client` to issue a stable local client UUID in
the host's private state; both applications adopt that same placement identity.
The host ID is not a client grant. Local-only use must work without Secret
Service, while paired credentials still require the native OS vault. Local
administrator requests retain their privileged controls and truthful usage label.

| Control | Existing owner or endpoint |
| --- | --- |
| Local host | `local_host_registry::registered()` / `Owner::connect()` |
| Nearby hosts | `discovery::Discovery::start()` / `hosts()` |
| Pair | `transport::pairing_origin()`, pinned `POST /host/v1/pair` |
| Status, models, GPUs, profiles | `GET /host/v1/snapshot`, `POST /host/v1/scan` |
| Profile/custom launch | `POST /host/v1/profile-launch`, `POST /host/v1/instances` |
| Start/stop/reload | `POST /host/v1/instances/{id}/{operation}` with session guard |
| Catalog/download progress | `GET /host/v1/model-catalog`, `GET /host/v1/downloads` |
| Download/pause/resume | `POST /host/v1/downloads`, `POST /host/v1/download-actions` |
| Model storage/removal | `/host/v1/model-storage`, `POST /host/v1/remove-model` |
| Local artifact | Local-admin `POST /host/v1/local-artifacts` |
| Sharing/name | Local-admin `/host/v1/lan-sharing`, `/host/v1/name` |
| Revoke | Existing `DELETE /host/v1/clients/{id}` |
| Clients/usage | Add redacted `GET /host/v1/clients` and snapshot projection |

The host remains the lifecycle authority. Reload validates before replacement;
normal Stop drains requests using the existing policy. Sharing off keeps models
and grants. Preserve existing paired-management permissions and local-admin-only
sharing/name/local-connection controls. New usage leases identify the actual
authenticated client, distinguish local administrator traffic, and release on
completion/cancellation. HTTP activity is shown as active requests and last seen,
not an invented persistent client connection.

## Fleet assignments

One explicitly selected **fleet coordinator** host owns all pool definitions and
client assignments. Its host ID is the fleet ID; its durable fleet revision is
separate from the current transient snapshot counter. Store the fleet document
with the host's private persistent state, under one lock, and publish a revision
only after the atomic write succeeds. Member hosts publish a pinned coordinator
locator, never another writable copy of the catalog. Coordinator changes are
explicit management actions, never an election or an offline fallback.
Converting a populated coordinator into a member is refused to preserve its
catalog. Refreshing the same authority retains the document. A private durable
revision high-water mark prevents revision reuse if an empty coordinator is
explicitly reconfigured and later restored.

`GET /host/v1/fleet` returns the coordinator's canonical full snapshot, or a
member's coordinator locator. `POST /host/v1/fleet/update` requires
`expected_revision` and an explicit operation: save/delete pool, set client
assignment, enroll/remove member. A stale write returns 409 and the current
revision; callers refresh and review rather than silently overwrite/retry.
`POST /host/v1/fleet/authority` assigns a member's locator. Authenticated host
snapshots and pairing responses publish that locator. Connect to its expected
host ID and certificate through the same one-click pairing mechanism; membership
does not substitute for an inference host's own grant. GChat and Manager resolve
an existing coordinator from any paired member. Published coordinator enrollment
uses the same pinned pairing routine, so a second workstation joins the same
fleet without recreating its pools. First-time pool setup offers a shared paired
host as coordinator; it must not silently create one fleet per workstation.

Hosts also expose a read-only membership report derived from the coordinator:
their own pool IDs/names, instance memberships, relevant client placements and
authority revision. Store that projection atomically, ignore stale updates and
report last-known status when its revision lags. Canonical pool commits succeed
even if an offline member cannot refresh its projection; synchronization warnings
remain visible. This projection is not a second writable pool catalog.

The fleet document contains host identities/addresses/pins, UUID pools with
ordered `InstanceRef` members and per-client worker limits, and assignments keyed
by coordinator-issued client grant IDs. Same-user GChat and manager share the
same grant through the shared native registry. Assignments choose usable pools
and preferred host/instance targets; they are placement configuration, not a new
transport authorization system or global worker reservation scheduler. Studio
can browse the full shared catalog, marking unassigned pools; runnable choices
follow the client assignment. An explicit **Fleet assignment** worker target
uses the assigned preferred instances/hosts. Existing Current, selected-model,
Instance and Pool choices remain explicit and retain their behavior.

GChat's existing Studio pool wire format projects instances to canonical
`ginfer/<host UUID>/<instance UUID>` aliases and preserves pool UUIDs. Migrate
existing local pools only through exact, unique persisted/live instance mappings;
retain the original file and report unresolved members instead of guessing or
dropping them. Existing local pool ownership can be adopted once by the already
registered local host; this bootstrap does not replace a discovered/configured
coordinator. Saved definitions, role settings and past runs remain local.
Import exact mapped pools and their source/pool receipts atomically in the host;
the preserved old file must not resurrect a subsequently deleted pool after a
client restart. Unresolved pools remain pending and are reported, not discarded.
A stable shared-registry installation UUID and source path identify imports
across client re-pairing; changing a remote grant must not reset the receipt.
Normalize local Current, explicit Instance and Pool capacity accounting to the
same exact host/instance/session identity so canonical pool migration cannot
bypass overlapping worker limits or count the same GPU instance twice.

All pool consumers use one asynchronous fleet adapter: Studio list/save/delete,
capacity, Chat/Code discovery and worker-dispatch preflight. Poll while active,
refresh on startup/resume and after mutation, and reconcile monotonically by
revision. New delegated runs freeze the validated catalog/revision and retain
exact instance/session affinity. Coordinator loss makes cached UI state visibly
stale and read-only and blocks new explicitly pooled/fleet-assigned workers.
Existing runs continue with their frozen placement; direct Current/local work
retains its behavior. There is no writable per-client pool fallback.

## Package and target alignment

Make `ginfer-manager` a Cargo workspace member while retaining existing native
build commands. Reuse Tauri and already selected dependencies and brand assets.
Package the native manager, host companion and operator guide; use an existing
registered host/runtime without moving models or replacing a running owner.
Build Windows in the established Windows-local MSVC cache. The manager does not
bundle Node, rebuild GInfer or install an engine implicitly.

The current host's closed admission requires bounded alignment for exact
`qwen3.8-flash-next` identities (`groupwise-int`, `smol-q2g64`, `nvfp4`): context
maximum 262144, MTP or none, default automatic MTP width 3, fixed or per-request
adaptive widths, and independent Vision. DFlash/cohort-adaptive width remain
invalid for Flash. Recognize its own NVFP4 KV calibration objects. Update
inventory, launch-option, profile and target validation together using current
Engine source; registration never establishes device/artifact qualification.

## Verification

Behavioral checks cover shared registry/vault identity, pinned pairing, lifecycle
guards, active-client accounting, durable fleet restart/CAS, two clients observing
the same pool edits, migration preservation, offline dispatch, and real manager
rendered actions. Build and open the Linux X11 window; exercise the shared client
against the local host and one explicitly verified paired fleet host. Start a
real model only with the required booking/lock or Server 2 queue. Then assemble
the native Windows tray application and verify tray/window behavior without
replacing the user's current GChat install. Run `make verify` and independent
review before authorized commit/merge/push. Report each milestone to bubbs.
