# VoxStudio Documentation

VoxStudio is a private voice studio that runs entirely on your computer. These docs cover the app and **voxd**, the local API that powers it.

## Use the app
| Guide | What you'll do |
|---|---|
| [Your first voice in 60 seconds](guides/first-voice.md) | Launch VoxStudio and hear a voice |
| [Background work & Activity](guides/activity.md) | Long renders, progress and cancelling |
| [Voice models](guides/models.md) | Download natural voices and manage disk space |
| [Studio](guides/studio.md) | Write a script, pick a voice, shape the delivery |
| [Clone a voice](guides/clone.md) | Make a voice from a short recording |
| [Your voice library](guides/voices.md) | Browse, favorite, tag, share and import voices |
| [Design a voice](guides/design.md) | Describe a voice in words and fine-tune it by ear |
| Dub a video *(M9)* | Translate and re-voice a video |
| Stories & audiobooks *(M10)* | Long-form, multi-voice narration |
| Transcribe & dictate *(M8)* | Speech to text, anywhere |

## Build with the API
| Page | |
|---|---|
| [Overview](api/overview.md) | How voxd works, base URL, versioning |
| [Quickstart](api/quickstart.md) | Generate speech in 3 requests (curl, Python, JavaScript) |
| [Authentication](api/authentication.md) | Tokens, and how to get one |
| [Errors](api/errors.md) | Error format and codes |

### Reference
| Resource | Endpoints |
|---|---|
| [System](api/reference/system.md) | `GET /v1/status`, `GET /v1/system` |
| [Engines](api/reference/engines.md) | `GET /v1/engines` |
| [Models](api/reference/models.md) | `GET /v1/models`, download, remove, mirrors |
| [Voices](api/reference/voices.md) | `GET /v1/voices`, library, favorites and tags |
| [Custom voices](api/reference/custom-voices.md) | Create, rename or delete voices; export and import `.voxvoice` |
| [Voice design](api/reference/design.md) | Analyze, candidates from a description, designed voices |
| [Settings](api/reference/settings.md) | `GET`/`PATCH /v1/settings` (compute device) |
| [Speech](api/reference/speech.md) | `POST /v1/speech` |
| [Jobs](api/reference/jobs.md) | `POST /v1/jobs/speech`, `GET /v1/jobs`, events (SSE), cancel, clear |
| [Live events](api/reference/events.md) | `WS /v1/events` |
| [Takes](api/reference/takes.md) | List, audio, star, export |

A live, interactive reference is always available from a running voxd at `http://127.0.0.1:<port>/docs`.
