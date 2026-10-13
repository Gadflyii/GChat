---
date: 2026-10-13
title: "Support Linux credential storage without requiring a desktop keyring"
status: proposed
---

# Credential-store tiers — proposal for review

**Owner:** GChat. **Scope:** GCHAT-SECRET-STORE, including paired-Host grants,
Gbot secrets and connector tokens. No implementation, dependency change or
Windows build is authorized by this proposal.

**Context.** Stock WSL lacked `org.freedesktop.secrets`, blocking native pairing.
Installing and unlocking gnome-keyring resolved the test prerequisite. Current
Chat/Manager readiness probes and setup guidance exist; they do not provide a
backend when Secret Service is absent. Existing vault adapters also cover Gbot
and workspace connectors separately.

## Selection and user experience

| Environment | Proposed storage | User action |
| --- | --- | --- |
| Linux, including WSL, with Secret Service | Existing Secret Service entries | Unlock the provider if needed |
| WSL without Secret Service | Encrypted Linux vault; its random vault key is held in Windows Credential Manager | Confirm Windows-backed storage; require working WSL interop |
| Linux without either provider | Same encrypted vault; random vault key wrapped by a passphrase-derived key | Choose a passphrase or install a Secret Service provider |
| Native Windows | Existing Windows Credential Manager entries | Existing Windows behavior |

Select a tier only when initializing storage, and persist that selection beside
the vault. A locked, denied or temporarily unreachable provider stays selected:
show an unlock/retry action, never create a second store. Changing tiers requires
explicit migration. Headless notice: “Credentials are encrypted with your
passphrase. Unlock after restarting; unattended tasks wait until then.” Also
show the supported keyring installation hint. No package installation is implicit.

## Ownership, backends and packaging

One shared module in existing `src-tauri/utils` owns selection, readiness and
byte-secret operations; Chat, Manager, Gbot and connectors retain their adapters
and credential references. Pass the existing per-user Host registry root into
the module so custom Chat data folders do not create competing stores.
Keep locked `keyring` **3.6.3**, `sync-secret-service`, `crypto-rust`, `vendored`
and `windows-native`. Do not enable a session-only Linux keyutils fallback.
Run blocking native operations off the async executor and serialize writes.

Package a versioned `gchat-windows-credential-helper.exe` as an explicit Linux
DEB/AppImage resource, produced and qualified at the Windows release gate.
Resolve only that packaged path; use direct WSL interop, no shell, elevation or
search of arbitrary Windows installations. A private stdin/stdout protocol
provides version negotiation, vault-key get/create/delete and legacy-entry reads;
no secrets in arguments, diagnostics or logs. Missing helper/interop gives an
actionable setup error. This follows the [GCM WSL interoperability pattern](https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/wsl.md).
Credential Manager holds the small wrapping key rather than imported SSH keys:
its [credential blob limit is 2,560 bytes](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw).
Use user-local persistence and a vault UUID to distinguish WSL stores.

The encrypted store lives in a private `credentials/` subdirectory of that
registry root. Reuse locked AES-256-GCM/Argon2id/zeroize crates after dependency
review; no custom cryptography. Version KDF parameters; use random salt/nonces
and authenticated record identity. Headless passphrases and unlocked keys stay
in process memory and are cleared on lock/exit, never saved beside ciphertext.
Each process must unlock; Gbot's existing authenticated local control accepts
its unlock request and durable tasks remain waiting while locked. Locked writes
and atomic replacement protect concurrent app updates. Lost passphrases require
re-pairing/reconnecting; resetting storage never silently deletes credentials.

## Existing grants and acceptance

Preserve service names (`app.gchat.ginfer-host`, `app.gchat.gbot`,
`GChat Workspace connections`) and entry IDs. Migration reads only referenced
entries, copies and verifies bytes, then atomically commits destination ownership.
A resumable journal contains IDs/status only. Keep the source until committed;
source deletion is a subsequent explicit cleanup. Missing or locked source
entries require recovery or deliberate reconnect, never newly issued grants
without consent. Connector and bot account bindings remain unchanged.

After review: focused tier/locked-provider and interrupted-migration fixtures;
encrypted round-trip/tamper/wrong-passphrase and concurrent-write cases; one
WSL helper grant/key round-trip and unavailable-interop case at the Windows
release gate. No physical gate or code test is needed for this design-only item.
**Next decision:** approve the tiers, shared owner, helper packaging and migration
before implementation. Existing native-Windows large-secret limitations are
unchanged; qualify RSA import separately at its release gate.
