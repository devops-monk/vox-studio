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
| [Editor](guides/editor.md) | Trim, split, splice, fade and polish takes on a timeline |
| [Compare voices](guides/compare.md) | Blind A/B tests and your favourite voices per language |
| [History](guides/history.md) | Find, replay, star, save and clean up takes |
| [Projects](guides/projects.md) | Group your work; find every exported file |
| [Install, update & automate](guides/desktop.md) | Installing, updates, menus, `voxstudio://` links, uninstalling |
| [Settings](guides/settings.md) | Appearance, storage, performance, shortcuts, privacy and logs |
| [Integrations & developer tools](guides/integrations.md) | Connect Claude, Cursor, n8n and OpenAI SDKs; API keys; API explorer |
| [Tools](guides/tools.md) | Clean up recordings, change a voice, fix pronunciation |
| [Batch & watch folders](guides/batch.md) | Speak or transcribe many files; automate a folder |
| [Design a voice](guides/design.md) | Describe a voice in words and fine-tune it by ear |
| [Dub a video](guides/dub.md) | Translate and re-voice a video |
| [Stories & audiobooks](guides/stories-audiobooks.md) | Import books, cast characters, narrate, read along, export M4B |
| [Transcribe](guides/transcribe.md) | Files and live speech to text; fix and export |
| [Quick Speak & Speak Selection](guides/quick-speak.md) | Hear anything you type or select, from any app |
| [Dictation](guides/dictation.md) | Type with your voice in any app |

## Build with the API
| Page | |
|---|---|
| [Overview](api/overview.md) | How voxd works, base URL, versioning |
| [Quickstart](api/quickstart.md) | Generate speech in 3 requests (curl, Python, JavaScript) |
| [Authentication](api/authentication.md) | Tokens and API keys |
| [Errors](api/errors.md) | Error format and codes |

### Reference
| Resource | Endpoints |
|---|---|
| [API keys & connection](api/reference/keys.md) | `GET /v1/connection`, create and revoke keys, finding voxd |
| [OpenAI compatible](api/reference/openai.md) | `POST /v1/audio/speech`, `POST /v1/audio/transcriptions` |
| [MCP server](api/reference/mcp.md) | `POST /mcp` tools for AI agents; stdio bridge |
| [System](api/reference/system.md) | `GET /v1/status`, `GET /v1/system` |
| [Engines](api/reference/engines.md) | `GET /v1/engines` |
| [Models](api/reference/models.md) | `GET /v1/models`, download, remove, mirrors |
| [Voices](api/reference/voices.md) | `GET /v1/voices`, library, favorites and tags |
| [Custom voices](api/reference/custom-voices.md) | Create, rename or delete voices; export and import `.voxvoice` |
| [Projects & exports](api/reference/projects.md) | Projects, items, membership, export history |
| [Compare](api/reference/compare.md) | Blind ratings and the per-language leaderboard |
| [Tools & pronunciations](api/reference/tools.md) | Clean audio, voice conversion, pronunciation dictionary |
| [Batch & watch folders](api/reference/batch.md) | Batches of speech/transcription; folders processed automatically |
| [Stories & audiobooks](api/reference/books.md) | Import EPUB/DOCX/TXT/MD, cast, resumable render, timings, M4B/MP3 |
| [Dubbing](api/reference/dubbing.md) | Prepare, edit, cast, render and export dubs |
| [Transcription](api/reference/transcription.md) | File jobs, transcripts, exports, `WS /v1/transcribe/live` |
| [Voice design](api/reference/design.md) | Analyze, candidates from a description, designed voices |
| [Settings](api/reference/settings.md) | `GET`/`PATCH /v1/settings`, storage usage and clean-up, free memory |
| [Speech](api/reference/speech.md) | `POST /v1/speech` |
| [Jobs](api/reference/jobs.md) | `POST /v1/jobs/speech`, `GET /v1/jobs`, events (SSE), cancel, clear |
| [Live events](api/reference/events.md) | `WS /v1/events` |
| [Takes](api/reference/takes.md) | Search, page, audio, star, export, delete, stats, retention, edit |

A live, interactive reference is always available from a running voxd at `http://127.0.0.1:<port>/docs`.
