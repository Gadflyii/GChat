# GChat installer refresh

## Current deliverable — complete Linux installer

Owner: coordinator, Linux engine packaging agent, Linux runtime integration agent.
User requires a complete ready-to-install Linux GChat package. The earlier AppImage
and separate native runtime archive did not satisfy this: the AppImage omitted the
engine, and the native archive was not validated on the desktop deployment baseline.
The previous claim that glibc 2.43 was a minimum was invalid; it was only the build
machine's version. Those artifacts are superseded as Linux release candidates.

Target: Ubuntu 24.04+ x86_64 with an installed compatible NVIDIA driver. Deliver a
standard `.deb` installer plus AppImage, each carrying separate SM80, SM86, SM89
and SM120a engines and their private dependencies. GPU routing is automatic,
including mixed architectures. Model weights remain normal user downloads.

## Acceptance and exclusions

- Build engine and desktop against the Ubuntu 24.04 baseline; verify actual ELF
  dependencies and each packaged executable in a clean target environment.
- Install the `.deb` in a disposable clean environment, start the desktop and its
  owned host, verify persisted engine routing and bundled runtime integrity.
- Exercise fresh installation and update while preserving model/state files;
  do not override an independently registered standalone host.
- Keep Server 2 uninstalled and the working Windows installation unchanged.
- This is installer/startup/inference smoke acceptance, not a new model-quality,
  performance or per-GPU qualification campaign. Do not claim untested hardware.
- Run GChat `make verify`, affected packaging/setup tests and actual artifact
  checks. Review, commit, merge and push authorized changes, then retire owned
  candidate worktrees and disposable staging while retaining final artifacts.

## Plan and next decision

1. Engine agent builds four separate CUDA images in Ubuntu 24.04 with the exact
   private FFmpeg dependency and stages checksummed self-contained runtime dirs.
2. Runtime agent adds Linux bundled-runtime installation and explicit GPU routing
   through existing local-host ownership. Coordinator adds repeatable Linux release
   assembly and Debian packaging.
3. Coordinator builds and verifies final packages, performs clean install/startup
   acceptance, updates this account and removes superseded task-owned artifacts.

Current unresolved action: finish the four-image runtime set, assemble both packages
and verify a clean desktop install. Ubuntu 24.04 SM80 and SM86 compilation passed;
All four architecture builds now pass. Engine packaging is adding the complete
non-system library closure so AppImage engines do not depend on separately
installed curl/dav1d libraries. Runtime install/upgrade,
model preservation, registry ownership and exact architecture routing tests pass.
Frontend verification passed 2,029 tests and 15 extension tests; corrected old-path
assertions pass with all 523 desktop Rust tests. Desktop Clippy passed. Remaining
Rust subcrate suites also pass; packaged acceptance remains. The first assembly
attempt exposed Ubuntu's Node 18 being too old for the existing bundler syntax.
The build image now pins Node 22.22.1 (matching the verified development major)
and includes npm for extension packaging; this changes only build tooling.
Extension installation refreshes its existing local core-tarball lock entry after
packing core; requiring that generated checksum to remain immutable blocked the
container build. External root dependencies remain locked.
The release build uses an owned Ubuntu 24.04 Docker image; dependency copies are
owned by the GChat candidate and do not mutate the main checkout.

Linuxdeploy must not rewrite the checksummed engine files. The Debian package
includes them directly; AppImage assembly injects the verified set after linuxdeploy.
Bun and uv live in app-private resources, avoiding global executable conflicts.

Runtime resource contract: `resources/ginfer/linux/runtime-set.json`, schema
`ginfer-linux-runtime-set-v1`, platform `linux-x64`, source_commit, and runtimes
mapping `8.0: sm80`, `8.6: sm86`, `8.9: sm89`, `12.0: sm120a`. Each directory
contains a `ginfer-linux-runtime-v1` manifest and `bin`, `lib`, `licenses` payloads.

## Inventory

| Owner/host | Exact path | Role/status |
| --- | --- | --- |
| Coordinator / Ron-9950X3D2 | `/ai/gchat` at `7c3cba57c` | Main baseline; installed Windows build remains unchanged |
| Coordinator/runtime agent | `/ai/gchat-worktrees/linux-installer` branch `feat/linux-installer` | Linux installer candidate |
| Engine agent | `/ai/ginfer-worktrees/linux-installer` branch `build/linux-installer`, baseline `85d1a617` | Portable engine build and packaging candidate |
| Coordinator / owned outputs | `/ai/gchat-worktrees/linux-installer/out/linux/` | Build scripts/logs, disposable acceptance image recipe, final packages pending |
| Coordinator / Docker | `gchat-linux-installer-build:ubuntu24`, `gchat-linux-installer-acceptance:ubuntu24` | Owned build and clean-install environments |
| Engine baseline | `/ai/ginfer/build` | Existing local engine; not a portable-release input |
| Existing desktop build cache | `/ai/gchat/src-tauri/target`, Docker `gchat-linux-build:ubuntu24` | Reusable cache; candidate artifacts must be verified |
| Superseded Linux artifacts | `/ai/gchat/out/linux/GChat_2.0.42_amd64.AppImage`, `/ai/gchat/out/installer-refresh-20260930/ginfer-bundle-0.1.0-linux-x86_64.tar.gz` | Incomplete release; replace/retire after complete installer accepted |
| Server 2 | `AIS-1-2950X-L02`, `192.168.1.111` | Remains uninstalled; no persistent installation authorized by this task |

Local host/GPU verified at start: Ron-9950X3D2, RTX 5090, driver 610.88, about
24 GiB occupied. Do not run inference on that occupied GPU. Builds need no GPU.
Engine/runtime agents maintain bounded logs and coordinate exact output paths.

## Completed Windows update and Server 2 removal

The September 30 Windows NSIS/MSI update used GChat `bf7cde6f7` and clean engine
`74780ea1`. NSIS exited 0, the desktop and host run, and all 120 active runtime
members match the manifest. Model cache preserved: two `.ginfer` artifacts plus
two config files, 44,808,326,736 bytes total. `make verify` passed. Windows engine
compile/socket/provenance corrections were merged and pushed. See GInfer's
`docs/installer-refresh/README.md` for that accepted build's evidence.

Windows installers remain under `/ai/gchat/out/windows` and native copies under
`%LOCALAPPDATA%/GChat/release-output`. No Windows rebuild/reinstall is requested.

Server 2's GChat app, host and desktop registration were removed recoverably into
`/home/ron/.local/state/gchat-uninstall-2026-09-30` (561 MiB). User data, models,
standalone host and independent engine builds remain. Its prior installation does
not validate the new Linux package.

## References

- [Development and platform paths](../../DEVELOP.md)
- [Host setup](../lan-host-setup.md)
- [Open work](../open-work.md)
- GInfer `docs/installer-refresh/README.md`, `tools/stage_linux_runtime.py`
