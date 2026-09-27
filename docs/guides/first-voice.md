# Your first voice in 60 seconds

This guide takes you from a fresh install to hearing VoxStudio speak.

## 1. Launch VoxStudio
Open the app. A short **Warming up VoxStudio** screen appears while the voice engine starts. The ring of bars sweeps while it works, and each step is ticked off as it finishes:

1. **Launching voice engine**: VoxStudio starts voxd in the background.
2. **Preparing runtime**: on the very first launch, VoxStudio sets up its private Python runtime. This takes a minute or two and happens only once.
3. **Checking voices**: voxd looks for the voice engines available on your computer.

When everything is ready, the screen fades away. The sidebar footer shows a green dot and **Engine ready**.

### First launch: pick your voices
The first time, a short welcome sheet appears:
1. **Welcome**: what makes VoxStudio different.
2. **Choose your first voices**: **Kokoro** (recommended: 54 natural voices, 354 MB) or **just system voices** (no download).
3. **Download**: watch it progress, or choose **Continue in background** and keep exploring. When it's done, **Start creating** switches Home to your new voices.

> **If it doesn't start:** click **Show details** to see the engine log, then **Try again**. The most common cause is a missing `uv`. Install it from <https://docs.astral.sh/uv/> and relaunch.

## 2. Speak
On **Home**, find the **Try a voice** card.

1. Edit the text, or keep the sample sentence.
2. If Kokoro is installed, choose **System** or **Kokoro** in the top-right of the card.
3. Pick a voice. Voices are grouped by language, with yours first; ♀ and ♂ mark the voice's gender.
4. Choose a pace: **Calm**, **Natural** or **Brisk**.
5. Click **Speak**, or press **⌘↩**.

The orb reacts to the audio as it plays.

## 3. Replay
Every generation is saved as a **take**. Your latest takes appear under the text box; click ▶ to replay one.

## Next steps
- Search anything with **⌘K**.
- Switch between light and dark in **Settings → Appearance**.
- Script it: [API quickstart](../api/quickstart.md).
