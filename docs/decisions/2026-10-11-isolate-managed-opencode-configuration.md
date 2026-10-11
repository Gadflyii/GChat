---
date: 2026-10-11
title: "Keep managed OpenCode configuration in the GChat data folder"
---

# Keep managed OpenCode configuration in the GChat data folder

- **Context:** Selecting a GChat model wrote the user's standalone OpenCode configuration, even when GChat used a custom data folder. Managed launch paths then read that shared configuration.
- **Decision:** Store managed configuration, theme, plugins and update logs in `<data>/code/opencode`. Desktop and CLI resolve the selected GChat data folder once per operation. All managed children receive the matching `XDG_CONFIG_HOME`, `OPENCODE_CONFIG_DIR` and `OPENCODE_CONFIG`; external terminal launches carry these assignments in their command payload. HOME stays unchanged. Never import, modify or fall back to standalone OpenCode configuration.
- **Consequences:** GChat settings follow its selected data folder across embedded Code, external Launch, CLI, readiness, updates and offline session deletion. Stock OpenCode remains unmodified; project configuration and supplemental HOME/.opencode discovery retain their upstream behavior. No guessed restoration of previously overwritten configuration is attempted.
- **Authority:** [Stock OpenCode configuration](https://opencode.ai/docs/config/), [v1.18.21 global paths](https://github.com/anomalyco/opencode/blob/v1.18.21/packages/core/src/global.ts), [v1.18.21 directory discovery](https://github.com/anomalyco/opencode/blob/v1.18.21/packages/opencode/src/config/paths.ts).
- **Implementation and acceptance:** [Current Code isolation](../agent-runtime/remaining-acceptance.md#current-code-configuration-isolation), `src-tauri/src/core/system/opencode_config.rs`.
