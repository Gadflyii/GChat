---
date: 2026-10-17
title: "Reuse verified model payloads with file identity"
---

# 2026-10-17 — Reuse verified model payloads with file identity

- **Context:** Every qualified-profile Start read and SHA-256-hashed the full model payload, including packages already verified during download or installation. Large packages therefore repeated a complete file read before Engine creation. Artifact-directory hashes identify metadata and cannot prove the whole payload.
- **Decision:** Persist successful whole-file verification with its expected SHA-256, size, high-resolution modification time and operating-system file identity: Linux device/inode and ctime, or Windows volume serial/file index and ChangeTime. Qualified Start may reuse the record only when the expected package and current file information match. Missing or changed information requires complete verification before loading; an explicit verification operation always hashes the file. Managed download/install verification records the same evidence in the existing download journal. The existing Host state also retains records by canonical payload path for qualified packages, including imported files, across process restarts.
- **Consequences:** An unchanged verified package avoids a repeated payload hash on qualified Start. Changed, replaced or unrecorded files still require verification. Verification failures never create reusable records. The file-identity checks are covered through Linux and Windows paths; this decision makes no native Windows qualification or measured startup-time claim.
- **Owner:** team.
- **Links:** `GCHAT-QUALIFIED-START-PAYLOAD-REHASH-20261017`; [Manager verification policy](../ginfer-manager/README.md#qualified-profile-payload-verification--october-17); `src-tauri/ginfer-host/src/launch_profiles.rs`; `src-tauri/ginfer-host/src/model_downloads.rs`; `src-tauri/ginfer-host/src/service.rs`.
