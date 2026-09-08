#!/usr/bin/env python3
"""Preview or install a per-user GInfer host service. Never modifies the engine."""
import argparse
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
    parser.add_argument('--install', action='store_true', help='install and enable, but do not start; default prints preview')
    args = parser.parse_args()
    nvidia_smi = shutil.which('nvidia-smi')
    binary = args.binary.resolve(strict=True)
    engine = args.engine.resolve(strict=True)
    if not all(p.is_file() and os.access(p, os.X_OK) for p in (binary, engine)):
        parser.error('host and engine must be executable files')
    models = [p.resolve(strict=True) for p in args.models]
    artifact_sets = [p.resolve(strict=True) for p in args.artifact_set]
    if not models and not artifact_sets:
        parser.error('supply model directories or explicit artifact-set descriptors')
    if not all(p.is_file() for p in artifact_sets):
        parser.error('artifact sets must be existing files')
    if not all(p.is_dir() for p in models):
        parser.error('model roots must be existing directories')
    prefix, data = args.prefix.resolve(), args.data_dir.resolve()
    target = prefix / 'ginfer-host'
    unit = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'systemd/user/ginfer-host.service'
    contents = unit_text(target, engine, data, models, args.name, args.share_lan, artifact_sets, nvidia_smi or 'nvidia-smi')
    print(f'Unit: {unit}\nHost executable: {target}\nPrivate state: {data}\n\n{contents}')
    if not args.install:
        print('Preview only. Repeat with --install to install without starting.')
        return
    if shutil.which('systemctl') is None:
        parser.error('systemctl is required')
    if nvidia_smi is None:
        parser.error('nvidia-smi must be available to resolve the service inventory executable')
    if unit.exists() or target.exists():
        parser.error('installation already exists; stop and explicitly review it before replacing files')
    if data.exists() and (not data.is_dir() or data.stat().st_uid != os.getuid() or data.stat().st_mode & 0o077):
        parser.error('existing host data directory must belong to this user and have mode 0700')
    subprocess.run(['systemctl', '--user', 'show-environment'], check=True, stdout=subprocess.DEVNULL)
    prefix.mkdir(parents=True, exist_ok=True)
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    unit.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(target, binary.read_bytes(), 0o700)
    atomic_write(unit, contents.encode(), 0o600)
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', '--user', 'enable', 'ginfer-host.service'], check=True)
    print('Installed, not started. Start with: systemctl --user start ginfer-host.service')
    print('Pair after startup: ' + shlex.join([str(target), '--data-dir', str(data), '--request-pairing']))
    if args.share_lan:
        print('Allow TCP 7443 and UDP 5353 only on the trusted LAN. No firewall rules were changed.')


if __name__ == '__main__':
    main()
