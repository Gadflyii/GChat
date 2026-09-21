# Official reference results

G.bench admits archived performance-matrix measurements through the private official
publisher, using `benchmark_id: reference` and `ginfer-max-perf-reference-v1`.
Community GChat submissions retain the Standard Benchmark contract. Official keys
are never embedded in public GChat builds and are required for reference imports.

Reference series retain common model/execution settings and C1/C4/C8 throughput,
with engine build/revision, context capacity, loaded concurrency, and KV pool size
on each point. Every point must match the frozen 2048-token corpus and 500-token
output workload. This describes the independently launched reference Engines
without inventing one common resident configuration. Unknown hardware stays null.

The board has independent Hardware and Model filters, both defaulting to Show all.
Hardware identifies GPU model across GPU counts and TP degrees. Model offers
Muse Glimmer 30B and Qwen 3.8 27B across weight configurations. Concurrency also
defaults to all, showing separate C1/C4/C8 rows. The compact desktop filters fit
one row and wrap on smaller screens.

A publication date links to the run detail without printing its ID. Columns show
rank, nickname, cold PP, PP, aggregate TG, TG/request, GPU/count, compact model and
weight format, TP, concurrency, and OS. The PRO 6000 label is shortened to
RTX Pro 6000 BW WS Edition. Full execution settings remain in the tooltip and
detail view; reserved capacities do not restrict filtering.

The website persists an `official` flag derived from the verified signing key,
never from a caller-supplied role or nickname. Authenticated `Sectile.labs` rows
use the existing theme-aware brand wordmark. Other nicknames render as plain text.

The website implementation, SQL migration, importer, tests, and rollout instructions
live in the existing Sectile Web `site/gbench` folder. The importer reads the explicit
matrix campaign manifest and raw counters; it does not run inference or submit.
The 2026-09-17 fleet yielded 12 reference series / 36 points, now published at
https://sectilelabs.ai/gbench/. Public readback matched all prepared payloads and
server-derived scores. Browser checks confirmed wordmarks and table layout.
Private signing material and deletion receipts remain outside Git.
