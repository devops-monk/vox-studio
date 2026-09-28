# Dubbing

Translate and re-voice a video or audio file. A dub goes through **prepare → review → render**:

1. **Prepare** (automatic after upload): extract the audio, transcribe it with Whisper, download any translation packs needed, translate every line, and pick a voice for the target language.
2. **Review**: edit translations, split lines between speakers (S1–S4), choose a voice per speaker, choose the mix.
3. **Render**: speak each line in its time slot and mix. Lines that run long are sped up (at most 1.3×) to fit before the next line. Video files get a new MP4 with the video copied untouched and the new audio in AAC.

Requirements: a Whisper [model](models.md), plus a voice that speaks the target language (Kokoro, a system voice, or, for English, a Chatterbox cloned voice). Translation packs (Argos, about 65–150 MB each) download and verify automatically.

**Languages:** English, Spanish, French, German, Italian, Portuguese, Hindi, Japanese and Chinese, in any direction. Pairs that don't involve English go through English (for example Spanish → English → French). If the source and target languages are the same, nothing is translated: the dub simply re-voices the original words.

## Dub object
| Field | Type | Description |
|---|---|---|
| `id`, `title` | string | |
| `status` | string | `preparing`, `ready`, `rendering`, `done` or `failed` |
| `has_video`, `duration_s` | | From the source file |
| `source_lang`, `target_lang` | string | ISO codes. `source_lang` is detected unless you set it. |
| `mix` | string | `duck` (the original plays quietly underneath, about −15 dB, the default) or `replace` (only the dub) |
| `segments` | array | `{id, start, end, text, translation, speaker, fit}`. `fit` appears after rendering: `{speed, overflow_s, duration_s}`. |
| `cast` | object | `{"S1": {"engine": "kokoro", "voice": "af_heart"}, …}`. `null` means no voice has been chosen yet. |
| `source_url`, `audio_url`, `video_url` | string \| null | Media URLs. The rendered ones appear after a render. |
| `stale` | boolean | Edited since the last render |
| `error` | string \| null | Why the last step failed |
| `job_id` | string \| null | The prepare, translate or render [job](jobs.md) in progress |

## `POST /v1/dubs`
`multipart/form-data`: `file` (up to 2 GB), `target_language` (required), `source_language` (optional), `title` (optional). Returns the new dub with `status: "preparing"` and starts preparing it.

```bash
curl -s -X POST "$VOX_URL/v1/dubs" -H "Authorization: Bearer $VOX_API_KEY" \
  -F file=@talk.mp4 -F target_language=en
```
**Errors:** `400 unsupported_language`, `400 engine_unavailable` (no Whisper model), `400 file_too_large`

## `GET /v1/dubs` · `GET /v1/dubs/{id}` · `DELETE /v1/dubs/{id}`
Deleting also cancels any running step and removes all files.

## `GET /v1/dubs/languages`
`[{"code": "ja", "name": "Japanese", "has_voice": true}, …]`. `has_voice` says whether an installed voice can speak the language.

## `PATCH /v1/dubs/{id}`
Change only what you send:
```json
{
  "title": "Launch video (English)",
  "mix": "replace",
  "cast": { "S2": { "engine": "kokoro", "voice": "am_michael" } },
  "segments": [{ "id": "a1b2c3d4", "translation": "Welcome, everyone!", "speaker": "S2" }]
}
```
A speaker used for the first time gets a default voice. Changes after a render set `stale: true`.
**Errors:** `409 busy` (a step is running), `400 unknown_voice`, `400 engine_unavailable`

## `POST /v1/dubs/{id}/translate`
Translates every line again, optionally into a new language: `{"target_language": "fr"}`. Your edited translations are replaced, and changing the language resets the cast to that language's default voice. Returns a [job](jobs.md).

## `POST /v1/dubs/{id}/segments/{segment_id}/preview`
Speaks one line with its speaker's voice: `{"audio_url": "…", "duration_s": 1.7}`.

## `POST /v1/dubs/{id}/render`
Returns the render [job](jobs.md). **Errors:** `400 missing_voice` (a speaker has no voice), `409 not_ready`, `409 busy`

## `GET /v1/dubs/{id}/media/{source|audio|video}`
The original upload, the rendered WAV, or the rendered MP4.

## `GET /v1/dubs/{id}/subtitles?format=srt|vtt&which=translation|text`
Subtitles in the dubbed language (`translation`) or the original (`text`).

## `POST /v1/dubs/{id}/save`
Writes an output to a file: `{"path": "/abs/path/talk.en.mp4", "what": "video" | "audio" | "srt" | "vtt"}`.

## Events
`dubs.changed` (`{"id"}`) is sent whenever a dub's status or content changes. See [Live events](events.md).

## Tested end to end
A Spanish clip (macOS voice "Mónica") was dubbed into English with a system voice. Whisper, transcribing the rendered MP4, heard *"Hello everyone and welcome, today we will learn to cook a Spanish tortilla, it is very easy and delicious."* The video stream was copied untouched and the duration was preserved.

## Import from a link: `POST /v1/imports/url`
```json
{ "url": "https://example.com/promo.mp4", "then": "dub", "target_language": "es", "title": "Promo" }
```
`then` is `dub` (requires `target_language`; `source_language` is optional) or `transcribe` (`language` is optional). The link is downloaded in the background (`202`, a Job in the network lane, up to 2 GB), then the work starts. The job `result` holds `{"dub_id", "title"}` for a dub, or `{"transcript_id", "transcribe_job_id", "title"}` for a transcription; follow `transcribe_job_id` until the transcript is ready.

Rules:
- The link must be http(s) and point at media: `audio/*` or `video/*`, Ogg/MP4/Matroska, or a generic type with a media file extension. Web pages fail with a clear error.
- Hosts that resolve to loopback, private, link-local or reserved addresses are refused, including after redirects: `400 invalid_url`.
- Also: `400 unsupported_language`, and `400 engine_unavailable` (needs Whisper).

## Speakers and soundtrack
- `POST /v1/dubs` accepts `speakers`: `auto` (the default) detects who says each line, and `1`–`8` sets the number of speakers (`1` turns detection off). `POST /v1/imports/url` takes the same field.
  - Detected speakers are `S1`, `S2`, … in order of appearance, and each gets a distinct default voice in `cast`.
  - Detection uses a CAM++ speaker-embedding model, downloaded on first use (30 MB, SHA-256 pinned).
  - If detection fails, for example when offline, the dub continues with one speaker.
- `mix` can be `keep`, `duck` or `replace`. `keep` mixes the dub over the original soundtrack with its voices removed. This needs the `demucs-htdemucs` model from `/v1/models`; without it, `PATCH` returns `400 engine_unavailable`. The separated track is cached per dub.
