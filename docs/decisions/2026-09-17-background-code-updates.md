# Background Code updates

Code uses the same in-app update flow as Hermes: confirm stopping the embedded
session, show background progress, then offer Open Code or retry. User-facing
controls say Update Code, never Update OpenCode. Updater output goes to a local
diagnostic log rather than the terminal. Settings, session history and workspace
are not reset; normal launch reapplies the GChat theme and startup plugin.

Resolve the stable opencode-ai package version, run the installed executable's
official `upgrade <version>` route, and verify that exact installed version.
Exit code alone is insufficient: upstream's upgrade handler can return normally
after reporting failure. Preserve its detected installation method; do not force
a different package manager. Closed stdin prevents interactive user input. Windows
uses a hidden noninteractive shell and the native command shim, avoiding PowerShell
script-shim execution policy problems. Update work runs off the UI thread and is
serialized in the backend.

References: https://opencode.ai/docs/cli/#upgrade and
https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/upgrade.ts.
Tests cover confirmation, progress, retry, return, closed stdin, output capture,
and rejection of both failed upgrades and success exits with an old version.
