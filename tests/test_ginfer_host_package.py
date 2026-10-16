import importlib.util
import hashlib
import json
from pathlib import Path
import re
import tarfile
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/package-ginfer-host.py'
spec = importlib.util.spec_from_file_location('host_package', SCRIPT)
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)

runtime_spec = importlib.util.spec_from_file_location(
    'linux_runtime_set', SCRIPT.with_name('stage-linux-runtime-set.py'))
runtime_set = importlib.util.module_from_spec(runtime_spec)
runtime_spec.loader.exec_module(runtime_set)


class LinuxRuntimeSet(unittest.TestCase):
    def test_current_runtime_docs_are_verified_and_staged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'runtime-set'
            source.mkdir()
            commit = 'a' * 40
            (source / 'runtime-set.json').write_text(json.dumps({
                'schema': 'ginfer-linux-runtime-set-v1', 'platform': 'linux-x64',
                'source_commit': commit, 'runtimes': runtime_set.ARCHITECTURES,
            }))
            binary = b'\x7fELF\x02' + b'\0' * 13 + b'\x3e\x00'
            docs = {
                'README.md': '[CLI](docs/cli.md)\n', 'VERSION': '1.0.0.3\n',
                'docs/cli.md': '[Version](../VERSION)\n',
                'docs/serving.md': '[CLI](cli.md)\n',
                'docs/release-names/README.md': '[Serving](../serving.md)\n',
            }
            for name in runtime_set.ARCHITECTURES.values():
                image = source / name
                entries = []
                for path, data in {**{k: v.encode() for k, v in docs.items()},
                                   'bin/ginfer': binary, 'bin/ginfer-serve': binary}.items():
                    member = image / path
                    member.parent.mkdir(parents=True, exist_ok=True)
                    member.write_bytes(data)
                    if path.startswith('bin/'):
                        member.chmod(0o755)
                    entries.append({'path': path, 'bytes': len(data),
                                    'sha256': hashlib.sha256(data).hexdigest()})
                (image / 'runtime-manifest.json').write_text(json.dumps({
                    'schema': 'ginfer-linux-runtime-v1', 'platform': 'linux-x64',
                    'source_commit': commit, 'source_dirty': False,
                    'cuda_architecture': name.replace('sm', 'sm_'),
                    'build_glibc': 'glibc 2.39', 'files': entries,
                }))
            self.assertEqual(runtime_set.verify(source)['source_commit'], commit)
            destination = root / 'docs'
            runtime_set.stage_operator_docs(source / 'sm120a', destination)
            self.assertEqual({p.relative_to(destination).as_posix()
                              for p in destination.rglob('*') if p.is_file()}, set(docs))
            for path, content in docs.items():
                self.assertEqual((destination / path).read_text(), content)
            manifest_path = source / 'sm86/runtime-manifest.json'
            original = json.loads(manifest_path.read_text())
            missing = {**original, 'files': [e for e in original['files'] if e['path'] != 'VERSION']}
            manifest_path.write_text(json.dumps(missing))
            with self.assertRaisesRegex(ValueError, 'missing its five'):
                runtime_set.verify(source)
            manifest_path.write_text(json.dumps(original))
            (source / 'sm86/VERSION').write_text('different\n')
            with self.assertRaisesRegex(ValueError, 'integrity mismatch'):
                runtime_set.verify(source)
            version = next(e for e in original['files'] if e['path'] == 'VERSION')
            version.update(bytes=10, sha256=hashlib.sha256(b'different\n').hexdigest())
            manifest_path.write_text(json.dumps(original))
            with self.assertRaisesRegex(ValueError, 'differs between runtime images'):
                runtime_set.verify(source)


class HostPackage(unittest.TestCase):
    def test_linux_bundle_keeps_manifest_docs_and_rejects_other_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = root / 'runtime'
            files = []
            docs = ('README.md', 'VERSION', 'docs/cli.md', 'docs/serving.md',
                    'docs/release-names/README.md',
                    'licenses/llguidance-crates/ahash/LICENSE-APACHE',
                    'licenses/ubuntu-packages/libcurl4t64/copyright')
            for name in ('bin/ginfer', 'bin/ginfer-serve', *docs):
                member = runtime / name
                member.parent.mkdir(parents=True, exist_ok=True)
                if name.startswith('bin/'):
                    member.write_bytes(Path('/usr/bin/true').read_bytes())
                else:
                    member.write_text(f'Operator documentation: {name}\n')
                files.append({'path': name, 'bytes': member.stat().st_size,
                              'sha256': hashlib.sha256(member.read_bytes()).hexdigest()})
            manifest = {'schema': 'ginfer-linux-runtime-v1', 'platform': 'linux-x64',
                        'files': files}
            manifest_path = runtime / 'runtime-manifest.json'
            manifest_path.write_text(json.dumps(manifest))
            result = package.package(Path('/usr/bin/true'), 'linux-x86_64', root / 'out', runtime)
            with tarfile.open(result) as archive:
                members = {m.name.split('/', 1)[1]: m for m in archive.getmembers()}
                for name in docs:
                    member = members[f'runtime/{name}']
                    self.assertEqual(archive.extractfile(member).read(), (runtime / name).read_bytes())
                    self.assertEqual(member.mode, 0o644)
            for forbidden in ('docs/private.md', '../README.md', 'licenses/../README.md'):
                manifest['files'] = files + [{'path': forbidden, 'bytes': 0, 'sha256': ''}]
                manifest_path.write_text(json.dumps(manifest))
                with self.assertRaisesRegex(ValueError, 'runtime member'):
                    package.runtime_entries(runtime, 'linux-x86_64')

    def test_catalogs_keep_values_and_reject_cross_platform_or_duplicate_profiles(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'profiles.json'
            profile = {'id': 'screened-c8', 'platform': 'linux', 'max_context': 131072,
                       'concurrency': 8, 'qualification': {'tier': 'screened-startup',
                       'full_context_requests': 0, 'smoke_requests': 8,
                       'free_bytes_per_gpu': 18581880832}}
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
            licenses = {
                'licenses/llguidance.txt': b'Original flat license\n',
                'licenses/llguidance-crates/syn-2.0.119/LICENSE-APACHE': b'Apache license\n',
                'licenses/llguidance-crates/syn-2.0.119/LICENSE-MIT': b'MIT license\n',
                'licenses/llguidance-crates/memchr/COPYING': b'Copying terms\n',
                'licenses/llguidance-crates/memchr/UNLICENSE': b'Public domain terms\n',
            }
            for name, data in {**dict.fromkeys(('bin/ginfer.exe', 'bin/ginfer-serve.exe'),
                                             bytes(pe)), **licenses}.items():
                member = runtime / name
                member.parent.mkdir(parents=True, exist_ok=True)
                member.write_bytes(data)
                entries.append({'path': name, 'bytes': len(data),
                                'sha256': hashlib.sha256(data).hexdigest()})
            manifest = {
                'schema': 'ginfer-windows-runtime-v1', 'platform': 'windows-x64',
                'files': entries,
            }
            manifest_path = runtime / 'runtime-manifest.json'
            manifest_path.write_text(json.dumps(manifest))
            (runtime / 'private-model.ginfer').write_bytes(b'not part of the runtime')
            output = root / 'output'
            result = package.package(binary, 'windows-x86_64', output, runtime)
            with zipfile.ZipFile(result) as archive:
                prefix = archive.namelist()[0].split('/', 1)[0] + '/'
                names = {name.split('/', 1)[1] for name in archive.namelist()}
                self.assertIn('bin/ginfer-host.exe', names)
                self.assertIn('runtime/bin/ginfer.exe', names)
                self.assertIn('runtime/bin/ginfer-serve.exe', names)
                self.assertIn('runtime/runtime-manifest.json', names)
                self.assertIn('scripts/setup-ginfer-windows.ps1', names)
                self.assertIn('setup.cmd', names)
                self.assertNotIn('runtime/private-model.ginfer', names)
                for name, content in licenses.items():
                    self.assertEqual(archive.read(f'{prefix}runtime/{name}'), content)
                self.assertEqual(json.loads(archive.read(
                    f'{prefix}runtime/runtime-manifest.json')), manifest)
                consumer = archive.read(
                    f'{prefix}scripts/setup-ginfer-windows.ps1').decode('utf-8-sig')
                match = re.search(r"\$name\s+-notmatch\s+'([^']+)'", consumer)
                self.assertIsNotNone(match, 'Bundled installer must validate runtime paths')
                pattern = match.group(1)
                # Check the actual consumer regex on ASCII paths, not PowerShell execution.
                # Python 3.11 spells .NET's strict terminal \\z anchor \\Z.
                compatible = pattern[:-2] + r'\Z' if pattern.endswith(r'\z') else pattern
                allowed = re.compile(compatible, re.IGNORECASE | re.ASCII)
                for entry in entries:
                    with self.subTest(accepted=entry['path']):
                        self.assertIsNotNone(allowed.search(entry['path']))
                for forbidden in (
                    '', '/licenses/vendor/LICENSE', 'C:/licenses/vendor/LICENSE',
                    'licenses\\vendor\\LICENSE', 'licenses', 'licenses/',
                    'licenses//LICENSE', 'licenses/./LICENSE', 'licenses/../LICENSE',
                    'licenses/vendor/../LICENSE', 'licenses/vendor//LICENSE',
                    'licenses/vendor./LICENSE', 'licenses/vendor/LICENSE.',
                    'licenses/vendor/LICENSE/', 'licenses/vendor/LICENSE\n',
                    'README.md\n',
                ):
                    with self.subTest(rejected=forbidden):
                        self.assertIsNone(allowed.search(forbidden))
            for forbidden in ('../README.md', 'licenses/../README.md',
                              'licenses\\vendor\\LICENSE', '/licenses/vendor/LICENSE',
                              entries[-1]['path']):
                manifest['files'] = entries + [{'path': forbidden, 'bytes': 0, 'sha256': ''}]
                manifest_path.write_text(json.dumps(manifest))
                with self.subTest(generator_rejected=forbidden):
                    with self.assertRaisesRegex(ValueError, 'runtime member'):
                        package.runtime_entries(runtime, 'windows-x86_64')
            manifest['files'] = entries
            manifest_path.write_text(json.dumps(manifest))
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
