# GChat memory

## Contract

GChat owns a local, inspectable memory library separate from transcripts, session
checkpoints, skills and the engine KV cache. The Memory sidebar page creates,
searches, edits, pins, disables and deletes entries. Nothing is mined from old
conversations automatically. Agents may propose saves or deletions through the
normal approval gate; the user can always manage entries directly.

Personal entries are available to GChat chat and agents. Workspace entries are
available only to agents operating in that exact canonical workspace. Inference
host selection does not change the workspace or memory owner. External OpenCode
and Hermes processes do not automatically receive this library.

Recall selects enabled personal entries plus entries for the current workspace,
ranks pinned entries first and then lexical query overlap, and injects a bounded
JSON evidence block. It is not embedding-based semantic search. Stored text is
reference data, not authority to execute instructions or tools. Saves record their
origin and timestamps; updates require the current revision to prevent concurrent
workers from silently overwriting each other. Entries are limited in size and count.
The library is ordinary local application data, not an encrypted secret vault.
Deleting or disabling an entry prevents future recall; it does not erase copies
already sent to a model, present in an active run, or retained in a conversation.
The library lives in `memories.json` under GChat's configured data directory.

## Workspace initialization

An optional `AGENTS.md` at the selected workspace root supplies user-maintained
project instructions. GChat reads only that file, with a size limit, and never
creates it or traverses parent directories to discover additional instructions.
Symlinks escaping the workspace are rejected. The Memory page can preview it.
Instructions are separate from recalled facts; memory tools cannot rewrite it.
No init file is required for personal memory or ordinary chat.

## Acceptance

Validate persistence and revision conflicts, workspace isolation, disabled entries,
bounded relevance ranking, instruction-file containment, approval-gated mutation,
prompt integration, and rendered library editing/deletion. Existing chat compaction
counts the augmented prompt; memory cannot bypass context admission. Native disk
operations run on the blocking pool; recall does not launch a model or reload an
engine. No new runtime dependency or vector service is required.
