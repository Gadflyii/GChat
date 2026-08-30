---
date: 2026-08-30
title: "Autoload the first GInfer model as the persisted default"
---

# 2026-08-30 — Autoload the first GInfer model as the persisted default

- **Context:** GChat's cold-start policy left the model selector blank and the
  only installed GInfer model stopped until the user selected it again. That
  contradicted the product's install-and-run experience, and later background
  model detections could also replace the model a user had already chosen.
- **Decision:** model preloading is on by default. The first usable downloaded
  or detected GInfer model immediately claims the persisted default and loads;
  later detections preserve that choice, while an explicit model-picker choice
  replaces it. The existing preload toggle remains available as an opt-out.
- **Consequences:** a one-model installation is ready after app startup without
  another click. Existing development profiles receive a one-time migration to
  the new default. Startup consumes the VRAM needed by the selected model unless
  the user disables model preloading.
- **Owner:** `team`
- **Links:** `web-app/src/hooks/useGeneralSetting.ts`,
  `web-app/src/containers/DropdownModelProvider.tsx`,
  `web-app/src/providers/DataProvider.tsx`

Supersedes: 2026-08-19-do-not-preload-a-model-on-startup.md
