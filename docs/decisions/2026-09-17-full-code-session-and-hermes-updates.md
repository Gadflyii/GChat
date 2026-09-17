# Full Code sessions and visible Hermes updates

This supersedes only the OpenCode startup choice in native-terminal-startup.
The Code tab retains the stock full TUI, sidebar, history and menus. Its managed
TUI plugin creates an empty session through OpenCode's public client and navigates
to that session on initial home entry. It sends no prompt, consumes no inference,
and does not redirect an already-selected session. Failure leaves home usable with
an actionable toast. No upstream source fork or minimal interface is involved.

Hermes is installed through its upstream installer, not bundled as a frozen source
checkout. Its tab exposes Update Hermes: confirm stopping the current session,
run the official interactive `hermes update` in the existing terminal, then Open
Hermes after the updater finishes. Keep upstream prompts, backups and local-change
handling; do not force updates over running services, discard local changes, or
silently accept migration prompts. Launch applies the managed Windows runtime
repair again, including junctions recreated by an update.

Verification includes plugin session routing and failure handling, update
confirmation/return UI, terminal commands, and a real Windows full-TUI startup.
