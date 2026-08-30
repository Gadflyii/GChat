# GChat Agent Architecture

This is the living engineering reference for the Rust Agent runtime and Agent
Studio. Update it when inference transport, orchestration, tools, safety, or
run-observability contracts change. Product-wide decisions belong in
`docs/decisions/`.

## Product boundary

Agent mode is isolated from ordinary Chat conversations and the Vercel AI SDK
path. It composes one bounded Rust executor as a Standard Agent, evaluator-led
Goal Loop, Coordinator Team, or acyclic Workflow. Definitions, runs, reusable
skills, scoped workspaces, attachments, approvals, and monitoring are durable.

The hidden General Agent is only the runtime fallback and source for a new
editable draft. It does not appear in the Agent Studio library or task picker.

## GInfer transport

- `agent_run_turn` resolves a saved definition and streams `AgentEvent` values
  over a Tauri IPC channel. Cancellation and approval resolution use separate
  commands keyed by run and approval IDs.
- `agent_list_model_instances` exposes loaded, non-embedding GInfer sessions by
  stable registered model ID without exposing ports or API keys.
- Every distinct assigned instance owns a `GinferClient`. Before work begins,
  it verifies the exact registered identity with `GET /v1/models`.
- Text and tool steps use non-streaming `POST /v1/chat/completions` with native
  OpenAI function tools and `tool_choice: "required"`. Vision uses the same
  endpoint with image content after checking the session's advertised Vision
  capability.
- Dotted internal tool names are converted to GInfer-safe function names on the
  wire and mapped back before local argument and policy validation.
- The supported reasoning efforts are `none`, `minimal`, `low`, `medium`,
  `high`, `xhigh`, and `max`. A role override wins over the definition default;
  an omitted default leaves policy to the loaded artifact. The resolved value
  is sent on main, repair, evaluator, synthesis, and Vision completions.
- A context-capacity response may invoke the existing GInfer session-expansion
  hook, after which the client revalidates the same model identity and retries
  once against the replacement session.
- Agent mode bypasses the port-1337 proxy. It has no llama.cpp `/props`,
  `/completion`, GBNF, slot, or model-profile compatibility path.

## Agent Studio orchestration

Definitions use schema version 3.

- Standard Agents use the owning thread's durable session and workspace.
- A definition may inherit the active Chat model or pin a loaded registered
  model as its default. Evaluators, synthesizers, workers, and workflow nodes
  may independently override both model and reasoning effort.
- Every distinct assignment is resolved before the first stage. An unavailable
  pinned instance fails the run without partial execution.
- Goal Loops alternate an executor with an isolated evaluator for at most eight
  cycles. The evaluator returns a leading `PASS` or actionable `REVISE` result.
- Coordinator Teams plan once, run up to eight specialists with bounded
  parallelism, and synthesize one result. Specialists use isolated writable
  workspaces and read-only source access; synthesis owns main-workspace writes.
- Workflows are validated acyclic graphs with exactly one final node. A graph
  level may run concurrently only with isolated workspaces; a shared-workspace
  node occupies its level alone.
- Parent cancellation, approval policy, and failure semantics govern all child
  stages. Concurrent siblings always publish a terminal stage status, even
  when another sibling fails or cancels.
- Only the final result is committed to the owning thread session. The latest
  100 runs retain bounded stage summaries, status, duration, resolved instance,
  model identity, reasoning effort, inference metrics, and final output.

## Performance telemetry

GInfer adds `x_ginfer` to non-streaming Chat Completions. The Agent runtime
records computed prefill tokens, completion tokens, prefill engine time, and
decode engine time for every completion, including repair and Vision work.

The live activity panel and saved-run inspector report prompt and generation
tokens per second for each resolved model instance. Aggregation is
request-weighted: tokens and engine milliseconds are summed before division.
HTTP latency is not presented as inference throughput, and missing or zero
engine timing is rendered as unavailable rather than an invented rate.

## Prompt and tool contract

- The stable prompt prefix contains persona, rules, skill and tool catalogs,
  capabilities, and execution instructions. Its ordering remains stable for
  prefix reuse.
- Frequent tools include their argument contract in the stable prefix. Rare
  tools remain one-line catalog entries until `tool.view` loads a bounded full
  descriptor into the variable tail.
- The variable tail contains loaded descriptors, loaded skills, conversation,
  an optional loop notice, workspace facts, and the response marker.
- GInfer owns native tool-call decoding. The client normalizes returned
  function calls into the executor's internal batch representation, then the
  executor performs its existing exact tool-name, argument, resource, and
  safety validation.

The execution loop is:

1. Build the prompt and native tool request.
2. Ask the assigned GInfer instance for one or more function calls.
3. Normalize and validate the returned calls.
4. Apply loop, resource-class, path, shell, and approval policy.
5. Execute independent valid calls concurrently and stateful calls serially.
6. Append bounded observations and continue until `reply`, `finish`,
   cancellation, breaker, failure, or the step limit.

Approval-gated tools cannot share a batch. A terminal tool is valid only once,
as the final call, after all preceding calls complete.

## Safety and tools

The runtime applies bounded call/step counts, resource-class validation,
repeat/no-progress/wandering detection, cancellation, request and process
timeouts, HTTP SSRF and DNS/IP checks, archive traversal guards, canonical
workspace confinement, symlink-safe path resolution, shell-command guards,
and run-scoped approvals. Hard blocks take precedence over auto-approval.
Attachments are trusted for reads only; writes outside the workspace remain
approval-gated.

The registered catalog includes tool and skill discovery, bundled skill
scripts, shell, filesystem and archives, Git, process inspection, HTTP/web,
clipboard, notifications, Vision, and the `reply` and `finish` terminals.

## Attachments

- IPC accepts at most eight attachments. Individual files are capped at 50 MiB
  and a turn at 100 MiB.
- Validated inputs are copied to
  `<thread>/agent-attachments/<turn>/` under generated names before execution.
- Durable transcripts store only a compact manifest with staged absolute paths;
  they do not persist original paths, data URLs, or base64 bytes.
- Documents, text, source, and archives stay on their dedicated tool routes.
  `vision.describe` accepts up to four staged PNG, JPEG, GIF, or WebP images.
- Image turns are rejected before staging if any assigned stage is not
  Vision-capable, and the tool repeats that check at execution time.

## Verification contract

The deterministic Rust suite requires neither a real model nor network access.
It uses a scripted local GInfer server to pin `/v1/models`, native
`/v1/chat/completions`, function-tool fields, all reasoning levels, exact timing
normalization, prompt transitions, event ordering, batching, approvals,
cancellation, failures, and terminal reasons. Tool contract tests execute real
filesystem, archive, Git, and safe-shell behavior in isolated workspaces.

Frontend tests pin definition migration/editing, run-event reduction, durable
stage traces, and weighted per-instance throughput. Production web builds and
the repository `make verify` target are the final source-change gates.

When adding or changing a tool, update its descriptor, wire-safe name mapping,
dispatch and resource class, shared safety policies, and focused contract
tests. Record a new ADR for a nontrivial inference, schema, orchestration, or
safety decision.
