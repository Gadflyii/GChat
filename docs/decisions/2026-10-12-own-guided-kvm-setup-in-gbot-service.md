---
date: 2026-10-12
title: "Own guided KVM setup in the Gbot service"
---

# 2026-10-12 — Own guided KVM setup in the Gbot service

- **Context:** The existing local KVM adapter provisions a dedicated guest, but the product wizard only registered existing SSH computers. Setup must survive a closed wizard and service restart without creating another VM or vault credential.
- **Decision:** The existing workspace runtime owns one Linux `KvmSetup` owner. Persist its stable workspace/VM UUID, session identity, vault reference, guest specification, console-pinned SSH host key and concrete stage in the existing GChat data root. The wizard explicitly starts, resumes or removes this owned ID through four service POST routes. No separate Tauri lifetime owner or executor is introduced.
- **Prerequisites:** Detect Linux x86-64, usable `/dev/kvm`, the user libvirt session, QEMU, qemu-img, genisoimage, CPU/memory/disk capacity and accepted asset bytes. Missing tools or assets return an exact next action before generating credentials or creating a guest. Setup does not install host tools, fetch images/archives or switch to a LAN computer.
- **Ownership:** Generate an Ed25519 key only in the native vault; store only its reference/public key. Publish the adapter claim atomically, reuse the exact saved specification/SSH port, and reconcile an interrupted definition before rebuilding unregistered partial output. Removal cancels the same setup and refuses foreign workspace ownership, live human control and unsettled operations. Configured model/account links must be resolved before removal; unrelated credentials and VM directories are preserved.
- **Readiness:** Read the guest host key from the owned libvirt serial log. Use the existing SSH transport, command/file operations and Cua tools to read back a harmless owned document, observe its dedicated Mousepad window, enter and save harmless text, independently read back that desktop effect through SSH and obtain a desktop image. The pinned browser is Chromium, as required by the accepted Driver page-binding contract. Open and revoke a view-only media lease before success. A saved Ready result becomes resumable after service restart and requires these checks again. Ready requires an actual image and successful media negotiation; these paths remain unqualified until physical provisioning and browser playback acceptance run.
- **Consequences:** The release must stage the approved image, driver and media archives under `<GChat data>/gbot/vms/assets/`. They are currently local accepted prerequisites, not packaged product assets. Their absence keeps setup blocked. Hyper-V, cloud/M365, remote service selection and installed VM/UI acceptance remain unfinished.
- **Owner:** GChat.
- **Links:** [Gbot contract and existing evidence](../gbot/README.md), [remaining installed acceptance](../agent-runtime/remaining-acceptance.md), [libvirt/Cua ownership](2026-10-11-use-libvirt-session-and-cua-for-gbot-guests.md).

## Accepted asset contract

These are existing accepted records, not newly obtained or generated hashes. `kvm_setup.rs` compares the staged bytes before using the adapter. Driver/media are copied onto the existing NoCloud seed and independently verified before guest extraction.

| Asset filename under `vms/assets/` | Digest | Source provenance |
| --- | --- | --- |
| `debian-13-genericcloud-amd64-20261001-2618.qcow2` | SHA-512 `f46f0671a6e5bdec5291ab8972bae2f10e5408c2f64a74078f11efc2f06a436a9d0313ed50e0472542eeabf780e9f7c792ac0a314c6c20507fcd9fd81b468c3d` | Accepted 341508096-byte Debian 13 image record `/ai/gchat/out/gbot-kvm-prep-20261011/s1-evidence/debian-image.json`, with `/ai/gchat/out/gbot-kvm-prep-20261011/s1-image-staged.log`; existing README records verification against official SHA512SUMS. Original URL: `https://cloud.debian.org/images/cloud/trixie/20261001-2618/debian-13-genericcloud-amd64-20261001-2618.qcow2`. |
| `cua-driver-c549ab4d7.tar.gz` | SHA-256 `2532c8bb8c6bef4f179285c58241a2f46c8fd2e1f6228c65bb65a1e6176261c6` | Existing Gbot README Driver acceptance record; pinned revision `c549ab4d7f31a08c339da1732700b6664af438a6`. |
| `cua-spacesd-native-20261012.tar.gz` | SHA-256 `f7d2d547ad4d94759aba93a5eb37ad1b5b93d5272074273a5ed4a130ee0b0ed7` | Existing Gbot README Cua media packaging record and accepted archive `/media/ron/SSD_RAID/ai/gbot-cua-media-20261012/results/cua-spacesd-native-20261012.tar.gz`; SDK/media revision `0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc`. |
