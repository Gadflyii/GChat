---
date: 2026-10-13
title: "Support Linux credential storage without requiring a desktop keyring"
status: accepted
---

# Credential-store tiers

**Owner:** GChat. **Scope:** GCHAT-SECRET-STORE, including paired-Host grants,
Gbot secrets and connector tokens. Linux implementation and the named locked
dependencies are approved. The WSL Windows helper waits for the Windows release
gate; no native Windows build is authorized during this development item.

**Context.** Stock WSL lacked `org.freedesktop.secrets`, blocking native pairing.
Installing and unlocking gnome-keyring resolved the test prerequisite. The
shared store now owns Chat/Manager readiness and the adapters used by Gbot and
workspace connectors. An explicit encrypted vault supplies storage when
Secret Service is absent.

## Selection and user experience

| Environment | Current storage | User action |
| --- | --- | --- |
| Linux, including WSL, with Secret Service | Existing Secret Service entries | Unlock the provider if needed |
| WSL without Secret Service | Passphrase-encrypted Linux vault | Choose a passphrase; Windows-backed unlock is deferred |
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

**Deferred Windows release work:** package a versioned `gchat-windows-credential-helper.exe` as an explicit Linux
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
registry root. Use approved locked AES-256-GCM/Argon2id/zeroize crates; no custom cryptography. Version KDF parameters; use random salt/nonces
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

Linux gates cover tier/locked-provider behavior, interrupted migration,
encrypted round-trip/tamper/wrong-passphrase, concurrent writes and setup/control.
See [current acceptance](../agent-runtime/remaining-acceptance.md) for results.
Windows helper grant/key round-trip, unavailable interop and native cancellation/
lifetime checks remain owed to the Windows release gate. Existing native-Windows
large-secret limitations are unchanged; qualify RSA import there separately.

The approved dependency pins are keyring 3.6.3, zeroize 1.9.1, aes-gcm 0.11.1,
argon2 0.6.0 and Linux dbus 0.9.12. The Cargo.lock change adds dependency edges
only, without new packages or version changes, and is submitted for merge review.
Passphrase keys use Argon2id with versioned parameters and AES-256-GCM wrapping;
records bind ciphertext to their vault and credential identity. Gbot receives an
unlocked session key through private child stdin and supports authenticated
lock/unlock on its existing loopback control channel; no clear key is written.
