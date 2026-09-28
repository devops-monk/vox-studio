# Custom voices

A **custom voice** is a short recording of one person speaking. Cloning engines (today, `chatterbox`) can speak any text in that voice. Custom voice ids start with `cv_`, and they appear in [`GET /v1/voices?engine=chatterbox`](voices.md) alongside the engine's built-in voice.

> **Consent is required.** Every custom voice stores a consent statement from whoever created it. Only clone voices you have permission to use. Chatterbox embeds an inaudible watermark in everything it generates, which identifies the audio as AI-made.

## Custom voice object
| Field | Type | Description |
|---|---|---|
| `id` | string | `cv_…` |
| `name` | string | Display name |
| `language` | string | BCP-47 tag of the recording, default `en-US` |
| `duration_s` | number | Length of the reference recording |
| `consent` | string | The consent statement saved when the voice was created |
| `consent_by` | string | Who gave consent (the speaker, or who granted permission). May be empty. |
| `created_at` | number | Unix time in seconds |
| `audio_url` | string | The original recording |

## `POST /v1/voices/custom`
Creates a voice from a recording. Send `multipart/form-data`:

| Field | Required | Description |
|---|---|---|
| `audio` | ✓ | A **WAV** file (PCM, mono or stereo), 3–60 seconds, up to 20 MB. 10–20 seconds of clear speech gives the best match. |
| `name` | ✓ | 1–60 characters |
| `consent` | ✓ | 10–500 characters, e.g. *"I am the speaker and I agree to this voice being cloned."* |
| `language` | | Default `en-US` |
| `consent_by` | | Optional, up to 120 characters: whose voice this is, or who gave permission |

**Response 201**: the custom voice. **Errors:** `400 invalid_audio` (with a specific message such as *"at least 3 seconds are needed"*), `422 invalid_request`

```bash
curl -s -X POST "$VOX_URL/v1/voices/custom" -H "Authorization: Bearer $VOX_API_KEY" \
  -F name="My narrator" \
  -F consent="I am the speaker and I agree to this voice being cloned." \
  -F audio=@me.wav
# → {"id":"cv_426926f80c1e","name":"My narrator","duration_s":7.29, …}
```

**Other formats:** convert them to WAV first, for example `ffmpeg -i me.m4a -ac 1 -ar 24000 me.wav`. The VoxStudio app does this conversion for you.

## Speak with it
```bash
curl -s -X POST "$VOX_URL/v1/jobs/speech" -H "Authorization: Bearer $VOX_API_KEY" -H "Content-Type: application/json" \
  -d '{"text": "Hello in my own voice.", "voice": "cv_426926f80c1e", "engine": "chatterbox", "emotion": 0.7}'
```
Cloning takes several seconds per sentence, so use [`POST /v1/jobs/speech`](jobs.md) to get progress and the option to cancel. `POST /v1/speech` works too, but blocks until the audio is ready.

## `GET /v1/voices/custom`
All your custom voices, newest first.

## `PATCH /v1/voices/custom/{id}`
Renames a voice. Body: `{"name": "New name"}`.

## `DELETE /v1/voices/custom/{id}`
Deletes the voice and its recording. Takes already made with it are kept. **Response 204.**

## `GET /v1/voices/custom/{id}/audio`
The original reference recording (`audio/wav`).

## Sharing voices: `.voxvoice` files
A `.voxvoice` file is a zip containing:
- `manifest.json`: `format` (`"voxvoice"`), `version` (`1`), `name`, `language`, `duration_s`, `tags`, `consent`, `consent_by`, `created_at`, `exported_at`
- `reference.wav`: the original recording

### `POST /v1/voices/custom/{id}/export`
Writes the voice to a `.voxvoice` file. Body: `{"path": "/Users/me/Desktop/Narrator.voxvoice", "overwrite": false}`. The path must be absolute and end in `.voxvoice`.
**Response 204**. **Errors:** `400 invalid_path`, `404 not_found`, `409 file_exists`

### `POST /v1/voices/custom/import`
Adds a `.voxvoice` file to your library. Send `multipart/form-data`:
| Field | Required | Description |
|---|---|---|
| `file` | ✓ | The `.voxvoice` file (max 25 MB) |
| `consent` | ✓ | **Your** statement that you may use this voice (10–500 characters) |
| `consent_by` | | Who gave permission. Defaults to the value in the file. |

The imported voice keeps the original consent record, attached after yours: `"<your statement> — Imported; original consent: “…”"`. Tags in the file are applied too.

**Response 201**: the new custom voice. **Errors:** `400 invalid_voice_file` (not a voice file, made with a newer version, or the recording fails the usual checks)

```bash
curl -s -X POST "$VOX_URL/v1/voices/custom/import" -H "Authorization: Bearer $VOX_API_KEY" \
  -F file=@Narrator.voxvoice -F consent="I have permission from the speaker to use this voice."
```
