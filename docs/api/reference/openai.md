# OpenAI-compatible endpoints

Code written for OpenAI's audio API works against voxd. Set the base URL to `http://127.0.0.1:4870/v1` and use a VoxStudio [API key](keys.md) as the API key. Everything runs locally, and every result is saved in History or Transcribe.

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:4870/v1", api_key="vox_sk_…")
```

## `POST /v1/audio/speech`
| Field | | |
|---|---|---|
| `input` | required | Text, up to 100,000 characters. Long text is rendered in chunks. |
| `voice` | `alloy` | An OpenAI voice name, or any VoxStudio voice id (`af_heart`, `cv_…`, `dv_…`, `mix:…`) |
| `model` | `tts-1` | `tts-1`, `tts-1-hd` and `gpt-4o-mini-tts` use the best installed engine. `kokoro`, `chatterbox` or `system` pick one explicitly. |
| `response_format` | `mp3` | `mp3`, `opus` (Ogg), `aac` (ADTS), `flac`, `wav`, or `pcm` (raw 24 kHz 16-bit mono) |
| `speed` | `1.0` | 0.25–4.0 accepted; applied within 0.5–2.0 |
| `instructions` | — | Accepted and ignored |

The response is the audio bytes. The `X-Voxd-Take-Id` header names the take saved in History.

OpenAI voice names map to similar Kokoro voices:

| alloy | ash | ballad | coral | echo | fable | nova | onyx | sage | shimmer | verse |
|---|---|---|---|---|---|---|---|---|---|---|
| af_alloy | am_adam | bm_george | af_heart | am_echo | bm_fable | af_nova | am_onyx | af_sarah | af_sky | am_michael |

If Kokoro isn't installed, the best available engine's first voice is used. `mp3`, `opus`, `aac` and `flac` need the Whisper runtime to encode. `wav` and `pcm` always work.

## `POST /v1/audio/transcriptions`
Multipart form: `file` (required), `model` (default `whisper-1`), `language`, `response_format`, `prompt` and `temperature`. `prompt` and `temperature` are accepted and ignored.

`whisper-1` and `gpt-4o-transcribe` use your preferred Whisper model. To choose a specific one, pass a VoxStudio model id such as `whisper-large-v3-turbo`.

| `response_format` | Returns |
|---|---|
| `json` (default) | `{"text": "…"}` |
| `text` | Plain text |
| `srt`, `vtt` | Subtitles |
| `verbose_json` | `{"task", "language", "duration", "text", "segments": [{"id", "start", "end", "text", …}]}` |

## Errors
These endpoints return errors in OpenAI's shape, so SDKs raise their usual exceptions:
```json
{"error": {"message": "Unknown voice: nobody", "type": "invalid_request_error", "param": "voice", "code": "voice_not_found"}}
```
Codes: `voice_not_found`, `engine_unavailable`, `unsupported_format`, `invalid_value`, `file_too_large`.
