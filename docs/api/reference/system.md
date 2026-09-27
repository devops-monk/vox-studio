# System

## `GET /v1/status`
Daemon health and boot phase. **No token needed.** Safe to poll.

**Response 200**
| Field | Type | Description |
|---|---|---|
| `name` | string | Always `"voxd"`; use it to confirm you've reached voxd and not another service |
| `version` | string | voxd version, e.g. `"0.1.0"` |
| `phase` | string | `booting`, `loading_engines`, `ready` or `error` |
| `detail` | string \| null | What's happening, or the error message |
| `uptime_s` | number | Seconds since voxd started |

```bash
curl -s http://127.0.0.1:4870/v1/status
# {"name":"voxd","version":"0.1.0","phase":"ready","detail":null,"uptime_s":12.4}
```

## `GET /v1/system`
Facts about this computer that voxd uses to recommend models.

| Field | Type | Description |
|---|---|---|
| `os`, `os_version` | string | e.g. `macOS`, `14.5` |
| `arch`, `chip` | string | e.g. `arm64`, `Apple M1 Pro` |
| `cpu_count` | number | Logical cores |
| `ram_bytes` | number | Physical memory |
| `disk_free_bytes` | number | Free space where models are stored |
