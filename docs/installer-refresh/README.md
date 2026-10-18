# GChat installer refresh

## Current Linux RC refresh — Codex 3, October 18

`GCHAT-LINUX-RC-PACKAGES` is **PASS**, transferred from Gchat 3 by
bubbs. The final normal Release build is frozen at GChat main
`3e32ad0c9009b312426577d6a3c5e2a6edc10fd1` with GInfer dev/next
`b26ec5b8f03f978ccb3b2599c3f89b89f5174632`. It includes the model-list and
Gbot paired-session corrections found during the installed-DEB first-user walk.
Do not chase subsequent main commits or rebuild the unchanged Engine.

Acceptance passed with integrity-checked SM80/86/89/120a Release runtimes,
DEB/AppImage paths and SHA256s, and an isolated native installed-DEB walk of
setup, Models/Downloads, Engine/Host and hardware settings, Fleet/connections,
Settings, Chat, Agent Studio and Gbot setup. Account sign-in, publication,
Windows and additional GPU/model qualification are excluded. Private HOME,
mode-700 XDG runtime, DBus, unlocked keyring and Xvfb isolate the app; WAYLAND
is unset. Ron's installed apps and desktop remain untouched.

Owned branch: `build/c3-linux-rc-20261018`, worktree
`/ai/gchat-worktrees/c3-linux-rc-20261018`. All build, installer, extracted
payload and private-HOME bytes were confined to S1 under
`/media/ron/SSD_RAID/ai/tmp-c3-linux-rc-20261018`. Final packages stay there.
Gchat 3 release and Gchat 1 dependency donors are read-only inputs.

### Package status

The final desktop/CLI/Host Release refresh from `3e32ad0c9` passed at
14:26:20Z. Both archives passed and canonical replacement completed at
14:39:58Z. Native binary comparisons account for the documented Tauri bundle
marker and linuxdeploy ELF RUNPATH relocation; executable code and unaffected
sections match, with exact assembled AppDir bytes and semantically identical
dynamic symbols. See the [final build/archive result](/ai/gchat/out/c3-linux-rc-20261018/model-root-refresh-result.json).
Its [prepared command](/ai/gchat/out/c3-linux-rc-20261018/model-root-refresh-prepared-command.json)
and [source delta](/ai/gchat/out/c3-linux-rc-20261018/model-root-source-delta.json)
retain the reviewed source and inputs. It preserves eight signed catalog files
plus 19 other selected Linux catalogs: 27 files / 179 profiles, actual staged
JSON SHA256 `8e528704aae69d2ca699daaf117fe918dbe2fc16c7e511793ad79ddb26aa389c`.
The accepted signed subset is 42 profiles; its
[binding proof](/ai/gchat/out/consumer-flash-profile-20261018/catalog-staged-proof.json)
records SHA256 `2da2c9adb6d2bf034e4b4e0a35a14a26eeeb0728f9119ab513ac3202142e0598`.
The three signed Qwen 27B 2-bit mix cards use package SHA256
`483343c28912ae5db3d00478f16fffb10dcbb0c1317f8c90c09c396fcb6e4ca4`.
The signed Flash5090 pure 2-bit card uses package SHA256
`8bbb85bf6ba669157045bac0a6fdd623dd87694b7b1fe09b7f2150fc3636ab08`.
Flash catalog-input SHA256:
`56abd825c2b325242573a3e22a0194f7e421793228f94fb265bf0ed727b3b2a2`.
Private DEV HTTP acceptance for the prior quote was eight packages / 116
profiles. C7’s Muse replacement passed at 14:31:45Z with nine packages / 122
profiles and released its consumer hold. This assembled RC retains the accepted
eight signed inputs; the new eleven-input / 48-profile Muse packet requires its
newer Engine and belongs to the next consumer build. The final native restart
removed the debug-only private HTTP catalog override. Both catalog variables
were unset in the Release build; actual Host compiler dependency metadata
confirms no compiled URL. No public release catalog is approved, so the normal
Release fixture has an empty download catalog and supports local-model import.

The four exact Engine Release images passed at 11:38:59Z: 684 payload
size/hash checks, eight executable help checks, ELF dependency closure,
GLIBC 2.39 and exact architecture tags. No GPU was used. Runtime-set SHA256:
`53b1fb8f3aa8d98b9f728bd84213a2a2939feccd0a6be5b7f90bcbba43d2b9fe`.
See [Engine verification](/ai/gchat/out/c3-linux-rc-20261018/runtime-set-b26ec5b8f-proof.json).
The retained Gbot closure passes the existing integrity and guest-asset checks.

The final accepted packages are retained on S1 at
`/media/ron/SSD_RAID/ai/tmp-c3-linux-rc-20261018/packages/`.

| Package | Bytes | SHA256 |
| --- | ---: | --- |
| `GChat_2.0.42_amd64.deb` | 2,747,416,906 | `2c579df0055ddc045e9bb7c450b0aade116ba41db5cef4dc30c262387756a1a7` |
| `GChat_2.0.42_amd64.AppImage` | 2,781,067,768 | `048b44698a1ba3fad509347d87d094a017dd256474e7a69145f952e234c77e61` |

Both final archives contain the accepted catalog, runtime set and Gbot closure.
The installed DEB desktop SHA256 is
`42172b9c0014416e8491f09a1228ce1c1d84fcb2420b2d73d2ae8bf07f95d009`.
The [replacement record](/ai/gchat/out/c3-linux-rc-20261018/model-root-package-replacement.json)
retains their paths and packaged binary hashes. Final AppImage headless
acceptance passed all 29 process/closure checks once; see the
[final receipt](/ai/gchat/out/c3-linux-rc-20261018/model-root-appimage-check/appimage-verification.json).
Its final CLI hash assertion was corrected to distinguish the launcher from
the resource copy without repeating those checks. Earlier AppImage acceptance
also passed a separate fresh
native AppRun Welcome/Settings walk with readable pixels and version 2.0.42.
FUSE mounting is not qualified.

### Native first-user results and corrections

Actual private `dpkg -i` installed `g-chat` 2.0.42 under `walk/`, with independent
SSD `/usr`, `/etc` and `/var` bind mounts. The native walk used short SSD HOME
alias `/tmp/c3rc18`, display `:173`, its own Host locator and CPUs 24–31. The
initial long HOME caused a fixture UNIX-socket-path limit; normal computer
removal and service quit preceded the corrected short-alias fixture.

Linux journey recovery uses the retained
[launch command](/ai/gchat/out/c3-linux-rc-20261018/native-model-root-refresh-launch-command.json)
and [private install command](/ai/gchat/out/c3-linux-rc-20261018/deb-model-root-refresh-install-command.json).
The installed executable was `walk/usr/bin/gchat`, private HOME was
`/tmp/c3rc18/home` (SSD alias to `walk/final/home`), Xauthority was
`walk/Xauthority`, and display was `:173`. These owned RC fixture paths were
separate from Gchat 2’s FRESH/OLD fixtures and have been retired. The normal
package paths above remain the recovery input.

The pre-fix installed build passed Welcome GPU detection and secure storage;
GPU selection/clear, unloaded Host and Advanced controls; General name/language,
CLI install/uninstall, reset cancellation; Interface light/dark, font reset and
1024×800 readability; Attachments, Shortcuts, HTTPS proxy and MCP forms;
Workspace Google/Microsoft guidance and import cancellation; Hardware/System
Monitor; Models Recommended cards, details and Downloads; Memory new-item
cancellation; and Integrations prerequisites/toggles. No external account was
signed in. Hardware live-memory wording remains the existing tracked frontend
limitation `GUI-HARDWARE-LIVE-STATS-WORDING-20261017`, with NVML initialization
successful.

The unchanged all-format hardware profiler passed on GPU1 in 660.563 seconds
(13:03:50–13:14:49Z), saving a complete profile. With unchanged defaults—context
262,144, one request, Auto conversation memory, Vision on and reply speedup
off—the settings check quoted 74.6 GiB of graphics-card conversation memory
per copy without starting a model. Normal Start reached Ready. Qwen artifact
SHA256: `bcf29abd1598f5666c641da7c59ac28bd999aa98a8d6ba533ae7aa579abd06a7`.
No artifact copy or reduced settings were used.

Native [Chat](/ai/gchat/out/c3-linux-rc-20261018/final-chat-result.json) completed
“C3 Linux RC chat ready.” Agent Studio rendered all four compositions, saved a
Standard definition, completed “C3 Linux RC agent ready.” and displayed its
saved FINISHED history after Refresh. Default limits were unchanged. See the
[Agent Studio result](/ai/gchat/out/c3-linux-rc-20261018/final-agent-result.json).
The final installed app also restored the saved Chat response and Agent Studio
FINISHED run after restart and native Refresh; see the
[restored history](/ai/gchat/out/c3-linux-rc-20261018/refreshed-agent-history.png).
These are functional checks, not performance qualification.

Gbot setup created and connected the private KVM computer. Streaming viewer,
Take over, native typing, Save As, file-manager reopen/readback, Return keyboard
and Hand back passed. The saved guest proof file is
`/home/gbot/c3-rc-desktop-proof.txt`; its
[native readback](/ai/gchat/out/c3-linux-rc-20261018/final-gbot-desktop-readback.png)
is retained. The final installed Gbot service restarted, reconnected the saved
computer and streamed its native desktop again; see the
[refreshed viewer](/ai/gchat/out/c3-linux-rc-20261018/refreshed-gbot-desktop.png).
No SSH-only substitute was used.

Two source regressions were corrected on separate branches and merged:

- `GUI-MODELS-SYMLINK-DATA-ROOT-20261018`, main `528288db2`: canonical model
  enumeration could fail containment against the unresolved HOME alias,
  leaving Installed empty. Focused/merge gates and source-native Installed/
  Refresh passed. The final installed DEB displays the retained Qwen model
  and preserves it after Refresh; see the
  [native screenshot](/ai/gchat/out/c3-linux-rc-20261018/refreshed-installed-models.png).
- `GUI-GBOT-PAIRED-MODELS-SESSION-20261018`, source
  `1204902f74ffd89aa3bcadd22509502a378d3e35`, merged in `3e32ad0c9`: Gbot did
  not establish its own authorized Host sessions and discarded discovery
  errors. Four focused TLS/Host regressions, Rust check and Clippy passed.
  The sole `make verify` passed 3,605 app tests, then stopped at an omitted
  nested extension cache. Restoring that private cache allowed only the
  unreached stages to continue: 127 extension tests, all six coverage floors
  and 1,294 Rust tests passed. The
  [receipt](/ai/gchat/out/c3-gbot-paired-model-session-20261018/verification-result.json)
  distinguishes the failed invocation and completed continuation. Final native
  installed-DEB acceptance passed: the ready Host model appeared, selection
  saved, Edit brain restored its exact identity and 262,144-token context,
  Cancel edits retained it, and normal Run completed with “C3 Linux RC bot
  ready”. See the [native result](/ai/gchat/out/c3-linux-rc-20261018/refreshed-gbot-result.json)
  and [completed task](/ai/gchat/out/c3-linux-rc-20261018/refreshed-gbot-completed.png).

The initial model stopped normally; GPU1 returned 13:46Z and CPUs 24–31
returned 13:52Z after the app/Host phase. Its authorized inline, unsaved
private-PID backstop did not trigger; minimum MemAvailable was
686,667,743,232 bytes. Its
[receipt](/ai/gchat/out/c3-linux-rc-20261018/final-memory-backstop.json) is retained.
Bubbs's named authorization permits this native S1 private process tree alone
to receive exact-PID SIGTERM first below 3 GiB. The final refreshed model
reused the complete hardware profile and unchanged settings, started normally
at 14:53:22Z and reached Ready by 14:58:41Z. After the Gbot task, normal Stop
model and Stop computer completed. GPU1/CPU24–31 returned at 15:03Z and
booking 3346 was canceled. The final backstop did not trigger; minimum
MemAvailable was 685,205,270,528 bytes. See its
[receipt](/ai/gchat/out/c3-linux-rc-20261018/refreshed-memory-backstop.json).

The separate normal Release Manager companion passed 14 native Fleet/dialog
checks with its own private HOME, display and keyring. It is absent from the
installers. See the [Manager summary](/ai/gchat/out/c3-linux-rc-20261018/manager-native-summary.md).
An inherited private HTTP catalog was rejected by Release. Removing that
override allowed an empty-catalog refresh without a source change; this was
not a published-catalog network acceptance.

### Final fixture cleanup and disk lifecycle

The refreshed DEB's three installed native executable hashes matched the
accepted package. Installed/Refresh, Gbot paired-model selection, save/reopen
and task completion passed; Chat/Agent controls and saved results also passed
on the final app bytes. The model and private VM stopped normally. The stopped
VM was removed through the normal confirmation UI, then the Gbot service quit.
Closing the app's X window on the fixture without a window manager ended the
process with Xvfb `BadDrawable`; clean application shutdown is not claimed.
The remaining owned Host, Xvfb and libvirtd processes received exact-PID
SIGTERM and exited before fixture deletion.

Cleanup completed at 15:07:34Z. Removed: app Release cache (~31 GiB), Engine
and runtime set (~11 GiB), AppDir (~3.9 GiB), catalog copies, private walk
(~17 GiB) and `/tmp/c3rc18` alias. The S1 campaign root now contains only
`packages/` (~5.2 GiB) and the small fixture-preparation receipt. The
[build cleanup receipt](/ai/gchat/out/c3-linux-rc-20261018/build-shard-cleanup.json)
records retained package sizes and removed build paths. Small build, native
walk and verification evidence remains under `out/c3-linux-rc-20261018/`.
The separate merged Gbot fix's 38.4 GB disposable directory was removed 14:08Z.
Donors, model inputs and other sessions' paths were untouched.

## Native Windows fixed-volume qualification — Codex 7, October 18

`GCHAT-WINDOWS-FASTEST-DISK-20261016` **passed the existing C:/D:/E:
separate-drive scope** authorized by Bubbs at 11:12Z. One native Windows
`profile-hardware --disk-only` command exited 0 in 24.653 seconds at 11:48Z
on RON-9950X3D2. The accepted SM120a runtime `b76ce57a3` includes merged disk
fix `c53921fbb`; no build, full calibration or model inference ran.

| Volume / physical drive | Sequential GB/s | Random 4 KiB MB/s | Direct reads |
| --- | ---: | ---: | ---: |
| C: / PhysicalDrive0, Samsung SSD 9100 PRO | 8.792 | 49.274 | 1 GiB |
| D: / PhysicalDrive3, Samsung SSD 850 | 0.499 | 37.591 | 1 GiB |
| E: / PhysicalDrive4, AMD-RAID Array 3 | 0.896 | 36.041 | 1 GiB |

All three retain distinct Volume GUIDs, usable parent paths and positive
uncached sequential/random measurements. These are qualification observations,
not a storage speed improvement claim. C: is fastest. The model resides on C:
and the private profile cache on E:, so fastest-outside-model/cache behavior
remains covered by the existing helper regression. No eligible mounted sibling
partitions exist; Bubbs accepted that **fixture limit**. No partitions or Windows
settings were changed, and physical sibling acceptance is not claimed.

The inactive C6 profile was copied into an owned root. All CPU/GPU/NUMA
measurement fields and non-disk sources are unchanged, including 11,520 CPU
expert and 1,536 GPU expert rows. The existing writer recomputed seven derived
CPU completeness summaries under the SIMD requirement policy; all remain
complete. The donor remains byte-identical, and the model size and timestamps
are unchanged. No new probe paths remain; a preexisting D: probe directory was
left untouched. The [consolidated native result](windows-disk-qualification-20261018.json)
records the command, checks, identities, measurements and fixture limits.

C6 has no retained native Host test executable or
`native_profile_storage_acceptance` receipt. This result qualifies the producer
on the available fixture; it does not establish that separate native Host test.
Existing reader/refresh and Host ranking tests are reused. No passing test was
repeated for this evidence-only update.

Local5090 **returned 11:48Z**; booking 1457 and both compile guards were released
before Gchat2's installer build. The owned runtime extraction and full profile
copies were removed. `E:\gchat7-windows-fastest-disk-20261018\evidence` retains
only the 10.7 KB consolidated result, preserving its recorded parent path.
Source/evidence worktree `/ai/gchat-worktrees/c7-windows-flash-20261018` remains
on `docs/c7-windows-fastest-disk-20261018`. Shared runtime ZIP, donor profile and
model are untouched. Next: merge this bounded result and continue the next
owned Models/cross-OS row; no additional disk probe is scheduled.

## Native Windows Flash qualification — Codex 7, October 18

`WINDOWS-FLASH-CPU-QUALIFICATION` is a **HARDWARE LIMIT before launch**,
per Bubbs on October 18: no available Windows box has sufficient RAM.
This PC leaves 8.7 GB after the retained estimate, below the floor; the
4090 box has 48 GB total.
After C6 returned local5090, fresh native admission at 10:56Z measured
77,420,777,472 bytes available. The retained 64 GiB Flash planning estimate
would leave 8,701,300,736 bytes, below the unchanged 17,131,606,528-byte
emergency floor. No Host, profiler or model started; no model was copied.
The [preflight receipt](windows-flash-preflight-20261018.json) records this
unmet admission condition. Booking 1453 and both compile guards were
returned at 10:56Z; Gchat2 and C4 were notified. No limits were reduced.

The deliverable remains a normal private bundled Host/Engine Flash load
with native MSVC CPU experts, exact comparison against the retained Linux
C1 token IDs, and normal session-bound shutdown. Reuse Engine
`b76ce57a3cc4823f127a1ce718da454ef1f3510f` and Flash Next pure 2-bit, SHA256
`8bbb85bf6ba669157045bac0a6fdd623dd87694b7b1fe09b7f2150fc3636ab08`,
70,247,086,080 bytes. The protected source is
`/ai/kernel-agent/run_workdir/local/c4-5090-settled-20261015/models/flash-pure-2bit.ginfer`.
The matching Linux evidence under
`/ai/kernel-agent/run_workdir/local/claude-perf-5090-20261017/current-b76-8a73/base/`
supplies four 500-token lists; do not repeat it. Match TP1, context 8,181,
capacity eight, INT8 KV, MTP fixed three, greedy, LFU on and 10 GiB host
headroom. The existing benchmark enforces greedy sampling. C1 uses 2,048
prompt tokens, 500 outputs, one warmup and one measured round. Report any
mismatch without retry. This does not qualify SM86/SM89 or claim speed.

Further qualification requires a native fixture with adequate available RAM;
do not retry on either available Windows box.
The 64 GiB estimate is not a measured bound or admission guarantee. Keep
the retained Job guard's lease, emergency backstop and complete runtime
validation; replace its Qwen-specific preflight with this Flash estimate.
Normal instance creation supplies artifact-scoped Ensure; do not call the
retained Host's explicit AllFormats preparation path. No elapsed model-load
cutoff is authorized.

Owned source/evidence worktree:
`/ai/gchat-worktrees/c7-windows-flash-20261018`. The private native root
`E:\gchat7-windows-flash-20261018` retains only its small preflight receipt;
no package/model payload was created. The extraction command used a donor
path missing its `packages` component and failed before extraction; the
verified donor is
`E:\gchat3-windows-multiarch-20261017\accepted\packages\GChat_2.0.42_x64_en-US.msi`.
Retained donor packages, runtime files and protected model remain untouched.
## Native Windows SM86 / SM89 qualification — PASS, October 18

**SM86 and SM89 Windows are qualified for the exact released images, Qwen
artifact and C1 workload below.** Both native bundled-Host gates and both
same-device Linux ID comparisons passed. The
released bundled Host selected the actual SM86/SM89 executables, completed one
C1 request on each Windows machine and shut down normally. Owner: Gchat 3, branch
`test/gchat3-windows-sm86-sm89-native-20261018`, worktree
`/ai/gchat-worktrees/gchat3-windows-sm86-sm89-native-20261018`.

### Deliverable and fixed acceptance

Qualify the released Windows images on the physical RTX3080Ti laptop `.153`
and RTX4090 `.143`, using GChat `c75096fad`, bundled Host `276d89183` and clean
Engine `b76ce57a3cc4823f127a1ce718da454ef1f3510f`. Verify packaged inventory,
sizes and hashes for all three runtimes and the actual GPU-selected child.
Compare the four generated-token lists from one native C1 request per host
with the matching same-SM Linux b76 reference. An ID mismatch fails the gate;
no tuning, sampling change or context reduction is authorized.

Arch approved Qwen 27B **2-bit mix**, SHA256
`483343c28912ae5db3d00478f16fffb10dcbb0c1317f8c90c09c396fcb6e4ca4`,
10,667,321,600 bytes, with Text TP1, fixed DFlash four, draft TP1, INT8 KV,
Automatic KV and 300MiB headroom, full context262144, graphs/prefix/thinking
and structured outputs enabled, Vision off and prefill auto. The C1 corpus is
`qwen3_8_27b-max-perf-tail2048-v1`: 2,048 prompt tokens, 500 output tokens,
concurrency1, one warmup and one measured round. The benchmark forces greedy
sampling. Compare all 500 IDs in each of
`cold_prefill.{warmup,measured}[0].lanes[0].generated_token_ids` and
`warm_generation.{warmup,measured}[0].lanes[0].generated_token_ids`.

Use private Windows app/data paths, exclusive GPU bookings with WSL quiet,
normal Engine Stop, optional background-profile Cancel and identity-bound
Host Stop. At c750 `/instances` performs artifact-scoped Ensure; the newer
selected-artifact API is absent. Ron permits user-profile installation on these
two test machines; his main PC install stays off limits. No elevation, Windows
settings changes, signing or publication. No performance, other-model,
current-main Host or desktop GUI acceptance is implied.

### Retained native results

| Physical host | Actual packaged child SHA256 | C1 / normal lifecycle | Returned |
| --- | --- | --- | --- |
| `RON-X17R2`, RTX3080Ti Laptop, SM86 | `8a8f6fc261f804fd13d3d41992076bac8b5d84514db98b133da26847d2599d18` | PASS / owned Job empty | 10:48:59Z; Linux-preparation slot379 returned10:59Z |
| `DESKTOP-DG588BU`, RTX4090, SM89 | `14f7d0bd75475ef27f601673ef0ea68596b661e6eaf5973066cd6a98e2bd44de` | PASS / owned Job empty | 11:05:20Z; slot739 canceled |

Both complete runtime inventories passed before the sole instance creation.
The actual children were `windows/sm86/bin/ginfer-serve.exe` and
`windows/sm89/bin/ginfer-serve.exe`, matching their manifests. Both native
builds report clean b76, CUDA13.3.73 and Release. All four native lists contain
500 IDs and have compact-JSON SHA256
`a5ec0932c1b653a9817f54fc3372c9bb52b138b84c0a39263e8f238ccda57605`.
The independent Linux comparisons below also pass.

The owned-process guards passed without emergency or elapsed-time kills.
Arch's native emergency floor is max(4GiB, 12.5% physical RAM): 4,294,967,296
bytes on the laptop and 6,422,114,304 on Ada. Both phases used normal Engine
Stop, normal Cancel for resumed optional remaining-format profiling, then
Host Stop. The laptop's first Host Stop correctly returned busy409 before
Cancel; that receipt is retained.

Evidence root: `/ai/gchat/out/windows-sm86-sm89-native-20261018/`.
Laptop raw request/response and session are under
`laptop-native/api-evidence/`; child and guard receipts are under
`laptop-native/evidence/`. Ada's reviewed
[summary](../../out/windows-sm86-sm89-native-20261018/ada-command-preparation/native-summary.md)
and [result](../../out/windows-sm86-sm89-native-20261018/ada-command-preparation/native-result.json)
link its sanitized `native-evidence/` packet. All 20 copied Ada receipts passed
size/hash checks. No private Host credentials were copied.

### Matching Linux references

The immutable, same-GPU Linux hardware profiles both record CUDA runtime
`13030`. The first exact-source b76 Linux images used CUDA13.1 (`13010`), so
the laptop exited naturally before Ready with a typed profile-inventory
mismatch and sent **no request**. This is an invalid reference, not an ID
failure. Preserve the raw `c1/` and `c1.lifecycle/` receipts. Do not alter or
regenerate either donor profile. The earlier dependency precheck also found
DT_RPATH choosing installed FFmpeg ahead of LD_LIBRARY_PATH; the prepared
cards now preload the verified owned dependency closure and assert actual
resolved paths without changing the ELF.

Both replacement `ginfer-serve` images are built from the same clean b76 source
with S1's existing CUDA13.3.73 toolchain. The durable build ran11:03:46–11:22:48Z,
container `gchat3-b76-cuda133-linux-sm86-sm89-20261018`, on S1
CPUs96–103/booking3251. It used the shared socket1 compile lock,
eight-CPU affinity, compile6/link1/Cargo1 pools, `cmake --build -j`, the existing
release image and read-only `/usr/local/cuda-13.3`. No S1 GPU/model work.
[Command and launch receipts](../../out/windows-sm86-sm89-native-20261018/linux-build-cuda13.3-command.json)
record the effective build. SM86 passed11:13:44Z: clean b76, Release,
CUDA13.3.73, architecture86, 323,274,136 bytes, SHA256
`9259f4aab6b2ada5bbe6339066e8c0f9aea425c1ebb4f5756387f220236a7376`.
SM89 passed11:22:48Z: 298,446,808 bytes, SHA256
`1b433a3fe8735305d28c7b0997e3711d256778bfb3726bc5c7b450de21592ad2`.
Both six-library closures and runtime13030 passed. The full job exited0
without OOM; booking3251 returned11:24Z. No build remains live.

After terminal builds, relay only each new ELF, matching libcudart and small
command/control files during an agreed untimed local5090 boundary. Reuse the
five already verified private FFmpeg libraries. Rebook each target after its
current owner's actual return; no idle hold or preemption. Verify fresh host,
GPU, memory, input hashes, clean b76 version and actual target library closure
before either sole Linux C1 request. Prepared cards/controls are under
`out/windows-sm86-sm89-native-20261018/linux-reference-preparation/`, named
`{laptop,ada}-cuda13.3-{command.txt,controls.json}`. Both cards are bound to the finished ELF hashes. The small command/control
files were staged and verified at11:29Z. The relay waited for actual local
copy/build and destination returns; C1 Ada742 returned12:00Z, then C6 canceled
its unlaunched local1459 to permit the shared untimed boundary. The exact
623,285,104-byte stream (two ELFs plus matching libcudart) passed both target
size/SHA checks and returned12:02:17Z. No binary was retained locally; see
`out/windows-sm86-sm89-native-20261018/linux-relay-result.json`.

Both sole reference cards launched durably after fresh host/GPU and memory
admission: laptop12:03:00Z, booking382/CPUs0–19; Ada12:03:16Z,
CPUs0–31 through12:11Z. Fresh available WSL memory was27,848,900,608 and
41,902,755,840 bytes respectively, above22,478,481,664; no compute apps were
present. Command cards retain ordered build/GPU locks, exact input/library
checks and the Ready-before-stop rule. Laptop reached Ready12:04:06Z and
finished12:04:16Z with normal Engine exit0. Its four 500-ID lists exactly
equal Windows; raw build, source, GPU UUID, workload and startup settings match.
The compiler and private profile path differ; native runtime telemetry reports
13.4 versus Linux13.3. See `laptop-linux-cuda13.3/{result,comparison}.json`.
Booking382 returned12:04Z and C5 received the retained profile reuse path.

Ada reached Ready12:05:26Z and finished12:05:31Z with normal Engine exit0.
Its four 500-ID lists also exactly equal Windows; raw build, clean b76 source,
CUDA13.3.73, SM89, GPU UUID, workload and all startup settings match. The
compiler and private profile path differ. Both runtime telemetry records
report13.3. See `ada-linux-cuda13.3/{result,comparison}.json`. The coordinator
read both pairs of raw responses and independently confirmed all eight exact
500-ID comparisons. Both helpers
reported only the expected historical context-summary diagnostic described
below, with no anomalies. Ada743 was canceled after terminal receipt review;
Gchat2's CPU/RAM Hyper-V guest check follows, then C5 Flash. No bulk local relay
or Gchat3 compute hold remains. C6 local timing1460 returned12:08Z.

Bubbs assigned the current-main/current-dev-next Linux RC rebuild and installed
DEB walk to Codex3 at11:14Z. The inactive RC cache grant, exact retained
packages and prior walk limitations were handed over in
`out/linux-rc-final-20261017/linux-rc-c3-takeover-20261018.md`. No Gchat3 Linux
RC build or fixture hold remains; Windows qualification stays here.

Arch's10:44:20Z Linux policy requires Windows and Linux sequentially and WSL
MemAvailable at least22,478,481,664 bytes before start: the19,257,256,192-byte
startup plan plus a3GiB floor. **Never stop a WSL model before Ready**, including
for memory-floor or booking cutoff. Once Ready, the existing resident runner
enforces its3GiB floor and normal owned-process cleanup; the lifecycle
subreaper retains the build/GPU locks until children are reaped.

Use existing `run_resident_std.py` and `scoreboard_lifecycle.py` from the
retained C5 first-use matrix; both match b76. `resident_report.py` is the
retained compatible helper. This ID-only gate uses full262144 context;
the historical runner's aggregate expects8181/32768 and may report
`INCOMPLETE`/exit3 for `reported TP/KV/context differs` **after saving the raw
response**. Inspect raw source/device/settings/workload and compare four ID
lists directly. Do not call that aggregate a performance PASS or repeat a
completed request to change its status.

### Owned inventory and retention

| Host / owner | Exact root or payload | State / retention |
| --- | --- | --- |
| S1 / Gchat3 | `/media/ron/SSD_RAID/ai/tmp-gchat3-windows-sm86-sm89-native-20261018` | Ten disposable source/build/cache/library children and two exited containers retired12:11Z after both ID gates; 5,573,704,752 logical bytes released. Only 208,384 bytes of root receipts remain, also copied locally with hashes |
| Laptop / Gchat3 | `C:\gchat3-windows-sm86-20261018` | Disposable installer/package/model/ELF/library/tool copies retired12:16Z after C5 returned; 14,965,889,578 logical bytes released. Retains 6,198,169 bytes of immutable profile donor and small receipts |
| Ada / Gchat3 | `F:\gchat3-windows-sm89-20261018` | Disposable installer/package/model/ELF/library copies retired12:12Z in Gchat2's granted untimed gap; 14,915,974,088 logical bytes released. Retains 14,709,917 bytes of immutable profile donor and small receipts |
| Local / Gchat3 | `/ai/gchat/out/windows-sm86-sm89-native-20261018` | Small command/result/evidence files only; no installer, ELF or model retention |

Laptop's original C5 donor path was retired. Exact profile bytes remain at
`/mnt/c/gchat3-windows-sm86-20261018/linux-reference/profile-source.json`,
SHA256 `4ecd1669b73b2066580d8da43b0f2d02db84377f341af9936b18c6c47a24cc72`;
C5 has the immutable reuse path. Ada's owned
`/mnt/f/gchat3-windows-sm89-20261018/linux-reference/profile-source.json`
retains SHA256
`e86245581d6dd3bb8234f5f46f8380fd9a7d8884730c57831154663bc3cb208f`.
Keep both until dependent owners finish. Both images are qualified at the
fixed scope above. Small raw responses and lifecycle receipts are retained
locally. S1 and both target disposable builds, RC copies, models and ELFs are
retired; cleanup used the owners' returned untimed boundaries and preserved
both donor hashes. The small `linux-build-cleanup.json`, `ada-cleanup.json`
and `laptop-cleanup.json` receipts record the removed owned paths. Neither
target has a Gchat3 resource hold. Ron's install and the accepted release
packages are preserved. Release RC archive/path/SHA remains recorded below.
This qualification is complete and ready for merge; the lane returns to
Hosts/first-run GUI rows while Ron's main-PC sign-in gate remains outstanding.

## Installed selected-artifact preparation — Gchat 3, October 18

`GCHAT-PREPARE-SELECTED-ARTIFACT` **merged as `d0e107da6`** from
`fix/gchat3-prepare-selected-artifact-20261018`, implementation `600343062`,
based on `bd10e0e66`. Installed `gchat-cli prepare-hardware` now accepts a
selected local artifact and its startup TP/speculation intent. Host validates
the payload, derives its directory identity and runs artifact-scoped Ensure
without starting a model. Explicit all-format preparation remains available.
The [selected-artifact decision](../decisions/2026-10-16-profile-selected-artifact-before-idle-format-completion.md)
governs validation; callers cannot supply trusted artifact identities. Arch
signed the optional selected-payload request and asynchronous job at 07:36Z.
An identical active Ensure is idempotent; another busy scope or resident model
prevents replacement. C4's artifact Ensure → durable `storage_review` → startup
sequence is preserved.

Focused CLI tests passed 3/3 and Host resource tests passed 26, with five existing
ignores. Affected checks and Clippy passed. The **single `make verify` stopped**
at a copied RC catalog containing superseded Qwen context bounds. Before that
failure, frontend 3,476, extension 127, desktop 762, adapter 21 and Host 275 tests
passed, along with lint, typecheck and quality gates. The approved continuation
corrected only the four admitted catalog names/context bounds, preserving all
174 identities and the other 170 profiles. The exact failed assertion then
passed; untouched manager, Gbot, hardware and utils suites passed 4, 124, 16 and
48 tests, respectively, and both debug binaries built. Frozen source remained
unchanged; no passing suite or `make verify` was repeated. Future copied inputs
must match current admitted values and catalog identities before gates start.

The real installed CLI/Host acceptance passed at 08:11:43Z in a private S1
session. An explicitly labeled recording Engine received one artifact request
with ordered GPUs, TP2, draft TP1, DFlash and four draft tokens. Host derived
the canonical directory identity, retained four runtime registrations and
started no model instance. Normal Cancel and identity-bound Host Stop passed.
This establishes asynchronous forwarding and lifecycle behavior.

Separate **physical Engine acceptance passed at 08:18:07Z** on the local RTX
5090. The unmodified retained e228 SM120a Engine ran `profile-hardware` against
the existing read-only Qwen NVFP4 payload with `--tp 1 --spec auto --json` and
a fresh private profile. Artifact-scoped Ensure completed in 50.665 seconds:
artifact/base complete, all-formats incomplete, no required CPU expert formats
and no saved CPU expert rates. The saved artifact directory identity matched.
The [consolidated result](../../out/prepare-selected-artifact-20261018/result.json)
and [short summary](../../out/prepare-selected-artifact-20261018/summary.md)
record the commands, original verification failure, bounded continuation and
accepted scopes. No Engine change, model inference or GPU/Windows qualification
is claimed.

Owned inventory: source worktree
`/ai/gchat-worktrees/gchat3-prepare-selected-artifact-20261018` retains the
merged source. The S1 fixture
`/media/ron/SSD_RAID/ai/tmp-gchat3-prepare-selected-artifact-tests-20261018`
and two terminal containers were removed at 08:17:52Z, releasing 47,530,681,024
logical bytes. The private runtime/profile root
`/mnt/e/gchat3-prepare-selected-artifact-20261018` was removed after review,
releasing 450,941,063 logical bytes. Protected payload and inactive RC donors
remain unchanged. All bookings returned; local5090 returned 08:18Z. Only the
consolidated result and short summary remain as run evidence. The lane continues
`GUI-PROFILE-MISSING-WORDING` while RCs await Ron's Windows sign-in result.

## Linux missing-driver guidance — Codex 4, October 18

`fix/c4-cli-driver-guidance-20261018` implements
`CLI-INSTALL-MISSING-DRIVER-GUIDANCE`. The novice walk's installed runtime failed
at the ELF loader with exit 127 when `libnvidia-ml.so.1` was unavailable in a
driver-free container; evidence is `test/c4-cli-first-run-20261018` at
`16628ae92`, `out/c4-cli-first-run-20261018/novice/error-cases/error-result.json`.

Linux setup now loads only `libcuda.so.1` and `libnvidia-ml.so.1` declared in the
selected runtime manifest, after complete payload integrity checks and before
any installation write. Failure names the library and manifest CUDA version,
explains system-driver repair and `nvidia-smi`, and gives NVIDIA Container
Toolkit guidance. Preview remains read-only. Driver installation, Engine
behavior and runtime ownership are unchanged. Library loading does not qualify
driver-version or live-GPU compatibility. Arch signed this scope at 04:43:46Z.

Focused setup tests passed all four cases, including both missing-library CLI
failures with existing registration preserved, successful Host handoff, and
preview/integrity ordering. Package tests passed five cases; five Windows
PowerShell cases were skipped on Linux. The **single `make verify` passed at
04:55:01Z**: 3,478 frontend tests and 1,223 Rust tests, with six frontend skips
and 28 Rust ignores. Lint had five existing warnings and no errors. Source
mtimes were refreshed before copied cache reuse; the changed tests executed.
Concise evidence is in [the result](../../out/c4-cli-driver-guidance-20261018/verification-result.json),
[verification summary](../../out/c4-cli-driver-guidance-20261018/verify-summary.txt)
and [command receipt](../../out/c4-cli-driver-guidance-20261018/command.json).

The existing packager completed at 04:57:02Z using the accepted original Host
`36c278f285d1a63f8df9cf813f13d34e1e02cf68`, e2282c336 SM120a runtime and
175-profile catalog. This preserves the original Host/configuration pairing;
the newer launcher Host requiring `runtime_set` was not substituted. No Host or
Engine release rebuild occurred. The refreshed archive is:

```text
/media/ron/SSD_RAID/ai/tmp-c4-cli-driver-guidance-20261018/distribution/ginfer-bundle-0.1.0-linux-x86_64.tar.gz
```

It is 622,161,059 bytes, SHA256
`a0e9c930493b969b2c4e06da74f3de7ff94f5a7615fd1b092166709eaa2212a4`, with
member root `ginfer-bundle-0.1.0-linux-x86_64`. Its setup, original Host, runtime
manifest and guide match their selected inputs; all 178 members and 175
profiles are accounted for in [the archive receipt](../../out/c4-cli-driver-guidance-20261018/archive-result.json).
The first metadata extraction used `source_revision`; the manifest's actual
field is `source_commit`. That receipt-only correction repeated no gate or
packaging. Native setup acceptance passed at 04:58Z: the real driver-free runc
container exited 1 with the declared library, bundled CUDA version, driver repair
and container guidance, before creating any installation target or locator.
The same archive on S1 with its existing driver completed `--install --no-wizard`
with exit 0, created its launcher and registered private Host, and reported idle
hardware preparation. No GPU was selected and no calibration or model ran.
See [native results](../../out/c4-cli-driver-guidance-20261018/native/result.json).

After the successful driver-present setup, the parent unnecessarily invoked
`first-run` on this older Host and hit the known standalone runtime-set defect.
That extra check and failed wrapper are retained and excluded from setup
acceptance; the independent launcher repair is already merged as `a82f8c1e0`
with its own native wizard evidence. No installation or passing gate was repeated.
Future setup-only acceptance must stop at the Host handoff, checking further
first-run behavior only with the launcher branch's matching Host/configuration.
All private Host/keyring/DBus processes are terminal; booking 3006 returned at
04:59Z. Next: merge this isolated setup fix; the model-download/profile journey
still waits for the separately recorded W12 release-catalog publication.

Owned inventory: local source worktree
`/ai/gchat-worktrees/c4-cli-driver-guidance-20261018`; S1 source, archive and
receipts under `/media/ron/SSD_RAID/ai/tmp-c4-cli-driver-guidance-20261018`.
Booking 2995 was canceled and CPUs112–119 **returned at 04:57:55Z**. Verification
used nice10, eight Cargo jobs and the shared socket1 compile lock in pinned
bridge image `sha256:ad7f9bf020d7699a6e87f38a57612413478a6364dd503de5e09805001d44ff14`.
After native acceptance, the owned copied Rust/frontend caches were retired at
05:01:42Z, freeing 23,416,999,936 allocated bytes. The root retains 2,980,278,272
bytes for source, archive, extracted native copies and receipts until merge;
[the cleanup receipt](../../out/c4-cli-driver-guidance-20261018/cleanup-inventory.json)
records the exact scope. Donors and protected inputs are untouched. No GPU or
model inputs were copied.
## First-run step guidance — gates and native prompt PASS, October 18

`CLI-FIRST-RUN-STEP-GUIDANCE` changes exactly two CLI wizard messages on
`fix/c4-cli-first-run-step-guidance-20261018`, based on merged main `84d6b23f0`
(including launcher repair `a82f8c1e0`). The GPU prompt explains that storage and
models come next, followed by profiling after selected downloads are verified.
The profiling page says: “Profiling the selected models before startup.
Profiling continues if you close this menu.” It removes the obsolete 22–73
minute full-install estimate, consistent with the
[selected-artifact decision](../decisions/2026-10-16-profile-selected-artifact-before-idle-format-completion.md).
Behavior, setup ordering, standalone `runtime_set=false`, and Engine are unchanged.

Existing first-run progression cases passed **2/2**, Host check/clippy passed,
and the **one `make verify` passed at 05:03:36Z**: root Vitest 3357 passed
(6 skipped), extension Vitest 121 passed, six critical coverage floors passed,
and Rust suites totaled 1228 passed (28 ignored). Lint had zero errors and five
existing warnings. The release Host built at 05:05:04Z; `ldd` has no missing
dependencies. Its SHA256 is
`a2920cc133201fc260dc38ea25f9d907c19d3d519bf45273f860748aca06f24e`.
[Gate and command receipts](../../out/c4-cli-first-run-step-guidance-20261018/gates.json).

The fresh isolated native replay ran **05:06:53–05:07:08Z** with those exact Host
bytes. It displayed the corrected GPU prompt; selecting GPU 1 advanced to the
recommended private SSD storage and then the actual empty model catalog. Status
is `models`, with no models, downloads or startup profiles and hardware profiling
`idle`. The Host and private keyring stopped; CPU booking **3005** (112–119) was
canceled at **05:07Z**. No archive rebuild, GPU/model execution or calibration ran.
The profiling-page message is source/build checked; publication remains necessary
to reach that page natively. No catalog, model or recommendation was fabricated.
[Result and native receipt](../../out/c4-cli-first-run-step-guidance-20261018/result.json).

One prompt-only attempt had no keyboard forwarding because a Python heredoc
occupied subprocess stdin. It was stopped and cleaned up before the fresh replay.
The corrected launcher uses `python -c` with inherited PTY stdin; no verification
or build was repeated. Next: parent review/merge; the downstream model/profile
walk still waits for W12/Ron release-bearing publication.

| Owner / host | Path | State / retention |
| --- | --- | --- |
| Codex 4 / local | `/ai/gchat-worktrees/c4-cli-first-run-step-guidance-20261018` | Separate source and concise evidence branch; complete, awaiting review |
| Codex 4 / S1 | `/media/ron/SSD_RAID/ai/tmp-c4-standalone-launcher-20261018` | No live job/CPU reservation; owned cache, prior accepted archive and native evidence retained temporarily for coordinated merge/cleanup; new outputs use `step-guidance-*` names |

## Linux archive install command — Python 3.11 or newer, October 18

The novice archive walk on S1 found that the delivered guide's literal
`python3.11 setup.py` command exited 127: this supported installation has
`python3` 3.12.3 and no executable named `python3.11`. Continuing with
`python3 setup.py` installed the archive successfully before the separately
tracked standalone launcher failure. The unchanged setup script already uses
`#!/usr/bin/env python3` and requires Python 3.11 or newer.

`fix/c4-cli-install-python-command-20261018` corrects the
[Linux setup instruction](../lan-host-setup.md) to `python3 setup.py` and states
that prerequisite. The packager copies this guide verbatim into the archive;
maintainers' selected Python 3.11 build environment is unchanged. Evidence is
`test/c4-cli-first-run-20261018` at `7f8e9a61e`,
`out/c4-cli-first-run-20261018/novice/walk-result.json` and its PTY transcript.
This documentation-only fix needs `git diff --check`. Next: include the corrected
guide in the standalone-launcher archive refresh and continue that same novice
walk; there is no new build or model execution for this wording change.
## Standalone launcher runtime ownership — repaired native install/menu PASS; publication boundary, October 18

The private novice installation at `7f8e9a61e` copied the accepted single-image
archive and registered its Host, then the first-run wizard and no-argument menu
failed because they required a desktop runtime-set manifest. The fix on
`fix/c4-standalone-launcher-20261018`, source `05f60c5d5` after `576449a5c`,
repairs that installed route. Engine source/runtime `e2282c336` is unchanged.

The installed configuration requires `desktop.runtime_set`: Linux/Windows
standalone setup writes `false`, desktop installation/repair writes `true`.
Preparation and menu bootstrap share the declaration and strict reader. Desktop
manifests stay required; installed configuration cannot be overridden by
`--runtime-set`. Missing fields report the owning setup/reinstall commands.
Standalone installers reject existing paths; no overwrite upgrade was added.
The desktop writer replaces its configuration atomically. Arch conditionally
signed `576449a5c` at 04:35:34Z and accepted this supported scope at 04:37:07Z.
See the [decision](../decisions/2026-10-18-declare-installed-launcher-runtime-ownership.md).

The final combined archive was packaged at **04:44:08Z**:

```text
/media/ron/SSD_RAID/ai/tmp-c4-standalone-launcher-20261018/distribution-actionable-recovery/ginfer-bundle-0.1.0-linux-x86_64.tar.gz
```

It contains 178 members, the current Host, setup, the accepted SM120a runtime and
qualified profile catalog. The existing packager verified 171 runtime payloads;
Host `ldd` has no missing dependency. Archive SHA256 is
`8239716c9055b9ba210dfb77c9ecf3554fcc6eb455673500f79f81def902f8e0`.
The packaged guide preserves the runtime-ownership paragraph and combines only
the Python command/prerequisite correction from `65df08dda`. Its literal
`python3 setup.py` command succeeded using S1 Python 3.12.3.
[Archive receipt](../../out/c4-standalone-launcher-20261018/archive-result.json).

The native replay ran **04:45:34–04:46:51Z** in a fresh private HOME/XDG,
DBus session and unlocked keyring, on CPUs 120–127. It accepted the three default
private installation paths, selected GPU 1 by UUID, accepted the managed SSD
model root, and reached the actual model catalog. One Refresh still returned an
empty catalog. Installed no-argument `ginfer` then opened the real main menu;
Download models reported no published compatible packages and offered Add a
local model. Storage showed 1534.5 GiB free. The configuration declares
`runtime_set=false`, and installed Host bytes match the packaged Host. The exact
owned Host and keyring are stopped; CPU booking **2986** was canceled at **04:46Z**.
No model, download, calibration or GPU measurement ran.
[Native result and transcript links](../../out/c4-standalone-launcher-20261018/novice/result.json).

This establishes the repaired installer/wizard/menu route through the catalog
boundary. It does **not** establish model recommendation, download admission,
profiling or Ready. Arch confirmed at 04:45Z that no public release-bearing
catalog exists and publication waits for W12/Ron. No URL, private fixture or local
registration was invented to bypass that prerequisite. There is no hardware
profile: native status has no measured storage candidates/rates, so the shown
managed-root recommendation is a fallback, not a measured fastest-disk result.
No-space download admission remains blocked on an actual published release.
The parent's separate unchanged-runtime no-visible-GPU/driver receipts are at
`16628ae92`; those checks were not repeated here.

A separate novice wording defect was observed: the GPU prompt says **“Profiling
starts after selection.”** Selecting the GPU actually advances to storage and
then the catalog while hardware profiling remains `idle`. This wording was
reported to the parent and is excluded from the runtime-ownership source fix.
The profiling page was not reached, so its duration wording has no native result.
Next: parent reviews/merges this fix; release-bearing publication remains the
prerequisite for the downstream novice walk. A separate wording branch may use
the retained owned cache after merge. GPU execution needs its own actual booking.

Verification is complete for this change. The original focused Linux setup,
installed-launcher, argument-ownership and desktop-writer cases passed. The one
`make verify` invocation passed lint/typecheck/early contracts, then failed root
Vitest because archived source lacked generated `core/dist/index.js`. Authorized
recovery built that prerequisite, ran only the failed/unexecuted stages, and
passed root coverage (3344 tests, 6 skipped), extension coverage (121), six critical
coverage floors and Rust (1223 passed, 28 ignored). No full verification or
previously passing suites were repeated. The two new actionable-reader/preparation
regressions each executed exactly one case and passed, followed by affected Host
check/clippy and incremental release. First follow-up epoch mtimes had reused
stale test binaries and matched zero tests; those invalid receipts remain.
Recovery advances changed-source mtimes and requires each named one-test result
before continuation. [Current result](../../out/c4-standalone-launcher-20261018/result.json).

| Owner / host | Path | State / retention |
| --- | --- | --- |
| Codex 4 / local | `/ai/gchat-worktrees/c4-standalone-launcher-20261018` | Source, authority and concise tracked archive/native receipts; no active job |
| Codex 4 / S1 | `/media/ron/SSD_RAID/ai/tmp-c4-standalone-launcher-20261018` | Final archive 594 MiB; native-target 25 GiB, cargo-home 2.3 GiB, source/dependencies 2.2 GiB and private replay 1.7 GiB temporarily retained for parent merge and next wording fix. All jobs terminal; CPU 120–127 returned. Three exact superseded/partial archives retired; shared donor untouched |
| Codex 4 / S1 | `/media/ron/SSD_RAID/ai/tmp-c4-cli-first-run-20261018` | Failed baseline install and owned release cache retained until parent cleanup decision; no live job |
## Standalone Linux CLI novice archive — catalog publication boundary, October 18

The current-source standalone archive is **assembled and integrity-checked** on
S1 (`ron@192.168.1.109`, `AIS-2-8592-L01`):

```text
/media/ron/SSD_RAID/ai/tmp-c4-cli-first-run-20261018/distribution/ginfer-bundle-0.1.0-linux-x86_64.tar.gz
```

It is **622,160,226 bytes**, SHA256
`ae903f3f4c397e132a87c8980fef0d313d4124f7d0f447e0dc08d7fe7e6c22c5`.
Host and bundled `setup.py` are from main
`36c278f285d1a63f8df9cf813f13d34e1e02cf68`; their inputs are unchanged from
`548d73ed8`. The separately retained accepted Engine is clean
`e2282c336d114b7dcebdfa1a179bfb342731a8b8`, **SM120a only**, with its existing
CUDA 13.3/Linux runtime manifest. This is an explicit two-component assembly,
not an Engine rebuild or a multi-architecture release.

The Host build/package job passed at **04:05:09Z** using the retained offline
image, a private copy of dependency/release caches, eight socket-1 CPUs, nice
10 and the shared compile lock. Cargo used the unmodified release profile and
finished its current-source build in 1m27s. The old `ed68c7443` Host was only a
read-only cache donor. The existing `scripts/package-ginfer-host.py` then
packaged the new Host, current Linux setup/installer and documentation,
retained runtime and qualified Linux profile catalog. All **178 archive
members** match their selected inputs, including every one of the runtime's
171 files and the unchanged values of all 175 catalog profiles. The Host's
noninteractive `--help` and dependency check passed; it requires glibc 2.39 and
system OpenSSL 3. No `make verify` ran for this source-unchanged packaging task.

The CPU-only novice walk completed at **04:13:52Z** in a fresh private S1
HOME/XDG, DBus session and unlocked test keyring, with recorded interactive
inputs/output. It used the archive's documented setup path and default locations.
The literal documented `python3.11 setup.py` first failed because S1 has no
`python3.11` executable (exit 127); the available `python3` is 3.12.3. Continuing
with `python3 setup.py` copied the runtime, created the launcher and started a
private Host. Hardware preparation stayed **idle**, with no selected GPU and no
calibration. Setup then failed (exit 1) before the GPU-choice prompt:

```text
GChat linux engine runtime set is unavailable: No such file or directory (os error 2)
```

The installed no-argument `ginfer` menu failed with the same error (exit 1).
This is a reproduced **GChat Host installed-launcher/runtime ownership defect**,
not an Engine inference or no-argument-dispatch defect. The combined standalone
archive deliberately installs one `ginfer-linux-runtime-v1` image in the selected
runtime directory. `scripts/setup-ginfer-linux.py` writes a `desktop` launcher
configuration and omits `--runtime-set`, as the Host's prepare-hardware help
requires for a single-image install. However,
`InstalledConfiguration::connect_resolving` in
`src-tauri/ginfer-host/src/launcher.rs` calls `desktop_runtimes(provider)` before
resolving the already registered owner. That loader requires GChat's separate
`provider/linux/runtime-set.json` and all four architecture images. Those files
are not part of this standalone package. The initial prepare-hardware path had
already registered the correct single-image owner with an empty runtime map.

Installed CLI, hardware-profile, CPU-phase-profile, server, Host, first-run and
prepare-hardware help all returned 0; server version matched retained clean
`e2282c336`. A nonexistent model path returned its precise open-path error and
exit 1 before device setup. A separate private Host invocation using the public
`--nvidia-smi` option with a nonexistent executable returned a clear inventory
error and exit 1. This checks unavailable inventory tooling, **not** a physical
missing-driver/GPU installation. The passive CUDA-order command rejects a set
`CUDA_VISIBLE_DEVICES` mask by contract (exit 2); that is not missing-GPU
qualification. No profile measurement, model load or Engine inference ran.

The Python command correction is merged as `36c0147db`; the separate launcher
source branch `fix/c4-standalone-launcher-20261018` is completing its accepted
runtime-ownership fix and fresh archive replay. Do not fabricate a four-image
runtime set or change GInfer's delegating CLI to mask the original failure.
The repaired launcher continuation is recorded in the owning source branch
`fix/c4-standalone-launcher-20261018`: its fresh private archive installation
reached GPU intent, storage selection, the actual empty catalog and the no-argument
menu at 04:46:51Z. No hardware profile, calibration or model was started. Its
recommended storage path is a fallback, not measured fastest-disk evidence.

Arch confirmed at **04:45:01Z** that no public release catalog exists and its
publication belongs to Ron-gated **W12**. Existing GChat/GInfer/ginfer-tools
release tools have no writer for the application publication catalog; the
ginfer-tools release-wave manifest has a different contract. No catalog or URL
was invented or baked into a build. Download, model/profile recommendations,
artifact profiling, measured fastest-disk selection and insufficient-space
admission remain **waiting on W12 publication**. Acceptance of the launcher
repair does not close these remaining novice-journey gates. The native GPU
prompt also promises profiling immediately after selection although the actual
next step is storage; record and fix that wording separately.

The remaining isolated Engine error checks finished at **04:39:56Z**, using the
same installed, unchanged `e2282c336` runtime and a real registered TP1 artifact.
With process-local `CUDA_VISIBLE_DEVICES` empty, the ordinary inference command
returned 1 with `cudaGetDeviceCount: cudaErrorNoDevice: no CUDA-capable device is
detected`, before model materialization or device allocations. This checks
no visible GPU, not a physically removed device. In the existing pinned runc
container with no NVIDIA device/driver injection, the same installed runtime
returned 127 at ELF loading: `libnvidia-ml.so.1` was unavailable. This is a real
missing driver-library environment, with the physical host driver untouched;
it exposes an unhelpful raw loader error without NVIDIA setup guidance. Record
that separately as `CLI-INSTALL-MISSING-DRIVER-GUIDANCE`. No CUDA calibration,
model load, source change or verification rerun occurred. The private keyring
and D-Bus session stopped normally, the container exited, and CPU booking 2987
was canceled at **04:40Z**. Commands, scope and outcomes are retained in
`out/c4-cli-first-run-20261018/novice/error-cases/error-result.json`. Native
insufficient-space admission remains unaccepted; no disk was filled.

Codex 4 owns branch `test/c4-cli-first-run-20261018` and worktree
`/ai/gchat-worktrees/c4-cli-first-run-20261018`. Concise local receipts are in
`out/c4-cli-first-run-20261018/` (`build-command.json`, `build.log`,
`archive-result.json`, member list and Host help/dependency results), with the
same terminal and archive receipts in the owned S1 root above. The complete
novice transcript and concise `walk-result.json` are in that local folder's
`novice/` child; private Host state/credentials stay outside Git. Its `gchat`,
`cargo-home`, `native-target`, `bin`, `distribution` and isolated `novice` install
retain **15.61 GB allocated** pending the observed fix; the exact archive and
tested Host build remain the candidate. No other session's donor, accepted runtime
or model was changed. The build wrapper/container are terminal; booking 2955 was
canceled and CPUs 120–127 returned at 04:06Z. The private novice Host, keyring,
DBus and PTY are also terminal; exact owned PIDs were checked after normal
SIGTERM shutdown. Booking 2963 was canceled and **CPUs 120–127 returned at
04:14Z**. Saved private state has no selected GPUs, models or startup profiles.

## Linux RC of record — release Flash High PASS, October 17

The retained unsigned, unpublished Linux release RC is **GChat
`ed68c7443d3d782869dad89736ca049631f8a157` + Engine
`e2282c336d114b7dcebdfa1a179bfb342731a8b8`: PASS**. CLI, Host and desktop
were built with the existing release targets; complete package/archive checks
passed. This release supersedes the earlier ed68 dev-profile binaries. The
[final result](../../out/linux-rc-final-20261017/current-ed68c7443-e2282c336-release/result.json)
and [GUI observations](../../out/linux-rc-final-20261017/local5090-ed68c7443-e2282c336-release-flash-high/gui-dom-evidence.jsonl)
resolve the older Flash High blockers below for this release and this scope.

The final mounted AppImage used a private HOME/XDG/runtime, DBus and unlocked
keyring on the local RTX 5090. Custom Flash pure 2-bit
(`8bbb85bf6ba669157045bac0a6fdd623dd87694b7b1fe09b7f2150fc3636ab08`)
Load used context **8192**, concurrency **1**, speculation **none**, Vision
**off** and **Automatic KV**. Load was clicked at **19:18:15.682Z**;
Engine reported loaded in **132.883 seconds**, and the GUI reached Ready.
One **High** request sent at **19:22:13.798Z** answered exactly **`RC_OK`**.
Normal GUI Stop followed at **19:22:42.020Z**; the app exited normally and
private Host, mount and helpers were retired by **19:23:03.089Z**.

This qualifies that retained release AppImage's custom-load/High-request path.
It does not qualify default Installed Load (no matching RTX 5090 Flash catalog
profile), other models, current-main Linux bytes, or Windows. Ron's Windows
installer/sign-in test remains the next release gate; the later Windows RC is
recorded below. A current-main Linux refresh requires its own assigned build
and acceptance, rather than inheriting this result.

Both packages remain in
`E:\gchat-linux-rc-20261017\linux-rc-ed68c7443-e2282c336-release` and on S1 under
`/media/ron/SSD_RAID/ai/tmp-gchat3-linux-rc-refresh-20261017/packages-current-ed68c7443-e2282c336-release/`:

| Release package | Bytes | SHA256 |
| --- | ---: | --- |
| `GChat_2.0.42+rc20261017.release.gchated68c7443.enginee2282c336_amd64.deb` | 2,733,559,300 | `4251e175fe83ec3abfe7f3ab33cbc795f8f2bfe07210376403fbbb2ac24bacc5` |
| `GChat_2.0.42_rc20261017.release.gchated68c7443.enginee2282c336_amd64.AppImage` | 2,857,138,680 | `f75e612779ba1796447d3a8493652859f1845622e782dbe8655617c878529d4e` |

### Retained donors and historical local cleanup, October 18

Protected S1 inputs remain at
`/media/ron/SSD_RAID/ai/tmp-gchat3-linux-rc-refresh-20261017/packages-current-ed68c7443-e2282c336-release/app-stage`
(the release AppDir) and
`/media/ron/SSD_RAID/ai/tmp-gchat3-linux-rc-refresh-20261017/app`
(the read-only build/cache donor). C3, C4 and C7 have independent-copy grants
for the app donor; none authorizes donor mutation. C4 completed its read-only
`runtime-set-e2282c336/sm120a` copy at **06:40Z** and released the donor hold.

The [cleanup result](../../out/linux-rc-final-20261017/cleanup-result-20261018.json)
and [short cleanup account](../../out/linux-rc-final-20261017/README.md#local-disposable-payload-cleanup--2026-10-18)
record retirement at **06:42:31Z** of **232 selected historical local files**:
**19,968,435,665 logical bytes** (**19,969,183,744 allocated bytes**).
Existing manifests and accepted transfer/source receipts bound literal names
and sizes; no new large hashing, copy or directory deletion ran. An earlier
acceptance cleanup had missed detached private desktop helpers. This pass
verified their PID/start/cwd/private-HOME identities, terminated only the six
authorized helpers, confirmed them absent, and found no selected-path references
in readable process metadata before unlinking the selected files.

The mismatched-size d31 Host remains without an exact local-copy binding.
Generated seed inputs, frontend/asset payload archives and residency libraries
remain outside the deletion set, as do two stale AppImage FUSE mounts. All S1
donors/stages/packages, Windows-visible RCs and `/ai/gchat/out/linux` are
preserved. Unreadable non-dumpable/other-user process metadata limits the
liveness check; this is scoped local retirement, not a fleet cleanup claim.
The small JSON receipt and short account retain the disposition; no new build,
model run or acceptance rerun was needed.

## Windows RC refresh — current main and Engine, October 18 afternoon

The unsigned Release RC is built, accepted and delivered. Bubbs resumed Codex4's
native installation, first-user walk and chat on the4090 and laptop at22:07Z
while Arch decides the separate Flash quote diagnostic. `d90e96f17` identifies
the accepted RC documentation; its compiled package remains GChat250df804a /
Engine6b85ecf77 below. Nothing is published; the builder's installed app/profile
is excluded. Ada is installed, but its Automatic chat remains blocked by native
profiling RAM admission; the23:00Z idle-window preflight failed before any
retry. The laptop installer is staged and its installed walk follows C5's
current first-use run.

| Field | Refreshed RC |
| --- | --- |
| GChat | `250df804ac3efc73832ac4f805b137a226522a27` — main at assignment |
| Engine | `6b85ecf77da129fe332818b8bcaec9467b56bdaa` — dev/next at assignment |
| Images / profile / signature | Separate SM86, SM89, SM120a / Release / NotSigned |
| NSIS bytes / SHA256 | 1,484,393,816 / `1090efe265225e09274972bfc59755bbddbec7409e5126f8aab0a9934f52b211` |
| MSI bytes / SHA256 | 1,562,340,922 / `e54360dba49d4a11162c3010d4777e871c3381814af8175d16daa0183f3ed56c` |
| Delivered | 19:08:49Z on `RON-9950X3D2`, beside the preserved previous RC |

```text
C:\Users\Ron\gchat-windows-rc-ed68c7443-20261017\windows-rc-ed68c7443-e2282c336-20261017\GChat_2.0.42_x64-setup.250df804a-6b85ecf77.exe
```

All three native Engine images passed archive integrity and CLI/server help
checks at18:03Z. The production frontend, CLI, Host and desktop compiled; NSIS
and MSI packaging passed18:54:25Z. Final acceptance passed19:08:41Z: complete
14-catalog/103-profile equality, pinned sources, both package hashes and native
Job exit0 with no remaining owned processes. Delivery preserved the previous
RC and verified the new unsigned NSIS. Durable WSL parents held both canonical
locks through native Job exit. The final booking1490 was canceled at19:14Z;
local5090 returned to Gchat3. The subsequent target installation and walk are
recorded below.
The existing publisher, packager and Job/memory guard were reused. Canonical
small receipts are under
`/ai/gchat/out/c4-windows-rc-refresh-20261018/{engine-release,app-installer,package-acceptance}`;
acceptance authority is `package-acceptance/{app-result.json,native-guard-result.json,rc-delivery-result.json}`.

An owned PowerShell status observer accumulated85.82GB RSS. Its command,
creation time and PID45328 were verified before retirement19:07:58Z; available
native RAM recovered to96.32GB. The cause of growth is unproved. Future status
observations use bounded .NET byte reads or small terminal JSON instead of the
previous Get-Content-tail observer. The small retirement receipt is retained in
`app-installer/observer-retirement.json`.

Bubbs's18:20Z disposition uses qualified Windows Qwen INT `bcf29abd` for the
4090 Automatic chat, catalog
`windows-rtx4090-qwen38-groupwise-int-dflash2-q4`. The pinned catalogs contain
no3080Ti laptop profile. On the laptop, retain Automatic's actual
`no_qualified_profile`, then use the authorized hand-picked Qwen2-bit mix
`483343c2` for one chat. That catalog gap is accepted and does not block the RC.
No Linux profile becomes native Windows qualification. Installation preserves
existing user data and any detected install directory; no reset or uninstall
is authorized. Observe genuine first-user state, actual Ready, one complete
ordinary new chat and normal model Stop on each target.

Read-only19:12Z metadata confirmed both retained exact artifacts accessible
through registered WSL distro `Ubuntu`: the Ada INT donor under
`\\wsl.localhost\Ubuntu\ai\ginfer-artifacts\qwen38-muse-tp1-tp2-tp4-2026-09-02-r1\qwen38_27b_int_df2.ginfer`
and the laptop mix under
`\\wsl.localhost\Ubuntu\home\ron\tmp-c5-laptop-natural-c4-soak-rerun-20261018\pkg\qwen38_27b_smol_df2.ginfer`.
Native Temp parents have ample space; the later Ada staging/installer attempt is recorded below.
C5's ordinary laptop Qwen Download completed20:05Z. After artifact setup
recovery, Automatic Load was rejected before Ready; no laptop natural or
Engine run completed. The signed Ada Qwen natural passed. Both targets
returned20:30Z with no C5 hold. Gchat3's local native Muse1498 returned20:34Z;
the earlier native arena rejections remain evidence for Arch's decision to
permit platform-specific Automatic sizing. All C5 raw evidence relays returned
20:35:35Z, and C4's guided quote ELF relays returned20:37:39Z. The guided
quote SM86/SM120a/SM89 builds and focused tests passed on S1.

C6's Ada seam5 gate returned20:41Z. The guided dry quotes initially reported
laptop82944/81920 and Ada140288. Laptop live82944 and the separately authorized
81920 stepdown both rejected before Ready: quote omitted the serving request
reserve. Bubbs prioritized that correction ahead of these RC walks. Corrected
source `c26257593` shares serving's request-budget callback; focused tests and
all three corrected no-load checks pass. At21:14Z the laptop reported a
conservative67584 bound and typed rejection for81920; Ada remained140288.
The build/physical packet is GInfer `a8a1bf8d1`,
`docs/fn-graph-probe-startup/README.md`. The directed laptop67584/C8 live
witness rejected before Ready21:23:18Z (native1, no requests/swap); C5 retained
its full packet in `febe380cc`. Ada was not launched. Arch21:32Z holds both
targets until the corrected bound. GInfer diagnostic25a62767c exposes the final
Host requirement/capacity after probe retirement without changing budgets;
its retained SM86 Release build passed21:49:08Z and returned21:52Z. The
matched67584 quote/Ready-only controls are prepared in GInfer `f098846f1`,
and Arch21:57Z/22:03Z authorized that one matched diagnostic. Bubbs's22:07Z
Windows RC priority deferred its execution; no diagnostic rerun has occurred.
Flash physical equality and final Arch sign remain pending. Bubbs separately resumed
the Windows RC walks at22:07Z. Ada's accepted installer transfer returned22:14Z
with matching SHA256. Booking791 covers22:14–22:44Z. The genuine NSIS
Welcome controls exposed no usable UIA patterns; Bubbs22:17Z authorized normal
Cancel followed by `/S`. Welcome closed normally, and the accepted package's
silent install exited0 at22:23:23Z, preserving the ordinary per-user destination.
The installed app is `C:\Users\Ron\AppData\Local\GChat\gchat.exe`, version2.0.42.
Its SHA256 `9ef66e8aec3ed66a3e967109e1ae7c2ab43ca42a76fc6599350f12afc3d62d1f`
is the packaged executable with Tauri's three-byte bundle marker changed from
`UNK` to `NSS`; the retained donor and installed bytes otherwise match.

A launch-helper identity race ended before desktop capture. The corrected
bound helper reuses the completed installation and launched the installed app
at22:27:31Z under the inherited guarded Job. Genuine Welcome appeared. The
Windows Firewall prompt was dismissed by its verified normal close without
Allow or settings changes. Fresh UIA traversal then exposed named WebView
controls without a focus workaround, restart or accessibility flag. Models
shows this computer's RTX4090, no registered model and Automatic selection.
The retained INT import completed22:35:43Z. The native file dialog lacked
UIA patterns; Bubbs22:34Z approved identity-bound WM_SETTEXT and BM_CLICK
for that Ada dialog only. Recorded handles bind its filename Edit132348 and
Open button197844 to app14764/dialog1770820. Automatic was selected
(ToggleState On22:37Z), and Load model was invoked once at22:37:50Z. The
artifact check completed, but native hardware profiling failed before Engine
startup: its retained-buffer GPU probe could not fit inside the actual RAM/node
floors. `hardware-profile-job.json` records native exit1, the correct SM89 CLI,
GPU UUID and retained INT artifact. No Ready or chat occurred; Load was not
retried and no profile was substituted. Normal Close at22:41:15Z stopped the
app and its Host; the inherited Job exited0 and empty at22:41:16Z. Booking791
was canceled and Ada returned22:41Z. The Automatic chat remains blocked on
this concrete profiling failure. Small native receipts are under
`ada-native-walk/installed-desktop/`; installer and helper failures remain
under the preceding `silent-install/` evidence.

Arch22:42Z assigned the read-only **WINDOWS-RC-ADA-PROFILE-RAM-FLOOR** diagnosis
before any profiling retry. The pinned Engine's
`src/product/hardware_profile/gpu.cpp:58` reads live global and NUMA-node
availability, but reserves `max(8GiB, totalPhysical/4)` in global RAM before
admitting each incremental retained buffer. Ada's51,376,914,432B physical RAM
therefore produces a12,844,228,608B reserve. The retained guard samples around
the22:38:55–22:39:00Z profiling failure show11,638,579,200B available at22:38:51Z
and10,477,039,616B at22:39:01Z, both below that reserve. They establish low
native availability around the failure; the generic exception records neither
the rejected allocation size, exact availability, NUMA node nor node availability.
The first GPU transfer gate normally requests536,870,912B, but the failing
caller's identity is not retained. Historical vmmem commit was not sampled.
A separate22:44Z read found vmmemWSL private33,205,932,032B; that later value
does not prove its size or cause at failure time. The small source/telemetry
packet is `ada-native-walk/installed-desktop/profile-ram-floor-readonly.json`.
Arch22:47Z directs **no floor change**. Implement a typed profiler failure with
the reserve, retained-buffer bytes per node, global/node availability and
amount to free, surfaced as an actionable GChat first-run message, with one
forced-low-RAM regression. His environmental disposition requires one Ada walk
retry with WSL lanes idle and native availability at least reserve plus buffers,
recorded before launch; Bubbs assigned23:00–23:30Z with all Ada WSL lanes idle.
If native memory remains insufficient, record the available/vmmem figures and
return without retry. Gchat3's authorized Muse retry follows the RC's normal
return sequentially in that window. No WSL shutdown or RAM
reclamation is authorized while other lanes are live. The reserve policy versus
Engine serving's10GiB headroom is outside this row. Source work is split between
owned `c4-profile-ram-admission-20261018` GInfer and
`c4-profile-ram-message-20261018` GChat worktrees; the pinned RC remains unchanged.

The23:00:15Z read-only preflight during the agreed WSL-idle window found
**11,882,221,568B available**, below the first GPU-transfer gate's
**13,381,099,520B** reserve-plus-buffer requirement by **1,498,877,952B**.
The physical total and12,844,228,608B reserve are unchanged. `vmmemWSL` PID21468
held32,232,009,728B working set and33,236,049,920B private committed memory;
its48,435,757,056B virtual size is a separate measurement. System commit was
41,624,854,528B. No native GChat/Host/Engine process was present. The small
receipt is `ada-native-walk/installed-desktop/wsl-idle-2300-preflight.json`.
C4 did not launch or book a profiling retry, reclaim memory or change settings,
and returned the boundary to Gchat3 at23:00Z. The RC Automatic chat remains
unexecuted; the next Ada retry requires an admitted environment and renewed
coordination. The typed product failure and first-run message continue through
focused verification independently.

C5's corrected1209/e001 laptop app gate returned22:28Z after a pre-Engine
fixture CLI rejection, with no C5 hold. C4 had not yet staged or launched there at that boundary. Arch
22:14Z clarified that its qualification hold permits the pinned6b85 manual
C1 text-only RC chat without explicit arena or bypass. Any pre-Engine
rejection is an RC finding under QUOTE-ADMISSION-EXACT-VRAM. No coordinate,
SendKeys, CDP or guessed-control fallback is authorized. The installed
first-user walks and both new chats remain incomplete. This Windows
authorization does not release either card for held Flash experiments.
Recheck each shared boundary before staging or launch; earlier returns grant
no future resource hold. Gchat3's Ada792 returned22:49Z after a pre-Engine
profiling rejection, following local1506's22:44Z return. The laptop's accepted
1,484,393,816B installer relay returned22:51:15Z with matching bytes/SHA256.
The two retained guarded command files are staged and hash-verified, unexecuted.
Fresh22:50:54Z native metadata reports RON-X17R2, no GChat/Engine
process or GChat installation,34,015,064,064B physical and17,103,478,784B available
RAM. No installer or app has launched there. A fresh booking attempt met
Codex5's exclusive427 first-use run22:51–23:31Z; the installed walk remains
queued after its normal return, without a reservation or preemption.
C7's local-model acceptance can share the
laptop walk before its single Start: retain the visible empty/unset download
catalog and registered local model without a download dependency, then the
settings quote's identity, memory estimate and no-start behavior. Change a valid
field and observe invalidation, then restore and recheck the original launch
controls. Preserve existing profile/catalog state; unexpected nonempty state is
reported rather than manufactured. A nonempty catalog is a secondary C7
empty-catalog acceptance gap: preserve the settings and continue the authorized
primary RC install/chat walk. The pinned RC contains this UI; native behavior
remains unobserved. The
[Gchat3 procedure handoff](/ai/gchat/out/windows-rc-current-main-20261018/rc-owner-handoff-20261018.md)
and the retained candidate-bound UIAutomation recipe govern execution.

| Owner / host | Owned path | Purpose / retention |
| --- | --- | --- |
| C4 local WSL | `/ai/gchat-worktrees/c4-windows-rc-refresh-20261018` | Branch `build/c4-windows-rc-refresh-20261018`, current record |
| C4 local WSL | `/ai/gchat/out/c4-windows-rc-refresh-20261018` | Small command, result and target metadata receipts; no binaries |
| C4 local WSL | Engine `6b85ecf77` in `/ai/ginfer` Git objects | Pinned source retained; former `/ai/ginfer-worktrees/c4-windows-rc-engine-20261018` source tree is absent |
| C4 local Windows | `E:\gchat4-windows-rc-250df804a-20261018` | Accepted images/packages; retain through both target walks, then retire disposable builds. Gchat3's read-copy returned19:05Z |
| C4 Ada Windows | `C:\Users\Ron\AppData\Local\Temp\gchat4-windows-rc-250df804a-20261018` | Accepted NSIS and small Job/UIA receipts; installed RC/import complete, Automatic blocked by profiling before Engine. App/Host stopped and791 returned22:41Z. Retire staged package after walk |
| C4 laptop Windows | `C:\Users\Ron\AppData\Local\Temp\gchat4-windows-rc-250df804a-20261018` | Accepted installer and guarded commands staged22:51Z, no launch; retain through installed walk |
| C4 source | `/ai/ginfer-worktrees/c4-profile-ram-admission-20261018`, `/ai/gchat-worktrees/c4-profile-ram-message-20261018` | Typed profiler failure and actionable first-run UI; unchanged reserve, focused verification next |

## Windows RC refresh — release installer delivered, October 18 morning

Bubbs's post-merge refresh is **PASS**. The unsigned Windows release installer
was delivered at **03:35:36Z** beside the previous RC, without overwriting it:

```text
C:\Users\Ron\gchat-windows-rc-ed68c7443-20261017\windows-rc-ed68c7443-e2282c336-20261017\GChat_2.0.42_x64-setup.c75096fad-b76ce57a3.exe
```

| Field | Delivered RC |
| --- | --- |
| GChat | `c75096fad6b20fc005b98b5e8885cc2afe4257b7` (main when this refresh was assigned) |
| Engine | `b76ce57a3cc4823f127a1ce718da454ef1f3510f` |
| Profile / signature | `release` / `NotSigned` |
| Size | 1,481,874,830 bytes |
| SHA256 | `09af5d8d16f5ae1a446c82a1b1035af7462f72b07df1fe3f3e08c2bf66ae6ef6` |
| Native builder | `RON-9950X3D2` |

The previous `GChat_2.0.42_x64-setup.ed68c7443-e2282c336.exe` remains in the
same folder; its retained SHA256 was verified unchanged. No installer was run,
no settings were changed, and no signing or publishing occurred. **Ron's
Windows installation/sign-in test remains pending.** This delivery does not
claim acceptance of that test or a Linux RC refresh.

The production frontend, release CLI, Host and desktop all built successfully.
Existing Tauri packaging produced both NSIS and MSI. Final validation passed
complete equality with the accepted **14 catalogs containing 103 profiles**,
including profile values, schema and unique IDs. The accepted same-revision
SM86/SM89/SM120a Engine archives were reused. Their build, integrity, dispatch,
cold-CLI bootstrap and Arch-accepted packaged-Host request evidence below remain
valid; no duplicate Engine builds, dispatch tests or inference requests ran.
The incidental MSI was hashed successfully, then retired with disposable build
outputs after the NSIS delivery; its hash and size remain in `app-result.json`.

The first NSIS compression attempt reached its booked 03:12Z cutoff without a
completed installer. A packaging-only continuation reused all compiled inputs
and completed both packages at 03:30Z. Its validator then confused catalog and
profile counts. Metadata-only follow-ups corrected that count, workstation-name
case and the desktop executable timestamp (Tauri bundle patch/restore updates
it). Those failed receipts remain; they required no package change or rebuild.
The final validator checks separate counts and full catalog equality, bounds
the desktop timestamp by packaging completion, and normalizes host-name case.
A durable WSL parent held the compile lock through each native guard's exit,
correcting the initial launch-wrapper timeout that released its lock early.
Final metadata, guard and delivery receipts all pass.

Gchat 3's branch is `build/windows-rc-current-main-20261018`, worktree
`/ai/gchat-worktrees/windows-rc-current-main-20261018`. Canonical concise evidence
and retained failure/build receipts are at
`/ai/gchat/out/windows-rc-current-main-20261018/`; final authority is
`package-acceptance/{app-result.json,native-guard-result.json,rc-delivery-result.json,native-retirement-result.json}`.
Native receipt folders under `E:\gchat3-windows-rc-c75096fad-20261018` retain
1.13 MB; canonical receipts retain 1.28 MB. The generated build diff is preserved.
At **03:38:02Z** the six owned disposable children (`source`, `cargo-home`,
`yarn-cache`, `yarn-global`, `build-tools`, `profile-catalogs`) were removed,
including duplicate package outputs and the incidental MSI. No native job
remained. Booking 1411 was canceled and **local5090 returned 03:38Z**.
Accepted Engine ZIPs under
`E:\gchat3-windows-multiarch-20261017\accepted\runtimes`, read-only dependency
and Linux AppDir donors, the previous RC and delivered NSIS remain retained.

**SM86 and SM89 Windows passed the native qualification recorded above.**
Ron corrected the earlier WSL-only inventory: the fleet 4090 and laptop both
have native Windows. This qualification binds the tested release images,
artifact and workload; Ron's main-PC installer/sign-in gate remains separate.

## WINDOWS-MULTIARCH — accepted and merged as c75096fad

Gchat 3 owns `fix/windows-multiarch-20261017`, based on GChat main `9e75fc31e`.
The deliverable is one Windows installer carrying separate SM86, SM89 and
SM120a runtimes from the same current Engine revision, selected by the Host
for the chosen GPU. Use the existing native Windows publisher and desktop
packaging tooling. Acceptance requires native NSIS/MSI packages, dispatch
checks for all three capabilities and rejection of unsupported/mixed groups,
full GChat verification, Codex 8 review, and the private installed-request gate
below before reporting merge-ready. Native compilation is authorized; Ron's
installed app, settings and sign-in session are excluded.

Candidate pins are GChat `102253c526f791aacbb5a347498eeeb7c396b029`
(tree `2950769f96f8f481d50f430c870765e7c02dd891`) and Engine
`b76ce57a3cc4823f127a1ce718da454ef1f3510f`. Three-archive validation/staging,
verified atomic installation under `ginfer/windows`, and GPU-selected Host
dispatch are implemented. Codex 8's P1 in the CLI/menu cold-Host bootstrap
paths is fixed: both now load the complete Windows runtime map instead of
retaining only the SM120a seed. Both bootstrap regressions pass on Linux.
Architecture signed the startup design at `48d690ce8` (23:43Z); Codex 8
re-reviewed `ff980aa7a` clean at 23:53Z and matched final verification and both
bootstrap PASS receipts at 00:01Z. The original P1 is closed.

Current state: all three native Engine images passed build, staging, both
executable help checks and complete ZIP verification (`runtime-result-sm86.json`,
`runtime-result-sm89.json`, `runtime-result-sm120a.json` under the owned native
Engine receipts). Each ZIP has 124 hashed payloads and its manifest, 125
entries total. These builds remain accepted and will not be rerun. App
source/cache preparation passed at 01:02Z; current frontend bundling passed in
15.39 seconds. The focused repair `276d89183` makes the shared schedule guard
platform-neutral and enables its existing semantic regression on Windows and
Linux, preserving the workspace-removal fence. S1 focused and full verification
passed at 01:33Z (3,177 frontend, 120 extension and 1,204 Rust tests, no failures);
Codex 8 approved the repair at 01:34Z. Native source fast-forwarded cleanly,
reusing the prepared app cache and accepted Engine archives.

The native CLI/Host and desktop builds passed; the desktop build took
6 minutes 41 seconds. NSIS and MSI builds passed at 01:45:44Z on `276d89183`.
Native installation (two cases) and the real cold-CLI bootstrap (one case)
passed at 01:59Z. The first Host dispatch/bootstrap commands selected `--bin`
and each matched zero tests; those printed PASS lines are invalid evidence.
The job then stopped because the offline cache lacked the locked Gbot test
source `axum 0.8.9`, before that test executed. Its guard recorded exit 1,
empty owned Job and no cleanup error. Preserve that incomplete run and the recovery selected
only the three unexecuted cases with owning `--lib` targets and explicit
named-test/count checks after repairing the owned cache from existing locked
crate sources. Engine images, packages and the three passing cases are reused.
The owned offline cache is now complete: 310 existing crate archives (49,011,977
bytes) were checked against Cargo.lock and copied without dependency changes.
The corrected Host library compile then found an unrelated Unix-only Python
executable fixture importing `std::os::unix` on Windows. Test-only repair
`5c1124847` gates that fixture on Unix; production code is byte-for-byte the
reviewed `276d89183` source, so accepted packages are reused. The remaining
Host dispatch and installed-bootstrap library cases passed on native Windows at
02:07Z. The Gbot library compile then found its Linux setup-readiness regression
referencing the Linux-only KVM module. Test-only `102253c52` gates that existing
test on Linux; production packages remain unchanged. The final schedule-removal case passed natively at 02:11:46Z. All six
actual named Windows cases now pass; `app-result.json` binds those results to
the two hashed packages. Codex 8 approved final source `102253c52` at 02:19Z,
including both test-only repairs. The private request and final architecture
sign-off passed at 02:26Z. MSI extraction and complete packaged inventory
validation passed (three images, 124 hashed payloads plus manifest each).
The private bundled Host started at 02:16Z with all three runtime arguments
and its isolated desktop owner. Artifact-scoped profiling selected packaged
SM120a and completed in 51.021 seconds at 02:18Z. The subsequent live quote
rejected the catalog's explicit 6,726,919,936-byte KV pool: Windows allowed
5,340,511,228 bytes after non-KV ownership and headroom. No Engine instance or
inference request started. Normal Host Stop completed; the guard exited PASS
with an empty owned Job at 02:20Z, and the booking was returned.

Arch at 02:20:36Z approved Automatic KV for both ID-only arms, preserving
context 262,144 and the exact C1 request, initially requesting exact KV bytes;
display VRAM can make those capacities differ without changing this short
request's math. The private Windows Automatic-KV Engine reached Ready at 02:23Z, selected
the packaged SM120a executable as a child of the private Host, and completed
the single C1 request at 02:23:17Z. All four token lists contain 500 IDs.
Engine Stop followed by Host Stop completed normally; the guard returned
PASS/empty Job at 02:23:41Z. The matching Linux request completed at 02:26:15Z: all four 500-token lists
match Windows exactly (2,000/2,000 IDs). Its Engine exited 0; the existing
resident runner exited 3 only because its performance-report validator excludes
context 262,144. The raw request/response and lifecycle result establish this
ID-only gate; no performance claim is made. Both arms used the same artifact,
C1 request, context, concurrency, Vision, DFlash2/fixed-four resolution, NVFP4 KV
and CUDA Graph settings. Automatic KV logged 5.05 GiB on each arm; exact bytes
were not retained and cannot be inferred from metadata slot counts. Arch
accepted the gate and rounded-capacity limitation at 02:26:37Z, explicitly
requiring no duplicate request. No AllFormats preparation or model rebuild
was needed.

Gate evidence is retained under
`out/windows-multiarch-20261017/app-installer/` (Windows request/response,
redacted Ready process, runtime inventory, private Host log and guard results)
and `out/windows-multiarch-20261017/linux-qwen-id-gate/` (Linux request/response,
effective command, memory telemetry and normal server-exit result). Exact ID
equality passed for cold-prefill warmup/measured and warm-generation
warmup/measured, 500 IDs each. The retained Linux ELF was source-bound to
`b76ce57a3` by its existing SHA receipt; its embedded revision is unknown.
The temporary local ELF was removed after exit. At that initial merge gate,
native SM86/SM89 requests were still unqualified; the October18 physical gates
above now pass. The separate Windows Flash qualification row remains open.

Accepted, unsigned installers are retained under
`E:\gchat3-windows-multiarch-20261017\accepted\packages`:

| Package | Bytes | SHA256 |
| --- | ---: | --- |
| `GChat_2.0.42_x64-setup.exe` | 1,481,906,920 | `9589f9a7719409d662639a0ffb38b62d44a82068660610429c45b5f71f40c28c` |
| `GChat_2.0.42_x64_en-US.msi` | 1,559,887,418 | `1eb115aa88972417859314691bcb7b2e4a189a7f3abc1bb529a8765c88dff2b6` |

The three accepted Engine ZIPs are retained under the sibling
`accepted\runtimes` folder. These are the tested artifacts, moved within the
same volume after shutdown; no package was rebuilt. Build-generated plugin
JavaScript and the local core tarball lock hashes were preserved in
`app-installer/native-generated-build.patch` before removing the native source
copy; no authored source change was discarded.

The prior candidate `ff980aa7a` passed `make verify` on S1 at 23:59Z: 3,177 frontend, 120
extension and 1,204 Rust tests passed (27 Rust tests ignored). Packaging tests
passed five cases; five Windows-only cases were skipped on Linux and passed
on native PowerShell 5.1, including archive-input rejection cases. The earlier
`48d690ce8` full verification also passed. Evidence is retained locally in
`out/windows-multiarch-20261017/s1-verification/{final-verify-result.json,final-verify.log}`.
The prepared-toolchain option avoids workstation bootstrap/settings changes.

Gchat 3 owns this inventory:

| Host | Path / purpose | Current status and retention |
| --- | --- | --- |
| Local WSL | `/ai/gchat-worktrees/windows-multiarch-20261017`, source and receipts | Reviewed candidate and completed acceptance; `out/windows-multiarch-20261017` retains 2.7 MiB of receipts. Temporary `/dev/shm` ELF and copied Linux profile removed after normal server exit; retained S1 ELF and protected model untouched |
| S1 `AIS-2-8592-L01` | `/media/ron/SSD_RAID/ai/tmp-gchat3-windows-multiarch-20261017`, verification receipts | Repair `276d89183` focused and full verification PASS at 01:33Z; `repair-{source,verify-result,verify-command,verify-launch}.json` and `repair-verify.log` copied locally; owned source/caches and exited repair container removed, 26 root receipts remain (1.49 MB); returned 01:34Z, SSD free 1.84 TB; RC donor untouched |
| Native `RON-9950X3D2` | `E:\gchat3-windows-multiarch-20261017`, accepted packages/runtimes and concise receipts | Three Engine images, NSIS/MSI and six actual named tests PASS; private Qwen C1/normal shutdown and Arch acceptance PASS. Source/build/stage/vcpkg caches, app build/dependency caches and private fixture removed after exit. Five accepted artifacts retained in `accepted` (4.3 GiB); `app/app-installer` and Engine result folders retain 3.6 MiB. E: free 2.19 TB. No live job; native returned 02:23Z, Linux returned 02:26Z |

The completed merge gate used one real request through the private packaged
Windows Host on the 5090, proving SM120a dispatch and exact Linux token-ID equality.
Arch at 02:05:54Z approved direct bundled Host launch: extract the actual MSI
payload, verify its complete runtime-set manifests, then run its packaged
`ginfer-host` with a private data root and runtime map. This supersedes the
23:49Z `prepare-hardware` route, which always requests AllFormats and would
recalibrate unrelated CPU/Flash formats because the retained seed identity is
stale. That preparation defect and native MSVC Flash qualification belong in
separate open-work rows `GCHAT-PREPARE-SELECTED-ARTIFACT` and
`WINDOWS-FLASH-CPU-QUALIFICATION` (shared ledger commit `b8d38059c3`).
The MSI payload extraction passed at 02:12:43Z: 422 files reconstructed with cached WiX dark, without custom actions, system installation, registry writes or desktop launch. Both direct-Host command and model guard parse on native PowerShell 5.1; the guard requires available memory after the 30,357,242,112-byte Qwen planning estimate to exceed its 17,131,606,528-byte emergency floor. This estimate is not a measured bound. Complete runtime inventory/hash validation precedes bundled Host startup.

The private fixture used
`E:\gchat3-windows-multiarch-20261017\fixture` with private APPDATA. Direct
`--ensure-running` did not register a locator; control read only this fixture’s
`data/ginfer/host/host.json`. Its disposable data is removed after shutdown.
Ron's account, settings and installation remain untouched. Native SM86/SM89
physical requests were outstanding at that stage and passed the October18
gates above; builds/mocked dispatch alone do not qualify them.

At 01:58Z Arch changed this ID-only gate to a registered GPU-resident
Qwen3.8-27B NVFP4/DFlash2 package. The earlier Flash plan left only 9.32 GB
against the 17.13 GB emergency floor and is not authorized to launch.
Flash on native Windows (MSVC CPU experts) is a separate qualification row,
to run when native available memory covers its plan. That Flash plan was not launched; the approved GPU-resident Qwen gate passed.

Reuse the verified retained Windows Qwen package
`C:\Users\Ron\AppData\Local\GInfer\release-1003\artifacts\qwen38_27b_nvfp4_dflash2_nvfp4.ginfer`
(21,767,307,520 bytes; SHA256
`4689bdc908d989170106b07e91d81e0898bfe5c5e2cca98ae1d7350276d715a6`).
Its adjacent `verified-native.json` and GInfer `docs/release-1003/README.md`
record the copy. Historical native admission shows GPU-resident weights,
256 MiB peak staging and no host KV cache; staging is not a total host-RAM
bound. Before launch record native available/physical memory and preserve
actual native admission accounting. Do not reuse the Flash 64 GiB estimate.

The bounded retained-evidence search found no matching Engine `b76ce57a3`
Linux Qwen request/IDs. Arch's revised gate therefore used one new matching
Linux request and the private installed Windows request, comparing exact token IDs,
with shared artifact, request and runtime configuration. Exact equality passed;
no performance claim is made. Shared Host headroom/LFU
controls remain the separate `GCHAT-HOST-RESIDENCY-CONTROLS` row. The model
phase had no elapsed-time kill and finished through normal Host APIs after
the corrected native checks. Direct bundled Host startup used the normal
artifact-scoped Qwen Ensure; no AllFormats request was made.

Native builds reuse prepared CUDA/MSVC/vcpkg on E:, with a three-worker Ninja
compile pool and one-worker linker pool while retaining `cmake --build … -j`.
The durable guard uses exact Job/PID/start ownership, initial identity-bound
permit and lease, a short hash-checked loader, and full effective-command hash.
Native AvailableBytes and WSL RSS are sampled every 10 seconds; short-lived
children may escape sampling but remain Job-contained. The emergency floor is
17,131,606,528 bytes (12.5% of physical memory); the retained 211 Engine samples
had at least 59.7 GB available. Compiler bookings have a cutoff; the private
model guard does not add an elapsed-time cutoff.

Retained execution failures and corrections:

| Cause | Prevention and evidence |
| --- | --- |
| WSL RSS pipeline truncation caused a broken pipe before compilation | Capture all rows before selecting the top rows and validate the original exit code; `engine/engine-release/failed-preflight-2351/` |
| Successful Engine publisher left an owned VCTIP helper with intermittent CPU activity; the full 30-second idle comparison failed and the result counter incorrectly read zero | Job emptied without cleanup error after root exit 0. App guard now requires five continuously quiet seconds from only exact owned VS compiler servers after successful root exit; active descendants prevent that cleanup. Script-scoped counters are fixed in app/model guards. Original regex patterns were valid; native parser/hash/path checks pass. Original Engine telemetry remains intact in `engine/engine-release-resume/` |
| Native Git rejected the WSL clone remote before cache preparation | Exact process-scoped `safe.directory` for that remote only, with no global Git/settings change; `app/app-installer/failed-preflight-0058/` |
| Windows LAN workspace removal called a Linux-only schedule guard at 01:21Z | Platform-neutral guard/regression repair `276d89183` approved by Codex 8 at 01:34Z; same prepared cache reused. Prior build outputs retained in `app/app-installer/failed-gbot-cfg-0121/` |
| Host test commands selected `--bin` and exited 0 after matching zero dispatch/bootstrap cases | Select owning Cargo `--lib` targets and require each named test and count; preserve the invalid zero-case output and run only the unexecuted cases, without rebuilding Engine/packages |
| Offline prepared cache omitted Gbot dev dependency `axum 0.8.9` | Copied 310 missing locked archives (49,011,977 bytes), validating source and destination against Cargo.lock; `locked-source-cache-repair.json` PASS, dependency versions unchanged |
| Host/Gbot library test compilation included platform-specific fixtures on Windows | Test-only `5c1124847` gates the Unix Python fixture; the Linux KVM readiness regression receives its owning Linux gate. Both Host cases and the Gbot schedule-removal case actually passed. No production/package rebuild |
| Builder preflight compared the LF Git blob hash with its correct native CRLF checkout after preparation had passed | Normalized content and clean pinned tree match. Check the native CRLF hash and hash-bound completed preparation, then reuse owned source/cache without clone/copy or Engine rebuild; `app/app-installer/failed-builder-hash-0102/` and `native-prepared-reuse-validation.json` |

Linux release `ed68c7443` + Engine `e2282c336` remains the retained Linux PASS
record. The later Windows release RC `c75096fad` + Engine `b76ce57a3` is now
delivered as recorded above and awaits Ron's installer/sign-in gate. No refreshed
Linux qualification is claimed.
The protected S1 release AppDir and app-cache donor, current independent-copy
grants and completed historical local cleanup are recorded in the Linux RC
section above. Gchat 1's provider-keyboard donor request was withdrawn before
copy or run because retained evidence already qualified that row. Older dated
sections below retain their historical scope.

## Known issues

For the October 17 release candidate:

- **Complex code reviews:** Workers using 27B models can misstate fine code details
  even after reading the files. In one matched review per Qwen 27B package, INT
  gave a more accurate answer than NVFP4; both made factual errors. Check important
  conclusions against the source. This small comparison does not establish a
  general ranking of the packages.
- **Microsoft and Google sign-in:** Live sign-in, consent, reconnect and account
  operations still need end-to-end checks on Linux and Windows. Microsoft uses
  GChat's built-in sign-in for work, school and personal accounts; some services
  require a work or school account. Google requires your own Desktop OAuth client.
  Follow the [account setup guide](../workspace-connectors/operations.md).
- **Windows validation:** Changing the App Data location, selecting the fastest
  of several drives, checking startup settings for imported models, and retaining
  credentials across a restart still need installed Windows checks. Source changes
  for these paths await that confirmation. Active agent recovery, Gbot,
  and physical checks on the other supported GPU families also remain unqualified.
  The initial [Windows gate](windows-gate-20261016.md) covers a narrower set of
  checks on an RTX 5090; its results do not qualify every Windows feature.

## Historical October 17 e9cf Linux RC — packages verified, Flash High blocked

This older e9cf/4f attempt remains failed at its recorded scope. The release
ed68/e228 custom-load and High-request PASS above supersedes it as the Linux
RC of record; the failure below is not the current release disposition.

The unsigned, unpublished app-only refresh used GChat
`e9cf3b1a444f6884456bc88ed3ddeacd27b75cb6` with unchanged Engine
`4f451dded472516ac561b67efdacf9673f776967` (SM80/86/89/120a). It includes the
merged optional-completion correction: explicit **Cancel profiling** durably
parks `complete_remaining_formats` work until an explicit Resume or preparation
of another model. Loading a model can still pause optional work for later
resumption. Optional completion, including its cancelling state, no longer
blocks Load for an accepted selected artifact; foreground profiling still does.
A new Host must revalidate the selected artifact before serving it.

The Cancel/Load correction at candidate `92ab`, merged via `db670f614`, passed
full `make verify`: 2,553 frontend tests (6 skipped), 119 extension tests and
1,057 Rust tests (27 ignored).
Focused React, Manager UI and Host hardware-profile tests, Host `cargo check`
and strict Clippy also pass. The source binding and terminal receipts are in
`/ai/gchat/out/background-profile-load-20261017/gate/`. This gate is separate
from the e9cf package build and does not qualify the Flash High-reasoning GUI
consumer.

The corrected e9cf native rebuild, package assembly and complete archive check
pass, and both NTFS destination SHA256 values match. An earlier attempt used
stale db670 native outputs and was disqualified before archive checking or
transfer. Flash High GUI acceptance was **BLOCKED** in this attempt by Engine
startup capacity. Gchat 2's same-pin native input-only check **PASSES**, with
resources returned at 11:12Z. Its receipt is
`/ai/gchat/out/gbot-desktop-keyboard-shortcuts-20261017/native-e9cf3b1a4/result.json`,
SHA256 `7f52019c6b7e7e25d632e1276ab4e3c7057313390d2a804eb2c13ab637b43ea3`.
This attempt's receipts are under
`/ai/gchat/out/linux-rc-final-20261017/current-e9cf3b1a4-4f451dded/`.

The exact e9cf/4f AppImage's retained local RTX 5090 fixture now confirms the
optional-completion Cancel behavior: one Cancel at 10:56:25Z ended the job as
`cancelled` after 136.338 seconds, with `completion_failed: true`; the native
child was absent and no replacement job started. It remained cancelled for
more than five minutes across Refresh and Models navigation, and both Installed
Load buttons were enabled.
One Flash Installed Load at 10:56:51Z stopped before Engine Start
with: "No qualified automatic profile is available. Select a qualified profile
in Engines, or specify both context and concurrency as custom settings."
This admission limitation remains separate from the corrected Cancel/Load UI.

Before this attempt, the retained accepted main profile covered Qwen NVFP4 and
had `cpu_expert_rates: []`; Flash had never been accepted in this fixture. For Flash
pure 2-bit (SHA256
`8bbb85bf6ba669157045bac0a6fdd623dd87694b7b1fe09b7f2150fc3636ab08`),
one custom **Check startup settings** at 10:58:58Z failed before Start with
missing `q2g64` CPU expert rows for T=1..64, cold and warm. This does not
establish a new defect. The 10:59:12Z DOM result is retained in
`/ai/gchat/out/linux-rc-final-20261017/local5090-e9cf3b1a4-4f451dded-flash-high/gui-dom-evidence.jsonl`.
At 11:03:25Z, ordinary GUI **Resume profiling** was explicitly clicked once to
reuse the saved checkpoint; this was neither an automatic restart nor full
Ensure. Resume **PASSED** in 94.066 seconds: native profiling retained four
completed node/format groups and completed w8, nvfp4 and nvfp4-gmul. The canonical
profile now has 5,568 CPU rows, SHA256
`11837975fe55b9e77891eeab962f562b61bb48c869e26d3a4b6ecf3b794fa20a`.
Evidence is retained in
`/ai/gchat/out/linux-rc-final-20261017/local5090-e9cf3b1a4-4f451dded-flash-high/explicit-resume-completed.json`.
The second startup quote was accepted and enabled Load; it did not establish
Ready. Ordinary custom Load
was clicked at 11:07:07.941Z; its selected-Flash native Ensure completed in
19.468 seconds, with state `loaded`, scope `artifact`, the `q2g64` requirement
complete and `all_formats_complete: true`. Evidence is retained in
`/ai/gchat/out/linux-rc-final-20261017/local5090-e9cf3b1a4-4f451dded-flash-high/flash-artifact-ensure-completed.json`.
Engine startup **FAILED** before Ready at 11:09:59.069Z in the
`post-graph-warm` capacity check on rank 0: free device memory was 1,064,505,344
bytes against 1,073,741,824 bytes of required headroom, a shortfall of 9,236,480
bytes (`retained_graph_bytes=0`, `transient_peak_bytes=8065024`). No GUI request
was sent; Flash High was **NOT RUN**. Package/archive checks pass, but this
outcome does not establish RC acceptance. The observed failure comes from
Engine's [startup-capacity guard](https://github.com/SectileLabs/ginfer/blob/4f451dded472516ac561b67efdacf9673f776967/src/targets/qwen3_8_flash_next/impl/runtime/startup_capacity.h#L123-L130),
called by the [post-graph-warm check](https://github.com/SectileLabs/ginfer/blob/4f451dded472516ac561b67efdacf9673f776967/src/targets/qwen3_8_flash_next/impl/runtime/concurrent_program.cpp#L3887-L3901).
The allocation cause remains unknown.

| Package | Bytes | SHA256 |
| --- | ---: | --- |
| `GChat_2.0.42+rc20261017.gchate9cf3b1a4.engine4f451dded_amd64.deb` | 2,793,379,678 | `8373d240d81ceb4b5b9ed358d98fc437eab4b1f36a6e1f0051cc7b42c9fb5b35` |
| `GChat_2.0.42_rc20261017.gchate9cf3b1a4.engine4f451dded_amd64.AppImage` | 2,907,314,680 | `c86b0efb858b6aae932977ba291c5a28b6e39daf405fb47bd9e94a33712e237f` |

The packages are retained in
`/mnt/c/Users/Ron/gchat-windows-gate-20261016/linux-rc-current-e9cf3b1a4-4f451dded/`.
The retained Engine runtime set is reused; no new Engine build, full Ensure or
fresh-install qualification is claimed.

## October 17 previous Linux RC — c5f packages and OLD lifecycle verified

The unsigned, unpublished app-only refresh used GChat
`c5f125d2544f22adb7f7c3952d0fa4e9582f5b43` and unchanged Engine
`4f451dded472516ac561b67efdacf9673f776967` (SM80/86/89/120a). The source tree
matches the verified Gbot Quit cache correction candidate: full `make verify`
passed with 2,545 frontend tests (6 skipped), 119 extension tests and 1,055 Rust
tests (27 ignored). Production frontend/native builds, complete DEB/AppImage
archive checks, all 684 Engine runtime files and direct NTFS transfer checks pass.
Both streamed and destination SHA256 values match.

| Package | SHA256 |
| --- | --- |
| `GChat_2.0.42+rc20261017.gchatc5f125d25.engine4f451dded_amd64.deb` | `44bcae73732c5220eb532ccbc2de7b039bce93de246543b20c3e53c769cde42b` |
| `GChat_2.0.42_rc20261017.gchatc5f125d25.engine4f451dded_amd64.AppImage` | `bae6a98a6df674fb2e785075dfdd4ae2c7232a72229f7a799695287e29712f38` |

The packages are retained in
`C:\Users\Ron\gchat-windows-gate-20261016\linux-rc-current-c5f125d25-4f451dded`.
Exact package, archive and transfer receipts are in
`/ai/gchat/out/linux-rc-final-20261017/current-c5f125d25-4f451dded/`.
Gchat 2's one current-c5f **OLD fixture rerun passes**:
`old-acceptance-result.json` records the fixed uncached native Quit followed by
one ordinary service start. Both saved setups became Ready automatically, with
no manual Resume and all 445 baseline operations preserved. Normal Quit removed
the service, the ordinary GUI exited with code 0, the outer domain was OFF and
its original XML was restored exactly; resources returned at 10:02Z. This covers
the retained saved-setup/service lifecycle, without View, Send, model start,
task execution or control transfer.

The packaged Flash pure 2-bit package (SHA256
`8bbb85bf6ba669157045bac0a6fdd623dd87694b7b1fe09b7f2150fc3636ab08`)
**High-reasoning consumer check was not completed in this c5f/4f attempt**.
It was blocked before model Start or any request: automatic
`complete-remaining-formats` profiling disabled Load, and profiling immediately restarted after Cancel.
The merged correction and subsequent capacity-blocked consumer attempt are
described above; this blocked c5f attempt does not qualify the corrected candidate.

Historical acceptance on GChat `0b3aa523c` with the same Engine reached Ready
through one ordinary Installed Load on the local RTX 5090, then answered one
High-reasoning Qwen GUI request with exactly `RC_OK`. That retained-state/profile
scope, recorded in `local5090-0b3aa523c-4f451dded/` beside the current packet,
does not qualify installation of c5f, a fresh install/import, full Ensure, all
formats or a full model rehash. The prior FRESH fixture result remains separately
bound to 0b3/4f. `VITE_MODEL_CATALOG_URL` remains unset; no public release catalog
is approved. Signing, publication and the known issues above remain separate.

## October 17 local-model startup quote — Linux preview passes

The retained Linux AppImage (`d31a4cbd0`, Engine `db265e6b2`) verified a locally
registered Qwen 27B NVFP4 artifact with an empty catalog and no fabricated download
job. **Check startup settings** passed with C1, context 65,536, structured outputs
on and an explicit 5 GiB KV arena. One ordinary **Load model** then failed during
artifact-scoped hardware profiling: the startup CPU roster split a physical
sibling group across roles. This historical `db265e6b2` validation failure was
already corrected in later packages; it is not a new current-main regression.
No instance was created or reached Ready, and the three existing configurations
stayed unchanged. The GUI closed normally and the idle private Host stopped;
resources returned at 10:26Z. Current-package custom quote-to-Ready, fresh-install
and Windows acceptance remain pending; this explicit-budget check does not
qualify AUTO KV admission.

Evidence: `/ai/gchat/out/manager-quote-local-models-20261016/packaged-d31-20261017/quote-to-ready/result.json`
(SHA256 `65f5c0a68d0e13784952f598d290759a300ff558e4d3077e156d3d559f5925e4`).

## October 16 Windows gate — functional checks complete, findings retained

The [Windows gate packet](windows-gate-20261016.md) binds the current-user NSIS installer to GChat `dcb11c14` and Engine `c440179a` (SM120a), records the upgrade and fresh application-state checks, and lists each PASS, failure and unqualified check. One model started and answered one request. Custom-root Host migration remains open for Windows. The [October 17 native follow-up](https://github.com/Gadflyii/GChat/blob/5671542f5/docs/installer-refresh/windows-native-followup-20261017.md) qualifies ordinary **Stop Host and Quit** for an idle desktop-owned Host; busy refusal is covered by source tests, and SCM shutdown was not run. The packet also records the 85m7.168s natural profile, 2365ms native reuse, functional long-chat render and actual idle measurement.

## October 15 historical Linux Engine package — accepted

Bubbs's one unsigned package refresh passes. Desktop/CLI/Host/Gbot source is
merged GChat main `44e80b7c11ba07ed43a58d69e9a97408625452ef`, including
Ready-compatible Host `6a2cfa9e8`. All four Engine Release images use clean source
`9f8fb8ff9514c90426e7d283ca40370799a013b9`, frozen from then-current `dev/next`.
This includes strict admission/output reservation, MTP/KV fixes, placed-Ready and
Qwen/Muse/Flash `--quote-only`; the removed residency-wait flag is absent.

Ubuntu 24.04 CPU-only builds and native help/version, exact SM80/86/89/120a,
dependency closure, maximum glibc2.39 and all 684 manifest entries pass. The five
operator documents come from those same manifests and pass the existing stager.
Native desktop/CLI/Host and production frontend are rebuilt from combined main;
the CSP-safe 3,659-byte AudioWorklet remains exact. Existing Ubuntu24 images,
CUDA13.3 mount, private FFmpeg recipe and shared Rust cache were reused.

Final artifacts and walkthrough:
`/ai/gchat/out/gbot-linux-walkthrough-20261014/`:

- `GChat_2.0.42+gbot20261015.engine9f8fb8ff9_amd64.deb`
- `GChat_2.0.42_gbot20261015.engine9f8fb8ff9_amd64.AppImage`

Both were assembled once. All 7,759 DEB and 8,118 AppImage regular files pass
content/size/mode/root-ownership verification; all 7,759 shared contents match.
DEB metadata/md5sums and the retained AppImage runtime prefix pass. The accepted
Python3.12.3/61-package/7,010-file closure, guest assets and 174 profiles remain
exact. Final hashes, source/test provenance and scope are in
`engine-refresh-20261015/{result.json,summary.md}`; `README.md` is the install guide.

Reuse the completed GBOT source/native-viewer gates and Manager's full
`make verify` (2,309 root, 114 extension, 848 Rust tests) and native four Qwen
INT/C4 instance gate on ancestor Engine `019ad0c92`. No GPU/VM walkthrough is
repeated here; Flash model acceptance, Windows, signing and publication remain
separate. Live provider consent remains Ron's release gate with approved existing
registrations/accounts. No accounts or credentials were created.

Gchat 2's local private Engine compilation, package stages and superseded packages
are retired after acceptance; the accepted runtime set is retained under
`/ai/ginfer-worktrees/gchat2-linux-engine-20261015/out/linux/runtime-set/`.
The reused S1 source/SM120a cache was transferred to C1's Flash Ready item,
preserving C3 sibling results and shared FFmpeg. Local Rust lock/CPUs8–15 were
released to Gchat1; CPU-only bookings are canceled at closure.

## October 14 developer Linux package — current Engine accepted

The Engine-only refreshed developer DEB/AppImage passes package integrity,
runtime-manifest and installed SM120a Host compatibility checks. It replaces the
historical `05a286ba` Engine set, which rejected the current Host's required
`--hardware-profile`. `GCHAT-LINUX-BUNDLE-HOST-CONTRACT` is closed for this
accepted developer composition. The retained desktop, CLI, Host and Gbot
payloads from `7e33222e8` are unchanged.

The four Linux CLI/serve images (`sm_120a`, `sm_86`, `sm_89`, `sm_80`) are clean
`38ff80e0c`, based on authorized `415eaa2b5` plus FFmpeg's worker-cap control.
Sequential pinned Ubuntu 24.04 builds, native help/server-version, ABI closure
and staging pass. The packaged CLI generated the current local5090 hardware
profile; normal Qwen 262,144-context startup reached Ready. Active worker
cancellation, parent completion, durable reopen, nine-step **Continue as new
run**, exact finished-record reopen and normal Host Stop pass. The false
cancellation-failure toast is tracked separately; no checkpoint-resume or
broader active-worker compaction acceptance is claimed.

Current unsigned installers, retained in
`/ai/gchat/out/gbot-linux-walkthrough-20261014/`:

- `GChat_2.0.42+oi06820261014.38ff80e0c_amd64.deb`
- `GChat_2.0.42_oi06820261014.38ff80e0c_amd64.AppImage`

Evidence and exact package hashes:
`/ai/gchat/out/gchat-open-items-20261013/oi068-chat-workers/live-cancel-20261014/{result.json,package-result.json,summary.md}`.
The runtime set and current profile remain retained. Disposable stages, isolated
client data and superseded package copies are retired. No Windows build,
signing, update-feed entry or publication occurred; all-image physical and
release qualification remain separate.

Assembly reads the five operator entries already hashed in each Engine runtime
manifest: README, VERSION, CLI, serving and release names. All images must carry
identical documentation and every relative link must resolve within that set.
GInfer's `packaging/runtime-docs.json` owns the payload; separate
operations/versioning documents and external documentation provenance are
retired. The focused staging fixture passes. See [the packaging
decision](../decisions/2026-10-14-package-engine-docs-from-runtime-manifests.md).
Resume-time `make verify` cannot start lint without this worktree's Yarn
dependency state; no dependencies were installed and no passing live gate was
repeated.

## Support link publication check — W12

`GUI-SETTINGS-SUPPORT-LINK-404` is **WAITING ON W12 PUBLICATION**. Ron confirmed
on October 18 that the GitHub repositories exist but are private, so an
anonymous 404 is expected until release. Keep the existing single
`GCHAT_ISSUES_URL` constant pointing to
`https://github.com/SectileLabs/gchat/issues`; no code change is required.

- [ ] Once the repositories are public, confirm that Issues is enabled on the
  linked `SectileLabs/gchat` repository and that Settings → Open an issue opens
  the Issues page successfully.

The release owner performs this check under the W12 publication gate. The
[original observation and accepted constant extraction](../host-ui/README.md#support-issue-destination--c3-october-18)
remain recorded; this note does not claim that public access has been verified.

## SectileLabs updater feed — OI-110

All GChat check/download paths and release asset URLs use the configured feed:
`https://github.com/SectileLabs/gchat/releases/latest/download/latest.json`.
Ron explicitly designates the private, empty `SectileLabs/gchat` repository
for release artifacts only when ready. Development source and the build/tag
workflow remain in `Gadflyii/GChat`; do not push source code to the destination.
The source-only routing correction is implemented and independently reviewed in
this owned candidate. It is not release-qualified.

`.github/workflows/release.yml` requires execution in `Gadflyii/GChat`, with
source `GITHUB_TOKEN` Contents-read permissions. Draft creation explicitly targets
`SectileLabs/gchat`; all six payload/signature/manifest uploads use that draft's
upload URL and separate `SECTILE_RELEASE_TOKEN`. Previous published-release queries
and draft-body edits also explicitly target the destination. Release-note git
history, contributors and commit links remain in the development repository;
published style examples are read separately from the artifact repository.
Destination-generated git notes are disabled so artifact-repository history is
not presented as development history. Draft-only behavior and exact final
payload/signature gates remain unchanged; no source mirror or forced tag is added.

The release owner must configure `SECTILE_RELEASE_TOKEN` in the development
repository with Contents-write access scoped only to `SectileLabs/gchat`; the
workflow fails before draft creation when absent. Configuration/access is
unverified: no credential was read, provisioned or used. Check the destination's
default branch and release-tag readiness without copying development source.
Destination readiness and anonymous access to the configured updater feed must be established for the next
approved release without placing credentials in the app. Signing/publication
remain separately gated; this correction does not resolve the live404 itself.

Ron authorized local unsigned preparation; signing/publication await his next
release. The release workflow and `src-tauri/latest.json.template` cover only
the supported Windows/Linux products; macOS jobs and manifest branches are removed.
Its unsigned copy is `/ai/gchat/out/remaining-acceptance-20261009/oi110-latest.unsigned.json`.
Version, date/notes, selected platforms, final asset names and signatures remain
pending; this empty preparation artifact is not an installable manifest. Each
published entry needs a nonempty signature verified against the unchanged key
and exact payload. CI now requires one nonempty final updater payload and its
nonblank freshly generated signature; metadata uses the exact re-signed path,
and manifest generation rejects successful platforms with blank signatures.

GCHAT-UPDATER-SIGNATURE's original blank-signature rejection is already inherited
from `f7b2f43fe`. The independently reviewed follow-up also rejects an absent or
whitespace-only final asset name for a successful platform and incomplete version,
using the shared production `scripts/updater-manifest.jq` filter. Skipped/failed
platform entries remain omitted; valid signatures, URLs, notes and supported
platform structure are preserved. Exact post-signing NSIS/AppImage selection,
required regular nonempty signature files, credentials and existing key are
unchanged. The manifest job now gates the production filter through
`tests/test_updater_manifest.py`: 19 offline cases cover complete Windows/Linux/
combined metadata, failed/skipped omission, blank signatures/names and version.
Sentinel signatures establish metadata admission only, never cryptographic validity.

YAML/Python and shell syntax checks pass. The production filter's behavioral gate
also passes: four existing test methods cover all 19 cases/subcases, finishing
`OK`, exit 0, in 0.077 seconds on S1 with its existing Python 3.12.3 and jq 1.7.
Command: `python3 -m unittest discover -s tests -p test_updater_manifest.py`.
The shared filter, test and template are unchanged from accepted `874cbc98d`;
the complete accepted updater branch is integrated as `c36e3862c` in the current
GChat implementation candidate. No new dependency, full suite, key access,
signing, CI, feed access or publication ran. Reuse the existing routing/syntax
checks. Evidence: `/ai/gchat/out/gchat-open-items-20261012/updater-offline-note.md`.
The owned S1 temporary source copies were retired; release qualification remains
pending.

Actual cryptographic acceptance against the unchanged public key and downloaded
payload remains a scheduled-release gate. The recorded live 404 remains open.

Retain `/ai/gchat-worktrees/oi110-sectile-feed-bd4` on
`fix/oi110-sectile-feed-bd4` (baseline `bd4dba841`) for coordinator review and the
unsigned copy for release preparation. Prior endpoint/repository evidence is in
`out/remaining-acceptance-20261009/`: `oi110-endpoint-20261010T0433Z.json` and
`oi110-release-location-20261010T0436Z.json`. Focused local checks pass: YAML 1.2
parsing, `bash -n` on all 25 Linux/explicit Bash run blocks, Python syntax and
offline source/destination routing assertions
including all six uploads and unchanged signature/metadata/manifest gate blocks.
`git diff --check` passes. These are local syntax/source checks, not CI execution
or credential/publication acceptance; no build, native execution, signing or
publication ran. Later metadata/JQ release admission checks are prepared in
`/ai/gchat/out/remaining-acceptance-20261009/oi110-release-gate-checks.txt`.

## Current engine acceptance — OI-056/OI-083, October 9, 2026

Repository: GChat; subject: `docs/installer-refresh/`. Owner: GChat coordinator.
Ron approved a current native Windows engine build and end-to-end testing on
RON-9950X3D2, superseding the intervening Linux-only instruction. Acceptance:
normal GChat/Manager startup; Qwen 27B and Muse load; actual Chat replies finish
and return idle; four overlapping requests finish; Reload reaches Ready in a
new session; Stop leaves no engine or automatic reload. Preserve user data and
the original saved Muse profile. Server 2 and unrelated Engine performance/numerical work remain excluded.
The user subsequently approved controlled React/parser/Vitest alignment; see
[the composed remediation](../code-hygiene/README.md) for current scope.

The physical local GPU is RTX 5090 UUID
`GPU-92a61cb1-6b5e-cc7b-b669-72b2662d9d6e`; Windows reports 128 GB RAM.
Installed desktop source is `0f06ba433`; Manager source `43c8d71cf` is reused
with explicit unchanged-input provenance. Native clean `2ef56a52a` is installed
in active and bundled runtime roots; all 125 payloads match. Actual Chat and
continued replies finish idle, XLSX local document access returns exact fixture
values, agent definitions/calling tools are discoverable, and manual/automatic
compaction preserves continued context. The original step-limited Coordinator
history displays incomplete with its available output intact. Original threads,
model files, settings, owner, runs, Host identity/certificate and all 103 original
profile values survive; the distinct automatic candidate is pending qualification.

Reviewed source `68315e6a3`, integrated as `0f06ba433`, preserves Ready
aliases, rejects stale picker reads and shares native startup across sidebar,
Host readiness and persisted provider hydration. Stop invalidates delayed local
or paired intake and waits for an already dispatched native start before
shutting down the singleton. Paired remote aliases receive no native model
mutation. All 85 focused cases and composed `make verify` pass: 2,112 frontend/
core checks, 102 extension checks, six coverage floors and supported Rust suites.
Native build exits 0 at 21:30 UTC; independent package verification passes at
21:34 UTC. Installed payload/preservation and actual lifecycle acceptance pass.

Real sidebar Stop leaves the Host stopped with zero Engines/API listeners and
remains stable on a later check. Start reaches fresh Ready session
`11ba8c36-0426-4912-a089-083cfca2b86f` with selected alias/Server running and one
Engine/API listener. Reload reaches distinct Ready session
`3b3bf837-f98b-400b-bf19-b9c05c334d21` with selection/status retained. Continued
Chat saves `QXr1fqK7RSTetk3Y` ready/stop with 30,000 after automatic compaction
from 26,366 to 1,705 tokens; the 4.614-second turn returns idle. Final GUI Stop
returns to zero Engines/API listeners. Supported Reload/Stop restores the exact
original profile; its existing fixed-arena startup failure remains OI-072.
Normal apps are restored without debug listeners. Evidence:
`out/oi106-final-update-20261009/installed-verification.json` and
`installed-lifecycle-acceptance.json`. This is C4/32K functional acceptance,
not a new 128K capacity pass. Earlier `7d9eb55f9` Start reached Ready/API serving
with blank selection/stale status; that failure remains historical evidence.
Windows reviewed source and metadata are published on main `e2521e33`;
installed Windows product remains `0f06ba433`. Linux assembly is complete at
`02d369e8a`; independent package and actual native X11 acceptance pass below. Completed OI-106
and profile source trees are retired; source branches and evidence remain.

GInfer `docs/installer-refresh/README.md` owns OI-058's portability build:
frozen production source matches requested `f9af4cff4`, current base `f6d097566`,
MSVC 19.44/CUDA 13.3.73 Release/SM120a, native build `2ef56a52a`, branch
`dev/oi058-msvc-f6d09756` tip `4f47bb3f9` (documentation only after the build).
Native compile/link, help, server version, closed ZIP, PE dependencies and all
six offline operator docs pass; final compiler/linker warnings are zero.
Bubbs merged the portability branch as `634a16e16`: all four Linux images
and tests passed, with zero new warnings and 228 SM120a CTest cases. Future
Windows engine builds start from `dev/next`. The tested native `2ef56a52a`
payload is retained without a redundant rebuild. Use `ginfer-serve --version`; the CLI has no version flag.

Actual Manager Start with the original Muse C4/131072/NVFP4 fixed pool still
fails before Ready (OI-066/OI-072). For bounded functional checks, reuse the
previously tested C4/32768 automatic-pool controls; they do not qualify 128K
capacity. Both Qwen and Muse reach Ready. Each completes four overlapping
responses with normal stop finishes, peak four active requests and zero after
drain. Manager Reload reaches a new Ready engine session for each; Manager Stop
leaves both stopped with no native engine. The original fixed profile is restored exactly through supported Reload/Stop;
the final snapshot is stopped with zero active requests and no native engine.

OI-083 reproduces a local Host instance missing from ordinary Chat's picker.
The native alias route supports local instances; frontend projection and facade
readiness exclude them. The fix exposes online Ready local and paired instances
through the same opaque aliases and labels the provider GInfer Hosts. Stopped
instances/offline hosts remain unavailable. Source `a40d7221` passed full
`make verify`; native NSIS/MSI assembly and the local update passed. Independent
installed checks confirm the desktop's accepted three-byte bundle tag, exact
CLI/Host bytes, both 125-payload runtimes and all 103 profile values. Seven
original thread IDs, original model files, settings, owner, saved runs and Host
identity/certificate are retained. The actual picker now exposes the Ready local
instance and the facade starts; OI-083's behavior is verified.

OI-091 compact capability discovery replaces the former 40,666-token tool
payload with exact schema loading through the shared permission runtime. The
actual first installed Chat request used 1,514 input tokens and completed; all
four continued replies ended normally. Automatic compaction reduced 25,988 to
5,419 prompt tokens; manual compaction reclaimed 20,569. These checks establish
ordinary Chat behavior, not maximum-context capacity. The original saved Muse
profile is restored exactly and stopped, with zero native engines.

The corrected public C4/128K attempt reaches Ready and prepares four distinct
131,009-token inputs, but device-wide free memory drops to 292 MiB during
prefill, below the unchanged 300 MiB guard. The runner aborts and restores the
original stopped profile successfully. No decode completes; no Engine OOM or
KV/admission error is logged. Allocation ownership is unresolved because the
saved telemetry lacks live process-residency/allocation counters. OI-072 remains
open; no reduced margin, retry or capacity promotion is authorized by this result.
Evidence: `out/code-hygiene-20261009/integration/` and
`out/remediation-native-correction-20261009/`.

Windows main is `e2521e33`; installed product remains `0f06ba433` with the
same reviewed runtime code. Both clean
merged OI-056 source worktrees are retired; their committed branches and remote
ancestors remain. Current remediation is coordinated in
[code hygiene](../code-hygiene/README.md).
Evidence: `/ai/gchat/out/oi056-current-engine/`, including original-profile-public,
original-start-final-snapshot, both four-concurrent results, both UI Reload/Stop
snapshots and runtime-update-result. Cleanup released 2.479 GB net allocation; exact latest native installers and
checksums are promoted to `/ai/gchat/out/windows`. Native baseline caches and
evidence remain. See `cleanup-result-current.json`. The exact tested Engine
archive `%LOCALAPPDATA%/GInfer/gchat-oi056-f9af4/output/ginfer-windows-x64-sm120a.zip`
and retained debug evidence remain; its superseded build/stage/export directories
are retired. [Code hygiene](../code-hygiene/README.md) owns that cleanup receipt
and current disk inventory.
App rebuild uses the existing `%LOCALAPPDATA%/GChat/windows-build/` cache and the
exact verified 2ef archive; cached 613 resources must be replaced by the builder.
Qwen inventory registration references its existing release-1003 artifact;
no model bytes were copied or downloaded. Retain that useful registration.

Use only `/ai/coordination/locks/local-5090-gpu.lock` and
`/ai/coordination/locks/local-build.lock`, held for the actual run. The old owned
launcher was updated; no `/tmp` GPU/build lock is used. Windows source/build/package and actual lifecycle acceptance are complete;
Linux assembly, independent package verification and native X11 acceptance pass. Keep the physical RAM floor and compile/load exclusion.
Failures go in GInfer's sole master `docs/maintainer/open-work.md` under its edit
lock. Ron's newer in-session instruction authorizes the post-Windows-merge GChat bug
and review phase now. Windows source is merged and pushed and Linux package/X11
acceptance passes; next continue the Host/Manager review requested
in Bubbs’s 22:43 handoff. Retire only verified owned completed trees.
Remaining physical work stays in the sole master list. Preserve
other owners' trees and the accepted installed/build baseline; leave Server 2 alone.

## Local workstation update — accepted October 8, 2026

GChat 2.0.42 and its owning Host are updated on RON-9950X3D2. The standalone
GInfer Server Manager is installed and open using the normal shared registry,
real user configuration and GChat-owned Host. The local host is online at
`https://127.0.0.1:7443`; its original identity and managed data root are preserved.
At acceptance, desktop PID 14424, Manager PID 3424 and Host PID 36616 are running;
the saved instance is stopped, with zero requests and no engine process.
Server 2 received no administration, deployment or test jobs.

The user authorized this local update after Manager acceptance. Deliver current
GChat/Host and the accepted standalone Manager, preserve user state, and verify
normal startup. Native packaging, installed bytes, shared-host attachment and
preservation checks pass. Next: the user's local click testing of shared sessions,
Code capabilities, document access, compaction and model lifecycle. Fleet pools
remain unconfigured; select a coordinator before testing shared assignments.
Real-model replay and remote-fleet behavior are not established by this update.

### Source, runtime and verification

Accepted main baseline is `cca5168ef`; the owned candidate is
`fix/local-update-20261008`. Native code is frozen at `de0edde34`.
Packaging correction `d41032c87` uses the canonical shared workspace Host output
in Windows, Make and CI recipes. Correction `de0edde34` preserves native Bun/uv
during the source mirror and replaces generated extension assets with the exact
current producer set. Both changes passed independent review. Actual native
production-argument mirror and byte-level asset regressions pass.

Required `make verify` passed at `de0edde34`: 2,067 frontend tests (six skipped),
102 extension tests, thirteen Manager DOM tests, all six critical coverage floors
and supported Rust suites, including 546 desktop tests (seven ignored), 62 Host
units and real TLS/client/fleet regressions. Later changes are documentation only.
The accepted Manager binaries at runtime source `2a6e21ff2` are reused.

NSIS/MSI assembly exited zero at 19:02 UTC; the local NSIS update exited zero at
19:06 UTC without elevation. Installed desktop matches the produced PE except
Tauri's three-byte NSIS tag; CLI and Host match canonical produced/staged bytes.
Both bundled and active engine runtimes verify all 120 payloads at clean source
`6138913fcdca5891e072c6ca34d79ce7ffa30498`, Windows x64/SM120a/CUDA 13.3.
The exact installed runtime was recovered into a closed 121-member input archive;
this is neither an engine rebuild nor new qualification. All 103 profiles from
fourteen explicit catalogs are unchanged. Six bundled archives, six active
extension entrypoints and their fingerprint match. No dependency upgrade, model
download, GPU inference or engine build was performed. Native Rust emitted no
compiler warnings; the existing Vite large-chunk advisory remains.

Post-startup checks preserve two installed Muse models (four model/config files,
44,808,326,736 bytes), all nine conversation IDs and nine saved run IDs, agent
definitions, settings, MCP configuration and legacy pairing references. The remote
host ID, client ID, certificate pin and readable native vault grant are preserved
without exporting credentials. The local shared client now uses the Host's stable
`local_client_id`; the original local administrator reference remains in the
unchanged legacy registry. Original local Host identity and certificate pin remain.

### Execution corrections

The initial archive selection was stale October 1 source `74780ea1`. Preflight
caught the possible downgrade before building; delivery preserves installed `6138913f`.
The first native attempt exposed Robocopy deleting cached helpers when their source
directory was absent. Its actual parent-directory fixture and destination exclusion
verify the correction. The obsolete ginfer-extension 0.1.0 archive left by NSIS
was removed only after its exact old bytes and current 0.1.1 replacement were verified.
User extension folders were not manually removed.

The second attempt crossed the unchanged 4 GiB Windows running-memory floor and
stopped only its owned compiler tree; no installer ran. The successful continuation
reused completed stages with one Cargo job and the standard fat-LTO/codegen1 profile,
requiring 12 GiB fresh Windows headroom and a quiet WSL interval. Sampled native
private memory peaked at 7,234,605,056 bytes; minimum available Windows memory was
7,237,103,616 bytes. File-scoped clean-page advice retained every owned cache file;
no global cache purge or profile change was used. CPU booking and build lock are released.

Normal startup rejected the old locator's retired `owner.hardware_profile` field.
The exact local upgrade migration validated its prior hash, retained the original
record and removed only that field, preserving every other value and the referenced
hardware-profile file. No compatibility alias or source change was added. Disabled
autostart leaves GChat Home's Host lazy; opening Manager or the supported Host/Models
view attaches the existing owner and starts its controller, without loading a model.
Pinned HTTPS and actual windows verify both apps resolve that same updated Host.

### Owned inventory

| Owner / host | Exact path | Purpose / retention |
| --- | --- | --- |
| GChat / Ron-9950X3D2 | `/ai/gchat` | Reviewed source and current acceptance record integrated into stable main |
| Local update / coordinator | `/ai/gchat-worktrees/local-update-20261008` | Accepted candidate; release at final handoff after reviewed merge/push, preserving source in Git |
| Prior Manager candidate | `/ai/gchat-worktrees/ginfer-manager` | Superseded clean tree retired; six focused logs preserved in `out/ginfer-manager/focused/` |
| Local update evidence | `/ai/gchat/out/local-update-20261008/` | Retain gate, input/payload proofs, resource-failure evidence, migration backup, install/startup receipts and final Manager image |
| Accepted installers | `/ai/gchat/out/windows/` | Current NSIS/MSI and valid adjacent checksums; duplicate native staging copies retired October 9 |
| Native shared build | `%LOCALAPPDATA%/GChat/windows-build/source` | Accepted release/dependency cache; preserve |
| Native task | `%LOCALAPPDATA%/GChat/windows-build/local-update-20261008` | Disposable wrappers/fixtures retired after evidence copy and live-use checks; 837,401 bytes released |
| Recovered engine input | `/ai/gchat/out/local-update-20261008/recovered-installed-runtime-6138913f.zip` | Exact current manifest and 120 installed payloads; retain reproducible input |
| Installed GChat | `%LOCALAPPDATA%/GChat`, `%APPDATA%/GChat/data` | Updated desktop/Host and retained normal user state |
| Installed Manager | `%LOCALAPPDATA%/Programs/GInfer Server Manager` | Four accepted files and per-user Start Menu shortcut; shared real Host |
| Shared caches and Manager packages | `/ai/gchat/node_modules`, `/ai/gchat/src-tauri/target`, `/ai/gchat/out/ginfer-manager/` | Retain dependencies, compiler cache, accepted packages and evidence |
| Server 2 and unrelated owners | Existing app/data/host state and other worktrees | Outside this update and cleanup |

Concise acceptance and exact receipts: `/ai/gchat/out/local-update-20261008/HANDOFF.md`,
`artifact-promotion.json`, `installed-verification.json`, `normal-state-verification.json`,
`normal-local-host.json`, `normal-credential-preservation.json` and `manager-normal-window.png`.
Cleanup receipts record actual retirement; normal installed apps remain open.
The prior Manager worktree released 310,585,359 bytes; its focused logs remain.

### October 9 shutdown drain

The drain removed 1,384,909,864 nominal bytes of outside-cache Windows installer
and runtime duplicates after exact comparison with retained canonical files.
Two stale staging checksum sidecars were also retired; canonical installer
checksums and promotion receipts remain valid. The owned documentation checkout
is retired after its parked branch is committed and pushed.

Six other coordinators' code branches remain unmerged into main: `dev/fn-product-host`,
`dev/fn-product-installers`, `dev/fn-product-native-lifecycle`, `dev/fn-product-gchat-ui`,
`dev/fn-trash-contract-platform`, and `dev/gbench-engine-telemetry`. Their worktrees
are preserved. Installed Manager `ce6a6c0e6` and desktop `de0edde34` are already
ancestors of main. This coordinator's remaining handoff is documentation only.

Shared caches remain. The superseded 7.15 GB Linux private target remains because
process-inspection permissions prevented a complete live-use check. The scoped
GChat survey reached S1, Ada, S2 and the laptop; no remote files were deleted.
Retained paths and publication status are recorded in
`/ai/gchat/out/manager-kv-startup-20261008/drain-hygiene-not-deleted.md`, with actual
deletions in `drain-cleanup-result.json`. No builds or GPU tests were started.

## Offline host status Windows update — accepted October 1, 2026

The local Windows app is updated and open with source `d3199048d`. Offline host
cards show muted **GInfer offline** without the raw red connection error; cached
inventory and disabled loading remain. The 12 host-page tests and full `make verify`
pass. See [host UI evidence](../host-ui/README.md).

NSIS/MSI assembly and the authorized update exited 0 on RON-9950X3D2. Installed
desktop matches the build except Tauri's three-byte NSIS tag; CLI and host match.
Both 120-file runtimes verify against unchanged engine
`74780ea1415ac8d3bb440d58442ac4f81a5dfde3`, with the unchanged 103 profiles.
Four models (44,808,326,736 bytes), eight conversations, nine saved runs and agent
definitions are preserved. Visible desktop PID 40660 / host PID 37580 and local
HTTPS identity pass startup verification. Server 2 remains uninstalled.

Retain `out/offline-host-status-20261001/` and current
`out/windows/GChat_2.0.42_x64-setup.exe` / `GChat_2.0.42_x64_en-US.msi` with
adjacent checksums. The owned native task directory is removed; accepted build
caches remain. Candidate retirement is recorded in the handoff receipt. Native
Rust emitted no compiler warnings; existing Vite large-chunk warnings remain.
The offline host card is the next interactive check.

## Agent follow-up Windows update — accepted October 1, 2026

The local Windows app is updated and open with source `a5d2e35f7`. Delegated agent
results now omit absent JSON fields so streaming Chat can continue after finished,
incomplete or failed runs. The production SDK and ThreadMessage reload regression,
full `make verify` and independent review pass. The user confirms Stop works;
task budgets are unchanged. See [runtime evidence](../agent-runtime/README.md).

NSIS/MSI assembly and the authorized update exited 0 on RON-9950X3D2. Installed
desktop matches the accepted build except Tauri's three-byte NSIS tag; CLI and
host match their payloads. All 120 members of bundled/active runtimes and the
unchanged 103 profiles from 14 explicit catalogs verify. Engine source remains
`74780ea1415ac8d3bb440d58442ac4f81a5dfde3`. Four model files (44,808,326,736 bytes),
eight conversations, eight saved runs and agent definitions are preserved.
Visible desktop PID 2900 / host PID 21120 and local HTTPS identity passed startup
verification. No model was started by these checks. Server 2 remains uninstalled.

An elevated old host survived the first non-elevated update. Payload verification
caught it; after the user's UAC approval, the elevated retry replaced the host.
The retained updater now refuses an inaccessible host before NSIS and checks
termination. Installer exit 0 alone is insufficient acceptance.

Retain `out/agent-followup-20261001/` and current
`out/windows/GChat_2.0.42_x64-setup.exe` / `GChat_2.0.42_x64_en-US.msi` with adjacent
checksums. The owned native task directory is released; compiler/dependency
caches remain in `%LOCALAPPDATA%/GChat/windows-build/source`. Candidate cleanup
is recorded at handoff. Native Rust emitted no compiler warnings; existing Vite
large-chunk warnings remain. User replay of the same agent/continued conversation
is the next interactive check.

## Shared capabilities Windows update — October 1, 2026

The local Windows app is updated and open with source `f39cee7ed`. Streaming
Chat now discovers native skills/saved agents and MCP tools through the shared
capability runtime; per-thread permissions/folders and cancellation propagate
to native tasks. Sidebar Stop suppresses idle model restart and serializes with
model switches. Full source verification and independent review passed;
implementation/evidence are tracked in [agent-runtime](../agent-runtime/README.md).

Both NSIS/MSI assembly and the in-place update exited 0. The unchanged accepted
engine is `74780ea1415ac8d3bb440d58442ac4f81a5dfde3`; all 120 members of both
bundled and active runtimes verified, along with the unchanged 103 profiles
from 14 explicit catalogs. Installed desktop matches the build except Tauri's
three-byte NSIS bundle tag; CLI and host match their payloads. Visible desktop
PID 38412 / host PID 28832 and local HTTPS protocol version 1 passed startup
checks. Four models (44,808,326,736 bytes), eight conversations, seven runs and
saved agent definitions are preserved. Live Stop/skill replay remains the user's
acceptance check. Server 2 remains uninstalled.

Retain `out/shared-capabilities-20261001/` evidence and the current
`out/windows/GChat_2.0.42_x64-setup.exe` / `GChat_2.0.42_x64_en-US.msi` with
adjacent checksums. These replace the earlier October 1 installers. Reuse
`%LOCALAPPDATA%/GChat/windows-build/source` accepted release/dependency caches;
release the owned candidate and native `windows-build/shared-capabilities-20261001`
task directory after evidence is copied. Existing Vite large-chunk warnings
remain; native Rust emitted no compiler warnings. No engine qualification was
performed or claimed by this app update.

## Accepted Windows update — October 1, 2026

The Windows NSIS/MSI installers include the agent/chat fixes from `9540ac7e1`
and the sidebar Stop server fix. The shortcut now stops the API and unloads the
active local model; when the API is already stopped, Stop model remains available.
API-specific settings retain their independent control. Step budgets and overall
Agent Finished reporting are unchanged. Server 2 remains uninstalled.

Native assembly from `69cfa81146ffadbd972bf6872754f4e16f3b3aa7` exited 0 with
accepted engine `74780ea1415ac8d3bb440d58442ac4f81a5dfde3` and the unchanged
103 Windows profiles. Independent review and full `make verify` passed: 2,042
frontend tests, 15 extension tests, coverage floors and supported Rust suites.
The native mirror matches all 27 changed production files. Four sidebar regressions
cover scoped unload, an unload failure, an already-stopped API and an API stop failure.

The authorized in-place NSIS update exited 0 on Ron-9950X3D2. The installed desktop
matches the accepted build except for Tauri's three-byte NSIS bundle tag; installed
CLI and host binaries match their build payloads. Both bundled and active engine
runtimes have all 120 manifest members verified. The visible GChat desktop started
with its host, whose local HTTPS identity endpoint responds with protocol version 1.
Models are unchanged: four files totaling 44,808,326,736 bytes. All seven thread IDs,
seven saved run IDs and the unchanged agent definition file remain.

Acceptance evidence is retained under `out/windows/acceptance-20261001/`, including
build/install results, runtime/data verification and the final full verification log.
The installed app is ready for the user's continued-chat replay, throughput check
and real sidebar stop/unload check; those interactive checks remain open.

The initial source mirror failed because Windows exposed WSL dependency links as
files. The builder now excludes `node_modules` as both a directory and a file.
A native mirror regression preserved dependency contents while updating/removing
source files. Only verified zero-byte failed-staging placeholders were removed;
the corrected retry passed. Retain the concise failure summary and regression
result. The superseded staging log, temporary mirror fixture and duplicate native
acceptance directory are retired at handoff. The unused native debug caches
(about 11.1 GiB) were removed after confirming no compiler/debug job uses them;
the accepted release builds remain. The owned candidate is retired after integration;
unrelated worktrees and user data remain untouched.

| Owner / host | Exact path | Purpose / retention |
| --- | --- | --- |
| GChat / workstation | `/ai/gchat` | Reviewed source integration; accepted Windows runtime code `69cfa8114` |
| Windows refresh | `/ai/gchat-worktrees/windows-refresh`, `fix/windows-refresh-20261001` | Retired during final integration; evidence retained in main output directory |
| Windows release | `/ai/gchat/out/windows/GChat_2.0.42_x64-setup.exe`, `GChat_2.0.42_x64_en-US.msi` | Accepted installers and adjacent checksums; supersede September 30 copies |
| Windows acceptance | `/ai/gchat/out/windows/acceptance-20261001/` | Retain concise verification, installation and startup evidence |
| Windows build / Ron-9950X3D2 | `%LOCALAPPDATA%/GChat/windows-build/source` | Accepted release builds and native dependencies retained; idle debug caches removed; no live build |
| Windows refresh | `%LOCALAPPDATA%/GChat/windows-build/acceptance-20261001/` | Retired at handoff after evidence retained in main; no live job |
| Windows release / Ron-9950X3D2 | `%LOCALAPPDATA%/GChat/release-output` | Accepted native installer copies |
| Installed Windows / Ron-9950X3D2 | `%LOCALAPPDATA%/GChat`; app PID 39788, host PID 41000 at acceptance | Updated visible desktop and persistent host; no model loaded by acceptance checks |
| GInfer | `/ai/ginfer/out/windows/ginfer-windows-x64-sm120a.zip` | Accepted unchanged 120-member engine runtime |

## OI-074 frontend loading and OI-070 Linux refresh — current work

Owner: frontend/package agent; candidate
`/ai/gchat-worktrees/oi074-frontend-packages`, branch
`dev/oi074-frontend-packages-104d4ec6`, baseline `104d4ec6e`.
OI-074 source acceptance passes. The existing 500 kB warning threshold and
locked dependencies are unchanged. Source defers unused locales, emoji picker,
terminal hosts, syntax engines and Mermaid. Visited terminal hosts stay mounted
through navigation. Saved initial language loads before React renders; language
switches publish only the newest completed selection. JSON-only editors preserve
Prism JSON token classes and editing, while omitting unrelated editor grammars.
Every Shiki language and alias remains supported. Shared grammar data and exact
Oniguruma WASM bytes ship as offline assets, fetched on demand. The agent page is
private to its route, allowing the router's existing automatic split.

Final Linux/Tauri frontend build: Node 22.22.1 / Vite 6.3.2, 14.63 seconds, no
large-chunk advisory. Actual largest JS is 499,377 bytes (deferred Mermaid), entry
485,905 bytes. Bootstrap static closure is 14 JS files / 2,141,685 bytes;
bootstrap plus home route is 33 files / 2,795,678 bytes. Neither closure includes
terminal rendering, emoji picker, syntax engines, Mermaid or unused locales.
The saved Windows baseline main alone is 4,679.49 kB (gzip 1,401.26 kB); this
comparison describes emitted/loading bytes, not measured desktop startup speed.
The final graph has zero chunk cycles. Shared grammar data: 250 assets /
7,091,778 bytes, deduplicated across embedded-language dependencies.

Typecheck, focused ESLint, exact all-language reconstruction and WASM-byte tests,
Markdown, both terminal hosts, route behavior, locale cold-start/races, JSON editor
and stale-highlight regressions pass (50 tests across the focused sets). A
GPU-disabled Edge 154 fixture loads actual emitted files: Russian locale,
JSON/C++/Emacs Lisp colors and preserved text in light/dark themes, Streamdown's
JavaScript regex engine, and Mermaid SVG all pass; external resource requests
are zero. This is frontend asset acceptance, not installed application acceptance.
The coordinator runs full `make verify` after integrating the bugfix branches.

One initial harness used repository cwd, which prevented router generation;
only subsequent builds from `web-app/` are valid measurements. Manual grouping
initially introduced an HTML-parser/Markdown cycle, caught by the actual browser
before source promotion. Concrete prevention: HTML representation/construction
and parser ownership stay together; AST/file utilities and module glue are
independent leaves. Distinct Mermaid math retains its installed version and stays
outside startup. Do not regroup these solely to hit a chunk size.

Evidence: `out/oi074-frontend-packages/` contains the final build log, chunk graph,
loading measurements and actual browser receipt/request list/launch arguments.
Candidate owns 22 MB frontend output and small evidence only; no copied engine,
model or native build. Native Edge used a disposable profile at
`%LOCALAPPDATA%/GChat/oi074-frontend-assets/`; its observed launch includes
`--disable-gpu` and software WARP rendering. Its process exits normally.
The fixture server and profile are retired after preserving the receipt.

The retained Linux log and composed Windows build both contain an unsupported
`onlyExplicitManualChunks` output-option warning. Both actually use cached Rollup
4.40.0, which ignores that property and includes unassigned static dependencies
in manual chunks. The earlier explicit-ownership intention was not applied.
Remove the ignored property and correct its comment; this preserves the behavior
already measured by both builds, including the lazy features and chunk bounds.
The no-large-chunk claim remains valid; these builds were not warning-free.
Prevent recurrence by reading complete build stdout/stderr before acceptance,
not only matching the large-chunk advisory. Source/config checks and the final
coordinator frontend/native check complete this correction.

Linux assembly passes at source `02d369e8a`; native/frontend compilation is
from `54c931c68`. The later source delta only selects the supported cached
AppImage runtime environment. Ubuntu 24.04 / Node 22 image
`gchat-linux-installer-build:ubuntu24` reused the approved aligned dependencies
and shared compiler caches. Native compilation, DEB, and gzip AppImage assembly
exit 0. The outer postcopy wrapper initially exited 2 because its owned Manager
archive was root-owned. A unique temporary archive/checksum followed by atomic
replacement recovered postcopy with terminal 0; no product rebuild was needed.
The exact packet is
`/ai/gchat-worktrees/oi074-frontend-packages/out/oi070-linux-refresh/`, with
`assembly-final-status.json` and `linux-source-admission.json` recording that
source distinction and recovery. Independent package verification and actual
X11 acceptance pass for both formats. Root publishes the evidence packet to
`/ai/gchat/out/oi070-linux-refresh/`, retaining the old path as a stable symlink
to the same files, and promotes the accepted packages to `/ai/gchat/out/linux/`
and `/ai/gchat/out/ginfer-manager/linux/`.

The packet's `linux/` contains `GChat_2.0.42_amd64.deb` and
`GChat_2.0.42_amd64.AppImage` with checksums; `manager/` contains the matching
Manager/Host archive and guide. Both packages retain the exact four-image
`/ai/ginfer/out/linux-installer-20260930/runtime-set/` from Engine source
`05a286ba574114e2ef4dfb00b4015e07ab8c26a5`, 167 payloads per image, and the
`b8d8ea49` catalogs: 22 Linux files / 174 Qwen/Muse profiles. Windows's 104
profiles are a separate platform set. These historical Linux Engines support
Qwen/Muse only, with no Flash or new current-Engine/capacity qualification.
Their embedded server version reports `1.0.0.0-unknown` and unknown commit/dirty
fields; exact baseline payload hashes and manifests establish source provenance,
not those embedded fields. Native checks run on Ubuntu 26.04; the Ubuntu 24.04
build and maximum GLIBC 2.39 are verified ABI evidence, not a fresh clean-Ubuntu
24.04 desktop qualification.

Six offline GInfer documents match the retained `05a286ba` Engine: package
README and the documentation index, CLI, serving, operations and versioning
references. The packet's `operator-docs/provenance.json` records source and
sizes/SHA256. That historical assembly required `--operator-docs-directory` (or
`GINFER_OPERATOR_DOCS_DIRECTORY`), checked the six hashes and offline links
against the selected runtime source, and staged `resources/ginfer/docs/` for
both formats. Newer Windows Engine documentation is not substituted. Markdown
uses normal AppImage resource bundling; verified Engine runtime directories
bypass linuxdeploy rewriting. The immutable four-image runtime set is unchanged.

Independent DEB and AppImage payload/closure, ABI, companion help/version,
profile, Manager archive and six-document verification pass in
`package-verification.json`, with format receipts under `evidence/package-check/`.
The final emitted
frontend's offline browser fixture passes at 22:37 UTC: largest JS 499,377 bytes,
entry 489,712 bytes, fourteen bootstrap files / 2,153,867 bytes and bootstrap
plus home 33 files / 2,808,043 bytes. This is asset/loading evidence, not a
measured startup-speed improvement. See `frontend-final-measurements.json` and
`evidence/frontend-fixture/`.

Actual DEB and AppImage X11 clients start dark and install all four verified
runtimes. Manager is online against each format's shared Host. DEB uses Host
PID 1055553 / UUID `726abf22-f807-483f-9098-d067f84ef9f9`; the actual AppImage
wrapper PID 1061283 launches desktop PID 1061355 and Host PID 1065499 / UUID
`38674ad7-0bb9-4148-9a6b-fe048702e729`. Actual Models Scan displays Inventory
refreshed. `WM_DELETE_WINDOW` closes each Manager; reopening is online against
the same Host PID/UUID for that format. Both retain zero models, instances and
requests. Evidence is `native-acceptance.json` and `evidence/native/`.

WSL's mirrored Windows Host PID 23052 owns default ports 7443/7444; native
binding returned `EADDRINUSE` even though Linux socket listing did not expose
that owner. The isolated native fixture uses public locator `127.0.0.1:17443`.
It does not qualify default-port coexistence or LAN sharing. Linux tray and
Secret Service acceptance (OI-071) remain unrun. Server 2 is untouched; there
is no model, GPU, capacity or numerical acceptance claim.

All owned app/Manager/Host/wrapper PIDs are absent after shutdown, with zero
Linux Engines and port 17443 free. Original Windows app/Manager/Host PIDs
40160/15224/23052 remain alive unchanged, with zero Windows Engines. AppImage
left a 2,117,107,712-byte extracted temporary tree; an exact privileged live-use
scan found zero references and zero uninspectable processes before explicit
retirement. Canonical guard PID 1043205 terminated with status 143 and released
its locks; booking 287 was canceled at actual END 22:57 UTC.

The runner and standalone Manager use the canonical
`/ai/coordination/locks/local-build.lock`; the container holds build before GPU
and supplies its open build descriptor to Manager. The bounded inherited-lock
fixture passes; evidence remains `inputs.json`, `aligned-toolchain-preflight.log`
and `lock-fixture/receipt.json`. Windows Manager source is unchanged. Linux
package and native lifecycle acceptance are complete; next proceed to the
Host/Manager review in Bubbs’s 22:43 handoff and scoped owned-output retirement.
Windows installed acceptance and OI-072 remain unchanged.

## Accepted Linux installers — September 30, 2026

The complete Linux release is ready for an Ubuntu 24.04+ x86-64 desktop with a
compatible NVIDIA driver. Both packages contain GChat, its persistent host and
CLI, Bun/uv, launch profiles, and separate SM80, SM86, SM89 and SM120a GInfer
engines with private FFmpeg/CUDA/library dependencies. No separate engine or CUDA
toolkit installation is required. Model weights remain normal app downloads.

- Recommended: [GChat_2.0.42_amd64.deb](../../out/linux/GChat_2.0.42_amd64.deb)
- Portable: [GChat_2.0.42_amd64.AppImage](../../out/linux/GChat_2.0.42_amd64.AppImage)
- Both files have adjacent `.sha256` checksums; the retained release copies pass.

```sh
sudo apt install ./GChat_2.0.42_amd64.deb
```

For AppImage, make the file executable and launch it. Systems without FUSE can use
`APPIMAGE_EXTRACT_AND_RUN=1 ./GChat_2.0.42_amd64.AppImage`.

## Verification and limits

- Both exact packages passed engine integrity verification, all eight engine
  executable `--help` checks, and bundled host/CLI/Bun/uv startup checks.
- Debian installed through apt in clean Ubuntu 24.04. Its X11 desktop initialized,
  installed all four persistent runtimes, and started its persistent host. The host
  inventoried the real RTX 5090; no model was loaded on that occupied GPU.
- AppImage passed the same desktop, runtime and host checks in Ubuntu 24.04 with
  Xvfb and normal desktop Wayland/EGL/font libraries. It ran in extract-and-run
  mode because the container has no FUSE device. FUSE mounting was not tested.
- Every engine image also passes startup in plain Ubuntu 24.04 without optional
  apt packages, with only NVIDIA driver libraries mounted. Each manifest has
  167 verified payload files and exact architecture cubins; maximum GLIBC is 2.39.
- Frontend verification passed 2,029 tests and 15 extension tests, lint, typecheck
  and coverage gates. After correcting two old-path assertions, all platform Rust
  suites passed via `make test-rust`; desktop Clippy passed. Installer tests cover
  fresh install, no-op, corrupt-upgrade rejection, successful upgrade and model
  preservation. Registry and routing tests cover owner retention and exact GPU
  architecture selection.
- The packaged SM80 engine loaded the existing Muse artifact on Server 2's idle
  64-GiB CMP 170HX, driver 610.43.03. It used the shipped
  `cmp170hx-muse-groupwise-int-dflash-q4-tp1-c1-128k-int8` profile settings and a
  bounded 64-token text smoke. Native DFlash ran, the response was `READY`, and the
  process exited 0. GPU memory returned to 14 MiB. This is startup/generation
  evidence, not numerical, performance, media or all-GPU qualification.

The September 30 real-GPU check used the Muse INT TP1 package before the
October 8 filename rename. Its current Server 2 location is
`/media/ron/SSD_RAID/ai/ginfer-artifacts/qwen38-muse-tp1-tp2-tp4-2026-09-02-r1/muse_glimmer_30b_int_df2.ginfer`.
The October 8 rename receipt and a read-only check on `AIS-1-2950X-L02`
confirm that path (19,776,776,704 bytes). This filename/location update does
not constitute new engine or model qualification.
Its temporary `/home/ron/.local/state/gchat-linux-installer-check-20260930` engine
and logs were removed after evidence was retained locally. Server 2 remains
uninstalled; its independent RTX 3090 process and model files were untouched.
The Windows installation was unchanged.

## Packaging decisions and reproduction

Use [the Linux release script](../../scripts/build-linux-release.sh) inside
[the Ubuntu 24.04 / Node 22 build image](../../scripts/linux-release.Dockerfile),
with the explicit runtime set, profile catalog directory and version-matched
operator documentation directory; see
[DEVELOP.md](../../DEVELOP.md#complete-linux-release).

The extension install refreshes its generated local core-tarball reference while
root external dependencies remain locked. Engine manifests are verified before
staging. Linuxdeploy runs in extract mode, without engine or static Bun/uv files;
those files are injected afterward so their bytes and private RPATHs stay intact.
Failed Tauri runs retain `bundle/appimage_deb`, so assembly removes that owned
intermediate before each AppImage build. Each format starts from the unpatched
desktop executable, which is restored on exit. These address the observed Node
syntax, generated-tarball lock, static-ELF scan, stale-staging and bundle-metadata
failures without changing inference behavior.

See [the runtime-install ADR](../decisions/2026-09-30-bundle-linux-ginfer-runtimes-by-gpu-architecture.md).
An already-running older single-engine host must restart to acquire the new
routing map. Independently registered standalone hosts retain ownership.

## Retained inventory and status

| Owner/host | Exact path | Purpose / retention |
| --- | --- | --- |
| GChat / Ron-9950X3D2 | `/ai/gchat/out/linux/GChat_2.0.42_amd64.{deb,AppImage}` | Accepted installers and adjacent checksums |
| GChat | `/ai/gchat/out/linux/acceptance-20260930/` | Build/check logs, package acceptance and SM80 smoke evidence |
| GInfer | `/ai/ginfer/out/linux-installer-20260930/runtime-set/` | Accepted engine baseline, source `05a286ba574114e2ef4dfb00b4015e07ab8c26a5` |
| GInfer | `/ai/ginfer/out/linux-installer-20260930/` | Concise engine/FFmpeg build evidence |
| GChat | `/ai/gchat/src-tauri/target`, `/ai/gchat/src-tauri/ginfer-host/target` | Existing caches with accepted desktop/host builds retained |
| Build environments | `gchat-linux-installer-build:ubuntu24`, `ginfer-linux-release-build:ubuntu24` | Reusable accepted toolchains |

The runtime code was built from GChat `82b855870`; subsequent changes correct
packaging/reproduction and record acceptance. Implementation and final packaging
changes are merged to main for handoff. Task candidate worktrees, their private
build/dependency copies, disposable acceptance containers/images and unpacked
bundle staging are retired during final handoff. The prior host-only AppImage is
replaced and the separate glibc-2.43 runtime archive is superseded and removed.
Unrelated worktrees, model files, Windows builds and other sessions' jobs remain.
The September 30 installer work completed after its documented commit/push and
cleanup; the October refresh's current state is recorded above.

## Completed Windows update and Server 2 removal

The September 30 Windows NSIS/MSI update used GChat `bf7cde6f7` and clean engine
`74780ea1`. NSIS exited 0, the desktop and host run, and all 120 active runtime
members match the manifest. Model cache preserved: two `.ginfer` artifacts plus
two config files, 44,808,326,736 bytes total. `make verify` passed. Windows engine
compile/socket/provenance corrections were merged and pushed. See GInfer's
`docs/installer-refresh/README.md` for that accepted build's evidence.

Windows installers remain under `/ai/gchat/out/windows` and native copies under
`%LOCALAPPDATA%/GChat/release-output`. The October 1 refresh above supersedes
the September 30 Windows installer after acceptance.

Server 2's GChat app, host and desktop registration were removed recoverably into
`/home/ron/.local/state/gchat-uninstall-2026-09-30` (561 MiB). User data, models,
standalone host and independent engine builds remain. Its prior installation does
not validate the new Linux package.

## References

- [Development and platform paths](../../DEVELOP.md)
- [Host setup](../lan-host-setup.md)
- [Open work](../open-work.md)
- GInfer `docs/installer-refresh/README.md`, `tools/stage_linux_runtime.py`
