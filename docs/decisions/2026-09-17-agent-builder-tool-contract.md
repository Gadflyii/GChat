# Agent Builder's native tool contract

The saved inventory-authoring runs exposed a contract failure, not only malformed
model output. GChat sent empty native parameter schemas. GInfer's ATEM decoder
intentionally preserves undeclared parameter types as strings, so Studio's nested
definition arrived as a JSON string. Rejected calls then triggered repair output
with differing qualified names. The author also received a general operator
persona discouraging questions and a catalog without the actual model directory.

Studio native tool schemas now declare action as string and args as object,
with the definition shape owned by the definition module. Authoring restricts the
advertised action enums to catalog, lookup, validation and approved saving. Wire
descriptions name the exact callable; operations remain arguments, not functions.
Known qualified repetitions resolve only against registered descriptors, never by
arbitrary suffix matching. Observed string-encoded definition objects are decoded
only at the definition-operation boundary and still pass semantic validation and
approval. This does not authorize unknown tools or infer new actions.

Authoring replaces the generic operator prefix with a focused builder contract.
Native tool choice is auto so clarification is legal; ordinary assistant prose
becomes a display-only reply. Malformed tool markup and JSON are not converted to
executable work. Replies, history, context budgeting and save approval use the
existing runner. The Studio catalog provides localModelDirectory and the definition
schema. Default placement stays on the current model unless explicitly assigned.

Regression evidence covers a two-turn clarification-to-save conversation, native
string-encoded parameters, ATEM qualified names, approval accepted and denied,
exact namespace resolution and typed request schemas. A live-model run is separate
evidence; scripted completions do not establish model reliability.

Live verification passed on the Windows RTX 5090 using the installed Muse Glimmer
NVFP4 + NVFP4 DFlash2 artifact, Vision enabled, C1, 32K context and automatic NVFP4
KV sizing. The actual runner completed clarification, catalog lookup, definition
validation, approval and saving in 30 seconds with no repair retry or filesystem
task execution. Definitions were saved only in a temporary test store and the
temporary server was stopped afterward. The saved GChat profile was not modified.

A subsequent live matrix passed all four compositions on the same configuration
in 113 seconds: Standard model inventory (including clarification), a three-cycle
Goal Loop for release-note review, a Coordinator with two documentation reviewers,
and a three-stage Workflow for a documentation checklist. Each saved exactly one
validated definition through one approval, retained current-model placement, and
executed no filesystem task. Coordinator worker count and parallelism, Goal Loop
cycle limit and evaluator, and Workflow nodes and edges were checked explicitly.
These are authoring tests, not execution qualification of the generated workflows;
approval was supplied by the test harness and saves used isolated temporary stores.

The installed profile's explicit arena failed startup with insufficient post-startup
capacity; it was not used as evidence. An initial live harness attempt inherited
the unit-test 100 ms deadline and cancelled inference, exposing an engine error;
the live test now uses the production deadline and ran against a fresh process.
