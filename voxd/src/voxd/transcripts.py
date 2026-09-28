"""Transcription jobs, subtitle formats and the live (streaming) session."""

from __future__ import annotations

import asyncio
import json
import tempfile
import time
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from .store import Transcript

if TYPE_CHECKING:
    from .app import Services
    from .engines.whisper import WhisperEngine
    from .jobs import JobContext

LIVE_RATE = 16000

# ------------------------------------------------------------------ formats


def _stamp(seconds: float, sep: str) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def to_srt(segments: list[dict]) -> str:
    return "\n".join(f"{i}\n{_stamp(s['start'], ',')} --> {_stamp(s['end'], ',')}\n{s['text']}\n" for i, s in enumerate(segments, 1))


def to_vtt(segments: list[dict]) -> str:
    body = "\n".join(f"{_stamp(s['start'], '.')} --> {_stamp(s['end'], '.')}\n{s['text']}\n" for s in segments)
    return "WEBVTT\n\n" + body


def to_text(segments: list[dict]) -> str:
    return " ".join(s["text"] for s in segments).strip()


EXPORTS = {
    "txt": ("text/plain", lambda t: to_text(t.segments) + "\n"),
    "srt": ("application/x-subrip", lambda t: to_srt(t.segments)),
    "vtt": ("text/vtt", lambda t: to_vtt(t.segments)),
    "json": ("application/json", lambda t: json.dumps({"title": t.title, "language": t.language, "segments": t.segments}, indent=2)),
}

# ------------------------------------------------------------------ file jobs


def uploads_dir(services: Services) -> Path:
    d = services.settings.data_dir / "uploads"
    d.mkdir(exist_ok=True)
    return d


def transcribe_file(services: Services, ctx: JobContext, spec: dict[str, Any]) -> dict[str, Any]:
    engine: WhisperEngine = services.registry.get("whisper")  # type: ignore[assignment]
    path = uploads_dir(services) / spec["audio"]
    ctx.progress(0.02, "Loading Whisper")

    def progress(fraction: float) -> None:
        ctx.check()
        ctx.progress(0.05 + fraction * 0.93, f"Transcribing… {int(fraction * 100)}%")

    result = engine.transcribe(path=str(path), language=spec.get("language"), model_id=spec.get("model"), on_progress=progress)
    transcript = Transcript(
        id=spec["transcript_id"],
        title=spec["title"],
        source="file",
        language=result["language"],
        duration_s=result["duration"],
        model=result["model"],
        text=to_text(result["segments"]),
        segments=result["segments"],
        audio=spec["audio"],
        created_at=time.time(),
    )
    services.store.add_transcript(transcript)
    services.bus.publish("transcripts.changed", {"id": transcript.id})
    return {"transcript_id": transcript.id, "language": transcript.language, "duration_s": transcript.duration_s}


# ------------------------------------------------------------------ live sessions


class LiveSession:
    """Accumulates streamed PCM16 audio, re-transcribes the current utterance for partial
    results, and finalizes an utterance after a pause (or when it gets long)."""

    PARTIAL_EVERY_S = 1.0
    PAUSE_S = 0.7
    MAX_UTTERANCE_S = 25.0
    SILENCE_RMS = 0.012

    def __init__(self, engine: WhisperEngine, language: str | None, model: str | None):
        self.engine, self.language, self.model = engine, language, model
        self.utterance = np.zeros(0, dtype=np.float32)
        self.offset_s = 0.0  # start time of the current utterance
        self.since_partial = 0
        self.segments: list[dict] = []
        self.busy = False
        self.detected_language: str | None = None
        self.model_used: str | None = None

    def add(self, pcm16: bytes) -> None:
        chunk = np.frombuffer(pcm16, dtype="<i2").astype(np.float32) / 32768.0
        self.utterance = np.concatenate([self.utterance, chunk])
        self.since_partial += len(chunk)

    @property
    def seconds(self) -> float:
        return len(self.utterance) / LIVE_RATE

    def _has_speech(self) -> bool:
        return self.seconds > 0.3 and float(np.sqrt(np.mean(self.utterance**2))) > self.SILENCE_RMS * 0.6

    def paused(self) -> bool:
        tail = self.utterance[-int(self.PAUSE_S * LIVE_RATE) :]
        return self.seconds > self.PAUSE_S + 0.5 and float(np.sqrt(np.mean(tail**2))) < self.SILENCE_RMS

    def _run(self) -> str:
        with tempfile.NamedTemporaryFile(suffix=".f32", delete=False) as f:
            self.utterance.astype(np.float32).tofile(f)
            path = f.name
        try:
            result = self.engine.transcribe(pcm_path=path, language=self.language, model_id=self.model, fast=True)
        finally:
            Path(path).unlink(missing_ok=True)
        self.detected_language = self.detected_language or result["language"]
        self.model_used = result["model"]
        return " ".join(s["text"] for s in result["segments"]).strip()

    async def partial(self) -> str | None:
        if self.busy or self.since_partial < self.PARTIAL_EVERY_S * LIVE_RATE or not self._has_speech():
            return None
        self.busy, self.since_partial = True, 0
        try:
            return await asyncio.to_thread(self._run)
        finally:
            self.busy = False

    async def finalize(self) -> dict | None:
        """Close the current utterance; returns the new segment, if anything was said."""
        segment = None
        if self._has_speech():
            while self.busy:
                await asyncio.sleep(0.05)
            self.busy = True
            try:
                text = await asyncio.to_thread(self._run)
            finally:
                self.busy = False
            if text:
                segment = {"start": round(self.offset_s, 2), "end": round(self.offset_s + self.seconds, 2), "text": text}
                self.segments.append(segment)
        self.offset_s += self.seconds
        self.utterance = np.zeros(0, dtype=np.float32)
        self.since_partial = 0
        return segment

    def should_finalize(self) -> bool:
        return (self.paused() and self._has_speech()) or self.seconds >= self.MAX_UTTERANCE_S


def save_live(services: Services, session: LiveSession, title: str | None) -> Transcript | None:
    if not session.segments:
        return None
    t = Transcript(
        id=uuid.uuid4().hex,
        title=title or time.strftime("Live transcription %b %d, %H:%M"),
        source="live",
        language=session.detected_language or "unknown",
        duration_s=round(session.offset_s, 2),
        model=session.model_used or "",
        text=to_text(session.segments),
        segments=session.segments,
        audio="",
        created_at=time.time(),
    )
    services.store.add_transcript(t)
    services.bus.publish("transcripts.changed", {"id": t.id})
    return t
