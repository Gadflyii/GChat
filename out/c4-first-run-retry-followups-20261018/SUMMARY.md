# First-run Retry followups

Retry wakes retained maintenance failures at every stage, including GPU and
complete, without rewriting unchanged choices. When the monitor cleared an
error before the click, Retry quietly refreshes status. Explicit download,
profiling and startup Resume actions retain their behavior.

Two Host regressions cover recovery and the stale-click race. Native Linux
focused tests passed 19 cases (one existing case ignored); Cargo check and
strict Clippy passed. ONE make verify stopped because this fresh private
source stage omitted generated core/dist. After building core, only failed
coverage and remaining Rust stages continued: 3,378 app/core tests, 127
extension tests, all six coverage floors, and 1,249 Rust tests passed (28
ignored). No second make verify ran. Future fresh stages must build core first.

Source hashes matched before/after. S1 tests used private SSD source/caches,
isolated HOME/XDG and offline dependencies, with bridge networking for the
existing UDP fixture. No desktop GUI, Windows, GPU, model or Engine test was
run. Containers and the owned 21 GiB remote root are retired; booking3047 is
returned. Result and exact commands are beside this summary.
