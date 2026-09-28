# Releasing VoxStudio

## What a release contains
- The Tauri app, with `uv` bundled as a sidecar (`scripts/fetch-uv.sh` downloads and SHA-256-checks it), and the voxd sources plus `uv.lock` as resources.
- On first launch, the app runs `uv run --frozen` against those resources. This creates the engine runtime in the user's data folder, and keeps Python bytecode out of the signed bundle.
- An updater archive (`VoxStudio.app.tar.gz` plus `.sig`) signed with the updater key.

## Keys
- **Updater key:** `~/.tauri/voxstudio.key`. The public half is in `src-tauri/tauri.conf.json → plugins.updater.pubkey`.
  - Back it up. Without it, installed copies can never be updated again.
  - For CI, store its contents in the `TAURI_SIGNING_PRIVATE_KEY` secret.
- **Apple Developer ID (optional):** set the `APPLE_*` secrets listed in `.github/workflows/release.yml` to sign and notarize macOS builds. Without them, builds are ad-hoc signed.

## Release from a Mac
```bash
npm version 0.2.0 --no-git-tag-version   # bump package.json (Cargo/tauri read it)
CI=true npm run release:mac              # .app, .dmg, signed updater archive
scripts/publish-update.sh "What's new…"  # uploads to vox-studio.devops-monk.com/updates and updates latest.json
```
`CI=true` skips the Finder step that lays out the DMG window, which fails in non-GUI shells.

## Release all platforms (GitHub Actions)
Push a `v*` tag. The Release workflow builds macOS (arm64 and x64), Windows and Linux, and creates a draft GitHub release that includes `latest.json`. Because the repository is private, copy the assets to the website (as `publish-update.sh` does) so the updater can reach them.
