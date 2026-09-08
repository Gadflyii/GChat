import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/install-ginfer-host-linux.py'
spec = importlib.util.spec_from_file_location('host_installer', SCRIPT)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class HostInstallation(unittest.TestCase):
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
