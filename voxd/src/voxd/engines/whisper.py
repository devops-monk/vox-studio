"""Whisper speech recognition (faster-whisper) in its own runtime pack, run as a worker."""

from __future__ import annotations

import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .base import Engine, EngineError, Voice

if TYPE_CHECKING:
    from ..models import ModelSpec, ModelStore
    from ..runtimes import RuntimeManager

WORKER_SCRIPT = Path(__file__).resolve().parent.parent / "workers" / "whisper_worker.py"


class WhisperEngine(Engine):
    id = "whisper"
    name = "Whisper"
    license = "MIT"
    capabilities = ["asr"]

    def __init__(self, models: ModelStore, runtimes: RuntimeManager, preferred: Callable[[], str | None] = lambda: None):
        self._models, self._runtimes, self._preferred = models, runtimes, preferred
        self._worker = None
        self._worker_model: str | None = None

    def installed(self) -> list[ModelSpec]:
        from ..runtimes import PACKS

        if not self._runtimes.installed(PACKS["whisper"]):
            return []
        return [m for m in self._models.all_for_engine(self.id) if self._models.installed(m)]

    def probe(self) -> str | None:
        return None if self.installed() else "Download a Whisper model from Models to transcribe"

    def voices(self) -> list[Voice]:
        return []

    def synthesize(self, text, voice_id, speed, out, emotion=None) -> None:  # noqa: ANN001
        raise EngineError("Whisper transcribes speech; it doesn't generate it")

    def pick(self, model_id: str | None = None, fast: bool = False) -> ModelSpec:
        """Requested model if installed; else the user's preferred one; else the most capable
        installed (or the quickest, for live dictation)."""
        installed = self.installed()
        if not installed:
            raise EngineError(self.probe() or "Whisper is not installed")
        by_id = {m.id: m for m in installed}
        if model_id:
            if model_id not in by_id:
                raise EngineError(f"{model_id} is not installed")
            return by_id[model_id]
        if not fast and (pref := self._preferred()) in by_id:
            return by_id[pref]
        return installed[0] if fast else installed[-1]

    def unload(self) -> None:
        if self._worker:
            self._worker.stop()
            self._worker = None

    def transcribe(
        self,
        *,
        path: str | None = None,
        pcm_path: str | None = None,
        language: str | None = None,
        model_id: str | None = None,
        fast: bool = False,
        prompt: str | None = None,
        on_progress: Callable[[float], None] | None = None,
    ) -> dict[str, Any]:
        from ..runtimes import PACKS
        from ..runtimes.worker import Worker

        spec = self.pick(model_id, fast)
        if self._worker is None or self._worker_model != spec.id:
            self.unload()
            python = self._runtimes.python(PACKS["whisper"])
            argv = [str(python), str(WORKER_SCRIPT), "--model-dir", str(self._models.dir(spec)), "--device", "auto"]
            env = {"PYTHONUNBUFFERED": "1", "HF_HUB_OFFLINE": "1"}
            if sys.platform != "win32":
                env = {**{k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "TMPDIR", "LANG")}, **env}
            self._worker = Worker("whisper", argv, env=env)
            self._worker_model = spec.id
        reply = self._worker.call(
            "transcribe",
            on_progress=on_progress,
            path=path,
            pcm_path=pcm_path,
            language=language,
            beam_size=1 if fast else 5,
            context=not fast,
            prompt=prompt,
            progress=bool(on_progress),
        )
        return {"segments": reply["segments"], "language": reply["language"], "duration": reply["duration"], "model": spec.id}
