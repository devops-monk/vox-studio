# Voices

## `GET /v1/voices`
Lists the voices an engine can speak with.

**Query parameters**
| Name | Default | Description |
|---|---|---|
| `engine` | `system` | Engine id from [`GET /v1/engines`](engines.md) |

**Response 200**: an array of:
| Field | Type | Description |
|---|---|---|
| `id` | string | Pass as `voice` to [`POST /v1/speech`](speech.md) |
| `name` | string | Display name |
| `language` | string | BCP-47 tag, e.g. `en-US`, `fr-FR` |
| `sample` | string \| null | A sample sentence in the voice's language (system voices) |
| `gender` | string \| null | `female`, `male`, or null when unknown |

**Errors:** `400 engine_unavailable`

```bash
curl -s "$VOXD/v1/voices?engine=system" -H "Authorization: Bearer $VOXD_TOKEN"
# [{"id":"Samantha","name":"Samantha","language":"en-US","sample":"Hello! My name is Samantha."}, …]
```

```bash
curl -s "$VOXD/v1/voices?engine=kokoro" -H "Authorization: Bearer $VOXD_TOKEN"
# [{"id":"af_heart","name":"Heart","language":"en-US","sample":null,"gender":"female"}, …]
```

**Tip:** to pick a voice for the user's language, filter on `language` starting with their language code (for example `fr`).

## `GET /v1/voices/library`
Every voice in one list: the voices of each installed engine plus your [custom voices](custom-voices.md), with your favorites and tags.

| Field | Type | Description |
|---|---|---|
| `engine` | string | The engine that speaks it (custom voices: the cloning engine) |
| `id`, `name`, `language`, `gender` | | As in `GET /v1/voices` |
| `custom` | boolean | A voice you created from a recording |
| `available` | boolean | Its engine is installed. Custom voices stay listed, with `false`, when no cloning engine is installed. |
| `favorite` | boolean | |
| `tags` | string[] | Sorted, lowercase |
| `duration_s`, `created_at` | number \| null | Custom voices only |

## `PUT /v1/voices/meta`
Favorite or tag **any** voice, built-in or custom. Only the fields you send change.

```bash
curl -s -X PUT "$VOXD/v1/voices/meta" -H "Authorization: Bearer $VOXD_TOKEN" -H "Content-Type: application/json" \
  -d '{"engine": "kokoro", "voice": "af_heart", "favorite": true, "tags": ["warm", "narration"]}'
```
| Field | Type | Description |
|---|---|---|
| `engine` | string | The voice's engine. Ignored for custom voices (`cv_…`), whose favorites and tags apply everywhere. |
| `voice` | string | Voice id |
| `favorite` | boolean | Optional |
| `tags` | string[] | Optional. Replaces the tag list: up to 12 tags, each trimmed and truncated to 24 characters; duplicates are removed. |

**Response 204**, and a `voices.changed` [event](events.md) is sent.
