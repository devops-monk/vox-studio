"""A long-lived engine process speaking JSON lines over stdin/stdout.

Protocol: the worker prints `{"ready": true, ...}` once its model is loaded, then answers
each request line `{"id": n, "op": ..., ...}` with `{"id": n, "ok": true|false, ...}`.
Anything on its stderr is logged. Idle workers are stopped to give memory back.
"""

from __future__ import annotations

import json
import logging
import subprocess
import threading
import time
from typing import Any

from ..engines.base import EngineError

log = logging.getLogger("voxd.worker")


class Worker:
    def __init__(self, name: str, argv: list[str], env: dict[str, str] | None = None, idle_timeout: float = 600):
        self.name, self.argv, self.env, self.idle_timeout = name, argv, env, idle_timeout
        self.info: dict[str, Any] = {}
        self._proc: subprocess.Popen[str] | None = None
        self._lock = threading.Lock()
        self._seq = 0
        self._last_used = time.monotonic()
        threading.Thread(target=self._reaper, name=f"{name}-reaper", daemon=True).start()

    @property
    def running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def call(self, op: str, **params: Any) -> dict[str, Any]:
        with self._lock:
            self._ensure_started()
            assert self._proc and self._proc.stdin and self._proc.stdout
            self._seq += 1
            try:
                self._proc.stdin.write(json.dumps({"id": self._seq, "op": op, **params}) + "\n")
                self._proc.stdin.flush()
                reply = self._read_line()
            finally:
                self._last_used = time.monotonic()
            if not reply.get("ok"):
                raise EngineError(reply.get("error") or f"{self.name} failed")
            return reply

    def stop(self) -> None:
        with self._lock:
            self._terminate()

    def _ensure_started(self) -> None:
        if self.running:
            return
        log.info("starting %s worker", self.name)
        self._proc = subprocess.Popen(
            self.argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=self.env, bufsize=1
        )
        threading.Thread(target=self._pump_stderr, args=(self._proc,), daemon=True).start()
        hello = self._read_line()
        if not hello.get("ready"):
            self._terminate()
            raise EngineError(hello.get("error") or f"{self.name} failed to start")
        self.info = {k: v for k, v in hello.items() if k != "ready"}
        log.info("%s worker ready: %s", self.name, self.info)

    def _read_line(self) -> dict[str, Any]:
        assert self._proc and self._proc.stdout
        line = self._proc.stdout.readline()
        if not line:
            code = self._proc.wait()
            self._proc = None
            raise EngineError(f"{self.name} stopped unexpectedly (exit {code}). Check the logs for details.")
        return json.loads(line)

    def _pump_stderr(self, proc: subprocess.Popen[str]) -> None:
        assert proc.stderr
        for line in proc.stderr:
            log.info("[%s] %s", self.name, line.rstrip())

    def _terminate(self) -> None:
        if self._proc is None:
            return
        try:
            if self._proc.stdin:
                self._proc.stdin.close()  # workers exit on EOF
            self._proc.wait(timeout=5)
        except Exception:
            self._proc.kill()
        self._proc = None

    def _reaper(self) -> None:
        while True:
            time.sleep(15)
            if self.running and time.monotonic() - self._last_used > self.idle_timeout and self._lock.acquire(blocking=False):
                try:
                    log.info("stopping idle %s worker", self.name)
                    self._terminate()
                finally:
                    self._lock.release()
