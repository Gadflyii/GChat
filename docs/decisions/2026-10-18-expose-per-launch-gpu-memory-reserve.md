---
date: 2026-10-18
title: "Expose the per-launch GPU memory reserve"
---

# 2026-10-18 — Expose the per-launch GPU memory reserve

- **Context:** GInfer already accepts `--kv-arena-headroom-bytes`, and Host
  launch options already persist and forward it. Users need to reserve memory
  for desktop or game use on each selected graphics card.
- **Decision:** Expose `kv_arena_headroom_bytes` in the Host model editor's
  Advanced settings as **GPU memory to keep free (MB)**. New custom launches
  explicitly use 300 MB; one displayed MB represents 1,048,576 bytes. Editing
  inherits the saved launch value. Require a nonnegative safe integer byte
  value before quote, launch or save. Confirmed Save and restart applies edits;
  editing alone does not change the running instance. Preserve signed profile
  values and the Host API's existing omission semantics.
- **Consequences:** Quote, saved launch and reload use the same byte value.
  Automatic KV sizing can reduce its arena; a fixed arena can fail the Engine's
  strict post-attach headroom check. Show that actual diagnostic and recovery
  guidance directly, retaining the complete log under Technical details.
  No new global preference, Host schema or Engine admission policy is introduced.
- **Owner:** Codex 3; claude-arch confirmed launch/profile ownership on
  2026-10-18 at 17:40Z; Codex 1 confirmed the existing Engine diagnostic.
- **Links:** [Host UI authority](../host-ui/README.md),
  [Custom startup ownership](2026-10-18-own-custom-ginfer-startup-in-hosts.md).
