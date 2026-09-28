#!/usr/bin/env bash
# Downloads the uv binary that ships inside VoxStudio (Tauri sidecar) for one target, verifying
# the SHA-256 that astral-sh publishes next to each release asset.
#
#   scripts/fetch-uv.sh                       # this machine's target
#   scripts/fetch-uv.sh x86_64-pc-windows-msvc
set -euo pipefail
UV_VERSION="${UV_VERSION:-0.12.19}"
TARGET="${1:-$(rustc -vV | sed -n 's/^host: //p')}"
cd "$(dirname "$0")/../src-tauri"
mkdir -p binaries

case "$TARGET" in
  *windows*) ARCHIVE="uv-$TARGET.zip"; EXE="uv.exe"; OUT="binaries/uv-$TARGET.exe" ;;
  *)         ARCHIVE="uv-$TARGET.tar.gz"; EXE="uv"; OUT="binaries/uv-$TARGET" ;;
esac
if [ -x "$OUT" ] && "$OUT" --version 2>/dev/null | grep -q "uv $UV_VERSION"; then
  echo "✓ $OUT is already uv $UV_VERSION"; exit 0
fi

BASE="https://github.com/astral-sh/uv/releases/download/$UV_VERSION"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "→ Downloading $ARCHIVE ($UV_VERSION)"
curl -fsSL "$BASE/$ARCHIVE" -o "$TMP/$ARCHIVE"
curl -fsSL "$BASE/$ARCHIVE.sha256" -o "$TMP/$ARCHIVE.sha256"
EXPECTED="$(cut -d' ' -f1 < "$TMP/$ARCHIVE.sha256")"
ACTUAL="$( (command -v sha256sum >/dev/null && sha256sum "$TMP/$ARCHIVE" || shasum -a 256 "$TMP/$ARCHIVE") | cut -d' ' -f1)"
[ "$EXPECTED" = "$ACTUAL" ] || { echo "✗ checksum mismatch for $ARCHIVE"; exit 1; }

case "$ARCHIVE" in
  *.zip) (cd "$TMP" && unzip -q "$ARCHIVE") ;;
  *)     tar -xzf "$TMP/$ARCHIVE" -C "$TMP" ;;
esac
cp "$(find "$TMP" -name "$EXE" -type f | head -1)" "$OUT"
chmod +x "$OUT"
echo "✓ $OUT ($("$OUT" --version 2>/dev/null || echo "$TARGET"))"
