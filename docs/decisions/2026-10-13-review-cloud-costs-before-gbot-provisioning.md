# Review cloud costs before Gbot provisioning

Gbot connects to the user's own cloud account. Hetzner and DigitalOcean prices
come from their authenticated catalog APIs; GChat never embeds a price list.
Provider tokens live in the existing vault. A separate durable cost-review file
contains catalogs, the selected plan, quote and confirmation, with an opaque
credential reference kept out of the client response.

The user chooses a region and plan explicitly. Quotes include compute and public
IPv4 prices, distinguish provider-reported tax from unknown tax, and disclose
included traffic and any reported overage price. Decimal arithmetic preserves
provider precision. No plan is substituted. Quotes expire after fifteen minutes;
refreshing clears selection and confirmation. Failed refreshes prevent the wizard
from confirming the previous price.

Credential replacement uses durable cleanup intent before the vault write. State
publication is reconciled on reload, and retired credentials remain queued until
deleted. Client disconnection does not cancel the credential/state transaction.

This change saves cost reviews only. [Cloud creation and recovery](2026-10-13-own-cloud-resource-creation-and-recovery.md)
extends that owner with exact-quote revalidation, resource ownership and recovery.
A saved review is never a Ready workspace.

The boundary uses the existing authenticated Gbot service and native HTTP client;
it adds no dependencies, cloud relay or polling loop.
