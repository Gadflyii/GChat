# Approve LAN Gbot control separately

Status: approved for implementation by Ron, October 13, 2026.

A paired computer may request a separate Gbot-only grant from the service Host.
Only the local owner can approve or revoke it, explicitly per paired device.
Pairing authenticates requests to obtain the grant; control uses a distinct
vault-held credential over the existing pinned TLS channel. Neither an inference
token nor an SSH key is a Gbot control grant. Grant and use events enter a private
Host log without credentials or task contents.

The Host exposes a closed list of Gbot operations, including task, setup and view
controls. Native credential/authentication APIs and service shutdown are excluded.
Views are bound to the requesting device's exact grant generation. Revocation
invalidates their tunnels and releases their service leases when reachable;
service-owned tasks and schedules continue. Forgetting a paired device also
revokes its grant. A new approval never revives an old credential or view.

The desktop persists its selected service. Switching shows that service's bots,
without moving bots or borrowing the client's accounts. M365 setup reads selected
service account metadata; remote sign-in is completed on the service computer.
The browser receives only a single-use loopback view address, never the control
credential. The shared Host bootstrap uses existing `jan-utils`; no packages are
added. Azure/AWS/GCP attachment remains mocked, and physical LAN qualification
is separate from the focused implementation gates.
