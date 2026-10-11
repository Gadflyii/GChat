# Import Gbot SSH keys through the native vault

Status: accepted source-only scope, October 11, 2026.

The authenticated local Gbot service imports OpenSSH keys, including encrypted
keys and RSA. The user supplies the passphrase once at import. Decode/decrypt runs
in a blocking worker; it never writes a key or passphrase file. After validation,
store the normalized usable key in the native vault under a fresh reference.
Return only that reference and comment-free public metadata. Do not persist the
passphrase, accept caller-selected vault references, or echo parser/provider
errors that could contain secrets. Missing/wrong passphrases and unavailable
storage have typed errors. Reconnect retrieves the key from the vault.

Keep Gbot-generated keys Ed25519. RSA is an import capability and uses explicit
SHA-2 authentication without a SHA-1 fallback. Input remains OpenSSH containers;
this change does not add PPK or other PEM formats. Physical vault-provider and
desktop qualification remain separate from hermetic transport verification.

Ron approved the exact RSA feature closure of pinned `russh` 0.63.1:
`rsa` 0.10.0-rc.18, `pkcs1` 0.8.0-rc.4 and `crypto-primes` 0.7.2, with no other
locked-version changes. RSA and PKCS1 are release candidates; recheck final
versions before any GChat release.

Current implementation, focused evidence and remaining scope live in
[the Gbot authority](../gbot/README.md#current-ssh-key-import-follow-up).
