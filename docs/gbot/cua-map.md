# Gbot component ownership with Cua

Ron selected Cua as Gbot's computer-agent framework on October 12. His follow-up
keeps our VM provisioning, especially Hyper-V and M365 Cloud PC. This map is the
current integration plan; it supersedes the custom Gbot-loop plan in the
[design](README.md). Implementation status and physical gates are recorded below
and in the [current record](README.md#current-record-and-inventory).

## Source and selection

Use only [Gadflyii/cua][fork] at
`0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc`. Driver release is
`cua-driver-rs-v0.34.1`; Python `cua-agent` is **0.9.0** at this revision.
These are different version numbers. Do not follow fork main or floating images.
No upstream pushes, PRs or issues are authorized.

- **ADOPT:** use the pinned Cua component and its supported contract.
- **WRAP:** Cua owns the mechanism; GChat supplies a product boundary or a narrow
  integration. This does not authorize another executor or computer framework.
- **KEEP:** retain a GChat-owned capability required by our product contract.

Source inspection establishes the interfaces below, not physical qualification.
Current prototype evidence and retained paths are in the [design record](README.md#current-record-and-inventory).

## Component map

| Gbot component | Choice | Selected implementation and reason |
| --- | --- | --- |
| Local VM lifecycle and provisioning | **KEEP** | Our libvirt **session** KVM adapter, owned disks, Debian 13 cloud-init and slirp/loopback SSH on Linux; Hyper-V on Windows. Ron explicitly retained this design. Cua SDK QEMU/OCI/Lume sandboxes exist, but replacing our VM owner would add a second lifecycle and does not establish Hyper-V support. |
| Cloud bot computer | **KEEP** | Our cloud-init and provider attachment/provisioning boundary: Hetzner/DigitalOcean, guided Azure/AWS/GCP, live cost confirmation. Cua's managed Fleet is a different hosting product; it is not our user-rented provider integration. No Cua account or relay for LAN. |
| Windows guest and M365 Cloud PC connection | **KEEP** | Hyper-V guest setup and the selected Windows 365 connection/session/view route remain GChat work. Adopt Driver's Windows control inside the bot session; do not claim that the SDK or viewer supplies a Windows 365 connector. |
| Guest desktop image | **KEEP**, borrow Cua settings | Keep Debian 13 + localhost-only Xvnc + XFCE and its session environment. Borrow relevant packages/settings from `libs/xfce-cua`; do not replace it with the container image or older Spaces image. |
| Computer-agent loop | **WRAP** | `cua_agent.ComputerAgent` owns model/action iteration, tool dispatch and event callbacks. The Gbot service hosts it and journals state; retire the Gbot-specific model/tool iteration once the Cua route passes. Leave ordinary Chat/Studio/Code execution unchanged. |
| GInfer model provider | **WRAP** | Assigned OpenAI-compatible endpoint/key/model supplied by GChat. Cua accepts `api_base`/`api_key`, but its generic VLM loop injects screenshots. The merged function-tool provider supplies the tested text-only AT-SPI route; exact desktop and two Cua evaluator receipts pass. |
| Desktop capture, input and accessibility | **ADOPT** | Pinned Cua Driver over persistent stdio MCP/SSH, with the selected desktop environment. AT-SPI observations plus foreground native input for modal controls. No GChat accessibility implementation. The reviewed fork handles owned popup input and nested modal observations; accepted exact desktop evidence covers both. |
| Driver skills | **ADOPT** | Import the pinned skill bundle (`SKILL.md`, `LINUX`, `WINDOWS`, `MACOS`, `BROWSER`, `WORKFLOW`, `VISUAL`, `RUNTIME`) through shared skill discovery, with notices, platform selection and source/version metadata. Keep session/target semantics; adapt modal activation to native input. No independently evolving computer-use skill. |
| Computer tool schemas and dispatch | **WRAP** | Expose Driver MCP tools as Cua function tools through the existing vault/session transport. Tool calls go through GChat approvals and operation receipts before execution. Preserve raw MCP replies in the task log; model-facing accessibility output has one elements representation. |
| Browser tools | **ADOPT** Driver, **WRAP** exposure | Gbot exposes the pinned Driver's typed browser catalog and preserves its schemas and arguments through the existing approval/session/receipt path. Cua owns exact page binding, navigation, refs, dialogs and files/downloads; no GChat browser engine. `PythonBrowserTool`'s legacy Playwright endpoint is excluded. Source fixture and remaining Chromium guest gate are described below. |
| Human requests | **KEEP** GChat requests, borrow Cua's request/completion shape | `human_tool` is a human model-completion provider, not desktop takeover or approval. Borrow request IDs, pending/completed/failed outcomes and separate text/tool-call replies. Bind any future assistance request to the existing bot/task journal and channel; do not import its in-memory FastAPI/Gradio server. |
| Desktop viewer and media | **WRAP** Cua media core when its guest endpoint is available; **KEEP** SSH/VNC now | Cua's `MediaSession` canvas core is the narrow integration candidate. The full HTML5 viewer requires Spaces RPC/media services and additional JS dependencies, permits input by default and forbids iframe embedding. No source or latency evidence establishes a better replacement for our current VNC transport. Native `cua-viewer` lacks Linux support and supplies no M365 broker connection. |
| Take over / Hand back | **KEEP** authority, **WRAP** Cua media input | GChat must own a durable exclusive input grant for the selected session, drain/cancel bot input, and revoke human media access before hand-back. Cua `VIEW_ONLY`, scoped tickets and `CloseMedia` provide mechanisms to wrap; neither `human_tool`, presence cursors nor an interactive viewer session supplies that authority. |
| Evaluation | **ADOPT** tasks/verifiers, **WRAP** guest session | Use `cua-bench` task definitions, rewards and ATIF trajectories. Bind its session operations to our existing dedicated guest; stock `cb run` defaults to container/managed infrastructure and is not a libvirt/SSH adapter. No new benchmark framework. |
| Terminal recording | **ADOPT** `tools/cli-cast` for development | Real PTY → asciinema v2 casts for Code input/render evidence and guest CLI traces. Its transcript-parser goldens are currently Claude Code-oriented; OpenCode semantic parsing is unqualified. Recording is not permission to replay commands or use a user's history. |
| GChat UI, sessions and per-bot channel | **KEEP** | Setup, status, shared history, result rendering, connector selection and multiple bot identities belong to GChat. No second Cua Spaces app or Gradio product UI. |
| Local-first service and durable state | **KEEP** | Bot/task IDs, schedules, receipt journal, working memory and sleep/restart recovery stay in the service. Cua callback history is not a crash-resume journal. Host Cua execution without adding another autonomous loop. |
| Native vault and SSH credentials | **KEEP** | Existing native-vault references and russh sessions; credentials stay out of task transcripts, casts and guest image. Pass keys/endpoints to the execution boundary only for their lifetime. No Cua account vault or credential mirror. |
| Approvals and shared capabilities | **KEEP** | Shared definitions, skills, tools and connector adapters keep GChat policy and folder grants. Cua execution invokes those adapters. Per-bot connector accounts are explicit, never inherited from the human's session. |
| GInfer assignment and compaction | **KEEP** | Host/work-pool selection and shared compaction remain GChat-owned. Cua receives the selected endpoint and a compacted working history. Do not invent model limits or change sampling on reconnect. |
| Arbitor extension hooks | **KEEP** | Policy-before-action, audit events and usage/cost observations remain extension boundaries. No paid policy/rules/cost product in GChat. FSL components remain excluded from Arbitor pending Ron's review. |

## What the pin actually supplies

### Guest setup

[`xfce-cua`][xfce] supplies useful XFCE/Xvnc, accessibility, session-D-Bus,
Firefox ESR and display settings. Its Dockerfile is based on Debian Bookworm,
not our Debian 13 guest. Its exposed VNC/noVNC ports, container supervision and
passwordless-sudo user are not our guest contract. Retain SSH-only external
reachability, localhost viewing, our session environment file and cloud-init.
The older `libs/xfce` launches Spaces services and is not the chosen image.

Borrowing package lists does not fix the proven modal DoAction deadlock. Our
image dependency correction is already merged; further package additions need
an identified application prerequisite.

### Typed browser adoption

Queue item 4 uses Driver fork `c549ab4d7` on SDK base `0c69d9a2c8`.
The saved editor/file evidence establishes the persistent MCP transport, but
does not establish browser execution. Source inspection found an actual
integration gap: `ssh/native.rs` removed all browser tools from `tools/list`
and refused their page arguments. The candidate now preserves these nine exact
Driver definitions: `get_browser_state`, `browser_prepare`, `browser_navigate`,
`browser_click`, `browser_type`, `browser_dialog`, `browser_set_input_files`,
`browser_download` and `browser_pointer`. Browser calls bypass the native
geometry adapter; mutations invalidate its cached native observation.
`get_browser_state` uses `DesktopCapture`; the other tools use `DesktopInput`.
Native modal activation remains foreground-only.

The callable path is `WorkspaceRuntime::desktop_tools` (also
`POST /v1/desktop/tools`) → the returned Driver definition mapped to
`FunctionTool` with `ToolBinding::Desktop { name }` → `CuaTask` approval →
`SshSession::guest_request` → the same persistent Driver MCP `tools/call`.
The existing editor example selects a native-only subset; a browser task must
select the advertised browser tools too. The service overwrites the caller's
`session`, renews it before each call and records the raw result in the existing
operation receipt. Reconnect does not restore old page capabilities; obtain a
fresh binding and snapshot rather than replaying an uncertain action.

The bundled Gbot skill now distinguishes native input from typed page actions
and directs the agent to the existing `BROWSER.md`. For an authorized isolated
browser, call `browser_prepare` with `allow_launch:true` and
`profile:{mode:"isolated_new"}`. Use its `prepared_pid` with `list_windows`,
bind the returned exact window using `get_browser_state`, require
`status:"ok"`, `binding_quality:"exact"`, `mutation_allowed:true`, then use
returned target/tab IDs. Navigate, read `semantic_v2` with
`include_screenshot:false`, act once using a fresh page ref, and read again to
verify the requested postcondition. Native permission prompts and explicit
GUI-only tasks retain the native route.

The focused source fixture
`ssh::native::tests::browser_catalog_and_actions_preserve_driver_capabilities`
checks catalog/schema preservation, preparation/binding/navigation/input
argument passthrough, capability classification, preservation of semantic
outline/refs/actions in the model projection and invalidation of native tokens.
The focused fixture passes in the shared cached check. It does not claim a
physical Chromium browser result.

The next physical gate is one harmless local-page task on the dedicated bot
guest: a supported package-owned Chromium installation, Driver-owned isolated
profile, text-only navigation/form/button interaction and an independent page
postcondition. The existing `GuestBootstrap::browser_package` is the package
selection seam. Firefox ESR cannot serve this pin's page route: Gecko binding
requires unsupported launch-time BiDi setup. No package install, live guest,
model task, browser framework or dependency was added by the browser source
work. `cua-bench`'s `click-button` evaluator still needs its distinct
`launch_window`/`execute_javascript` session mapping before it can be claimed.

### Cua loop and GInfer

[`ComputerAgent`][agent] accepts function tools, callbacks and `custom_loop`.
It forwards endpoint/key settings to the chosen provider. Its default
[`generic_vlm`][generic] path takes a screenshot when none is present and uses
Qwen-VL preprocessing dependencies. The Qwen 3.5 loop also injects images.
Neither is a text-only Qwen 3.8 provider simply because `api_base` is supported.

The [`OpenAI`][openai-loop] loop contains ordinary function-call handling, but
automatic selection targets computer-use/GPT models, and it sets Responses
reasoning/truncation defaults whose GInfer compatibility is unqualified. Do not
rename Qwen as GPT or substitute a fake screenshot to select a loop.

The smallest provider integration is Cua's [`AsyncAgentConfig.predict_step`][provider]
contract supplied as `custom_loop` for GInfer function tools: ordinary
OpenAI-compatible request/response mapping, no forced screenshots and no
unsupported provider defaults. Advertise only the implemented capabilities.
Keep that provider implementation in our **Cua fork**, based on the fixed pin;
review and record the candidate revision before dependency selection changes.
GChat supplies endpoint/model
assignment and lifecycle callbacks. Cua still owns iteration and tool dispatch.
GInfer owns model templates and tool-call parsing. Vision can be selected after
the artifact/device route is qualified; text-only is the present gate.

The base Python agent closure includes `litellm==1.86.2`. Review and lock the
exact selected closure before packaging it. Do not install Qwen-VL, perception,
computer sandbox or training extras for this function-tool gate. This design
does not authorize those dependencies or a Python installation on a host.

The existing service is Rust; `ComputerAgent` is Python. Host one local Cua
child process with a private run/cancel/event channel owned by the service.
Supply only the current task's endpoint credentials and mediated tool handles;
return usage, messages and tool outcomes to the existing journal/UI. The child
owns no vault, scheduler or recovery database. On child loss, the service keeps
the task and unresolved operation receipts. This is a host-side binding, not a
new guest worker or network service. Its private IPC, event-driven task/approval API and GChat native bridge are
implemented and pass focused checks. Runtime packaging is still pending: the
accepted Python closure and shared context preparer currently require explicit
paths, rather than an installer-owned runtime.

### Durable actions and approval

Follow Driver's [typed output contract][output-format]. Action tools retain
`ActionResult` effect, delivery, evidence and escalation; diagnostic text is not
a parsing API. Accessibility observations retain one elements representation,
without duplicate text/tree output. Preserve `isError`, target/session tokens
and tool-specific structured results. Keep full MCP replies in the task log;
verify the task postcondition after an unverifiable action rather than treating
input delivery as success.

Use Cua's [`callbacks`][callbacks] for compacting before an LLM request and
recording completed steps/events. Function tools enter the existing GChat
approval/receipt owner. Run Cua with telemetry disabled; never journal callback
arguments containing endpoint secrets.

The native computer-call branch currently acknowledges pending safety checks
automatically. It must not become GChat's approval authority. For this integration,
desktop tools are functions mediated by the same permission owner as other
shared tools. Human takeover pauses dispatch and uses the same desktop/session
identity before any input.

Preserve existing operation IDs and the distinction between completed, refused
and unknown outcomes. Restart reconstructs working history from the journal;
unknown external actions await reconciliation rather than being automatically
repeated. A Cua trajectory is useful evidence, not a substitute for this state.

### Existing modal and popup failures

Source `66093dd03`, merged in main `c6a42ad77`, switches modal activation from
AT-SPI DoAction to geometry-only native input. The S1 retry on October 12 typed
the line and opened File while AT-SPI remained responsive, then stopped at
the menu popup: target window `23069012` was not active top-level `23068675`.
No `hello.txt` was saved. Engine stop completed at **03:43:45Z**; the private
guest, key, GPU guards and bookings were released.

Cua's [Linux foreground guard][foreground] waits for the target to become the
active window. Override-redirect menus do not do that. Replacing the agent loop
still invokes this driver; it does not establish that the guard gap disappears.
The unverified service-side popup ownership patch is parked and is not part of
this proposal's accepted implementation. If the adopted Driver path retains
the failure, fix it in our Cua fork: resolve an owned transient/popup to its
active top-level for native coordinate input, while refusing foreign windows.
Keep the existing modal input rule; do not restore DoAction fallback or loosen
the foreground guard globally.

Evidence: S1 `/ai/gbot-vms/cua-service-20261011/gate-native-activation/`, including
`tool-8-call_9e1fdde4c618d887.json`, `tool-9-call_c1c4df8d3465a799.json` and
`model-stop.json`. This is a partial functional result, not a benchmark PASS.

### Viewer and license boundary

Queue items 5/7 have a source-level decision. The approved outcome is a usable
takeover/viewer integration or its smallest concrete boundary, without new
dependencies or a new live campaign. The source review used
`/ai/gchat-worktrees/cua-gbot-pin-0c69` at Driver fork `c549ab4d7` (SDK base
`0c69d9a2c8`) against GChat
`/ai/gchat-worktrees/gbot-cua-skill-918c` at `9ab394244`. No new desktop, model,
VM or latency run was needed to answer the interface question.

#### Human assistance is separate from desktop ownership

[`CompletionQueue`][human-queue] stores UUID-keyed pending/completed/failed
requests in memory. A reply can contain text or proposed function calls.
[`HumanAdapter`][human-adapter] uses that queue as a LiteLLM model provider;
it does not pause another agent, drain Driver input or grant a desktop lease.
Importing `cua_agent.human_tool` also imports its Gradio UI. Its standalone
server listens on `0.0.0.0:8002`; neither server nor UI is selected for GChat.

Borrow the request/completion shape only. GChat's existing task/channel and
journal owners must persist an assistance request with its bot/task/session
identity and record its resolution. A human-suggested function call enters the
same approval and operation-receipt route as a model-suggested call. Completing
an assistance request cannot authorize Take over or resume a paused desktop.
The assistance-request UI remains a GChat task/channel boundary; no separate
human-completion server is added.

#### Implemented service ownership

`service.rs` now persists one `SessionControl` per workspace with exact session
identity, client owner UUID and `bot`, `pausing`, `human` or `paused` state.
`POST /v1/control/take-over` accepts `{identity, owner}`. Its durable admission
gate rejects new bot operations before they are recorded or sent. Previously
admitted effects must finish or be reconciled before `pausing` becomes `human`;
status/cancel probes remain available. A second owner cannot take the grant.

`POST /v1/control/hand-back` accepts the same identity/owner. The workspace owner
pauses input, closes the VNC tunnel, requests fresh Driver `get_desktop_state`
and requires a frame with valid screen/screenshot geometry before restoring
`bot`. Its response includes `{control, observation}` so the task runner can
replan from that observation instead of replaying a pre-takeover tool call.
The runtime also retains that observation for one exact-session resume; a new
bot operation, takeover or disconnect invalidates it, and restart requires a
fresh capture.
Unknown effects, failed close/capture, explicit view close, disconnect and
service restart keep the bot paused. `GET /v1/state` exposes controls and live
session identities. These service transitions do not enforce read-only VNC.

#### The selected viewer seam

| Existing Cua mechanism | GChat integration decision |
| --- | --- |
| [`StreamService`][stream-proto] target discovery, `OpenMedia` and `CloseMedia` | Use these contracts when the guest provides them. Match the selected Driver session/display and reported geometry; reject an unavailable selected display instead of the full viewer's fallback to the first display. |
| [`CreateViewerTicket`][system-proto] policy, clipboard, files and microphone scope | Service retains the guest authority. View uses explicit `VIEW_ONLY`, no clipboard, empty `files_root` and no audio uplink. Unset ticket policy means interactive, so a URL's `view_only=1` is insufficient authority. |
| [`MediaSession`][media-session] canvas, wire v2, H.264/PNG and WebSocket | Wrap this core in GChat's desktop panel. It has browser-native imports, so the core itself does not require the full viewer's ConnectRPC/protobuf packages. Service supplies the session's media ticket; view sets `interactive=false`. Its counters do not establish a latency advantage over VNC. |
| Same-origin gRPC-Web and `/media` WebSocket | A guest-local TCP endpoint can use the existing SSH forwarding mechanism. The current guest advertises VNC, not a Spaces/media endpoint; changing its port alone would not supply these services. Direct QUIC requires UDP and cannot use the current TCP tunnel. |
| Full [`HTML5 viewer`][html5] / `web/src/viewer.ts` | Do not embed as-is: its CSP has `frame-ancestors 'none'`, the app defaults to `ALLOW_ACTIVATION`, and it exposes clipboard/files/microphone and automatic interactive reconnect. Keep GChat's channel, controls and lifecycle owner. |
| Native `cua-viewer` and presence | Native surface is Windows/macOS only. Presence displays participant cursors; it does not establish GChat's exclusive input grant. Neither supplies Hyper-V provisioning or Windows 365 brokered access. |

When the media endpoint is adopted, Take over opens one human media session
only after the service reports `human`. Give the panel that session's media
ticket, rather than a reusable interactive viewer ticket that can mint more
sessions. On Hand back,
loss or close, disable local input and revoke the interactive media session
with `CloseMedia`; unresolved revocation keeps the bot paused. Interactive
reconnect must recheck the service's current grant instead of using the core's
automatic `reopen` callback. Hand back obtains a fresh frame/geometry and
reconciles unresolved effects before the bot resumes. These are the existing
product requirements mapped to Cua media mechanisms; the current service
implements the pause/drain/hand-back boundary through SSH/Driver/VNC instead.

The current `/v1/view/open` in `src-tauri/gbot-service/src/api.rs` and
`SshSession::open_view` in `src-tauri/gbot-service/src/ssh.rs` expose only
session-bound bidirectional VNC bytes. They cannot mint media tickets or mediate
human input. The service control owner above is available to GChat's task/UI
binding; a browser-renderable desktop stream still needs an approved guest
media endpoint/packaging closure. No decoder is copied without a working
endpoint. Keep SSH/VNC until that boundary exists and demonstrates the
same session/control behavior. M365 retains its selected Windows connection.

Ron permits FSL in **GChat**, not Arbitor. Inspected candidates are
`cua-spacesd-html5` (including its media core), `cua-media-protocol`,
`cua-media-transport`, `cua-media-codec` and `cua-viewer`; each component's
`LICENSE` is **FSL-1.1-MIT** at the pin. None was copied, linked or installed by
this review. Any adoption retains its notices and records the selected closure
here before distribution. The independent MIT-compatible Arbitor route remains;
AGPL `cua-som` and optional perception assets remain excluded.

## Smallest integration to a working Gbot

1. **Freeze the existing dedicated guest and transport.** Reuse the approved
   Debian 13/Xvnc/XFCE guest, native vault, russh MCP/exec/file channels and
   working SSH view forwarding. No new VM, provider account, relay or image.
2. **Replace only the Gbot executor.** Host pinned `ComputerAgent` with the
   GInfer function-tool provider above. Expose the existing Driver catalog and
   shared tool adapters through Cua function calls; retain compact elements
   projection, raw task logs, compaction and durable action receipts. Remove
   the superseded Gbot-specific iteration after acceptance; leave Chat's agent
   runtime intact.
3. **Complete the desktop task.** Resolve the known Driver popup gap in the
   fork if it is still exercised. One model-backed task opens Mousepad, types
   `Hello from Gbot.`, saves `~/hello.txt`, then verifies exact bytes by an
   independent SSH read. Use a released Qwen or Muse SMOL at >=128K context,
   full native context when the assigned device permits it. A shell-write
   substitute does not satisfy this desktop task.
4. **Run a small Cua task subset on that same guest.** Use both variants
   of [`hello_file_env`][hello-task] (`hello`, `bench`), using its existing
   setup/evaluator through our SSH-backed session. Run the model, not the task's
   scripted oracle solver. This proves command/file
   integration; the editor task above proves desktop interaction. This is the
   smallest requested subset. A later [`click-button`][click-task] variant
   needs `launch_window` and `execute_javascript`; SSH/AT-SPI alone do not supply
   them. Map those to Cua's supported browser/session path before including it;
   do not weaken its evaluator or claim that coverage now.

This proposal targets one real desktop task and a small existing task set,
without waiting for cloud provisioning, M365 qualification, a viewer replacement
or Vision. Those remain first-release obligations in the [design](README.md).
It adds a provider/session adapter, not another agent or evaluation framework.

### Acceptance questions

| Gate | Question and required observation |
| --- | --- |
| Provider fixture | Does pinned Cua emit ordinary function-tool requests to the selected GInfer endpoint, preserve tool results and finish without screenshots on the text-only route? Endpoint secrets absent from transcripts. |
| Capability/lifetime fixture | Do GChat approval, cancellation and existing unknown-action receipts remain authoritative across Cua callbacks/reconnect? No automatic redispatch of an unknown operation. |
| Driver regression, if changed | Do modal/popup native actions reach an owned active application while foreign-window targets are refused? AT-SPI remains responsive. |
| One dedicated-guest task | Model completes the editor/save flow; independent SSH read matches the line. Stop the guest/model and release keys/guards afterward. |
| Small Cua subset | Existing evaluators pass the two file variants through the GChat guest session. Keep task/variant IDs, rewards and trajectory; GUI/browser benchmark coverage is separate. |

No runs are part of this docs change. The next implementation decision is review
of the Cua provider/session adapter, service-to-Python binding and exact
dependency closure. Build, GPU time, guest packages and Windows qualification
remain separately scheduled.

## Inspected source at the fixed pin

All references below are to our fork, not an instruction to contact upstream.

[fork]: https://github.com/Gadflyii/cua/tree/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc
[xfce]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/xfce-cua/Dockerfile
[agent]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/python/agent/cua_agent/agent.py
[generic]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/python/agent/cua_agent/loops/generic_vlm.py
[openai-loop]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/python/agent/cua_agent/loops/openai.py
[provider]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/python/agent/cua_agent/loops/base.py
[output-format]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/cua-driver/docs/tool-output-format.md
[callbacks]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/python/agent/cua_agent/callbacks/base.py
[foreground]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/cua-driver/rust/crates/platform-linux/src/input/foreground.rs
[html5]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/cua/crates/cua-spacesd-html5/src/lib.rs
[human-queue]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/python/agent/cua_agent/human_tool/server.py
[human-adapter]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/python/agent/cua_agent/adapters/human_adapter.py
[stream-proto]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/cua/proto/cua/env/v1/stream.proto
[system-proto]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/cua/proto/cua/env/v1/system.proto
[media-session]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/cua/crates/cua-spacesd-html5/web/src/core/mediaSession.ts
[hello-task]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/cua-bench/example_tasks/hello_file_env/main.py
[click-task]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/cua-bench/datasets/cua-bench-basic/click-button/main.py

Additional authorities at that revision: `LICENSING.md` and each component
`LICENSE`; `libs/cua/README.md`; `libs/xfce-cua/README.md`;
`libs/python/agent/pyproject.toml`, `cua_agent/tools/browser_tool.py` and
`cua_agent/human_tool/server.py`; `libs/cua-driver/rust/Skills/cua-driver/`;
`libs/cua/crates/cua-viewer/src/main.rs`; `libs/cua-bench/README.md`;
`tools/cli-cast/README.md`. Local read-only checkout:
`/ai/gchat/out/gbot-cua-adoption-20261012/cua-source`.
