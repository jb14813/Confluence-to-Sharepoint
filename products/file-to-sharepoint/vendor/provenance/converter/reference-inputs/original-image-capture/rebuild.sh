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
docker buildx build --network=host --progress=plain --target output \
  --output "type=local,dest=$output" "$work/context" 2>&1 | tee "$output/build.log"
cp -- "$work/context/source-selection.json" "$output/source-selection.json"
