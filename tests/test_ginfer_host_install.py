import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/install-ginfer-host-linux.py'
spec = importlib.util.spec_from_file_location('host_installer', SCRIPT)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class HostInstallation(unittest.TestCase):
    def test_install_starts_by_default_and_supports_staging(self):
        for no_start in (False, True):
            with self.subTest(no_start=no_start), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                arguments = [str(SCRIPT), '--binary', '/usr/bin/true',
                    '--engine', '/usr/bin/true', '--prefix', str(root / 'install'),
                    '--data-dir', str(root / 'state'), '--install']
                if no_start:
                    arguments.append('--no-start')
                with mock.patch('sys.argv', arguments), \
                     mock.patch.dict('os.environ', {'XDG_CONFIG_HOME': str(root / 'config')}), \
                     mock.patch.object(installer.shutil, 'which', return_value='/usr/bin/true'), \
                     mock.patch.object(installer.subprocess, 'run') as run:
                    installer.main()
                commands = [call.args[0] for call in run.call_args_list]
                expected = ['systemctl', '--user', 'enable']
                if not no_start:
                    expected.append('--now')
                self.assertIn([*expected, 'ginfer-host.service'], commands)
                active = ['systemctl', '--user', 'is-active', '--quiet', 'ginfer-host.service']
                self.assertEqual(active in commands, not no_start)
                self.assertTrue((root / 'install/ginfer-launch.json').is_file())

    def test_empty_host_preview_can_use_managed_download_storage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = subprocess.run(['python3', str(SCRIPT), '--binary', '/usr/bin/true',
                '--engine', '/usr/bin/true', '--prefix', str(root / 'install'),
                '--data-dir', str(root / 'state')], capture_output=True, text=True, check=True)
            self.assertIn('Preview only', result.stdout)
            self.assertNotIn('--models', result.stdout)
            self.assertIn('ginfer-launch.json', result.stdout)
            self.assertIn('"host_url": "https://127.0.0.1:7443"', result.stdout)
            self.assertFalse((root / 'state').exists())

    def test_preview_does_not_install_or_start(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = subprocess.run(['python3', str(SCRIPT), '--binary', '/usr/bin/true',
                '--engine', '/usr/bin/true', '--prefix', str(root / 'install'),
                '--data-dir', str(root / 'state'), '--models', str(root), '--share-lan'],
                capture_output=True, text=True, check=True)
            self.assertIn('Preview only', result.stdout)
            self.assertFalse((root / 'install').exists())
            self.assertFalse((root / 'state').exists())

    @unittest.skipUnless(shutil.which('systemd-analyze'), 'systemd-analyze unavailable')
    def test_systemd_accepts_rendered_service_with_literal_special_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            unit = Path(directory) / 'ginfer-host.service'
            text = installer.unit_text('/usr/bin/true', '/engine path/ginfer-serve', '/state path',
                ['/model path'], 'Lab %host $NAME "quoted"', True)
            unit.write_text(text)
            subprocess.run(['systemd-analyze', '--user', 'verify', str(unit)], check=True, capture_output=True)
            self.assertIn('%%host', text)
            self.assertIn('ExecStart=:', text)


if __name__ == '__main__':
    unittest.main()
