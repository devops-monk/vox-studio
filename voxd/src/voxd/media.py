"""The media worker (PyAV / CTranslate2) — runs in the Whisper runtime pack."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .engines.base import EngineError

if TYPE_CHECKING:
    from .runtimes import RuntimeManager

WORKER_SCRIPT = Path(__file__).resolve().parent / "workers" / "media_worker.py"


class Media:
    def __init__(self, runtimes: RuntimeManager):
        self._runtimes = runtimes
        self._worker = None

    def available(self) -> bool:
        from .runtimes import PACKS

        return self._runtimes.installed(PACKS["whisper"])

    def call(self, op: str, **params: Any) -> dict[str, Any]:
        from .runtimes import PACKS
        from .runtimes.worker import Worker

        if not self.available():
            raise EngineError("Dubbing needs the Whisper engine — download a Whisper model from Models")
        if self._worker is None:
            env = {"PYTHONUNBUFFERED": "1"}
            if sys.platform != "win32":
                env = {**{k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "TMPDIR", "LANG")}, **env}
            self._worker = Worker("media", [str(self._runtimes.python(PACKS["whisper"])), str(WORKER_SCRIPT)], env=env, idle_timeout=300)
        return self._worker.call(op, **params)

    def stop(self) -> None:
        if self._worker:
            self._worker.stop()
