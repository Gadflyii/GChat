"""Resolve public StatusNotifier identities and visible tray accessibility paths."""

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


def iter_tray_nodes(application, shell, atspi):
    """Yield bounded structural tray/menu paths without entering foreign windows."""
    containers = {
        atspi.Role.APPLICATION, atspi.Role.PANEL, atspi.Role.TOOL_BAR,
        atspi.Role.FILLER, atspi.Role.LAYERED_PANE, atspi.Role.ROOT_PANE,
        atspi.Role.MENU, atspi.Role.POPUP_MENU,
    }
    pending = [(application, 0)]
    visited = 0
    while pending:
        node, depth = pending.pop()
        visited += 1
        assert visited <= 512 and depth <= 24
        node.clear_cache()
        role = node.get_role()
        yield node, role
        structural = role in containers or (
            application == shell and depth == 1
            and role in {atspi.Role.WINDOW, atspi.Role.FRAME}
        )
        if not structural:
            continue
        if depth > 1:
            states = node.get_state_set()
            if not (states.contains(atspi.StateType.VISIBLE)
                    and states.contains(atspi.StateType.SHOWING)):
                continue
        count = node.get_child_count()
        assert 0 <= count <= 80
        for index in range(count):
            child = node.get_child_at_index(index)
            if child is not None:
                pending.append((child, depth + 1))
