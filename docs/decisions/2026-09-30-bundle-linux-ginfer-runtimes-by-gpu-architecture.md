---
date: 2026-09-30
title: "Bundle Linux GInfer runtimes by GPU architecture"
---

# 2026-09-30 — Bundle Linux GInfer runtimes by GPU architecture

- **Context:** The Linux desktop bundle contained a host but no engine. A temporary AppImage mount cannot serve as the executable path of a persistent per-user host, and one CUDA image cannot serve the supported SM80, SM86, SM89, and SM120a devices.
- **Decision:** Ship four exact engine images in `resources/ginfer/linux`. Validate the closed runtime set and per-file manifests, then install the images and host binary under the GChat provider data directory. The desktop registers absolute per-architecture engine paths in its existing GInfer local-host locator. On upgrade it refreshes that locator only when the registered desktop owner uses the same provider and host directory; service and other desktop owners remain untouched. The host selects an image from the selected GPU's compute capability and rejects a missing or mixed-architecture TP group. A host launched by AppImage drops mount-specific library environment before it persists.
- **Consequences:** AppImage and DEB launches use persistent engine paths, including after the AppImage mount disappears. A runtime bundle with missing, altered, or nonexecutable payloads fails startup. Existing models and application state remain outside the swapped Linux runtime directory. An already running host continues its current process configuration until it restarts. In particular, an older single-engine host needs a restart before it can use the new per-architecture map; live model instances are not stopped during app upgrade.
- **Owner:** team.
- **Links:** [Host setup](../lan-host-setup.md), [Installer refresh](../installer-refresh/README.md).
