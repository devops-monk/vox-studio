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

## Make a release
1. Bump the version in `package.json` (Tauri and Cargo read it). Also bump `voxd/pyproject.toml` if voxd changed.
2. Commit, then push a tag. The **Release** workflow builds macOS (Apple silicon and Intel), Windows and Linux, and creates a **draft** GitHub release with every installer, signed updater archives and `latest.json`:
   ```bash
   git tag -a v0.2.0 -m "VoxStudio 0.2.0" && git push origin v0.2.0
   ```
3. Check the draft, then publish it on GitHub (or run `gh release edit v0.2.0 --draft=false --latest`).
4. Turn on updates for installed copies. This copies the release's `latest.json` into the website and deploys it; commit the updated file afterwards:
   ```bash
   scripts/publish-update.sh v0.2.0
   ```
5. Update the version and download links in `website/src/index.html` (the Download section).

Local builds still work (`CI=true npm run release:mac`). `CI=true` skips the Finder step that lays out the DMG window, which fails in non-GUI shells.
