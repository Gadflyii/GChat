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
| Root | Subject record, integration, review, master TODOs | Source integration complete; checks pending |
| review_host_transport | `core/connectors/mod.rs`, `accounts.rs`, native command registration | Implemented; nine auth fixtures unrun |
| review_host_catalog | `core/connectors/google.rs`, bundled Workspace guidance | Implemented; five provider fixtures unrun |
| review_host_startup | `core/connectors/microsoft.rs` | Implemented; five provider fixtures unrun |
| review_host_process | Existing shared agent capability, tool, permission and command dispatch | Implemented; five runtime fixtures unrun |
| review_master_findings | Settings connections route, service client and focused UI fixtures | Implemented; twelve connection UI fixtures unrun |
| fix_oi111 | Independent account, provider, dispatch and UI source review | Accepted revised source; no execution claim |

All source lives in `/ai/gchat-worktrees/workspace-connectors-f111`, branch
`feat/gchat-workspace-connectors`, baseline `f111810ec`, owned by GChat/root.
Reviewed implementation `a7ab93e63` is committed and pushed to the source remote.
Main stays unchanged pending reviewed integration. No connector build, model run,
GPU booking, live account, registration or provider mutation has begun. Agents
write disjoint files; root reviews actual diffs and commits before compilation.
No disposable build directory or copied model/artifact exists for this subject.
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
The review accepts the revised source; compilation, formatting and fixtures have
not run. No connector feature is installed or live-qualified.

## Acceptance and next action

Complete the account lifecycle, provider tools and shared UI/dispatch. Verify the
changed auth transitions, exact provider request construction, account resolution
before approval, paging/redirect ownership and connection UI with focused checks;
run affected compile/type checks, not an unrelated full suite. Document supported
operations, scopes and account limitations. Native Windows/Linux OAuth and live
read/write acceptance require real registered client IDs and a user-approved test
account; these prerequisites are not available yet. Source fixtures cannot be
reported as live sign-in or provider qualification.

Next: generate the Settings route and run affected formatting, native checks and
focused fixtures after C3 releases its
hardware-profiling interval on October 11 (current booking 396: 00:08–01:08 UTC).
Wait for its actual end before starting checks. GChat cancelled unused
CPU booking 394; it holds no build/GPU guard or live job. Reuse existing dependency
and Cargo caches. Native account acceptance remains a separate unmet prerequisite.
No publication, signing, production account mutation, new dependency or paid
Arbitor implementation is authorized by this task.

Verification preparation is source-only. The candidate has no `node_modules`;
reuse the aligned graph at `/ai/gchat-worktrees/oi074-frontend-packages` through
the existing Linux container mounts. Route generation uses its installed
`@tanstack/router-generator` `Generator`/`getConfig`, with the same React,
`autoCodeSplitting` and ignore-pattern options as `web-app/vite.config.ts`.
Run the nineteen `core::connectors` fixtures, five `workspace_connectors` fixtures,
`bundled_skills_follow_explicit_platform_metadata_policy`, the connections UI
fixtures and the Settings link assertion. Compile/type/lint the affected paths.
Each check answers the changed account, provider, dispatch or navigation contract;
do not repeat the accepted terminal/defaults gates or run an unrelated full suite.

See [connection setup and supported operations](operations.md) and the
[account/runtime decision](../decisions/2026-10-10-own-native-workspace-connectors.md).

## Provider authorities

- [Google native-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google service scopes](https://developers.google.com/identity/protocols/oauth2/scopes)
- [Microsoft Graph overview](https://learn.microsoft.com/en-us/graph/overview)
- [Microsoft delegated authorization](https://learn.microsoft.com/en-us/graph/auth-v2-user)
- [Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-overview)
