# Host residency controls

`GCHAT-HOST-RESIDENCY-CONTROLS` passes the signed Host API/UI acceptance. Shared launch options expose optional whole-GiB Flash RAM headroom and expert LFU on/off. Blank/null inherits the Engine’s 4 GiB; explicit values reach Engine validation unchanged. Zero displays a warning. Custom desktop/Fleet settings preserve zero and false on edit, save and restart; tested profiles keep their own values.

Source `497840b01`; ONE full verification on `d16521c19` passed: 3,469 app cases, 127 extension cases, 1,276 native cases (28 ignored), all coverage floors, types, lint and quality guards. Focused checks passed 61 desktop cases, 58 Fleet cases, typed-option and authenticated Host persistence/restart/child-argument regressions, check and Clippy.

Normal merge of main `bd10e0e66` yielded `e549c330b`; all 86 combined Host component/store cases and `make typecheck` pass. The initial extra `yarn typecheck` command was invalid at root; only that stage was corrected and continued. Full verification was not repeated.

S1 AIS-2-8592-L01, CPUs80–87, nice10/max8 jobs, socket1 shared lock, offline dependencies. No GPU, model, installed GUI, Windows runtime, profiling, performance or packaging qualification. The Host child test uses the existing fake Engine executable fixture.

CPUs returned 07:36Z. Three stopped containers and the 31.51 GB private SSD root were removed at07:36:49Z; the inactive RC donor is untouched. Retain these small results and source branch for coordinator integration.
