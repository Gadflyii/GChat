# Windows gate — October 16, 2026

The unsigned current-user installer completed scoped Windows RTX 5090 functional
checks. One model started, answered one request, and stopped normally. The gate
also found that changing App Data leaves the detached Host at its old root and
that the installed Host has no ordinary graceful shutdown control. Several
required checks remain unqualified; this packet is not a blanket release pass.

All times below are UTC on October 16, 2026. The authoritative aggregate is
`/ai/gchat/out/windows-gate-20261016/result.json`; its companion is `summary.md`.
Native receipts, logs and screenshots remain under
`C:\Users\Ron\gchat-windows-gate-20261016`
(`/mnt/c/Users/Ron/gchat-windows-gate-20261016` from WSL).

## Frozen installer and sources

| Item | Identity |
| --- | --- |
| Installer | `C:\Users\Ron\gchat-windows-gate-20261016\native-target\release\bundle\nsis\GChat_2.0.42_x64-setup.exe` |
| Installer size | 624,551,698 bytes |
| Installer SHA-256 | `96d9b50ca6a9cadee8583860b778d9f379ade972e8a751f23e44d1918ffbb7b3` |
| GChat source | `dcb11c14cd98ae594d56531782469247d47acce9` |
| Engine source | `c440179a9c731ba4fb591e3aee7472a20422d644` |
| Physical target | Native Windows x86-64, RTX 5090, SM120a |
| Engine manifest SHA-256 | `ae6ff0daf325ed30441ac020423284d8fbed1852ef4783c5e83a7101b3291ed4` |

The corrected bundle verifies all 124 Engine payload files. Its NSIS-only
rebundle replaced the Engine closure; GChat, CLI, Host, Manager and launch-profile
catalog hashes remained unchanged. Signing, publication, an administrator or
system-wide installation, and physical SM86/SM89 acceptance were not performed.
Codex 6's SM86/SM89 build and closure results do not qualify those GPUs physically.

## Required-check results

| Check | Result | Actual boundary |
| --- | --- | --- |
| Native build and corrected NSIS/Engine closure | PASS | Frozen sources above; unsigned current-user installer. |
| Upgrade preservation | PASS | 14 chat and 5 settings file hashes equal; four model size/mtime records equal, first observed after automatic desktop launch. |
| Fresh application first-run/profile reuse | PASS | Four user-state roots aside; registered program restored; accepted profile seed only; native validation took 2365 ms. |
| Original hardware Ensure | PASS, duration finding OPEN | One uninterrupted natural completion took 5107.168 s. |
| Custom App Data | FAIL: Host migration | Desktop moved; detached Host and locator retained the default root. |
| Fastest-disk selection | NOT QUALIFIED | Only C: measured/selectable; no comparison with D:/E:. |
| Model Start, request and model Stop | PASS | One Qwen INT startup at 262,144 context/C1/Automatic KV; exact `WINDOWS_GATE_OK` response; normal model Stop. |
| Imported-model multi-instance quote | NOT RUN: unreachable | Empty/unset catalog exposed no ordinary Check startup settings route. |
| Credential Manager save/read/delete | PASS: ephemeral only | Native random-value exact-byte roundtrip and deletion; persistence/restart NOT RUN. |
| Desktop and Manager tray exit | PASS | Actual native Quit/Exit Manager controls exited both clients. |
| Studio exit | PASS: idle only | Idle Studio navigation and desktop exit; active run/cancel/persistence NOT RUN. |
| OI075 12/120-message render | PASS: functional only | Visible rendering, reasoning expansion and scrolling; frame-performance NOT RUN. |
| Post-install idle | PASS: measurement only | Actual 30.089 s observation; 18.73% of one CPU core over sample endpoints; no low-idle threshold qualified. |
| Normal detached Host shutdown | FAIL: no control | Required authorized exact-PID `/F` after plain termination was refused and a 30 s wait. |
| Full resource return | PASS | Owned identities, engines and listeners absent; GPU guard independently acquired/released. |
| WiX/MSI fallback | NOT RUN | Administrator/legacy-uninstall path declined; current-user NSIS used. |
| SM86/SM89 physical qualification | NOT RUN | Build/closure receipts only; physical gate used SM120a. |
| Windows Gbot | NOT QUALIFIED | Linux-only Cua executor, Hyper-V 501 and Windows autostart no-op remain. |

## Upgrade and fresh-state boundaries

The ordinary current-user upgrade began at 09:48:32.362. Desktop auto-launched
at 09:50:29.114; installer exit was observed at 09:53:23.530. Earlier installer
page advancement was not observed and its cause is undetermined. A later intended
Run GChat/Finish action safely failed identity validation because NSIS had already
exited; that action did not execute.

The first post-upgrade preservation observation was **after** desktop launch:
14 chat-file hashes and five settings-file hashes matched the baseline. Four
model files totaling 44,808,326,736 bytes retained their sizes and modification
times. This preservation check did not read, hash or copy model payloads. The
pre-upgrade backup retains an explicitly approved unreadable nested-source
exclusion; it is not an unqualified complete-backup claim.

Fresh application-state acceptance followed the original Ensure's natural
completion and return of its owned processes. At 11:28:33.758, the program
directory and four user-state roots were renamed aside. With the registered
program directory absent, NSIS offered an MSI/admin uninstall path, which was
declined. Bubbs then authorized restoring only
`C:\Users\Ron\AppData\Local\GChat`; the ordinary current-user installer was
relaunched at 11:34:30.370. These four prior user-state roots remained aside:

- `C:\Users\Ron\AppData\Roaming\GChat`
- `C:\Users\Ron\AppData\Roaming\GInfer`
- `C:\Users\Ron\AppData\Roaming\app.gchat`
- `C:\Users\Ron\AppData\Local\app.gchat`

Only the completed canonical hardware profile was seeded into the fresh Host
profile directory, under explicit authorization. Old jobs, first-run progress,
settings, credentials, checkpoints and WebView state were not carried forward.
Models in `C:\Users\Ron\AppData\Local\GInfer` remained in place. This qualifies
a current-user reinstall with fresh application state, retained registered
program directory and accepted calibration; it does not qualify a pristine OS,
an unregistered install or a second fresh calibration. No registry edits were used.

## Natural hardware profile and native reuse

The original Ensure job `55de371e-64a9-4295-953b-1cde460823c7` ran once from
09:49:41.653 to 11:14:48.821 without interruption or restart. Host elapsed time
was **5107.168 s (85m7.168s)**; native elapsed time was 5105.2310121 s. It
completed with `native_completed`, `measured_fresh` and `measured_work` true and
empty pending/stale groups. The recorded `checkpoint_available: true` remains
part of the raw evidence.

The accepted schema-2 profile is 30,303,018 bytes, SHA-256
`8855b041aba62ffe8fc2b1d25b25ad2060f51360bfc91fb712586d6221384372`.
It contains 11,520 CPU rows (8320 measured, 3200 unavailable), 1536 GPU expert
rows, no cross-NUMA rows and three loaded NUMA rows. The captured CPU grant was
2–3, 6–31 (`0xFFFFFFCC`); scheduling exceptions and relays are retained in the
aggregate. This is not a whole-machine isolation claim.

CPU calibration cumulative time was 5057.079235 s. The full per-format core/node
cost table is in `/ai/gchat/out/windows-gate-20261016/windows-profile-duration-audit.md`.
Separate platform/GPU/whole-NUMA wall times and the cause of the Windows duration
remain unproved. Earlier Linux timing is context, not a controlled OS comparison.
Warnings for unavailable disk PCIe/GPU NUMA/shared PCIe topology, the blank NUMA
node-0 read-probe reason, and unowned PhysicalDrive3/4 read caches remain visible.
Model-scoped first-run profiling is absent from this frozen candidate.

Fresh-state first-run invoked ordinary native Ensure again as job
`f18ca852-d34c-4afc-9b65-a4e3ddc3ae81`. It validated the accepted profile in
**2365 ms**, completed with no pending groups, `reprofile: false`,
`measured_fresh: false` and `measured_work: false`. This is native reuse validation,
not a second calibration or a reduction of the original 85-minute measurement.

## Custom root, model and storage

Ordinary Settings → General → App Data → Change location restarted desktop at
`C:\Users\Ron\gchat-windows-gate-20261016\fresh-custom-data`.
At 11:45:00.793 the detached Host PID 47656 still used
`C:\Users\Ron\AppData\Roaming\GChat\data\ginfer\host`, and
`%APPDATA%\GInfer\local-host.json` retained that owner. New Gbot PID 47864
coexisted with old Gbot PID 87664. The desktop move passed; Host migration failed.

The existing model was registered by path without copying:
`C:\Users\Ron\AppData\Local\GInfer\release-1003\artifacts\qwen38_27b_autoround_dflash2.ginfer`.
Its retained identity is SHA-256
`bcf29abd1598f5666c641da7c59ac28bd999aa98a8d6ba533ae7aa579abd06a7`.
One Manager Start was submitted at 11:49:22.476 using
`windows-rtx5090-qwen38-groupwise-int-dflash2-q4.json`, labelled
“Untested · C1 · 256K context · Text only”: 262,144 context, concurrency/instances
one, structured output On, desired KV Automatic/null. Effective KV was
10,701,773,824 bytes. One ordinary Chat request at 11:53:30.660 asked
“Reply with exactly WINDOWS_GATE_OK”; the exact reply was visible at
11:53:43.979. Normal model Stop left Engine PID 56024 absent by 11:56:17.435.
This qualifies one functional startup/request, not full-context input, vision,
throughput, model quality or precise startup latency.

C: was the only measured/selectable storage choice (8777 MiB/s, 1039.7 GiB free).
D:/E: lacked valid owned-cache probes and were disabled. No fastest-across-disks
selection is qualified. With the catalog empty/unset, the imported model had no
ordinary multi-instance quote route; no release, job or extra Start was fabricated.

## Credentials, rendering, idle and exit

Manager's ordinary secure-storage check completed a randomized native
save/read/exact-byte-compare/delete probe at 11:57:31.847. This is ephemeral
Credential Manager functionality. It does not prove persistent pairing/provider
credentials across restart or a distinct remote Host identity.

Idle Studio controls were visible at 11:57:59.805 and desktop then closed.
No active Studio task, cancellation or durable run was exercised. With desktop
closed, four explicitly authorized synthetic OI075 files were seeded. The
12-message and 120-message histories rendered visibly; reasoning expansion
at 12:02:20.701 and scrolling at 12:02:42.540 passed. Screenshots and UI trees
support these functional observations. No frame/RAF/long-task instrumentation,
jank threshold, import/indexing or performance comparison is qualified.

The actual idle observation ran from 12:03:16.411 to 12:03:46.502: 30.0888385 s,
with the model stopped, 120-message history visible, no UI input and a stable
17-process family on a 32-logical-processor machine. CPU increased 5.4375 s;
the first/last sample interval was 29.0313632 s, yielding **18.7297% of one core**.
Summed working set ranged 1,231,421,440–1,268,322,304 bytes; private memory ranged
780,627,968–815,517,696 bytes. Shared pages can be counted more than once in summed
working sets. This records a measurement, without a low-idle acceptance threshold.

Actual native desktop tray Quit exited PID 49920 at 12:05:11.193; an observed
native Exit Manager menu click exited PID 49336 at 12:09:14.556. Earlier non-exiting
dispatch attempts remain in the evidence and are not counted as successful exits.

Both Gbot services exited after authenticated ordinary shutdown requests. The
detached Host had no ordinary UI/CLI/HTTP graceful shutdown control. Plain
`taskkill /PID 47656` was refused; after the authorized 30-second wait, exact-PID
`/F` returned it at 12:11:00.449. **This is not normal Host Stop acceptance.**
At **12:11:25.310**, all 17 PID-plus-creation identities, owned executable roots,
native engines and listeners were absent; ports 7443/7444/59635/62415 were free.
The remaining 2220 MiB GPU allocation belonged to Windows display processes;
zero GPU memory is not claimed. Guard 2846341 was absent, the canonical GPU
exclusive guard was independently acquired/released at **12:11:43.064**, and
booking 967 was canceled.

## Follow-up ownership and installed-version limits

The [canonical open-work snapshot](https://github.com/Gadflyii/ginfer-dev/blob/3fb81caf98b934c3532c61be43569175414c68e5/docs/maintainer/open-work.md)
records these rows. Later source fixes below are **not included** in this installer.

| Row | Canonical status at packet preparation | Remaining boundary |
| --- | --- | --- |
| W11 `GCHAT-WINDOWS-DETACHED-HOST-NORMAL-STOP-20261016` | Gchat; MERGE-READY at `6449daf0f383a147e2f2a4c7bf9e5305dc71d865` (12:23) | Source/Linux gates passed; native Windows acceptance remains pending. Frozen installer required forced idle-Host return. |
| W11 `GCHAT-WINDOWS-APP-DATA-MOVE-HOST-ROOT-20261016` | Gchat 3; OPEN | Installed root mismatch reproduced; depends on owner-checked normal Stop, locator/root update and restart. Installed evidence entered in canonical commit `f77fb3104811804c15f9bf4de247208d29b0156b`. |
| W10 `GCHAT-CROSS-OS-HOST-PORT-COLLISION-20261016` | Gchat; FIXED / MERGE-READY at `d28af8ec6a34075f3366633f7452c343988ad49e` | Source verification does not qualify this Windows package. Ports 7443/7444 were prechecked free for this gate; WSL/native coexistence was not tested. |
| W10 `GCHAT-LOCAL-MODEL-STARTUP-QUOTE-20261016` | Gchat; FIXED / MERGE-READY at `e5c396727c016ab93f3730119185757454a977e2` | Imported-model quote remained unreachable in this installed candidate; new packaged Windows route awaits acceptance. |
| W10 `GCHAT-FIRST-RUN-PROFILE-DURATION-20261016` | Gchat 3; OPEN | Natural 85m7.168s measurement and CPU phase costs retained; duration remediation not qualified. |

Windows Gbot remains unqualified: Cua execution is Linux-only, local Hyper-V setup
returns 501 and Windows autostart is a no-op. This gate makes no Windows Gbot
task/media, active Studio, credential persistence or SM86/SM89 physical claim.

## Retained provenance and failures

Frontend prerequisites and production Vite build passed; Vite took 20.81 s and
retained a 519.56 kB chunk warning. Native build attempt 3 exited zero. Its guard
nevertheless failed when an owned VCTIP helper did not drain within 30 s; exact
Job cleanup succeeded and all 108 known processes exited. The raw summary's zero
sample counter was a wrapper defect: the memory JSONL contains 148 samples.
Wrapper attempts 1/2 remain under the local `native-guard-attempt1-failure/` and
`native-guard-attempt2-failure/` directories.

Initial Engine `e8608c054d045b6af07fff329d7ae6dc09a4305f` CPU gates failed Win32
replacement, stack guard and all-ready/FIFO witnesses; that initial package was
not admitted to physical acceptance. Corrected reader/platform tests at
`1fac098ee4024c9bf1212fad890c9169bfe37e6a` passed in 4.84/0.08 s; corrected
Engine CPU-fake at `c440179a` passed in 358.545 s with two POSIX-only witness
skips. Its fixture-only completion/unwind changes preserve the reader/platform
production source. Corrected NSIS rebundle and its guard passed at 09:46:56–57;
all five known build processes exited and the owned Job was empty. These specific
build/test receipts do **not** establish a blanket GChat `make verify` pass.

Key small-file bindings below use SHA-256. Native filenames are relative to the
NTFS receipt root above; local filenames are relative to
`/ai/gchat/out/windows-gate-20261016/`. The aggregate indexes the additional
screenshots, commands, logs, initial failures and individual observations.

| Receipt | SHA-256 |
| --- | --- |
| Local `result.json` | `ff9518603f9739ca6b1958684cc509af94f8aa7de4932da4327c720eac9ccb72` |
| Local `summary.md` | `3e3c6c6d2a50bf28d9eaf767303f1da2ebce6d233e45e019a5f428fbbb740858` |
| `rebundle-artifacts.json` | `592e2cfee427dfce89ad868dbfa70f3b475f06d5a33417f4537f489b62c0ee77` |
| `rebundle-guard-result.json` | `e2ba7533540ca537c99ce147243b3032de5d3661719a8910981729f6d7550beb` |
| Local `postupgrade-first-observed-preservation.json` | `49e9e031a56491df28957c0052f8dcc2c6b5c9b8f67d9be163a6349e06a2ae9a` |
| `fresh-root-renames-and-profile-seed.json` | `fbd551498c046ca1153e674327eec5b2728ed7e9ebf2c33dde8cda1cd13a0164` |
| `ensure-natural-terminal.json` | `3d2c2a98e809fe9fb07d9768fc890657878de20a753410e906533e8dccfe59e6` |
| `completed-profile-metadata.json` | `9240af0f115011ef813a23bb8cc3ba7dca29699f5d401de95ae8d0086971fda9` |
| `fresh-custom-root-result.json` | `fb4c6068baea45f44f8ca3d7465de6610525718913218b5f1377672500548342` |
| `fresh-one-request-observation.json` | `0ce08ccf10d58049269c3a7b88085d91bc5888c751f81dda3a8b98bc93e03c1f` |
| `fresh-model-stop-observation.json` | `5491bf3da0631064b6f43a2ec55b228ead5ee2ce06dd5e444b5a8f3a541e8a47` |
| `fresh-credential-probe-terminal.json` | `9412a11732208282944b6e323fd8b2491c12c01f1f98590e00605721c32703e7` |
| `fresh-oi075-many120-render.json` | `33ec94c6ed6827a8bad942bfb1cf13de734f1791954a436a979cf6784b9e4ad9` |
| `fresh-actual-idle-30s.json` | `f89334fcb111d77040ff7f84cf7b22a8706dff641376bf48b6858d32f5fb9377` |
| `fresh-native-full-return.json` | `38bb682035bd0764ae10c6561b513a52f54abe2302dd363d385bb6eedcc4eb6b` |
| Local `final-gpu-return.json` | `ca4a894de63f4ca3b8cd6c9985fd35e50b91a1057bd2a2c0f41a6a8ebcd8d346` |
