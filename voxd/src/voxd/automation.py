"""Building blocks for the synchronous surfaces (OpenAI-compatible API, MCP): pick a voice, run a
job and wait for it, stage local files, encode audio.

Everything still runs as a regular job, so it shows up in Activity and History like work started
in the app.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .engines.base import Engine, EngineError
from .transcripts import uploads_dir

if TYPE_CHECKING:
    from .app import Services
    from .store import Take, Transcript

# OpenAI voice names → the closest-sounding Kokoro voice.
OPENAI_VOICES = {
    "alloy": "af_alloy",
    "ash": "am_adam",
    "ballad": "bm_george",
    "coral": "af_heart",
    "echo": "am_echo",
    "fable": "bm_fable",
    "nova": "af_nova",
    "onyx": "am_onyx",
    "sage": "af_sarah",
    "shimmer": "af_sky",
    "verse": "am_michael",
}
AUDIO_TYPES = {
    "mp3": "audio/mpeg",
    "opus": "audio/ogg",
    "aac": "audio/aac",
    "flac": "audio/flac",
    "wav": "audio/wav",
    "pcm": "audio/L16",
}


def _engine_or_none(services: Services, engine_id: str) -> Engine | None:
    try:
        return services.registry.get(engine_id)
    except EngineError:
        return None


def pick_voice(services: Services, voice: str | None, engine_id: str | None = None) -> tuple[Engine, str]:
    """Resolve ``voice`` (an OpenAI name, or any voxd voice id) to an available engine and voice."""
    if engine_id:
        engine = services.registry.get(engine_id)
        if not voice:
            return engine, engine.voices()[0].id
        if voice in OPENAI_VOICES and engine.id == "kokoro":
            return engine, OPENAI_VOICES[voice]
        return engine, voice
    if not voice or voice in OPENAI_VOICES:
        if kokoro := _engine_or_none(services, "kokoro"):
            return kokoro, OPENAI_VOICES.get(voice or "", "af_heart")
        engine = services.registry.default_tts()
        if engine is None:
            raise EngineError("No text-to-speech engine is available")
        return engine, engine.voices()[0].id
    prefixed = {"cv_": "chatterbox", "dv_": "kokoro", "mix:": "kokoro"}
    for prefix, owner in prefixed.items():
        if voice.startswith(prefix):
            return services.registry.get(owner), voice
    for info in services.registry.info():
        if info.available and "tts" in info.capabilities:
            engine = services.registry.get(info.id)
            if any(v.id == voice for v in engine.voices()):
                return engine, voice
    raise EngineError(f"Unknown voice: {voice}")


async def run_job(services: Services, kind: str, title: str, spec: dict[str, Any], timeout: float = 3600.0) -> dict[str, Any]:
    job = await services.jobs.wait(services.jobs.submit(kind, title, spec).id, timeout)
    if job.status != "succeeded":
        raise EngineError(job.error or f"The job was {job.status}")
    return job.result or {}


async def speak(services: Services, text: str, voice: str | None, engine_id: str | None = None, speed: float = 1.0) -> Take:
    engine, voice_id = pick_voice(services, voice, engine_id)
    title = text[:60].strip() + ("…" if len(text) > 60 else "")
    result = await run_job(services, "speech", title, {"text": text, "voice": voice_id, "engine": engine.id, "speed": speed})
    take = services.store.get_take(result["take_id"])
    assert take is not None
    return take


def stage_file(services: Services, path: str | Path) -> str:
    """Copy a local file into uploads/ (jobs delete their inputs when done)."""
    source = Path(path).expanduser()
    if not source.is_file():
        raise EngineError(f"No such file: {source}")
    name = f"{uuid.uuid4().hex}{source.suffix.lower()[:8] or '.bin'}"
    shutil.copyfile(source, uploads_dir(services) / name)
    return name


async def transcribe(services: Services, upload: str, title: str, language: str | None = None, model: str | None = None) -> Transcript:
    services.registry.get("whisper").pick(model)  # type: ignore[attr-defined]  # fail fast with a clear reason
    spec = {"audio": upload, "language": language, "model": model, "title": title[:120] or "Recording", "transcript_id": uuid.uuid4().hex}
    result = await run_job(services, "transcribe", f"Transcribing {title}", spec)
    transcript = services.store.get_transcript(result["transcript_id"])
    assert transcript is not None
    return transcript


def encode(services: Services, wav: Path, fmt: str, out: Path) -> None:
    """Write ``wav`` as ``fmt`` (mp3, opus, aac, flac, wav, pcm) to ``out``."""
    if fmt == "wav":
        shutil.copyfile(wav, out)
    elif fmt == "pcm":
        import wave

        import numpy as np

        with wave.open(str(wav), "rb") as w:
            rate, channels = w.getframerate(), w.getnchannels()
            pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
        if channels > 1:
            pcm = pcm.reshape(-1, channels).mean(axis=1)
        if rate != 24000 and len(pcm):  # OpenAI's raw PCM is always 24 kHz mono
            n = int(len(pcm) * 24000 / rate)
            pcm = np.interp(np.linspace(0, len(pcm) - 1, n), np.arange(len(pcm)), pcm)
        out.write_bytes(np.asarray(pcm).astype("<i2").tobytes())
    else:
        if not services.media.available():
            raise EngineError(f"{fmt} output needs the Whisper runtime (download a Whisper model), or ask for wav")
        services.media.call("encode", path=str(wav), out=str(out), format=fmt)
