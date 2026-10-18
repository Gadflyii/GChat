# MCP dialog keyboard row controls

Command options now use native reorder buttons, visible focus, sortable keyboard coordinates and stable row identities. Stable identities keep focus on the moved option, rather than the option replacing its old array position.

Baseline: the original div fails the native-button regression (9 other tests pass). The first button candidate reorders alpha/beta/gamma to beta/alpha/gamma but incorrectly focuses beta; both native input and the real KeyboardSensor regression reproduce it. The final candidate passes all 11 focused tests, lint with no errors, and frontend/desktop builds.

Native Linux on S1: Tab/Space/ArrowDown/Space reorders and keeps a visible focus ring on alpha. Enter/Space add and remove command options, extra settings and HTTP headers without submitting. Save/reopen retains beta/alpha/gamma; canceling the HTTP draft preserves the saved STDIO configuration. Screenshots 01–04 show the native controls and focus.

The private AppDir runs with its own HOME, XDG/runtime700, dbus, unlocked keyring and Xvfb. Input is native XTest; inspector use is read-only. No real connector, model, GPU, Windows or shared app data is used. The parent route's existing Save action enables the inert /usr/bin/true fixture; it was disabled again natively. No change to that route is claimed.

ONE make verify passed without retry: web3459/6skipped, extension127, Rust1275/28ignored. Lint, typecheck, quality checks and critical coverage floors passed. App, private Host and desktop helpers are stopped by their owned PIDs; CPU88–95 returned07:49Z. The inactive40G SSD build/cache root was removed07:51Z. Only small results, logs and four screenshots remain; Windows is unqualified.
