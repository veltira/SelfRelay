#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/apps/extension/public/vendor/whisper"
WORK="${RUNNER_TEMP:-/tmp}/selfrelay-whisper-build"
EMSDK_VERSION="4.0.12"
WHISPER_VERSION="v1.9.1"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/c521a4b02f422512d734391fdf08bb08c0862f68/ggml-tiny-q5_1.bin?download=true"
MODEL_SHA256="818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7"

rm -rf "$WORK"
mkdir -p "$WORK" "$OUT"
rm -f "$OUT/selfrelay-whisper.js" "$OUT/selfrelay-whisper.wasm" "$OUT/ggml-tiny-q5_1.bin"

git clone --quiet --depth 1 --branch "$EMSDK_VERSION" https://github.com/emscripten-core/emsdk.git "$WORK/emsdk"
"$WORK/emsdk/emsdk" install "$EMSDK_VERSION"
"$WORK/emsdk/emsdk" activate "$EMSDK_VERSION"
# shellcheck disable=SC1091
source "$WORK/emsdk/emsdk_env.sh"

git clone --quiet --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp.git "$WORK/whisper.cpp"
mkdir -p "$WORK/whisper.cpp/examples/selfrelay"
cp "$ROOT/tools/whisper/selfrelay-whisper.cpp" "$WORK/whisper.cpp/examples/selfrelay/selfrelay-whisper.cpp"
cp "$ROOT/tools/whisper/CMakeLists.txt" "$WORK/whisper.cpp/examples/selfrelay/CMakeLists.txt"
printf '\nadd_subdirectory(examples/selfrelay)\n' >> "$WORK/whisper.cpp/CMakeLists.txt"

emcmake cmake -S "$WORK/whisper.cpp" -B "$WORK/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=OFF \
  -DWHISPER_BUILD_SERVER=OFF \
  -DGGML_NATIVE=OFF
cmake --build "$WORK/build" --target selfrelay-whisper --config Release -j2

RUNTIME_JS="$(find "$WORK/build" -type f -name 'selfrelay-whisper.js' -print -quit)"
RUNTIME_WASM="$(find "$WORK/build" -type f -name 'selfrelay-whisper.wasm' -print -quit)"
test -n "$RUNTIME_JS" && test -n "$RUNTIME_WASM"
cp "$RUNTIME_JS" "$OUT/selfrelay-whisper.js"
cp "$RUNTIME_WASM" "$OUT/selfrelay-whisper.wasm"

curl --fail --location --retry 3 --silent --show-error "$MODEL_URL" -o "$OUT/ggml-tiny-q5_1.bin"
echo "$MODEL_SHA256  $OUT/ggml-tiny-q5_1.bin" | sha256sum --check --status

test "$(stat -c%s "$OUT/ggml-tiny-q5_1.bin")" -eq 32152673
printf 'Prepared SelfRelay local transcription runtime: %s\n' "$OUT"
