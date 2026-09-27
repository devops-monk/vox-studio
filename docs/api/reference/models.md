# Models

Neural engines such as Kokoro need model files. voxd downloads them on request, checks each file's SHA-256 against a known value, and keeps them in the app's data folder.

## Model object
| Field | Type | Description |
|---|---|---|
| `id` | string | e.g. `kokoro-v1` |
| `engine` | string | The [engine](engines.md) this model powers |
| `name`, `tagline`, `description` | string | Display text |
| `license`, `license_url`, `homepage` | string | Where the model comes from and its terms |
| `size_bytes` | number | Total download size |
| `languages` | string[] | BCP-47 tags |
| `voice_count` | number | Voices included |
| `featured` | boolean | Recommended as a first download |
| `status` | string | `not_installed`, `downloading` or `installed` |
| `job_id` | string \| null | The download [job](jobs.md) while `downloading` |
| `kind` | string | `tts` (ready-made voices) or `clone` (speaks in voices you provide) |
| `runtime_bytes` | number | Approximate size of the separate engine runtime some models need (Chatterbox: PyTorch). `0` if none. |
| `fit.level` | string | `great`, `ok` or `no`, for this computer |
| `fit.reason` | string | Why, e.g. `"Needs 425 MB of free disk space"` |

## `GET /v1/models`
The whole catalog, with status and fit.

```bash
curl -s "$VOXD/v1/models" -H "Authorization: Bearer $VOXD_TOKEN"
```

## `POST /v1/models/{id}/download`
Starts a download [job](jobs.md) in the **network lane**, so it never delays speech generation. If a download for this model is already running, that job is returned instead of starting a second one.

- **Resumable:** partial files are kept. If a download is cancelled, fails or is interrupted, the next attempt continues where it stopped (using HTTP `Range`).
- **Verified:** every file's SHA-256 must match before it's used. A corrupted file is discarded and the job fails with a clear message.
- **Engine runtimes:** models that need their own engine (such as Chatterbox's PyTorch) install it first, into an isolated environment. Removing the model removes that runtime too.
- When it finishes, the engine becomes available right away and a [`models.changed`](events.md) event is sent.

**Response 202**: the download job. **Errors:** `404 not_found`, `409 already_installed`

```bash
JOB=$(curl -s -X POST "$VOXD/v1/models/kokoro-v1/download" -H "Authorization: Bearer $VOXD_TOKEN" | jq -r .id)
curl -sN "$VOXD/v1/jobs/$JOB/events" -H "Authorization: Bearer $VOXD_TOKEN"
# event: progress
# data: {"progress": 0.17, "message": "Downloading 59 MB of 354 MB"}
```

## `DELETE /v1/models/{id}`
Deletes the model's files. Takes you made with it are kept.

**Response 204**. **Errors:** `404 not_found`, `409 download_in_progress` (cancel the download first)

## Downloading from a mirror
For offline installs or restricted networks, point voxd at your own server with the `VOXD_MODEL_MIRROR` environment variable. voxd then fetches `<mirror>/<model id>/<file name>` instead of the original URL. Checksums are still enforced.

```bash
# Serve the files (layout: kokoro-v1/kokoro-v1.0.onnx, kokoro-v1/voices-v1.0.bin)
python3 -m http.server 8000 --directory /path/to/mirror
VOXD_MODEL_MIRROR=http://my-server:8000 uv run python -m voxd
```
