#!/usr/bin/env python3
"""Verify and stage the complete Linux desktop engine payload."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

ARCHITECTURES = {'8.0': 'sm80', '8.6': 'sm86', '8.9': 'sm89', '12.0': 'sm120a'}


def verify(source):
    source = source.resolve(strict=True)
    contract = json.loads((source / 'runtime-set.json').read_text())
    if (contract.get('schema') != 'ginfer-linux-runtime-set-v1'
            or contract.get('platform') != 'linux-x64'
            or contract.get('runtimes') != ARCHITECTURES):
        raise ValueError('Linux release requires exactly SM80, SM86, SM89 and SM120a runtimes')
    commit = contract.get('source_commit', '')
    if len(commit) != 40 or any(c not in '0123456789abcdef' for c in commit):
        raise ValueError('runtime set must identify its exact source commit')
    for directory in ARCHITECTURES.values():
        root = source / directory
        manifest = json.loads((root / 'runtime-manifest.json').read_text())
        if (manifest.get('schema') != 'ginfer-linux-runtime-v1'
                or manifest.get('platform') != 'linux-x64'
                or manifest.get('source_commit') != commit
                or manifest.get('source_dirty') is not False
                or manifest.get('cuda_architecture') != directory.replace('sm', 'sm_')
                or manifest.get('build_glibc') != 'glibc 2.39'):
            raise ValueError(f'{directory}: expected a clean Ubuntu 24.04 runtime from {commit}')
        members = set()
        for entry in manifest['files']:
            relative = Path(entry['path'])
            if relative.is_absolute() or '..' in relative.parts or str(relative) in members:
                raise ValueError(f'{directory}: invalid or duplicate member {relative}')
            members.add(str(relative))
            member = (root / relative).resolve(strict=True)
            if not member.is_relative_to(root.resolve()):
                raise ValueError(f'{directory}: member escapes runtime directory')
            with member.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            if member.stat().st_size != entry['bytes'] or digest != entry['sha256']:
                raise ValueError(f'{directory}: integrity mismatch for {relative}')
        if not {'bin/ginfer', 'bin/ginfer-serve'} <= members:
            raise ValueError(f'{directory}: missing engine executable')
        for name in ('ginfer', 'ginfer-serve'):
            executable = root / 'bin' / name
            with executable.open('rb') as stream:
                header = stream.read(20)
            if header[:5] != b'\x7fELF\x02' or header[18:20] != b'\x3e\x00':
                raise ValueError(f'{directory}: {name} is not ELF x86-64')
            if not executable.stat().st_mode & 0o111:
                raise ValueError(f'{directory}: {name} is not executable')
    return contract


def stage(source, destination):
    contract = verify(source)
    source, destination = source.resolve(), destination.resolve()
    if destination == source or destination in source.parents or source in destination.parents:
        raise ValueError('source and staging directories must be separate')
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + '.staging')
    if temporary.exists():
        raise ValueError(f'previous staging directory requires inspection: {temporary}')
    shutil.copytree(source, temporary)
    verify(temporary)
    if destination.exists():
        shutil.rmtree(destination)
    temporary.rename(destination)
    return contract


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--destination', type=Path)
    args = parser.parse_args()
    contract = stage(args.source, args.destination) if args.destination else verify(args.source)
    print(f"Verified all four Linux runtimes from {contract['source_commit']}")


if __name__ == '__main__':
    main()
