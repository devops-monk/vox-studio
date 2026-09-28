# MCP server

voxd is a [Model Context Protocol](https://modelcontextprotocol.io) server. AI agents and assistants can use it to speak, transcribe and polish audio on your computer.

- **Streamable HTTP:** `POST http://127.0.0.1:4870/mcp`, authenticated with `Authorization: Bearer vox_sk_…`. Replies are plain JSON; there is no SSE stream, so `GET /mcp` returns `405`. Batches are supported.
- **stdio:** run `python3 <bridge_path>` with `VOX_API_KEY` set. `bridge_path` comes from [`GET /v1/connection`](keys.md). The bridge uses only the standard library. It finds voxd through `voxd.json`, or through `VOXD_URL` if set.

Protocol versions: `2025-06-18`, `2025-03-26` and `2024-11-05`.

## Tools
| Tool | Arguments | Result |
|---|---|---|
| `speak` | `text`, `voice?`, `speed?`, `save_to?`, `play?` | Take id, duration and audio path. `play: true` also plays it through the speakers. |
| `list_voices` | `language?` (prefix like `en`), `engine?` | Tab-separated `id, name, language, engine`, natural voices first |
| `transcribe` | `path`, `language?`, `timestamps?` | Text, or timestamped lines |
| `clean_audio` | `path`, `trim_pauses?`, `loudness?` (LUFS), `save_to?` | Before/after levels and the path of the cleaned audio |
| `convert_voice` | `path`, `voice` (`default` or `cv_…`), `save_to?` | Path of the converted audio (needs Chatterbox) |
| `add_pronunciation` | `term`, `say` | Adds or updates a [pronunciation](tools.md#pronunciations) |

- `save_to` takes an absolute path ending in `.wav`, `.mp3`, `.m4a`/`.aac`, `.opus`/`.ogg` or `.flac`. The saved file is added to the export history.
- Tool failures come back as results with `isError: true` and a readable message, so the agent can recover.

## Example
```bash
curl http://127.0.0.1:4870/mcp -H "Authorization: Bearer $VOX_API_KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"speak","arguments":{"text":"Deploy finished","voice":"nova","play":true}}}'
```
The **Integrations** page in the app has setup instructions for Claude Code, Claude Desktop, Cursor, VS Code and more, with your port and key already filled in.
