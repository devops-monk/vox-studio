# Engines

## `GET /v1/engines`
Lists every engine voxd knows about, including ones that can't run on this machine.

**Response 200**: an array of:
| Field | Type | Description |
|---|---|---|
| `id` | string | Pass this as `engine` elsewhere, e.g. `"system"` |
| `name` | string | Display name |
| `capabilities` | string[] | What it can do: `asr` (transcribes speech), `tts` (speaks text), `clone` (speaks in [custom voices](custom-voices.md)), `emotion` (honours `emotion` in speech requests) |
| `license` | string | License of the underlying model or tool |
| `available` | boolean | `true` if usable right now |
| `unavailable_reason` | string \| null | Why not, e.g. `"Install espeak-ng to enable system voices"` |

```bash
curl -s "$VOX_URL/v1/engines" -H "Authorization: Bearer $VOX_API_KEY"
# [{"id":"system","name":"System Voices","capabilities":["tts"],"license":"Built into your OS","available":true,"unavailable_reason":null},
#  {"id":"kokoro","name":"Kokoro","capabilities":["tts"],"license":"Apache-2.0","available":false,"unavailable_reason":"Download Kokoro from Models to use it"}]
```

### Available engines
| id | Platforms | Notes |
|---|---|---|
| `system` | macOS (built-in voices), Linux (`espeak-ng`) | Instant, no download. Windows support is planned. |
| `kokoro` | macOS, Windows, Linux (CPU) | 54 natural voices in 9 languages. Needs the `kokoro-v1` [model](models.md) (354 MB). Until it's installed, `unavailable_reason` says so. |
| `chatterbox` | macOS, Windows, Linux (Apple GPU, NVIDIA or CPU) | Voice cloning with emotion control (English). Needs the `chatterbox-v1` model (3.2 GB) plus its engine runtime (about 1.3 GB), which is installed in its own isolated environment and runs as a separate process. |
| `whisper` | macOS, Windows, Linux (CPU; NVIDIA GPU via CUDA) | Speech recognition in ~99 languages. Needs a Whisper [model](models.md) and its runtime (about 260 MB). See [Transcription](transcription.md). |
