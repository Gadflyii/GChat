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
a running host or copy model files. A service-owned host must be started through
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

## Run models

Select a host and use **Start a model**. Choose a saved profile and GPU
group, or **Custom settings** to select an installed package, its GPU group,
context window, concurrency, Vision, KV format and speculation. The host
validates settings before launch. No model starts just by opening Manager.

Use **Start** to start a saved stopped instance, **Stop** to drain requests and
unload it, and **Reload** to change its configuration. If requests are active,
the form lets you explicitly interrupt them. The instance's displayed API
address and port come from the host.

Automatic speculation leaves draft-width selection to the Engine. Explicit
DFlash2 or MTP requires a positive supported draft width. Flash uses MTP; Qwen
27B and Muse use DFlash2 where their package supports it. A listed package or
custom configuration is not proof of GPU qualification; use its measured profile
when one is available.

Under Models, **Scan** refreshes inventory, **Add local model…** registers an
existing local `.ginfer`, and **Storage…** chooses managed download storage.
**Show available downloads** lists compatible published packages. Download
progress supports pause/resume. Existing source-model locations remain in place.

Paired clients shows names, active requests and last seen. These are HTTP request
activity, not a count of permanently connected GChat windows.

## Shared work pools

One selected fleet coordinator stores shared pools and client assignments. Choose
an online shared hosting computer under **Set coordinator…** and supply addresses
reachable by other fleet clients. This choice remains fixed when a host goes
offline; Manager does not elect a replacement.

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
