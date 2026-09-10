---
date: 2026-09-09
title: "Share profile launch and instance control"
---

# Share profile launch and instance control

- **Context:** host-aware downloads and explicit launch controls exist, but the
  assumed hardware preset catalog and simple interactive launcher do not. The user
  explicitly added their construction and full remote lifecycle control to the
  current model-management goal.
- **Decision:** use prebuilt qualified hardware/artifact profiles with context,
  concurrency, TP and KV settings. A no-argument `ginfer` menu and GChat both use
  ginfer-host's persistent instance lifecycle, exclusive GPU-group reservations and
  port ownership. GChat can download to each host and start, stop, restart, change
  or reload models and switch profiles, restarting serving as necessary.
- **Consequences:** build the missing cross-repository contract rather than treating
  it as an external blocker. Profiles need physical fit evidence with 1 GiB per-GPU
  headroom. A supported context below native maximum is normal profile behavior.
  Editable source catalogs live in GInfer's `config/launch-profiles/`; hosts read
  installed JSON and refresh it without an application rebuild. Each profile binds
  the qualified Linux/WSL or Windows platform as well as the GPU and artifact, so
  a matching GPU name cannot transfer qualification across operating systems.
  Keep the host service alive independently of serving and desktop sessions;
  confirm disruptive changes and expose readiness, errors and metrics per instance.
  Desktop bootstrap reconnects to a pinned local owner or starts an independent
  ginfer-host process. The host's exclusive state lock arbitrates concurrent
  bootstrap clients; an unreachable but live owner is never killed or replaced.
  Host output goes to its private state log, not a pipe owned by the desktop.
  Local identity/lifecycle state lives in `<data>/ginfer/host`. Desktop-provider
  mode explicitly owns the provider's existing model cache and transfer journal;
  the desktop no longer opens a competing transfer manager.
  The user-approved per-user `local-host.json` locator records the first local
  owner, under `%APPDATA%\GInfer` on Windows and `$XDG_CONFIG_HOME/ginfer`
  (default `~/.config/ginfer`) on Linux. Desktop and unqualified menu launches
  adopt that owner, including its engine and storage paths. Registration is
  serialized and atomically published; credentials remain in private host state.
  An OS-service locator connects only; it does not spawn a competing desktop
  owner. Explicit `--data-dir` operations remain isolated from user registration.
  A malformed or unavailable registered owner is reported, never silently replaced.
  This on-demand bootstrap is distinct from OS-service installation and does not
  imply boot-time startup or automatic recovery after a host crash.
  Standalone distribution assembles explicitly built engine and host payloads;
  the host packager never builds or downloads an engine implicitly. A bundled
  Windows runtime must pass its existing manifest's size/hash and executable
  architecture checks, and only listed runtime files enter the archive. Host-only
  packages remain useful for updating management on an existing inference host.
  Fresh standalone setup offers editable per-user defaults: Windows binaries in
  `%LOCALAPPDATA%\GInfer`, provider storage in `%APPDATA%\GInfer\data`; Linux
  binaries in `~/.local/lib/ginfer`, provider storage in
  `$XDG_DATA_HOME/ginfer` (default `~/.local/share/ginfer`). These defaults were
  explicitly approved by the user. Interactive setup displays them and accepts
  Enter or replacement paths. An existing registered owner's paths take priority.
  Linux stages copies with relative `$ORIGIN` library paths, bundled FFmpeg/CUDA
  runtime, and declared system dependencies. The NVIDIA driver remains host-owned.
  Setup never alters source builds, system dependencies or shell startup files.
  Distribution explicitly selects measured platform catalogs and installs their
  combined `launch-profiles.json` beside the host executable. An explicit
  state-directory catalog takes precedence, including an intentionally empty one;
  invalid user overrides fail visibly. Existing owners retain their own catalogs.
  This extends the selected-host decision without changing artifact ownership,
  read-only external storage, publication integrity or public inference protocols.
- **Owner:** team.
- **Links:** [Current goal plan](../model-management-plan.md),
  [Selected-host management](2026-09-08-manage-models-on-the-selected-host.md).
