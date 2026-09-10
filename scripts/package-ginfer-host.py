#!/usr/bin/env python3
"""Package an explicit host build, optionally with a verified Windows engine runtime."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import tarfile
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def verify_architecture(binary, target):
    with binary.open('rb') as stream:
        header = stream.read(64)
        if target == 'linux-x86_64':
            if len(header) < 64 or header[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', header, 18)[0] != 62:
                raise ValueError('expected a Linux x86_64 ELF executable')
        else:
            if len(header) < 64 or header[:2] != b'MZ':
                raise ValueError('expected a Windows x86_64 PE executable')
            stream.seek(struct.unpack_from('<I', header, 60)[0])
            pe = stream.read(6)
            if pe != b'PE\0\0\x64\x86':
                raise ValueError('expected a Windows x86_64 PE executable')


def runtime_entries(directory, target):
    windows = target == 'windows-x86_64'
    directory = directory.resolve(strict=True)
    manifest_path = directory / 'runtime-manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    platform = 'windows' if windows else 'linux'
    if manifest.get('schema') != f'ginfer-{platform}-runtime-v1' or manifest.get('platform') != f'{platform}-x64':
        raise ValueError(f'expected the GInfer {platform} runtime contract')
    entries = {'runtime/runtime-manifest.json': manifest_path}
    seen = set()
    for item in manifest['files']:
        name = item['path']
        path = Path(name)
        if path.is_absolute() or '\\' in name or '..' in path.parts or ':' in name:
            raise ValueError('invalid runtime member path')
        if name in seen or not (name in ('LICENSE', 'README.md') or
                (path.parent == Path('bin') and path.suffix.lower() in ('.exe', '.dll')) or
                (not windows and name in ('bin/ginfer', 'bin/ginfer-serve')) or
                (not windows and path.parent == Path('lib') and '.so.' in path.name) or
                (path.parent == Path('licenses') and path.suffix == '.txt')):
            raise ValueError('unexpected or duplicate runtime member')
        seen.add(name)
        source = directory / path
        if not source.resolve(strict=True).is_relative_to(directory):
            raise ValueError('runtime member escapes the selected directory')
        with source.open('rb') as payload:
            digest = hashlib.file_digest(payload, 'sha256').hexdigest()
        if source.stat().st_size != item['bytes'] or digest != item['sha256']:
            raise ValueError(f'runtime integrity mismatch: {name}')
        entries[f'runtime/{name}'] = source
    for name in (('bin/ginfer.exe', 'bin/ginfer-serve.exe') if windows else ('bin/ginfer', 'bin/ginfer-serve')):
        if name not in seen:
            raise ValueError(f'runtime is missing {name}')
        verify_architecture(directory / name, target)
    return entries


def profile_catalog(paths, target):
    profiles = []
    ids = set()
    for path in paths:
        catalog = json.loads(path.read_text())
        if catalog.get('schema') != 'ginfer-launch-profiles-v1':
            raise ValueError('unsupported launch profile catalog')
        for profile in catalog['profiles']:
            if profile['platform'] != target.split('-')[0]:
                raise ValueError('profile qualification platform does not match package')
            if profile['id'] in ids:
                raise ValueError('duplicate launch profile id')
            ids.add(profile['id'])
            profiles.append(profile)
    return json.dumps({'schema': 'ginfer-launch-profiles-v1', 'profiles': profiles}, indent=2).encode() + b'\n'


def package(binary, target, output, runtime=None, profiles=()):
    binary = binary.resolve(strict=True)
    verify_architecture(binary, target)
    version = tomllib.loads((ROOT / 'src-tauri/ginfer-host/Cargo.toml').read_text())['package']['version']
    stem = f'ginfer-{"bundle" if runtime else "host"}-{version}-{target}'
    windows = target == 'windows-x86_64'
    installer = 'install-ginfer-host-windows.ps1' if windows else 'install-ginfer-host-linux.py'
    entries = {
        'bin/ginfer-host.exe' if windows else 'bin/ginfer-host': binary,
        f'scripts/{installer}': ROOT / 'scripts' / installer,
        'README.md': ROOT / 'docs/lan-host-setup.md',
        'LICENSE': ROOT / 'LICENSE',
    }
    if runtime is not None:
        entries.update(runtime_entries(runtime, target))
        if windows:
            entries['scripts/setup-ginfer-windows.ps1'] = ROOT / 'scripts/setup-ginfer-windows.ps1'
            entries['setup.cmd'] = ROOT / 'scripts/setup-ginfer-windows.cmd'
        else:
            entries['setup.py'] = ROOT / 'scripts/setup-ginfer-linux.py'
    if profiles:
        entries['bin/launch-profiles.json'] = profile_catalog(profiles, target)
    output.mkdir(parents=True, exist_ok=True)
    destination = output / (stem + ('.zip' if windows else '.tar.gz'))
    # Exclusive creation protects prior release/test artifacts from replacement.
    with destination.open('xb') as stream:
        if windows:
            with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                for name, source in entries.items():
                    if isinstance(source, bytes):
                        archive.writestr(f'{stem}/{name}', source)
                    else:
                        archive.write(source, f'{stem}/{name}')
        else:
            with tarfile.open(fileobj=stream, mode='w:gz') as archive:
                for name, source in entries.items():
                    if isinstance(source, bytes):
                        info = tarfile.TarInfo(f'{stem}/{name}')
                        info.size = len(source)
                        info.mode = 0o644
                        archive.addfile(info, io.BytesIO(source))
                        continue
                    info = archive.gettarinfo(str(source), arcname=f'{stem}/{name}')
                    info.mode = 0o755 if name.startswith(('bin/', 'runtime/bin/')) or name == 'setup.py' else 0o644
                    info.uid = info.gid = 0
                    info.uname = info.gname = ''
                    with source.open('rb') as payload:
                        archive.addfile(info, payload)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--target', choices=['linux-x86_64', 'windows-x86_64'], required=True)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'src-tauri/ginfer-host/target/distribution')
    parser.add_argument('--runtime-directory', type=Path,
                        help='explicit native runtime to verify and include; no build or download')
    parser.add_argument('--profile-catalog', type=Path, action='append', default=[],
                        help='explicit qualified catalog for this platform; repeat for multiple models')
    args = parser.parse_args()
    print(package(args.binary, args.target, args.output_dir, args.runtime_directory, args.profile_catalog))


if __name__ == '__main__':
    main()
