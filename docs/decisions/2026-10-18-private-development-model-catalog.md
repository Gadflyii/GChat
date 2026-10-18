# Shared private development model catalog

Status: proposed implementation; Bubbs authorized the shared fixture on October 18;
architecture review of the development transport is pending.

## Decision

Keep one read-only testing catalog on S1 at a literal RFC1918 LAN address.
Generate it from the existing NAS release-wave packages and their matching
launch profiles. Keep the service and small metadata under a stable SSD root;
serve only the selected package paths without copying their payloads. Do not
upload this fixture or configure it in any release build.

A development frontend and debug Host may explicitly select an HTTP catalog
whose host is `127.0.0.1` or a literal RFC1918 IPv4 address. Its package URLs must
have the same origin and end in `.ginfer`. Neither catalog nor packages may
contain credentials, a query or a fragment. The Host disables proxies and
redirects for this route. All release metadata, hash, byte count, artifact
identity, launch-profile and hardware validation still applies. Published
release URLs retain the existing commit-pinned HTTPS Hugging Face rules.

This restores the previously implemented loopback development route while
allowing one shared LAN fixture, so each test lane can use the same packages
and metadata. The private path is excluded from production frontend admission
and release Host admission. No production qualification follows from a fixture
transfer or a native UI screenshot.

Operational URL, build flags, lifecycle and native evidence are maintained in
[Host UI](../host-ui/README.md#shared-private-development-catalog-and-downloads-native-acceptance).
