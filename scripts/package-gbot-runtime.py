#!/usr/bin/env python3
"""Package the accepted Cua closure from local pinned artifacts, without installation."""

import argparse
import base64
import copy
import email
import hashlib
import importlib.metadata
import json
import platform
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import sysconfig
import zipfile

SDK_REVISION = "0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc"
AGENT_REVISION = "896c68871da6f3a659c58f341781a977ada20459"
IMAGE = "sha256:03fd26b3308624e6b24a1df3e165cad9c35c4f0b95b54dd1bdb9c1fb7d4c8257"
SYSTEM_GLIBC = {"libc.so.6", "libm.so.6", "libpthread.so.0", "libdl.so.2",
                "librt.so.1", "ld-linux-x86-64.so.2"}
WINDOWS_PYTHON_SHA256 = "38b265fc0612027a126ae54d2485101f041b61893e41ef4f421dee6ac618a99e"
# Exact CPython 3.12 / AMD64 replacements from the accepted source uv.lock.
# colorama is the sole additional dependency selected by Windows markers.
WINDOWS_WHEELS = {
    "aiohttp": (
        "33a2d7c28d33797a2e99923dffa63f83d908a19b6bf26cfe80fa790aa5e1a75a",
        "https://files.pythonhosted.org/packages/76/9b/f2f8f108da17ecef2cc3efc424e8b7ad3782b1a8360f7b8eae8ced84f6ea/aiohttp-3.14.3-cp312-cp312-win_amd64.whl"),
    "charset-normalizer": (
        "a79cfe37875f822425b89a82333404539ae63dbdddf97f84dcbc3d339aae9525",
        "https://files.pythonhosted.org/packages/3d/2d/1e5ed9dd3b3803994c155cd9aacb60c82c331bad84daf75bcb9c91b3295e/charset_normalizer-3.4.4-cp312-cp312-win_amd64.whl"),
    "fastuuid": (
        "d9e4332dc4ba054434a9594cbfaf7823b57993d7d8e7267831c3e059857cf397",
        "https://files.pythonhosted.org/packages/cc/fc/f5c799a6ea6d877faec0472d0b27c079b47c86b1cdc577720a5386483b36/fastuuid-0.14.0-cp312-cp312-win_amd64.whl"),
    "frozenlist": (
        "34187385b08f866104f0c0617404c8eb08165ab1272e884abc89c112e9c00746",
        "https://files.pythonhosted.org/packages/b8/af/38e51a553dd66eb064cdf193841f16f077585d4d28394c2fa6235cb41765/frozenlist-1.8.0-cp312-cp312-win_amd64.whl"),
    "hf-xet": (
        "f7b3002f95d1c13e24bcb4537baa8f0eb3838957067c91bb4959bc004a6435f5",
        "https://files.pythonhosted.org/packages/6d/b6/20f99cfe97cc663a711f7b33cc21d4793e51968e9a26125b4afcd77315ba/hf_xet-1.5.1-cp37-abi3-win_amd64.whl"),
    "jiter": (
        "e8269062060212b373316fe69236096aaf4c49022d267c6736eebd66bbbc60bb",
        "https://files.pythonhosted.org/packages/1c/c7/6659f537f9562d963488e3e55573498a442503ced01f7e169e96a6110383/jiter-0.12.0-cp312-cp312-win_amd64.whl"),
    "markupsafe": (
        "26a5784ded40c9e318cfc2bdb30fe164bdb8665ded9cd64d500a34fb42067b1c",
        "https://files.pythonhosted.org/packages/aa/5b/bec5aa9bbbb2c946ca2733ef9c4ca91c91b6a24580193e891b5f7dbe8e1e/markupsafe-3.0.3-cp312-cp312-win_amd64.whl"),
    "multidict": (
        "92abb658ef2d7ef22ac9f8bb88e8b6c3e571671534e029359b6d9e845923eb1b",
        "https://files.pythonhosted.org/packages/46/e2/348cd32faad84eaf1d20cce80e2bb0ef8d312c55bca1f7fa9865e7770aaf/multidict-6.7.0-cp312-cp312-win_amd64.whl"),
    "pillow": (
        "a2b55dd6b2a4c4b7d87ffa56bdb33fdc5fdb9a462173861a7bc097f17d91cb09",
        "https://files.pythonhosted.org/packages/45/89/da2f7971a317f83d807fdd4065c0af40208e59e692cc43d315a71a0e96d1/pillow-12.3.0-cp312-cp312-win_amd64.whl"),
    "propcache": (
        "cb2d222e72399fcf5890d1d5cc1060857b9b236adff2792ff48ca2dfd46c81db",
        "https://files.pythonhosted.org/packages/54/09/d19cff2a5aaac632ec8fc03737b223597b1e347416934c1b3a7df079784c/propcache-0.4.1-cp312-cp312-win_amd64.whl"),
    "pydantic-core": (
        "1962293292865bca8e54702b08a4f26da73adc83dd1fcf26fbc875b35d81c815",
        "https://files.pythonhosted.org/packages/86/45/00173a033c801cacf67c190fef088789394feaf88a98a7035b0e40d53dc9/pydantic_core-2.41.5-cp312-cp312-win_amd64.whl"),
    "pyyaml": (
        "5fcd34e47f6e0b794d17de1b4ff496c00986e1c83f7ab2fb8fcfe9616ff7477b",
        "https://files.pythonhosted.org/packages/86/bf/899e81e4cce32febab4fb42bb97dcdf66bc135272882d1987881a4b519e9/pyyaml-6.0.3-cp312-cp312-win_amd64.whl"),
    "regex": (
        "e721d1b46e25c481dc5ded6f4b3f66c897c58d2e8cfdf77bbced84339108b0b9",
        "https://files.pythonhosted.org/packages/1a/67/3b92df89f179d7c367be654ab5626ae311cb28f7d5c237b6bb976cd5fbbb/regex-2025.11.3-cp312-cp312-win_amd64.whl"),
    "rpds-py": (
        "a090322ca841abd453d43456ac34db46e8b05fd9b3b4ac0c78bcde8b089f959b",
        "https://files.pythonhosted.org/packages/39/3b/f786af9957306fdc38a74cef405b7b93180f481fb48453a114bb6465744a/rpds_py-0.30.0-cp312-cp312-win_amd64.whl"),
    "tiktoken": (
        "ffc5288f34a8bc02e1ea7047b8d041104791d2ddbf42d1e5fa07822cbffe16bd",
        "https://files.pythonhosted.org/packages/81/10/b8523105c590c5b8349f2587e2fdfe51a69544bd5a76295fc20f2374f470/tiktoken-0.12.0-cp312-cp312-win_amd64.whl"),
    "tokenizers": (
        "c9ea31edff2968b44a88f97d784c2f16dc0729b8b143ed004699ebca91f05c48",
        "https://files.pythonhosted.org/packages/65/71/0670843133a43d43070abeb1949abfdef12a86d490bea9cd9e18e37c5ff7/tokenizers-0.22.2-cp39-abi3-win_amd64.whl"),
    "yarl": (
        "8884d8b332a5e9b88e23f60bb166890009429391864c685e17bd73a9eda9105c",
        "https://files.pythonhosted.org/packages/c8/9a/6ad1a9b37c2f72874f93e691b2e7ecb6137fb2b899983125db4204e47575/yarl-1.22.0-cp312-cp312-win_amd64.whl"),
    "colorama": (
        "4f1d9991f5acc0ca119f9d443620b77f9d6b33703e51011c16baf57afb285fc6",
        "https://files.pythonhosted.org/packages/d1/d6/3965ed04c63042e047cb6a3e6ed1a63a35087b6a609aa3a15ed8ac56c221/colorama-0.4.6-py2.py3-none-any.whl"),
}


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def guest_assets(target_platform="linux"):
    # Immutable product data owned by the same setup service as runtime preflight.
    contract = Path(__file__).resolve().parent.parent / "src-tauri/gbot-service/guest-assets.json"
    inventory = json.loads(contract.read_text())
    if inventory["schema"] != "gbot-guest-assets-v1":
        raise ValueError("Unsupported compiled guest asset inventory")
    assets = inventory["files"]
    if target_platform == "windows":
        image = inventory["windows_image"]
        source = image["source"]
        if any(source[key] != assets[0][key] for key in ("filename", "algorithm", "digest")):
            raise ValueError("Windows guest image provenance differs from the accepted Linux source")
        if image["asset"]["algorithm"] != "sha256" or not image["asset"].get("bytes"):
            raise ValueError("Windows guest image requires its own SHA256 and byte count")
        assets = [image["asset"], *assets[1:]]
    return assets


def verify_guest_asset(path, asset):
    if not path.is_file() or ("bytes" in asset and path.stat().st_size != asset["bytes"]):
        raise ValueError(f"Missing or size-mismatched accepted guest asset: {path}")
    with path.open("rb") as source:
        actual = hashlib.file_digest(source, asset["algorithm"]).hexdigest()
    if actual != asset["digest"]:
        raise ValueError(f"Pinned guest asset digest mismatch: {path}")


def check_guest_assets(destination, target_platform="linux"):
    for asset in guest_assets(target_platform):
        verify_guest_asset(destination / "assets" / asset["filename"], asset)
    print(json.dumps({"status": "PASS", "guest_assets": len(guest_assets(target_platform))}))


def stage_guest_assets(source, destination, target_platform="linux"):
    assets = guest_assets(target_platform)
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
    check_guest_assets(destination, target_platform)


def normalized(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def closure(source, windows=False):
    inventory = json.loads((source / "closure-inventory.json").read_text())
    state = json.loads((source / "current-state.json").read_text())
    if (inventory["source_revision"] != SDK_REVISION
            or inventory["agent_source_revision"] != AGENT_REVISION
            or inventory["image_id"] != IMAGE or inventory["agent_extras"]
            or inventory["package_count"] != 61 or state["status"] != "complete"):
        raise ValueError("Select the already accepted Cua base-agent closure")
    packages = inventory["packages"]
    expected = {normalized(p["name"]): p["version"] for p in packages}
    relocated = windows and (source / "runtime.json").is_file()
    site = source / ("python/lib/python3.12/dist-packages" if relocated
                     else "venv/lib/python3.12/site-packages")
    verified_files = None
    if relocated:
        check(source, "linux-x64")
        verified_files = {p["path"] for p in json.loads((source / "runtime.json").read_text())["files"]}
        if "current-state.json" not in verified_files:
            raise ValueError("Accepted Linux package omits its closure state")
    if len(packages) != 61 or len(expected) != 61:
        raise ValueError("Installed Cua packages differ from the accepted closure")
    if not windows or relocated:
        installed = {normalized(p.metadata["Name"]): p.version
                     for p in importlib.metadata.distributions(path=[str(site)])}
        if installed != expected:
            raise ValueError("Installed Cua packages differ from the accepted closure")
    for package in packages:
        portable = package["filename"].endswith("-none-any.whl")
        if package["requested_extras"] or ((not relocated and (not windows or portable))
                and digest(source / "wheelhouse" / package["filename"]) != package["sha256"]):
            raise ValueError(f"Accepted wheel differs: {package['name']}")
        for notice in package["retained_notice_files"]:
            if not (source / notice).is_file() or (relocated and notice not in verified_files):
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


def check(destination, target_platform=None):
    manifest = json.loads((destination / "runtime.json").read_text())
    windows = manifest["platform"] == "windows-x64"
    if (manifest["schema"] != "gbot-cua-runtime-v1"
            or manifest["platform"] not in {"linux-x64", "windows-x64"}
            or (target_platform is not None and manifest["platform"] != target_platform)
            or manifest["python_version"] != "3.12.3"
            or manifest["sdk_revision"] != SDK_REVISION or manifest["agent_revision"] != AGENT_REVISION
            or manifest["closure_image"] != IMAGE
            or manifest["package_count"] != (62 if windows else 61)):
        raise ValueError("Unsupported Gbot runtime package")
    expected = {"context-preparer.ts", "smart-context.ts", "requirements.lock", "closure-inventory.json"}
    if windows:
        expected.update({"python/python.exe", "python/python312.dll", "python/python312.zip",
                         "python/python312._pth", "python/LICENSE.txt",
                         "licenses/python-3.12.3/LICENSE.txt",
                         "python/Lib/site-packages/cua_agent/loops/ginfer.py"})
        inventory = json.loads((destination / "closure-inventory.json").read_text())
        packages = {normalized(p["name"]): p for p in inventory["packages"]}
        if (inventory["package_count"] != 62 or len(inventory["packages"]) != 62
                or len(packages) != 62 or inventory["agent_extras"]
                or inventory["source_revision"] != SDK_REVISION
                or inventory["agent_source_revision"] != AGENT_REVISION
                or inventory["image_id"] != IMAGE):
            raise ValueError("Unsupported Windows Cua closure")
        for name, (sha256, url) in WINDOWS_WHEELS.items():
            package = packages.get(name, {})
            if package.get("filename") != url.rsplit("/", 1)[1] or package.get("sha256") != sha256:
                raise ValueError(f"Windows wheel pin differs: {name}")
        for package in packages.values():
            if package["requested_extras"] or not package["retained_notice_files"]:
                raise ValueError(f"Incomplete Windows Cua package: {package['name']}")
            if (normalized(package["name"]) not in WINDOWS_WHEELS
                    and not package["filename"].endswith("-none-any.whl")):
                raise ValueError(f"Unapproved native Windows Cua package: {package['name']}")
            expected.update(package["retained_notice_files"])
        lock = [line for line in (destination / "requirements.lock").read_text().splitlines()
                if line and not line.startswith("#")]
        if (len(lock) != 62 or set(lock) != {
                f"{p['name']}=={p['version']} --hash=sha256:{p['sha256']}" for p in packages.values()}):
            raise ValueError("Windows requirements.lock differs from its 62-package inventory")
        if (destination / "python/python312._pth").read_text() != "python312.zip\n.\nLib/site-packages\n":
            raise ValueError("Windows Python must use the isolated bundled import paths")
    else:
        expected.update({"python/bin/python", "python/bin/python3.12", "python/lib/python3.12/os.py",
                         "python/lib/python3.12/dist-packages/cua_agent/loops/ginfer.py"})
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


def windows_closure(source, wheelhouse):
    inventory, site = closure(source, windows=True)
    inventory = copy.deepcopy(inventory)
    relocated = (source / "runtime.json").is_file()
    installed = {normalized(d.metadata["Name"]): d
                 for d in importlib.metadata.distributions(path=[str(site)])} if relocated else {}
    portable = [p for p in inventory["packages"] if p["filename"].endswith("-none-any.whl")]
    native = {normalized(p["name"]) for p in inventory["packages"] if p not in portable}
    if len(portable) != 44 or native != WINDOWS_WHEELS.keys() - {"colorama"}:
        raise ValueError("Expected the accepted 44 portable and 17 native Cua packages")
    inventory["packages"].append({"name": "colorama", "version": "0.4.6",
                                  "requested_extras": [], "retained_notice_files": [],
                                  "license_summary": "BSD-3-Clause"})
    selected = []
    for package in inventory["packages"]:
        name = normalized(package["name"])
        if name in WINDOWS_WHEELS:
            sha256, url = WINDOWS_WHEELS[name]
            filename = url.rsplit("/", 1)[1]
            wheel = wheelhouse / filename
            if digest(wheel) != sha256:
                raise ValueError(f"Pinned Windows wheel differs: {filename}")
            package.update({"filename": filename, "sha256": sha256,
                            "size_bytes": wheel.stat().st_size,
                            "origin": {"url": url, "sha256": sha256, "source_lock": "uv.lock"}})
        else:
            wheel = None if relocated else source / "wheelhouse" / package["filename"]
        if wheel is None:
            metadata = installed[name].metadata
        else:
            with zipfile.ZipFile(wheel) as archive:
                members = [n for n in archive.namelist() if n.endswith(".dist-info/METADATA")]
                if len(members) != 1:
                    raise ValueError(f"Invalid wheel metadata: {wheel}")
                metadata = email.message_from_bytes(archive.read(members[0]))
        if normalized(metadata["Name"]) != name or metadata["Version"] != package["version"]:
            raise ValueError(f"Pinned wheel identity differs: {wheel}")
        if name in WINDOWS_WHEELS:
            requirements = metadata.get_all("Requires-Dist", [])
            if (name == "colorama" and requirements) or (name != "colorama"
                    and sorted(requirements) != sorted(package["requires_dist"])):
                raise ValueError(f"Windows wheel changes the accepted dependency graph: {name}")
            package.update({"license_expression": metadata.get("License-Expression"),
                            "license_metadata": metadata.get("License"),
                            "license_classifiers": [c for c in metadata.get_all("Classifier", [])
                                                    if c.startswith("License ::")],
                            "license_files": metadata.get_all("License-File", []),
                            "requires_dist": requirements, "requires_python": metadata.get("Requires-Python")})
        selected.append((package, wheel))
    inventory["packages"].sort(key=lambda p: normalized(p["name"]))
    inventory["package_count"] = 62
    inventory["platform"] = {"implementation_name": "cpython", "implementation_version": "3.12.3",
                             "os_name": "nt", "platform_machine": "AMD64",
                             "platform_python_implementation": "CPython", "platform_release": "",
                             "platform_system": "Windows", "platform_version": "",
                             "python_full_version": "3.12.3", "python_version": "3.12", "sys_platform": "win32"}
    inventory["python"] = "3.12.3 (official Windows AMD64 embeddable distribution)"
    inventory["method"] = ("Retain 44 accepted portable wheels; replace 17 native wheels with pinned Windows "
                           "CPython 3.12/ABI3 AMD64 wheels; add only marker-selected colorama; no agent extras")
    if relocated:
        inventory["method"] += (". Portable installed RECORD members are verified by the accepted Linux runtime "
                                "manifest; assets omitted by its legacy filter are verified by their RECORD SHA256. "
                                "Original portable wheel hashes remain provenance; no wheels are rebuilt")
    return inventory, selected, site if relocated else None


def copy_portable_distribution(source, site, package, python, verified_files):
    distribution = next(d for d in importlib.metadata.distributions(path=[str(site)])
                        if normalized(d.metadata["Name"]) == normalized(package["name"]))
    records = distribution.files
    if not records:
        raise ValueError(f"Accepted portable distribution has no RECORD: {package['name']}")
    for relative in records:
        if (relative.suffix == ".pyc" or "__pycache__" in relative.parts
                or relative.name in {"INSTALLER", "REQUESTED"}):
            continue
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"Invalid accepted portable RECORD path: {relative}")
        path = (site / relative).resolve(strict=True)
        if not path.is_relative_to(site.resolve()):
            raise ValueError(f"Portable RECORD escapes the accepted site-packages: {relative}")
        if path.relative_to(source).as_posix() not in verified_files:
            # The accepted Linux packager omitted every directory named assets,
            # including LiteLLM's installed proxy assets. Preserve those exact
            # portable bytes using the wheel RECORD's SHA256 rather than omit them.
            if "assets" not in relative.parts or relative.hash is None or relative.hash.mode != "sha256":
                raise ValueError(f"Portable RECORD is absent from the accepted manifest: {relative}")
            actual = base64.urlsafe_b64encode(bytes.fromhex(digest(path))).decode("ascii").rstrip("=")
            if actual != relative.hash.value or (relative.size is not None and path.stat().st_size != relative.size):
                raise ValueError(f"Accepted portable RECORD digest differs: {relative}")
        with path.open("rb") as member:
            header = member.read(4)
        if (re.search(r"\.(?:so(?:\..*)?|dll|pyd|dylib|exe)$", path.name, re.IGNORECASE)
                or header == b"\x7fELF" or header[:2] == b"MZ"):
            raise ValueError(f"Native payload in an accepted portable distribution: {relative}")
        target = python / "Lib/site-packages" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)


def unpack_windows_wheel(wheel, package, python, destination):
    site = python / "Lib/site-packages"
    notices = destination / "licenses" / f"{package['name']}-{package['version']}" / "windows-wheel"
    with zipfile.ZipFile(wheel) as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue
            relative = PurePosixPath(member.filename)
            if relative.is_absolute() or ".." in relative.parts or "\\" in member.filename:
                raise ValueError(f"Invalid pinned wheel member: {member.filename}")
            parts = relative.parts
            target = site / Path(*parts)
            if len(parts) >= 3 and parts[0].endswith(".data"):
                roots = {"purelib": site, "platlib": site, "data": python,
                         "scripts": python / "Scripts", "headers": python / "Include"}
                if parts[1] not in roots:
                    raise ValueError(f"Unsupported wheel data location: {member.filename}")
                target = roots[parts[1]] / Path(*parts[2:])
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
            if normalized(package["name"]) not in WINDOWS_WHEELS:
                continue
            if (parts[0].endswith(".dist-info") and len(parts) > 1
                    and (parts[1] == "licenses"
                         or relative.name.upper().startswith(("LICENSE", "LICENCE", "COPYING", "NOTICE", "AUTHORS")))):
                notice = notices / Path(*parts[1:])
                notice.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, notice)
                package["retained_notice_files"].append(notice.relative_to(destination).as_posix())
    package["retained_notice_files"] = sorted(set(package["retained_notice_files"]))
    if not package["retained_notice_files"]:
        raise ValueError(f"Missing retained license notice: {package['name']}")


def package_windows(source, destination, python_zip, wheelhouse):
    inventory, wheels, portable_site = windows_closure(source, wheelhouse)
    if digest(python_zip) != WINDOWS_PYTHON_SHA256:
        raise ValueError("Select the official pinned python-3.12.3-embed-amd64.zip")
    with zipfile.ZipFile(python_zip) as archive:
        if not {"python.exe", "python312.dll", "python312.zip", "python312._pth", "LICENSE.txt"}.issubset(archive.namelist()):
            raise ValueError("Incomplete Windows embeddable Python ZIP")
    repository = Path(__file__).resolve().parent.parent
    context = (repository / "src-tauri/gbot-service/examples/context-preparer.ts").read_text()
    context = context.replace("'../../../web-app/src/lib/smart-context'", "'./smart-context'")
    python = destination / "python"
    if python.exists():
        check(destination, "windows-x64")
        if ((destination / "context-preparer.ts").read_text() != context
                or digest(destination / "smart-context.ts") != digest(repository / "web-app/src/lib/smart-context.ts")):
            raise ValueError("Shared context policy changed; inspect and retire the previous owned package")
        return
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "context-preparer.ts").write_text(context)
    shutil.copy2(repository / "web-app/src/lib/smart-context.ts", destination / "smart-context.ts")
    with zipfile.ZipFile(python_zip) as archive:
        # Keep every official DLL, extension and embedded notice in its shipped layout.
        archive.extractall(python)
    (python / "python312._pth").write_text("python312.zip\n.\nLib/site-packages\n")
    # Retain the accepted Python-package notices, without carrying Linux's
    # unshipped interpreter/native-system notice tree into the Windows package.
    for package in inventory["packages"]:
        for name in package["retained_notice_files"]:
            notice = destination / name
            notice.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source / name, notice)
    python_notices = destination / "licenses/python-3.12.3"
    python_notices.mkdir()
    shutil.copy2(python / "LICENSE.txt", python_notices / "LICENSE.txt")
    verified_files = ({p["path"] for p in json.loads((source / "runtime.json").read_text())["files"]}
                      if portable_site is not None else None)
    for package, wheel in wheels:
        if wheel is None:
            copy_portable_distribution(source, portable_site, package, python, verified_files)
        else:
            unpack_windows_wheel(wheel, package, python, destination)
    (destination / "closure-inventory.json").write_text(json.dumps(inventory, indent=2, sort_keys=True) + "\n")
    packages = inventory["packages"]
    (destination / "requirements.lock").write_text(
        "# Pinned Windows AMD64 / CPython 3.12 Cua base-agent closure.\n"
        f"# Cua fork revision {SDK_REVISION}; accepted portable wheels and source uv.lock Windows pins; no agent extras.\n"
        + "".join(f"{p['name']}=={p['version']} --hash=sha256:{p['sha256']}\n" for p in packages))
    (destination / "closure-inventory.tsv").write_text(
        "name\tversion\tlicense declaration\twheel SHA256\tnotice directory\n"
        + "".join(f"{p['name']}\t{p['version']}\t{p['license_summary']}\t{p['sha256']}\tlicenses/{p['name']}-{p['version']}\n"
                  for p in packages))
    (destination / "current-state.json").write_text(json.dumps({
        "status": "packaged", "source_revision": SDK_REVISION, "agent_source_revision": AGENT_REVISION,
        "image_id": IMAGE, "python": inventory["python"], "package_count": 62,
        "scope": "Offline Windows staging only; no interpreter, imports, guest or agent execution",
        "acceptance": "Pinned official CPython ZIP, 44 accepted portable wheels, 17 Windows replacements and colorama",
        "next_action": "Qualify relocated Windows runtime imports and native discovery",
    }, indent=2) + "\n")
    files = [{"path": p.relative_to(destination).as_posix(), "bytes": p.stat().st_size, "sha256": digest(p)}
             for p in sorted(destination.rglob("*")) if p.is_file() and p != destination / "runtime.json"
             and p.relative_to(destination).parts[0] != "assets"]
    libraries = [p.relative_to(python).as_posix() for p in sorted(python.rglob("*"))
                 if p.is_file() and p.suffix.lower() in {".dll", ".pyd"}]
    manifest = {"schema": "gbot-cua-runtime-v1", "platform": "windows-x64", "python_version": "3.12.3",
                "sdk_revision": SDK_REVISION, "agent_revision": AGENT_REVISION, "closure_image": IMAGE,
                "package_count": 62, "native_libraries": libraries, "system_notices": ["python-3.12.3"],
                "files": files}
    (destination / "runtime.json").write_text(json.dumps(manifest, indent=2) + "\n")
    check(destination, "windows-x64")


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
        check(destination, "linux-x64")
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
    parser.add_argument("--source", type=Path, help="Accepted Python closure, or accepted Linux runtime package for Windows")
    parser.add_argument("--destination", type=Path, required=True, help="Staged resources/gbot directory")
    parser.add_argument("--platform", choices=("linux", "windows"), default="linux", help="Target runtime/guest asset platform")
    parser.add_argument("--windows-python", type=Path, help="Local pinned python-3.12.3-embed-amd64.zip")
    parser.add_argument("--windows-wheelhouse", type=Path, help="Local pinned 17 Windows replacement wheels and colorama")
    parser.add_argument("--guest-assets", type=Path, help="Accepted local guest payload directory; stage without downloads")
    parser.add_argument("--check-guest-assets", action="store_true", help="Verify the exact bundled guest payload pins")
    parser.add_argument("--check", action="store_true", help="Verify the existing package manifest without staging")
    args = parser.parse_args()
    if args.check_guest_assets:
        check_guest_assets(args.destination.resolve(strict=True), args.platform)
    elif args.guest_assets:
        stage_guest_assets(args.guest_assets.resolve(strict=True), args.destination.resolve(), args.platform)
    elif args.check:
        check(args.destination.resolve(strict=True))
    elif args.source:
        if args.platform == "windows":
            if args.windows_python is None or args.windows_wheelhouse is None:
                parser.error("Windows staging requires --windows-python and --windows-wheelhouse")
            package_windows(args.source.resolve(strict=True), args.destination.resolve(),
                            args.windows_python.resolve(strict=True), args.windows_wheelhouse.resolve(strict=True))
        else:
            if args.windows_python is not None or args.windows_wheelhouse is not None:
                parser.error("Windows inputs require --platform windows")
            package(args.source.resolve(strict=True), args.destination.resolve())
    else:
        parser.error("--source or --guest-assets is required when staging")
