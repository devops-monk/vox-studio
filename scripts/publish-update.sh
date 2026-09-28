#!/usr/bin/env bash
# Points installed copies at a published GitHub release: copies the release's signed updater
# manifest (latest.json, whose URLs are the public GitHub downloads) into the website, then
# deploys the website. Run after publishing the release on GitHub.
#
#   scripts/publish-update.sh v0.2.0
set -euo pipefail
TAG="${1:?Usage: scripts/publish-update.sh vX.Y.Z}"
cd "$(dirname "$0")/.."
DRAFT="$(gh release view "$TAG" --json isDraft --jq .isDraft)"
[ "$DRAFT" = "false" ] || { echo "Publish $TAG on GitHub first (it's still a draft)"; exit 1; }
mkdir -p website/public/updates
gh release download "$TAG" -p latest.json -O website/public/updates/latest.json --clobber
VERSION="$(node -p "require('./website/public/updates/latest.json').version")"
echo "→ Updates now offer $VERSION"
(cd website && node build.mjs && ./deploy.sh)
echo "✓ https://vox-studio.devops-monk.com/updates/latest.json → $VERSION (commit website/public/updates/latest.json)"
