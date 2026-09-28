# Projects & export history

**Projects** group related work: takes, transcripts, dubs and books. An item can belong to several projects, and deleting a project never deletes its items.

**Export history** records every file VoxStudio writes to your disk: saved takes, transcripts, dubs and books, plus batch outputs. That way you can always find where something went.

## Project object
| Field | Description |
|---|---|
| `id`, `name`, `color` (`#rrggbb`), `description` | |
| `item_count`, `created_at`, `updated_at` | |
| `items` | Detail view only: `[{kind, id, title, subtitle, created_at, added_at, missing}]`. `missing: true` means the item was deleted after being added. |
| `exports` | Detail view only: the export history of the project's items |

## Endpoints
| | |
|---|---|
| `GET /v1/projects` | List, most recently updated first |
| `POST /v1/projects` | `{"name": "Launch video", "color": "#ff375f", "description": ""}` |
| `GET /v1/projects/{id}` | With items and exports |
| `PATCH /v1/projects/{id}` | Any of `name`, `color`, `description` |
| `DELETE /v1/projects/{id}` | Removes the project; its items are kept |
| `POST /v1/projects/{id}/items` | `{"kind": "take" \| "transcript" \| "dub" \| "book", "id": "…"}`. Adding the same item twice is harmless. |
| `DELETE /v1/projects/{id}/items/{kind}/{item_id}` | |
| `GET /v1/projects/membership?kind=take&id=…` | Ids of the projects that contain an item |

**Errors:** `404 not_found` (unknown project, or an item that doesn't exist), `422 invalid_request` (for example a bad colour)

## `GET /v1/exports`
Every exported file, newest first:
```json
[{ "id": "…", "kind": "take", "item_id": "…", "title": "Welcome to VoxStudio…", "format": "wav",
   "path": "/Users/me/Desktop/welcome.wav", "bytes": 173050, "at": 1790600000.0, "exists": true }]
```
`exists` is `false` if the file has since been moved or deleted.

## Events
`projects.changed` (`{"id"}`) is sent when a project or its items change.
