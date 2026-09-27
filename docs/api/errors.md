# Errors

Every error returns a non-2xx status and the same JSON shape:

```json
{ "error": "synthesis_failed", "message": "Unknown voice: Samnatha" }
```

- `error` is a stable code. Branch on this.
- `message` is human-readable and may change. Show it to people, but don't parse it.

| Status | `error` | Meaning | What to do |
|---|---|---|---|
| 400 | `engine_unavailable` | The engine doesn't exist or can't run on this machine | Check `GET /v1/engines` → `unavailable_reason` |
| 400 | `synthesis_failed` | The engine rejected the request (e.g. an unknown voice) | Fix the input; see `message` |
| 401 | `unauthorized` | Missing or wrong token | See [Authentication](authentication.md) |
| 404 | `not_found` | The resource doesn't exist | Check the id |
| 422 | `invalid_request` | The body failed validation; `message` names the field | Fix the field |
| 5xx | — | A voxd bug or crash | Retry once, then check the logs in the app (**Show details**) |

## Retries
- Retry `5xx` and connection errors with backoff (for example 0.5s, 1s, 2s).
- Don't retry `4xx`; the same request will fail the same way.
- If voxd is restarting, `GET /v1/status` answers first. Wait for `phase: "ready"`.
