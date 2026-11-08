#!/usr/bin/env bash
set -euo pipefail
INPUTS=$(realpath "$1")
OUTPUT=$(realpath "$2")
RECIPE_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
TASK_BUILD_DIR=$(mktemp -d /tmp/c2s-drawing-build-XXXXXXXX)
mkdir -p "$TASK_BUILD_DIR/core" "$TASK_BUILD_DIR/build_tools" "$TASK_BUILD_DIR/dep-stage"
tar -xzf "$INPUTS/core-d54f0326.tar.gz" --strip-components=1 -C "$TASK_BUILD_DIR/core"
tar -xzf "$INPUTS/build-tools-10118f4c.tar.gz" --strip-components=1 -C "$TASK_BUILD_DIR/build_tools"
mkdir -p "$TASK_BUILD_DIR/core/Common/js/emsdk"
tar -xzf "$INPUTS/emsdk-f677ef91.tar.gz" --strip-components=1 -C "$TASK_BUILD_DIR/core/Common/js/emsdk"
mkdir -p "$TASK_BUILD_DIR/dep-stage/icu"
tar -xzf "$INPUTS/icu-2d029329.tar.gz" --strip-components=1 -C "$TASK_BUILD_DIR/dep-stage/icu"
mv "$TASK_BUILD_DIR/dep-stage/icu/icu4c" "$TASK_BUILD_DIR/core/Common/3dParty/icu/icu"
mkdir -p "$TASK_BUILD_DIR/core/Common/3dParty/harfbuzz/harfbuzz" "$TASK_BUILD_DIR/core/Common/3dParty/brotli/brotli"
tar -xzf "$INPUTS/harfbuzz-894a1f72.tar.gz" --strip-components=1 -C "$TASK_BUILD_DIR/core/Common/3dParty/harfbuzz/harfbuzz"
tar -xzf "$INPUTS/brotli-a47d7475.tar.gz" --strip-components=1 -C "$TASK_BUILD_DIR/core/Common/3dParty/brotli/brotli"
cd "$TASK_BUILD_DIR/core/Common/js/emsdk"
mkdir -p downloads
cp "$INPUTS/node-v16.20.0-linux-x64.tar.xz" downloads/
cp "$INPUTS/emscripten-3.1.48-wasm-binaries.tar.xz" downloads/694434b6d47c5f6eff2c8fbd9eeb016c977ae9dc-wasm-binaries.tar.xz
export EMSDK_KEEP_DOWNLOADS=1
./emsdk install 3.1.48
./emsdk activate 3.1.48
mkdir -p "$TASK_BUILD_DIR/tool-bin"
ln -s "$(command -v python3)" "$TASK_BUILD_DIR/tool-bin/python"
export PATH="$TASK_BUILD_DIR/tool-bin:$PATH"
python3 "$RECIPE_DIR/patch-drawing.py" "$TASK_BUILD_DIR"
test ! -d "$TASK_BUILD_DIR/core/Common/3dParty/openssl/openssl"
cd "$TASK_BUILD_DIR/core/Common/js"
python3 make.py ../../DesktopEditor/graphics/pro/js/drawingfile-no-openssl.json
cp "$TASK_BUILD_DIR/core/DesktopEditor/graphics/pro/js/deploy/drawingfile.js" "$OUTPUT/"
cp "$TASK_BUILD_DIR/core/DesktopEditor/graphics/pro/js/deploy/drawingfile.wasm" "$OUTPUT/"
printf 'Built from %s\n' "$TASK_BUILD_DIR"
sha256sum "$OUTPUT/drawingfile.js" "$OUTPUT/drawingfile.wasm"
