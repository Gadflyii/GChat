---
date: 2026-10-12
title: "Deliver pinned Gbot guest resources through the installer"
---

# 2026-10-12 — Deliver pinned Gbot guest resources through the installer

- **Context:** Guided KVM setup requires three accepted local payloads under the configured GChat data folder. The existing Linux bundle already carries `resources/gbot/**/*`, but its resource installer did not deliver guest assets. Missing bytes must continue to block setup before credentials or VM creation.
- **Decision:** Keep the exact accepted pins in immutable product data, `src-tauri/gbot-service/guest-assets.json`, compiled into the setup service and read by the existing packaging script. This is the only active asset-pin authority, not a user setting. The existing release script requires an explicit local `--gbot-guest-assets` directory; the caller assembles accepted local paths without downloads or regenerated payloads. Package them under `resources/gbot/assets/` and verify them before and after AppImage reinjection. The existing `core/setup.rs` Linux desktop/headless installer uses its existing configured-data-folder resolver to deliver them to `<data>/gbot/vms/assets/`.
- **Publication and retry:** Verify every source and existing final file before delivery. Copy each absent file to an owned same-directory `.installing` file, verify the copied bytes, sync and atomically rename it. Interrupted partials are recreated, including read-only partials; already accepted finals are reused. Mismatched source or final bytes are refused, never overwritten or promoted. Readiness remains service-owned and requires all accepted pins plus the existing physical checks.
- **Optional feature:** Missing resource directories skip delivery. Other delivery failures are logged without disabling ordinary GChat. Enabled KVM setup reports its explicit missing/mismatched path and corrective release/local-staging action; no fallback download, relaxed Ready result, or alternate guest is introduced.
- **Consequences:** Local release assembly and installed-data delivery now have source implementations. Release publication of these exact payloads and an actual installed wizard-created VM remain separate unrun acceptance. No hosted archive URL is selected or inferred. Existing accepted large assets were neither copied nor downloaded for this change.
- **Owner:** GChat.
- **Links:** [Accepted provenance and KVM semantics](2026-10-12-own-guided-kvm-setup-in-gbot-service.md#accepted-asset-contract), [build input and data path](../../DEVELOP.md#complete-linux-release), [implementation evidence and inventory](../gbot/asset-delivery.md).

The preceding KVM ADR's digest table is historical accepted provenance. Its former statement that no product delivery path exists is superseded by this decision; physical packaging/publication qualification remains outstanding.
