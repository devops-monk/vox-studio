# Stories & audiobooks

Import a document, cast voices, and render it chapter by chapter into an audiobook.

- **`audiobook`** books use one narrator for everything.
- **`story`** books also give each speaking character their own voice. Dialogue is detected from quotes and attributions such as `"Come in," said Ann.` or `Ann whispered, "Quiet!"`.

## Import: `POST /v1/books`
`multipart/form-data`:
| Field | Description |
|---|---|
| `file` | `.epub`, `.docx`, `.txt` or `.md` (max 50 MB), **or** |
| `text` | pasted text |
| `kind` | `audiobook` (default) or `story` |
| `title` | Defaults to the document's title or the file name |
| `language` | Narration language, default `en`. Picks the default narrator voice. |

How chapters are found:
| Format | Chapters from |
|---|---|
| EPUB | The spine (reading order). Short pages such as covers and tables of contents are skipped. The title and author come from the metadata. |
| DOCX | Paragraphs styled Heading 1 or Heading 2 |
| Markdown | `#` and `##` headings |
| Text | Lines like `Chapter 3`, `CHAPTER THREE`, `Part II`, `Prologue` |

**Errors:** `400 invalid_document`

## Book object
| Field | Description |
|---|---|
| `kind`, `language`, `speed` | `speed` is 0.7–1.4 |
| `chapters[]` | `{id, title, text, words, status, duration_s, audio_url}`. `status` is `not_rendered`, `rendered` or `stale` (text, voices or pace changed since rendering). |
| `cast` | `{narrator: {engine, voice}, characters: {"Ann": {engine, voice} \| null}}`. `null` means the character uses the narrator's voice. |
| `characters` | Detected speakers: `[{name, lines}]` |
| `exports` | Finished exports: `{"m4b": "/v1/books/…/export/m4b"}` |
| `job_id` | The render or export in progress |

## `PATCH /v1/books/{id}`
Change the title, author, kind, speed, part of the cast, or chapter titles and text:
```json
{ "kind": "story", "cast": { "characters": { "Tom": { "engine": "kokoro", "voice": "am_michael" } } },
  "chapters": [{ "id": "a1b2c3d4", "text": "…corrected text…" }] }
```
Editing text re-detects characters.

## `POST /v1/books/{id}/render`
Body: `{"chapters": ["id", …]}` or `{}` for all. Renders only chapters that are new or stale, so it's **resumable**: if VoxStudio closes mid-book, run it again and it picks up where it stopped. The result is `{rendered, skipped}`.

## `GET /v1/books/{id}/chapters/{chapter_id}/audio` · `…/timings`
Timings drive read-along highlighting:
```json
{ "duration_s": 6.19,
  "timings": [{ "start": 0.6, "end": 1.9, "from": 0, "to": 20, "speaker": null },
              { "start": 1.9, "end": 2.6, "from": 22, "to": 35, "speaker": "Ann" }] }
```
`from` and `to` are character offsets into the chapter's `text`, and `speaker` is the character speaking (`null` for narration).

## Export
- `POST /v1/books/{id}/export` with `{"format": "m4b" | "mp3"}` starts a job. **M4B** is AAC with chapter markers and title and author tags, the standard audiobook format for Apple Books and most players. **MP3** is a single file.
- `GET /v1/books/{id}/export/{fmt}` downloads it.
- `POST /v1/books/{id}/save?format=m4b` with `{"path": …}` writes it to a file.

Every chapter must be rendered before exporting (`409 not_rendered`).

## `GET /v1/books?kind=story|audiobook` · `GET /v1/books/{id}` · `DELETE /v1/books/{id}`
