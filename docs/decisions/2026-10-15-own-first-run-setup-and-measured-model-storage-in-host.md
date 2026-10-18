---
date: 2026-10-15
title: "Own first-run setup and measured model storage in Host"
---

# 2026-10-15 — Own first-run setup and measured model storage in Host

- **Context:** Linux installation, Server Manager and GChat Welcome need the
  same resumable setup. A client-specific wizard would lose progress when its
  window closes and could disagree with the Host's downloads, hardware profile
  or saved instances. Disk names and advertised interface speeds do not prove
  useful model-read throughput or current capacity.
- **Decision:** Host persists one first-run workflow and exposes it through
  `GET` and `POST /host/v1/first-run`. The installer CLI, Manager and GChat render
  that workflow: explicitly choose a supported GPU group and initial storage,
  select published packages, download and verify them, prepare their required
  hardware measurements, review measured model locations, review startup defaults
  and save stopped instances. Persist selected release
  identities before admitting downloads so a restart can resume partial admission.
  Closing a client does not cancel Host-owned profiling, downloads or an admitted
  model move.
- **Storage policy:** Rank only native schema-version-2 disk rows with successful
  direct-I/O sequential-read measurements. Match their saved filesystem UUID,
  model and available serial to live disk identity, then check native placement,
  writability and live free space. Retain unmeasured or ineligible rows with their
  reason. Preserve the requested directory on the same filesystem; offer another
  disk's measured directory with the existing `ginfer/models` convention when it
  wins. Users can override the recommendation with a writable native directory.
  Recommendation performs no throughput benchmark and moves no model.
  After selected-artifact profiling is accepted, every client presents the same
  Host-owned storage review before startup quotes. Show each installed package's
  current path and actual size, measured rates, live space, ineligibility reasons
  and recommendation. Rank destinations against the total selected size, crediting
  verified-size files already retained in that folder; bytes still to be moved
  need the existing mover's staging reserve. A missing rate does not prevent an
  explicit choice to retain installed files.
- **Review policy:** Persist an explicit keep decision bound to the selected
  package identities, sizes and paths, GPU group, accepted native disk-profile
  section and managed root. Reopening a client or restarting Host preserves an
  unchanged review. Fresh artifact Ensure may refresh unrelated GPU timings and
  source metadata without invalidating Keep; a changed disk measurement, package
  or root requires another review. Reject a stale review key. Arch signed this
  storage-specific binding after the native restart reproduction on October18.
  Choosing a different managed folder saves the destination but neither moves
  installed files nor accepts their placement. Keep and move remain separate
  explicit actions shared by the CLI, Welcome and Manager.
- **Move policy:** Only an explicit move action can relocate an installed managed
  download. Reject active sources and existing targets. Copy into owned staging,
  sync and verify the package's immutable bytes and identities, publish without
  overwrite, and durably update the download journal before deleting the source.
  Preserve the model's inventory identity and saved instance references. Failures
  before journal commitment retain the source; cleanup failure after commitment
  reports the remaining original. Discovered external model roots stay in place.
  A selected package move invalidates its placement review and startup quotes.
  Revalidate selected-artifact acceptance at the new path, then require a fresh
  placement decision and fresh quotes before completion.
- **Startup policy:** Engine `--quote-only` supplies each package's startup and
  KV estimates for the selected GPU group. These are estimates for that package,
  not proof that several selected packages coexist or that full context is
  qualified. Quotes wait for the explicit measured-placement review. Completion
  saves stopped instances; a later explicit Start uses the
  normal lifecycle and admission checks.
- **Consequences:** Clients share durable progress, an initial download destination
  and the later measured-placement decision.
  Missing measurements, changed disk identity or insufficient live space remain
  visible instead of acquiring a guessed rate. Existing locations remain usable
  through inventory and download journals. Linux native acceptance and Windows
  qualification remain separate; Windows currently shares source only for this
  change.
- **Owner:** GChat team.
- **Links:** [Manager workflow and API](../ginfer-manager/README.md),
  [operator guide](../ginfer-manager/guide.md),
  [installer continuation](../lan-host-setup.md),
  [Host workflow](../../src-tauri/ginfer-host/src/first_run.rs),
  [storage policy](../../src-tauri/ginfer-host/src/model_storage.rs),
  [managed downloads](../../src-tauri/ginfer-host/src/model_downloads.rs).
