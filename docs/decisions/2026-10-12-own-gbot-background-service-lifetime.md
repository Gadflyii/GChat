---
date: 2026-10-12
title: "Own Gbot lifetime in a native background process"
---

# 2026-10-12 — Own Gbot lifetime in a native background process

- **Context:** The in-process Gbot runtime stopped tasks and schedules when GChat exited. The connectorless standalone service could not preserve existing Google/Microsoft accounts or the packaged Cua executor.
- **Decision:** GChat starts or reconnects to a separately owned invocation of its installed executable, before any Tauri/webview startup. That process owns the existing Gbot API/runtime, native account/provider/vault owner, pinned packaged executor and guided KVM setup under the exact selected data folder. Native authenticated HTTP clients proxy UI, Chat and Code connector operations to this single owner. Closing GChat drops its client subscription. Explicit Quit Gbot service drains the runtime and releases service ownership. AppImages re-execute the outer image so the service owns its own resource mount.
- **Consequences:** The service credential remains in the native vault; discovery contains no secret. Workspace, assignment, connector-link, approval and schedule authorities retain their existing formats and owners. Native connector cancellation crosses the process boundary with a registered request identity and no automatic operation retries. The former incomplete standalone server entry is removed; its KVM maintenance subcommands remain. Background inference requires an independently running Host endpoint, stated beside the unchanged brain assignment inputs; GChat's port 1337 facade retains its existing lifetime. No login/autostart policy is added.
- **Owner:** GChat.
- **Links:** [Implementation and verification](../gbot/background-service.md), [current Gbot record](../gbot/README.md), [Cua owner map](../gbot/cua-map.md).
