GUI-HOST-HARDWARE-SETUP-RESULT-20261018 — ROOT_REVIEWED_PASS

Exact base `3399f67687904ca606da92e705e42629020a5f89` with the four frozen component/store source and test inputs recorded in `test-result.json`. Corrected baseline reproduced all 16 intended failures; the earlier ambiguous-selector/mock-queue screen was invalidated.

Focused tests: 75 passed (17 store, 58 rendered). Lint: no errors, five existing warnings. ONE `make verify`: typecheck/quality passed; 3,443 app/core tests passed, six skipped; 127 extension tests passed; all six coverage floors passed; 1,271 native tests passed, 28 ignored, 23 summaries. Container exited 0 at 07:12:11Z with no OOM. All four frozen hashes and 35 dependency bindings matched before/after; ROOT reviewed raw logs and exit bytes.

Verified S1 AIS-2-8592-L01, socket1 CPUs120–127, shared compile lock, nice10/max8 jobs, offline pinned container, no GPU. Booking3115 returned07:13Z.

Cleanup completed07:19Z: removed the independent S1 fixture (42.05 GB apparent, 43.19 GB allocated before removal) and all three verified terminal containers, after confirming no live jobs or copy holds. S1 reported 1.672 TB free afterward; concurrent jobs affect filesystem-wide changes. Removed disposable local raw logs and command receipts after ROOT review; retained only `test-result.json` and this summary. The inactive RC donor was untouched.
