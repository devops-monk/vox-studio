"""Kokoro-82M via ONNX Runtime (CPU). Weights are downloaded through the model manager."""

from __future__ import annotations

import threading
import wave
from pathlib import Path
from collections.abc import Callable
from typing import TYPE_CHECKING

from .base import Engine, EngineError, Voice

if TYPE_CHECKING:
    from ..models import ModelStore

# Voice ids look like "af_heart": language letter, gender letter, name.
_LANG = {
    "a": ("en-US", "en-us"),
    "b": ("en-GB", "en-gb"),
    "e": ("es-ES", "es"),
    "f": ("fr-FR", "fr-fr"),
    "h": ("hi-IN", "hi"),
    "i": ("it-IT", "it"),
    "j": ("ja-JP", "ja"),
    "p": ("pt-BR", "pt-br"),
    "z": ("zh-CN", "cmn"),
}
_GENDER = {"f": "female", "m": "male"}


class KokoroEngine(Engine):
    id = "kokoro"
    name = "Kokoro"
    license = "Apache-2.0"

    def __init__(self, models: ModelStore, designed: Callable[[], list] | None = None):
        self._models = models
        self._designed = designed or (lambda: [])
        self._model = None
        self._lock = threading.Lock()

    @property
    def _spec(self):
        return self._models.for_engine(self.id)

    def probe(self) -> str | None:
        spec = self._spec
        if spec is None or not self._models.installed(spec):
            return "Download Kokoro from Models to use it"
        return None

    def unload(self) -> None:
        with self._lock:
            self._model = None

    def _load(self):
        with self._lock:
            if self._model is None:
                if self.probe():
                    raise EngineError(self.probe())
                from kokoro_onnx import Kokoro  # heavy import; only when needed

                spec = self._spec
                self._model = Kokoro(
                    str(self._models.path(spec, "kokoro-v1.0.onnx")), str(self._models.path(spec, "voices-v1.0.bin"))
                )
            return self._model

    def voices(self) -> list[Voice]:
        voices = []
        for vid in sorted(self._load().get_voices()):
            lang = _LANG.get(vid[0])
            if lang is None or "_" not in vid:
                continue
            voices.append(
                Voice(
                    id=vid,
                    name=vid.split("_", 1)[1].replace("_", " ").title(),
                    language=lang[0],
                    gender=_GENDER.get(vid[1]),
                )
            )
        designed = [Voice(id=d.id, name=d.name, language=d.language, gender=d.gender) for d in self._designed()]
        return designed + voices

    def _style(self, voice_id: str):
        """A voice id → (style vector or name, espeak language, speed multiplier).

        Supports plain voices (``af_heart``), blends (``mix:af_heart=0.6,bf_emma=0.4``)
        and saved designed voices (``dv_…``, which store a blend recipe).
        """
        from ..design import MIX_PREFIX, parse_recipe

        model = self._load()
        speed = 1.0
        if voice_id.startswith("dv_"):
            designed = next((d for d in self._designed() if d.id == voice_id), None)
            if designed is None:
                raise EngineError(f"Unknown voice: {voice_id}")
            voice_id, speed = designed.recipe, designed.speed
        if voice_id.startswith(MIX_PREFIX):
            parts = parse_recipe(voice_id)
            known = set(model.get_voices())
            if any(name not in known for name, _ in parts):
                raise EngineError(f"Unknown voice in blend: {voice_id}")
            total = sum(w for _, w in parts)
            style = sum(model.get_voice_style(name) * (w / total) for name, w in parts)
            return style, _LANG[parts[0][0][0]][1], speed
        if voice_id not in model.get_voices():
            raise EngineError(f"Unknown voice: {voice_id}")
        return voice_id, _LANG[voice_id[0]][1], speed

    def render(self, text: str, voice_id: str, speed: float):
        """(float samples, sample rate) without writing a file."""
        style, lang, voice_speed = self._style(voice_id)
        with self._lock:
            return self._model.create(text, voice=style, speed=speed * voice_speed, lang=lang)

    def synthesize(self, text: str, voice_id: str, speed: float, out: Path, emotion: float | None = None) -> None:
        import numpy as np

        samples, rate = self.render(text, voice_id, speed)
        pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
        with wave.open(str(out), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(pcm.tobytes())
