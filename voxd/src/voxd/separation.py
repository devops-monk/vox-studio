"""Background separation (Demucs) for dubbing: the soundtrack minus the voice."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from .engines.base import EngineError
from .models import DEMUCS_MODEL

if TYPE_CHECKING:
    from .models import ModelStore
    from .runtimes import RuntimeManager

WORKER_SCRIPT = Path(__file__).resolve().parent / "workers" / "separation_worker.py"
SAMPLE_RATE = 44100


class Separator:
    def __init__(self, runtimes: RuntimeManager, models: ModelStore):
        self._runtimes, self._models = runtimes, models
        self._worker = None

    def unavailable_reason(self) -> str | None:
        from .runtimes import PACKS

        if not (self._models.installed(DEMUCS_MODEL) and self._runtimes.installed(PACKS["separation"])):
            return "Keeping the background needs Demucs — download it from Models"
        return None

    def separate(self, path: Path, out: Path, on_progress: Callable[[float], None] | None = None) -> None:
        from .runtimes import PACKS
        from .runtimes.worker import Worker

        if reason := self.unavailable_reason():
            raise EngineError(reason)
        if self._worker is None:
            env = {"PYTORCH_ENABLE_MPS_FALLBACK": "1", "PYTHONUNBUFFERED": "1"}
            if sys.platform != "win32":
                env = {**{k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "TMPDIR", "LANG")}, **env}
            model = self._models.dir(DEMUCS_MODEL) / "htdemucs.th"
            argv = [str(self._runtimes.python(PACKS["separation"])), str(WORKER_SCRIPT), "--model", str(model)]
            self._worker = Worker("separation", argv, env=env, idle_timeout=300)
        self._worker.call("separate", on_progress=on_progress, path=str(path), out=str(out))

    def stop(self) -> None:
        if self._worker:
            self._worker.stop()
            self._worker = None
