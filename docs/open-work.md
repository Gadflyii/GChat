# Open work

Updated 2026-09-20. This is the active GChat release-acceptance list. Completed
implementation and historical measurements are not pending tasks.

- **Installed Windows acceptance:** exercise the selected release in its actual
  WebView: chat automatic/manual compaction, agent tool-boundary checkpoints,
  approvals, workspace/history continuation, and interactive Hermes launch.
  Automated coverage exists; it does not establish the installed walkthrough.
- **Physical worker pools:** exercise queueing, cancellation, disconnection, and
  concurrent workers across real paired hosts. Baseline two-host discovery,
  pairing, inference/lifecycle, native Windows vault, and platform service checks
  have already passed; see [host setup](lan-host-setup.md).
- **Release assembly:** confirm the selected engine runtime and accepted catalogs
  in final platform bundles, then validate the installed result. Local Windows
  2.0.42 installers exist; their presence does not qualify subsequent source edits.
  Per-SKU model and TP qualification requires exact artifacts and available hardware;
  see [profile evidence](model-profile-evidence.md). Do not relabel older measurements
  as qualification of a new engine.
- **G.bench live lifecycle:** exercise installed community-client signed publication,
  receipt-based deletion, lost-response retry, and concurrent replay/rollback with
  designated test results. Official signed publication and readback of 12 reference
  series / 36 points have passed. Preserve those reference results and receipts.
- **Frontend bundle size:** the production build reports chunks above 500 kB,
  including syntax grammars and the main application bundle. Review loading and
  splitting with measurements; do not hide the advisory by raising its threshold.
- **Performance evidence:** idle and long-chat UI performance has not been measured.
  Profile a concrete issue before proposing further rendering changes.

Chat and native-agent compaction are implemented. Chat checkpoints older complete
turns, preserving the transcript; a single oversized turn cannot be compacted that
way. Native agents checkpoint completed tool exchanges, including within a task,
and preserve full transcript/artifact history. Manual `/compact` and the worker
Compact control use their respective context managers.

The website source lives separately in the Sectile Web `site/gbench` directory,
outside this repository. Its deployment and private configuration are not covered
by a GChat Git push. Official reference imports and current board behavior are
recorded in the [reference-results decision](decisions/2026-09-19-official-reference-results.md).

Use [critical-flow verification](testing-critical-flows.md) for the automated gate.
Do not treat this list as authorization to replace running engines, delete user
state, republish results, or begin a hardware qualification campaign.
