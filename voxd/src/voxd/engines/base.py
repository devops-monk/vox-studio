"""The contract every voxd engine implements.

An engine wraps one model (or OS facility). The API layer only ever talks to this
interface, so adding a model means adding one module under ``voxd/engines``.
"""

from __future__ import annotations

import wave
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


class EngineError(RuntimeError):
    """A user-facing failure (bad voice, engine missing). Maps to HTTP 4xx."""


@dataclass(frozen=True)
class Voice:
    id: str
    name: str
    language: str
    sample: str | None = None
    gender: str | None = None


@dataclass
class EngineInfo:
    id: str
    name: str
    capabilities: list[str]
    license: str
    available: bool = False
    unavailable_reason: str | None = None
    languages: list[str] = field(default_factory=list)


class Engine(ABC):
    id: str
    name: str
    license: str
    capabilities: list[str] = ["tts"]

    @abstractmethod
    def probe(self) -> str | None:
        """Return None when usable here, else a short reason it is not."""

    @abstractmethod
    def voices(self) -> list[Voice]: ...

    def unload(self) -> None:
        """Free any loaded model (e.g. before its files are deleted)."""

    @abstractmethod
    def synthesize(self, text: str, voice_id: str, speed: float, out: Path, emotion: float | None = None) -> None:
        """Render ``text`` to a WAV file at ``out``. ``emotion`` (0–1, 0.5 = natural) is used by engines with the
        ``emotion`` capability and ignored by the rest."""


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate())
