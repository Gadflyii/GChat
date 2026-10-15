---
date: 2026-10-15
title: "Place independent instances on shared GPUs"
---

# 2026-10-15 — Place independent instances on shared GPUs

- **Context:** Manager's one-record-per-GPU-group identity and Host's GPU overlap
  veto prevent users from placing multiple small agents on one GPU. A process's
  automatic KV allocation can consume memory needed by later instances.
- **Decision:** New launches create independent instance UUIDs even on the same
  GPU group; saved records survive Host restart. Explicit UUIDs retain lifecycle
  identity. Manager accepts a count and optional per-instance KV byte budget.
  For shared placement, Host obtains the Engine's pre-load startup quote with the
  actual launch options, reserves the non-KV requirements and headroom of the
  remaining new instances, and assigns explicit KV bytes. The default splits
  remaining KV equally and retains that first share for the batch; a user's
  byte budget replaces that split when it fits. Placement is
  serialized through Ready, with fresh quotes accounting for earlier processes.
  Instances retain distinct ports, credentials and sessions; stopping one leaves
  its peers running. Memory failures report the shortage without rewriting peers.
  Flash placement uses the Engine's explicit per-rank weight residency budget
  unchanged for quoting and startup. Its graph allowance comes from a matching
  successful Ready startup: Host retains each rank's maximum reported graph
  allocation, persists the conservative maximum across ranks, and passes it to
  the Engine quote. Receipt keys include the GPU group, startup settings and
  artifact/runtime/profile file metadata. Unknown graph allowances refuse shared
  placement with instructions to obtain the receipt. Flash's non-affine KV
  requirements are taken directly from its quote rather than extrapolated.
- **Consequences:** This supersedes [Reuse server instances across launches](2026-09-17-reuse-host-gpu-group-instances.md).
  Duplicate GPU groups are intentional and are no longer consolidated. Changed
  launch options clear qualification references. Qualification and recorded VRAM
  tiers remain evidence, not catalog visibility or launch policy. INT and SMOL
  packages are selectable on every supported GPU family; NVFP4 requires Blackwell
  sm_120. Engine validation remains authoritative for actual fit and execution.
- **Owner:** GChat Manager / Host; Engine owns the startup quote.
- **Links:** [Manager contract and acceptance](../ginfer-manager/README.md).
