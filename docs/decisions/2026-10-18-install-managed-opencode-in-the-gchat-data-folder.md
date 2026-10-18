---
date: 2026-10-18
title: "Install managed OpenCode in the GChat data folder"
---

# Install managed OpenCode in the GChat data folder

Archive startup attempted a global npm installation and failed with EACCES in
`/usr/local/lib/node_modules`. GChat must own the files it installs.

Arch approved local npm installation with `--global=false`, an explicit prefix
at `<data>/code/opencode/runtime`, and cache at `<data>/code/opencode/npm-cache`.
Missing Node.js or npm produces a plain error asking the user to install
Node.js LTS. GChat does not bootstrap either system tool for OpenCode.

A single executable resolver chooses an explicit custom path, then GChat's
managed copy, then the native PATH. An invalid explicit path stays an error.
Readiness, embedded and external launch, CLI and offline deletion all use this
resolver. Managed updates use the same npm prefix and verify the requested
version. A partial installation is not successful setup.

For external/custom installations GChat displays their own `upgrade` command
without executing it. The user may explicitly choose **Use managed copy**;
only successful private installation clears the custom override and switches
to the managed resolver. The external copy and its installation method remain
untouched. This narrows the execution policy of the
[September 17 update decision](2026-09-17-background-code-updates.md), while
retaining confirmation, progress, version checking and session preservation.
[Selected configuration isolation](2026-10-11-isolate-managed-opencode-configuration.md)
continues to apply to every child.

Authority: claude-arch, October 18, 04:58:46Z; acceptance and inventory are in
[Agent runtime](../agent-runtime/README.md#archive-opencode-provisioning--c7-october-18).
