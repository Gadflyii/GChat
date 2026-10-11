"""Public watcher identity parsing; no D-Bus connection or app launch."""

import unittest

from scripts.ginfer_sni_identity import parse_registered_item


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


if __name__ == "__main__":
    unittest.main()
