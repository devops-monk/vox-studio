# Tags & collections

Tags are shared across voices, takes and projects. They're normalised to lower case, trimmed, capped at 24 characters, with at most 12 per item.

| | |
|---|---|
| `PUT /v1/takes/{id}/tags` | `{"tags": ["podcast", "intro"]}` replaces a take's tags. Returns the take. |
| `PUT /v1/projects/{id}/tags` | The same, for a project. Returns the project summary. |
| `PUT /v1/voices/meta` | `{"engine", "voice", "tags"}` for voices (see [Voices](voices.md)) |
| `GET /v1/takes?tag=podcast` | Takes with a tag (combines with the other filters) |
| `GET /v1/tags` | `[{"tag", "voices", "takes", "projects", "total"}]`, most used first |
| `GET /v1/tags/{tag}` | The collection: `{"tag", "voices": [{"engine", "voice"}], "takes": [Take], "projects": [Project]}` |
| `POST /v1/tags/{tag}/rename` | `{"to": "show"}` renames the tag everywhere. Onto an existing tag, the two merge. Returns `204`. |
| `DELETE /v1/tags/{tag}` | Removes the tag from everything; the items are kept. Returns `204`. |

Takes and projects include their `tags` in every response. Deleting a take or project removes its tags. **Event:** `tags.changed`.
