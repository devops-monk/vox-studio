# Install, update and automate the desktop app

## Install
**macOS 13.3 or later.** Open the `.dmg` and drag **VoxStudio** to **Applications**.

Builds that aren't signed with an Apple Developer ID show a warning the first time. Control-click the app, choose **Open**, then **Open** again. On macOS 15, open **System Settings → Privacy & Security** and click **Open Anyway**. You only need to do this once.

If macOS says **“VoxStudio is damaged and can’t be opened”**, you have version 0.1.0, which had an incomplete signature. Install 0.1.1 or later. To open 0.1.0 anyway, run this in Terminal:
```bash
xattr -cr /Applications/VoxStudio.app
```

On first launch, VoxStudio prepares its voice engine (a private Python runtime). This takes a minute or two and needs the internet once. After that, launches take a few seconds and work offline.

Windows (`.msi`/`.exe`) and Linux (`.AppImage`/`.deb`) builds come from the same code.

## Updates
VoxStudio checks for a new version once a day and tells you when one is ready. Nothing installs until you click **Install & restart**. Every update is cryptographically signed, and VoxStudio refuses any update whose signature doesn't match.
- Check at any time: **VoxStudio → Check for Updates…**, or **Settings → About**.
- Turn off daily checks in **Settings → About → Check automatically**.

## Menus
Standard macOS menus, plus:
- **File**: New Script (⌘N), Clone a Voice, Transcribe a File, Dub a Video, Import a Book.
- **View**: Search, Show Recent Takes (⌘⌥I), Show Activity.
- **Go**: jump to Home (⇧⌘H), History, Voices, Projects, Models, Tools or Integrations.
- **Help**: this documentation and the API reference.

Only one VoxStudio runs at a time. Opening it again brings the existing window forward.

## `voxstudio://` links
Links let other apps, the Shortcuts app, scripts and web pages drive VoxStudio:

| Link | What it does |
|---|---|
| `voxstudio://open/<page>` | Opens a page, e.g. `voxstudio://open/transcribe` or `voxstudio://open/settings` |
| `voxstudio://studio?text=…` | Opens Studio with that script, ready to generate |
| `voxstudio://speak?text=…` | Says the text right away with your quick voice (**Settings → General**) |
| `voxstudio://speak?text=…&voice=af_nova&engine=kokoro` | Says it with a specific voice |

Text in links is limited to 2,000 characters. Encode spaces as `%20`.

From Terminal:
```bash
open "voxstudio://speak?text=Your%20build%20is%20done"
```
In **Shortcuts**, add **Open URLs** with a `voxstudio://` link. For example, make a “Read clipboard aloud” shortcut: take the clipboard text, URL-encode it, and open `voxstudio://speak?text=<encoded text>`.

For more control, such as choosing formats, saving files or transcribing, use the [local API](../api/overview.md) or [Integrations](integrations.md).

## Uninstall
Quit VoxStudio and drag it to the Bin. Your voices, takes, models and settings are in `~/Library/Application Support/com.voxstudio.app`. Delete that folder too if you want to remove everything.
