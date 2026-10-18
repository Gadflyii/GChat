# Native themed choice menus

Native WebKitGTK ignored the app palette for select popups. The source replaces
remaining native selects with the existing app menu primitives, preserves choice
values/disabled states/callbacks, and fixes the serving field width and keyboard
focus around closed sections.

Native Linux source `8f4d0724f` passes serving-instance, saved-profile and Fleet
menu acceptance with two genuinely paired private Hosts. Six candidate OS
screenshots cover Light/Medium and Dark/Large; one baseline screenshot reproduces
the white popup in Dark mode. Keyboard selection, Escape and forward/backward
Tab pass without starting a model or applying Fleet authority.

One full verification invocation was continued after concrete fixes; its stages
pass 3,298 frontend, 121 extension and 1,216 native cases, all six critical
coverage floors. Final focus/layout correction: 42 focused cases, typecheck,
control lint and frontend/native build pass. Merge of main `548d73ed8` at
`45354f116` passes 214 cases across six affected suites and typecheck. Windows UI and release-wide
qualification remain outside this result. See result.json for exact scope.

Private session/Hosts stopped, five containers and 39 GiB build/cache removed;
CPUs104–111 returned04:04Z. Read-only donors unchanged.
