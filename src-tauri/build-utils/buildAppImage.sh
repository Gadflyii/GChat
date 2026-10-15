#!/bin/bash
set -euo pipefail

# Repackage using gzip for AppImageLauncher and preserve verified engine ELF files.

RUNTIME="./.cache/build-tools/type2-runtime-x86_64"
RELEASE_CHANNEL=${RELEASE_CHANNEL:-"stable"}
PRODUCT_NAME="GChat"

command -v mksquashfs >/dev/null \
  || { echo "mksquashfs not found; install squashfs-tools."; exit 1; }

mkdir -p ./.cache/build-tools
if [ ! -f "${RUNTIME}" ]; then
  wget https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64 -O "${RUNTIME}" \
    || { echo "Failed to download AppImage type2 runtime."; exit 1; }
fi

if [ "${RELEASE_CHANNEL}" != "stable" ]; then
  APP_DIR="./src-tauri/target/release/bundle/appimage/${PRODUCT_NAME}-${RELEASE_CHANNEL}.AppDir"
  RESOURCE_DIR="${APP_DIR}/usr/lib/${PRODUCT_NAME}-${RELEASE_CHANNEL}/resources"
else
  APP_DIR="./src-tauri/target/release/bundle/appimage/${PRODUCT_NAME}.AppDir"
  RESOURCE_DIR="${APP_DIR}/usr/lib/${PRODUCT_NAME}/resources"
fi

if [ ! -d "${APP_DIR}" ]; then
  echo "AppDir not found at: ${APP_DIR}"
  echo "Contents of bundle/appimage/:"
  ls -la ./src-tauri/target/release/bundle/appimage/ || true
  exit 1
fi

# GStreamer pulls in libraries also used by host libvirt/SSH tools. Keep those
# tools on their host ABI instead of shadowing it with older bundled libraries.
# Only prune the AppDir library root; engine and Cua private libraries stay intact.
HOST_LIBRARIES=(
  libapparmor.so.1 libcrypto.so.3 libcurl-gnutls.so.4 liblber.so.2
  libldap.so.2 libnuma.so.1 libreadline.so.8 librtmp.so.1
  libsasl2.so.2 libssh.so.4 libssl.so.3 libtinfo.so.6
)
for library in "${HOST_LIBRARIES[@]}"; do
  rm -f -- "${APP_DIR}/usr/lib/${library}" "${APP_DIR}/usr/lib/${library}".*
done

install -m755 src-tauri/resources/bin/bun "${RESOURCE_DIR}/bin/bun"
install -m755 src-tauri/resources/bin/uv "${RESOURCE_DIR}/bin/uv"

# Add the engines after linuxdeploy; their private libraries/RPATHs are already verified.
"${PYTHON:-python3}" scripts/stage-linux-runtime-set.py \
  --source src-tauri/resources/ginfer/linux \
  --destination "${RESOURCE_DIR}/ginfer/linux"

# Keep the accepted Cua interpreter, extension libraries and notices unchanged.
"${PYTHON:-python3}" scripts/package-gbot-runtime.py \
  --check-guest-assets --destination src-tauri/resources/gbot
"${PYTHON:-python3}" scripts/package-gbot-runtime.py \
  --check --destination src-tauri/resources/gbot
"${PYTHON:-python3}" - "${RESOURCE_DIR}/gbot" <<'PY'
import shutil,sys
from pathlib import Path
destination=Path(sys.argv[1])
if destination.exists(): shutil.rmtree(destination)
shutil.copytree('src-tauri/resources/gbot', destination)
PY
"${PYTHON:-python3}" scripts/package-gbot-runtime.py \
  --check --destination "${RESOURCE_DIR}/gbot"

"${PYTHON:-python3}" scripts/package-gbot-runtime.py \
  --check-guest-assets --destination "${RESOURCE_DIR}/gbot"

# Remove the AppImage produced by `tauri build` — we are about to
# repackage from the unpacked AppDir.
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
APP_IMAGE="./src-tauri/target/release/bundle/appimage/${PRODUCT_NAME}_${VERSION}_amd64.AppImage"

# AppImageLauncher's squashfuse cannot mount the zstd image produced by
# appimagetool continuous. Assemble a type-2 AppImage with gzip instead.
SQUASHFS="${APP_IMAGE}.squashfs"
rm -f "${SQUASHFS}"
mksquashfs "${APP_DIR}" "${SQUASHFS}" -comp gzip -root-owned -noappend -quiet
cat "${RUNTIME}" "${SQUASHFS}" > "${APP_IMAGE}"
rm -f "${SQUASHFS}"
chmod +x "${APP_IMAGE}"
echo "AppImage created: ${APP_IMAGE}"
