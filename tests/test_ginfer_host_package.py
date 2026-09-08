import importlib.util
from pathlib import Path
import tarfile
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/package-ginfer-host.py'
spec = importlib.util.spec_from_file_location('host_package', SCRIPT)
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class HostPackage(unittest.TestCase):
    @unittest.skipUnless(Path('/usr/bin/true').exists(), 'Linux executable fixture required')
    def test_archive_contains_only_binary_installer_guide_and_license(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            path = package.package(Path('/usr/bin/true'), 'linux-x86_64', output)
            with tarfile.open(path) as archive:
                names = [name.split('/', 1)[1] for name in archive.getnames()]
                self.assertEqual(set(names), {'bin/ginfer-host', 'scripts/install-ginfer-host-linux.py', 'README.md', 'LICENSE'})
                binary = next(m for m in archive.getmembers() if m.name.endswith('/bin/ginfer-host'))
                self.assertEqual(binary.mode, 0o755)
                self.assertEqual(archive.extractfile(binary).read(), Path('/usr/bin/true').read_bytes())
            with self.assertRaises(FileExistsError):
                package.package(Path('/usr/bin/true'), 'linux-x86_64', output)
            with self.assertRaises(ValueError):
                package.package(Path('/usr/bin/true'), 'windows-x86_64', output)


if __name__ == '__main__':
    unittest.main()
