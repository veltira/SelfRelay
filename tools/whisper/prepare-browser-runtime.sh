#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/apps/extension/public/vendor/whisper"
WORK="${RUNNER_TEMP:-/tmp}/selfrelay-whisper-build"
EMSDK_VERSION="4.0.12"
WHISPER_VERSION="v1.9.1"
MODEL_COMMIT="c521a4b02f422512d734391fdf08bb08c0862f68"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_COMMIT}/ggml-base-q5_1.bin?download=true"
MODEL_SHA256="422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898"
TINY_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_COMMIT}/ggml-tiny-q5_1.bin?download=true"
TINY_SHA256="818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7"
SPANISH_SAMPLE_COMMIT="f86a51a04e5c9e6b82dc9f22c01ada4cb8c40c5f"
SPANISH_SAMPLE_URL="https://raw.githubusercontent.com/wudale/whisper-asr-server/${SPANISH_SAMPLE_COMMIT}/samples/es.wav"

rm -rf "$WORK"
mkdir -p "$WORK" "$OUT"
rm -f "$OUT/selfrelay-whisper.js" "$OUT/selfrelay-whisper.wasm" "$OUT/ggml-tiny-q5_1.bin" "$OUT/ggml-base-q5_1.bin"

git clone --quiet --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp.git "$WORK/whisper.cpp"
curl --fail --location --retry 3 --silent --show-error "$MODEL_URL" -o "$OUT/ggml-base-q5_1.bin"
echo "$MODEL_SHA256  $OUT/ggml-base-q5_1.bin" | sha256sum --check --status

# Real short Spanish speech smoke test, pinned to an immutable public commit.
# tiny-q5_1 is downloaded only for the quality comparison and is never packaged.
curl --fail --location --retry 3 --silent --show-error "$SPANISH_SAMPLE_URL" -o "$WORK/spanish.wav"
curl --fail --location --retry 3 --silent --show-error "$TINY_URL" -o "$WORK/ggml-tiny-q5_1.bin"
echo "$TINY_SHA256  $WORK/ggml-tiny-q5_1.bin" | sha256sum --check --status
cmake -S "$WORK/whisper.cpp" -B "$WORK/native" \
  -DCMAKE_BUILD_TYPE=Release \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_SERVER=OFF
cmake --build "$WORK/native" --target whisper-cli --config Release -j2
WHISPER_CLI="$(find "$WORK/native" -type f -name 'whisper-cli' -perm -111 -print -quit)"
test -n "$WHISPER_CLI"
"$WHISPER_CLI" -m "$WORK/ggml-tiny-q5_1.bin" -f "$WORK/spanish.wav" -l es -otxt -of "$WORK/spanish-tiny" >/dev/null 2>&1
"$WHISPER_CLI" -m "$OUT/ggml-base-q5_1.bin" -f "$WORK/spanish.wav" -l es -otxt -of "$WORK/spanish-base" >/dev/null 2>&1
printf 'tiny-q5_1 Spanish sample: %s\n' "$(tr '\n' ' ' < "$WORK/spanish-tiny.txt")"
printf 'base-q5_1 Spanish sample: %s\n' "$(tr '\n' ' ' < "$WORK/spanish-base.txt")"
score(){ local file="$1" result=0; for token in hola prueba sistema reconocimiento; do if grep -Eiq "${token}" "$file"; then result=$((result+1)); fi; done; printf '%s' "$result"; }
TINY_SCORE="$(score "$WORK/spanish-tiny.txt")"
BASE_SCORE="$(score "$WORK/spanish-base.txt")"
printf 'Spanish keyword recall comparison: tiny=%s/4 base=%s/4\n' "$TINY_SCORE" "$BASE_SCORE"
test "$BASE_SCORE" -ge 3
test "$BASE_SCORE" -ge "$TINY_SCORE"

# Build the exact single-thread browser runtime after the native quality smoke.
git clone --quiet --depth 1 --branch "$EMSDK_VERSION" https://github.com/emscripten-core/emsdk.git "$WORK/emsdk"
"$WORK/emsdk/emsdk" install "$EMSDK_VERSION"
"$WORK/emsdk/emsdk" activate "$EMSDK_VERSION"
# shellcheck disable=SC1091
source "$WORK/emsdk/emsdk_env.sh"
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
printf 'Prepared SelfRelay local transcription runtime with multilingual base-q5_1: %s\n' "$OUT"
