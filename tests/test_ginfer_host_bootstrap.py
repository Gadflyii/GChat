"""Real local host bootstrap/reconnect; synthetic inventory and no inference."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.name == 'posix' and os.environ.get('GINFER_HOST_BINARY'),
                     'requires Linux and a built GINFER_HOST_BINARY')
class LocalHostBootstrap(unittest.TestCase):
    def test_concurrent_bootstraps_reconnect_and_outlive_clients(self):
        with tempfile.TemporaryDirectory(prefix='ginfer-bootstrap-test-') as directory:
            root = Path(directory)
            inventory = root / 'inventory'
            inventory.write_text('#!/bin/sh\nprintf "%s\\n" "$PPID" >> "' +
                                 str(root / 'owners') + '"\n'
                                 'printf "GPU-test, Bootstrap fixture, 32607, 12.0\\n"\n')
            inventory.chmod(0o700)
            with socket.socket() as reserved:
                reserved.bind(('127.0.0.1', 0))
                port = reserved.getsockname()[1]
            command = [os.environ['GINFER_HOST_BINARY'], '--ensure-running',
                       '--data-dir', str(root / 'provider/host'),
                       '--desktop-provider', str(root / 'provider'),
                       '--engine', str(root / 'not-installed/ginfer-serve'),
                       '--nvidia-smi', str(inventory), '--listen', f'127.0.0.1:{port}']
            clients = []
            try:
                clients = [subprocess.Popen(command, stdout=subprocess.PIPE,
                                            stderr=subprocess.PIPE, text=True) for _ in range(2)]
                snapshots = []
                for client in clients:
                    stdout, stderr = client.communicate(timeout=40)
                    self.assertEqual(client.returncode, 0, stderr)
                    snapshots.append(json.loads(stdout))
                self.assertEqual(snapshots[0]['boot_id'], snapshots[1]['boot_id'])
                self.assertEqual(snapshots[0]['gpus'][0]['name'], 'Bootstrap fixture')
                self.assertEqual(snapshots[0]['model_management']['managed_root'],
                                 str(root / 'provider/models'))
                private = json.loads((root / 'provider/host/host.json').read_text())
                self.assertEqual(private['management_origin'], f'https://127.0.0.1:{port}')
                self.assertNotIn(private['pairing_admin_token'], json.dumps(snapshots))
                again = subprocess.run(command, capture_output=True, text=True, timeout=10, check=True)
                self.assertEqual(json.loads(again.stdout)['boot_id'], snapshots[0]['boot_id'])
                owners = (root / 'owners').read_text().splitlines()
                self.assertEqual(len(owners), 1, 'only the exclusive owner may inventory hardware')
            finally:
                for client in clients:
                    if client.poll() is None:
                        client.terminate()
                        client.wait(timeout=5)
                owners = root / 'owners'
                if owners.exists():
                    for pid in set(owners.read_text().splitlines()):
                        try:
                            os.kill(int(pid), signal.SIGTERM)
                        except ProcessLookupError:
                            pass


if __name__ == '__main__':
    unittest.main()
