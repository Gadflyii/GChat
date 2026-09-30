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

# Add the engines after linuxdeploy; their private libraries/RPATHs are already verified.
"${PYTHON:-python3}" scripts/stage-linux-runtime-set.py \
  --source src-tauri/resources/ginfer/linux \
  --destination "${RESOURCE_DIR}/ginfer/linux"

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
