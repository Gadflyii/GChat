---
date: 2026-10-15
title: "Bundle AppImage viewer media with host ABI exclusions"
---

# 2026-10-15 — Bundle AppImage viewer media with host ABI exclusions

- **Context:** The mounted AppImage kept its GUI and WebProcess alive but showed a black desktop view; GStreamer reported that `appsink` was missing. Adding the build container's media closure then shadowed host libraries: bundled `libssh.so.4` lacked `LIBSSH_4_10_0`, preventing host `virsh` from checking the saved bot computer.
- **Decision:** Enable Tauri's AppImage media bundling and explicitly install the existing GStreamer base, good, bad, libav and GL packages in the Linux build image and release job. After linuxdeploy, prune the twelve evidence-confirmed host-tool library SONAMEs and their dot-version targets from the AppDir's `usr/lib` root. Keep GStreamer plugins and their remaining dependencies, including `libssh-gcrypt.so.4`.
- **Consequences:** Host libvirt, QEMU and SSH tools can resolve the excluded libraries from the host instead of the older AppImage copies. This makes those host libraries a compatibility prerequisite; it does not establish support for every distribution. The pruning does not enter GInfer or Cua private resource directories. The original three packaging changes passed one full `make verify`; the later shell-only exclusions passed focused syntax, exact-list and path-boundary checks separately. One mounted AppImage with this closure and exclusions showed real view-only desktop pixels on the dedicated Debian fixture at 22:58:08Z; the same GUI, WebProcess, NetworkProcess and service remained alive at 22:58:32Z with bundled appsink/libav mapped and no shared-display assertion. The ordinary View helper reported an accessibility error despite the confirmed stream and pixels. The inherited host GIO/GVfs warning remains: `libgvfscommon.so` cannot resolve `g_variant_builder_init_static`, and `libgvfsdbus.so` fails to load. This bounded pixel pass does not qualify those host modules or the full portable dependency closure; DEB remains recommended.
- **Owner:** team.
- **Links:** [AppImage assembly](../../src-tauri/build-utils/buildAppImage.sh); [Linux bundle configuration](../../src-tauri/tauri.linux.conf.json); [Gbot design](../gbot/README.md); retained evidence `out/gbot-appimage-media-closure-20261015/` and `out/gbot-appimage-refresh-20261015/`.
