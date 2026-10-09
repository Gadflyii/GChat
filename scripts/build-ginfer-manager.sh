#!/usr/bin/env bash
set -euo pipefail

manager_source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
manager_output="${GINFER_MANAGER_OUTPUT:-$manager_source_root/out/ginfer-manager/linux}"
manager_guide="$manager_source_root/docs/ginfer-manager/guide.md"
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  printf 'This builder targets native Linux x86_64. Use build-ginfer-manager.ps1 on Windows.\n' >&2
  exit 1
fi
if [[ ! -f "$manager_guide" ]]; then
  printf 'Missing Manager operator guide: %s\n' "$manager_guide" >&2
  exit 1
fi
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$manager_source_root/src-tauri/target}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-6}"
manager_output="$(realpath -m -- "$manager_output")"
mkdir -p -- "$manager_output"

# Assembly may already hold this canonical lock before the GPU guard. Reuse its
# open file description; opening the path again would deadlock the parent.
manager_lock=/ai/coordination/locks/local-build.lock
mkdir -p /ai/coordination/locks
manager_build=(cargo build --manifest-path "$manager_source_root/src-tauri/Cargo.toml"
  -p ginfer-manager -p ginfer-host --release --locked)
if [[ -n ${GINFER_BUILD_LOCK_FD:-} ]]; then
  if [[ ! $GINFER_BUILD_LOCK_FD =~ ^[0-9]+$ ]] ||
     [[ ! -e /proc/self/fd/$GINFER_BUILD_LOCK_FD ]] ||
     [[ $(stat -Lc '%d:%i' "/proc/self/fd/$GINFER_BUILD_LOCK_FD") != $(stat -Lc '%d:%i' "$manager_lock") ]]; then
    printf 'Inherited Manager build descriptor must refer to the canonical build lock.\n' >&2
    exit 1
  fi
  flock -n -E 75 "$GINFER_BUILD_LOCK_FD"
  "${manager_build[@]}"
else
  flock "$manager_lock" "${manager_build[@]}"
fi

install -m755 "$CARGO_TARGET_DIR/release/ginfer-manager" "$manager_output/ginfer-manager"
install -m755 "$CARGO_TARGET_DIR/release/ginfer-host" "$manager_output/ginfer-host"
install -m644 "$manager_guide" "$manager_output/GUIDE.md"
install -m644 "$manager_source_root/web-app/public/fonts/geist/OFL.txt" "$manager_output/FONT-LICENSE.txt"
tar -czf "$manager_output/ginfer-manager-linux-x64.tar.gz" -C "$manager_output" \
  ginfer-manager ginfer-host GUIDE.md FONT-LICENSE.txt
(cd -- "$manager_output" && sha256sum ginfer-manager ginfer-host \
  ginfer-manager-linux-x64.tar.gz > SHA256SUMS)
printf 'Manager package: %s\n' "$manager_output/ginfer-manager-linux-x64.tar.gz"
