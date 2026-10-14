#!/usr/bin/env bash
# Run in the Ubuntu 24.04 build environment; final packages need no build tools.
set -euo pipefail
ulimit -c 0
cd "$(dirname "${BASH_SOURCE[0]}")/.."

runtime_set=${GINFER_RUNTIME_SET:-}
catalog_directory=${GINFER_PROFILE_CATALOG_DIRECTORY:-}
gbot_cua_runtime=${GBOT_CUA_RUNTIME:-}
gbot_guest_assets=${GBOT_GUEST_ASSETS:-}
while (($#)); do
  case "$1" in
    --runtime-set) runtime_set=$2; shift 2 ;;
    --profile-catalog-directory) catalog_directory=$2; shift 2 ;;
    --gbot-cua-runtime) gbot_cua_runtime=$2; shift 2 ;;
    --gbot-guest-assets) gbot_guest_assets=$2; shift 2 ;;
    *) echo "Usage: $0 --runtime-set DIR --profile-catalog-directory DIR --gbot-cua-runtime DIR --gbot-guest-assets DIR" >&2; exit 2 ;;
  esac
done
: "${runtime_set:?Select the complete GInfer Linux runtime set}"
: "${catalog_directory:?Select the GInfer launch-profile catalog directory}"
: "${gbot_cua_runtime:?Select the accepted Gbot python-runtime closure}"
: "${gbot_guest_assets:?Select the exact accepted local Gbot guest payload directory}"
source /etc/os-release
if [[ $ID != ubuntu || $VERSION_ID != 24.04 ]]; then
  echo 'Build Linux releases in Ubuntu 24.04 to preserve the deployment ABI.' >&2
  exit 1
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Linux release assembly requires Node.js 22 or newer"); process.exit(1); }'
python=${PYTHON:-python3}
"$python" scripts/stage-linux-runtime-set.py --source "$runtime_set" \
  --destination src-tauri/resources/ginfer/linux \
  --operator-docs-destination src-tauri/resources/ginfer/docs
export GINFER_PROFILE_CATALOGS
GINFER_PROFILE_CATALOGS=$("$python" - "$catalog_directory" <<'PY'
import json,sys
from pathlib import Path
files=sorted(Path(sys.argv[1]).resolve().glob('linux-*.json'))
ids=set()
if not files: raise SystemExit('No Linux profile catalogs selected')
for path in files:
    data=json.loads(path.read_text())
    if data.get('schema') != 'ginfer-launch-profiles-v1' or not data.get('profiles'):
        raise SystemExit(f'Invalid catalog: {path}')
    for profile in data['profiles']:
        if profile.get('platform') != 'linux' or not profile.get('id') or profile['id'] in ids:
            raise SystemExit(f'Invalid/duplicate Linux profile in {path}')
        ids.add(profile['id'])
print(':'.join(map(str,files)))
PY
)
yarn install --immutable
yarn build:core
# The extension project consumes the core tarball produced by this build.
(cd extensions && YARN_ENABLE_IMMUTABLE_INSTALLS=false yarn install)
yarn build:extensions:linux
yarn copy:assets:tauri
"$python" scripts/package-gbot-runtime.py --source "$gbot_cua_runtime" \
  --destination src-tauri/resources/gbot
"$python" scripts/package-gbot-runtime.py --guest-assets "$gbot_guest_assets" \
  --destination src-tauri/resources/gbot
yarn build:icon
for binary in bun uv uv-x86_64-unknown-linux-gnu sqlite-vec.so; do
  test -s "src-tauri/resources/bin/$binary" || {
    echo "Missing release resource $binary; run yarn download:bin / yarn download:lib." >&2
    exit 1
  }
done
make build-cli
NO_STRIP=1 yarn tauri build --no-bundle
mkdir -p out/linux
cp src-tauri/target/release/gchat out/linux/gchat-unbundled
trap 'cp out/linux/gchat-unbundled src-tauri/target/release/gchat' EXIT
NO_STRIP=1 yarn tauri bundle --bundles deb
cp out/linux/gchat-unbundled src-tauri/target/release/gchat

# Linuxdeploy must not rewrite checksummed engine or private Python ELF files.
mkdir -p out/linux
"$python" - <<'PY'
import json,shutil
from pathlib import Path
staging=Path('src-tauri/target/release/bundle/appimage_deb')
if staging.exists(): shutil.rmtree(staging)
config=json.loads(Path('src-tauri/tauri.linux.conf.json').read_text())
resources=[p for p in config['bundle']['resources'] if not p.startswith(('resources/ginfer/linux/', 'resources/gbot/')) and p not in ('resources/bin/bun', 'resources/bin/uv')]
Path('out/linux/appimage-config.json').write_text(json.dumps({'bundle':{'resources':resources}}))
PY
# The output plugin forwards this cached runtime to appimagetool --runtime-file.
if [[ -s .cache/build-tools/type2-runtime-x86_64 ]]; then
  export LDAI_RUNTIME_FILE="$PWD/.cache/build-tools/type2-runtime-x86_64"
fi
NO_STRIP=1 APPIMAGE_EXTRACT_AND_RUN=1 ./src-tauri/build-utils/shim-linuxdeploy.sh yarn tauri bundle \
  --verbose --bundles appimage --config out/linux/appimage-config.json
./src-tauri/build-utils/buildAppImage.sh
"$python" - <<'PY'
import hashlib,json,shutil
from pathlib import Path
version=json.loads(Path('src-tauri/tauri.conf.json').read_text())['version']
for directory,suffix in [('deb','deb'),('appimage','AppImage')]:
    name=f'GChat_{version}_amd64.{suffix}'
    source=Path('src-tauri/target/release/bundle')/directory/name
    if not source.is_file(): raise SystemExit(f'Missing final package: {source}')
    target=Path('out/linux')/name
    shutil.copy2(source,target)
    with target.open('rb') as stream: digest=hashlib.file_digest(stream,'sha256').hexdigest()
    target.with_suffix(target.suffix+'.sha256').write_text(f'{digest}  {name}\n')
    print(target)
PY
