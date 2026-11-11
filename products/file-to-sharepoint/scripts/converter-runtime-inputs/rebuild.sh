#!/usr/bin/env bash
# Development only. Requires Docker with buildx and a Linux build environment.
set -euo pipefail
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then echo 'Usage: rebuild.sh source-selection.json output-directory [--capture-reference]' >&2; exit 2; fi
recipe_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
selection=$(realpath -- "$1")
mkdir -p -- "$2"
output=$(realpath -- "$2")
work=$(mktemp -d "${C2S_CONVERTER_BUILD_ROOT:-/tmp}/c2s-converter.XXXXXXXX")
printf 'Preserved build directory: %s\n' "$work"
python3 "$recipe_dir/prepare-context.py" "$selection" "$work/context" "${@:3}"
docker_command=(docker --context default)
build_output="$output"
# Docker Desktop can put a nonfunctional shell shim on WSL's PATH. Probe the
# client before selecting it; the Windows client is the supported fallback.
if ! command -v docker >/dev/null 2>&1 || ! docker --context default version --format '{{.Client.Os}}' >/dev/null 2>&1; then
  if ! command -v docker.exe >/dev/null 2>&1; then
    echo 'No working Docker client is available.' >&2; exit 2
  fi
  docker_command=(docker.exe --context default)
  build_output=$(wslpath -w "$build_output")
fi
# Preserve native archive symlinks when the context is on a WSL filesystem.
# A Windows UNC directory walk cannot represent every upstream Linux link.
tar -C "$work/context" -cf - . | "${docker_command[@]}" buildx build --builder "${BUILDX_BUILDER:-default}" \
  --allow network.host --network=none --progress=plain --target output \
  --output "type=local,dest=$build_output" - 2>&1 | tee "$output/build.log"
cp -- "$work/context/source-selection.json" "$output/source-selection.json"
