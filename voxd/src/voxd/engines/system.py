"""Built-in OS speech: instant, zero-download TTS for first run and tests.

macOS uses ``say``; Linux uses ``espeak-ng``. Text is always passed on stdin,
never as an argument, so it can't be read as a flag.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from functools import cache
from pathlib import Path

from .base import Engine, EngineError, Voice

_SAY_LINE = re.compile(r"^(?P<name>.+?)\s{2,}(?P<lang>[a-z]{2,3}[_-][A-Za-z0-9]+)\s+#\s*(?P<sample>.*)$")
_BASE_WPM = 180
# macOS ships novelty "voices" that are sound effects rather than speech.
_NOVELTY = {"Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Good News", "Jester", "Organ", "Superstar", "Trinoids", "Whisper", "Wobble", "Zarvox"}


class SystemEngine(Engine):
    id = "system"
    name = "System Voices"
    license = "Built into your OS"

    def __init__(self) -> None:
        self._say = shutil.which("say") if sys.platform == "darwin" else None
        self._espeak = None if self._say else shutil.which("espeak-ng")

    def probe(self) -> str | None:
        if self._say or self._espeak:
            return None
        return "Install espeak-ng to enable system voices" if sys.platform.startswith("linux") else "Not supported on this OS yet"

    def voices(self) -> list[Voice]:
        return list(self._voice_table())

    @cache
    def _voice_table(self) -> tuple[Voice, ...]:
        if self._say:
            out = subprocess.run([self._say, "-v", "?"], capture_output=True, text=True, check=True).stdout
            voices = []
            for line in out.splitlines():
                if m := _SAY_LINE.match(line.strip()):
                    name = m["name"].strip()
                    if name in _NOVELTY:
                        continue
                    voices.append(Voice(id=name, name=name, language=m["lang"].replace("_", "-"), sample=m["sample"] or None))
            return tuple(voices)
        if self._espeak:
            out = subprocess.run([self._espeak, "--voices"], capture_output=True, text=True, check=True).stdout
            voices = []
            for line in out.splitlines()[1:]:
                cols = line.split()
                if len(cols) >= 5:
                    voices.append(Voice(id=cols[4], name=cols[3].replace("_", " "), language=cols[1]))
            return tuple(voices)
        return ()

    def synthesize(self, text: str, voice_id: str, speed: float, out: Path, emotion: float | None = None) -> None:
        if voice_id not in {v.id for v in self._voice_table()}:
            raise EngineError(f"Unknown voice: {voice_id}")
        wpm = str(round(_BASE_WPM * speed))
        if self._say:
            cmd = [self._say, "-v", voice_id, "-r", wpm, "--data-format=LEI16@24000", "-o", str(out), "-f", "-"]
        elif self._espeak:
            cmd = [self._espeak, "-v", voice_id, "-s", wpm, "-w", str(out), "--stdin"]
        else:
            raise EngineError(self.probe() or "System voices unavailable")
        proc = subprocess.run(cmd, input=text, capture_output=True, text=True, timeout=120)
        if proc.returncode != 0 or not out.exists():
            raise EngineError(proc.stderr.strip() or "System speech failed")
