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
Search and page through takes, newest first.

| Query | Default | Description |
|---|---|---|
| `limit` | `50` | 1–500 |
| `q` | | Text contains (case-insensitive). `%` and `_` are matched literally. |
| `engine` | | e.g. `kokoro` |
| `voice` | | A voice id |
| `starred` | | `true` or `false` |
| `before` | | Only takes created before this unix time. For the next page, pass the last take's `created_at`. |

```bash
curl -s "$VOXD/v1/takes?q=chapter&starred=true&limit=20" -H "Authorization: Bearer $VOXD_TOKEN"
```

**Paging through everything (Python):**
```python
before = None
while True:
    page = s.get(f"{base}/v1/takes", params={"limit": 100, **({"before": before} if before else {})}).json()
    if not page:
        break
    for take in page:
        print(take["created_at"], take["text"][:60])
    before = page[-1]["created_at"]
```

## `GET /v1/takes/stats`
```json
{ "count": 57, "starred": 3, "bytes": 7892682 }
```

## `DELETE /v1/takes/{id}`
Deletes the take and its audio. **Response 204.** **Errors:** `404 not_found`

## `POST /v1/takes/delete`
Deletes several takes. Body: `{"ids": ["…", "…"]}` (1–1000 ids). Unknown ids are ignored.
```json
{ "deleted": ["5128…", "b32d…"] }
```
Both delete endpoints send a `takes.deleted` [event](events.md).

## Retention
Set `history_retention_days` (`0`, `7`, `30` or `90`) with [`PATCH /v1/settings`](settings.md). Unstarred takes older than that are deleted automatically, right after the setting changes and then every 6 hours. **Starred takes are always kept.** `0` (the default) keeps everything.

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
