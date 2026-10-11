# Google Workspace and Microsoft 365 connectors

## Current outcome and scope

Ron authorized adding these connectors to the master TODO list and implementing
both through parallel agents on October 10, 2026: “lets get those added to the to
do list and your agents can do it.” Deliver bundled Windows/Linux
account connections and typed service tools in the existing shared Chat, Agent
and Code runtime. Gbot will use that runtime when its implementation is authorized;
this task does not implement Gbot. User-connected SaaS accounts are integrations,
not an expansion of GChat LAN host/workspace management or paid Arbitor features.

Google services: Gmail, Calendar, Drive, Docs, Sheets, Slides, People contacts and
Tasks. Microsoft Graph services: Outlook mail/calendar/contacts, OneDrive,
SharePoint, Teams, To Do, OneNote and Excel. Cover practical service operations
with exact schemas and truthful provider/account limitations; do not claim every
provider API or unsupported native Word/PowerPoint editing. Binary file operations
use deliberate content ownership, never model-visible authenticated download URLs.

## Existing evidence

Baseline `f111810ec` bundles `gog-workspace` v0.1.8, an external CLI skill with
Darwin/Linux admission; its Windows setup script does not make it Windows-enabled.
Gmail, Calendar and Drive examples exist, but native managed Google OAuth and
owned service adapters do not. Its promise that read commands bypass approval
conflicts with the shared classification of all shell calls as approval-gated.
Microsoft 365 adapters and native account sign-in are absent. Local Office file
reading, synced OneDrive paths and Azure OpenAI are separate capabilities.
The single master backlog is [GInfer open work](/ai/ginfer-worktrees/open-work/docs/maintainer/open-work.md).

## Selected design

One native account owner manages browser-based OAuth PKCE, public app registration
configuration, per-service grants, selected accounts and refresh. Refresh tokens
and any Google desktop registration secret are stored in the OS credential vault;
access tokens are cached only in native memory. Frontend and model receive public
metadata only. Use existing dependencies. Provider adapters
own exact API hosts, endpoints, methods, schemas, paging and response conversion.
No arbitrary authenticated HTTP tool. A binary redirect may never forward bearer
credentials to a storage host. Microsoft disconnect must not revoke unrelated app
sessions; distinguish local disconnect from provider consent revocation.

A caller can name an account or use its explicitly selected provider default.
Resolve and freeze the exact account before the shared permission decision.
Reads and mutations use the existing caller permissions, network policy and
cancellation in all modes; do not invent a second approval or dispatch path.
Account settings expose registration, sign-in, grants, default selection,
connection/reconnect and disconnect with accurate account/service availability.

## Ownership and inventory

| Owner | Paths / deliverable | Status |
| --- | --- | --- |
| Root | Subject record, integration, review, master TODOs | Integrated; focused compile/type/lint checks pass |
| review_host_transport | `core/connectors/mod.rs`, `accounts.rs`, native command registration | Implemented; nine auth fixtures pass |
| review_host_catalog | `core/connectors/google.rs`, bundled Workspace guidance | Implemented; five provider fixtures pass |
| review_host_startup | `core/connectors/microsoft.rs` | Implemented; five provider fixtures pass |
| review_host_process | Existing shared agent capability, tool, permission and command dispatch | Implemented; five runtime fixtures pass |
| review_master_findings | Settings connections route, service client and focused UI fixtures | Implemented; twelve connection UI fixtures pass |
| fix_oi111 | Independent account, provider, dispatch and UI source review | Accepted initial implementation and focused corrections |

All source lives in `/ai/gchat-worktrees/workspace-connectors-f111`, branch
`feat/gchat-workspace-connectors`, baseline `f111810ec`, owned by GChat/root.
Reviewed implementation `a7ab93e63` and focused corrections are committed on the
source branch. Accepted main `ab4c047fe` is an ancestor; merge-ready delivery does
not install or release the feature. Native check/tests and frontend checks reused
`/ai/gchat/src-tauri/target` and the aligned dependency graph at
`/ai/gchat-worktrees/oi074-frontend-packages`; these shared caches are retained.
Owned evidence and small test caches are under
`/ai/gchat/out/workspace-connectors-20261011/gate-397/` (under 1 MiB).
No copied model, disposable build directory, live account or provider mutation
exists. Booking 397 was CPU-only, returned at 00:55:55 UTC October 11 and cancelled;
all owned check containers exited and the canonical build guard was reacquired
and released. No GPU lock or model job was started.
Native bundled Google Workspace and Microsoft 365 guidance replaces the bundled
external `gog-workspace` skill; user-installed skills are not pruned.

## Current implementation

The account owner uses system-browser sign-in, a loopback callback, PKCE and the
existing credential vault. Public metadata records selected accounts and actual
consented scopes. Cancellation and disconnect serialize with durable credential
updates. Cancel can report Connected if the durable sign-in commit has already
begun. Each provider owns typed request construction and binary content;
Microsoft responses remove preauthenticated storage URLs before publication.

All three modes resolve the same account before approval and use the same dispatch:

| Mode | Discovery and execution |
| --- | --- |
| Chat | `gchat_capability_search`, `gchat_capability_read`, `gchat_capability_call` |
| Code | `gchat_search_capabilities`, `gchat_read_capability`, `gchat_call_capability` |
| Agent | `capability_search`, `capability_read`, `connector_call` with `name` and `arguments` |

Discovery includes only connected, consented tools and loads schemas on demand.
Agent model responses normalize compact connector calls before batch validation,
loop detection and read/mutation classification. Approval previews identify the
account and operation without exposing message bodies or binary payloads.

Independent source review caught and corrected cancellation during vault commit,
disconnect metadata rollback, unchecked partial consent, exposed Graph storage
URLs, lost pending sign-in state after navigation and eager schema injection.
The revised implementation and focused corrections are independently accepted.
Native compilation exposed a moved Gmail path and incomplete fixture methods;
UI testing exposed disconnect feedback hidden behind its modal. Corrections keep
the path owned, reject unrelated fixture calls and show the error in the active
dialog with retry enabled. Strict checks then corrected two MSRV predicates,
account/auth argument ownership, unnecessary schema clones and the route literal.
Effect cleanup captures stable ref objects while invalidating their latest values.
No lint suppression, dependency upgrade or MSRV change was introduced.

## Verification

All named focused gates pass. Evidence uses Ubuntu 24, Rust 1.98 and the existing
React/TypeScript/Vitest dependency graph, with networking disabled and no live
credentials. Native resources are inert test stubs, not installer resources.

| Gate | Result | Evidence relative to `gate-397/` |
| --- | --- | --- |
| Account lifecycle | 9 pass | `round-3/native-account-provider.log`, source `65b72d3be` |
| Google and Microsoft request adapters | 5 + 5 pass | Same nineteen-case native log |
| Shared runtime/account approval | 5 pass | `round-2/native-runtime.log`, source `3aeac1903` |
| Connections UI lifecycle | 12 pass | `round-4/ui-connections.log`, source `ea74f950e` |
| Skill seeding and Settings link | 1 + 1 pass | `round-2/native-skills.log`, `round-2/ui-settings-link.log` |
| Cargo check, all test-supported targets | Pass | `round-3/native-check.log` |
| Strict Clippy, warnings denied | Pass | `round-3/native-clippy.log` |
| Frontend type check and affected ESLint, zero warnings | Pass | `round-4/typecheck.log`, `round-4/frontend-lint.log` |

Passing runtime, skill and navigation cases are reused because their code and
resources did not change after `3aeac1903`. Auth/provider cases were repeated after
the account contract changed; UI cases were repeated after the cleanup change.
Fourteen unselected Settings cases are excluded, not additional passes. Original
failed logs remain alongside corrections. No unrelated full suite was run.

## Acceptance and next action

Source implementation, supported-operation documentation and the named focused
checks are complete. Native Windows/Linux OAuth and live
read/write acceptance require real registered client IDs and a user-approved test
account; these prerequisites are not available yet. Source fixtures cannot be
reported as live sign-in or provider qualification.

Next: reviewed GChat main merge from `feat/gchat-workspace-connectors`, then
register approved desktop clients and test accounts for native/live acceptance
when available. No feature is installed or live-qualified. No publication,
signing, production account mutation, new dependency or paid Arbitor
implementation is authorized by this task. The named gates are complete; do not
repeat terminal/defaults or other passing checks for documentation-only changes.

See [connection setup and supported operations](operations.md) and the
[account/runtime decision](../decisions/2026-10-10-own-native-workspace-connectors.md).

## Provider authorities

- [Google native-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google service scopes](https://developers.google.com/identity/protocols/oauth2/scopes)
- [Microsoft Graph overview](https://learn.microsoft.com/en-us/graph/overview)
- [Microsoft delegated authorization](https://learn.microsoft.com/en-us/graph/auth-v2-user)
- [Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-overview)
