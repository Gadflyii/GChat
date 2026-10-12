#!/usr/bin/env python3
"""Package the accepted Linux Cua closure; no installation or dependency resolution."""

import argparse
import hashlib
import importlib.metadata
import json
import platform
from pathlib import Path
import re
import shutil
import subprocess
import sys
import sysconfig

SDK_REVISION = "0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc"
AGENT_REVISION = "896c68871da6f3a659c58f341781a977ada20459"
IMAGE = "sha256:03fd26b3308624e6b24a1df3e165cad9c35c4f0b95b54dd1bdb9c1fb7d4c8257"
SYSTEM_GLIBC = {"libc.so.6", "libm.so.6", "libpthread.so.0", "libdl.so.2",
                "librt.so.1", "ld-linux-x86-64.so.2"}


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def guest_assets():
    # Immutable product data owned by the same setup service as runtime preflight.
    contract = Path(__file__).resolve().parent.parent / "src-tauri/gbot-service/guest-assets.json"
    inventory = json.loads(contract.read_text())
    if inventory["schema"] != "gbot-guest-assets-v1":
        raise ValueError("Unsupported compiled guest asset inventory")
    return inventory["files"]


def verify_guest_asset(path, asset):
    if not path.is_file() or ("bytes" in asset and path.stat().st_size != asset["bytes"]):
        raise ValueError(f"Missing or size-mismatched accepted guest asset: {path}")
    with path.open("rb") as source:
        actual = hashlib.file_digest(source, asset["algorithm"]).hexdigest()
    if actual != asset["digest"]:
        raise ValueError(f"Pinned guest asset digest mismatch: {path}")


def check_guest_assets(destination):
    for asset in guest_assets():
        verify_guest_asset(destination / "assets" / asset["filename"], asset)
    print(json.dumps({"status": "PASS", "guest_assets": len(guest_assets())}))


def stage_guest_assets(source, destination):
    assets = guest_assets()
    target = destination / "assets"
    # All exact accepted local inputs are required before any payload is copied.
    for asset in assets:
        verify_guest_asset(source / asset["filename"], asset)
        existing = target / asset["filename"]
        if existing.exists():
            verify_guest_asset(existing, asset)
    target.mkdir(parents=True, exist_ok=True)
    for asset in assets:
        existing = target / asset["filename"]
        temporary = target / ("." + asset["filename"] + ".installing")
        if not existing.exists():
            if temporary.exists():
                temporary.unlink()
            shutil.copyfile(source / asset["filename"], temporary)
            verify_guest_asset(temporary, asset)
            temporary.replace(existing)
        elif temporary.exists():
            temporary.unlink()
    check_guest_assets(destination)


def normalized(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def closure(source):
    inventory = json.loads((source / "closure-inventory.json").read_text())
    state = json.loads((source / "current-state.json").read_text())
    if (inventory["source_revision"] != SDK_REVISION
            or inventory["agent_source_revision"] != AGENT_REVISION
            or inventory["image_id"] != IMAGE or inventory["agent_extras"]
            or inventory["package_count"] != 61 or state["status"] != "complete"):
        raise ValueError("Select the already accepted Cua base-agent closure")
    packages = inventory["packages"]
    expected = {normalized(p["name"]): p["version"] for p in packages}
    site = source / "venv/lib/python3.12/site-packages"
    installed = {normalized(p.metadata["Name"]): p.version
                 for p in importlib.metadata.distributions(path=[str(site)])}
    if len(packages) != 61 or installed != expected:
        raise ValueError("Installed Cua packages differ from the accepted closure")
    for package in packages:
        if (package["requested_extras"]
                or digest(source / "wheelhouse" / package["filename"]) != package["sha256"]):
            raise ValueError(f"Accepted wheel differs: {package['name']}")
        for notice in package["retained_notice_files"]:
            if not (source / notice).is_file():
                raise ValueError(f"Missing retained notice: {notice}")
    return inventory, site


def native_libraries(files, site):
    libraries = {}
    owners = {Path(sys.executable).resolve()}
    for member in files:
        result = subprocess.run(["ldd", str(member)], text=True, capture_output=True, check=True)
        if "not found" in result.stdout:
            raise ValueError(f"Unresolved interpreter dependency: {member}")
        for line in result.stdout.splitlines():
            match = re.match(r"\s*(\S+) => (/\S+) ", line)
            if not match:
                continue
            soname, filename = match.groups()
            path = Path(filename).resolve()
            if path.is_relative_to(site) or soname in SYSTEM_GLIBC:
                continue
            previous = libraries.setdefault(soname, path)
            if previous != path:
                raise ValueError(f"Conflicting native library: {soname}")
            owners.add(path)
    return libraries, owners


def system_notices(paths, destination):
    packages = {"python3.12-minimal", "libpython3.12-stdlib"}
    for path in paths:
        result = subprocess.run(["dpkg-query", "-S", str(path)], text=True,
                                capture_output=True, check=True)
        for line in result.stdout.splitlines():
            owner, _, _ = line.partition(": /")
            packages.add(owner.split(":", 1)[0])
    for package in sorted(packages):
        notice = Path("/usr/share/doc") / package / "copyright"
        if not notice.is_file():
            raise ValueError(f"Missing interpreter/library notice: {package}")
        target = destination / package
        target.mkdir(parents=True)
        shutil.copy2(notice, target / "copyright")
    return sorted(packages)


def check(destination):
    manifest = json.loads((destination / "runtime.json").read_text())
    if (manifest["schema"] != "gbot-cua-runtime-v1"
            or manifest["platform"] != "linux-x64" or manifest["python_version"] != "3.12.3"
            or manifest["sdk_revision"] != SDK_REVISION or manifest["agent_revision"] != AGENT_REVISION
            or manifest["closure_image"] != IMAGE
            or manifest["package_count"] != 61):
        raise ValueError("Unsupported Gbot runtime package")
    expected = {"python/bin/python", "python/bin/python3.12", "python/lib/python3.12/os.py",
                "python/lib/python3.12/dist-packages/cua_agent/loops/ginfer.py",
                "context-preparer.ts", "smart-context.ts", "requirements.lock", "closure-inventory.json"}
    files = manifest["files"]
    if not expected.issubset({p["path"] for p in files}):
        raise ValueError("Incomplete Gbot runtime package")
    for entry in files:
        path = destination / entry["path"]
        if path.stat().st_size != entry["bytes"] or digest(path) != entry["sha256"]:
            raise ValueError(f"Packaged file differs: {entry['path']}")
    print(json.dumps({"status": "PASS", "platform": manifest["platform"],
                      "python_version": manifest["python_version"],
                      "package_count": manifest["package_count"], "files": len(files)}))


def package(source, destination):
    inventory, site = closure(source)
    operating_system = platform.freedesktop_os_release()
    if (sys.version != inventory["python"] or platform.system() != "Linux"
            or platform.machine() != "x86_64"
            or operating_system.get("ID") != "ubuntu" or operating_system.get("VERSION_ID") != "24.04"):
        raise ValueError(f"Package with the closure's existing Ubuntu24 CPython image: {IMAGE}")
    stdlib = Path(sysconfig.get_path("stdlib"))
    executable = Path(sys.executable).resolve()
    native = [executable] + [p for root in (stdlib, site) for p in root.rglob("*.so*") if p.is_file()]
    libraries, owners = native_libraries(native, site)
    repository = Path(__file__).resolve().parent.parent
    context = (repository / "src-tauri/gbot-service/examples/context-preparer.ts").read_text()
    context = context.replace("'../../../web-app/src/lib/smart-context'", "'./smart-context'")
    python = destination / "python"
    if python.exists():
        check(destination)
        if (destination / "context-preparer.ts").read_text() != context or digest(destination / "smart-context.ts") != digest(repository / "web-app/src/lib/smart-context.ts"):
            raise ValueError("Shared context policy changed; inspect and retire the previous owned package")
        return
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "context-preparer.ts").write_text(context)
    shutil.copy2(repository / "web-app/src/lib/smart-context.ts", destination / "smart-context.ts")
    (python / "bin").mkdir(parents=True)
    shutil.copy2(executable, python / "bin/python3.12")
    shutil.copytree(stdlib, python / "lib/python3.12",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "site-packages", "dist-packages"))
    # Ubuntu's unchanged site.py uses dist-packages outside a venv.
    shutil.copytree(site, python / "lib/python3.12/dist-packages",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    private = python / "lib/native"
    private.mkdir()
    for name, library in sorted(libraries.items()):
        shutil.copy2(library, private / name)
    launcher = python / "bin/python"
    launcher.write_text('''#!/bin/sh
set -eu
gbot_python_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export LD_LIBRARY_PATH="$gbot_python_root/lib/native${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$gbot_python_root/bin/python3.12" -I -B "$@"
''')
    launcher.chmod(0o755)
    for name in ("requirements.lock", "closure-inventory.json", "closure-inventory.tsv", "current-state.json"):
        shutil.copy2(source / name, destination / name)
    shutil.copytree(source / "licenses", destination / "licenses")
    os_notices = system_notices(owners, destination / "licenses/ubuntu-python-runtime")
    files = [{"path": p.relative_to(destination).as_posix(), "bytes": p.stat().st_size, "sha256": digest(p)}
             for p in sorted(destination.rglob("*")) if p.is_file() and p.name != "runtime.json"
             and "assets" not in p.relative_to(destination).parts]
    manifest = {"schema": "gbot-cua-runtime-v1", "platform": "linux-x64", "python_version": "3.12.3",
                "sdk_revision": SDK_REVISION, "agent_revision": AGENT_REVISION, "closure_image": IMAGE,
                "package_count": 61, "native_libraries": sorted(libraries), "system_notices": os_notices,
                "files": files}
    (destination / "runtime.json").write_text(json.dumps(manifest, indent=2) + "\n")
    check(destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Accepted python-runtime closure directory")
    parser.add_argument("--destination", type=Path, required=True, help="Staged resources/gbot directory")
    parser.add_argument("--guest-assets", type=Path, help="Accepted local guest payload directory; stage without downloads")
    parser.add_argument("--check-guest-assets", action="store_true", help="Verify the exact bundled guest payload pins")
    parser.add_argument("--check", action="store_true", help="Verify the existing package manifest without staging")
    args = parser.parse_args()
    if args.check_guest_assets:
        check_guest_assets(args.destination.resolve(strict=True))
    elif args.guest_assets:
        stage_guest_assets(args.guest_assets.resolve(strict=True), args.destination.resolve())
    elif args.check:
        check(args.destination.resolve(strict=True))
    elif args.source:
        package(args.source.resolve(strict=True), args.destination.resolve())
    else:
        parser.error("--source or --guest-assets is required when staging")
