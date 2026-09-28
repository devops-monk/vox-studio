# Batch & watch folders

## Batches
A batch runs many items with the same settings. Each item is its own [job](jobs.md), so every item shows in Activity, reports progress, and can fail without stopping the others.

### `POST /v1/batches`
**Speak many texts:**
```json
{ "kind": "speech", "engine": "kokoro", "voice": "af_heart", "speed": 1.0,
  "items": [{ "name": "01 intro", "text": "Welcome to the course." }, { "name": "02 lesson", "text": "…" }],
  "output_dir": "/Users/me/Desktop/Course audio" }
```
**Transcribe many files** (absolute paths on this computer):
```json
{ "kind": "transcribe", "paths": ["/Users/me/Recordings/standup.m4a", "/Users/me/Recordings/demo.mp4"],
  "formats": ["txt", "srt"], "language": null, "output_dir": "/Users/me/Desktop/Notes" }
```

| Field | Description |
|---|---|
| `kind` | `speech` or `transcribe` |
| `items` / `paths` | Up to 500 |
| `output_dir` | Optional absolute folder, created if missing. Results are written there too. File names are made safe, and existing files are never overwritten: new ones get `name (2).wav` and so on. |
| `formats` | Transcripts only: any of `txt`, `srt`, `vtt`, `json` |

Speech results are also saved as [takes](takes.md), and transcriptions as [transcripts](transcription.md).

**Response 201**: the batch. **Errors:** `400 empty_batch`, `400 missing_voice`, `400 unknown_voice`, `400 invalid_path`, `400 engine_unavailable`

### Batch object
`{id, kind, title, output_dir, created_at, total, done, failed, items: [{job_id, name, status, progress, message, error, output}]}`

### `GET /v1/batches` · `GET /v1/batches/{id}` · `POST /v1/batches/{id}/cancel` · `DELETE /v1/batches/{id}`
Cancelling stops the remaining items. Deleting removes the batch from the list; takes, transcripts and files already written are kept.

## Watch folders
Point VoxStudio at a folder and it processes new files automatically:
- `speak`: new `.txt` and `.md` files are spoken with the chosen voice.
- `transcribe`: new audio and video files are transcribed into the chosen formats.

Results go into a **`VoxStudio output`** subfolder. Files already in the folder when you start watching are processed too. voxd checks every few seconds, waits until a file's size stops changing (so half-copied files are never processed), and handles each file **once**.

### `POST /v1/watch-folders`
```json
{ "path": "/Users/me/Dropbox/To narrate", "action": "speak", "engine": "kokoro", "voice": "bf_emma" }
```
```json
{ "path": "/Users/me/Recordings", "action": "transcribe", "formats": ["txt", "srt"], "language": "en" }
```
**Errors:** `400 invalid_path`, `409 already_watched`, `400 unknown_voice`, `400 engine_unavailable`

### Watch folder object
`{id, path, action, options, enabled, exists, output_dir, processed, recent: [{path, state, output, error, at}], created_at}`. `state` is `queued`, `done` or `error`. An empty text file, for example, is recorded as an error and skipped.

### `GET /v1/watch-folders` · `PATCH /v1/watch-folders/{id}` (`{"enabled": false}` to pause) · `DELETE /v1/watch-folders/{id}`
