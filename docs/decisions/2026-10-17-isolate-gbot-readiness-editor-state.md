---
date: 2026-10-17
title: "Isolate Gbot readiness editor state"
---

# 2026-10-17 — Isolate Gbot readiness editor state

- **Context:** A watched saved-setup check launched the correct Mousepad document, but Mousepad displayed its previous-session recovery question before opening it. `--disable-server` creates a separate editor process; it does not isolate saved settings or recovery files. The existing document-title gate correctly rejected the dialog.
- **Decision:** Give the readiness editor's existing transient user unit a private, mode-0700 runtime directory that is removed when that unit stops. Only that editor process uses in-memory GSettings and private XDG config, data, cache and state directories within it. Keep the desktop session environment and `--disable-server`.
- **Consequences:** The disposable check neither restores nor modifies the user's editor session or unsaved recovery documents. XDG data isolation matters because Mousepad stores autosave files there. The same document title/PID/window, desktop input, save and exact readback checks still decide readiness. Unit launch or runtime-directory failures remain explicit setup failures. No recovery dialog is dismissed automatically.
- **Owner:** team.
- **Links:** `src-tauri/gbot-service/src/kvm_setup.rs`; [Mousepad recovery storage](https://github.com/xfce-mirror/mousepad/blob/mousepad-0.6.3/mousepad/mousepad-history.c); [GLib memory settings backend](https://docs.gtk.org/gio/func.memory_settings_backend_new.html); [systemd runtime directories](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#RuntimeDirectory=).
