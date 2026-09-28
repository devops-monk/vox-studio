# Finder & Shortcuts

## Open files with VoxStudio
Right-click any audio, video or book file in Finder and choose **Open With → VoxStudio**, or drop it on VoxStudio's Dock icon. VoxStudio asks what to do with it, just like [dropping a file](drop-anywhere.md) into the window. VoxStudio never makes itself the default app for these files.

## Quick Actions in Finder
Open **Integrations → Finder & Shortcuts** and click **Add to Finder**. Four actions appear when you right-click a file, under **Quick Actions** (or the **Services** menu):

| Quick Action | For | What happens |
|---|---|---|
| **Dub with VoxStudio** | Videos | Starts a dub and opens it |
| **Transcribe with VoxStudio** | Audio and video | Transcribes in the background; a notification links to the result |
| **Clean Up with VoxStudio** | Audio | Opens Tools → Clean up with the file loaded |
| **Make Audiobook with VoxStudio** | EPUB, DOCX, text | Imports the book, ready to cast |

The same place has a **Remove Finder actions** button. The actions are small Automator workflows in `~/Library/Services`. They pass the selected files to VoxStudio and nothing else.

## Shortcuts app
Use the **Open URLs** action with a VoxStudio link:

| Link | Does |
|---|---|
| `voxstudio://speak?text=…` | Reads the text aloud with your quick voice (`&voice=…&engine=…` to choose) |
| `voxstudio://studio?text=…` | Opens Studio with the text |
| `voxstudio://files?path=…` | Opens a file and asks what to do. Repeat `path=` for several files. |
| `voxstudio://files?action=transcribe&path=…` | Runs an action directly: `dub`, `transcribe`, `clean`, `convert`, `clone`, `audiobook`, `story` or `studio` |
| `voxstudio://open/<page>` | Opens a page, such as `settings` or `dub` |

**Example: “Read aloud” for any selected text.** In Shortcuts, create a Quick Action that receives **Text**. Add **URL Encode** (on the Shortcut Input), then **Open URLs** with `voxstudio://speak?text=` followed by the encoded text. It then appears in every app's **Services** menu.

For more control, such as choosing formats, saving files or chaining steps, use the [local API](../api/overview.md) with an API key.

## Logs
If something doesn't work, **Settings → Logs → Show log file** opens `~/Library/Logs/com.voxstudio.app/voxstudio.log`. The log never contains your API keys or the app's token.
