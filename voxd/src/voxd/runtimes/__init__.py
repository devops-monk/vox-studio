"""Runtime packs: isolated Python environments for engines whose dependencies can't share
voxd's own environment (e.g. a specific PyTorch). Each pack is installed on demand with `uv`
and its engine runs in a separate worker process (see ``runtimes.worker``)."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from ..engines.base import EngineError

if TYPE_CHECKING:
    from ..jobs import JobContext

log = logging.getLogger("voxd.runtimes")
MARKER = "voxd-runtime.json"


@dataclass(frozen=True)
class RuntimePack:
    id: str
    name: str
    python: str
    requirements: tuple[str, ...]
    excludes: tuple[str, ...]
    check_import: str
    approx_bytes: int

    @property
    def fingerprint(self) -> str:
        blob = json.dumps([self.python, self.requirements, self.excludes])
        return hashlib.sha256(blob.encode()).hexdigest()[:16]


PACKS: dict[str, RuntimePack] = {
    "chatterbox": RuntimePack(
        id="chatterbox",
        name="Chatterbox runtime (PyTorch)",
        python="3.11",
        # The watermarker (resemble-perth) imports pkg_resources, which fresh venvs don't include.
        requirements=("chatterbox-tts==0.1.7", "setuptools<81"),
        # Only the core English model is used; skip the demo UI and multilingual text tools.
        excludes=("gradio", "spacy-pkuseg", "pykakasi"),
        check_import="chatterbox.tts",
        approx_bytes=1_300_000_000,
    ),
    "whisper": RuntimePack(
        id="whisper",
        name="Whisper runtime (CTranslate2)",
        python="3.11",
        # PyAV (via faster-whisper) also powers media extraction and muxing for dubbing;
        # SentencePiece + CTranslate2 run the translation packages.
        requirements=("faster-whisper==1.2.1", "sentencepiece>=0.2"),
        excludes=(),
        check_import="faster_whisper, sentencepiece",
        approx_bytes=260_000_000,
    ),
}


class RuntimeManager:
    def __init__(self, root: Path, uv: str | None = None):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._uv = uv

    @property
    def uv(self) -> str:
        found = self._uv or os.environ.get("VOXD_UV") or shutil.which("uv")
        if not found:
            raise EngineError("Installing engines needs `uv`, which wasn't found")
        return found

    def dir(self, pack: RuntimePack) -> Path:
        return self.root / pack.id

    def python(self, pack: RuntimePack) -> Path:
        d = self.dir(pack)
        return d / "Scripts" / "python.exe" if sys.platform == "win32" else d / "bin" / "python"

    def installed(self, pack: RuntimePack) -> bool:
        try:
            marker = json.loads((self.dir(pack) / MARKER).read_text())
        except (OSError, ValueError):
            return False
        return marker.get("fingerprint") == pack.fingerprint and self.python(pack).exists()

    def remove(self, pack: RuntimePack) -> None:
        shutil.rmtree(self.dir(pack), ignore_errors=True)

    def install(self, ctx: JobContext, pack: RuntimePack, span: tuple[float, float] = (0.0, 1.0)) -> None:
        """Create the venv and install the pack. Reports progress within ``span`` of the job."""
        lo, hi = span
        target = self.dir(pack)
        (target / MARKER).unlink(missing_ok=True)

        ctx.progress(lo, f"Preparing {pack.name}")
        self._run(ctx, [self.uv, "venv", str(target), "--python", pack.python, "--clear", "--quiet"], lo, lo)

        with tempfile.TemporaryDirectory() as tmp:
            req, exc = Path(tmp, "requirements.txt"), Path(tmp, "excludes.txt")
            req.write_text("\n".join(pack.requirements))
            exc.write_text("\n".join(pack.excludes))
            self._run(
                ctx,
                [self.uv, "pip", "install", "--python", str(self.python(pack)), "-r", str(req), "--excludes", str(exc)],
                lo + (hi - lo) * 0.05,
                lo + (hi - lo) * 0.9,
                label="Installing engine components",
            )

        ctx.progress(lo + (hi - lo) * 0.92, "Checking the engine")
        check = subprocess.run(
            [str(self.python(pack)), "-c", f"import {pack.check_import}"], capture_output=True, text=True, timeout=600
        )
        if check.returncode != 0:
            log.error("runtime check failed: %s", check.stderr[-2000:])
            raise EngineError(f"{pack.name} installed but failed to start: {check.stderr.strip().splitlines()[-1:]}")
        (target / MARKER).write_text(json.dumps({"fingerprint": pack.fingerprint, "installed_at": time.time()}))
        ctx.progress(hi, f"{pack.name} ready")

    def _run(self, ctx: JobContext, cmd: list[str], start: float, end: float, label: str | None = None) -> None:
        """Run a command, easing progress from start toward end while it works; honours cancellation."""
        env = {**os.environ, "UV_NO_PROGRESS": "1"}
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
        tail: list[str] = []

        def pump() -> None:
            assert proc.stdout is not None
            for line in proc.stdout:
                tail.append(line.rstrip())
                del tail[:-40]
                log.info("uv: %s", line.rstrip())

        reader = threading.Thread(target=pump, daemon=True)
        reader.start()
        began = time.monotonic()
        while proc.poll() is None:
            if ctx.cancelled:
                proc.terminate()
                proc.wait(10)
                ctx.check()
            if label and end > start:
                # Asymptotic ease: moves quickly at first, never claims to be done early.
                frac = 1 - 1 / (1 + (time.monotonic() - began) / 45)
                ctx.progress(start + (end - start) * frac, f"{label}…")
            time.sleep(0.5)
        reader.join(timeout=5)
        if proc.returncode != 0:
            log.error("command failed: %s\n%s", " ".join(cmd), "\n".join(tail))
            raise EngineError(f"Engine install failed: {(tail or ['unknown error'])[-1]}")
