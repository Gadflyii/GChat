# Place WSL managed models on Linux filesystems

Status: accepted implementation decision for GCHAT-WSL-MODEL-PLACEMENT.

The retained OI-144-9P comparison reached Ready in 237.278 seconds from Windows
9p and 42.259 seconds from ext4 with the same engine, package and profile.
Materialization stages explain approximately 94% of the difference. Increasing
loader parallelism did not establish a remedy; placement owns this change.

The Host's shared native resolver checks WSL and the filesystem of the canonical
existing path prefix. It redirects implicit Windows-backed roots to verified
Linux XDG/HOME storage, namespaced by the canonical original root. Explicit
Windows-backed selections and resumes fail actionably. Other Linux and native
Windows roots retain their placement.

New manifests and artifacts share one directory, preserving atomic Host
publication and recording absolute payload paths when outside app data. Desktop
and CLI readers consume one catalog across selected, original and installed-job
roots. Existing data and partials are retained without migration. A fresh download
can coexist with an old paused transfer in another root. Ordinary downloads retain
their data-folder containment.

Deletion resolves the catalog location and retains Host ownership for managed
packages. Ambiguous copies require explicit selection rather than deleting
multiple directories under one model ID. This does not qualify engine capacity,
change loader behavior or claim native Windows performance.

Current implementation and focused verification: [code hygiene](../code-hygiene/README.md).
