# Preserve GPU selection when loading installed models

Date: 2026-10-16
Status: Accepted

Installed Load previously selected the first enumerated Host GPU. That could ignore
the user's intended device and the process CUDA visibility restriction.

Store the Installed page's selected GPU UUIDs in the existing hardware settings.
Automatic selection remains an explicit choice; a saved explicit selection must be
available after fresh hardware enumeration. Carry explicit UUIDs through the model
service, extension and native adapter to the Host. Reject a mismatched already
running instance rather than reporting that the requested device was selected.

Resolve CUDA_VISIBLE_DEVICES against the complete physical inventory before any
selection, preserving integer or unambiguous UUID-mask order. Empty and -1 masks
expose no devices. Invalid, duplicated, unavailable or ambiguous mask entries fail
closed. Explicit selection cannot widen visibility. This applies to admission and
the child process device set; no model or GPU measurement is implied.
