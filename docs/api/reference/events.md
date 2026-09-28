# Live events

## `WS /v1/events`
One WebSocket carries everything happening in voxd. This is how the app stays in sync without polling.

**Authentication:** browsers can't set headers on WebSockets, so pass the token as a query parameter:
```
ws://127.0.0.1:4870/v1/events?token=<token>
```
A wrong token closes the socket with code `4401`.

## Messages
Every message is JSON: `{"type": "...", "data": {...}}`.

| `type` | `data` | When |
|---|---|---|
| `hello` | `{"version": "0.1.0"}` | Right after connecting |
| `job` | a full [job object](jobs.md#job-object) | Whenever a job is queued, makes progress or finishes |
| `models.changed` | `{"id": "kokoro-v1", "installed": true}` | A model finished downloading or was removed. Refresh engines, voices and models. |
| `voices.changed` | `{"id": "cv_…"}` | A custom voice was created, renamed or deleted |
| `take.updated` | a take object | A take was starred or unstarred |
| `takes.deleted` | `{"ids": […]}` | Takes were deleted, by you or by retention |
| `design.ready` | `{"voices": 28}` | Voice analysis for design finished |
| `transcripts.changed` | `{"id": …}` | A transcript was created, edited or deleted |
| `dubs.changed` | `{"id": …}` | A dub's status or content changed |
| `books.changed` | `{"id": …}` | A book was imported, edited, narrated or exported |
| `batches.changed` | `{"id": …}` | A batch was created or removed. Item progress comes through `job` events. |
| `watch.changed` | `{"id": …}` | A watch folder was added, changed, or picked up a new file |
| `take.created` | a [take object](takes.md#take-object), without `audio_url` | Whenever a new take is saved, by any client |

More event types will be added over time. Ignore any `type` you don't recognize.

## Example (JavaScript)
```js
const ws = new WebSocket(`ws://127.0.0.1:4870/v1/events?token=${token}`)
ws.onmessage = (e) => {
  const { type, data } = JSON.parse(e.data)
  if (type === 'job') console.log(`${data.title}: ${data.status} ${Math.round(data.progress * 100)}%`)
  if (type === 'take.created') console.log('New take:', data.text)
}
```

## Delivery
- Events are **live only**: you receive what happens while you're connected. After a reconnect, re-fetch lists (`GET /v1/jobs`, `GET /v1/takes`) to catch up. For a single job's complete history, use [`GET /v1/jobs/{id}/events`](jobs.md#get-v1jobsidevents-server-sent-events), which replays.
- A client that stops reading may miss messages rather than slow voxd down.
