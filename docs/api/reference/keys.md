# API keys & connection

## `GET /v1/connection`
Everything a client needs to connect to this voxd:
```json
{ "url": "http://127.0.0.1:4870", "api_base": "http://127.0.0.1:4870/v1",
  "mcp_url": "http://127.0.0.1:4870/mcp", "openapi_url": "http://127.0.0.1:4870/openapi.json",
  "docs_url": "http://127.0.0.1:4870/docs",
  "bridge_path": "/Applications/VoxStudio.app/…/voxd/mcp_bridge.py", "auth_required": true }
```

### Finding voxd from a script
The app starts voxd on port **4870**. If that port is busy, voxd uses a free port instead. While voxd is running, it writes `voxd.json` into the VoxStudio data folder:

| OS | Data folder |
|---|---|
| macOS | `~/Library/Application Support/com.voxstudio.app/` |
| Windows | `%APPDATA%\VoxStudio\` |
| Linux | `~/.local/share/voxstudio/` |

The file looks like `{"url": "http://127.0.0.1:4870", "port": 4870, "pid": 12345, "version": "…"}`, and is removed when voxd stops.

## Keys
Only the VoxStudio app itself can manage keys; a key gets `403 forbidden` on these endpoints.

| | |
|---|---|
| `GET /v1/keys` | `[{"id", "name", "hint", "created_at", "last_used_at"}]`, newest first |
| `POST /v1/keys` | `{"name": "n8n"}` returns `201` with the same fields plus `key`. This is the only time the full key is returned. |
| `DELETE /v1/keys/{id}` | Revoke; `204` |

`last_used_at` is updated at most once a minute. The `keys.changed` event is sent after a key is created or revoked.
