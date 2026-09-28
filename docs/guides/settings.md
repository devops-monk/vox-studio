# Settings

Open **Settings** at the bottom of the sidebar, or press **⌘,**. The sections are listed on the left.

## General
- **Open to**: the page VoxStudio shows when it starts, for example Studio if that's where you always begin.
- **Quick voice**: the engine and voice used by **Try a voice** on Home and by Quick Speak.
- **Welcome tour**: show the first-run introduction again.

## Appearance
- **Theme**: Auto (follows macOS), Light or Dark.
- **Accent colour**: eight colours for buttons, selections, sliders and the voice orb.
- **Text size**: Smaller, Default or Larger. This scales the whole interface.
- **Glass**: how see-through the panels are.
  - **Clear** shows the most of your desktop.
  - **Balanced** is the default.
  - **Frosted** is softer and calmer.
  - **Solid** turns transparency off completely. If *Reduce transparency* is on in macOS Accessibility, VoxStudio already uses solid panels.

## Voices & Models
- **Manage models** opens the Models page.
- **Transcription model**: the Whisper model used for files, dubbing and batches. By default it's the most accurate one installed.
- **Download mirror**: for offline or firewalled setups. Point VoxStudio at a server that hosts the model files as `<model id>/<file name>`. Every file is still checked against its SHA-256 fingerprint, so a mirror can't swap in something different.

## Performance
- **Compute device**: where voice cloning runs. Auto uses the Apple GPU when it helps.
- **Free memory**: unload every voice and speech model right now. They load again the next time you use them.
- **This computer**: your chip, memory, cores and system version.

## Storage
- A bar shows how much space VoxStudio uses, split into takes, your voices, dubs, stories and audiobooks, transcripts, voice models, engine runtimes and the library database. Hover over a row and click the folder icon to show that part in Finder.
- **Keep takes**: delete takes after 7, 30 or 90 days, or keep them forever. Starred takes are always kept.
- **Clean up leftovers**: removes scratch files from interrupted work and files whose take, dub, book or voice was deleted. Nothing in your library is touched.

## Dictation
Change the shortcut, choose whether text is pasted automatically, and pick the language. See [Dictation](dictation.md).

## Shortcuts
Lists every keyboard shortcut:

| Keys | Action |
|---|---|
| ⌘K | Search and jump anywhere |
| ⌘1 – ⌘7 | Studio, Clone, Design, Dub, Stories, Audiobook, Transcribe |
| ⌘Y | History |
| ⌘, | Settings |
| ⌘⌥I | Show or hide recent takes |
| ⌘↩ | Generate (in Studio and Try a voice) |
| Esc | Close a panel or popover |

## Privacy
A summary of how VoxStudio handles your data:
- Everything runs on your computer.
- It works offline once models are downloaded.
- There are no accounts and no analytics.
- The API is local-only.

This section also lists the only internet hosts VoxStudio ever contacts, and only when you download a model or install an engine. It also has shortcuts to your API keys and cloned voices.

## Logs
See the voice engine's recent output, copy it for a bug report, or **Restart** the engine.

## About
Shows the version numbers, links to the website and documentation, and credits for the open-source projects VoxStudio is built on.
