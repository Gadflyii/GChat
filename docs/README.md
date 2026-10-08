# GChat documentation

Start with the root [README](../README.md) for product scope and releases, or
[DEVELOP](../DEVELOP.md) for the development loop.

| Topic | Reference |
| --- | --- |
| Current installer refresh | [Installer refresh](installer-refresh/README.md) |
| Shared Chat/Agent capabilities and recovery | [Agent runtime](agent-runtime/README.md) |
| Remaining release acceptance | [Open work](open-work.md) |
| Verification and its limits | [Critical flows](testing-critical-flows.md) |
| Model/profile ownership and launcher | [Model management](model-management.md) |
| Recorded profile qualification | [Profile evidence](model-profile-evidence.md) |
| GInfer host UI state | [Host UI](host-ui/README.md) |
| Standalone GInfer Server Manager | [Manager status](ginfer-manager/README.md) |
| Network host installation and pairing | [Host setup](lan-host-setup.md) |
| Native worker pools and compaction | [Worker pools](agent-worker-pools-design.md) |
| Personal/workspace memory | [Memory](memory.md) |
| Architecture decisions | [Decision index](decisions/INDEX.md) |
| Native agent implementation | [Agent architecture](../src-tauri/src/core/agent/ARCHITECTURE.md) |

The Next.js/MDX documentation site also lives here. Its inherited pages are not a
release-qualification record; use the references above for current implementation
and acceptance status. Website development commands are in `package.json`.
