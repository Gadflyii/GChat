# Google Workspace and Microsoft 365 connectors

## Current outcome and scope

Ron authorized adding these connectors to the master TODO list and implementing
both through parallel agents on October 10, 2026. Deliver bundled Windows/Linux
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
configuration, per-service grants, selected accounts and refresh. Tokens and any
Google desktop registration secret belong in the OS credential vault; frontend and
model receive public metadata only. Use existing dependencies. Provider adapters
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
| Root | Subject record, integration, review, master TODOs | In progress |
| review_host_transport | `core/connectors/mod.rs`, `accounts.rs`, native command registration | Shared account lifecycle and API contract |
| review_host_catalog | `core/connectors/google.rs` | Google typed adapters |
| review_host_startup | `core/connectors/microsoft.rs` | Microsoft typed adapters |
| review_host_process | Existing shared agent capability, tool, permission and command dispatch | Shared runtime wiring |
| review_master_findings | Settings connections route, service client and focused UI fixtures | Account connection UI |

All source lives in `/ai/gchat-worktrees/workspace-connectors-f111`, branch
`feat/gchat-workspace-connectors`, baseline `f111810ec`, owned by GChat/root.
Main stays unchanged pending reviewed integration. No connector build, model run,
GPU booking, live account, registration or provider mutation has begun. Agents
write disjoint files; root reviews actual diffs and commits before compilation.
No disposable build directory or copied model/artifact exists for this subject.

## Acceptance and next action

Complete the account lifecycle, provider tools and shared UI/dispatch. Verify the
changed auth transitions, exact provider request construction, account resolution
before approval, paging/redirect ownership and connection UI with focused checks;
run affected compile/type checks, not an unrelated full suite. Document supported
operations, scopes and account limitations. Native Windows/Linux OAuth and live
read/write acceptance require real registered client IDs and a user-approved test
account; these prerequisites are not available yet. Source fixtures cannot be
reported as live sign-in or provider qualification.

Next: freeze the account/tool contract, implement each assigned source boundary,
then review and run focused checks after the current installed reconnect gate
releases its CPU guard. No publication, signing, production account mutation,
new dependency or paid Arbitor implementation is authorized by this task.

## Provider authorities

- [Google native-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google service scopes](https://developers.google.com/identity/protocols/oauth2/scopes)
- [Microsoft Graph overview](https://learn.microsoft.com/en-us/graph/overview)
- [Microsoft delegated authorization](https://learn.microsoft.com/en-us/graph/auth-v2-user)
- [Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-overview)
