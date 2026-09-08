# Manage models on the selected host

## Decision

Models selects this computer or a paired host, then presents Installed,
Recommended, and Downloads. The paired ginfer-host owns LAN transfers and a
dedicated managed-models directory under its existing service state directory;
configured external inventory roots remain read-only. Local transfers atomically
publish the existing model manifest and weights layout under ginfer/models.

Release entries carry commit-pinned HTTPS URLs, exact SHA256/bytes, identity,
TP, qualified compute capabilities, per-GPU memory, and capability labels.
Incomplete/unpublished entries cannot initiate downloads. The existing explicit
VITE_MODEL_CATALOG_URL can supply release-bearing GInfer catalog entries; no
speculative public feed or package URL is invented. No new dependency is added.

GInfer remains the authority for runtime presets, artifact binding and real TP
topology validation. Saved launch settings are not advertised as qualified
hardware presets. Desktop memory estimates never sum VRAM across GPUs.

Transfers are persisted, streamed with bounded buffers, serialized per host,
range-resumable and verified before atomic publication. On service restart,
unfinished work pauses for an explicit resume. Closing a remote desktop does
not cancel the host's work. Only explicit removal can delete partial files or
unused packages in managed storage. Inference APIs remain unchanged.

## Consequences

This supersedes generic quantization-first Hub browsing for GInfer model
management. Release publication remains a separate producer responsibility;
Smol packages do not appear as downloadable until actually published. Engine
profile introspection must be supported by the engine before the UI can show
qualified pre-load context/concurrency forecasts.
