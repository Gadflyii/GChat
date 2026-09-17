# Chat skills and focused agent authoring

## Contract

Skills are available from ordinary chat and Agent chat. Invoking a skill routes
the turn through the tool-capable worker without requiring a workspace-mode
switch. Follow-up messages remain in that skill conversation until the user exits
it. Engine availability and tool permissions remain enforced.

`/agent-builder` creates definitions, not executions of their future tasks. It
always uses the standard authoring worker, never the selected saved loop. Its
native tool allowlist permits Studio discovery/validation, definition saving,
tool guidance, and replies/clarifying questions. Filesystem, shell, pool mutation,
and run control are unavailable during authoring, including hallucinated calls.

Studio results are delivered as structured inline information, not merely an
archive filename. The builder obtains native templates, chooses the simplest
appropriate composition, asks only material questions, validates the definition,
and requests explicit confirmation. The confirmation shows readable goal,
instructions, output expectations and placement. Saving never starts the agent;
the user can open Studio to inspect or run it. Stable definition IDs make a retry
an update rather than a second creation.

## Output budgets

Auto budgets depend on reasoning effort and exact remaining context. Output
budgets can be overridden in a definition's Advanced generation settings; explicit
limits are preserved and validated against the resident context capacity. Output-limit
exhaustion is not malformed JSON: allow one larger, context-checked inference
retry without replaying tools. Preserve reasoning effort. Malformed-output repair
must not shrink the output budget to 1,024 tokens. Exhaustion is surfaced explicitly
with preserved transcript; retries remain bounded.

## Verification

Cover ordinary-chat skill routing, builder isolation from saved loops, denied
non-authoring tools, inline catalog results, confirmation before save, bounded
output-limit recovery, and the model-inventory definition scenario. Run the
repository verification gate plus Rust check and Clippy. Real-model qualification
is reported separately from scripted integration tests.
