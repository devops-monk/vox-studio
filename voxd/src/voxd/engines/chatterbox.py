"""Chatterbox (Resemble AI, MIT): zero-shot voice cloning with an emotion control.

Runs in its own runtime pack (PyTorch) as a worker process; see ``runtimes``.
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING

from .base import Engine, EngineError, Voice

if TYPE_CHECKING:
    from ..models import ModelStore
    from ..runtimes import RuntimeManager
    from ..voices import CustomVoices

WORKER_SCRIPT = Path(__file__).resolve().parent.parent / "workers" / "chatterbox_worker.py"
DEFAULT_VOICE = "default"


def emotion_to_params(emotion: float | None) -> tuple[float, float]:
    """Map our 0–1 emotion scale (0.5 = natural) to Chatterbox's (exaggeration, cfg_weight).

    Chatterbox's guidance: raise exaggeration for drama and lower cfg_weight alongside it,
    which keeps pacing natural when the delivery gets intense.
    """
    e = 0.5 if emotion is None else max(0.0, min(1.0, emotion))
    exaggeration = 0.25 + e * 0.5 if e <= 0.5 else 0.5 + (e - 0.5) * 2.0
    cfg_weight = 0.5 - max(0.0, e - 0.5) * 0.4
    return round(exaggeration, 3), round(cfg_weight, 3)


class ChatterboxEngine(Engine):
    id = "chatterbox"
    name = "Chatterbox"
    license = "MIT"
    capabilities = ["tts", "clone", "emotion"]

    def __init__(self, models: ModelStore, runtimes: RuntimeManager, custom: CustomVoices, device: Callable[[], str]):
        self._models, self._runtimes, self._custom, self._device = models, runtimes, custom, device
        self._worker = None
        self._worker_device: str | None = None

    @property
    def _spec(self):
        return self._models.for_engine(self.id)

    def probe(self) -> str | None:
        from ..runtimes import PACKS

        spec = self._spec
        if spec is None or not self._models.installed(spec) or not self._runtimes.installed(PACKS["chatterbox"]):
            return "Download Chatterbox from Models to clone voices"
        return None

    def voices(self) -> list[Voice]:
        custom = [Voice(id=v.id, name=v.name, language=v.language) for v in self._custom.store.list_custom_voices()]
        return [*custom, Voice(id=DEFAULT_VOICE, name="Chatterbox Default", language="en-US", gender="female")]

    @property
    def device_in_use(self) -> str | None:
        return self._worker.info.get("device") if self._worker and self._worker.running else None

    def unload(self) -> None:
        if self._worker:
            self._worker.stop()

    def _get_worker(self):
        from ..runtimes import PACKS
        from ..runtimes.worker import Worker

        if reason := self.probe():
            raise EngineError(reason)
        wanted = self._device()
        if self._worker is None or self._worker_device != wanted:
            if self._worker:
                self._worker.stop()
            python = self._runtimes.python(PACKS["chatterbox"])
            argv = [str(python), str(WORKER_SCRIPT), "--model-dir", str(self._models.dir(self._spec)), "--device", wanted]
            env = {"PYTORCH_ENABLE_MPS_FALLBACK": "1", "PYTHONUNBUFFERED": "1", "HF_HUB_OFFLINE": "1"}
            if sys.platform != "win32":
                import os

                env = {**{k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "TMPDIR", "LANG")}, **env}
            self._worker = Worker("chatterbox", argv, env=env)
            self._worker_device = wanted
        return self._worker

    def synthesize(self, text: str, voice_id: str, speed: float, out: Path, emotion: float | None = None) -> None:
        ref = None
        if voice_id != DEFAULT_VOICE:
            if self._custom.store.get_custom_voice(voice_id) is None:
                raise EngineError(f"Unknown voice: {voice_id}")
            ref = str(self._custom.path(voice_id))
        exaggeration, cfg_weight = emotion_to_params(emotion)
        self._get_worker().call(
            "synthesize", text=text, out=str(out), ref=ref, exaggeration=exaggeration, cfg_weight=cfg_weight, speed=speed
        )

    def convert(self, src: Path, voice_id: str, out: Path, on_progress=None) -> None:
        """Re-voice a recording (speech-to-speech) in a custom voice or the default voice."""
        ref = None
        if voice_id != DEFAULT_VOICE:
            if self._custom.store.get_custom_voice(voice_id) is None:
                raise EngineError(f"Unknown voice: {voice_id}")
            ref = str(self._custom.path(voice_id))
        self._get_worker().call("convert", on_progress=on_progress, src=str(src), ref=ref, out=str(out))
