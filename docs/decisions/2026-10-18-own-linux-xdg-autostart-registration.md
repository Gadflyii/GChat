---
date: 2026-10-18
title: "Own Linux XDG autostart registration"
---

# 2026-10-18 — Own Linux XDG autostart registration

- **Context:** the installed Linux app's explicit Launch at startup toggle
  failed with `No such file or directory (os error 2)` in a fresh private
  home. The autostart dependency writes under `HOME/.config/autostart`, ignores
  `XDG_CONFIG_HOME` and creates only the final directory. It also records the
  inner executable when launched from an extracted AppDir, bypassing AppRun's
  required runtime environment.
- **Decision:** own the Linux `autostart/GChat.desktop` entry beneath Tauri's
  resolved configuration directory. Create missing parent directories, report
  filesystem failures and quote the startup executable as one literal desktop
  Exec argument. Target the retained AppImage path, extracted AppDir's AppRun,
  or ordinary executable, in that order. Route Settings and startup preference
  reconciliation through the same native read/set commands. Windows retains
  the existing autostart plugin's registry implementation.
- **Consequences:** an explicit enable works with a fresh home and an absolute
  `XDG_CONFIG_HOME`; disabling removes only GChat's entry and is idempotent.
  Native state is read back before saving the preference, and errors preserve
  the existing toggle recovery behavior. The Linux plugin registration is
  replaced rather than retained as a second owner. This does not change the
  opt-in policy, introduce a second config directory or manage other apps'
  startup entries. Moving an AppImage or AppDir requires enabling startup
  again from its new location.
- **Owner:** `team`.
- **Links:** [Opt-in policy](2026-08-19-leave-launch-at-startup-off-for-new-installs.md),
  [current acceptance and evidence](../host-ui/README.md#linux-launch-at-startup-xdg-path--october-18),
  `src-tauri/src/core/system/autostart.rs`,
  `web-app/src/lib/launchAtStartup.ts`.
