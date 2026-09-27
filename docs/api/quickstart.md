# Quickstart

Generate speech and save it as a file in three requests.

**Before you start:** have voxd running (see [Running voxd on its own](overview.md#running-voxd-on-its-own)). The examples assume:

```bash
export VOXD=http://127.0.0.1:4870
export VOXD_TOKEN=my-secret
```

## curl
```bash
# 1. Pick a voice
curl -s "$VOXD/v1/voices?engine=system" -H "Authorization: Bearer $VOXD_TOKEN" | head -c 300

# 2. Generate speech
curl -s -X POST "$VOXD/v1/speech" \
  -H "Authorization: Bearer $VOXD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from VoxStudio!", "voice": "Samantha"}'
# → {"id":"5128…","duration_s":1.6,"audio_url":"/v1/takes/5128…/audio", …}

# 3. Download the audio
curl -s "$VOXD/v1/takes/<id>/audio" -H "Authorization: Bearer $VOXD_TOKEN" -o hello.wav
```

## Python
```python
import os, requests

base = os.environ.get("VOXD", "http://127.0.0.1:4870")
s = requests.Session()
s.headers["Authorization"] = f"Bearer {os.environ['VOXD_TOKEN']}"

voice = s.get(f"{base}/v1/voices", params={"engine": "system"}).json()[0]["id"]
take = s.post(f"{base}/v1/speech", json={"text": "Hello from VoxStudio!", "voice": voice}).json()

with open("hello.wav", "wb") as f:
    f.write(s.get(base + take["audio_url"]).content)
print(f"Saved {take['duration_s']:.1f}s of audio")
```

## JavaScript (Node 18+)
```js
import { writeFile } from 'node:fs/promises'

const base = process.env.VOXD ?? 'http://127.0.0.1:4870'
const headers = { Authorization: `Bearer ${process.env.VOXD_TOKEN}`, 'Content-Type': 'application/json' }

const [voice] = await (await fetch(`${base}/v1/voices?engine=system`, { headers })).json()
const take = await (
  await fetch(`${base}/v1/speech`, { method: 'POST', headers, body: JSON.stringify({ text: 'Hello from VoxStudio!', voice: voice.id }) })
).json()

const audio = await fetch(base + take.audio_url, { headers })
await writeFile('hello.wav', Buffer.from(await audio.arrayBuffer()))
console.log(`Saved ${take.duration_s.toFixed(1)}s of audio`)
```

## Next
- Control pace with `speed` (0.5–2.0). See [Speech](reference/speech.md).
- List everything you've generated with [Takes](reference/takes.md).
