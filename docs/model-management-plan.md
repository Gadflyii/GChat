# Host-aware model management

Status: host-aware management implemented and verified. The goal remains open for
automatic hardware-preset selection, pending the newer engine's preset interface.

## Outcome

Models is a lightweight control surface for this computer and paired GInfer hosts.
Select a destination, see installed models or compatible published recommendations,
and manage transfers on that destination. Do not copy LAN downloads through GChat.

## Ownership

- GInfer owns executable artifact compatibility, topology validation, and runtime
  presets. Saved host launch configurations are not hardware-qualified presets.
- Release metadata owns exact package identity, SM qualification, per-rank memory
  requirements, TP degree, immutable source URL, bytes, and SHA256. Unpublished or
  incomplete entries must not become download actions.
- ginfer-host owns durable transfers and managed storage. Existing inventory roots
  remain read-only. Authenticated management does not expose arbitrary shell commands.
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
6. Consume engine presets only through a verified supported interface. If absent,
   expose that limitation rather than shipping a duplicate VRAM-to-settings table.
7. Test transfers, compatibility, UI destination isolation and lifecycle behavior;
   run make verify and document unavailable real-host/Windows checks.

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

## Remaining integration and release limits

Both available engine checkouts lack a verified machine-readable hardware-preset
catalog. Their inspected serving defaults are 8K context/C1. Do not label these
as the user's newer 16/24/32/64+ GB qualified presets. Request the newer checkout
or preset command/endpoint before implementing automatic profile selection and
one-step download-and-profiled-load. The goal is not complete until that boundary
is connected and tested.

The producer must publish release metadata and configure the release feed; no
public URL or Smol artifact was invented. LAN hosts need the updated ginfer-host
to enable the new management operations. No host services were deployed, no GPU
inference was launched, and no Windows installer/WebView walkthrough was run.
Clippy is unavailable in the installed toolchain; it was not installed. Changes
remain uncommitted on main, alongside the preserved earlier polish work.
