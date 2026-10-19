# Windows native follow-up — 2026-10-17

This batch uses GChat `376a0bddce2dae9a28200099f3eac4c944aba8a7`
and Engine `c440179a9c731ba4fb591e3aee7472a20422d644`. It supplements
the earlier [Windows gate](windows-gate-20261016.md); its results do not
qualify a newer Engine or a fresh installer run.

The native CLI, Host, desktop and NSIS build commands exited 0 at
01:55:16Z. The enclosing build wrapper failed because its owned VCTIP
helper outlived the 30-second drain allowance; cleanup completed at
01:55:47Z. Both outcomes are retained in `native-guard-result.json`.

Installer: `C:\Users\Ron\gchat-windows-gate-20261016\native-target\release\bundle\nsis\GChat_2.0.42_x64-setup.exe`,
624606209 bytes, SHA256
`1217e0b6236d22ad028f38b9bd7d496b3d2f81aec77348bd034046e7a8197fbd`.
This follow-up ran the matching native desktop; it did not install this
new NSIS artifact or start another hardware Ensure.

| Check | Result and limits |
| --- | --- |
| WINDOWS-IDLE-CPU | Recorded: desktop, private Host and six WebView2 processes used 0.375 CPU seconds over 30.6115109 seconds, or 1.225% of one core. Host: 0.1021%; desktop: 0.2552%; WebView2: 0.8677%. Separate private Host-only interval: 29.9071431 seconds, zero CPU/read deltas. Other disjoint functional Engine work was present; these are process counters, not a whole-machine quiet or SCM-service result. |
| Detached Host normal Stop | PASS: ordinary GUI **Stop Host and Quit** invoked at 02:02:00.5417606Z; no remaining owned app/Host/helper processes or listeners at 02:03:39.8748158Z. Separate idle API Stop returned HTTP 200. Busy refusal and SCM stop were not run. |
| Hardware-profile installation | Native MSVC build passed. Active Cancel and abrupt Host loss were not run: this frozen Windows adapter rejects the model-scoped argument form before child creation. No all-format Ensure was launched to fill this gap. |
| OI-116 local long paths | PASS: native discovery registered a 358-character UTF-16 path containing spaces and Unicode, then its `\\?\` alias as the same model ID. Missing/invalid inputs returned HTTP 400. No model Start or additional NAS access. |
| OI-075 visible histories | PASS for functional native rendering of retained generated 12- and 120-message histories, visible Reasoned expansion and scrolling. Frame-time/responsiveness performance was not measured. Large-media rendering was not run: these fixtures contain no attachments or audio. |

The idle desktop ended at 118824960 bytes working set, 68943872 private
bytes and 49 threads; its Host ended at 11436032 bytes working set,
4157440 private bytes and 35 threads. History snapshots ranged from
119955456 to 120324096 bytes desktop working set. These snapshots do
not establish leak freedom or a performance threshold.

The first OI-116 preflight failed because PowerShell 5 decoded the UTF-8
path as ANSI. Its new private Host also briefly exposed the default LAN
port 7444; it was stopped immediately. The failure, explicit UTF-8
correction and successful normal cleanup are retained separately. The
corrected path run disabled LAN sharing. No Windows setting, NAS content
or credential was changed.

Evidence root:
`C:\Users\Ron\gchat-windows-gate-20261016\batch-20261017`.
Key receipts are `native-guard-result.json`, `idle-host/sample.json`,
`oi116/result.json`, `oi116/cleanup-correction.json`,
`oi116/result-after-preflight.json`, `gui/idle-processes.json`, the
`gui/{base12,many120,many120-expanded,many120-scrolled}-result.json`
files and `gui/stop-host-and-quit-result.json`. Local detailed notes:
`/ai/gchat/out/windows-gate-20261016/batch-20261017-notes.md`.
