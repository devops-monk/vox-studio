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
curl -s -X POST "$VOX_URL/v1/speech" \
  -H "Authorization: Bearer $VOX_API_KEY" -H "Content-Type: application/json" \
  -d '{"text": "Slow and steady.", "voice": "Daniel", "speed": 0.8}'
```

**Notes**
- The request returns when the audio is fully rendered. For more than a few paragraphs, use [`POST /v1/jobs/speech`](jobs.md), which renders in the background with progress and cancellation.
- The audio is 16-bit mono WAV. Fetch it from the take's `audio_url`.

## Script markup
Set `"markup": true` to interpret delivery markup in `text`. This works for `POST /v1/speech` and `POST /v1/jobs/speech`:

| Markup | Effect |
|---|---|
| `[pause]`, `[pause 1.5s]`, `[pause 300ms]` | Silence (default 0.5 s, maximum 10 s; adjacent pauses add up) |
| `[slow]…[/slow]`, `[fast]…[/fast]` | 0.8× / 1.2× |
| `[speed 1.3]…[/speed]` | 0.5×–2×. Nested tags multiply, and the result is clamped. |
| `*words*` | Emphasis: 0.92× speed, +2.5 dB, emotion +0.25 where supported, and 80 ms of space on each side |
| `{written|spoken}` | Stored as `written`, spoken as `spoken` |

Unknown or unbalanced tags are read as ordinary text. The take's `text` is the script with markup removed. Without `markup: true`, text is spoken literally.

### `POST /v1/markup/preview`
`{"text": "Hello [pause 2s] *world*", "speed": 1}` returns:
```json
{ "display": "Hello world", "has_markup": true, "estimated_s": 3.1,
  "segments": [ {"kind": "speech", "text": "Hello", "speed": 1.0, "emphasis": false},
                {"kind": "pause", "seconds": 2.0},
                {"kind": "speech", "text": "world", "speed": 1.0, "emphasis": true} ] }
```
