"""Public watcher identity parsing; no D-Bus connection or app launch."""

import unittest
from types import SimpleNamespace

from scripts.ginfer_sni_identity import iter_tray_nodes, parse_registered_item


class RegisteredItemIdentity(unittest.TestCase):
    def test_gnome_registration_keeps_at_sign_out_of_bus_name(self):
        path = "/org/ayatana/NotificationItem/tray_icon_tray_app_manager"
        self.assertEqual(parse_registered_item(":1.132@" + path), (":1.132", path))
        self.assertEqual(
            parse_registered_item("org.example.Manager@/StatusNotifierItem"),
            ("org.example.Manager", "/StatusNotifierItem"),
        )

    def test_standard_registration_and_service_only_default(self):
        for service in (":1.132", "org.example.Manager"):
            with self.subTest(service=service):
                self.assertEqual(
                    parse_registered_item(service + "/StatusNotifierItem"),
                    (service, "/StatusNotifierItem"),
                )
                self.assertEqual(
                    parse_registered_item(service), (service, "/StatusNotifierItem")
                )
        self.assertEqual(parse_registered_item(":1.132@/"), (":1.132", "/"))

    def test_malformed_entries_are_rejected_before_owner_lookup(self):
        for raw in (
            ":1.132@", ":1.132@@/StatusNotifierItem",
            ":1.132@/StatusNotifierItem@", ":1.132@StatusNotifierItem",
            "@/StatusNotifierItem", "manager/StatusNotifierItem",
            ":1.132/StatusNotifierItem/", ":1.132//StatusNotifierItem",
            " :1.132/StatusNotifierItem",
        ):
            with self.subTest(raw=raw):
                with self.assertRaises(ValueError):
                    parse_registered_item(raw)


class TrayTraversal(unittest.TestCase):
    def test_visible_shell_window_reaches_tray_without_hidden_or_foreign_frames(self):
        roles = SimpleNamespace(**{name: name for name in (
            "APPLICATION", "WINDOW", "FRAME", "PANEL", "TOOL_BAR", "FILLER",
            "LAYERED_PANE", "ROOT_PANE", "MENU", "POPUP_MENU", "PUSH_BUTTON",
        )})
        atspi = SimpleNamespace(
            Role=roles, StateType=SimpleNamespace(VISIBLE="visible", SHOWING="showing")
        )

        class Node:
            def __init__(self, role, name="", children=(), states=("visible", "showing")):
                self.role, self.name, self.children, self.states = role, name, children, states
                self.cached_role = None

            def clear_cache(self):
                self.cached_role = self.role

            def get_role(self):
                return self.cached_role

            def get_state_set(self):
                return SimpleNamespace(contains=lambda state: state in self.states)

            def get_child_count(self):
                return len(self.children)

            def get_child_at_index(self, index):
                return self.children[index]

        tray = Node(roles.PUSH_BUTTON, "OI071-disposable")
        visible_path = tray
        for _ in range(9):
            visible_path = Node(roles.PANEL, children=(visible_path,))
        hidden = Node(roles.PANEL, children=(Node(roles.PUSH_BUTTON, "hidden"),), states=())
        not_showing = Node(
            roles.MENU, children=(Node(roles.PUSH_BUTTON, "not showing"),), states=("visible",)
        )
        foreign_frame = Node(roles.FRAME, children=(Node(roles.PUSH_BUTTON, "foreign"),))
        panel = Node(roles.PANEL, children=(visible_path, hidden, not_showing, foreign_frame))
        shell = Node(roles.APPLICATION, children=(Node(roles.WINDOW, children=(panel,)),))
        names = [node.name for node, role in iter_tray_nodes(shell, shell, atspi)
                 if role == roles.PUSH_BUTTON]
        self.assertEqual(names, ["OI071-disposable"])

        other = Node(roles.APPLICATION, children=(
            Node(roles.WINDOW, children=(Node(roles.PUSH_BUTTON, "other window"),)),
            Node(roles.FRAME, children=(Node(roles.PUSH_BUTTON, "other frame"),)),
        ))
        self.assertFalse(any(role == roles.PUSH_BUTTON
                             for _, role in iter_tray_nodes(other, shell, atspi)))


if __name__ == "__main__":
    unittest.main()
