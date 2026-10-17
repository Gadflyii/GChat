# Google Workspace and Microsoft 365 connectors

## Current outcome and scope

Ron authorized adding these connectors to the master TODO list and implementing
both through parallel agents on October 10, 2026: “lets get those added to the to
do list and your agents can do it.” Deliver bundled Windows/Linux
account connections and typed service tools in the existing shared Chat, Agent
and Code runtime. The October 12 Gbot integration uses the same native provider
and vault through explicit per-bot account links; it never reads global account
selection. Scoped catalog/admission, write approvals, cancellation and durable
effect receipts have focused service/native evidence. Local mock OAuth qualifies
the source flow; live provider consent is a release gate for Ron. See
[Gbot's current record](../gbot/README.md#current-record-and-inventory).
User-connected SaaS accounts are integrations,
not an expansion of GChat LAN host/workspace management or paid Arbitor features.

Microsoft sign-in uses the built-in public app registration in release builds
with tenant `common`, supporting work, school and personal Microsoft accounts,
while retaining any saved organization registration. Outlook.com, Hotmail and
personal OneDrive are supported by the available account-specific Graph APIs;
SharePoint, Teams and Windows 365 Cloud PC require a work or school account.
Calendar free/busy and Teams online meetings also require a supported work or
school account. Gbot Cloud PC setup guides browser sign-in and explicit
account/PC choice. In a build without that registration, it explains that
Microsoft sign-in is unavailable without asking novices for a
client ID; custom registration stays in an advanced Settings option with steps.
Ron owns confirmation of the Entra redirect configuration and live-consent gate. See
[setup and release configuration](operations.md) and the
[guided sign-in decision](../decisions/2026-10-16-guide-microsoft-sign-in-with-release-identity.md)
and [account audience decision](../decisions/2026-10-16-allow-personal-microsoft-accounts.md).

Google uses each user's own Desktop OAuth client, with no built-in Google release
identity or Sectile Google account. Settings guides project creation, API enablement,
External consent and production publishing, then accepts the client ID and secret
or imports the downloaded client JSON with a file picker. Personal use follows
Google's verification exception, without a paid review. Consent uses the system
browser and a temporary loopback callback. GChat's protected credential vault
saves the registration secret and refresh token; access refresh continues after
restart. Imported endpoint URLs never change provider routing. Expired or revoked
sign-in prompts account reconnection in plain language; temporary failures retain
the account. These source changes use mocks; live consent
remains Ron's release gate. See [the Google setup guide](operations.md#google-register-your-own-desktop-app)
and [the registration decision](../decisions/2026-10-16-guide-google-desktop-registration.md).

Google services: Gmail, Calendar, Drive, Docs, Sheets, Slides, People contacts and
Tasks. Microsoft Graph services: Outlook mail/calendar/contacts, OneDrive,
SharePoint, Teams, To Do, OneNote and Excel. Cover practical service operations
with exact schemas and truthful provider/account limitations; do not claim every
provider API or unsupported native Word/PowerPoint editing. Binary file operations
use deliberate content ownership, never model-visible authenticated download URLs.

## Historical baseline before native connectors

Baseline `f111810ec` bundles `gog-workspace` v0.1.8, an external CLI skill with
Darwin/Linux admission; its Windows setup script does not make it Windows-enabled.
At that baseline, Gmail, Calendar and Drive examples existed, but native managed
Google OAuth and owned service adapters did not. Its promise that read commands
bypass approval conflicts with the shared classification of all shell calls as
approval-gated. Microsoft 365 adapters and native account sign-in were also absent
at that baseline; the current native implementation is described below. Local Office file
reading, synced OneDrive paths and Azure OpenAI are separate capabilities.
The single master backlog is [GInfer open work](/ai/ginfer-worktrees/open-work/docs/maintainer/open-work.md).

## Selected design

One native account owner manages browser-based OAuth PKCE, public app registration
configuration, per-service grants, selected accounts and refresh. Refresh tokens
and any Google desktop registration secret are stored in GChat's protected
credential store (the native Windows store, or Secret Service or a selected
passphrase vault on Linux);
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

The original connector implementation and focused corrections merged to GChat
main in `72cd661bf`. Per-bot account isolation merged in `8440b5f7a`; its native
provider owner and credential vault are shared with Chat, Agent and Code.
These source merges do not constitute installed or live OAuth acceptance.
Native check/tests and frontend checks reused
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

### Local mock OAuth qualification — October 15

The account owner now has two full local mock OAuth cases, one for each provider.
They exercise authorization redirects through the real loopback callback, state
and S256 PKCE binding, token exchange, identity lookup, denied/cancelled sign-in,
refresh-token rotation and reduced consent. Two synthetic accounts prove that a
bot's explicit link ignores the global default and rejects another account.
Reduced consent removes write access; disconnect invalidates the active lease,
removes credentials and survives metadata reopen while preserving the other
account. Google revocation reaches the mock endpoint. Microsoft local disconnect
retains its explicit distinction from tenant consent revocation.

The endpoint override exists only under `cfg(test)`. Production provider URLs and
HTTPS restrictions are unchanged. All credentials are synthetic and use the
existing memory-vault fixture; no live account or app registration was created.
The 13 account-owner cases pass, including both new lifecycles. Current check,
strict Clippy and full verification receipts are retained in
`/ai/gchat/out/gbot-mock-oauth-20261015/result.json`.

## Acceptance and next action

The source scope is complete against the local mock OAuth provider, together with
the existing provider adapter, permission, receipt and UI fixtures. This evidence
does not claim live sign-in, provider API acceptance or installed Windows OAuth.

**Release gate for Ron: live provider consent.** Use existing approved app
registrations and accounts supplied for that release gate to check native consent,
refresh, one read, revocation/local disconnect and per-bot isolation. Creating new
credentials or accounts is outside this source task. Windows acceptance remains
at release. No publication, signing, production account mutation, new dependency
or paid Arbitor implementation is authorized by this task.

See [connection setup and supported operations](operations.md) and the
[account/runtime decision](../decisions/2026-10-10-own-native-workspace-connectors.md).

## Provider authorities

- [Google native-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google service scopes](https://developers.google.com/identity/protocols/oauth2/scopes)
- [Microsoft Graph overview](https://learn.microsoft.com/en-us/graph/overview)
- [Microsoft delegated authorization](https://learn.microsoft.com/en-us/graph/auth-v2-user)
- [Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-overview)
