# GChat installer refresh

## Windows update — October 1, 2026

The user authorized building and installing the Windows update, including
restarting GChat and its host. Deliver NSIS/MSI installers with the agent/chat
fixes from `9540ac7e1` and correct the sidebar Stop server shortcut: Start loads
the active model and starts the API, so Stop must stop the API and unload that
active model. API-specific settings retain their independent control.

Acceptance: reviewed source and full verification, successful native assembly
with the accepted Windows engine `74780ea1415ac8d3bb440d58442ac4f81a5dfde3`,
NSIS update exit 0, installed executable matching the new build, desktop/host
startup, runtime integrity and preserved models/history/agent definitions.
The user will replay the agent/chat incident. Step budgets and overall Agent
Finished reporting are excluded from this installer update. Server 2 remains
uninstalled. The sidebar stop action and four focused component regressions
pass; it also offers Stop model when the API is already stopped. Independent
review and full `make verify` passed: 2,042 frontend tests, 15 extension tests,
critical coverage floors and supported Rust suites. The 103 selected Windows
profiles exactly match the installed catalog. Native assembly from source
`8c81f53da9315faa092c8edcb6959fc856bc3dfd` stopped during source staging:
Windows exposes the verification worktree's Linux `node_modules` links as files,
so directory exclusions did not protect native dependency directories. The
mirror now excludes that name as both a directory and a file. A native mirror
regression preserved a dependency sentinel, copied current source and removed
obsolete source. Only verified zero-byte placeholders from the failed staging
were removed. Next: retry assembly with the corrected mirror. Compiler caches
and the installed app remain intact.

| Owner / host | Exact path | Purpose / retention |
| --- | --- | --- |
| GChat / workstation | `/ai/gchat`, `9540ac7e1` | Reviewed source baseline; September 30 installers retained until update acceptance |
| Windows refresh | `/ai/gchat-worktrees/windows-refresh`, `fix/windows-refresh-20261001` | Owned implementation/docs candidate; retire after integration |
| Windows refresh | Candidate `out/windows/acceptance-20261001/` | Native build/install evidence; retain concise results |
| Windows build / Ron-9950X3D2 | `%LOCALAPPDATA%/GChat/windows-build/source` | Existing native mirror and compiler caches; verified idle before reuse |
| Windows refresh | `%LOCALAPPDATA%/GChat/windows-build/acceptance-20261001/` | Failed staging log and prepared durable runner; no live build |
| GInfer | `/ai/ginfer/out/windows/ginfer-windows-x64-sm120a.zip` | Accepted 120-member runtime, unchanged engine |
| Windows baseline | `/ai/gchat/out/windows/GChat_2.0.42_x64-setup.exe`, `GChat_2.0.42_x64_en-US.msi` | Preserve until the candidate is installed and checked |

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

The real-GPU check used
`/mnt/data/ai/ginfer-artifacts/qwen38-muse-tp1-tp2-tp4-2026-09-02-r1/muse_glimmer_30b_autoround_dflash2.ginfer`.
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
