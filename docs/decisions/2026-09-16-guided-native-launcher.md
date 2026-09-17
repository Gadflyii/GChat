# Guided native GInfer launcher

Status: accepted

The no-argument `ginfer` menu remains a client of ginfer-host on Windows and
Linux. It displays the teal G-square-INFER block banner with a plain-text
fallback, hardware inventory and managed instance status.

Launch selection proceeds through available GPU group, installed model, then
profile. GPU labels use inventory indices and names rather than UUIDs. The host
still validates profile/package compatibility and exclusive reservations;
the engine checks TP topology. Switching profiles uses the same sequence and
requires confirmation before restarting the selected instance.

Download models, local package registration, storage selection and transfer
status remain available with or without installed models. The launcher consumes
the existing GChat publication catalog format through the host. Set
`GINFER_MODEL_CATALOG_URL` on the host or provide `VITE_MODEL_CATALOG_URL` at host
build time. No configured catalog or no compatible published releases produces
an explicit empty state, never a speculative download URL.

Storage changes apply to future transfers only. Each transfer retains its
destination across pauses, restarts and later storage changes. Existing models
remain inventoried in place. Downloads are managed by the service and survive
closing the menu. Desktop/background engine, GPU inventory and disk-space
subprocesses do not open Windows console windows. Explicit terminal launchers
remain interactive.

The session-scoped loopback proxy accepts browser preflight from the packaged
Tauri origins (and the local development origin in debug builds). Actual requests
retain bearer/session checks. Success, streaming and error responses expose the
app origin so browser clients can read them. This fixes the Windows webview
stall caused by rejecting preflight before `/v1/models` or chat could run.
The extension reads context from its single-model session, independently of
local filename aliases, and counts prompts using the native count-tokens route.

This change does not deliver a universal runtime bundle. Architecture-specific
runtime packaging/selection remains separate from the guided menu; current
Windows development installers bundle SM120a only.
