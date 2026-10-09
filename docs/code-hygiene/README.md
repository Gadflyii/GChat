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
Server 2 administration and unrelated Engine speed work are excluded. Ron approved
controlled dependency alignment on October 9 for the actual React, TypeScript and
Vitest peer conflicts (OI-105). Preserve runtime and test workflows; do not silence
conflicts by widening peer ranges. Real fleet/tray/publication acceptance retains
its actual prerequisites. Other dependency upgrades remain excluded.

OI-105 uses the owned frontend/package tree based on accepted source `0a4e2b56c`.
Select React/DOM 19.2.8, compatible with the unchanged AI SDK's represented React
peer range; TypeScript ESLint 8.44.1 supports the retained TypeScript 5.9.2 and
ESLint 9.25.1. Match the extension Vitest UI to its existing 3.2.4 runner, preserving
`test:ui`. Remove unused interfaces and three Webpack-only loader declarations.
Core's sole React source reference is the public MCP `ComponentType` type: retain
that API and its existing type tooling, remove the inaccurate runtime React peer
and unused development runtime. Do not broaden peers, suppress warnings, replace
the SDK or add React to non-React extensions. The offline caches lack these new
React/parser/UI versions; only this alignment's represented packages may be fetched.
Install into owned dependency/install-state directories, then verify real peer
graphs, affected tests/typechecks, UI serving and production output. Root owns
integration, final source verification and native assembly; no shared main or
Windows dependency directory is changed by this work.

The aligned candidate passes core package/type generation, all 2,092 frontend/core
checks (six skipped), 102 GInfer and 18 download extension tests, frontend lint and
TypeScript checks. The actual extension `test:ui --watch` serves its JS/CSS assets
and passes all 102 tests; watch mode is explicit because the first fixture inherited
run mode and exited before HTTP acceptance. The corrected fixture stops only its
owned process group. Offline immutable installs succeed against both lockfiles.
Unused router devtools and its two commented references are removed; no supported
workflow imports it. All project-owned peers pass; three unmet peers remain inside
`@streamdown/cjk` 1.0.2 / remark-cjk-friendly 1.2.3: the wrapper omits `unified`, and
the two remark packages omit `micromark`. Adding application dependencies cannot
supply an external parent's peers; published newer wrappers retain these metadata
faults. Retain the supported CJK behavior and report this external blocker without
an adapter redesign or peer suppression.

The approved 25.8-second production check ended at 19:23:34Z on October 9 with no
build warning. Entry JS is 482,388 B; the largest JS chunk is deferred Mermaid at
499,377 B. The complete 14-file static startup closure is 2,146,064 B; terminal,
emoji, Mermaid and the code highlighter remain deferred, with zero static cycles.
All 250 grammar JSON assets and the 466,610 B WASM are emitted. A native Edge
fixture with observed `--disable-gpu` arguments loads Russian locale, JSON/C++/
Emacs Lisp syntax, Streamdown code and Mermaid from these emitted assets with zero
external resource requests. It verifies offline asset behavior, not installed
startup speed. The disposable profile (16.86 MB) is removed after confirming zero
owned browser processes; its local server is stopped. Root still owns final native
integration and acceptance.

Retain `out/oi105-dependency-alignment/` receipts/logs (under 1 MB), the owned core
package and production bundle, and owned dependency state (about 1.8 GB) until
integration. Shared main/native dependencies are untouched. The earlier OI-070
assembly plan must use the aligned accepted graph before execution; it has produced
no Linux installer. No GPU or native build was run for OI-105.

Implementation evidence: [quality review](gchat-quality.md) and
[remaining acceptance](../agent-runtime/remaining-acceptance.md).
The integration candidate contains OI-067 `05e9e8760`, OI-091 `447137298`,
OI-074/OI-096 `21bbc284f`, OI-072 `6dc94493c` and OI-092–095 `24af05967`.
Full composed `make verify` on `880ecb5c9` passes: 2,092 frontend tests,
102 extension tests, all six coverage floors, 553 desktop Rust tests and all
platform-supported suites. Host/Manager strict Clippy passes. The earlier
mock-only assertion, stale build-script path and three compact-dispatch compile
errors are corrected. The author's earlier 306-test run used main and is not
candidate evidence. OI-101 history reuse preserves 100 fixture inputs while
reducing transformations from 50,100 to 600; no native CPU gain is claimed.

OI-100 now moves startup HTTP outside process ownership. Its actual owning gate
passes check, strict Clippy and 86 Host tests, including delayed health/model
responses during Stop and Reload. Supporting Clippy warnings are corrected in
utilities, hardware, RAG/vector DB and compact dispatch. GInfer launch ownership
uses a named request consistently in desktop, CLI, guest bindings and extension;
explicit embedding rejection and defaults remain. The final composed frontend
gate passes 2,092 tests, 102 extension tests and all six coverage floors. The
resumed Rust gate passes 553 desktop tests, 86 Host tests, six managed-adapter
tests, 12 hardware tests and 29 utility tests. Desktop, Host and Manager strict
Clippy and the supported CLI compile pass at source `01d3b05b5`.

Composition found two Code/managed-adapter fixtures still calling the removed
process-owned refresh. Both now call Host refresh outside the process mutex;
future ownership changes require scanning all workspace callers. Two nested
SQLite probe conditions are corrected without changing short-circuit behavior.
The first CLI check incorrectly disabled required default desktop features; the
supported `cargo check --features cli --bin gchat-cli` passes. These checks are
recorded in `out/code-hygiene-20261009/integration/`; no native acceptance is
claimed from them.

Timed competitors have completed. Root reservations cover 17:52–19:30Z for
verification/build and 19:30–20:30Z for installed acceptance on October 9. Both
canonical guards protect compilation and model execution. Windows source
`0a4e2b56c` built successfully and its packages passed verification. Removing the
ignored Vite option preserved all 832 frontend files exactly. Manager source
`43c8d71cf` is reused with explicit producer provenance; its inputs are unchanged.
C4 has a finite 19:17–19:21Z postmerge smoke slot. After its actual end, update
the local apps and verify installed Chat completion and the current Muse profile
separately. Integrate the approved dependency fix after its focused checks, then
refresh the affected package; do not conflate that later build with this one.

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
| Hardware plugin Clippy corrections | shared_tools_review | `/ai/gchat-worktrees/review-hardware-880ecb5c`, `review/gchat-hardware-880ecb5c` | Source and focused checks complete; coordinator integration/full gate pending |

The supporting hardware candidate addresses the four hardware warnings in
`out/code-hygiene-20261009/integration/composed-clippy-desktop.log`: CPU default
construction delegates to the existing probe, AMD retains the same error text,
and NVIDIA UUID prefix removal retains the same exact output. The NVML Ready
state owns its handle in a box; closures still borrow it while the existing read
or write guard is held, and invalidation drops it under the write guard. This
changes the enum's inline storage, not the initialization/failure cache or driver
call schedule. No native performance claim is made.

Hardware source `9067b7af69c51917711fc9271f36dde9dac02ba5` passed crate
`cargo check`, `cargo clippy -- -D warnings` and all 12 existing hardware tests
(zero failures/ignored). Each command used `--locked --offline --manifest-path
plugins/tauri-plugin-hardware/Cargo.toml` from the candidate's `src-tauri/`.
The coordinator-admitted 300-second job held the canonical build then GPU locks,
used the shared `/ai/gchat/src-tauri/target` with six Cargo jobs and exited 0;
both job-owned guards are released. Retain the three check logs in
`/ai/gchat/out/code-hygiene-20261009/hardware-review/` (16 KiB) and this clean
source candidate (265 MiB) until integration. No candidate-local build,
dependency copy, driver change or model execution was allocated. The coordinator
owns the composed full gate and retirement of the reviewed worktree.

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
Net reclaimed allocation is 2,478,735,360 bytes (2.479 GB), plus 4,096 bytes from
the unregistered generated-only `compact-everywhere` directory after verifying
it held no source, profile objects or writer. Shared-filesystem free
deltas are not attributed to this cleanup. Branch objects and remote source remain. Active candidates, other owners' trees, user models,
profiles, saved results and Tessera paths remain. Cleanup receipts and freed bytes
are recorded under `/ai/gchat/out/oi056-current-engine/`; unchecked/shared paths
are listed rather than deleted.

Current actual Windows idle evidence is
`/ai/gchat/out/remaining-acceptance-20261009/idle-sample.json`: a 30.09-second
sample with visible apps and zero model processes. Aggregated one-core CPU was
3.84% GChat, 0.363% Manager and 0.208% Host. Summed working sets can double-count
shared pages; the sample does not establish long-conversation rendering cost.
