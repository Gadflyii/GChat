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

# Serialize this scoped build with the host/client checks that share the cache.
flock /tmp/ginfer-local-build.lock cargo build \
  --manifest-path "$manager_source_root/src-tauri/Cargo.toml" \
  -p ginfer-manager -p ginfer-host --release --locked

install -m755 "$CARGO_TARGET_DIR/release/ginfer-manager" "$manager_output/ginfer-manager"
install -m755 "$CARGO_TARGET_DIR/release/ginfer-host" "$manager_output/ginfer-host"
install -m644 "$manager_guide" "$manager_output/GUIDE.md"
install -m644 "$manager_source_root/web-app/public/fonts/geist/OFL.txt" "$manager_output/FONT-LICENSE.txt"
tar -czf "$manager_output/ginfer-manager-linux-x64.tar.gz" -C "$manager_output" \
  ginfer-manager ginfer-host GUIDE.md FONT-LICENSE.txt
(cd -- "$manager_output" && sha256sum ginfer-manager ginfer-host \
  ginfer-manager-linux-x64.tar.gz > SHA256SUMS)
printf 'Manager package: %s\n' "$manager_output/ginfer-manager-linux-x64.tar.gz"
