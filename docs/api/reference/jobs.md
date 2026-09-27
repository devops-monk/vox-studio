# Jobs

Long work, such as rendering a whole chapter, runs as a **job** in the background. You queue it, get an id straight back, and follow its progress.

Jobs run one at a time, in the order they were queued. Speech models use a lot of memory, so running jobs back to back is faster than running them in parallel.

## Job object
| Field | Type | Description |
|---|---|---|
| `id` | string | Unique id |
| `kind` | string | Job type. Today: `speech`. |
| `title` | string | Short label shown in the app's Activity list |
| `status` | string | `queued` → `running` → `succeeded`, `failed` or `cancelled` |
| `progress` | number | `0.0`–`1.0` |
| `message` | string \| null | The current step, e.g. `"Speaking part 3 of 12"` |
| `result` | object \| null | Set on success. Its shape depends on `kind`; see below. |
| `error` | string \| null | Set on failure |
| `created_at`, `updated_at` | number | Unix time in seconds |

**`result` for `speech` jobs**
```json
{ "take_id": "b32d…", "audio_url": "/v1/takes/b32d…/audio", "duration_s": 50.5 }
```

## `POST /v1/jobs/speech`
Queues text of any length (up to 200,000 characters). voxd splits it at sentence boundaries, renders each part, and joins the parts into a single [take](takes.md).

**Body**: the same fields as [`POST /v1/speech`](speech.md), with a longer `text` limit, plus:
| Field | Type | Description |
|---|---|---|
| `title` | string | Optional label (up to 120 characters). Defaults to the start of the text. |

**Response 202**: the new job, with `status: "queued"`.

```bash
curl -s -X POST "$VOXD/v1/jobs/speech" \
  -H "Authorization: Bearer $VOXD_TOKEN" -H "Content-Type: application/json" \
  -d "{\"text\": $(jq -Rs . < chapter1.txt), \"voice\": \"Daniel\", \"title\": \"Chapter 1\"}"
```

## `GET /v1/jobs/{id}/events` (server-sent events)
Streams a job's history and then its live updates. The stream closes on its own after the job finishes.

| Query | Default | Description |
|---|---|---|
| `after` | `0` | Only send events whose `id` (sequence number) is greater than this |

Each event has a sequence `id`, an `event` type (`status` or `progress`), and JSON `data` holding the fields that changed. The stream ends with `event: end`.

```
id: 3
event: progress
data: {"progress": 0.25, "message": "Speaking part 2 of 8"}

id: 10
event: status
data: {"status": "succeeded", "progress": 1.0, "message": "Done", "result": {...}}

event: end
data: {}
```

**Resuming:** events are stored, so if your connection drops, reconnect with `?after=<last id you saw>` and you'll get exactly the events you missed.

### Following a job (Python)
```python
import json, requests

job = s.post(f"{base}/v1/jobs/speech", json={"text": open("chapter1.txt").read(), "voice": "Daniel"}).json()

with s.get(f"{base}/v1/jobs/{job['id']}/events", stream=True) as stream:
    event = None
    for line in stream.iter_lines(decode_unicode=True):
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: ") and event in ("progress", "status"):
            data = json.loads(line[6:])
            if "progress" in data:
                print(f"{data['progress']:.0%}  {data.get('message') or ''}")
            if data.get("status") in ("succeeded", "failed", "cancelled"):
                print("→", data["status"], data.get("result") or data.get("error"))
```

### Following a job (JavaScript)
`EventSource` can't send headers, so pass the token in the query string:
```js
const events = new EventSource(`${base}/v1/jobs/${job.id}/events?token=${token}`)
events.addEventListener('progress', (e) => console.log(JSON.parse(e.data)))
events.addEventListener('status', (e) => console.log(JSON.parse(e.data)))
events.addEventListener('end', () => events.close())
```

## `GET /v1/jobs`
The most recent jobs, newest first. `limit`: 1–500, default 50.

## `GET /v1/jobs/{id}`
A single job. **Errors:** `404 not_found`

## `POST /v1/jobs/{id}/cancel`
- A **queued** job is cancelled immediately.
- A **running** job stops at its next checkpoint, usually within one sentence, and ends as `cancelled`.
- Cancelling a finished job does nothing and returns it unchanged.

## `DELETE /v1/jobs`
Removes every job that is no longer queued or running. Takes created by those jobs are kept.
```json
{ "deleted": 4 }
```

## If voxd stops mid-job
Jobs don't resume after a restart. When voxd starts, any job it finds still marked `queued` or `running` is set to `failed`, with the error `Interrupted: VoxStudio was closed while this was running`.
