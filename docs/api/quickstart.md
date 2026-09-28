# Quickstart

Make your first request to the VoxStudio API: check the engine, create a key, generate speech and save it as a file. It takes about five minutes.

## 1. Open VoxStudio
The API is served by **voxd**, the voice engine that starts with the app. It listens on this computer only, at `http://127.0.0.1:4870`. Check that it's up; this is the one endpoint that doesn't need a key:

```bash
curl http://127.0.0.1:4870/v1/status
```

```json
{ "name": "voxd", "version": "0.1.1", "phase": "ready", "detail": null, "uptime_s": 42.7 }
```

When `phase` is `ready`, the engine can take requests.

> [!NOTE]
> If port 4870 is busy, voxd picks another free port. The address in use is shown in **Developer → Connection** and is written to `voxd.json` in the VoxStudio data folder. See [finding voxd](reference/keys.md#finding-voxd-from-a-script).

## 2. Create an API key
In the app, open **Integrations** (or **Developer**), type a name such as “my script”, and click **Create key**. Copy the key, because it's shown only once, and keep it in an environment variable:

```bash
export VOX_API_KEY="vox_sk_…"
export VOX_URL="http://127.0.0.1:4870"
```

Every request sends it as a Bearer token: `Authorization: Bearer $VOX_API_KEY`. More in [Authentication](authentication.md).

## 3. Generate speech
`POST /v1/speech` renders text with a voice and waits for the result. `af_heart` is one of the natural Kokoro voices; list them all with `GET /v1/voices?engine=kokoro`.

```bash title="curl"
curl -X POST "$VOX_URL/v1/speech" \
  -H "Authorization: Bearer $VOX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from VoxStudio!", "voice": "af_heart", "engine": "kokoro"}'
```

```python title="Python"
import os, requests

base = os.environ.get("VOX_URL", "http://127.0.0.1:4870")
api = requests.Session()
api.headers["Authorization"] = f"Bearer {os.environ['VOX_API_KEY']}"

take = api.post(f"{base}/v1/speech", json={
    "text": "Hello from VoxStudio!",
    "voice": "af_heart",
    "engine": "kokoro",
}).json()
print(take["id"], take["duration_s"])
```

```js title="JavaScript"
const base = process.env.VOX_URL ?? 'http://127.0.0.1:4870'
const headers = { Authorization: `Bearer ${process.env.VOX_API_KEY}`, 'Content-Type': 'application/json' }

const take = await (
  await fetch(`${base}/v1/speech`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: 'Hello from VoxStudio!', voice: 'af_heart', engine: 'kokoro' }),
  })
).json()
console.log(take.id, take.duration_s)
```

The response is a **take**, the same kind of item you see in the app's History:

```json
{
  "id": "5128b1c0e2f94d6f8e1d2c3b4a5f6e7d",
  "engine": "kokoro",
  "voice": "af_heart",
  "text": "Hello from VoxStudio!",
  "duration_s": 1.62,
  "starred": false,
  "created_at": 1790601387.68,
  "tags": [],
  "audio_url": "/v1/takes/5128b1c0e2f94d6f8e1d2c3b4a5f6e7d/audio"
}
```

> [!TIP]
> `POST /v1/speech` handles up to 5,000 characters. For longer scripts, or slower engines such as voice cloning, use `POST /v1/jobs/speech`. It runs in the background with progress, and you can follow it with [Jobs](reference/jobs.md).

## 4. Save the audio
Fetch `audio_url` with the same key to get a 24 kHz WAV:

```bash title="curl"
curl "$VOX_URL/v1/takes/<id>/audio" -H "Authorization: Bearer $VOX_API_KEY" -o hello.wav
```

```python title="Python"
with open("hello.wav", "wb") as f:
    f.write(api.get(base + take["audio_url"]).content)
```

```js title="JavaScript"
import { writeFile } from 'node:fs/promises'

const audio = await fetch(base + take.audio_url, { headers })
await writeFile('hello.wav', Buffer.from(await audio.arrayBuffer()))
```

## 5. Or use an OpenAI SDK
If your code already uses OpenAI's audio API, point it at VoxStudio instead. It can also return MP3, Opus, AAC or FLAC.

```python title="Python"
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:4870/v1", api_key=os.environ["VOX_API_KEY"])

with client.audio.speech.with_streaming_response.create(
    model="tts-1", voice="nova", input="Hello from VoxStudio!"
) as res:
    res.stream_to_file("hello.mp3")

text = client.audio.transcriptions.create(model="whisper-1", file=open("hello.mp3", "rb"))
print(text.text)
```

```js title="JavaScript"
import OpenAI from 'openai'
import fs from 'node:fs'

const client = new OpenAI({ baseURL: 'http://127.0.0.1:4870/v1', apiKey: process.env.VOX_API_KEY })

const speech = await client.audio.speech.create({ model: 'tts-1', voice: 'nova', input: 'Hello from VoxStudio!' })
fs.writeFileSync('hello.mp3', Buffer.from(await speech.arrayBuffer()))
```

Voice names such as `nova` or `onyx` map to similar local voices. See [OpenAI compatible](reference/openai.md).

## Next steps
- **Shape the delivery:** set `speed` (0.5–2), or turn on `"markup": true` for pauses, emphasis and pronunciations. See [Speech](reference/speech.md#script-markup).
- **Use your own voice:** clone one in the app, then pass its `cv_…` id as `voice`. See [Custom voices](reference/custom-voices.md).
- **Transcribe, dub and more:** [Transcription](reference/transcription.md), [Dubbing](reference/dubbing.md), [Tools](reference/tools.md).
- **Connect an AI agent:** VoxStudio is an [MCP server](reference/mcp.md).
- **Handle errors:** every error has a stable code. See [Errors](errors.md).
