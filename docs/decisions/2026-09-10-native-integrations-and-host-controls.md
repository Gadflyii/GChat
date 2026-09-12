# Native integrations and host startup controls

Status: accepted.

The installed Windows walkthrough exposed ambiguous host controls, stale local
backend settings, and installer success being confused with CLI readiness.

GInfer Hosts keeps instance selection and Start/Stop/Reload in the collapsible
host header. Model changes are explicit, confirmed reloads of the selected
instance; they discard the old qualified-profile identity rather than claim that
the new artifact has the same qualification. Hardware profiles remain the way to
choose artifact-specific capacity settings.

Inventory reports complete NVFP4 KV metadata availability independently of weight
format, across every rank. The host rejects explicit NVFP4 KV without that metadata;
the Engine remains the authority for calibration contents and executability.
Each child has a bounded local diagnostic tail, drained concurrently with serving,
which is included in its failure status. No external reporting is involved.

Native Integrations uses the same persisted switches in Settings and Integrations.
OpenCode is on by default; Hermes is off. Existing explicit saved choices remain.
This supersedes the Hermes default in the 2026-09-01 embedded-agents decision.
Hermes installation uses the upstream structured failure mode and verifies native
CLI presence. Installer stdout and stderr are drained concurrently and their final
output retained for failure diagnosis.

Reasoning effort belongs in chat, not global Settings. Low/medium/high/extra-high
are protocol effort requests, not promised thinking-token counts. GInfer resolves
them to its artifact's supported levels. High remains the default.

The unsupported quick-start GGUF coding-model recommendation and fuzzy GGUF
discovery are removed. Explicit repository metadata can describe `.ginfer` files;
it no longer turns GGUF shards, mmproj or MLX weights into download choices.
