---
date: 2026-10-15
title: "Preserve WebKit display with shared-memory buffers"
---

# 2026-10-15 — Preserve WebKit display with shared-memory buffers

- **Context:** The previous Linux default, `WEBKIT_DISABLE_DMABUF_RENDERER=1`, leaves the GStreamer WebCodecs shared display uninitialized on the tested Debian 13 X11 VM with WebKitGTK 2.54.0. Opening the Gbot H.264 desktop viewer aborted the WebProcess. Captured mappings and the exact installed ELF resolve the stack to the `PlatformDisplay::sharedDisplay()` assertion while the decoder requests `gst.gl.GLDisplay`; selecting a software decoder did not avoid that initialization path.
- **Decision:** Before creating the Linux webview, default `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` only when both it and `WEBKIT_DISABLE_DMABUF_RENDERER` are absent. Preserve every explicit value. This is an app-process default, not a system environment policy, and supersedes [the previous rendering default](2026-08-03-disable-webkit-dmabuf-rendering-on-linux.md).
- **Consequences:** Shared-memory buffer transport can retain WebKit's display initialization; it still requires working EGL/GL support. An environment-only retest of the unchanged installed GChat `00068f2a8` observed the real remote desktop during an approximately 54-second view-open interval, closed normally, and retained the same live GUI and WebProcess 70 seconds after close. This qualifies the tested Debian 13 X11 VM and WebKitGTK 2.54.0 viewer path only; the original Fedora 42 AppImage emoji/Mesa regression, response Markdown rendering, a rebuilt native candidate, and new packages remain unqualified. No driver fallback is prescribed without evidence that a real GPU/driver requires one.
- **Owner:** team.
- **Links:** `src-tauri/src/main.rs`; retained mapped stack: `/ai/gchat/out/gbot-linux-walkthrough-20261014/final-refresh-20261015/viewer-webprocess-symbolized-backtrace.txt`; WebKit tag `webkitgtk-2.54.0`: [display assertion](https://github.com/WebKit/WebKit/blob/webkitgtk-2.54.0/Source/WebCore/platform/graphics/PlatformDisplay.cpp#L69-L72), [decoder GL context](https://github.com/WebKit/WebKit/blob/webkitgtk-2.54.0/Source/WebCore/platform/graphics/gstreamer/VideoDecoderGStreamer.cpp#L178-L190), [buffer transport selection](https://github.com/WebKit/WebKit/blob/webkitgtk-2.54.0/Source/WebKit/UIProcess/gtk/AcceleratedBackingStore.cpp#L78-L140), [display initialization](https://github.com/WebKit/WebKit/blob/webkitgtk-2.54.0/Source/WebKit/WebProcess/glib/WebProcessGLib.cpp#L142-L185).

<!--
Supersedes: 2026-08-03-disable-webkit-dmabuf-rendering-on-linux.md
-->
