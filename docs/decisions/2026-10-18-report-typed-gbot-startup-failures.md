---
date: 2026-10-18
title: "Report typed Gbot startup failures"
---

# 2026-10-18 — Report typed Gbot startup failures

- **Context:** The account-service bootstrap used the last line of an append-only log as its current failure cause. A silent exit could inherit a previous attempt's storage error; unrelated log text could become the primary message.
- **Decision:** The private `--gbot-service` child preserves typed credential-store/API vault failures and exits with a closed code: 201 locked storage, 202 unavailable storage, 203 unreadable credentials, 204 conflicting credentials, 205 missing credentials. Other errors exit 1. The shared Host bootstrap formats plain guidance from this status and places exit status/log path in the existing closed Details section. Logs remain diagnostic history and are never parsed for classification.
- **Consequences:** Codes avoid sysexits and ordinary argument/panic statuses. Signal termination and unknown codes receive generic guidance. The concurrent-owner readiness check and timeout remain unchanged. This is a private matched-build child contract, with no discovery, credential or HTTP format change.
- **Authority:** Arch signed the closed-enum/exit-code correction on 18 October 2026.
- **Owner:** GChat / GInfer Host bootstrap.
