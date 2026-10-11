# Use pinned Cua MCP and SSH operation receipts for Gbot

Gbot's dedicated guest installs the approved Cua 0.34.1 MIT driver. The service
must use its actual MCP contract; the previous JSON-worker executable does not
exist. Commands and files already belong to authenticated SSH channels.

Desktop operations now use the pinned driver's MCP tool catalog over an SSH
exec channel. The service owns the session identifier, checks driver identity,
and preserves capability checks. Commands/files use separate SSH channels and a
small installed shell helper. Native-vault keys and the SSH-forwarded view remain
under the existing workspace session.

The helper binds each session to the desktop unit's InvocationID and claims
operation IDs atomically before dispatch. Transient systemd user units own
command process groups across channel loss. Status reads durable receipts;
cancellation stops only the operation's unit. A desktop action whose reply is
lost stays unknown and cannot be dispatched again with the same ID. Reconnecting
can restore the MCP channel without replaying that action.

This removes the service's JSON-worker path without adding a native guest
binary or a second desktop transport. It does not deliver the bot sidebar,
general task executor, integrated viewer or Vision. Current acceptance and owned
guest/evidence inventory live in [the Gbot authority](../gbot/README.md).
