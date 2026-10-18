# Downloads inventory before the first Host answer

Models → Downloads previously showed zero byte totals before the Host answered,
and claimed an empty list after the first request failed. The summary and empty
state now depend on the existing successful-inventory flag. First failures retain
the readable error and Refresh downloads; success reveals the real inventory.

Two regressions fail against unchanged source. Candidate: 50 focused tests and
affected ESLint pass; matching frontend, Host and desktop build pass. ONE
`make verify`: 3,513 app passed / 6 skipped, 127 extension passed, 1,284 Rust
passed / 28 ignored; lint/types/guards and six coverage floors pass.

Private Linux native captures: pending.png shows checking without totals or an
empty claim; failure.png shows the actionable error without fabricated data;
recovery.png shows the confirmed empty inventory after native Refresh and
resuming only the private Host. Background polling stayed enabled; the focused
regression separately verifies the Refresh button path. An earlier interruption
attempt was rejected and corrected by closing the GUI before pausing its detached
Host (native-interruption.json). No model transfer, inference or GPU work.

Source/binary binding, exact commands, platform, cleanup and limits: result.json,
native-launch.json, build-command.json and verify-command.json.

Own app, Host and helpers stopped by verified PIDs; disposable SSD root removed.
CPU88–95 returned08:53Z and booking3164 canceled; immutable donors unchanged.
