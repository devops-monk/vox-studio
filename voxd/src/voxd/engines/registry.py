from __future__ import annotations

import logging

from .base import Engine, EngineError, EngineInfo

log = logging.getLogger("voxd.engines")


class Registry:
    def __init__(self, engines: list[Engine]):
        self._engines = {e.id: e for e in engines}
        self._status: dict[str, str | None] = {}

    def probe_all(self) -> None:
        for engine_id in self._engines:
            self.refresh(engine_id)

    def refresh(self, engine_id: str) -> None:
        engine = self._engines.get(engine_id)
        if engine is None:
            return
        try:
            self._status[engine_id] = engine.probe()
        except Exception as exc:  # a broken engine must not take down the daemon
            log.exception("probe failed for %s", engine_id)
            self._status[engine_id] = f"Probe failed: {exc}"

    def raw(self, engine_id: str) -> Engine | None:
        """The engine regardless of availability (for unload/refresh)."""
        return self._engines.get(engine_id)

    def info(self) -> list[EngineInfo]:
        return [
            EngineInfo(
                id=e.id,
                name=e.name,
                capabilities=list(e.capabilities),
                license=e.license,
                available=self._status.get(e.id) is None,
                unavailable_reason=self._status.get(e.id),
            )
            for e in self._engines.values()
        ]

    def get(self, engine_id: str) -> Engine:
        engine = self._engines.get(engine_id)
        if engine is None:
            raise EngineError(f"Unknown engine: {engine_id}")
        if reason := self._status.get(engine_id):
            raise EngineError(reason)
        return engine

    def default_tts(self) -> Engine | None:
        """The best available TTS engine: the last registered one that is usable (neural engines register after system)."""
        usable = [e for e in self._engines.values() if "tts" in e.capabilities and self._status.get(e.id) is None]
        return usable[-1] if usable else None
