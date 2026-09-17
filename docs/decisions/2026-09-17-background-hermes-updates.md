# Background Hermes updates

Supersedes the interactive updater in full-code-session-and-hermes-updates.
GChat confirms stopping its Hermes session, then owns a hidden background update
with preparation, installation and runtime-check stages. No updater PTY, shell
commands or Git prompts are presented. Completion offers Open Hermes; failures
offer retry and a diagnostic log location. Progress is indeterminate, not a
fabricated percentage.

Use upstream's supported `update --yes --keep-stash --no-gateway-restart` with
closed stdin. Require these flags before making changes. Preserve upstream
backups; do not reapply source customizations or restart unrelated gateways.
Refuse a configured discard policy. GChat themes and user settings remain outside
the source checkout. Reapply managed Windows runtime repairs after update and
verify the executable before reporting success. Serialize updates in the backend;
blocking process work stays off the UI thread. Output is streamed directly to a
local diagnostic file, not accumulated in terminal replay or UI memory.

Tests exercise closed stdin, exact updater options, output capture, failure and
startup verification, plus UI confirmation, progress, retry and return to Hermes.
