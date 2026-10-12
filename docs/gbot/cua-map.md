# Gbot component ownership with Cua

Ron selected Cua as Gbot's computer-agent framework on October 12. His follow-up
keeps our VM provisioning, especially Hyper-V and M365 Cloud PC. This map is the
current integration plan; it supersedes the custom Gbot-loop plan in the
[design](README.md). This change is documentation only.

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
| GInfer model provider | **WRAP** | Assigned OpenAI-compatible endpoint/key/model supplied by GChat. Cua accepts `api_base`/`api_key`, but its generic VLM loop injects screenshots. A narrow function-tool provider configuration is needed for our text-only AT-SPI route; compatibility is not yet demonstrated. |
| Desktop capture, input and accessibility | **ADOPT** | Pinned Cua Driver over persistent stdio MCP/SSH, with the selected desktop environment. AT-SPI observations plus foreground native input for modal controls. No GChat accessibility implementation. The popup foreground gap remains unresolved below. |
| Driver skills | **ADOPT** | Import the pinned skill bundle (`SKILL.md`, `LINUX`, `WINDOWS`, `MACOS`, `BROWSER`, `WORKFLOW`, `VISUAL`, `RUNTIME`) through shared skill discovery, with notices, platform selection and source/version metadata. Keep session/target semantics; adapt modal activation to native input. No independently evolving computer-use skill. |
| Computer tool schemas and dispatch | **WRAP** | Expose Driver MCP tools as Cua function tools through the existing vault/session transport. Tool calls go through GChat approvals and operation receipts before execution. Preserve raw MCP replies in the task log; model-facing accessibility output has one elements representation. |
| Browser tools | **ADOPT** Driver, **WRAP** exposure | Driver's native browser tools provide page state, navigation, interaction, dialogs, files/downloads and preparation. `PythonBrowserTool` still references a legacy Playwright endpoint; do not adopt that path as working. Browser prerequisites and supported browser coverage need their own gate. |
| Human requests | **WRAP** | Cua `human_tool` has a queued request/completion mechanism. Route requests into the bot's GChat channel. Keep durable approvals and exclusive takeover in GChat; the in-process queue/Gradio UI is not those capabilities. |
| Desktop viewer and media | **WRAP**, evaluate Cua | Cua FSL media/HTML5 viewer is permitted for GChat. Its embedded web path is the plausible Tauri candidate. Native `cua-viewer` only supports Windows/macOS at the pin. Keep SSH/VNC view transport until a Cua route works inside Linux/Windows GChat over direct SSH with equivalent session/control behavior. |
| Take over / Hand back | **KEEP** authority, **WRAP** viewer input | GChat owns the durable exclusive input grant: pause bot dispatch before human input, resume only after hand-back and fresh observation. Viewer input must use that grant; a viewer or `human_tool` queue alone does not enforce it. |
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
new guest worker or network service. Its packaging/IPC contract is part of the
proposed integration and has not been implemented or qualified.

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

Ron permits FSL viewer/media in **GChat**. The exact component LICENSE controls:
even `cua-media-protocol` is FSL at this pin. The native viewer's Linux entry
exits unsupported. The [`HTML5 viewer`][html5] supplies a browser frontend over
Spaces gRPC-Web/media WebSocket and viewer tickets; it is not a standalone
VNC client. Evaluate embedding that web path with guest-local service endpoints
forwarded over SSH. Do not assume QUIC can use our TCP forwarding or expose
the guest's viewer port on the LAN/WAN.

Keep our SSH/VNC route for the smallest working task; qualify Cua media before
replacing it. M365 continues through its selected Windows connection. For
Arbitor, retain an independent MIT-compatible path until Ron reviews the FSL
boundary. AGPL `cua-som` and optional perception assets are excluded. Retain
license notices and check the selected dependency closure before distribution.

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
[hello-task]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/cua-bench/example_tasks/hello_file_env/main.py
[click-task]: https://github.com/Gadflyii/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/cua-bench/datasets/cua-bench-basic/click-button/main.py

Additional authorities at that revision: `LICENSING.md` and each component
`LICENSE`; `libs/cua/README.md`; `libs/xfce-cua/README.md`;
`libs/python/agent/pyproject.toml`, `cua_agent/tools/browser_tool.py` and
`cua_agent/human_tool/server.py`; `libs/cua-driver/rust/Skills/cua-driver/`;
`libs/cua/crates/cua-viewer/src/main.rs`; `libs/cua-bench/README.md`;
`tools/cli-cast/README.md`. Local read-only checkout:
`/ai/gchat/out/gbot-cua-adoption-20261012/cua-source`.
