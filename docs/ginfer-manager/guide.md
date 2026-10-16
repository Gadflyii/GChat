# GInfer Server Manager

GInfer Server Manager controls this computer's GInfer host and hosts paired over
the LAN. It runs independently of GChat. Closing or exiting Manager leaves hosts
and their loaded models running; use **Stop** on an instance to unload its model.

## Open the application

Extract the native package and open `ginfer-manager` on Linux or
`ginfer-manager.exe` on Windows. Keep the included `ginfer-host` companion and
documentation with the application. Node is not required at runtime. The package
does not include an inference engine or models.
The application uses GChat's default dark theme on both platforms.

Install and configure GInfer first if this computer will serve models. Manager
reuses its registered host, engine paths and model storage. It does not replace
a running host. Existing model files stay in place unless you explicitly move an
installed managed download during setup. A service-owned host must be started through
its OS service manager. Computers without a local host can still pair with other
hosts from the sidebar.

Hosts must include this version's fleet and client-management endpoints. Update
a GChat-owned host through its GChat installation, or a service-owned host through
its service installation. The bundled companion does not replace the registered
owner just because Manager opens. Available downloads use the host's configured
`GINFER_MODEL_CATALOG_URL`; no catalog address is selected by Manager.

Linux requires an X11 desktop and the Tauri GTK/WebKit runtime libraries. The
window stays visible when the desktop has no supported tray. Windows requires
Microsoft Edge WebView2 Runtime and uses the
system tray; closing its window hides it there. **Open Server Manager** restores
the window, and **Exit Manager** exits only this application. `--window` opens
the window explicitly; `--no-tray` uses a window without a tray.

## Pair and share

Click **Pair** beside a nearby host. Manager saves its verified certificate and
this client's grant in the same native storage used by GChat. For a host that
does not appear nearby, use **Pair a host…** and enter its HTTPS address. Pairing
does not load or restart a model.

Windows uses Credential Manager. Linux pairing requires an available, unlocked
Secret Service provider in the desktop session. If secure storage is unavailable,
unlock that provider and retry; local host control remains available. Manager
does not save paired tokens in plaintext.

**Share this host** controls LAN sharing for this computer. **Rename this
computer…** changes its advertised name. Turning sharing off retains loaded
instances and saved grants. Sharing and hostname controls for another computer
must be changed on that computer. **Forget this host** removes this client's
saved connection; **Revoke** under Paired clients invalidates a host grant.

An offline host shows **GInfer offline** and its last-known inventory. Reconnect
before starting, changing or stopping an instance there.

## Complete local setup

Open **Set up local GInfer** for this computer. GChat Welcome and the Linux
installer continuation use the same Host-owned setup, so you can close a client
and continue later without discarding progress.

1. Select a compatible group of 1, 2 or 4 supported GPUs, then choose **Use
   selected GPUs**. The Host selects no GPU automatically. This saves the group
   without starting calibration.
2. Review **Choose model storage**. When usable saved measurements exist, the
   recommendation matches their read speeds to the disks currently present. Live
   free space and write access still apply. Candidates explain missing measurements
   or insufficient space. Keep the recommendation or enter another native writable
   folder, then choose **Use this folder**.
3. Select one or more compatible published packages and choose **Download selected
   models**. Suggestions use the selected GPUs, published memory guidance and live
   storage capacity. Progress survives closing Manager or restarting the Host.
4. After each selected download is verified, the Host prepares the measurements
   required by that artifact and its startup settings. Other formats can remain
   deferred. The panel shows the reported phase and elapsed time; any historical
   ETA must match this profiling scope. No model starts during this step.
5. Under **Review startup defaults**, review each package's context, concurrency,
   instance count and optional GPU KV budget. The Engine supplies a fresh startup
   estimate for that package. It does not prove that every selected package fits
   together or that full context is qualified.
6. Choose **Finish local setup**. The Host saves stopped instances. Use **Start**
   when you want to load a model.

Choosing a storage folder does not relocate existing models. For an installed
managed download, use its explicit move action after stopping active models. The
Host copies and verifies the package, saves its new location durably, then removes
the original; existing targets are rejected. Saved instances retain their model
identity. Models registered from an external folder remain there.

For terminal continuation, run `ginfer-host first-run --interactive` from the
installed Host's binary directory. Without `--interactive`, `ginfer-host first-run`
returns JSON status without prompting. The
[shared workflow reference](README.md#shared-first-run-setup--october-15) lists
the authenticated API and explicit actions. Windows follows the same source
workflow; acceptance of this new setup on Windows remains pending.

## Prepare the hardware profile

The Host needs a matching GInfer v2 profiling CLI alongside its serving runtime.
On first installation, open **Hardware profile → Choose GPU group**. No GPU is
selected automatically, even on a one-GPU computer. Explicitly select 1, 2 or 4
GPUs of the same SM; incompatible choices become disabled. Click
**Prepare hardware profile** to save that deployment group and start its job.
Stop active models on the host before preparing or refreshing measurements.

The profile is bound to the sorted GPU UUID set and TP degree. Selection order
remains an input to the deployment's GPU visibility and ranks; changing order
does not create a different profile identity. The panel shows the current job's
GPU group and Engine, plus pending saved deployment groups.

Manual all-format preparation can take much longer than selected-artifact
preparation. The panel shows elapsed time, native phase diagnostics and
**Profiling log**. A historical ETA is available only for a matching GPU group
and profiling scope; it does not infer a percentage from completed formats. One
Host-owned job processes saved groups serially and holds model launches until the queue stops. Closing
GChat or Manager leaves it running. Installation waits for file setup and Host
handoff, not for the long measurements to finish.

Use **Cancel profiling** or **Cancel profiling and queue** to stop owned work.
The Host retains the current recipe and unfinished groups. **Resume profiling**
continues that recipe and queue, preserving forced refresh and the original
group. Resume is available for saved interrupted work even before a checkpoint
exists. A reported checkpoint has not yet proved compatibility: the producer
validates its inputs before reusing progress. Completion means the producer
published a complete hardware profile, not model or full-context qualification.
Interrupted or failed work retains the accepted profile; incomplete measurements
are not installed as a complete profile.

Installation, **Scan**, ordinary **Refresh** and snapshot updates do not start
calibration. First-run setup prepares the selected artifacts after verified
download; explicit **Prepare hardware profile** requests all-format preparation
for the saved deployment group. Engine startup reads and validates its profile
without starting calibration. If the native Engine reader rejects a group's
fingerprint, its exact profile appears as **Hardware changed — re-profile**.
Click **Select group to re-profile**, then **Refresh hardware profile** (or
**Prepare hardware profile** if no job has been started). Selecting the group
alone starts nothing. The duration hint uses a previous successful measurement
for the same group and profiling scope when available; otherwise no measured
ETA is shown. An unrelated startup error does not establish a hardware change.

## Run models

Select a host and use **Start a model**. Choose a saved profile and GPU
group, or **Custom settings** to select an installed package, its GPU group,
context window, concurrency, Vision, KV format and speculation. The host
validates settings before launch. No model starts just by opening Manager.

**Structured outputs** is enabled by default for new Host deployments, allowing
JSON-schema responses and strict tools. Uncheck it to turn those capabilities
off; the saved choice is used by Start and Reload. Presets retain their recorded
evidence. Changing their structured-output setting uses custom runtime options
and does not extend that evidence to the changed deployment. The standalone
GInfer Engine remains opt-in.

Custom settings also exposes **Host KV cache (bytes, blank = automatic, 0 =
disabled)**. A blank value leaves sizing to the Engine; zero explicitly disables
the Host cache, and a positive value sets exact bytes. Reload preserves all three
choices. This control is separate from the GPU KV budget.

Custom settings exposes **GPU KV budget (bytes, blank = automatic)**. Leave it
blank for Host to obtain a fresh Engine startup quote and derive the arena from
current free memory, startup allocations and headroom, or enter an exact positive
byte count. Host quotes every Start, Restart and Reload using the selected Engine
and final settings. Selecting a saved catalog profile does not reuse its
historical KV allocation. An automatic request stays automatic when saved and
is sized again on its next start.

Reload shows the saved budget; clearing it switches to automatic sizing without
changing context or concurrency. An exact budget must fit the fresh quote; Host
refuses an oversized request before loading the model instead of reducing it.
If an older saved value no longer fits, use **Reload → Custom settings**, clear
this budget, review the other settings and submit **Reload**. Existing instances
keep their allocations when another instance is added. Automatic sizing and a
successful startup do not establish full-context capacity qualification.

For Flash with graphs enabled, a first solo automatic start can use the Engine's
own automatic arena while it measures graph memory. Wait for Ready to retain
that receipt before using an explicit GPU KV budget or adding instances with the
same settings. Shared Flash placement also requires a per-instance weight
residency budget. A quote is a current estimate; another process allocating GPU
memory can still prevent startup.

Use **Start** to start a saved stopped instance, **Stop** to drain requests and
unload it, and **Reload** to change its configuration. If requests are active,
the form lets you explicitly interrupt them. The instance's displayed API
address and port come from the host.

Automatic speculation leaves draft-width selection to the Engine. Explicit
DFlash2 or MTP requires a positive supported draft width. Flash uses MTP; Qwen
27B and Muse use DFlash2 where their package supports it. A listed package or
custom configuration is not proof of GPU qualification; use its measured profile
when one is available.

Under Models, **Scan** refreshes inventory without starting calibration.
**Add local model…** registers an existing local `.ginfer`, and **Storage…** chooses managed download storage.
**Show available downloads** lists compatible published packages. Download
progress supports pause/resume. Existing source-model locations remain in place.

Paired clients shows names, active requests and last seen. These are HTTP request
activity, not a count of permanently connected GChat windows.

## Shared work pools

One selected fleet coordinator stores shared pools and client assignments. Choose
an online shared hosting computer under **Set coordinator…** and supply addresses
reachable by other fleet clients. This choice remains fixed when a host goes
offline; Manager does not elect a replacement.

Each saved host has an **Online** or **Offline** status in this panel. Offline
connections do not show raw network errors. Authentication, certificate and
configuration problems show **Needs attention** with their explanation.

Create a pool such as **coder** with **New work pool**, choose exact host instances
and set their per-client worker limits. Other GChat workstations connected to the
same fleet see that same pool. Hosts report which of their instances belong to
which pools. A member's **Last known** report can lag while offline; the
coordinator remains the source of pool definitions.

**Assign client…** chooses usable pools and preferred hosts/instances for a
client. GChat's **Fleet assignment** worker placement uses those preferences;
explicit Current, model, instance or pool choices retain their meaning. GChat
runs the agents, and the assigned GInfer instances serve their inference requests.
Worker limits apply per client; they are not a fleet-wide GPU reservation.

Fleet edits require the current revision. If another workstation edited the
fleet while a form was open, cancel, refresh and review before submitting again.
When the coordinator is unavailable, the last-known catalog is read-only and
new pooled/fleet-assigned runs wait for reconnection. Existing runs retain their
placement, and direct local work remains available.

Existing GChat pools preserve their IDs and ordered members during migration.
Unresolved old local model references are reported for correction rather than
discarded. Saved agent definitions and past runs remain in GChat.
