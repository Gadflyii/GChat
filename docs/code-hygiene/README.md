# GChat bug fixes and code hygiene

Repository: GChat. Owner: GChat coordinator. Current baseline: main `104d4ec6e`;
installed desktop source `a40d7221`, Manager `ce6a6c0e6`, engine `2ef56a52a`.
Windows portability is merged in GInfer `634a16e16`; native build, installation,
local picker and data preservation pass. Ordinary Chat completion remains blocked
by the excessive shared tool payload, tracked as OI-091 in the installed baseline; its reviewed fix is now composed with the other
candidates. See
[installer acceptance](../installer-refresh/README.md).

Ron authorized parallel remediation of remaining GChat issues and a broad review
once Windows merged. This replaces the older review brief's waiting condition.
The sole issue authority remains [the master list](../open-work.md); this folder
records the current implementation, verification and owned disk lifecycle.

## Deliverable and acceptance

Fix the shared tool payload and incomplete agent outcomes; produce coherent
current profile candidates with honest qualification, and refresh frontend/Linux
packages after integration. Review Host, Manager and affected client paths for
proven dead/redundant code, current comments, unnecessary work and CPU/RAM costs.
Preserve capabilities, permissions, cancellation, context semantics, user data,
host identity and supported protocols. Do not reduce requested context/concurrency,
raise warning thresholds or claim qualification from source tests.

Each change needs focused behavioral evidence. Run full `make verify` once on the
composed candidate when source winners are ready; inspect actual installed Chat
completion/continued Chat and relevant lifecycle behavior after the next app build.
Keep behavior-identical cleanup separate from measured performance changes.
Server 2 administration, dependency upgrades and unrelated Engine speed work are
excluded. Real fleet/tray/publication acceptance retains its actual prerequisites.

Implementation evidence: [quality review](gchat-quality.md) and
[remaining acceptance](../agent-runtime/remaining-acceptance.md).
The integration candidate contains OI-067 `05e9e8760`, OI-091 `447137298`,
OI-074/OI-096 `21bbc284f`, OI-072 `6dc94493c` and OI-092–095 `24af05967`.
Focused gates pass; next action is the composed full gate, then native acceptance.

## Current allocation

| Item | Owner | Candidate path / branch | Next unresolved action |
| --- | --- | --- | --- |
| Shared compact tool discovery, schema and invocation | bridge_review | `/ai/gchat-worktrees/oi091-lazy-tools`, `dev/oi091-lazy-tools` | Focused SDK/native/Code regressions, then installed Chat |
| Agent overall outcomes and history | agent_outcomes | `/ai/gchat-worktrees/oi067-agent-outcomes`, `dev/oi067-agent-outcomes-104d4ec6` | Limiting stage outcomes survive synthesis/persistence/UI |
| Current profile candidates | profile_current_engine | `/ai/gchat-worktrees/oi072-current-profiles`, `dev/oi072-current-profiles-104d4ec6`; separate GInfer catalog candidate | Exact prefix-enabled public C4/128K evidence, no historical promotion |
| Frontend loading and Linux refresh | frontend_packages | `/ai/gchat-worktrees/oi074-frontend-packages`, `dev/oi074-frontend-packages-104d4ec6` | Bundle/load evidence, offline grammar/locale/terminal checks |
| Quality and CPU/RAM changes | gchat_code_review | `/ai/gchat-worktrees/review-quality-104d4ec6`, `review/gchat-quality-104d4ec6` | Focus retention, parallel snapshots, unchanged persistence/pinned pools |
| Remaining acceptance prerequisites | remaining_acceptance | `/ai/gchat-worktrees/remaining-acceptance`, `dev/gchat-remaining-acceptance-104d4ec6` | Use saved evidence; prepare independent checks and actual blockers |
| Source composition and final gate | coordinator | `/ai/gchat-worktrees/remediation-integration`, `dev/gchat-remediation-104d4ec6` | Integrate reviewed winners and verify affected contracts |

## Evidence and disk ownership

The installed apps run normally without test debug ports. Original saved Muse
profile is restored exactly and stopped with zero native engines. Seven original
thread IDs, model files, settings, local owner, runs and Host certificate survive.
Evidence: `/ai/gchat/out/oi056-current-engine/normal-final-state.json` and
`installed-verification-current.json`. GPU/build guards and booking were released.

Retain current native caches/builds and canonical installers under
`%LOCALAPPDATA%/GChat/windows-build/source`, `%LOCALAPPDATA%/GChat/release-output`
and `%LOCALAPPDATA%/GInfer/gchat-oi056-f9af4`, plus concise acceptance evidence.
The clean, merged OI-056 trees `/ai/gchat-worktrees/oi056-current-engine`
and `/ai/ginfer-worktrees/gchat-oi056-engine` are retired with no-force worktree
removal. Exact current installers/checksums are promoted to `/ai/gchat/out/windows`.
Net reclaimed allocation is 2,478,735,360 bytes (2.479 GB); shared-filesystem free
deltas are not attributed to this cleanup. Branch objects and remote source remain. Active candidates, other owners' trees, user models,
profiles, saved results and Tessera paths remain. Cleanup receipts and freed bytes
are recorded under `/ai/gchat/out/oi056-current-engine/`; unchecked/shared paths
are listed rather than deleted.

Current actual Windows idle evidence is
`/ai/gchat/out/remaining-acceptance-20261009/idle-sample.json`: a 30.09-second
sample with visible apps and zero model processes. Aggregated one-core CPU was
3.84% GChat, 0.363% Manager and 0.208% Host. Summed working sets can double-count
shared pages; the sample does not establish long-conversation rendering cost.
