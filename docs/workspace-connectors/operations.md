# Workspace connection setup and operations

This describes the implemented source. Focused checks pass; live Windows/Linux
sign-in acceptance requires registered clients and approved test accounts. The
installed application does not yet contain these connectors. See
[current delivery status](README.md).

## Connect an account

Open **Settings → Workspace connections**, choose the services and read-only or
read/write access, then sign in through the system browser. Microsoft uses the
release's public app identity when available; an existing saved registration
continues to take precedence. Google still requires its Desktop registration.
Select the account to use by default. Multiple connected accounts
can be addressed by their public account IDs; email addresses are not account IDs.

### Google: register your own Desktop app

Each user supplies their own Google Desktop OAuth client. GChat has no built-in
Google release identity. Settings provides these steps and imports the downloaded
JSON, so users do not need to copy a client ID or secret:

1. [Create or select a Google Cloud project](https://console.cloud.google.com/projectcreate).
2. Enable the [Gmail](https://console.cloud.google.com/apis/library/gmail.googleapis.com),
   [Calendar](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com),
   [Drive](https://console.cloud.google.com/apis/library/drive.googleapis.com),
   [Docs](https://console.cloud.google.com/apis/library/docs.googleapis.com),
   [Sheets](https://console.cloud.google.com/apis/library/sheets.googleapis.com),
   [Slides](https://console.cloud.google.com/apis/library/slides.googleapis.com),
   [Tasks](https://console.cloud.google.com/apis/library/tasks.googleapis.com) and
   [People](https://console.cloud.google.com/apis/library/people.googleapis.com) APIs
   in that project.
3. Open [Google Auth Platform → Branding](https://console.cloud.google.com/auth/branding)
   to configure the consent screen, then [Audience](https://console.cloud.google.com/auth/audience)
   and choose **External**. While testing, add your own Google account as a test
   user. Set the publishing status to **In production** before relying on the
   connection: External apps left in Testing receive refresh tokens that expire
   after seven days for these Workspace scopes. Production status removes that
   testing limit; users can still revoke consent and other token expiry rules
   still apply.
4. Open [Clients](https://console.cloud.google.com/auth/clients), create an OAuth
   client with application type **Desktop app**, and download its client JSON.
5. In **Settings → Workspace connections → Google**, choose the JSON file.
   GChat accepts Desktop-client JSON, saves the public ID
   and stores any registration secret in the existing OS credential vault.
   Importing another client replaces the registration and requires reconnecting
   existing Google accounts. Keep the downloaded file private; do not paste it
   into chat.
6. Choose services and access, then sign in through the system browser. If Google
   shows **Google hasn't verified this app**, proceed only if this is the app
   you just created in your own project and its requested permissions are expected.
   Expand **Advanced**, choose **Go to your app (unsafe)**, then review permissions
   and **Continue** when offered. This warning does not override an organization
   restriction or an access-denied screen. Publishing and verification are separate;
   making your app public for other users can require Google's verification.

The callback uses `http://127.0.0.1:<port>/oauth/callback` on a temporary local
listener. Imported authorization and token URLs are ignored; GChat continues to
use its fixed Google endpoints and PKCE. Import does not sign in or grant access.
If Google sign-in expires or access is removed, GChat explains that the account
must be reconnected in **Settings → Workspace connections**. A temporary network,
throttling or server error does not become a consent-revoked message.

Google documents [project creation](https://developers.google.com/workspace/guides/create-project),
[API enablement](https://developers.google.com/workspace/guides/enable-apis),
[consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent),
[Desktop credentials](https://developers.google.com/workspace/guides/create-credentials),
[refresh-token expiry](https://developers.google.com/identity/protocols/oauth2#expiration)
and [unverified-app warnings](https://developers.google.com/data-manager/api/devguides/concepts/oauth-verification).

### Microsoft: use the release sign-in

For Microsoft, select **Sign in with Microsoft**. The release registration uses
the `common` tenant and accepts work, school and personal Microsoft accounts,
including Outlook.com, Hotmail and personal OneDrive. Available services still
depend on the account. SharePoint and Windows 365 Cloud PC need a work or school
account; GChat explains that requirement when those services are selected or the
provider reports an unsupported account. It does not guess account type from an
email address or treat every permission failure as a personal account.

In Gbot Cloud PC setup, use the work or school account with an assigned Windows
365 Cloud PC, complete browser sign-in and any MFA or administrator approval,
then explicitly choose the account and Cloud PC. GChat requests read-only Cloud
PC discovery; signing in does not select a PC or grant bot control. If the
organization requires approval, ask its administrator to approve the requested
permissions, then retry. Permission and license failures remain distinct from
network, throttling and server failures.

If Microsoft sign-in is not configured in the release, GChat explains this and
disables sign-in. Users do not need to find or create an app ID. This remains
useful for development or explicitly unconfigured builds.

Organizations with an existing approved registration can expand **Advanced: use
your organization's Microsoft app** in Settings. Copy its Application (client) ID
from Microsoft Entra, confirm the Mobile and desktop applications reply URI is
`http://localhost/oauth/callback`, and supply a directory (tenant) ID if required
by the administrator. Save, choose services, then sign in. GChat uses a temporary
localhost port. Both the release identity and an omitted advanced tenant default
to `common`. A directory tenant ID intentionally restricts the advanced app to
that directory; the release does not use Ron's directory tenant ID. No Microsoft
client secret is used. Some service permissions need tenant administrator consent.
[Microsoft authorization flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow),
[localhost reply URI rules](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url).

Release builds compile the registered public client ID
`e618bfb1-eb1d-4112-ad84-e3ff963f585c` with tenant `common` through the shared
native build configuration on Linux and Windows. Build-time
`GCHAT_MICROSOFT_CLIENT_ID` and `GCHAT_MICROSOFT_TENANT` override those defaults;
an explicitly empty client ID disables default sign-in. Non-release builds do
not assume a registration. A missing, invalid or nil client UUID, or an invalid
tenant, leaves default sign-in unavailable. These are public application
identifiers, never client secrets.
The native account owner applies the default only when no Microsoft registration
is saved, without startup vault access or a configuration-file write. A later
ordinary metadata save may retain that identity; future upgrades preserve saved
registrations and their account bindings. Changing a saved registration remains
an explicit advanced action requiring account reconnection. Tests use synthetic
identifiers and local mocks; they do not sign in using the release app.

Ron must confirm the portal configuration: **Microsoft Entra → App registrations
→ GChat → Authentication → Mobile and desktop applications** must contain exactly
`http://localhost/oauth/callback`. The native callback uses this path on a
temporary localhost port, following Microsoft's loopback-port matching rules.
**Supported account types** must be **Accounts in any organizational directory
and personal Microsoft accounts**. The repository confirms the requested URL
and audience, but cannot verify the portal's saved redirect configuration.
No Microsoft client secret is required. Live consent remains Ron's release gate.

### Grants and stored credentials

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

Ron supplies his own Google Desktop registration and uses the Microsoft release
identity for live acceptance. User-approved accounts are needed to verify sign-in,
refresh, cancellation, reconnect, consent, disconnect and a disposable read/write
operation on both desktop platforms. Import Google credentials through Settings
and use the provider consent pages, not chat. Passing focused fixtures
cover request construction, state transitions, shared dispatch and connection UI;
they do not establish live provider or credential-store qualification.
