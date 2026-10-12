"""Offline admission regressions for the production updater-manifest filter.

Requires jq. Fixture signatures are sentinels, not cryptographic qualification.
Run: python3 -m unittest discover -s tests -p test_updater_manifest.py
"""

import json
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
FILTER = ROOT / "scripts/updater-manifest.jq"
TEMPLATE = json.loads((ROOT / "src-tauri/latest.json.template").read_text())


class UpdaterManifestTests(unittest.TestCase):
    def generate(self, **overrides):
        values = {
            "version": "0.0.0-fixture",
            "pub_date": "2026-10-10T00:00:00.000Z",
            "win_result": "success",
            "linux_result": "success",
            "win_sig": "fixture-windows-signature",
            "linux_sig": "fixture-linux-signature",
            "exe_name": "GChat fixture-setup.exe",
            "appimage_name": "GChat fixture.AppImage",
        }
        values.update(overrides)
        base = "https://github.com/SectileLabs/gchat/releases/download/v"
        values["win_url"] = base + values["version"] + "/" + values["exe_name"].replace(" ", ".")
        values["linux_url"] = base + values["version"] + "/" + values["appimage_name"].replace(" ", ".")
        command = ["jq"]
        for key, value in values.items():
            command.extend(["--arg", key, value])
        command.extend(["-f", str(FILTER)])
        template = {**TEMPLATE, "notes": "Retain release notes exactly.\nSecond line."}
        result = subprocess.run(command, input=json.dumps(template), text=True, capture_output=True)
        return result, values, template

    def test_valid_supported_platforms_preserve_fields(self):
        for win_result, linux_result, keys in [
            ("success", "skipped", {"windows-x86_64"}),
            ("skipped", "success", {"linux-x86_64"}),
            ("success", "success", {"windows-x86_64", "linux-x86_64"}),
            ("failure", "success", {"linux-x86_64"}),
        ]:
            with self.subTest(windows=win_result, linux=linux_result):
                result, values, template = self.generate(win_result=win_result, linux_result=linux_result)
                self.assertEqual(result.returncode, 0, result.stderr)
                manifest = json.loads(result.stdout)
                expected = {**template, "version": values["version"], "pub_date": values["pub_date"], "platforms": {}}
                for platform, prefix in [("windows-x86_64", "win"), ("linux-x86_64", "linux")]:
                    if platform in keys:
                        expected["platforms"][platform] = {"signature": values[prefix + "_sig"], "url": values[prefix + "_url"]}
                self.assertEqual(manifest, expected)

    def test_successful_platform_rejects_blank_signature_or_asset_name(self):
        for field in ["win_sig", "linux_sig", "exe_name", "appimage_name"]:
            for value in ["", " ", "\t\r\n"]:
                with self.subTest(field=field, value=repr(value)):
                    result, _, _ = self.generate(**{field: value})
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(result.stdout, "")
                    self.assertIn("missing or blank", result.stderr)

    def test_incomplete_skipped_platform_does_not_create_entry(self):
        result, _, _ = self.generate(win_result="skipped", win_sig="", exe_name="")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(set(json.loads(result.stdout)["platforms"]), {"linux-x86_64"})

    def test_incomplete_version_rejected(self):
        for version in ["", " \t\r\n"]:
            with self.subTest(version=repr(version)):
                result, _, _ = self.generate(version=version)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertIn("version is missing or blank", result.stderr)


if __name__ == "__main__":
    unittest.main()
