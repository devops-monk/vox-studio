# VoxStudio — Build Plan

VoxStudio is a local, private voice studio for macOS, Windows and Linux: voice cloning, voice design, dubbing, dictation, transcription, stories/audiobooks and batch jobs, in an Apple‑style glass UI.

**VoxStudio is an original implementation.**
- VoiceStudio (`../VoiceStudio`) was used only as a feature reference: *what* a voice studio should do.
- No VoiceStudio source code, UI, API design or database schema is copied or ported.
- All code in this repo is written from scratch.
- Models are third-party open-weight models, used under their own licenses. Each one is listed below and credited in the About screen.
- **License:** VoxStudio is Apache-2.0 (`LICENSE`, `NOTICE`). Engine licenses are tracked in `voxd/src/voxd/engines/LICENSES.md`.

## Architecture

```
┌──────────── VoxStudio.app ────────────┐
│  UI (React 19 + TS, glass design)     │
│        │  HTTP / SSE / WebSocket      │
│  Tauri 2 shell (Rust)                 │
│   • supervises voxd                   │
│   • hotkeys, tray, file access        │
└────────┬──────────────────────────────┘
         │ spawns + watches (stdin lifeline)
┌────────▼──────────────────────────────┐
│  voxd — our inference daemon (Python) │
│   FastAPI · SQLite · Engine registry  │
│   engines/: say, kokoro, chatterbox,  │
│             whisper, argos, …         │
└───────────────────────────────────────┘
```

- **UI:** React 19, TypeScript, Vite, Tailwind v4, TanStack Router (hash), TanStack Query and zustand.
- **Shell:** Tauri 2 in Rust. `src-tauri/src/voxd.rs` supervises the daemon.
- **Daemon:** `voxd/` is written from scratch and managed with `uv`.
  - It speaks our own REST API under `/v1`.
  - Every engine implements one small interface (`Engine.describe()`, `.synthesize()`, `.transcribe()`, …). New models plug in without touching the API layer.
- **Data:** the app-data directory holds `voxd.db` (SQLite), plus `voices/`, `renders/` and `models/`.

## Engines (all permissively licensed)
| Engine | Purpose | License | Milestone |
|---|---|---|---|
| `system` (macOS `say` / Windows SAPI / espeak-ng) | Instant TTS with zero download, for first run and tests | OS built-in | M1 |
| Kokoro‑82M | Fast, high-quality TTS, many preset voices | Apache‑2.0 | M3 |
| Chatterbox | Zero-shot voice cloning with emotion control | MIT | M4 |
| faster‑whisper / mlx‑whisper | Transcription and dictation | MIT | M8 |
| Argos Translate | Offline translation for dubbing | MIT | M9 |
| Demucs | Separate music and speech for dubbing | MIT | M9 |

Before adding any model, verify its license and record it in `voxd/engines/LICENSES.md`.

Work goes one milestone at a time. Tick `[x]` only after the item is verified in the running app.

---

## Design language: "Glass"

- The window is transparent. macOS gets native vibrancy; Windows gets Mica.
- The title bar is an overlay with inset traffic lights, and the toolbar is the drag region.
- Surfaces come in three layers:
  1. sidebar: vibrancy only
  2. content: `--glass-1`
  3. cards and popovers: `--glass-2` / `--glass-3`, with blur 30–40px and saturate 180–200%
- Every surface has a 0.5px hairline border, an inner top highlight and layered soft shadows.
- Type: SF Pro (the system stack), 13px base, tight tracking on headings.
- Motion: spring easing, 150–300ms, staggered entrances. Respect reduced-motion and reduced-transparency.
- Signature details:
  - a living waveform "orb" for the engine and daemon status
  - accent-tinted icon tiles
  - soft gradients behind empty states
- UI bar for every milestone: hover, focus, empty, loading and error states are all designed, not left as defaults.

---

## Milestones

### M0 — Scaffold & glass shell ✅
- [x] Tauri 2 + Vite + React 19 + TS, Tailwind v4
- [x] Transparent window, overlay title bar, vibrancy / Mica
- [x] Glass tokens and primitives (`GlassPanel`, `Button`, `SegmentedControl`, `Kbd`)
- [x] Sidebar, placeholder pages, ⌘K palette, light/dark/system theme

### M1 — voxd core + supervisor ✅
- [x] `voxd/` package: FastAPI app, config (data dir, port), SQLite with our own schema and migrations
- [x] Lifeline: voxd exits when the shell's stdin pipe closes, so no orphan processes are left behind
- [x] Boot phases reported at `GET /v1/status` (`booting → loading_engines → ready | error`)
- [x] Engine interface and registry, plus the `system` TTS engine (zero download)
- [x] `GET /v1/engines`, `GET /v1/voices?engine=`, `POST /v1/speech` → WAV
- [x] Rust `voxd.rs` supervisor:
  - [x] find `uv` (bundled, then PATH)
  - [x] `uv run` the daemon on a free port
  - [x] stream logs, poll `/v1/status`, emit `voxd://state`
  - [x] restart with backoff; kill on quit
- [x] Commands: `voxd_state`, `voxd_restart`, `voxd_logs`
- [x] UI:
  - [x] startup screen with the animated waveform orb and live phases
  - [x] status orb in the sidebar
  - [x] "Try a voice" card on Home that speaks through the system engine

- [x] Docs: first-voice guide, API overview, quickstart (curl/Python/JS, verified), auth, errors, reference

**Done when:** launching the app starts voxd automatically, Home can speak a sentence, and quitting leaves no `voxd` process.

### M2 — API client, jobs & realtime ✅
- [x] Typed client generated from voxd's OpenAPI (`npm run api:gen` → `src/lib/voxd/schema.d.ts`, `openapi-fetch`)
- [x] Job system in voxd: a persistent queue, progress, cancel, events stored with replay (`/v1/jobs`, SSE `/v1/jobs/{id}/events?after=`), jobs interrupted by a restart marked failed
- [x] First job kind: `speech` for long text (sentence chunking, stitched into one take)
- [x] `WS /v1/events` → query-cache updates; polling fallback while the socket is down
- [x] **Activity** popover: progress ring on the toolbar icon, live rows, cancel/play, clear finished, completion toasts
- [x] Try a voice routes long text through jobs (orb shows %, auto-plays when done)
- [x] Hardening: tokens redacted from logs; a real-server test covers WebSocket support
- [x] Docs: Jobs + Live events reference, Activity guide (examples verified live)

### M3 — Model manager & Kokoro ✅
- [x] Model catalog with size, license and hardware fit (`GET /v1/models`, `GET /v1/system`)
- [x] Downloads as network-lane jobs: resumable (HTTP Range), SHA-256 verified, cancelable, progress in Activity; remove frees disk
- [x] `VOXD_MODEL_MIRROR` for offline/firewalled installs
- [x] Kokoro engine (ONNX, CPU): 54 voices, 9 languages, gender and language metadata; lazy load, unload on remove
- [x] Models page (generated art, fit badges, live progress, Try, confirm-to-remove)
- [x] First-run onboarding sheet (welcome → choose → download → ready)
- [x] Try a voice: System | Kokoro switch, per-engine remembered voice, curated defaults
- [x] Docs: Models reference and guide, `/v1/system`, voice gender, first-voice onboarding
- Moved to M4: compute-device picker (arrives with the first GPU engine, Chatterbox)

### M4 — Studio & Clone ✅
- [x] **Engine workers:** heavy engines run in isolated runtime packs (own venv via `uv`, JSON-lines worker process, idle shutdown, crash-restart); a pack upgrades itself when its requirements change
- [x] Chatterbox (MIT) cloning engine with an emotion control; weights pinned to a commit and SHA-256 verified; inaudible AI watermark kept on
- [x] Compute-device setting (Auto / CPU / Apple GPU / NVIDIA) with fallback to CPU and "in use" reporting; measured on M1 Pro: MPS about 13 s vs CPU about 17 s per ~2 s of speech
- [x] Custom voices API (WAV upload, validation, consent statement required) plus star and export for takes
- [x] Studio page: persistent script editor, word and time estimate, voice picker with search and "Your voices", pace and emotion sliders, takes with seekable waveforms, star, Save as… (native dialog)
- [x] Clone page: record with level meter or upload any format (decoded and resampled in the webview), quality checks, consent step, "Hear it", "Use in Studio"
- [x] Shared speech runner: slow engines and long text run as background jobs with Cancel
- [x] macOS microphone usage description (`Info.plist`)
- [x] Docs: Custom voices and Settings reference, Studio and Clone guides, updates to engines, models, takes, events and speech

### M5 — Voices library ✅
- [x] Unified library across engines and custom voices (`GET /v1/voices/library`), sorted favorites → yours → neural → system
- [x] Favorites and tags for any voice (`PUT /v1/voices/meta`), optimistic and serialized (no lost edits)
- [x] Voice cards with generated gradient avatars, hover preview (built-in voices speak an intro; custom voices play the original), search, filters, tag chips
- [x] Detail panel: rename, tag editor with suggestions, favorite, consent record (statement, who, when), Use in Studio, export, confirm delete
- [x] Consent record now includes who gave consent (`consent_by`); schema migration v4
- [x] `.voxvoice` bundle export and import (validated; the importer's consent is added to the original record)
- [x] Studio voice picker shows a Favorites section
- [x] Docs: library, meta, bundles; Voices guide

### M6 — Voice Design ✅
- [x] Our own design method: measure Kokoro voices (YIN pitch, spectral brightness, loudness expressiveness; cached), read the description into depth/warmth/energy targets plus gender, accent and pace, then blend the nearest voices' style vectors
- [x] Kokoro speaks blends (`mix:…` recipes) and saved designed voices (`dv_…`)
- [x] API: design status, one-time analysis job, candidates (with slider overrides), designed voices CRUD; schema migration v5
- [x] Design page: description with "Understood" chips and examples, 4 candidates (match %, trait bars, Listen), live sliders, pace, save; list of designed voices
- [x] Designed voices in the library (badge, rename, delete, "Designed from"), Studio's "Your voices", take labels
- [x] Docs: design reference (including the vocabulary) and guide
- Measured on M1 Pro: analysis of 28 voices ≈ 51 s; candidates are instant; previews about 1 s

### M7 — History
- [ ] Inspector panel listing all takes, with search, filter, star and retention

### M8 — Transcribe & Dictate
- [ ] Whisper engine: transcribe a file, export (txt/srt/vtt)
- [ ] Live transcription over WebSocket
- [ ] Global-hotkey dictation into any app, a floating glass capture pill, and a menu-bar tray

### M9 — Dubbing
- [ ] Import video (file or URL), transcribe, detect speakers, translate (Argos)
- [ ] Cast a voice per speaker, timeline editor, re-time lines to fit
- [ ] Separate the background with Demucs, mix, and export video, audio or subtitles

### M10 — Stories & Audiobooks
- [ ] Import txt/md/docx/epub, detect chapters and characters
- [ ] Assign a cast, render chapters, run long renders as resumable jobs
- [ ] Player with synced text highlighting, export m4b/mp3

### M11 — Batch & Watch folders
- [ ] Queue many texts or files, plus watch folders that auto-process new files

### M12 — Projects
- [ ] Group renders, dubs and books into projects, with export history and reveal-in-Finder

### M13 — Tools
- [ ] Voice conversion, loudness normalize, noise clean, pronunciation dictionary

### M14 — Integrations & Developer
- [ ] **API keys:** create, name and revoke long-lived keys in Settings → Developer, so scripts can use the app-managed voxd
- [ ] **Developer page:** an interactive glass API reference generated from `/openapi.json`, with try-it requests and copy-as-curl/Python/JS
- [ ] OpenAI-compatible `/v1/audio/speech` + `/v1/audio/transcriptions` endpoints
- [ ] MCP server so AI agents can speak and transcribe
- [ ] Integration pages with copy-paste setup

### M15 — Settings
- [ ] Appearance (theme, accent, glass intensity), General, Models, Performance, Storage, Privacy, Shortcuts, Logs, About/credits

### M16 — Desktop polish & packaging
- [ ] Auto-updater, single instance, deep links (`voxstudio://`), native menus
- [ ] Bundle `uv` as a sidecar; signed `.dmg`, MSI and AppImage

---

## New features (unique to VoxStudio)
- [ ] **M17 Quick Speak:** a Spotlight-style glass panel on a global hotkey; type text and hear it instantly
- [ ] **M18 Speak Selection:** a hotkey reads the selected text in any app aloud
- [ ] **M19 Take Editor:** trim, fade, gain and splice on a waveform
- [ ] **M20 A/B Blind Compare:** rate two takes or engines to find your best engine per language
- [ ] **M21 Script Markup:** inline pause, emphasis, speed and pronunciation tags with live preview
- [ ] **M22 Drop Anywhere:** drop audio to clone, video to dub, a book to make an audiobook
- [ ] **M23 Shortcuts & Finder:** `voxstudio://speak?...` for the Shortcuts app, and a "Dub with VoxStudio" action in Finder
- [ ] **M24 Collections & Tags:** organize voices, takes and projects

---

## Documentation rule
Every milestone that adds or changes an endpoint also updates `docs/`:
- a reference page per resource (fields table, errors, curl example)
- a user guide for each new screen (numbered steps, tips, next steps)
- runnable examples, verified against a live voxd before ticking

## Verification per milestone
1. `npm run tauri dev`, then use the feature end to end in the app.
2. `npm run typecheck`, `npm test`, `cargo test` (in `src-tauri/`) and `uv run pytest` (in `voxd/`).
3. Run any new docs examples against a live voxd.
4. Tick the checklist.
