# Critical-flow verification

Run the smallest check that answers the change's question, once. Reuse passing
evidence when its source and scope still apply. Documentation needs diff review;
tools need their affected cases; UI changes need the affected component behavior
and relevant lint/types. Native changes need the owning fixture and build checks.
Reserve full `make verify` and platform release walkthroughs for a scheduled
release gate. Repeat a check only after a relevant change or inconclusive result.
A mock or loopback pass does not establish installed-app or physical GPU behavior.

| Flow | Evidence and scope |
| --- | --- |
| Chat context and streaming | `web-app/src/lib/__tests__/smart-context.test.ts` and `custom-chat-transport.harness.test.ts`: context planning and observable transport behavior |
| Native agent execution | `src-tauri/src/core/agent/`: context, runner, orchestration, dispatch, and worker-pool tests; tools and approval state survive checkpoints |
| Benchmark publishing | `web-app/src/services/benchmark/leaderboard.test.ts` and native `benchmark_submission` tests: public field contract, reserved nicknames, signing input |
| Host lifecycle and pairing | `src-tauri/ginfer-host/` suites and desktop registry tests: identity, credentials, dispatch, and owned process lifecycle |
| Host packaging/installation | `tests/test_ginfer_host_package.py`, `test_ginfer_host_install.py`, `test_ginfer_linux_setup.py`, and Windows PowerShell counterparts |
| Profile/launcher integration | `tests/test_ginfer_launcher.py`, `test_ginfer_host_bootstrap.py`, and opt-in `test_ginfer_profile_live.py` |

Recorded real-host checks include WSL5090/WSL4090 discovery, pinned pairing,
load/generation/reload/stop, Windows desktop-to-LAN routing and native credential
storage, and Windows SCM/Linux systemd installation. See
[host setup](lan-host-setup.md) for scope and limitations.

The separately hosted G.bench source has PHP contract/signature tests, a DOM board
regression test, and an offline reference importer. Live signed official publication
and readback passed for 12 series / 36 points. The current board was browser-checked
for wordmarks, independent generic filters, all-concurrency rows, and throughput
columns. A separate disposable community submission passed publish/read/delete;
the app delete control is merged as `a4bebb2e1`. Retry/replay/fault acceptance
remains separate. Never use the official reference series as test fixtures.

Current outstanding physical and release checks belong in [open work](open-work.md).
Keep tests focused on supported behavior; retired llama.cpp/MLX paths are not GChat
coverage gaps. Do not add source-string tests to enforce implementation structure.
