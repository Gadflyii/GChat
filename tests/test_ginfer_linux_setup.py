import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/setup-ginfer-linux.py'
spec = importlib.util.spec_from_file_location('linux_setup', SCRIPT)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class LinuxSetup(unittest.TestCase):
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
            (bundle / 'runtime/runtime-manifest.json').write_text(json.dumps({
                'schema': 'ginfer-linux-runtime-v1', 'platform': 'linux-x64', 'files': files}))
            target, provider, config, links = [root / name for name in ('install', 'provider', 'config', 'links')]
            setup.install(bundle, target, provider, config, links)
            self.assertFalse(target.exists())
            setup.install(bundle, target, provider, config, links, True)
            self.assertEqual((links / 'ginfer').resolve(), target / 'bin/ginfer')
            launch = json.loads((target / 'bin/ginfer-launch.json').read_text())
            self.assertEqual(launch['desktop']['provider'], str(provider))
            self.assertFalse(provider.exists())
            self.assertEqual((target / 'bin/launch-profiles.json').read_text(), catalog)
            with self.assertRaisesRegex(ValueError, 'already exists'):
                setup.install(bundle, target, provider, config, links, True)
            locator = config / 'ginfer/local-host.json'
            locator.parent.mkdir(parents=True)
            record = {'schema': 'ginfer-local-host-v1', 'owner': {'mode': 'service',
                      'directory': str(root / 'existing'), 'origin': 'https://127.0.0.1:7443'}}
            locator.write_text(json.dumps(record))
            second = root / 'second'
            setup.install(bundle, second, provider, config, root / 'second-links', True)
            self.assertFalse((second / 'bin/ginfer-launch.json').exists())
            self.assertEqual(json.loads(locator.read_text()), record)
            (bundle / 'runtime/bin/ginfer').write_bytes(b'corrupted')
            with self.assertRaisesRegex(ValueError, 'integrity mismatch'):
                setup.install(bundle, root / 'bad', provider, config, root / 'bad-links', True)
            self.assertFalse((root / 'bad').exists())


if __name__ == '__main__':
    unittest.main()
