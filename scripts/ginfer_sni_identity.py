"""Resolve public StatusNotifier registration identities."""

import re


_SERVICE = re.compile(
    r"(?::[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+|"
    r"[A-Za-z_-][A-Za-z0-9_-]*(?:\.[A-Za-z_-][A-Za-z0-9_-]*)+)"
)
_OBJECT_PATH = re.compile(r"/(?:[A-Za-z0-9_]+(?:/[A-Za-z0-9_]+)*)?")


def parse_registered_item(raw: str) -> tuple[str, str]:
    """Return the exact bus service and object path, or reject an invalid entry."""
    if not isinstance(raw, str):
        raise ValueError("StatusNotifier registration must be a string")
    if "@" in raw:
        # GNOME separates the bus name from the object path with '@'.
        service, _, object_path = raw.partition("@")
    else:
        service, separator, tail = raw.partition("/")
        object_path = "/" + tail if separator else "/StatusNotifierItem"
    if not _SERVICE.fullmatch(service) or not _OBJECT_PATH.fullmatch(object_path):
        raise ValueError("Invalid StatusNotifier registration identity")
    return service, object_path
