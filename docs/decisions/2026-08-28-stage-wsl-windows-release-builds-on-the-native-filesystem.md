# Stage WSL Windows release builds on the native filesystem

**Date:** 2026-08-28  
**Status:** Accepted

## Context

The GChat source tree is commonly maintained in WSL and opened from Windows as
`\\wsl.localhost\...`. Windows `cmd.exe` cannot use a UNC working directory, and
Node, Rust, and Tauri builds are both slow and unreliable when their dependency
trees and compiler output live on the WSL filesystem. Requiring a separately
managed Windows clone makes it easy to build stale code and adds an unnecessary
manual synchronization step.

## Decision

`scripts/build-windows-release.ps1` treats a WSL/UNC checkout as the authoritative
source and mirrors release-build inputs into `%LOCALAPPDATA%\GChat\windows-build\source`
before relaunching itself there. Generated and dependency directories are
excluded from synchronization, as are documentation and test-only trees, so
Windows-native `node_modules` and Cargo output remain reusable in the managed
mirror. The mirror is exact for build inputs, which also removes build-input
files deleted in WSL.

The same release command bootstraps missing Windows build prerequisites through
`scripts/setup-windows.ps1`. Completed NSIS and MSI installers are copied back to
`out\windows` in the authoritative checkout. `GCHAT_WINDOWS_BUILD_ROOT` may
override the native build location when another local disk is preferred.

Native checkouts continue to build in place. The development launcher is not
silently mirrored because a one-time sync would misrepresent hot-reload behavior.

## Consequences

- A Windows release can be built from the WSL checkout with one command.
- Compiler output and platform-specific dependencies never mix between Linux and
  Windows.
- The native mirror is a managed build cache, not a second developer checkout.
- The mirror consumes local scratch space in exchange for incremental native
  builds and can be relocated with `GCHAT_WINDOWS_BUILD_ROOT`.
