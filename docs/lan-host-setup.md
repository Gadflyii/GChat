# GInfer network host setup

Development status: real two-machine discovery, pairing, GPU lifecycle, and
Windows desktop-to-LAN routing checks pass, as do Windows SCM and Linux systemd
installation/lifecycle checks. Packages are local, unsigned, and unpublished;
the GChat installer has not been rebuilt with this integration.
Use an explicitly selected `ginfer-serve` build; host installation never updates
the engine or downloads/repackages models. After pairing, the Models page can
explicitly download verified published packages into dedicated managed storage;
see [model management](model-management.md). Existing model roots remain read-only.

## Prebuilt host packages

The standalone archives are `ginfer-host-<version>-linux-x86_64.tar.gz` and
`ginfer-host-<version>-windows-x86_64.zip`. Extract to a local directory. Each
contains `bin/ginfer-host` (or `.exe`), the matching installer under `scripts/`,
this guide, and the project license. Use that `bin/` executable for the installer's
binary argument and skip the source-build commands below.

The host package is separate from the inference runtime: supply an explicitly
selected compatible `ginfer-serve` and existing `.ginfer` models. The archive
contains no engine, model, paired credentials, private state, or campaign files.
It does not require GChat on an inference host. Installer preview is the default;
starting the service and enabling LAN sharing remain explicit choices.

Maintainers produce an archive from a native release build with Python 3.11:

```bash
python3 scripts/package-ginfer-host.py \
  --binary src-tauri/ginfer-host/target/release/ginfer-host \
  --target linux-x86_64
```

Use `--target windows-x86_64` and the native `.exe` for Windows packaging. The
packager checks executable architecture and includes only its fixed distribution
file list. It never compiles the engine and refuses to replace an existing archive.
Output defaults to `src-tauri/ginfer-host/target/distribution/`. Source-repository
tests referenced below are maintainer checks, not included in the binary archive.

Add `--profile-catalog /explicit/qualified-catalog.json` for each selected model's
measured catalog from GInfer's `config/launch-profiles/`. Packaging combines these
without changing profile values, rejects duplicate IDs and other-platform catalogs,
and includes `bin/launch-profiles.json`. Both standalone setup and OS-service
installers preserve this file beside `ginfer-host`. The host validates it before
offering profiles. A state-directory `launch-profiles.json`, when present, replaces
the bundled catalog; an invalid override reports an error rather than silently
using defaults. Refresh reloads edits. Downloaded model-release profiles also
participate through the existing installed-release contract. A package without a
selected catalog has no bundled qualified presets.

For GChat desktop releases, set `GINFER_PROFILE_CATALOGS` to the selected source
catalog paths using the platform's path-list separator (`:` on Linux, `;` on
Windows). The Windows release script exposes the same choice as
`-GinferProfileCatalogs`. The application bundle and its installed CLI host receive
the combined catalog. Both default to an explicit empty catalog when no sources
are selected; release builders must select the measured profiles intentionally.

For a combined Windows distribution, add
`--runtime-directory /explicit/staged/windows/runtime`. This emits
`ginfer-bundle-<version>-windows-x86_64.zip` containing the host and the complete
manifest-selected engine runtime under `runtime/`. The packager verifies every
listed size and SHA256 and requires both `ginfer.exe` and `ginfer-serve.exe`.
Unlisted files, models and private host state are excluded. Packaging does not
install or start anything. Extract the combined archive to a local directory and
run `setup.cmd`: setup displays editable binary and model/state locations, accepts
Enter for the defaults, then asks for confirmation. It installs for the current
user without elevation and adds the binary directory to the user PATH. Open a
new terminal and type `ginfer`. Existing registered hosts retain their engine and
storage; setup never replaces a running host or loads a model.

For explicit setup, run `scripts/setup-ginfer-windows.ps1 -InstallDirectory PATH
-ProviderDirectory PATH -Install`; omit `-Install` to preview, and add `-NoPath`
to avoid editing the user PATH. Existing installation directories are rejected,
not overwritten. Runtime manifest verification happens before installation.
For Linux, pass a staged `ginfer-linux-runtime-v1` directory to the same packager
with `--target linux-x86_64`. Extract the resulting combined archive, then run
`python3.11 setup.py`. Interactive setup offers binary, model/state and launcher
directories; Enter accepts the defaults. Explicit `--install-directory`,
`--provider-directory`, `--link-directory` and `--install` support unattended use;
without `--install`, explicit arguments only preview changes. The launcher symlink
defaults to `~/.local/bin/ginfer`; setup reports if that directory is not on PATH
and does not rewrite shell startup files. Existing paths are not overwritten.

Linux runtime staging belongs to GInfer's `tools/stage_linux_runtime.py`. It
copies explicitly selected executables, FFmpeg and CUDA runtime libraries and
sets relative library paths on the copies with a build-time `patchelf`. It leaves
build products and installed dependencies untouched. The manifest records remaining
system-library dependencies and the build's glibc version. The NVIDIA driver is
never bundled. Successful local relocation does not establish support for an older
distribution ABI; release builds still need the supported distribution baseline.

## Linux host

### Shared local owner

GChat and the no-argument GInfer menu now reuse one per-user host registration:
`%APPDATA%\GInfer\local-host.json` on Windows, or
`$XDG_CONFIG_HOME/ginfer/local-host.json` on Linux (default
`~/.config/ginfer/local-host.json`). The first desktop bootstrap or installed
menu registers its owner. Later installations reuse that owner's engine and
storage without moving models, copying credentials or replacing running services.
A menu can reconnect using this record even without a sibling launcher config.
An explicitly selected `--data-dir` bypasses this registration. Service-mode
records only connect: start a stopped OS service through its service manager.
If a registered installation is unavailable, fix that installation or deliberately
update its locator; a different installation will not silently take ownership.

### Installation

Model roots are optional. A new host can start with empty managed storage and
receive published packages from GChat after pairing. Existing `--models` roots
and explicit artifact-set descriptors remain available as read-only inventory.

Build the standalone host (no desktop session or Tauri runtime required):

```bash
cargo build --release --manifest-path src-tauri/ginfer-host/Cargo.toml
```

The Windows installation procedure is below; the following Python installer is
for Linux only.

Preview a per-user systemd installation. Replace all example paths with existing
engine/model paths and dedicated installation/state directories:

```bash
python3 scripts/install-ginfer-host-linux.py \
  --binary src-tauri/ginfer-host/target/release/ginfer-host \
  --engine /absolute/runtime/ginfer-serve \
  --prefix /absolute/host/bin --data-dir /absolute/host/state \
  --models /absolute/models --name 'Lab host' --share-lan
```

Repeat with `--install` after reviewing the preview. This installs, enables and
starts `ginfer-host.service`, but does not load a model or start inference. Add
`--no-start` to stage the service without starting it. Existing
installations are not overwritten. The engine remains at its supplied path; keep
its runtime libraries there. Model roots may be repeated with `--models`.

For deployment sets, pass `--artifact-set /absolute/models/deployment.json` to
the installer or host executable; this option is repeatable and does not depend
on the descriptor's filename. Each declared TP degree appears as a separate
inventory choice. The host validates identities, degrees, sizes, and member
headers without reading complete weights. The Engine checks the selected payload
SHA256 before upload. Host-managed set launches use `--tp-fallback reject` to
preserve the explicitly reserved GPU group. No sibling package is inferred.
Scan errors appear on the Engines page with a Rescan action; invalid or missing
files are not presented as loadable inventory entries.

## Responses API identity

The GChat facade returns opaque `resp_ginfer_…` response handles for paired-host
Responses calls. Keep the returned handle intact and use the same model-instance
alias with `previous_response_id`. Retrieval, deletion, and input-item pagination
route to that handle's exact host, instance, and engine session. A handle from a
different instance or a pre-restart session cannot continue on a replacement.
Tool-call IDs and input/output-item IDs are not rewritten.

Routing does not add unsupported engine features: the current engine rejects
background cancellation and server-side compaction with its native API errors.
Those errors pass through the facade unchanged.

```bash
systemctl --user start ginfer-host.service
systemctl --user status ginfer-host.service
journalctl --user -u ginfer-host.service
```

The user must have NVIDIA device and model-read access. The Linux installer
resolves `nvidia-smi` from the installing shell and passes its absolute path to
the service, including WSL's `/usr/lib/wsl/lib/nvidia-smi`. Direct launches may
select `--nvidia-smi PATH` when the service environment has a different PATH.
A user systemd manager is required. For operation without login,
an administrator can enable lingering for that account with `loginctl enable-linger USER`.
On WSL, systemd and network reachability must be configured first. No installer
changes host firewall rules or WSL networking.

LAN sharing is opt-in: `--share-lan` binds IPv4 port 7443 and advertises DNS-SD.
Permit TCP 7443 and mDNS UDP 5353 only on the trusted LAN interfaces/subnet.
Without the switch the service listens on loopback. Manual pairing does not need
multicast; WSL NAT and containers can require explicit port/network configuration.

## Windows host

Build the standalone crate with the native Windows Rust/MSVC toolchain. Use a
Windows-local checkout/build directory, not a UNC current working directory.

```powershell
cargo build --release --manifest-path .\src-tauri\ginfer-host\Cargo.toml

.\scripts\install-ginfer-host-windows.ps1 `
  -Binary .\src-tauri\ginfer-host\target\release\ginfer-host.exe `
  -Engine C:\GInferRuntime\ginfer-serve.exe `
  -Prefix C:\GInferHost\bin -DataDir C:\GInferHost\state `
  -Models C:\GInferModels -Name 'Windows inference host' -ShareLan
```

This prints a preview only. Use existing, explicitly selected engine/model paths
and **new, separate** executable/state directories. Repeat with `-Install` in an
elevated PowerShell to copy only the host binary and register `GInferHost` with
manual startup. It does not start the service or load a model. No engine bundle
is updated. `-ArtifactSet` accepts explicit deployment descriptors.

The service runs as the virtual account `NT SERVICE\GInferHost`. Its executable
directory allows that account read/execute; private state allows modify. Only
Administrators and SYSTEM otherwise receive access to these newly created
directories. Engine/model ACLs are deliberately not changed. An administrator
must ensure the service account can read the selected engine runtime (including
DLLs), models, and every declared artifact-set member. For example, on dedicated
local runtime/model directories with inherited permissions:

```powershell
icacls C:\GInferRuntime /grant 'NT SERVICE\GInferHost:(OI)(CI)RX'
icacls C:\GInferModels /grant 'NT SERVICE\GInferHost:(OI)(CI)RX'
Start-Service GInferHost
Get-Service GInferHost
```

Do not grant write access to engine/model storage for the service. User-mapped
network drives are not available to it; network storage requires explicit UNC
paths and server-side access for the service's machine identity. Copying models
to a dedicated local directory avoids that deployment dependency.

Pair from an elevated terminal using the installed executable and private state:

```powershell
& C:\GInferHost\bin\ginfer-host.exe --data-dir C:\GInferHost\state --request-pairing
Stop-Service GInferHost
# Optional after successful startup/pairing qualification:
Set-Service GInferHost -StartupType Automatic
```

LAN sharing remains opt-in and creates no firewall rules. Limit TCP 7443 and
UDP 5353 to trusted network interfaces/subnets. Actual SCM installation/start/stop,
restart, pinned pairing activation, native compilation, host tests, and non-mutating
installer-preview tests pass. Service failures are recorded in the protected
state directory's `service-status.txt`; Windows SCM reports a service-specific
failure code. Run the preview checks with
`tests/test_ginfer_host_install_windows.ps1 -HostBinary <built-host.exe>`.

The opt-in elevated test is
`tests/test_ginfer_host_scm_windows.ps1 -HostBinary <built-host.exe>`. It refuses
an existing `GInferHost` or occupied port 7443, installs with empty inventory,
checks virtual-account startup and pinned local pairing activation twice across
a service restart, verifies durable identity, and removes only its own service
registration. It loads no model and retains its private test files for inspection.
Do not use this test to claim Windows GPU inference qualification.

## Pair without restarting inference

Run locally as the host-service owner:

```bash
/absolute/host/bin/ginfer-host --data-dir /absolute/host/state --request-pairing
```

For a non-default management origin, also pass `--host-url https://HOST:PORT`.
The command reads private host state, pins its certificate, and requests a fresh
five-minute, single-use code. It does not enumerate GPUs, restart the host, or
stop models. Paired desktop credentials cannot activate pairing.

In GChat, open **Engines**, select a discovered address (or enter it manually),
and copy the certificate SHA256 fingerprint and code from the host's own terminal.
Never trust a fingerprint supplied only by an unsolicited discovery announcement.
The host's `host.json` contains its private certificate and local pairing-admin
credential. Keep the dedicated state directory private (0700 on Linux); do not
copy it into model storage, logs, datasets, or a public repository.

**Linux GChat client prerequisite:** install and enable a Secret Service provider
(for example, GNOME Keyring) using your distribution's package manager, and unlock
its keyring in the desktop session before pairing. It must expose
`org.freedesktop.secrets` on the session D-Bus.

First-run network intake and Engines check this before pairing. **Set up secure
storage** offers GNOME Keyring installation on supported Ubuntu/Debian, Fedora,
Arch/Manjaro, and openSUSE systems with `pkexec`. Clicking it requests OS
administrator approval; GChat does not receive that password or install at launch.
Existing GNOME Keyring installations receive unlock guidance instead. Other
systems receive software-manager instructions. After installation GChat verifies
actual write/read/delete access; installation alone does not enable pairing.
You may need to unlock the keyring or sign out and back in. **Check again** retries;
**Skip for now** preserves local use without enabling pairing.

GChat stores paired credentials in the native OS vault: Windows Credential Manager
or that unlocked Linux Secret Service provider. Headless WSL without
`org.freedesktop.secrets` cannot currently complete GChat-side credential storage.
The headless `ginfer-host` service itself does not require that desktop vault.
Do not work around an unavailable client vault by saving paired tokens as plaintext.

## Maintainer LAN qualification

The opt-in tests in `src-tauri/ginfer-host/tests/live_lan.rs` use the production
discovery and pinned TLS client against two explicitly configured hosts. Supply
`GINFER_LAN_HOSTS` as a JSON array with `origin`, out-of-band `fingerprint`, fresh
`code`, and `host_id` for each host. The real-engine test additionally requires
the exact `artifact` path on each host and a released singleton GPU. Never use
an occupied GPU merely because its utilization is low.

```bash
cargo test --manifest-path src-tauri/ginfer-host/Cargo.toml --test live_lan \
  physical_lan_discovery_pairing_snapshot_and_revocation -- --ignored --nocapture

# Separate fresh pairing codes required; this starts and stops real inference.
cargo test --manifest-path src-tauri/ginfer-host/Cargo.toml --test live_lan \
  physical_lan_real_engine_load_infer_reload_and_stop -- --ignored --nocapture
```

The first test requires both hosts to resolve through mDNS, even if manual TLS
pairing succeeds. The second selects only the explicit TP1 artifact, loads it at
C1/8K context with a 1 GiB INT8 KV arena and speculation/vision disabled, requests
16 output tokens, checks reload session replacement, and stops its instance.
Both tests keep issued client tokens in memory and revoke their grants. These
checks do not establish desktop credential-vault integration or performance.

## Use and stop

After pairing, choose an installed model and GPU group in Engines. Loading remains
explicit. Saved launch profiles survive host restart as **stopped**, not automatically
running. Models with equal names on different hosts remain distinct instance choices.
Stop drains tracked requests; Force stop cancels them. Reload validates settings first.

GChat refreshes paired hosts every five seconds and the host scans model roots every
30 seconds. The initial contract uses full authenticated snapshots, not an event
stream. Turning discovery off does not stop paired-host refresh or manual pairing.

```bash
systemctl --user stop ginfer-host.service
systemctl --user disable ginfer-host.service
```

Stopping the service stops only its owned inference children. It does not kill
unrelated engine or kernel-agent jobs. Disabling leaves the host identity, client
grants, models, and saved profiles intact.
