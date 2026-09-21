# Remove retired context reloads and tighten code hygiene

Status: implemented on main.

GInfer instances own fixed launch settings. Chat and native agents manage context
through their active checkpoint/compaction implementations. The unused native
context-expansion hook, reload coordinator, frontend event listeners, and event
contract had no production callers or emitters. They are removed, along with tests
for the abandoned reload path. Context-error classification remains shared by the
Local API proxy; native requests retain their assigned target and return overflow
errors without hidden reloads or retries.

The hygiene review also removes unreachable legacy UI/helpers and their dedicated
tests, the obsolete catalog global, unused exports, and stale backend comments.
Shared frontend helpers live outside React refresh boundaries. Hook dependencies
include the callbacks used by memoized values.

New windows now read GChat's theme preference. Theme listeners detach on window
closure, component cleanup, and completion of a late registration. Regression tests
cover preference selection and listener lifetime. File writability probes explicitly
preserve existing settings; defaults and completion-record inputs use clear types.

Validation uses `make verify`, production frontend build, and application/host
Clippy with warnings denied. The remaining large frontend chunks include bundled
syntax grammars and application dependencies; a successful build is not a bundle
size or installed-Windows qualification. See [open work](../open-work.md).
