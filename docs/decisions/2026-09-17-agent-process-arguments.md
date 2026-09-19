# Explicit agent process arguments

The failed Windows disk-inventory run exhausted its step limit after shell quoting
errors. The native shell-tool schema did not declare its argument array, and the
executor joined structured arguments into a shell string when any argument contained
shell metacharacters. PowerShell scripts therefore crossed an unintended cmd.exe
parsing boundary. Some invocations returned the script text instead of disk data.

`os.shell.run` now always launches the requested executable with literal, separate
arguments. A shell must be explicitly invoked with its script argument. The native
schema declares cmd, args, cwd and timeoutMs; Windows guidance describes PowerShell
direct execution. No implicit shell selection, joining, quote repair or argument
string decoding is performed. The existing approval and destructive-command checks
remain in place. Executable paths with spaces are passed directly, not tokenized.

Regression tests cover literal metacharacters and explicit script execution. Live
execution testing uses the saved disk-inventory definition without raising its
12-step limit or rewriting its task instructions. Authoring-only tests do not
establish that a generated agent can perform its task.

Live evidence: the saved Local Disk Free Space Inventory definition ran against
Muse Glimmer NVFP4 + NVFP4 DFlash on the Windows RTX 5090 at high reasoning with
its original 12-step limit. A WSL runner invoking native PowerShell finished in
two steps. The native Windows Rust runner also completed: its first two-step
result exposed an overly strict test expecting a colon after the drive letter;
after correcting that formatting assertion, the native rerun passed in four steps
and 35.5 seconds. All returned C/D/E capacity, free space and percentages without
file writes. These tests use temporary run stores and harness-supplied approval,
not the installed UI; the changes require a new installer for desktop use.

Broader regression checks exercise literal arguments, executable/working-directory
paths containing spaces, explicit pipelines, and failing commands with exit status
and stderr. A controlled-response execution matrix runs shell calls and blocked
file writes through every built-in composition, including evaluator, worker and
workflow stages. This tests shared runner behavior rather than model competence on
every possible task; no task-specific disk-inventory execution path exists.
