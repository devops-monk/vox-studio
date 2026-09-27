"""Speech rendering shared by the instant endpoint and the long-form job."""

from __future__ import annotations

import re
import uuid
import wave
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .engines.base import Engine, EngineError, wav_duration

if TYPE_CHECKING:
    from .app import Services
    from .jobs import JobContext

_SENTENCE_END = re.compile(r"(?<=[.!?。！？;:])\s+|\n+")
CHUNK_CHARS = 400


def split_text(text: str, limit: int = CHUNK_CHARS) -> list[str]:
    """Split on sentence boundaries into chunks of at most ``limit`` characters where possible."""
    chunks: list[str] = []
    current = ""
    for sentence in filter(None, (s.strip() for s in _SENTENCE_END.split(text))):
        while len(sentence) > limit:  # a single run-on sentence: break at the last space
            cut = sentence.rfind(" ", 0, limit)
            cut = cut if cut > limit // 2 else limit
            chunks.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip()
        if current and len(current) + 1 + len(sentence) > limit:
            chunks.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        chunks.append(current)
    return chunks


def join_wavs(parts: list[Path], out: Path) -> None:
    with wave.open(str(parts[0]), "rb") as first:
        params = first.getparams()
    with wave.open(str(out), "wb") as dst:
        dst.setparams(params)
        for part in parts:
            with wave.open(str(part), "rb") as src:
                if (src.getnchannels(), src.getsampwidth(), src.getframerate()) != params[:3]:
                    raise EngineError("Engine produced chunks in different audio formats")
                dst.writeframes(src.readframes(src.getnframes()))


def resolve_engine(services: Services, engine_id: str | None) -> Engine:
    engine = services.registry.get(engine_id) if engine_id else services.registry.default_tts()
    if engine is None:
        raise EngineError("No text-to-speech engine is available")
    return engine


def save_take(services: Services, *, take_id: str, engine: Engine, voice: str, text: str, path: Path):
    take = services.store.add_take(
        take_id=take_id, engine=engine.id, voice=voice, text=text, duration_s=wav_duration(path)
    )
    services.bus.publish("take.created", take.public())
    return take


def render_long(services: Services, ctx: JobContext, spec: dict[str, Any]) -> dict[str, Any]:
    """Job handler for ``speech``: render chunk by chunk, then stitch into one take."""
    engine = resolve_engine(services, spec.get("engine"))
    chunks = split_text(spec["text"])
    take_id = uuid.uuid4().hex
    scratch = services.settings.takes_dir / f".{take_id}"
    scratch.mkdir()
    try:
        parts = []
        for i, chunk in enumerate(chunks):
            ctx.check()
            ctx.progress(i / len(chunks), f"Speaking part {i + 1} of {len(chunks)}")
            part = scratch / f"{i:05d}.wav"
            engine.synthesize(chunk, spec["voice"], spec.get("speed", 1.0), part, spec.get("emotion"))
            parts.append(part)
        ctx.check()
        ctx.progress(0.99, "Finishing")
        out = services.settings.takes_dir / f"{take_id}.wav"
        join_wavs(parts, out)
        take = save_take(services, take_id=take_id, engine=engine, voice=spec["voice"], text=spec["text"], path=out)
        return {"take_id": take.id, "audio_url": f"/v1/takes/{take.id}/audio", "duration_s": take.duration_s}
    finally:
        for f in scratch.glob("*.wav"):
            f.unlink()
        scratch.rmdir()
