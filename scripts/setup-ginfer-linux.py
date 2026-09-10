#!/usr/bin/env python3
"""Install a bundled Linux runtime with editable per-user paths; never start inference."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys


def install(bundle, destination, provider, config_root, link_dir, apply=False):
    for path in (destination, provider, config_root, link_dir):
        if not path.is_absolute() or path == Path('/'):
            raise ValueError('choose absolute dedicated directories, not filesystem roots')
    if destination.exists() or destination.is_symlink():
        raise ValueError(f'installation already exists; not overwriting {destination}')
    if destination == provider or destination in provider.parents or provider in destination.parents:
        raise ValueError('runtime installation and model storage must be separate, non-nested directories')
    runtime = bundle / 'runtime'
    manifest = json.loads((runtime / 'runtime-manifest.json').read_text())
    if manifest.get('schema') != 'ginfer-linux-runtime-v1' or manifest.get('platform') != 'linux-x64':
        raise ValueError('unsupported Linux runtime manifest')
    members = {}
    for entry in manifest['files']:
        name = entry['path']
        if name in members or not re.fullmatch(
                r'(bin/ginfer(?:-serve)?|lib/lib[\w+.-]+\.so\.[\w.-]+|licenses/[\w.-]+\.txt|LICENSE|README\.md)', name):
            raise ValueError(f'unexpected or duplicate runtime member: {name}')
        source = runtime / name
        with source.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if source.stat().st_size != entry['bytes'] or digest != entry['sha256']:
            raise ValueError(f'runtime integrity mismatch: {name}')
        members[name] = source
    for name in ('bin/ginfer', 'bin/ginfer-serve'):
        if name not in members:
            raise ValueError(f'runtime missing {name}')
    host = bundle / 'bin/ginfer-host'
    if not host.is_file():
        raise ValueError('bundle missing ginfer-host')
    locator = config_root / 'ginfer/local-host.json'
    registered = locator.exists()
    if registered and json.loads(locator.read_text()).get('schema') != 'ginfer-local-host-v1':
        raise ValueError('unsupported existing locator; registration left unchanged')
    link = link_dir / 'ginfer'
    if link.exists() or link.is_symlink():
        raise ValueError(f'launcher already exists; not overwriting {link}')
    print(f'Runtime: {destination}')
    print(f'Reusing host: {locator}' if registered else f'Models and host state: {provider}')
    print(f'Launcher: {link}')
    if not apply:
        print('Preview only. Repeat with --install. No services or models will be started.')
        return
    destination.mkdir(parents=True, exist_ok=False)
    for name, source in members.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        target.chmod(0o755 if name.startswith('bin/') else 0o644)
    shutil.copy2(host, destination / 'bin/ginfer-host')
    (destination / 'bin/ginfer-host').chmod(0o755)
    bundled_profiles = bundle / 'bin/launch-profiles.json'
    if bundled_profiles.is_file():
        shutil.copy2(bundled_profiles, destination / 'bin/launch-profiles.json')
    shutil.copy2(runtime / 'runtime-manifest.json', destination / 'runtime-manifest.json')
    if not registered:
        configuration = {'data_dir': str(provider / 'host'), 'host_url': 'https://127.0.0.1:7443',
                         'desktop': {'provider': str(provider), 'engine': str(destination / 'bin/ginfer-serve')}}
        path = destination / 'bin/ginfer-launch.json'
        with path.open('x') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(configuration, stream, indent=2)
    link_dir.mkdir(parents=True, exist_ok=True)
    link.symlink_to(destination / 'bin/ginfer')
    print(f'Installed. Launch: {link}')
    if str(link_dir) not in os.environ.get('PATH', '').split(os.pathsep):
        print(f'Add {link_dir} to your shell PATH to use the bare ginfer command.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install-directory', type=Path, default=Path.home() / '.local/lib/ginfer')
    parser.add_argument('--provider-directory', type=Path,
                        default=Path(os.environ.get('XDG_DATA_HOME') or Path.home() / '.local/share') / 'ginfer')
    parser.add_argument('--link-directory', type=Path, default=Path.home() / '.local/bin')
    parser.add_argument('--install', action='store_true')
    args = parser.parse_args()
    config = Path(os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config')
    if len(sys.argv) == 1 and sys.stdin.isatty():
        for field, label in [('install_directory', 'Binaries'), ('provider_directory', 'Models and state'),
                             ('link_directory', 'Launcher directory')]:
            if field == 'provider_directory' and (config / 'ginfer/local-host.json').exists():
                print('Your registered host and its storage will be reused.')
                continue
            answer = input(f'{label} [{getattr(args, field)}]: ').strip()
            if answer:
                setattr(args, field, Path(answer).expanduser())
        if input('Install for this user? [y/N]: ').lower() not in ('y', 'yes'):
            return
        args.install = True
    install(Path(__file__).resolve().parent, args.install_directory, args.provider_directory,
            config, args.link_directory, args.install)


if __name__ == '__main__':
    main()
