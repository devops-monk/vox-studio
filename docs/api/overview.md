# voxd API overview

**voxd** is the engine inside VoxStudio: a small HTTP server that runs on your machine and does all the speech work. The app uses it, and so can your own scripts, tools and agents.

## Key facts
| | |
|---|---|
| Base URL | `http://127.0.0.1:<port>`. The port is `4870` by default, or the next free port if that one is busy. |
| Network | Loopback only. voxd never listens on your LAN or the internet. |
| Format | JSON requests and responses; audio is served as WAV |
| Versioning | Every path starts with `/v1`. Breaking changes will ship as `/v2` alongside `/v1`. |
| Auth | A bearer token. See [Authentication](authentication.md). |
| Live reference | `GET /docs` (interactive) and `GET /openapi.json` (OpenAPI 3.1 schema) |

## Concepts
- **Engine**: one speech technology. Today that's the built-in `system` voices and `kokoro`; Chatterbox and Whisper come in later releases. Each engine reports whether it's usable on your machine.
- **Model**: the downloadable files a neural engine needs. See [Models](reference/models.md).
- **Voice**: a speaker an engine can produce, identified by `id`.
- **Take**: one generated piece of audio. Takes are stored, listed and downloadable.

## Lifecycle
voxd reports its state at `GET /v1/status`:

```
booting → loading_engines → ready
                          ↘ error
```

Wait for `ready` before calling anything else. Other endpoints may fail while voxd is still starting.

## Running voxd on its own
You don't need the app open to use the API:

```bash
cd voxd
VOXD_TOKEN=my-secret uv run python -m voxd --port 4870
```

Omit `VOXD_TOKEN` to disable authentication. That is fine for local experiments, but never do it on a shared machine.
