# GChat usability and brand alignment

Status: implemented and automated verification passed. Work stays in GChat; no
inference-engine changes or signing-account setup. No new runtime dependencies.
Commit/push only when requested.

## Outcome

Make existing capabilities understandable and coherent for general users: select a
workspace and model, start a valid task, see progress and approvals anywhere, review
results, and carry useful knowledge forward without silently replaying side effects.

## Ordered delivery

1. Local/LAN memory parity and role preflight: ready, busy, offline, incompatible,
   unknown capability; bounded recall and native dispatch remain authoritative.
2. App-wide activity/approval visibility, clear disconnection status, shared capacity
   refresh with deduplicated requests and visibility-aware polling.
3. Shared workspace picker with resolved default, recent folders, open-folder action,
   instruction preview; group existing navigation without removing destinations.
4. Result-first run history with outputs and file access. Continuation must explicitly
   carry prior outcomes into a new approved run, never masquerade as exact execution
   resume or automatically replay completed tools.
5. Brand mapping: Geist 400/500/600, mono tabular figures, semantic status palette,
   responsive existing product lockups, consistent controls and light/dark surfaces.
6. Performance: unchanged fleet snapshots do not republish providers; narrower monitor
   subscriptions, lazy detail serialization, bounded/paged histories. Preserve chat
   scrolling/selection and background terminal execution.
7. Memory: observable recalled-entry provenance and user-reviewed Remember this.
8. Focused regressions and full verification; assess Windows layouts, keyboard access,
   theme contrast and realistic long-run behavior. Report unavailable physical checks.

## Brand authority

Source: `/ai/ginfer-tools/brand-kit`, generated 2026-09-08. Map its values into
GChat semantic tokens; do not import conflicting CSS globals or Google Fonts.
Keep self-hosted Geist and existing GChat product artwork. Company text is Sectile
Research Laboratories. Preserve distinct warning/error semantics.

Kit ambiguities: README and guide disagree on clearspace; raster light/dark filename
descriptions are reversed. Do not edit the external kit or invent replacement product
marks. Use visually verified assets, preserve their aspect ratios, and avoid clipped
lockups while those authoritative rules are reconciled.

## Completion evidence

Cover memory provider parity, capability preflight and queuing, concurrent approvals
away from Runs, workspace selection/defaults, retained results and non-replaying
continuation, memory provenance, polling deduplication and unchanged-state behavior.
Run `make verify`; do not claim performance gains or Windows visual qualification
without the corresponding measurements or actual inspection.

## Delivered behavior and validation limits

- Local and paired GInfer chat use the same personal-memory eligibility policy.
- Role preflight separates compatible busy assignments from offline, incompatible,
  and unknown capability. Workspace resolution also gates Run. Native dispatch
  still rechecks live capacity; preflight is not a reservation.
- App-wide Studio activity exposes approval handling away from Runs. Capacity polling
  is shared, visibility-aware and deduplicated. Refresh failures retain last-known
  data visibly instead of repeatedly toasting or silently disappearing.
- Workspace selection provides browsing, recent selections, resolved paths, Open
  folder and AGENTS.md preview. Navigation groups existing destinations into Work,
  Resources and Diagnostics.
- Run records retain workspace/output folders. A result overview provides file access
  and explicit Continue as new run. Its editable prompt is bounded below the agent
  session's user-text limit and includes prior findings and output locations.
- Message memory saves require user review and retain origin identifiers; chat exposes
  its last recall snapshot. Memory lists render in batches of 50.
- Individual live runs subscribe independently, collapsed event JSON is rendered only
  when expanded, and unchanged fleet projections are not republished. Existing bounded
  run history, chat scrolling and terminal execution remain intact.
- Compact sidebar branding uses the existing G icon with readable product/company text;
  full artwork remains on larger surfaces. Header layout can grow rather than cover
  navigation. Status colors, mono figures, font weights and backgrounds follow the kit.
- `CARGO_INCREMENTAL=0 make verify` and `git diff --check` pass. New status foregrounds
  exceed 4.5:1 against their respective paper/ink canvas colors; this does not certify
  all component/background combinations or the entire app's accessibility.

No browser automation package/browser executable is installed in this WSL environment.
A real Windows installer/WebView walkthrough and idle/long-chat performance profiling
remain manual validation. No measured FPS, latency or memory-use improvement is claimed.
Chat virtualization and hidden-terminal rendering changes are not introduced without
profiling evidence; the implemented reductions target demonstrated duplicate work.
