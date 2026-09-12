# Remove external telemetry

GChat does not collect product analytics or upload automatic crash reports.
The user requested removal, not an opt-out default or a dormant transport.

Remove PostHog, Sentry and Google Analytics integrations, their event producers,
anonymous identity/consent state, upload build jobs, credentials, dependencies
and tracking policy UI. Documentation-site tracking is removed as well.
This supersedes the earlier analytics, funnel and crash-reporting decisions.

Keep local logs, panic diagnostics, render-error recovery, Engine measurements,
token timing and Agent Studio monitoring. Remote models, LAN hosts, updates,
downloads and explicitly enabled tools still make their normal network requests.
No chats, models or installed user settings are deleted by this source change.
