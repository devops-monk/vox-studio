# Settings

## Settings object
| Field | Type | Description |
|---|---|---|
| `compute_device` | string | Where PyTorch engines (Chatterbox) run: `auto`, `cpu`, `mps` (Apple GPU) or `cuda` (NVIDIA). `auto` picks the fastest available. |
| `compute_device_in_use` | string \| null | The device the running engine actually uses, or null if none is loaded. If a GPU can't run the model, voxd falls back to `cpu` and reports it here. |

## `GET /v1/settings`

## `PATCH /v1/settings`
Changes only the fields you send. A new `compute_device` takes effect the next time the engine runs.

```bash
curl -s -X PATCH "$VOXD/v1/settings" -H "Authorization: Bearer $VOXD_TOKEN" \
  -H "Content-Type: application/json" -d '{"compute_device": "cpu"}'
```
**Errors:** `400 unsupported_device` (this computer doesn't have that device; see `accelerators` in [`GET /v1/system`](system.md)), `422 invalid_request`

### Measured on an Apple M1 Pro (Chatterbox, warm)
| Device | Time for ~2 s of speech |
|---|---|
| `mps` (Apple GPU) | ~13 s |
| `cpu` | ~17 s |

The first request after launch also loads the model, which takes about 45 s.
