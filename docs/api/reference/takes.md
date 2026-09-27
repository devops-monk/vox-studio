# Takes

A take is one generated piece of audio.

## Take object
| Field | Type | Description |
|---|---|---|
| `id` | string | Unique id |
| `engine` | string | Engine that produced it |
| `voice` | string | Voice id |
| `text` | string | The text that was spoken |
| `duration_s` | number | Length in seconds |
| `starred` | boolean | Marked as a favorite |
| `created_at` | number | Unix time in seconds |
| `audio_url` | string | Relative URL of the WAV file |

## `GET /v1/takes`
The most recent takes, newest first.

| Query | Default | Description |
|---|---|---|
| `limit` | `50` | 1–500 |

```bash
curl -s "$VOXD/v1/takes?limit=5" -H "Authorization: Bearer $VOXD_TOKEN"
```

## `GET /v1/takes/{id}/audio`
Downloads the take as `audio/wav`. Accepts `?token=` in place of the header, so it can be used as an `<audio src>`.

**Errors:** `404 not_found`

```bash
curl -s "$VOXD/v1/takes/5128…/audio" -H "Authorization: Bearer $VOXD_TOKEN" -o take.wav
```

## `PUT /v1/takes/{id}/star`
Body: `{"starred": true}`. Returns the updated take and sends a `take.updated` [event](events.md).

## `POST /v1/takes/{id}/export`
Copies the take's WAV file to a path on this computer, for example one chosen in a Save dialog.

| Field | Type | Description |
|---|---|---|
| `path` | string | An absolute path ending in `.wav`. The folder must exist. |
| `overwrite` | boolean | Replace an existing file. Default `false`. |

**Response 204**. **Errors:** `400 invalid_path`, `404 not_found`, `409 file_exists`
