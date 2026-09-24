# Open work

Updated 2026-09-24. This is the active GChat release-acceptance list. Completed
implementation and historical measurements are not pending tasks.

- **Installed Windows acceptance:** exercise the selected release in its actual
  WebView, including the Muse 131072/C4 first-question case: the context meter
  should show exact rendered-request usage (including instructions and tools),
  oversized current-turn tool results should be summarized for the request while
  their transcript and tool-call IDs remain intact, and context exhaustion should
  direct the user to change the host profile or shorten the request without an
  automatic process reload. Also check older-turn/manual compaction, agent
  tool-boundary checkpoints, approvals, workspace/history continuation, and
  interactive Hermes launch. Source edits and automated coverage do not establish
  the installed walkthrough.
- **Physical worker pools:** exercise queueing, cancellation, disconnection, and
  concurrent workers across real paired hosts. Baseline two-host discovery,
  pairing, inference/lifecycle, native Windows vault, and platform service checks
  have already passed; see [host setup](lan-host-setup.md).
- **Release assembly:** confirm the selected engine runtime and accepted catalogs
  in final platform bundles, then validate the installed result. Local Windows
  2.0.42 installers exist; their presence does not qualify subsequent source edits.
  The Linux 2.0.42 AppImage now builds against Ubuntu 24.04 and has been installed
  and visually checked on Server 2 under X11. This establishes desktop startup,
  not a new engine/model qualification matrix.
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

Chat counts the exact rendered GInfer request before admission and reports that
usage against the running context capacity when available. Automatic chat
compaction checkpoints older complete turns in the wire request and preserves the
stored transcript. If the current turn alone is too large, oversized tool results
are summarized in bounded chunks for that request; original transcript messages
and tool-call IDs remain intact. GInfer capacity is startup-fixed, so an
unadmittable request reports that the user must select a larger host profile or
reduce the request; GChat does not automatically grow and reload the process.
Native agents checkpoint completed tool exchanges, including within a task, and
preserve full transcript/artifact history. Manual `/compact` and the worker
Compact control use their respective context managers. The Windows case above
remains pending installed acceptance until the updated release is rebuilt and
walked through.

The website source lives separately in the Sectile Web `site/gbench` directory,
outside this repository. Its deployment and private configuration are not covered
by a GChat Git push. Official reference imports and current board behavior are
recorded in the [reference-results decision](decisions/2026-09-19-official-reference-results.md).

Use [critical-flow verification](testing-critical-flows.md) for the automated gate.
Do not treat this list as authorization to replace running engines, delete user
state, republish results, or begin a hardware qualification campaign.
