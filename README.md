# VoxStudio

A private voice studio that runs entirely on your computer: text-to-speech, voice cloning, voice design, dubbing, transcription and audiobooks, in an Apple-style glass interface.

> **Status:** in active development. See [`plan.md`](plan.md) for the milestone roadmap. M0–M5 are done: app shell, local engine, jobs, model manager, Studio, voice cloning and the voice library.

## Highlights
- **Local and private:** no accounts or uploads. Models run on your machine.
- **Engines:**
  - built-in system voices
  - [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M): 54 natural voices in 9 languages
  - [Chatterbox](https://huggingface.co/ResembleAI/chatterbox): voice cloning with emotion control, using the Apple GPU, an NVIDIA GPU or the CPU
- **Studio:** script editor, voice picker, pace and emotion controls, takes with seekable waveforms.
- **Clone:** record or upload 10–20 seconds, with quality checks and a consent record.
- **Voice library:** favourites, tags, and portable `.voxvoice` files.
- **Background jobs:** progress, cancelling and replayable events, shown in one Activity centre.
- **Local API:** everything in the app is scriptable. See [docs](docs/README.md).

## Architecture
```
Tauri 2 shell (Rust)  ──supervises──▶  voxd (Python, FastAPI, SQLite)
React 19 + TS UI      ──HTTP/SSE/WS──▶   engines/  system · kokoro · chatterbox (isolated worker)
```

| Path | What |
|---|---|
| `src/` | React UI (glass design system, features, typed API client) |
| `src-tauri/` | Rust shell: window, voxd supervisor, native dialogs |
| `voxd/` | Inference daemon: API, jobs, model manager, engines, runtime packs |
| `docs/` | User guides and API reference |

## Develop
Requirements: Node 20+, Rust (stable), and [uv](https://docs.astral.sh/uv/).

```bash
npm install
npm run tauri dev        # launches the app; voxd starts automatically
```

Useful scripts:
```bash
npm run typecheck && npm test          # UI
cd voxd && uv run pytest               # daemon
cd src-tauri && cargo test             # shell
npm run api:gen                        # regenerate TS types from voxd's OpenAPI
```

## License
[Apache-2.0](LICENSE). Third-party models are downloaded on request and used under their own licenses. See [`voxd/src/voxd/engines/LICENSES.md`](voxd/src/voxd/engines/LICENSES.md).
