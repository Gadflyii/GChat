#!/usr/bin/env python3
"""Package an explicitly built host binary; never build/update engines or copy state."""
import argparse
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


def package(binary, target, output):
    binary = binary.resolve(strict=True)
    verify_architecture(binary, target)
    version = tomllib.loads((ROOT / 'src-tauri/ginfer-host/Cargo.toml').read_text())['package']['version']
    stem = f'ginfer-host-{version}-{target}'
    windows = target == 'windows-x86_64'
    installer = 'install-ginfer-host-windows.ps1' if windows else 'install-ginfer-host-linux.py'
    entries = {
        'bin/ginfer-host.exe' if windows else 'bin/ginfer-host': binary,
        f'scripts/{installer}': ROOT / 'scripts' / installer,
        'README.md': ROOT / 'docs/lan-host-setup.md',
        'LICENSE': ROOT / 'LICENSE',
    }
    output.mkdir(parents=True, exist_ok=True)
    destination = output / (stem + ('.zip' if windows else '.tar.gz'))
    # Exclusive creation protects prior release/test artifacts from replacement.
    with destination.open('xb') as stream:
        if windows:
            with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                for name, source in entries.items():
                    archive.write(source, f'{stem}/{name}')
        else:
            with tarfile.open(fileobj=stream, mode='w:gz') as archive:
                for name, source in entries.items():
                    info = archive.gettarinfo(str(source), arcname=f'{stem}/{name}')
                    info.mode = 0o755 if name.startswith('bin/') else 0o644
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
    args = parser.parse_args()
    print(package(args.binary, args.target, args.output_dir))


if __name__ == '__main__':
    main()
