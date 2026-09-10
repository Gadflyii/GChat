#!/usr/bin/env python3
"""Preview or install a per-user GInfer host service. Never modifies the engine."""
import argparse
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import tempfile


def quoted(value):
    value = str(value)
    if any(ord(c) < 32 for c in value):
        raise ValueError('service arguments cannot contain control characters')
    # systemd specifiers expand even in quotes. ExecStart's ':' disables env expansion.
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'


def unit_text(binary, engine, data, models, name, share_lan, artifact_sets=(), nvidia_smi='nvidia-smi'):
    arguments = [binary, '--data-dir', data, '--engine', engine, '--name', name, '--nvidia-smi', nvidia_smi]
    for model in models:
        arguments.extend(['--models', model])
    for descriptor in artifact_sets:
        arguments.extend(['--artifact-set', descriptor])
    if share_lan:
        arguments.extend(['--listen', '0.0.0.0:7443', '--discoverable'])
    return '\n'.join([
        '[Unit]', 'Description=GInfer LAN host', '', '[Service]', 'Type=exec',
        'ExecStart=:' + ' '.join(map(quoted, arguments)),
        'UMask=0077', 'Restart=on-failure', 'RestartSec=5',
        'TimeoutStopSec=45', 'KillMode=mixed', '', '[Install]', 'WantedBy=default.target', '',
    ])


def atomic_write(destination, content, mode):
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
            os.chmod(temporary, mode)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True, help='built ginfer-host executable')
    parser.add_argument('--engine', type=Path, required=True, help='explicit ginfer-serve executable; not copied or changed')
    parser.add_argument('--prefix', type=Path, required=True, help='directory for the installed host executable')
    parser.add_argument('--data-dir', type=Path, required=True, help='dedicated private host state directory')
    parser.add_argument('--models', type=Path, action='append', default=[])
    parser.add_argument('--artifact-set', type=Path, action='append', default=[])
    parser.add_argument('--name', default='GInfer host')
    parser.add_argument('--share-lan', action='store_true', help='bind IPv4 LAN and advertise DNS-SD; opt-in')
    parser.add_argument('--install', action='store_true', help='install, enable and start; default prints preview')
    parser.add_argument('--no-start', action='store_true', help='stage the installed service without starting it')
    args = parser.parse_args()
    nvidia_smi = shutil.which('nvidia-smi')
    binary = args.binary.resolve(strict=True)
    engine = args.engine.resolve(strict=True)
    if not all(p.is_file() and os.access(p, os.X_OK) for p in (binary, engine)):
        parser.error('host and engine must be executable files')
    models = [p.resolve(strict=True) for p in args.models]
    artifact_sets = [p.resolve(strict=True) for p in args.artifact_set]
    if not all(p.is_file() for p in artifact_sets):
        parser.error('artifact sets must be existing files')
    if not all(p.is_dir() for p in models):
        parser.error('model roots must be existing directories')
    prefix, data = args.prefix.resolve(), args.data_dir.resolve()
    target = prefix / 'ginfer-host'
    launcher = prefix / 'ginfer-launch.json'
    launcher_contents = json.dumps({'data_dir': str(data), 'host_url': 'https://127.0.0.1:7443'}, indent=2)
    unit = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'systemd/user/ginfer-host.service'
    contents = unit_text(target, engine, data, models, args.name, args.share_lan, artifact_sets, nvidia_smi or 'nvidia-smi')
    print(f'Unit: {unit}\nHost executable: {target}\nPrivate state: {data}\n\n{contents}')
    print(f'Launcher configuration: {launcher}\n{launcher_contents}')
    if not args.install:
        print('Preview only. Repeat with --install to install and start the host service.')
        return
    if shutil.which('systemctl') is None:
        parser.error('systemctl is required')
    if nvidia_smi is None:
        parser.error('nvidia-smi must be available to resolve the service inventory executable')
    if unit.exists() or target.exists() or launcher.exists() or (prefix / 'launch-profiles.json').exists():
        parser.error('installation already exists; stop and explicitly review it before replacing files')
    if data.exists() and (not data.is_dir() or data.stat().st_uid != os.getuid() or data.stat().st_mode & 0o077):
        parser.error('existing host data directory must belong to this user and have mode 0700')
    subprocess.run(['systemctl', '--user', 'show-environment'], check=True, stdout=subprocess.DEVNULL)
    prefix.mkdir(parents=True, exist_ok=True)
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    unit.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(target, binary.read_bytes(), 0o700)
    profiles = binary.parent / 'launch-profiles.json'
    if profiles.is_file():
        atomic_write(target.parent / 'launch-profiles.json', profiles.read_bytes(), 0o600)
    atomic_write(launcher, launcher_contents.encode(), 0o600)
    atomic_write(unit, contents.encode(), 0o600)
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    enable = ['systemctl', '--user', 'enable']
    if not args.no_start:
        enable.append('--now')
    subprocess.run([*enable, 'ginfer-host.service'], check=True)
    if args.no_start:
        print('Installed, not started. Start with: systemctl --user start ginfer-host.service')
    else:
        subprocess.run(['systemctl', '--user', 'is-active', '--quiet', 'ginfer-host.service'], check=True)
        print('Installed and started. The host is initializing inventory and its management endpoint.')
    print('Open the launch menu: ' + shlex.join([str(target), '--menu']))
    print('Put the installed host directory on PATH (or alongside ginfer) to launch it by typing ginfer.')
    print('Pair after startup: ' + shlex.join([str(target), '--data-dir', str(data), '--request-pairing']))
    if args.share_lan:
        print('Allow TCP 7443 and UDP 5353 only on the trusted LAN. No firewall rules were changed.')


if __name__ == '__main__':
    main()
