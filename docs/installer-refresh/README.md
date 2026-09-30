# Installer refresh — 2026-09-30

## Outcome

Windows GChat 2.0.42 was rebuilt and updated in place with the current engine.
The NSIS installer exited successfully; the installed app and host are running.
Server 2's GChat installation was removed while preserving its data and models.
Windows NSIS/MSI and Linux AppImage artifacts are retained locally. This is
release assembly and startup verification, not model/performance qualification.

## Accepted sources and artifacts

GChat source: `bf7cde6f7bdb975713deb0f401458a9faf3f23d6`.
Windows engine: `74780ea1415ac8d3bb440d58442ac4f81a5dfde3`, clean manifest.
Linux engine: existing clean `15659f3e4c3c8b4c539a4726e625cda51528c648` build.
The subsequent Windows fixes do not change Linux execution semantics.

| Artifact | Location |
| --- | --- |
| Windows setup EXE | `/ai/gchat/out/windows/GChat_2.0.42_x64-setup.exe` |
| Windows MSI | `/ai/gchat/out/windows/GChat_2.0.42_x64_en-US.msi` |
| Linux AppImage | `/ai/gchat/out/linux/GChat_2.0.42_amd64.AppImage` |
| Linux host/engine bundle | `/ai/gchat/out/installer-refresh-20260930/ginfer-bundle-0.1.0-linux-x86_64.tar.gz` |
| Windows engine archive | `/ai/ginfer/out/windows/ginfer-windows-x64-sm120a.zip` |

Native Windows installer copies are in `%LOCALAPPDATA%/GChat/release-output`.
The Linux desktop retains its separate-engine contract. The Linux runtime bundle
is SM120a, built on glibc 2.43, with 72 RTX 5090 profiles; it does not establish
Ubuntu 24.04 engine compatibility. The AppImage itself is built on Ubuntu 24.04.

## Verification

- Windows native engine compilation and both executable `--help` checks passed.
  The native `ginfer_http_bind_test` rejects duplicate binds and allows rebind
  after closing the owner. All 120 Windows runtime manifest entries passed
  independent size/hash verification. Engine fixes were reviewed, merged and pushed.
- NSIS installation returned 0. The installed `GChat.exe` presents a responsive
  GChat window and starts the packaged `ginfer-host.exe`. The active runtime at
  `%APPDATA%/GChat/data/ginfer` reports clean revision `74780ea1`; all 120 active
  runtime file hashes and sizes match the package manifest. No model was started for qualification.
- Windows assembly selected 103 profiles from 14 catalogs. The local model cache
  contains two `.ginfer` artifacts totaling 44,808,326,400 bytes plus configuration
  files. Before/after inventory matches: four files, 44,808,326,736 bytes total.
  Application state and models are preserved.
- Linux AppImage's 174 profile IDs match the selected source catalogs. Packaged
  host code and build ID match the fresh build; linuxdeploy adds `$ORIGIN` RUNPATH,
  so whole-file hashes differ. The packaged host `--help` runs successfully.
  All 110 engine members inside the Linux runtime archive match its manifest.
- `make verify` passed: lint, type checks, quality checks, 2,028 frontend tests,
  14 extension tests, coverage floors and all supported native suites. Existing
  frontend bundle-size advisories remain. No new Linux desktop walkthrough was
  performed because Server 2 was explicitly uninstalled.

Copied-source Windows engine builds report `1.0.0.0-unknown` in `--version`, per
the engine's versioning contract. The runtime manifest records the exact revision.

## Server 2 removal

Verified host: `AIS-1-2950X-L02` at `192.168.1.111`, two NVIDIA Graphics Device
GPUs and one RTX 3090. Stopped its sole GChat-managed host; no model or desktop
process was running. Removed active AppImages, app host files, GChat CLI, desktop
entry and GChat-owned host locator. Coordinator independently checked active
installation paths absent and data/model paths present.

The removed files are recoverable in
`/home/ron/.local/state/gchat-uninstall-2026-09-30` (561 MiB). Preserve
`~/.local/share/GChat/data` (66 MiB), model storage (36 GiB), standalone
`~/.local/bin/ginfer-host` and launcher files, and `/ai/ginfer/build-80` and
`build-86`. No unrelated engine, model or user data was deleted.

## Owned inventory and evidence

Final archives and existing incremental build caches are retained. Windows caches
are `%LOCALAPPDATA%/GInfer/windows-build` and `%LOCALAPPDATA%/GChat/windows-build`.
Linux app cache is `/ai/gchat/src-tauri/target`; its source engine baseline remains
`/ai/ginfer/build`. Disposable Linux runtime staging (447 MiB), temporary patchelf
and the redundant engine candidate archive were removed after verification.
Temporary documentation worktrees are retired after reviewed integration.

Evidence paths:

- `/ai/gchat/out/windows/build-gchat-bf7cde6f-engine74780ea1.log`
- `/ai/gchat/out/windows/install-nsis-74780ea1.log`
- `/ai/gchat/out/installer-refresh-20260930/linux-build.log`
- `/ai/gchat/out/installer-refresh-20260930/verify.log`
- `/ai/ginfer/out/windows/build-sm120a-74780ea1.log`
- `/ai/ginfer/out/windows/check-http-bind-74780ea1.log`

The Linux wrapper returned 127 after successful AppImage assembly because the
wrapper was edited while Bash was reading it. Direct artifact checks established
completion; no compilation was repeated. Keep running wrappers immutable. The
corrected wrapper is retained beside its log. Windows source provenance initially
misread WSL executable bits as source changes; the packager now ignores only that
mode drift and the accepted archive reports clean.

## References

- [Development and platform paths](../../DEVELOP.md)
- [Host setup](../lan-host-setup.md)
- [Remaining release acceptance](../open-work.md)
- GInfer `docs/installer-refresh/README.md`, `packaging/windows/README.md` and
  `tools/stage_linux_runtime.py`
