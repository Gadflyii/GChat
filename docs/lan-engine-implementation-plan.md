# LAN engine discovery and registration implementation plan

Status: implementation and platform integration checks delivered on `feat/lan-engine-registry`.

Verification scope and delivery limitations are recorded below. See [host setup](lan-host-setup.md) for installation and pairing.

Fleet qualification used the explicitly authorized WSL5090 and WSL4090 hosts. Server 1 and Server 2 were not used for this qualification. The local GPU was released back through the shared coordination mailbox.

## Deliverable and completion criteria

A user installs a GInfer host on Windows or Linux, enables LAN sharing, and sees it in GChat on the same network. After one-time pairing, GChat displays its GPUs, installed registered models, running instances, effective configuration, and available metrics. The user can start, stop, reload, select, and benchmark an instance and assign it to an agent role. Changes to inventory and running instances appear automatically. Offline hosts remain registered. Manual connection supports networks without multicast.

Completion requires a real two-host discovery/pairing/inference exercise, duplicate-model routing checks, restart/reconnection checks, meaningful lifecycle/security tests, the GChat verification gate, and platform builds. Claims of Windows/Linux qualification require running the affected platform path. A mock server does not establish real-engine performance or GPU topology qualification.

## Ownership and development isolation

- GChat owns the host control service and client registry. Place Rust implementation under existing `src-tauri/` paths and install scripts under `scripts/`; avoid a new repository or root directory.
- `ginfer-host` is a headless executable. Its runtime must not require a running Tauri application or browser. A separate nested crate can share protocol types with GChat without linking the desktop application into the host executable.
- GInfer owns model binding, GPU execution, effective runtime capabilities, and public inference/metrics APIs. Use documented engine flags and endpoints; add engine changes only if a demonstrated contract gap requires them, in an isolated worktree.
- The host service owns process handles, GPU reservations, explicit artifact paths, and lifecycle transactions. It never partitions or repacks artifacts.
- Preserve the pending benchmark/Hermes/OpenCode changes in the GChat tree. Do not commit or push until requested.

## User interface

First-run intake offers local model download, discovered hosts, and manual host connection. A client without a compatible local GPU can still use remote hosts.

An Engines entry shows this computer, paired hosts, and nearby unpaired hosts. Nearby cards show only a name and connection status. Pairing requests the host's temporary code and verifies its certificate through the pairing procedure. Paired cards expose hardware, inventory, and instances. Separate availability states include discovered, pairing, online, unreachable, and credentials rejected.

Installed-model rows show metadata from validated artifacts/manifests, availability, and a Load action. Instance rows show starting, ready, draining/stopping, stopped, or failed; effective context/concurrency/TP; selected GPUs; and last error. Never present startup-requested settings as effective settings until the engine confirms them.

Display selection as `Muse Glimmer — Server 1 / GPU 0`, retaining opaque IDs internally. Refresh must preserve selection. Notify once for a newly found host; do not repeatedly interrupt the user. Ignore and Forget are distinct: Ignore suppresses discovery prompts, Forget removes registration and its local credentials.

## Identity and protocol

Host ID is a persistent UUID created at service installation. Instance ID is a persistent UUID for a configured launch profile, surviving process restart. Each launch also has a new session ID so clients can invalidate stale capabilities and metrics. Model ID identifies the inventory artifact, separately from the model's public inference ID. IP address, hostname, PID, display name, and model name are never identity keys.

Every wire document declares a protocol version. The initial service contract is version 1. Proposed routes below belong to `ginfer-host`, not existing `ginfer-serve` endpoints:

| Route | Access | Purpose |
| --- | --- | --- |
| `GET /.well-known/ginfer` | Public | Version, host ID/name, pairing availability; no model paths or tokens |
| `POST /host/v1/pair` | Temporary pairing proof | Issue a client-specific credential and authenticated host identity |
| `GET /host/v1/snapshot` | Paired client | Hardware, inventory, instance state, monotonic revision |
| `POST /host/v1/pairing` | Local private administrator credential | Activate a fresh pairing window without restarting inference |
| `POST /host/v1/instances` | Paired management client | Create/start a validated launch profile |
| `POST /host/v1/instances/{id}/stop` | Paired management client | Stop owned process with explicit active-request handling |
| `POST /host/v1/instances/{id}/reload` | Paired management client | Validate replacement settings, drain/stop, start, confirm readiness |
| `/host/v1/instances/{id}/inference/*` | Paired inference client | Stream an allowlisted engine API route to the exact owned instance |
| `DELETE /host/v1/clients/{id}` | Authorized management | Revoke a paired client |

Use typed DTOs and error codes. No arbitrary command execution or caller-supplied proxy destination. Preserve streaming backpressure, cancellation, native error bodies, token usage, reasoning fields, and `x_ginfer` metrics. Each proxy hop must use the correct upstream model ID.

The initial refresh contract is polling: GChat requests full authenticated snapshots every five seconds, including after reconnect; inventory scans every 30 seconds. No event-stream endpoint is advertised.

## Discovery and pairing

Advertise a proposed `_ginfer._tcp.local.` service for the host management endpoint. TXT data is minimal: protocol version, host ID, and TLS indication. SRV/A/AAAA records supply endpoints; DNS-SD discovery is a hint, not authenticated identity. Resolve duplicate announcements across adapters by ID without overwriting pinned trust.

LAN sharing is an explicit host-install choice. GChat listens when discovery is enabled. Bind selected LAN interfaces, handle adapter changes and IPv4/IPv6, and expire advertisements correctly. Windows/WSL NAT and container networking may prevent multicast or advertised-address reachability; document host networking/port setup and retain manual registration. Do not scan subnets or expose ports through UPnP.

TLS is required for normal remote pairing and traffic. A short code by itself does not authenticate a self-signed certificate: implement a reviewed pairing protocol that binds the exchange to host identity, or require an out-of-band certificate fingerprint from the host along with the code. Never disable certificate validation globally or send durable tokens to unverified discovery endpoints. Temporary codes expire, are single-use, and have bounded attempts. Store client credentials in the OS vault; persist only references in UI state. Host storage retains token verifiers, certificate/key, and paired-client records with appropriate filesystem access. Reinstallation or changed identity requires re-pairing.

The user approved `mdns-sd` for DNS-SD; `rustls`, `tokio-rustls`, and `rcgen` for host TLS and certificates; and `keyring` for client OS credential storage. The host uses rustls 0.21/tokio-rustls 0.24 to match the existing reqwest 0.11 client, rcgen 0.12, and mdns-sd 0.11. GChat uses keyring 3.6 with explicit Windows Credential Manager and Linux Secret Service features. Pairing requires the exact SHA256 certificate fingerprint from the host's display plus the one-use code; TLS signature verification remains enabled.

## Inventory and lifecycle

Use configured model directories and producer manifests/artifact metadata. Only `.ginfer` and explicit supported artifact-set descriptors enter inventory. Do not infer compatible models from filenames, download artifacts, or regenerate packages. Metadata extraction must follow the actual artifact contract and avoid loading full weights.

Represent physical GPUs individually and record allocations. Validate requested TP and topology through engine capabilities/qualification; hardware enumeration alone cannot establish a usable TP group. Reserve an instance's GPU group atomically before launch. Default to exclusive reservation; shared execution requires an explicit later policy.

Launch the supplied, versioned engine binary with argument arrays, a loopback bind, and a private per-process key. Readiness requires health plus model/capability validation. Exit tracking updates state and releases reservations. Restart policy defaults to reporting failure rather than an endless restart loop. Stop/reload only service-owned processes. Do not kill existing unrelated engine jobs. External engines can later be explicitly attached with reduced management capability; do not imply installed model inventory or stop privileges from a reachable port.

## GChat integration

The Rust registry owns trust references and the mapping `(host_id, instance_id)` to a live endpoint/session. Frontend snapshots contain no credentials. The local owned engine is represented with the same selection semantics, while its existing lifecycle remains functional during implementation; remove superseded duplicate routing only at the completed cutover.

The facade publishes stable opaque aliases for remote instances, separate from display labels. A conversation/run saves its exact instance assignment. Two hosts serving identical upstream model IDs must remain separately selectable. Host failure surfaces an actionable error and preserves the run; no silent reroute to a different model or machine.

Integrate in this order: Engines page and intake; chat selectors and facade; agent role resolution and monitor labels; OpenCode/Hermes model list through the facade; benchmark target resolution. Benchmarking a remote shared instance requires an explicit Run action and records network wall time separately from engine phase time. Preserve the existing rule that the benchmark uses an already loaded instance without reloads.

## Milestones and evidence

1. **Plan and contracts.** Record architecture and DTOs; establish stable identity and reconciliation semantics. Verify duplicate IDs, restart updates, disappearing hosts, and malformed snapshots with behavioral tests.
2. **Headless host and explicit registration.** Serve real inventory and lifecycle snapshots over authenticated transport; connect manually from GChat. Test child readiness/failure/stop/reload and reservation release with a controlled child process, then one available real engine.
3. **Discovery and pairing.** Wire mDNS and certificate-bound pairing; persist credentials and revocation. Exercise discover → pair → restart → reconnect on two machines, and reject wrong/expired codes and changed certificates.
4. **Engines UI and intake.** Build host cards, inventory/instance views, lifecycle actions, and onboarding. Verify unavailable-local-GPU use, offline retention, and duplicate model labels.
5. **Consumer cutover.** Resolve chat, agent roles, external CLI facade, and benchmarks through exact instance identity. Test two identical model names on distinct instances, cancellation and stream/error propagation, and preservation of saved runs.
6. **Install and qualification.** Windows service/Linux systemd setup, discovery firewall guidance, fresh install/pair walkthrough, `make verify`, host tests, platform builds and a real end-to-end run. Produce an updated GChat installer only after the runtime bundle selection is explicit.

## Scope limits and remaining decisions

No distributed inference across hosts, automatic load balancing, silent model downloads, remote arbitrary shell, NAS migration, kernel campaigns, or changes to ongoing engine tuning. The initial service manages its own configured instances. Approved dependencies implement certificate-pinned TLS and temporary-code pairing. Cross-platform service installation and credential vault behavior require physical platform verification.

## Verification and handoff

- Real two-host discovery, distinct identities with duplicate display names, pinned pairing, revocation, and durable identity across restart passed between WSL5090 and WSL4090.
- Real Muse AutoRound TP1 load, generation, reload with a new session, stop, and grant revocation passed on both GPUs. Workload: C1, 8K context, INT8 KV 1 GiB, speculation and Vision off. These establish lifecycle behavior, not optimized performance or TP qualification.
- Windows desktop IPC-to-WSL4090 passed using the native credential vault, exact model/agent target selection, alias-preserving JSON/SSE forwarding, benchmark dispatch, stop, revoke, and Forget. Shared facade adapters additionally have loopback HTTP and Responses scope/continuation tests. This is not a visual OpenCode/Hermes or full Agent Studio walkthrough.
- LAN-only facade startup now reacts to a paired instance becoming ready without loading a local model, respects disabled auto-start, ignores stale offline readiness, and does not restart on every poll. Rendered DataProvider tests cover those cases. Provider projection tracks an assigned port and local credentials immediately.
- Engines/intake UI tests cover discovery preferences, ignored hosts, offline inventory, pairing validation, explicit launch arguments, invalid launch settings, reload controls, and remote intake without a local GPU. Requested settings are distinguished from engine-reported metadata.
- Linux systemd install/start/pair/restart/stop and elevated Windows SCM installation/readiness/pair/restart/stop passed. Windows uses a dedicated virtual service account and private state. Test services and owned GPU instances were stopped; temporary service registrations were removed.
- Native Linux and Windows host release archives are available under `src-tauri/ginfer-host/target/distribution/`. They contain only the host executable, matching installer, setup guide, and license. Packaging checks cover architecture, contents, executable permissions, and refusal to overwrite.
- The final GChat verification gate includes frontend lint/types/tests, critical coverage gates, supported native suites, and host tests. Relevant native Windows tests ran separately. No GInfer source, engine bundle, or existing user model was changed.

## Delivery limitations

Linux desktop credential storage requires an unlocked Secret Service provider; this headless WSL environment has none. Windows native vault storage is physically verified. No plaintext fallback exists.

Host packages are local, unsigned, and unpublished. A GChat installer rebuild requires an explicitly selected engine bundle; this task does not replace the engine while its development is ongoing. Physical multi-GPU artifact-set execution, exhaustive model configurations, and a visual walkthrough of every consumer are not claimed by these LAN integration checks. Engine-native unsupported operations retain their native errors.

The user authorized committing and pushing this branch, including the integrated benchmark, Hermes, and OpenCode work. Engine source and local generated packages remain outside this delivery.
