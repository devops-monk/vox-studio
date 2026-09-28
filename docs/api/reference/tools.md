# Tools & pronunciations

## Clean up audio: `POST /v1/tools/clean`
Multipart form. Starts a job (`202`, a [Job](jobs.md)); watch it with `GET /v1/jobs/{id}` or the SSE stream.

| Field | Default | |
|---|---|---|
| `file` | — | Audio or video, up to 2 GB. Send this **or** `take_id`. |
| `take_id` | — | Clean an existing take instead |
| `denoise` | `true` | Remove steady background noise and low rumble (high-pass at 70 Hz plus FFT denoise) |
| `trim` | `false` | Shorten silences over 0.6 s and cut dead air at both ends (threshold −38 dB) |
| `normalize` | `true` | Loudness-normalize (EBU R128) |
| `loudness` | `-16` | Target in LUFS, from −30 to −10. Use −16 for podcasts, −14 for streaming, −23 for broadcast. True peak is capped at −1.5 dB. |

On success, the job `result` holds the new take plus levels before and after, in dBFS:
```json
{ "take_id": "…", "duration_in": 9.9, "duration_out": 7.47,
  "peak_in": -21.9, "rms_in": -36.9, "peak_out": -2.0, "rms_out": -16.9 }
```
The take has `engine: "tools"` and `voice: "clean"`.

```bash
curl -H "Authorization: Bearer $VOXD_TOKEN" -F file=@memo.m4a -F trim=true -F loudness=-16 \
  http://127.0.0.1:$VOXD_PORT/v1/tools/clean
```

## Convert a voice: `POST /v1/tools/convert`
Speech-to-speech: this keeps the words, timing and delivery, and replaces the voice. It needs the Chatterbox engine, and uses the Whisper runtime to read the input.

| Field | |
|---|---|
| `voice` | `default`, or one of your custom voices (`cv_…`) |
| `file` / `take_id` | The recording, up to 15 minutes. Send one of them. |

The result is `{"take_id": "…"}`, a take with `engine: "chatterbox-vc"`. Progress is reported per section, because long input is split at quiet points roughly every 20 s. The output carries the Chatterbox AI watermark.

```python
import requests
job = requests.post(f"{base}/v1/tools/convert", headers=auth,
                    data={"voice": "cv_ab12cd34"}, files={"file": open("scratch.wav", "rb")}).json()
```

**Errors for both endpoints:**
- `400 engine_unavailable`: the required engine or runtime isn't installed.
- `400 invalid_request`: neither `file` nor `take_id` was sent, both were sent, or no cleanup option was enabled.
- `404 not_found`: unknown take or voice.
- `400 file_too_large`

## Pronunciations
A dictionary applied to text before any engine speaks it. It covers:
- `POST /v1/speech`
- speech jobs
- batches and watch folders
- dubs
- books

Takes and transcripts keep the original text.

| | |
|---|---|
| `GET /v1/pronunciations` | All entries, alphabetical |
| `POST /v1/pronunciations` | `{"term": "SQL", "say": "sequel", "case_sensitive": false}` returns `201`. `409 conflict` if the term already exists (compared case-insensitively). |
| `PATCH /v1/pronunciations/{id}` | Any of `term`, `say`, `case_sensitive` |
| `DELETE /v1/pronunciations/{id}` | `204` |
| `POST /v1/pronunciations/preview` | `{"text": "…"}` returns `{"text": "…"}`, exactly what engines will receive |

Rules match whole words only: `SQL` matches in "learn SQL" but not in "MySQL". Longer terms are applied first, so `New York` wins over `York`.

**Event:** `pronunciations.changed` is sent after any change.
