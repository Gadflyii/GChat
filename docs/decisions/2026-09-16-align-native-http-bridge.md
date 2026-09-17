# Align the native HTTP bridge

Status: accepted

GChat's JavaScript HTTP plugin was pinned to 2.5.0 while Cargo resolved 2.5.7.
The former expects response bodies on an IPC Channel; the latter returns one
framed binary chunk per `fetch_read_body` invocation. Requests reached the
engine, but the webview waited indefinitely for channel events that never came.

Pin both web-app and GInfer extension guest dependencies, and both Rust target
dependencies, to 2.5.7. Use the matching native bridge for context preparation
and streaming. Remove the custom streaming IPC bypass rather than switching to
browser fetch. Preserve the 30-minute inactivity limit without a total-generation
deadline. Reader cancellation and abort signals propagate through the plugin.

Regression tests exercise the installed guest package against the native
returned-chunk protocol, including JSON, SSE, EOF and body cancellation.
The model picker excludes host records marked local from its LAN projection,
while retaining those records in Infrastructure and agent routing inventory.
