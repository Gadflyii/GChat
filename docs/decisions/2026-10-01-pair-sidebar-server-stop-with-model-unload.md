---
date: 2026-10-01
title: "Pair sidebar server Stop with scoped model unload"
---

# Pair sidebar server Stop with scoped model unload

- **Context:** the sidebar shortcut starts a model and the Local API Server together, but Stop closed only the API and left the GInfer model resident. The API may also be stopped while that model remains loaded.
- **Decision:** the sidebar Stop action closes the API when running, then unloads only the shortcut's active local model through its owning provider and refreshes loaded-model state. When only the model remains loaded, offer Start server, Reload model and Stop model. The Local API settings and tray controls remain independent API controls.
- **Consequences:** an unload failure leaves the API stopped and is reported as a partial stop; failure to stop the API leaves the model loaded. Other resident host instances are outside this shortcut's unload target.
- **Owner:** team.
- **Links:** [Sidebar shortcut](../../web-app/src/components/left-sidebar/ServerQuickActions.tsx), [model service](../../web-app/src/services/models/default.ts).
