# Speech

## `POST /v1/speech`
Turns text into audio and saves the result as a new [take](takes.md).

**Request body**
| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | ✓ | 1–5000 characters |
| `voice` | string | ✓ | Voice id from [`GET /v1/voices`](voices.md) |
| `engine` | string | | Engine id. Defaults to the best available TTS engine (Kokoro once it's installed, otherwise system). |
| `speed` | number | | `0.5`–`2.0`, default `1.0` |
| `emotion` | number | | `0`–`1` emotional intensity: `0` is flat and calm, `0.5` natural, `1` dramatic. Used by engines with the `emotion` capability (Chatterbox); others ignore it. |

**Response 201**: the new [take](takes.md#take-object).

**Errors:** `400 engine_unavailable`, `400 synthesis_failed`, `422 invalid_request`

```bash
curl -s -X POST "$VOXD/v1/speech" \
  -H "Authorization: Bearer $VOXD_TOKEN" -H "Content-Type: application/json" \
  -d '{"text": "Slow and steady.", "voice": "Daniel", "speed": 0.8}'
```

**Notes**
- The request returns when the audio is fully rendered. For more than a few paragraphs, use [`POST /v1/jobs/speech`](jobs.md), which renders in the background with progress and cancellation.
- The audio is 16-bit mono WAV. Fetch it from the take's `audio_url`.
