# Label screened startup launch profiles

Date: 2026-10-16
Status: Accepted

Bubbs approved the retained RTX PRO 6000 Flash Next pure 2-bit startup witness
`pm-v2-20261015-caaddfaa2f53831e` as a selectable catalog entry, capped at its
131072 context, TP1/C8/INT8 settings and exact package SHA256
`8bbb85bf6ba669157045bac0a6fdd623dd87694b7b1fe09b7f2150fc3636ab08`.
It provides startup and concurrent short-request evidence, without measured or
calculated full-context capacity. Existing qualification tiers cannot represent
that evidence accurately.

Add `screened-startup` to the existing catalog contract. Require zero full-context
requests, a concurrency-matching smoke count, measured startup headroom, and no
capacity calculation. Preserve automatic KV. Desktop, Manager and CLI label it
“screened, not full-context qualified”; it never becomes a tested recommendation.
Evidence remains bound to its recorded Engine and options. Full/current-release
qualification stays with Ron's OI-072 release gate.
