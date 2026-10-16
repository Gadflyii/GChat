# Preserve GPU selection when loading installed models

Date: 2026-10-16
Status: Accepted

Installed Load previously selected the first enumerated Host GPU. That could ignore
the user's intended device and the process CUDA visibility restriction.

Store the Installed page's selected GPU UUIDs in the existing hardware settings.
Automatic selection remains an explicit choice; a saved explicit selection must be
available after fresh hardware enumeration. Carry explicit UUIDs through the model
service, extension and native adapter to the Host. Never reuse a resident on a
different GPU group; launch on the requested qualified group when available and
report an unavailable selection clearly.

Resolve CUDA_VISIBLE_DEVICES against the complete physical inventory before any
selection, preserving integer or unambiguous UUID-mask order. For numeric entries,
CUDA_DEVICE_ORDER=PCI_BUS_ID uses validated physical PCI addresses; otherwise the
order comes from the Engine's passive CUDA runtime enumeration, never the Host's
physical inventory order. The Host obtains the default order in a fresh child with
CUDA_VISIBLE_DEVICES removed and CUDA_DEVICE_ORDER=FASTEST_FIRST, and validates its
provenance and UUID identities before using it. Desktop and Host each apply their
own ordering policy. An older Engine without this query cannot safely resolve
default numeric masks and produces an explicit error; UUID masks remain usable.

Empty and -1 masks expose no devices. Invalid, duplicated, unavailable or ambiguous
mask entries fail closed. Explicit selection cannot widen visibility. This applies
to admission and the child process device set; no model or GPU measurement is
implied.
