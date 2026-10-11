# Host and Manager resource ownership

OI-115–119 retain the existing public protocols, limits and authority checks.

A bootstrap attempt rereads the local host authority before reusing its pinned
HTTP client. Each client operation takes a fresh registry observation; unchanged
catalogs skip persistence only after a fresh durable comparison. Snapshots copy
owned observations under their locks, then project outside process ownership.

Download journal work keeps its owned jobs guard through blocking serialization,
fsync and publication. Cancellation cannot reorder a later write or suppress a
durably admitted worker. Package verification reads the complete file in one
blocking owner; hashing and artifact checks are unchanged.

Exit readers have a session-owned drain outside the global process mutex. Final
diagnostics may publish only to the same session, including a stopped session;
a replacement session cannot inherit them. Last-request release wakes a draining
Stop without changing its deadline or force behavior.

Manager retains immutable shared snapshots and serializes the same JSON. Its UI
indexes the current view and updates activity text without replacing unchanged
controls. Hidden views defer projection until visible; failed storage writes retry.

Original/candidate measurements and outstanding native scope are recorded in
[the current subject](../code-hygiene/README.md). No native idle, peak-memory,
model-throughput or SCM qualification follows from these CPU fixtures. Daemon
worker count and Linux free-space subprocess selection remain unchanged.
