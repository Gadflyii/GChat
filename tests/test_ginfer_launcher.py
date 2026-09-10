"""Native no-argument launcher smoke test; synthetic GPU inventory, no inference."""
import json
import os
from pathlib import Path
import select
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import unittest


@unittest.skipUnless(os.name == 'posix' and os.environ.get('GINFER_CLI') and os.environ.get('GINFER_HOST_BINARY'),
                     'requires Linux and explicit GINFER_CLI / GINFER_HOST_BINARY build paths')
class NativeLauncher(unittest.TestCase):
    def test_desktop_menu_bootstraps_without_an_installed_engine(self):
        import pty
        with tempfile.TemporaryDirectory(prefix='ginfer-desktop-launcher-test-') as directory:
            root = Path(directory)
            host = root / 'ginfer-host'
            shutil.copy2(os.environ['GINFER_HOST_BINARY'], host)
            inventory = root / 'nvidia-smi'
            inventory.write_text('#!/bin/sh\nprintf "%s\\n" "$PPID" > "' +
                                 str(root / 'owner') + '"\n'
                                 'printf "GPU-fixture, Desktop launcher GPU, 32607, 12.0\\n"\n')
            inventory.chmod(0o700)
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0))
                port = reservation.getsockname()[1]
            (root / 'ginfer-launch.json').write_text(json.dumps({
                'data_dir': str(root / 'provider/host'),
                'host_url': f'https://127.0.0.1:{port}',
                'desktop': {'provider': str(root / 'provider'),
                            'engine': str(root / 'not-installed/ginfer-serve')},
            }))
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'],
                       XDG_CONFIG_HOME=str(root / 'config'))
            automated = subprocess.run([str(host), '--menu'], stdin=subprocess.DEVNULL,
                                       capture_output=True, text=True, env=env, timeout=5)
            self.assertNotEqual(automated.returncode, 0)
            self.assertIn('interactive terminal', automated.stderr)
            self.assertFalse((root / 'owner').exists())
            master, slave = pty.openpty()
            terminal = subprocess.Popen([os.environ['GINFER_CLI']], stdin=slave,
                                        stdout=slave, stderr=slave, env=env)
            os.close(slave)
            try:
                output = bytearray()
                deadline = time.monotonic() + 15
                while b'Select:' not in output and time.monotonic() < deadline:
                    if select.select([master], [], [], 0.2)[0]:
                        try:
                            output.extend(os.read(master, 65536))
                        except OSError:
                            break
                self.assertIn(b'Select:', output, output.decode(errors='replace'))
                self.assertIn(b'Desktop launcher GPU', output)
                os.write(master, b'q\n')
                self.assertEqual(terminal.wait(timeout=5), 0)
                os.kill(int((root / 'owner').read_text()), 0)
                with socket.create_connection(('127.0.0.1', port), timeout=1):
                    pass
                self.assertTrue((root / 'provider/models').is_dir())
                locator = json.loads((root / 'config/ginfer/local-host.json').read_text())
                self.assertEqual(locator['owner']['directory'], str(root / 'provider/host'))
                # A second installation without sibling configuration adopts the owner.
                second = root / 'second-install'
                second.mkdir()
                shutil.copy2(host, second / 'ginfer-host')
                os.close(master)
                master, slave = pty.openpty()
                terminal = subprocess.Popen([str(second / 'ginfer-host'), '--menu'],
                    stdin=slave, stdout=slave, stderr=slave, env=env)
                os.close(slave)
                output = bytearray()
                deadline = time.monotonic() + 15
                while b'Select:' not in output and time.monotonic() < deadline:
                    if select.select([master], [], [], 0.2)[0]:
                        try:
                            output.extend(os.read(master, 65536))
                        except OSError:
                            break
                self.assertIn(b'Desktop launcher GPU', output, output.decode(errors='replace'))
                os.write(master, b'q\n')
                self.assertEqual(terminal.wait(timeout=5), 0)
                self.assertEqual(json.loads((root / 'config/ginfer/local-host.json').read_text()), locator)
            finally:
                if terminal.poll() is None:
                    terminal.terminate()
                    terminal.wait(timeout=5)
                os.close(master)
                if (root / 'owner').exists():
                    try:
                        os.kill(int((root / 'owner').read_text()), signal.SIGTERM)
                    except ProcessLookupError:
                        pass

    def test_no_argument_menu_uses_persistent_host_and_quit_leaves_it_running(self):
        import pty
        with tempfile.TemporaryDirectory(prefix='ginfer-launcher-test-') as directory:
            root = Path(directory)
            host = root / 'ginfer-host'
            shutil.copy2(os.environ['GINFER_HOST_BINARY'], host)
            inventory = root / 'fixture-nvidia-smi'
            inventory.write_text('#!/bin/sh\nprintf "GPU-fixture, Synthetic launcher GPU, 32607, 12.0\\n"\n')
            inventory.chmod(0o700)
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0))
                port = reservation.getsockname()[1]
            (root / 'ginfer-launch.json').write_text(json.dumps({
                'data_dir': str(root / 'state'), 'host_url': f'https://127.0.0.1:{port}',
            }))
            service = subprocess.Popen([str(host), '--data-dir', str(root / 'state'),
                '--engine', shutil.which('true'), '--nvidia-smi', str(inventory),
                '--listen', f'127.0.0.1:{port}', '--name', 'Launcher smoke test'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            terminal = None
            master = None
            try:
                deadline = time.monotonic() + 15
                while True:
                    self.assertIsNone(service.poll(), 'temporary host exited before readiness')
                    try:
                        with socket.create_connection(('127.0.0.1', port), timeout=0.2):
                            break
                    except OSError:
                        if time.monotonic() >= deadline:
                            self.fail('temporary host did not open its listener')
                        time.sleep(0.05)
                master, slave = pty.openpty()
                env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'],
                           XDG_CONFIG_HOME=str(root / 'config'))
                terminal = subprocess.Popen([os.environ['GINFER_CLI']], stdin=slave, stdout=slave, stderr=slave, env=env)
                os.close(slave)
                output = bytearray()
                deadline = time.monotonic() + 15
                while b'Select:' not in output and time.monotonic() < deadline:
                    if select.select([master], [], [], 0.2)[0]:
                        try:
                            output.extend(os.read(master, 65536))
                        except OSError:
                            break
                self.assertIn(b'Select:', output, output.decode(errors='replace'))
                self.assertIn(b'Synthetic launcher GPU', output)
                self.assertIn(b'No qualified profiles', output)
                os.write(master, b'q\n')
                self.assertEqual(terminal.wait(timeout=5), 0)
                self.assertIsNone(service.poll(), 'quitting the menu must not stop the service')
                duplicate = subprocess.run([str(host), '--data-dir', str(root / 'state'),
                    '--engine', shutil.which('true'), '--nvidia-smi', str(inventory),
                    '--listen', '127.0.0.1:0'], capture_output=True, text=True, timeout=5)
                self.assertNotEqual(duplicate.returncode, 0)
                self.assertIn('exclusive host ownership', duplicate.stderr)
                self.assertIsNone(service.poll(), 'duplicate startup must not disturb the owner')
            finally:
                if terminal is not None and terminal.poll() is None:
                    terminal.terminate()
                    terminal.wait(timeout=5)
                if master is not None:
                    os.close(master)
                service.terminate()
                service.wait(timeout=10)


if __name__ == '__main__':
    unittest.main()
