---
date: 2026-10-15
title: "Confine AppImage GIO modules to the bundled directory"
---

# 2026-10-15 — Confine AppImage GIO modules to the bundled directory

- **Context:** The AppImage media acceptance recorded a host GVfs loader warning: `libgvfscommon.so` required `g_variant_builder_init_static`, which the bundled GLib did not provide. The generated GTK hook set `GIO_EXTRA_MODULES` to bundled modules, but that variable adds directories without replacing GLib's compiled-in host module directory.
- **Decision:** After linuxdeploy, append unconditional exports to its existing GTK hook setting both `GIO_MODULE_DIR` and `GIO_EXTRA_MODULES` to `$APPDIR/usr/lib/x86_64-linux-gnu/gio/modules`. Replace inherited values rather than appending host paths. Keep the bundled `libgiognutls.so` available for GIO TLS; preserve the media closure and host-tool library exclusions from the earlier decision.
- **Consequences:** Automatic GIO module discovery uses the bundled directory instead of loading newer host GVfs modules against bundled GLib. Host GIO extensions are excluded from that discovery. This does not qualify remote volumes or full AppImage portability. The earlier media decision retains its historical warning and bounded pixel acceptance; this change addresses the module search path separately.
- **Owner:** team.
- **Links:** [AppImage assembly](../../src-tauri/build-utils/buildAppImage.sh); [earlier media and host ABI decision](2026-10-15-bundle-appimage-viewer-media-with-host-abi-exclusions.md); [GLib GIO environment documentation](https://gnome.pages.gitlab.gnome.org/gtk/gio/overview.html#running-gio-applications); [GLib 2.80 module loader](https://raw.githubusercontent.com/GNOME/glib/2.80.0/gio/giomodule.c).
