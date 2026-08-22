#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/apps/extension/public/fonts"
IBM_PLEX_COMMIT="1da12f02587b630c07e92692d21492d722f53614"
BASE="https://raw.githubusercontent.com/IBM/plex/${IBM_PLEX_COMMIT}"
FONT_BASE="$BASE/packages/plex-sans/fonts/complete/woff2"

mkdir -p "$OUT"
for weight in Regular Medium SemiBold; do
  curl --fail --location --retry 3 --silent --show-error "$FONT_BASE/IBMPlexSans-${weight}.woff2" -o "$OUT/IBMPlexSans-${weight}.woff2"
  test -s "$OUT/IBMPlexSans-${weight}.woff2"
done
curl --fail --location --retry 3 --silent --show-error "$BASE/LICENSE.txt" -o "$OUT/IBM-Plex-LICENSE.txt"
test -s "$OUT/IBM-Plex-LICENSE.txt"
printf 'Prepared IBM Plex Sans webfonts from pinned commit %s\n' "$IBM_PLEX_COMMIT"
