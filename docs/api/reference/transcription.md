# Transcription

Turn speech into text with the `whisper` engine. You need at least one Whisper [model](models.md) installed:

| Model | Size | Best for |
|---|---|---|
| `whisper-base` | 145 MB + 260 MB engine | Live dictation, quick drafts |
| `whisper-small` | 484 MB | Most files: better with accents and names |
| `whisper-large-v3-turbo` | 1.6 GB | Hard audio, interviews, lectures |

All models understand about 99 languages. Whisper runs in its own isolated runtime; on an NVIDIA GPU it uses CUDA, and elsewhere a fast int8 CPU path. (CTranslate2, the library underneath, has no Apple-GPU backend.)

## Transcript object
| Field | Type | Description |
|---|---|---|
| `id`, `title` | string | |
| `source` | string | `file` or `live` |
| `language` | string | Detected or requested ISO code, e.g. `en` |
| `duration_s` | number | |
| `model` | string | Which Whisper model was used |
| `text` | string | Full text |
| `segments` | array | `[{start, end, text}]`, times in seconds |
| `has_audio` | boolean | Whether the original recording is kept (file transcripts) |
| `created_at` | number | Unix time in seconds |

List results contain a `preview` (the first ~160 characters) instead of `text` and `segments`.

## `POST /v1/transcriptions`
Starts a transcription [job](jobs.md) in its own **asr lane**, so it runs alongside speech generation. Send `multipart/form-data`:

| Field | Required | Description |
|---|---|---|
| `file` | ✓ | Any common audio or video file (wav, mp3, m4a, flac, mp4, mov, webm…), up to 2 GB |
| `language` | | ISO code such as `en`. Omit to detect automatically. |
| `model` | | A Whisper model id. Default: your `asr_model` [setting](settings.md), or the most accurate model installed. |
| `title` | | Defaults to the file name |

**Response 202**: the job. On success, `result.transcript_id` points to the transcript. **Errors:** `400 engine_unavailable`, `400 file_too_large`

```bash
JOB=$(curl -s -X POST "$VOXD/v1/transcriptions" -H "Authorization: Bearer $VOXD_TOKEN" -F file=@interview.m4a | jq -r .id)
# …wait for the job (GET /v1/jobs/$JOB or its events), then:
curl -s "$VOXD/v1/transcriptions/<transcript_id>" -H "Authorization: Bearer $VOXD_TOKEN"
```

## `GET /v1/transcriptions`
Newest first. Query: `q` (searches title and text), `limit` (1–500, default 100).

## `GET /v1/transcriptions/{id}`

## `PATCH /v1/transcriptions/{id}`
Rename or correct a transcript: `{"title": "…"}` and/or `{"segments": [{start, end, text}, …]}`. The full `text` is rebuilt from the segments.

## `DELETE /v1/transcriptions/{id}`
Deletes the transcript and its kept recording. **Response 204.**

## `GET /v1/transcriptions/{id}/audio`
The original recording, for file transcripts.

## `GET /v1/transcriptions/{id}/export?format=txt|srt|vtt|json`
Downloads the transcript as plain text, SubRip subtitles, WebVTT subtitles or JSON.
```bash
curl -s "$VOXD/v1/transcriptions/<id>/export?format=srt" -H "Authorization: Bearer $VOXD_TOKEN" -o talk.srt
```

## `POST /v1/transcriptions/{id}/save?format=…`
Writes the export to a file on this computer. Body: `{"path": "/abs/path/talk.srt", "overwrite": false}`. The path must end in `.<format>`.

## `WS /v1/transcribe/live`
Real-time transcription from a microphone or any audio stream.

**Query:** `token` (required when auth is on), `language`, `model` (default: the quickest model installed), `save` (default `true`: keep the result as a transcript), `title`.

**Protocol**
1. The server sends `{"type": "ready", "sample_rate": 16000}`.
2. Send audio as **binary frames** of 16-bit little-endian mono PCM at 16 kHz. About 100 ms per frame works well.
3. While you speak, the server sends `{"type": "partial", "text": "…"}` about once a second: the current sentence so far, which may still change.
4. After a pause (or 25 s of continuous speech), it sends `{"type": "final", "segment": {"start", "end", "text"}}`.
5. Send the text frame `{"type": "stop"}` to finish. You get a last `final`, then `{"type": "done", "text": "…", "transcript_id": "…" | null}`, and the socket closes.

If no Whisper model is installed, you get `{"type": "error", "error": "engine_unavailable", "message": …}` instead.

**Example (Python, streaming a WAV file in real time):**
```python
import asyncio, json, wave, websockets

async def main():
    w = wave.open("speech-16k-mono.wav")
    pcm = w.readframes(w.getnframes())
    async with websockets.connect("ws://127.0.0.1:4870/v1/transcribe/live?token=TOKEN&save=false") as ws:
        await ws.recv()  # ready
        async def read():
            async for msg in ws:
                data = json.loads(msg)
                print(data["type"], data.get("text") or data.get("segment", {}).get("text"))
                if data["type"] == "done":
                    return
        reader = asyncio.create_task(read())
        for i in range(0, len(pcm), 3200):  # 100 ms of 16 kHz PCM16
            await ws.send(pcm[i:i + 3200])
            await asyncio.sleep(0.1)
        await ws.send(json.dumps({"type": "stop"}))
        await reader

asyncio.run(main())
```

Measured on an Apple M1 Pro with Whisper Base: partial text updates about once a second, and the final text arrives about 0.7 s after you stop speaking.
