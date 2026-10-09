# Open work

GInfer's `docs/maintainer/open-work.md` is the single master issue and TODO list
for the engine, serving, GChat and GInfer Server Manager. The current coordinator
copy is [the master list](/ai/ginfer-worktrees/open-work/docs/maintainer/open-work.md)
on branch `docs/open-work`; its owner integrates updates into GInfer. This page
is a navigation pointer, not a second backlog.

GChat's October 9 inventory is recorded in OI-066 through OI-077. Existing
OI-056/OI-057 cover current-engine integration and Linux desktop acceptance.
Rows distinguish reproduced defects, acceptance gaps and deferred work. Completed
Chat/Code/agent capabilities, throughput, Stop, permission and prompt fixes are
implementation evidence rather than new open defects.

Check the master list before adding an issue. Edit only in
`/ai/ginfer-worktrees/open-work` under `flock /tmp/ginfer-open-work.lock`, preserve
other owners' work, and commit for the owning coordinator to merge. Record the
symptom, reproduction, affected source/build, host and evidence; update an
existing row instead of duplicating it.

Current implementation, acceptance evidence and retained packages remain in
[Agent runtime](agent-runtime/README.md), [Manager](ginfer-manager/README.md),
[Installer refresh](installer-refresh/README.md), [Host UI](host-ui/README.md) and
[profile evidence](model-profile-evidence.md). Use
[critical-flow verification](testing-critical-flows.md) for the automated gate.
The G.bench website lives in the separate Sectile Web `site/gbench` repository.

Issue registration does not authorize model/engine replacement, data deletion,
reference-result publication, Server 2 deployment or GPU qualification.
