#!/usr/bin/env bash
# Publishes a locally built macOS release for the in-app updater, and as a download, on the
# VoxStudio website. Additive only: writes under /var/www/vox-studio/updates on the VPS.
#
#   npm run release:mac && scripts/publish-update.sh "Release notes…"
set -euo pipefail
# The server lives in a local, git-ignored file: echo 'VOX_DEPLOY_HOST=user@server' > .deploy.env
[ -f "$(dirname "$0")/../.deploy.env" ] && . "$(dirname "$0")/../.deploy.env"
HOST="${VOX_DEPLOY_HOST:?Set VOX_DEPLOY_HOST=user@server (for example in .deploy.env at the repo root)}"
ROOT="/var/www/vox-studio/updates"
BASE_URL="https://vox-studio.devops-monk.com/updates"
cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
TARGET="$(rustc -vV | sed -n 's/^host: //p')"
case "$TARGET" in
  aarch64-apple-darwin) PLATFORM="darwin-aarch64" ;;
  x86_64-apple-darwin)  PLATFORM="darwin-x86_64" ;;
  *) echo "Run this on the Mac that built the release"; exit 1 ;;
esac
BUNDLE="src-tauri/target/release/bundle"
TARBALL="$BUNDLE/macos/VoxStudio.app.tar.gz"
DMG="$(ls "$BUNDLE"/dmg/VoxStudio_"$VERSION"_*.dmg | head -1)"
[ -f "$TARBALL" ] && [ -f "$TARBALL.sig" ] && [ -f "$DMG" ] || { echo "Build first: npm run release:mac"; exit 1; }

NOTES="${1:-VoxStudio $VERSION}"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$VERSION"
cp "$TARBALL" "$STAGE/$VERSION/VoxStudio_${VERSION}_${PLATFORM}.app.tar.gz"
cp "$DMG" "$STAGE/$VERSION/"
node -e '
const [version, platform, sig, url, notes] = process.argv.slice(1)
process.stdout.write(JSON.stringify({ version, notes, pub_date: new Date().toISOString(),
  platforms: { [platform]: { signature: sig, url } } }, null, 2))
' "$VERSION" "$PLATFORM" "$(cat "$TARBALL.sig")" "$BASE_URL/$VERSION/VoxStudio_${VERSION}_${PLATFORM}.app.tar.gz" "$NOTES" > "$STAGE/latest.json"

echo "→ Uploading $VERSION ($PLATFORM)"
ssh "$HOST" "mkdir -p $ROOT"
rsync -az --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r "$STAGE/$VERSION" "$HOST:$ROOT/"
# latest.json last, so clients never see a manifest pointing at files that aren't there yet.
rsync -az --chmod=Fu=rw,Fgo=r "$STAGE/latest.json" "$HOST:$ROOT/latest.json"
echo "✓ $BASE_URL/latest.json → $VERSION"
