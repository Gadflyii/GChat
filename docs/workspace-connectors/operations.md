# Workspace connection setup and operations

This describes the implemented source. Focused checks and live Windows/Linux
sign-in acceptance are pending; the installed application does not yet contain
these connectors. See [current delivery status](README.md).

## Connect an account

Open **Settings → Workspace connections**, configure the provider registration,
choose the services and read-only or read/write access, then sign in through the
system browser. Select the account to use by default. Multiple connected accounts
can be addressed by their public account IDs; email addresses are not account IDs.

Google needs a Desktop application OAuth client and the selected service APIs
enabled in that project. The callback uses `http://127.0.0.1:<port>/oauth/callback`
on a temporary local listener. Enter a registration secret only if required by
that Desktop client; GChat stores it in the OS vault. Test users, consent status
and organization policy must admit the account and requested scopes.
[Google native-app authorization](https://developers.google.com/identity/protocols/oauth2/native-app).

Microsoft needs a public desktop/native application registration with delegated
Graph permissions and reply URI `http://localhost/oauth/callback`. GChat uses a
temporary localhost port. Choose an account audience matching the registration;
an omitted tenant uses `common`. No Microsoft client secret is used. Some service
permissions need tenant administrator consent.
[Microsoft authorization flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow),
[localhost reply URI rules](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url).

The provider consent screen controls actual grants. Settings displays the granted
scopes and reconnect status. Changing registration or expired consent requires
reconnection. Windows uses the existing native credential store; Linux requires
the existing Secret Service credential backend. Tokens are not exposed to models
or saved in the public connection metadata.

Read-only access restricts GChat operations. Provider permissions can be broader:
Graph Excel requires `Files.ReadWrite` even for workbook reads. Google Gmail
read/write requests the full mail scope to support permanent deletion. The current
service-level grant covers that service's supported operations; narrower
operation-level consent is not implemented.

## Supported source operations

| Google service | Operations |
| --- | --- |
| Gmail | Search/read messages and threads; labels; drafts; send/reply; attachments; trash/restore/delete |
| Calendar | List calendars/events; event create/update/delete; free/busy; optional meeting link |
| Drive | Search/metadata; download/upload/update bytes; folders; move/share/trash |
| Docs | Read/create; typed text, formatting, image, table and bullet edits; Drive export |
| Sheets | Metadata/create; read/write/append cell ranges |
| Slides | Read/create; typed slide, shape, image, text and formatting edits |
| People | List/read/search/create/update/delete contacts |
| Tasks | Task lists and task CRUD; move tasks within a list |

| Microsoft service | Operations |
| --- | --- |
| Outlook | Search/list/read mail; list root/child folders; create/update/send drafts; send/reply/forward mail; list/read/add file attachments; move/trash/delete mail |
| Calendar | Calendar CRUD; events and expanded calendar views; event CRUD; free/busy |
| Contacts | List/read/create/update/delete contacts |
| OneDrive | Drives and item metadata/list/search; download/upload; folders; move/share/delete |
| SharePoint | Site search/read; list document-library drives for OneDrive operations |
| Teams | Teams/channels/chats/messages; send and channel replies; standalone online meetings |
| To Do | List and task CRUD |
| OneNote | Notebooks/sections/pages; create; read/edit/delete pages |
| Excel | List/add worksheets; read/write worksheet ranges in workbooks in the selected account's default drive |

Exact fields and supported edit variants come from the discovered capability
schema. These adapters do not expose every Google or Graph API. Microsoft Word
and PowerPoint native editing are not included. Teams, standalone online meetings,
SharePoint and calendar free/busy require Microsoft work/school accounts.
Standalone Teams meetings do not create calendar events or invitations; use
Calendar event creation for those. Excel requires `Files.ReadWrite` even for
read-only operations; personal-account availability remains subject to Graph's
workbook and storage restrictions. Account licensing, tenant policy and resource
permissions still apply.

## Use in Chat, Agent and Code

Ask normally for an operation, for example “find last week's email from Sam” or
“read the next seven days of my calendar.” Each mode discovers the same native
capabilities; [the current record](README.md#current-implementation) lists its
tool wrappers. Only tools with a connected, consented account are advertised.

An explicit `account_id` selects a connected account. Omitting it uses the selected
provider default. The shared runtime freezes the exact account before approval
and applies existing session permissions and network policy. Sending, editing,
sharing and deletion use that same permission path in all three modes.

Keep account, operation and resource consistent while following paging tokens.
Do not call raw HTTP with a provider token or assume the first page is exhaustive.
Downloads and exports return encoded content; save it through separately permitted
local file tools. Providers retain their file-format and transfer limits.

Successful local disconnect removes that account's refresh token, cached access
token and connection metadata, including its selected default; provider
registration and any stored Google registration secret remain. Google also offers
explicit consent revocation. Microsoft tenant consent removal belongs in the provider's
account/organization portal; GChat does not revoke unrelated application sessions.

## Acceptance still needed

Registered Google and Microsoft client IDs and user-approved test accounts are
needed to verify sign-in, refresh, cancellation, reconnect, consent, disconnect
and a disposable read/write operation on both desktop platforms. Enter credentials
through Settings and provider consent pages, not chat. Prepared, unrun fixtures
cover request construction and state transitions; they do not establish live provider
or credential-store qualification.
