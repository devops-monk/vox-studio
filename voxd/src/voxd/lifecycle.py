"""Boot phase tracking and the shell lifeline."""

from __future__ import annotations

import os
import sys
import threading
import time
from enum import StrEnum


class Phase(StrEnum):
    BOOTING = "booting"
    LOADING_ENGINES = "loading_engines"
    READY = "ready"
    ERROR = "error"


class Lifecycle:
    def __init__(self) -> None:
        self.phase = Phase.BOOTING
        self.detail: str | None = None
        self.started = time.monotonic()

    def set(self, phase: Phase, detail: str | None = None) -> None:
        self.phase, self.detail = phase, detail

    def snapshot(self) -> dict:
        return {
            "phase": self.phase.value,
            "detail": self.detail,
            "uptime_s": round(time.monotonic() - self.started, 2),
        }


_exit_hooks: list = []


def on_hard_exit(fn) -> None:
    """Run ``fn`` (best effort) when the lifeline ends the process without a normal shutdown."""
    _exit_hooks.append(fn)


def watch_lifeline() -> None:
    """Exit as soon as the parent closes our stdin, so a crashed shell never leaves voxd behind."""

    def wait() -> None:
        try:
            while sys.stdin.buffer.read(4096):
                pass
        finally:
            for fn in _exit_hooks:
                try:
                    fn()
                except Exception:
                    pass
            os._exit(0)

    threading.Thread(target=wait, name="lifeline", daemon=True).start()
