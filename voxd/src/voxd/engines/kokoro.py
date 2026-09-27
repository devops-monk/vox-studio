"""Kokoro-82M via ONNX Runtime (CPU). Weights are downloaded through the model manager."""

from __future__ import annotations

import threading
import wave
from pathlib import Path
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

    def __init__(self, models: ModelStore):
        self._models = models
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
        return voices

    def synthesize(self, text: str, voice_id: str, speed: float, out: Path, emotion: float | None = None) -> None:
        model = self._load()
        if voice_id not in model.get_voices():
            raise EngineError(f"Unknown voice: {voice_id}")
        import numpy as np

        with self._lock:
            samples, rate = model.create(text, voice=voice_id, speed=speed, lang=_LANG[voice_id[0]][1])
        pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
        with wave.open(str(out), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(pcm.tobytes())
