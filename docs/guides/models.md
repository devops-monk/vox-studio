# Voice models

VoxStudio's natural-sounding voices come from **models**, AI files that run on your computer. You download a model once, and from then on it works offline, as much as you like.

## Open Models
Click **Models** in the sidebar (under **More**). At the top you'll see your computer at a glance: chip, memory and free disk space. VoxStudio uses these to tell you how well each model will run.

## Read a model card
| Label | Meaning |
|---|---|
| 🟢 **Great fit** | Runs well on this computer |
| 🟡 **Will run** | Works, but may be slow alongside other apps |
| 🔴 **Not supported** | Not enough memory or disk space; the reason shows on hover |
| **Recommended** | A good first download |
| **Apache-2.0** (etc.) | The model's license. Click it to read the terms. |

## Download
1. Click **Download · 354 MB**.
2. A progress bar shows how much has arrived. You can leave the page; progress also shows in **Activity** in the toolbar.
3. When it's done, you'll see **Installed** and a notification.

**Your download is safe to interrupt.** Cancel it, lose Wi-Fi or quit the app, and the next attempt resumes from where it stopped. Every file is checked against a known fingerprint (SHA-256) before it's used, so a corrupted download is never loaded.

## Try and remove
- **Try** plays a short sample in the model's signature voice.
- **Remove** frees the disk space. Click it once, then again to confirm. Your takes are kept.

## Use a model's voices
On **Home**, the **Try a voice** card now has a **System | Kokoro** switch. VoxStudio remembers the voice you last picked for each engine.

## Available models
| Model | Voices | Languages | Size | License |
|---|---|---|---|---|
| **Kokoro** | 54 | English (US & UK), Spanish, French, Hindi, Italian, Japanese, Portuguese, Mandarin | 354 MB | Apache-2.0 |
| **Chatterbox** | Your own (voice cloning) | English | 3.2 GB + 1.3 GB engine | MIT |
| **Whisper Base / Small / Large v3 Turbo** | (speech recognition) | ~99 languages | 145 MB / 484 MB / 1.6 GB + 260 MB engine | MIT |

Chatterbox brings its own engine (PyTorch), installed in a separate, isolated space so it can't interfere with anything else. Removing Chatterbox removes that too.

## For IT teams: offline installs
Set the `VOXD_MODEL_MIRROR` environment variable to serve model files from your own network. See [Models API → mirrors](../api/reference/models.md#downloading-from-a-mirror).
