"""Opt-in real-GPU menu/host lifecycle check using a physically qualified catalog."""
import json
import os
from pathlib import Path
import select
import shutil
import socket
import ssl
import subprocess
import tempfile
import time
import unittest
import urllib.request


REQUIRED = ('GINFER_CLI', 'GINFER_SERVE', 'GINFER_HOST_BINARY',
            'GINFER_PROFILE_CATALOG', 'GINFER_PROFILE_ARTIFACT')


@unittest.skipUnless(os.name == 'posix' and all(os.environ.get(key) for key in REQUIRED),
                     'requires explicit real engine, host, catalog and artifact paths')
class LiveProfileLifecycle(unittest.TestCase):
    def test_menu_launch_persists_and_host_controls_real_inference(self):
        import pty
        profile_catalog = Path(os.environ['GINFER_PROFILE_CATALOG']).resolve()
        catalog = json.loads(profile_catalog.read_text())
        self.assertEqual(catalog['schema'], 'ginfer-launch-profiles-v1')
        self.assertEqual(len(catalog['profiles']), 1, 'supply one qualified profile for this check')
        profile = catalog['profiles'][0]
        self.assertGreaterEqual(profile['qualification']['free_bytes_per_gpu'], 1 << 30)
        replacement = None
        if os.environ.get('GINFER_PROFILE_REPLACEMENT'):
            other = json.loads(Path(os.environ['GINFER_PROFILE_REPLACEMENT']).read_text())
            self.assertEqual(other['schema'], catalog['schema'])
            self.assertEqual(len(other['profiles']), 1)
            replacement = other['profiles'][0]
            self.assertNotEqual(replacement['id'], profile['id'])
            self.assertGreaterEqual(replacement['qualification']['free_bytes_per_gpu'], 1 << 30)
            catalog['profiles'].append(replacement)
        clients = subprocess.check_output(
            ['nvidia-smi', '--query-compute-apps=pid', '--format=csv,noheader'], text=True)
        self.assertFalse(clients.strip(), 'GPU clients are running; leave them untouched')
        with tempfile.TemporaryDirectory(prefix='ginfer-profile-live-') as directory:
            root = Path(directory)
            state = root / 'state'
            state.mkdir()
            (state / 'launch-profiles.json').write_text(json.dumps(catalog))
            host = root / 'ginfer-host'
            shutil.copy2(os.environ['GINFER_HOST_BINARY'], host)
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0))
                port = reservation.getsockname()[1]
            origin = f'https://127.0.0.1:{port}'
            (root / 'ginfer-launch.json').write_text(json.dumps({
                'data_dir': str(state), 'host_url': origin,
            }))
            with (root / 'host.log').open('w') as log:
                service = subprocess.Popen([str(host), '--data-dir', str(state),
                    '--engine', str(Path(os.environ['GINFER_SERVE']).resolve()),
                    '--models', str(Path(os.environ['GINFER_PROFILE_ARTIFACT']).resolve()),
                    '--listen', f'127.0.0.1:{port}', '--name', 'Real profile integration'],
                    stdout=log, stderr=subprocess.STDOUT)
                terminal = None
                master = None
                try:
                    deadline = time.monotonic() + 30
                    while True:
                        self.assertIsNone(service.poll(), 'host exited before readiness')
                        try:
                            with socket.create_connection(('127.0.0.1', port), timeout=0.2):
                                break
                        except OSError:
                            if time.monotonic() >= deadline:
                                self.fail('host listener did not become ready')
                            time.sleep(0.1)
                    persistent = json.loads((state / 'host.json').read_text())
                    context = ssl.create_default_context(cadata=ssl.DER_cert_to_PEM_cert(
                        bytes(persistent['certificate']['certificate_der'])))
                    context.check_hostname = False

                    def request(path, body=None):
                        headers = {'Authorization': 'Bearer ' + persistent['pairing_admin_token']}
                        data = None if body is None else json.dumps(body).encode()
                        if data is not None:
                            headers['Content-Type'] = 'application/json'
                        req = urllib.request.Request(origin + path, data=data, headers=headers)
                        with urllib.request.urlopen(req, context=context, timeout=600) as response:
                            return json.load(response)

                    def instance_when(status):
                        deadline = time.monotonic() + 600
                        while time.monotonic() < deadline:
                            snapshot = request('/host/v1/snapshot')
                            self.assertEqual(len(snapshot['instances']), 1)
                            instance = snapshot['instances'][0]
                            self.assertNotEqual(instance['status'], 'failed', instance.get('last_error'))
                            if instance['status'] == status:
                                return instance
                            time.sleep(0.5)
                        self.fail(f'instance did not become {status}')

                    master, slave = pty.openpty()
                    env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'],
                               XDG_CONFIG_HOME=str(root / 'config'))
                    terminal = subprocess.Popen([os.environ['GINFER_CLI']], stdin=slave,
                                                stdout=slave, stderr=slave, env=env)
                    os.close(slave)

                    def menu_until(marker, timeout):
                        output = bytearray()
                        deadline = time.monotonic() + timeout
                        while marker not in output and time.monotonic() < deadline:
                            if select.select([master], [], [], 0.2)[0]:
                                output.extend(os.read(master, 65536))
                        self.assertIn(marker, output, output.decode(errors='replace'))
                        return output

                    output = menu_until(b'Select:', 30)
                    self.assertIn(profile['name'].encode(), output)
                    os.write(master, b'1\n')
                    menu_until(b'Select:', 600)
                    os.write(master, b'q\n')
                    self.assertEqual(terminal.wait(timeout=10), 0)
                    self.assertIsNone(service.poll(), 'menu exit stopped the host')
                    instance = instance_when('ready')
                    self.assertEqual(instance['configuration']['max_context'], profile['max_context'])
                    self.assertEqual(instance['configuration']['concurrency'], profile['concurrency'])
                    endpoint = '/host/v1/instances/' + instance['instance_id']
                    response = request(endpoint + '/inference/v1/chat/completions', {
                        'model': instance['configuration']['model_id'],
                        'messages': [{'role': 'user', 'content': 'Reply with a short greeting.'}],
                        'max_tokens': 32, 'stream': False,
                    })
                    self.assertTrue(response['choices'])
                    self.assertGreater(response['usage']['completion_tokens'], 0)
                    self.assertGreater(response['x_ginfer']['computed_prefill_tokens'], 0)
                    self.assertGreater(response['x_ginfer']['prefill_seconds'], 0)
                    self.assertGreaterEqual(response['x_ginfer']['decode_seconds'], 0)
                    old_session = instance['session_id']
                    if replacement is None:
                        request(endpoint + '/restart', {'expected_session_id': old_session, 'force': False})
                    else:
                        request('/host/v1/profile-launch', {
                            'profile_id': replacement['id'],
                            'model_id': instance['profile']['model_id'],
                            'gpu_uuids': instance['configuration']['gpu_uuids'],
                            'instance_id': instance['instance_id'],
                            'expected_session_id': old_session, 'force': False,
                        })
                    restarted = instance_when('ready')
                    self.assertNotEqual(restarted['session_id'], old_session)
                    expected = replacement or profile
                    self.assertEqual(restarted['configuration']['max_context'], expected['max_context'])
                    self.assertEqual(restarted['configuration']['concurrency'], expected['concurrency'])
                    request(endpoint + '/stop', {
                        'expected_session_id': restarted['session_id'], 'force': False})
                    instance_when('stopped')
                    self.assertIsNone(service.poll(), 'stopping inference stopped the host')
                finally:
                    if terminal is not None and terminal.poll() is None:
                        terminal.terminate()
                        terminal.wait(timeout=10)
                    if master is not None:
                        os.close(master)
                    service.terminate()
                    service.wait(timeout=15)


if __name__ == '__main__':
    unittest.main()
