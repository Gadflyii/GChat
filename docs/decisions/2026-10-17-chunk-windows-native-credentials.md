---
date: 2026-10-17
title: "Chunk Windows native credentials"
status: accepted
---

# 2026-10-17 — Chunk Windows native credentials

**Owner:** GChat. **Scope:** the shared Windows credential adapter used by
Chat, Manager, Gbot and workspace connectors.

## Context

Windows Credential Manager limits each credential blob to **2,560 bytes**.
The existing `keyring` 3.6.3 password API encodes text as UTF-16, so even an
ASCII token can exceed that limit at roughly half that character count.
Microsoft refresh tokens encountered during sign-in exceed the available
space, causing a successful authorization to fail when saving credentials.
Binary Gbot secrets can also exceed one native entry's capacity.

The [credential-store tiers decision](2026-10-13-credential-store-tiers.md)
keeps native Windows credentials in Credential Manager. This decision extends
that Windows backend to larger secrets; Linux tier selection, Secret Service
and the passphrase vault retain their existing behavior.

## Decision

Store byte secrets in binary Credential Manager entries under the
`app.gchat.credentials.v1` namespace. A SHA-256 identity derived from the
original service/account reference locates a root manifest. Each write uses a
fresh random generation and divides the secret into chunks of at most 2,560
bytes. The manifest records the generation, total byte length and secret SHA-256;
the byte length determines the chunk count. Neither token contents nor account names appear in chunk names.
The shared adapter uses the existing dependencies and writes no plaintext files.

Write every new chunk before replacing the single root manifest. Publication
is the manifest replacement, rather than a transaction spanning all native
entries. If writing chunks or publishing the manifest fails, the previous
committed secret remains readable. A crash before publication may leave
unreachable chunks in Credential Manager; these remain protected by the same
native storage boundary. Do not claim that publication failure guarantees
complete cleanup.

Read the manifest and its named generation, then verify the complete length
and SHA-256 before returning bytes. A present but malformed manifest, missing
chunk or failed integrity check is an error: never fall back to an older
credential in that case. The digest detects incomplete or inconsistent
storage; it does not add protection against another process running as the
same Windows user.

When no new manifest exists, read the original service/account entry using
its existing text or binary convention. Callers keep their credential
references, and existing accounts need no sign-in migration. Successful new
writes may retain that legacy entry until explicit deletion. Delete the
legacy entry before removing the manifest, then remove the generation's
chunks. If legacy deletion fails, keep the manifest and report the failure.
This ordering prevents a deleted manifest from exposing an older legacy
credential again.

## Consequences and validation

Large refresh tokens and byte secrets use several native entries without
changing the user-facing storage choice. Readers return only a complete,
verified generation. The boundary remains the current Windows user's
Credential Manager; this does not isolate credentials from other software
running as that user. Replacement is atomic at publication, while abandoned
or retired chunks can remain after interrupted cleanup.

Required regression coverage uses synthetic oversized secrets, legacy entries,
replacement/publication failures, corrupt or missing chunks, and deletion
ordering. Native Windows utils tests must qualify the real Credential Manager
round trip and cleanup. Live provider tokens, sign-in and Settings changes
are outside this storage change's tests.

## Links

- [Credential-store tiers](2026-10-13-credential-store-tiers.md).
- [Microsoft CREDENTIALW reference and credential blob limit](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw).
- Shared adapter: `src-tauri/utils/src/credential_store.rs`.
