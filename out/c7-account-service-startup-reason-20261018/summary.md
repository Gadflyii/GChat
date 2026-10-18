# Typed account-service startup failures

PASS — GUI-ACCOUNT-SERVICE-ERROR-WORDING, 18 October 2026.

The old append-only log parser deterministically displayed an earlier internal
path for a new generic child failure. Startup now preserves typed storage
failures through private exit codes 201–205; Host guidance uses the current
child status, with technical details closed. Arch signed the design.

Production source: 3444ff6d07e8179f1380aac1564c1a285f7ef85d.
Rendered regression: 7dbcecea2 (native string rejection).
Focused: 3 Host, 1 service-boundary and 32 account-page cases pass;
cargo check and strict Clippy pass. ONE make verify passes:
3,345 app + 121 extension + 1,221 Rust tests; 6 app skips, 28 Rust ignores.
Linux private S1 test container, CPUs 64–71, eight jobs; terminal 04:38 UTC.
No native GUI, Windows, installer, model or GPU acceptance claim.

The 36 GiB disposable S1 build/cache and four exited owned containers were
removed after the gate. Shared donor resources and image were preserved.
CPU booking 2975 canceled; returned 04:38Z. Result JSON and this summary retained.
