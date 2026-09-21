# G.bench community leaderboard

Status: deployed with publication enabled. Twelve signed official reference series
(36 points) have been published and read back from the live database.

Only completed Standard Benchmark runs offer publication. Standard is an explicit
run identity, not a guess based on token lengths: 2,048 prompt / 500 output tokens,
one warmup and one measured wave at each supported C1/C4/C8 point. Custom runs
cannot masquerade as Standard. All other presets hide the submission panel.

The authenticated inference host supplies public CPU, RAM, OS, and GPU inventory
for the selected serving instance. The engine supplies model/weights, build and
launch configuration with its raw benchmark counters. The client whitelists public
fields and shows a preview plus explicit opt-in. Paths, host/account names, GPU
UUIDs, credentials, prompt text, generated text, and local session details are not
included. WSL reports assigned resources; unavailable hardware data remains null.

The initial backend is PHP/PDO MySQL, suitable for the user's cPanel website, at
`sectilelabs.ai/gbench`. Its source is in the user's existing Sectile Web directory,
not the inference engine repository. No Node hosting service is required. The
live leaderboard reads, HTTPS routing, and Apache private-directory protection
have been checked. Signed official submission, database insertion, and public
readback passed. Installed community-client publication, deletion, lost-response
recovery, and concurrent replay remain in [open work](../open-work.md).

The server rejects unknown fields and derives scores from timing counters. Results
are community self-reports, not hardware attestations. Cold PP may be unavailable
when the warmup uses an existing prefix. The page offers independent Hardware and Model filters, defaulting to Show all,
and shows target TP in its own column. C1/C4/C8 are separate scores. Execution
settings identify each row; reserved capacities remain in run details.
The initial board is explicitly bounded to the latest 500 submissions, not an
all-time ranking. Public lookup uses the original GChat Run ID.

POST retries use a run ID; identical retries recover the same private deletion
receipt. GChat stores that receipt separately from the public result. Receipt-based
DELETE is supported by the backend. IP rate limiting stores keyed hashes, while
hosting access-log retention must be configured separately and disclosed. No
automatic upload, background telemetry, deployment, or new runtime dependency is
introduced in GChat.

## Silent submission signatures

Submission now goes through a fixed-destination native command, not browser fetch.
The release build receives `GBENCH_SIGNING_KEY_ID` and `GBENCH_SIGNING_SEED_HEX`
through its private build environment. Existing ed25519-dalek signs; no new Rust
dependency is needed. The seed is not placed in source, frontend assets, or IPC.
An unconfigured build fails closed. The key remains extractable from a distributed
binary: this is a casual-spam deterrent, not genuine-client attestation.

The server issues a random challenge bound to SHA-256 of the exact payload,
a newline and private ownership token, release
key ID, connection IP hash, and a 120-second expiry. GChat signs the ASCII message
`gbench-submit-v1\n{id}\n{payload_hash}\n{expires_at}\n{key_id}` without a trailing
newline. The JSON envelope carries the original payload as a string, eliminating
cross-language JSON canonicalization differences. PHP Sodium verifies Ed25519.
Only public verification keys are configured on the server; removing a key ID
revokes that release key. Challenge deletion and result insertion share a database
transaction, so concurrent replay cannot create a second accepted operation.

Challenge issuance and submission each have independent 20/hour/IP quotas, so
the two-step flow still permits 20 submission attempts/hour. A retry after a lost
receipt fetches a fresh challenge and recovers the original receipt by run ID.
No browser popup, account, CAPTCHA, or unsigned compatibility path is provided.
Positive MySQL insertion/readback is verified; concurrent replay and rollback
behavior still require a live exercise.

The maintainer workstation is provisioned with release key ID
`gchat-release-20260918`. Its private seed is outside the repositories at
`/home/ron/.config/gchat-build/gbench-signing.env` (mode 0600) and
`%LOCALAPPDATA%\GChat\build-secrets\gbench-signing.env` (owner-only Windows ACL).
`build-windows-release.ps1` imports that file without displaying its contents;
the native source-mirror child process inherits the environment. Explicit build
environment credentials take precedence, and incomplete credentials are rejected.
The website config template carries only the matching public verification key.
Keep both private copies out of source archives and website uploads. This G.bench
key is separate from Windows installer code signing.

## Reserved publisher identity

`Sectile.labs` is the canonical name for every official public result. Names that
contain `sectile`, `ginfer`, `gchat`, or `gbench` after ASCII case folding and
removing spaces, dots, underscores and hyphens are reserved, including Sectile Labs
and the full laboratory name.
The frontend and native public client reject these names. Server enforcement uses
a separate `official_signing_public_keys` map after signature verification, never
a caller-supplied role. Public release keys cannot claim the brand nickname.
Official keys may publish only the exact canonical spelling. Public and official
verification keys cannot overlap by ID or key material.

The official publisher seed is at
`/home/ron/.config/gchat-build/gbench-official-signing.env`, mode 0600, separate
from the auto-loaded client release key. It is never embedded in public installers.
The website's CLI-only `private/publish-official.php` validates a public submission
payload, sets its nickname to `Sectile.labs`, signs with the private publisher key,
and saves the deletion receipt beside the private input. `--check` validates
without issuing a challenge or submitting. No real results are published by tests.

## Run identity and detail view

The GChat Run ID is the database primary key, receipt identifier, GET/DELETE route
identifier. The first leaderboard field is a compact UTC publication date linked
through the Run ID; the ID is not printed in the table. No separate public
submission ID is generated. Clicking the date opens a dedicated `?run=...` view with the GChat graph
geometry, separate PP/TG scales, identical series and null-gap behavior, scores
table, and readable hardware/run settings. Standardized workload metadata is not
repeated as per-run display fields. Hardware and Model filters are independent; all filters default to Show all.

Because Run IDs are public, receipt recovery also requires a private per-run
ownership token. GChat saves it before uploading; signatures bind it together
with the payload. The database stores only its hash. A copied public result cannot
recover its owner's deletion receipt. The official CLI derives its ownership token
from its private publisher seed and the Run ID. Neither token nor hash is returned
by public read endpoints. A one-time SQL alteration removes the old ID column
without deleting rows; it was applied before reference publication.

Official matrix reference imports and authenticated wordmark display are specified
in [Official reference results](2026-09-19-official-reference-results.md).
