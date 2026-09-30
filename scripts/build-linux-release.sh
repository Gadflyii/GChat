#!/usr/bin/env bash
# Run in the Ubuntu 24.04 build environment; final packages need no build tools.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

runtime_set=${GINFER_RUNTIME_SET:-}
catalog_directory=${GINFER_PROFILE_CATALOG_DIRECTORY:-}
while (($#)); do
  case "$1" in
    --runtime-set) runtime_set=$2; shift 2 ;;
    --profile-catalog-directory) catalog_directory=$2; shift 2 ;;
    *) echo "Usage: $0 --runtime-set DIR --profile-catalog-directory DIR" >&2; exit 2 ;;
  esac
done
: "${runtime_set:?Select the complete GInfer Linux runtime set}"
: "${catalog_directory:?Select the GInfer launch-profile catalog directory}"
source /etc/os-release
if [[ $ID != ubuntu || $VERSION_ID != 24.04 ]]; then
  echo 'Build Linux releases in Ubuntu 24.04 to preserve the deployment ABI.' >&2
  exit 1
fi
python=${PYTHON:-python3}
"$python" scripts/stage-linux-runtime-set.py --source "$runtime_set" \
  --destination src-tauri/resources/ginfer/linux
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
(cd extensions && yarn install --immutable)
yarn build:extensions:linux
yarn copy:assets:tauri
yarn build:icon
for binary in bun uv uv-x86_64-unknown-linux-gnu sqlite-vec.so; do
  test -s "src-tauri/resources/bin/$binary" || {
    echo "Missing release resource $binary; run yarn download:bin / yarn download:lib." >&2
    exit 1
  }
done
make build-cli
NO_STRIP=1 yarn tauri build --bundles deb

# Linuxdeploy must not rewrite checksummed engine ELF files or absorb driver libraries.
mkdir -p out/linux
"$python" - <<'PY'
import json
from pathlib import Path
config=json.loads(Path('src-tauri/tauri.linux.conf.json').read_text())
resources=[p for p in config['bundle']['resources'] if not p.startswith('resources/ginfer/')]
Path('out/linux/appimage-config.json').write_text(json.dumps({'bundle':{'resources':resources}}))
PY
NO_STRIP=1 ./src-tauri/build-utils/shim-linuxdeploy.sh yarn tauri bundle \
  --bundles appimage --config out/linux/appimage-config.json
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
