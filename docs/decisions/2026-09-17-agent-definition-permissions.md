# Agent definition permissions

Definitions carry optional capability permissions: file reads, file writes, shell
commands, skill scripts, network tools, management mutations and clipboard access.
Each supports default, allow, ask, or deny. Default retains existing authorization;
allow skips tool confirmation, ask requires confirmation every time without remembered
approval, and deny blocks before path preparation or execution. Existing destructive
command blocks and folder-access boundaries are not bypassed by allow.

The orchestrator wraps the run's approval hook once with the parent definition's
policy. Standard agents, evaluators, coordinators, workers and workflow stages use
that same wrapper. Prompt context describes permissions, but enforcement occurs in
tool authorization independently of model compliance. The editor, composition changes,
saved definitions and builder schema preserve these settings; save approval exposes
the policy before accepting a generated definition.

These are tool permissions, not OS sandboxing. Shell commands and skill scripts can
perform filesystem and network operations themselves. The UI and builder instructions
state this explicitly; users must block those capabilities to prevent that route.
No claim of read-only shell execution or process isolation is made.
