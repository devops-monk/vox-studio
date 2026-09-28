# Settings

## Settings object
| Field | Type | Description |
|---|---|---|
| `compute_device` | string | Where PyTorch engines (Chatterbox) run: `auto`, `cpu`, `mps` (Apple GPU) or `cuda` (NVIDIA). `auto` picks the fastest available. |
| `history_retention_days` | number | `0` (keep forever, the default), `7`, `30` or `90`. Unstarred takes older than this are deleted automatically; starred takes are always kept. |
| `asr_model` | string \| null | Preferred Whisper model for file transcription. `null` means the most accurate installed. Send `""` to clear it. |
| `model_mirror` | string | A base URL serving `<model id>/<file name>`, used instead of the original download hosts. `""` means none. Files are still verified against their SHA-256. The `VOXD_MODEL_MIRROR` environment variable, when set, overrides it. |
| `compute_device_in_use` | string \| null | The device the running engine actually uses, or null if none is loaded. If a GPU can't run the model, voxd falls back to `cpu` and reports it here. |

## `GET /v1/settings`

## `PATCH /v1/settings`
Changes only the fields you send. A new `compute_device` takes effect the next time the engine runs.

```bash
curl -s -X PATCH "$VOXD/v1/settings" -H "Authorization: Bearer $VOXD_TOKEN" \
  -H "Content-Type: application/json" -d '{"compute_device": "cpu"}'
```
**Errors:** `400 invalid_setting` (retention isn't 0, 7, 30 or 90, an unknown Whisper model, or a mirror that isn't http(s)), `400 unsupported_device` (this computer doesn't have that device; see `accelerators` in [`GET /v1/system`](system.md)), `422 invalid_request`

### Measured on an Apple M1 Pro (Chatterbox, warm)
| Device | Time for ~2 s of speech |
|---|---|
| `mps` (Apple GPU) | ~13 s |
| `cpu` | ~17 s |

The first request after launch also loads the model, which takes about 45 s.

## `GET /v1/storage`
Disk usage of the data folder, split into parts:
```json
{ "data_dir": "/Users/me/Library/Application Support/com.voxstudio.app", "total": 4893986257,
  "parts": [{ "id": "takes", "label": "Takes & history", "path": "…/takes", "bytes": 3926628 }, …] }
```
Part ids: `takes`, `voices`, `dubs`, `books`, `uploads`, `models`, `runtimes`, `app` and `database`. A part is listed only if it exists.

## `POST /v1/storage/cleanup`
Removes leftovers:
- scratch files from interrupted renders
- uploads that no transcript or running job uses
- take audio, dub and book folders, and voice recordings whose record was deleted

Anything modified in the last hour is skipped. Returns `{"freed_bytes": 2048000, "removed": 3}`.

## `POST /v1/engines/unload`
Frees memory by stopping engine workers. Models load again on next use. Returns `{"unloaded": ["chatterbox", "kokoro"]}`, listing the engines that had something loaded.
