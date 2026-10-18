# Register local model files in place

## Decision

Models > This computer > Installed exposes **Add local model** using a single
`.ginfer` file picker. The desktop reuses the local administrator Host artifact
registration route for canonical path and container inspection, then writes an
app-owned model manifest pointing at that exact external file. No model bytes
are copied or moved. Canonical duplicates retain their existing catalog identity
and display name.

The existing provider inventory reads that manifest on the next refresh and
restart. Removing an external catalog reference removes only its app-owned
manifest directory. Host registration remains a read-only inventory reference.
Invalid registration never publishes an Installed manifest. Welcome text names
the action users can actually take.

## Consequences

The action works without published recommendations and without loading a model.
External files must remain accessible at their registered paths. There is no
folder subscription/rescan contract, remote file picker, producer conversion or
inference change. Existing Host validation and launch admission remain the
sources of truth.
