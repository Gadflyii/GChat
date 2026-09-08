# Models on this computer and LAN hosts

Open **Models**, select **This computer** or a paired host, then choose
**Installed**, **Recommended**, or **Downloads**. The same host lifecycle controls
are available in Engines. Offline inventories are last-known information; their
mutation controls are disabled. Downloading does not interrupt inference.

Recommendations require actual NVIDIA compute capability, enough memory on every
participating GPU, and a release-declared homogeneous TP1/TP2/TP4 group. GPU names
do not imply compute capability; memory is never summed to estimate a single-GPU
fit. TP peer connectivity and package binding remain final engine startup checks.
There is no downloadable Smol entry until that package is published and qualified.

## Release feed

The existing `VITE_MODEL_CATALOG_URL` build setting may identify a GInfer release
catalog using the existing catalog envelope. Without it, bundled model families
appear only as unavailable unless their release metadata is complete. The Models
page does not query the old upstream multi-backend catalog. Publication is a
producer task; this implementation does not invent a public registry URL.

Each `models[]` entry has `library_name: "ginfer"` and optional `releases[]`:

| Field | Contract |
| --- | --- |
| `name` | Human-readable package name |
| `identity` | Exact `model_id` and `weights_id` from the artifact |
| `url` | Public HTTPS Hugging Face `.ginfer` URL pinned to a 40-character commit |
| `sha256`, `bytes` | Exact complete-file checksum and size |
| `tp` | Exact package degree, 1, 2, or 4 |
| `qualified_sm` | Actual compute capabilities, e.g. `8.6` or `12.0`; not guessed compile-image names |
| `min_vram_mib_per_gpu` | Qualified minimum memory on each participating GPU |
| `capabilities` | Published capabilities, e.g. tools, reasoning, vision |

`min_vram_mib_per_gpu` is a measured usable-memory requirement, not the marketing
capacity converted to MiB. For example, the local 32 GB RTX 5090 reports 32,607
MiB through NVIDIA inventory. A qualified 32 GB-class release must account for
that reservation; the client must not round available memory up to claim a fit.

This describes producer-final singleton containers, including exact TP payloads.
It does not split or repack weights and does not infer artifact-set siblings.
Manually configured deployment descriptors retain their existing inventory route.

## Storage and transfer lifecycle

LAN downloads run in ginfer-host and continue when GChat closes. One active
transfer per destination bounds buffers and disk contention. Pause retains partial
bytes; resume uses an exact HTTP Range response or restarts if the server ignores
Range. A stalled request fails visibly. Verification streams the complete checksum
and inspects artifact identity/degree before publication. Service restart pauses
unfinished transfers for explicit resume.

The host writes only its dedicated `<host-state>/managed-models` directory.
Configured external inventory roots remain read-only. Local downloads install the
normal model manifest and weights together under `<data>/ginfer/models/<sha256>`.
Local application exit interrupts local work; it can resume on the next launch.
Completed local downloads enter the existing model-import/default-selection flow;
past completed jobs are not re-emitted as fresh imports on startup. The Models
sidebar badge counts active or incomplete transfers across the local machine and
paired hosts. Snapshot and local-transfer polling are shared, not repeated by
every management view.

Removal is explicit: pause before removing incomplete files, and stop instances
before deleting an installed model. Host removal rejects files outside managed
storage. Removing a managed package also removes its stopped host launch profiles.
No automatic model eviction, pruning of external roots, or engine update occurs.

## Host management protocol

All mutation endpoints require the existing pinned, paired host credential:

- `POST /host/v1/downloads`: exact release object; returns a durable download job.
- `POST /host/v1/download-actions`: `{id, action}`; pause, resume, or discard.
- `POST /host/v1/remove-model`: `{model_id}`; remove an unused managed package.
- Existing snapshots expose `model_management.version = 1`, managed root and jobs.
- GPU snapshots include optional `compute_capability`; unknown SM does not match.

The desktop uses the existing `engine_hosts_command` bridge. Local transfers use
the same manager through `local_model_download*` operations. These are management
operations, not additions to the OpenAI inference API.

## Runtime presets

GInfer owns context, concurrency, KV allocation and qualified hardware presets.
GChat does not contain a second VRAM-to-settings table. In the engine checkout
inspected for this implementation, there is no verified preset-catalog interface.
Host snapshots therefore report `engine_presets_available: false`; existing
explicit launch settings remain usable and are not called hardware presets.
Pre-load profile summaries and one-step download-and-profiled-load await that
engine contract. Installed packages can already be loaded explicitly.
