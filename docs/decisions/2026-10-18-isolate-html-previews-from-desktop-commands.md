---
date: 2026-10-18
title: "Isolate HTML previews from desktop commands"
---

# 2026-10-18 — Isolate HTML previews from desktop commands

- **Context:** Model-generated HTML is active, untrusted content. Pinned Tauri 2.10.3 classifies every custom protocol registered through its builder as a local application origin. Plugin-only capability restrictions also leave application commands outside the app ACL until an application permission manifest exists.
- **Decision:** Explicit application permissions admit registered commands only from the main local webview. Auxiliary windows use fixed native routes and limited capabilities. Every window installs navigation guards before loading application content. HTML previews use a private, immutable cache addressed by opaque IDs and native WebKit/WebView2 handlers outside Tauri's protocol registry. They remain sandboxed without `allow-same-origin`; response CSP blocks desktop/asset connections, nested frames, and forms. Existing asset protocol access stays available to application attachments and installed extensions.
- **Consequences:** Previews retain inline scripts and styles but cannot fetch local files or use desktop commands. Windows intercepts every request to the preview host before application navigation, including invalid paths, and fails closed. External new-window links open in the system browser. New application commands require an explicit permission entry. The native scheme needs direct declarations of already-pinned WebKit, Soup, and WebView2 dependencies; no package versions change. Startup and normal exit clear only the dedicated preview cache.
- **Owner:** team; design approved by claude-arch on 2026-10-18.
- **Links:** `src-tauri/permissions/app.toml`, `src-tauri/src/core/webview_security.rs`, `src-tauri/src/core/preview_protocol.rs`, `src-tauri/src/core/artifact.rs`, `web-app/src/containers/HtmlArtifact.tsx`.
