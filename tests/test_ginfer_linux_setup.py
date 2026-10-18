import hashlib
import importlib.util
import json
from pathlib import Path
import runpy
import shutil
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/setup-ginfer-linux.py'
spec = importlib.util.spec_from_file_location('linux_setup', SCRIPT)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class LinuxSetup(unittest.TestCase):
    def driver_bundle(self, root):
        bundle = root / 'bundle'
        files = []
        for name in ('runtime/bin/ginfer', 'runtime/bin/ginfer-serve', 'bin/ginfer-host'):
            member = bundle / name
            member.parent.mkdir(parents=True, exist_ok=True)
            member.write_bytes(b'fixture payload; never executed')
            if name.startswith('runtime/'):
                files.append({'path': name.removeprefix('runtime/'), 'bytes': member.stat().st_size,
                              'sha256': hashlib.sha256(member.read_bytes()).hexdigest()})
        (bundle / 'runtime/runtime-manifest.json').write_text(json.dumps({
            'schema': 'ginfer-linux-runtime-v1', 'platform': 'linux-x64', 'files': files,
            'cuda_toolkit': '13.3',
            'system_dependencies': ['libc.so.6', 'libcuda.so.1', 'libnvidia-ml.so.1']}))
        shutil.copy2(SCRIPT, bundle / 'setup.py')
        return bundle

    def test_missing_driver_cli_preserves_installation_and_existing_registration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = self.driver_bundle(root)
            target, provider, config, links = [root / name for name in ('install', 'provider', 'config', 'links')]
            locator = config / 'ginfer/local-host.json'
            locator.parent.mkdir(parents=True)
            record = b'{"schema":"ginfer-local-host-v1","owner":{"mode":"service"}}'
            locator.write_bytes(record)
            for missing in ('libcuda.so.1', 'libnvidia-ml.so.1'):
                with self.subTest(library=missing):
                    def load(library):
                        if library == missing:
                            raise OSError('cannot open shared object file')
                        return mock.Mock()

                    with mock.patch.object(setup.ctypes, 'CDLL', side_effect=load) as library, \
                            mock.patch.object(setup.subprocess, 'run') as run, \
                            mock.patch.dict(setup.os.environ, {'XDG_CONFIG_HOME': str(config)}), \
                            mock.patch.object(setup.sys, 'argv', [str(bundle / 'setup.py'), '--install',
                                '--no-wizard', '--install-directory', str(target),
                                '--provider-directory', str(provider), '--link-directory', str(links)]):
                        with self.assertRaises(SystemExit) as stopped:
                            runpy.run_path(str(bundle / 'setup.py'), run_name='__main__')
                    message = str(stopped.exception)
                    for expected in ('Error:', missing, 'system NVIDIA driver', 'CUDA 13.3',
                                     'nvidia-smi', 'NVIDIA Container Toolkit', 'No installation files were written'):
                        self.assertIn(expected, message)
                    run.assert_not_called()
                    self.assertEqual(library.call_args.args, (missing,))
                    self.assertFalse(target.exists())
                    self.assertFalse(provider.exists())
                    self.assertFalse(links.exists())
                    self.assertEqual(locator.read_bytes(), record)
                    self.assertEqual(set(config.rglob('*')), {locator.parent, locator})

    def test_declared_driver_libraries_allow_normal_host_handoff(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = self.driver_bundle(root)
            with mock.patch.object(setup.ctypes, 'CDLL') as library, \
                    mock.patch.object(setup.subprocess, 'run', return_value=mock.Mock(
                        stdout='{"status":"running","gpu_uuids":[]}')) as run:
                setup.install(bundle, root / 'install', root / 'provider', root / 'config', root / 'links', True)
            self.assertEqual(library.call_args_list, [mock.call('libcuda.so.1'), mock.call('libnvidia-ml.so.1')])
            self.assertEqual(run.call_count, 1)
            self.assertTrue((root / 'install/bin/ginfer').is_file())
            self.assertEqual((root / 'links/ginfer').resolve(), root / 'install/bin/ginfer')

    def test_preview_and_corrupt_payload_do_not_load_driver_libraries(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = self.driver_bundle(root)
            paths = [root / name for name in ('install', 'provider', 'config', 'links')]
            with mock.patch.object(setup.ctypes, 'CDLL') as library, \
                    mock.patch.object(setup.subprocess, 'run') as run:
                setup.install(bundle, *paths)
                (bundle / 'runtime/bin/ginfer').write_bytes(b'corrupted')
                with self.assertRaisesRegex(ValueError, 'integrity mismatch'):
                    setup.install(bundle, *paths, apply=True)
            library.assert_not_called()
            run.assert_not_called()
            for path in paths:
                self.assertFalse(path.exists())

    def test_install_reuses_storage_and_rejects_corruption_and_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = root / 'bundle'
            (bundle / 'runtime/bin').mkdir(parents=True)
            (bundle / 'bin').mkdir()
            shutil.copy2('/usr/bin/true', bundle / 'bin/ginfer-host')
            catalog = '{"schema":"ginfer-launch-profiles-v1","profiles":[]}'
            (bundle / 'bin/launch-profiles.json').write_text(catalog)
            files = []
            for name in ('bin/ginfer', 'bin/ginfer-serve'):
                target = bundle / 'runtime' / name
                shutil.copy2('/usr/bin/true', target)
                files.append({'path': name, 'bytes': target.stat().st_size,
                              'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
            docs = ('README.md', 'VERSION', 'docs/cli.md', 'docs/serving.md',
                    'docs/release-names/README.md')
            documents = (*docs, 'licenses/llguidance-crates/ahash/LICENSE-APACHE',
                         'licenses/ubuntu-packages/libcurl4t64/copyright')
            for name in documents:
                member = bundle / 'runtime' / name
                member.parent.mkdir(parents=True, exist_ok=True)
                member.write_text(f'Bundled operator documentation: {name}\n')
                files.append({'path': name, 'bytes': member.stat().st_size,
                              'sha256': hashlib.sha256(member.read_bytes()).hexdigest()})
            (bundle / 'runtime/runtime-manifest.json').write_text(json.dumps({
                'schema': 'ginfer-linux-runtime-v1', 'platform': 'linux-x64', 'files': files}))
            target, provider, config, links = [root / name for name in ('install', 'provider', 'config', 'links')]
            ambient_environment = setup.os.environ.copy()
            child_environment = {**ambient_environment, 'XDG_CONFIG_HOME': str(config)}
            handoff = mock.Mock(stdout='{"status":"running"}')
            with mock.patch.object(setup.subprocess, 'run', return_value=handoff) as run:
                setup.install(bundle, target, provider, config, links)
                run.assert_not_called()
            self.assertFalse(target.exists())
            with mock.patch.object(setup.subprocess, 'run', side_effect=[
                    handoff, mock.Mock(stdout='{"step":"gpu","gpu_uuids":[]}'),
                    mock.Mock(stdout='{"step":"profiling","gpu_uuids":["GPU-second","GPU-first"]}')]) as run:
                setup.install(bundle, target, provider, config, links, True, ('GPU-second', 'GPU-first'))
                run.assert_has_calls([mock.call([
                    str(target / 'bin/ginfer-host'), 'prepare-hardware', '--engine',
                    str(target / 'bin/ginfer'), '--installed-configuration',
                    str(target / 'bin/ginfer-launch.json'), '--gpu', 'GPU-second', '--gpu', 'GPU-first'],
                    check=True, capture_output=True, text=True, env=child_environment),
                    mock.call([str(target / 'bin/ginfer-host'), 'first-run'],
                              check=True, capture_output=True, text=True, env=child_environment),
                    mock.call([str(target / 'bin/ginfer-host'), 'first-run', '--action', 'profile',
                               '--gpu', 'GPU-second', '--gpu', 'GPU-first'],
                              check=True, capture_output=True, text=True, env=child_environment)])
                self.assertEqual(run.call_count, 3)
            self.assertEqual(dict(setup.os.environ), ambient_environment)
            self.assertEqual((links / 'ginfer').resolve(), target / 'bin/ginfer')
            launch = json.loads((target / 'bin/ginfer-launch.json').read_text())
            self.assertEqual(launch['desktop']['provider'], str(provider))
            self.assertIs(launch['desktop']['runtime_set'], False)
            self.assertFalse(provider.exists())
            self.assertEqual((target / 'bin/launch-profiles.json').read_text(), catalog)
            for name in documents:
                self.assertEqual((target / name).read_bytes(), (bundle / 'runtime' / name).read_bytes())
                self.assertEqual((target / name).stat().st_mode & 0o777, 0o644)
            with self.assertRaisesRegex(ValueError, 'already exists'):
                setup.install(bundle, target, provider, config, links, True)
            locator = config / 'ginfer/local-host.json'
            locator.parent.mkdir(parents=True)
            record = {'schema': 'ginfer-local-host-v1', 'owner': {'mode': 'service',
                      'directory': str(root / 'existing'), 'origin': 'https://127.0.0.1:7443'}}
            locator.write_text(json.dumps(record))
            second = root / 'second'
            with mock.patch.object(setup.subprocess, 'run', return_value=handoff) as run:
                setup.install(bundle, second, provider, config, root / 'second-links', True)
                run.assert_called_once_with([
                    str(second / 'bin/ginfer-host'), 'prepare-hardware', '--engine',
                    str(second / 'bin/ginfer'), '--data-dir', str(provider / 'host'),
                    '--desktop-provider', str(provider)], check=True, capture_output=True, text=True,
                    env=child_environment)
            self.assertFalse((second / 'bin/ginfer-launch.json').exists())
            self.assertEqual(json.loads(locator.read_text()), record)
            resumed = root / 'resumed'
            with mock.patch.object(setup.subprocess, 'run', side_effect=[
                    handoff, mock.Mock(stdout='{"step":"profiling","gpu_uuids":["GPU-second","GPU-first"]}')]) as run:
                setup.install(bundle, resumed, provider, config, root / 'resumed-links', True,
                              ('GPU-second', 'GPU-first'))
                self.assertEqual(run.call_count, 2)
                run.assert_called_with([str(resumed / 'bin/ginfer-host'), 'first-run'],
                                       check=True, capture_output=True, text=True, env=child_environment)
            completed = root / 'completed'
            with mock.patch.object(setup.subprocess, 'run', side_effect=[
                    handoff, mock.Mock(stdout='{"step":"complete","gpu_uuids":["GPU-first"]}')]) as run:
                setup.install(bundle, completed, provider, config, root / 'completed-links', True,
                              ('GPU-second', 'GPU-first'))
                self.assertEqual(run.call_count, 2)
                run.assert_called_with([str(completed / 'bin/ginfer-host'), 'first-run'],
                                       check=True, capture_output=True, text=True, env=child_environment)
            interactive = root / 'interactive'
            with mock.patch.object(setup.subprocess, 'run', return_value=handoff) as run:
                setup.install(bundle, interactive, provider, config, root / 'interactive-links', True, interactive=True)
                self.assertEqual(run.call_count, 2)
                self.assertEqual(run.call_args_list[0].args[0][1], 'prepare-hardware')
                run.assert_called_with([str(interactive / 'bin/ginfer-host'), 'first-run', '--interactive'],
                                       check=True, env=child_environment)
            interrupted = root / 'handoff-failed'
            with mock.patch.object(setup.subprocess, 'run', side_effect=setup.subprocess.CalledProcessError(1, 'fixture')):
                with self.assertRaises(setup.subprocess.CalledProcessError):
                    setup.install(bundle, interrupted, provider, config, root / 'failed-links', True)
            self.assertTrue((interrupted / 'bin/ginfer').is_file())
            self.assertEqual(json.loads(locator.read_text()), record)
            manifest = bundle / 'runtime/runtime-manifest.json'
            valid_manifest = manifest.read_text()
            invalid_manifest = json.loads(valid_manifest)
            invalid_manifest['files'].insert(0, {
                'path': 'licenses/../README.md', 'bytes': 0, 'sha256': '0' * 64})
            manifest.write_text(json.dumps(invalid_manifest))
            with mock.patch.object(setup.subprocess, 'run') as run:
                with self.assertRaisesRegex(ValueError, 'unexpected or duplicate runtime member'):
                    setup.install(bundle, root / 'traversal', provider, config,
                                  root / 'traversal-links', True)
                run.assert_not_called()
            self.assertFalse((root / 'traversal').exists())
            manifest.write_text(valid_manifest)
            (bundle / 'runtime/bin/ginfer').write_bytes(b'corrupted')
            with mock.patch.object(setup.subprocess, 'run') as run:
                with self.assertRaisesRegex(ValueError, 'integrity mismatch'):
                    setup.install(bundle, root / 'bad', provider, config, root / 'bad-links', True)
                run.assert_not_called()
            self.assertFalse((root / 'bad').exists())


if __name__ == '__main__':
    unittest.main()
