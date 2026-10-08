# GChat installer refresh

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
with the explicit runtime set and profile catalog directory; see
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
No Linux installer work remains after the documented commit/push and cleanup.

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
