import importlib.util
import hashlib
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/package-ginfer-host.py'
spec = importlib.util.spec_from_file_location('host_package', SCRIPT)
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class HostPackage(unittest.TestCase):
    def test_catalogs_keep_values_and_reject_cross_platform_or_duplicate_profiles(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'profiles.json'
            profile = {'id': 'measured-c1', 'platform': 'linux', 'max_context': 131072}
            path.write_text(json.dumps({'schema': 'ginfer-launch-profiles-v1', 'profiles': [profile]}))
            result = package.package(Path('/usr/bin/true'), 'linux-x86_64', Path(directory) / 'out', profiles=[path])
            with tarfile.open(result) as archive:
                member = next(m for m in archive.getmembers() if m.name.endswith('/bin/launch-profiles.json'))
                self.assertEqual(json.load(archive.extractfile(member))['profiles'], [profile])
                self.assertEqual(member.mode, 0o644)
            with self.assertRaisesRegex(ValueError, 'platform'):
                package.profile_catalog([path], 'windows-x86_64')
            with self.assertRaisesRegex(ValueError, 'duplicate'):
                package.profile_catalog([path, path], 'linux-x86_64')

    def test_windows_bundle_verifies_runtime_and_excludes_unlisted_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = root / 'runtime'
            (runtime / 'bin').mkdir(parents=True)
            # Minimal PE framing is sufficient for the packager's architecture gate.
            pe = bytearray(70)
            pe[:2] = b'MZ'
            pe[60:64] = (64).to_bytes(4, 'little')
            pe[64:] = b'PE\0\0\x64\x86'
            binary = root / 'ginfer-host.exe'
            binary.write_bytes(pe)
            entries = []
            for name in ('bin/ginfer.exe', 'bin/ginfer-serve.exe'):
                (runtime / name).write_bytes(pe)
                entries.append({'path': name, 'bytes': len(pe),
                                'sha256': hashlib.sha256(pe).hexdigest()})
            (runtime / 'runtime-manifest.json').write_text(json.dumps({
                'schema': 'ginfer-windows-runtime-v1', 'platform': 'windows-x64',
                'files': entries,
            }))
            (runtime / 'private-model.ginfer').write_bytes(b'not part of the runtime')
            output = root / 'output'
            result = package.package(binary, 'windows-x86_64', output, runtime)
            with zipfile.ZipFile(result) as archive:
                names = {name.split('/', 1)[1] for name in archive.namelist()}
                self.assertIn('bin/ginfer-host.exe', names)
                self.assertIn('runtime/bin/ginfer.exe', names)
                self.assertIn('runtime/bin/ginfer-serve.exe', names)
                self.assertIn('runtime/runtime-manifest.json', names)
                self.assertIn('scripts/setup-ginfer-windows.ps1', names)
                self.assertIn('setup.cmd', names)
                self.assertNotIn('runtime/private-model.ginfer', names)
            (runtime / 'bin/ginfer.exe').write_bytes(pe + b'changed')
            with self.assertRaisesRegex(ValueError, 'integrity mismatch'):
                package.package(binary, 'windows-x86_64', root / 'rejected', runtime)
            self.assertFalse((root / 'rejected').exists())

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
