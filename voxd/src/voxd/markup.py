"""Script markup: direct the delivery inside the script itself.

    Welcome back. [pause 1s] This part is [slow]really important[/slow], so *listen*.
    Our database is {SQL|sequel}. [fast]Terms and conditions apply.[/fast]

| Markup                         | Effect                                                        |
|--------------------------------|---------------------------------------------------------------|
| `[pause]`, `[pause 1.5s]`, `[pause 300ms]` | Silence (default 0.5 s, up to 10 s)               |
| `[slow]…[/slow]`, `[fast]…[/fast]`         | 0.8× / 1.2× speed                                  |
| `[speed 1.3]…[/speed]`                     | Any speed from 0.5× to 2×                          |
| `*words*`                                  | Emphasis: a touch slower, louder and more expressive, set off by tiny pauses |
| `{written|spoken}`                         | Show one thing, say another                        |

Engines have no SSML, so each run of text with the same settings is rendered separately and the
pieces are joined with the requested silences. Unknown or unbalanced tags are read as plain text.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from .editor import read_wav, write_wav
from .engines.base import Engine, EngineError
from .pronounce import pronouncer

MAX_PAUSE_S = 10.0
EMPHASIS = {"speed": 0.92, "gain_db": 2.5, "gap_s": 0.08, "emotion": 0.25}
CHARS_PER_SECOND = 15.0  # rough speaking rate for duration estimates

_SAY_AS = re.compile(r"\{([^{}|\n]+)\|([^{}\n]+)\}")
_TOKEN = re.compile(
    r"\[pause(?:\s+(?P<pause>\d+(?:\.\d+)?)\s*(?P<unit>ms|s)?)?\]"
    r"|\[(?P<open>slow|fast|speed\s+(?P<rate>\d+(?:\.\d+)?))\]"
    r"|\[/(?P<close>slow|fast|speed)\]"
    r"|\*(?P<em>[^*\n]+)\*",
    re.IGNORECASE,
)
_ANY_MARKUP = re.compile(r"\[/?(?:pause|slow|fast|speed)[^\]]*\]|\*[^*\n]+\*|\{[^{}|\n]+\|[^{}\n]+\}", re.IGNORECASE)


@dataclass
class Segment:
    text: str = ""
    speed: float = 1.0
    emphasis: bool = False
    pause: float = 0.0  # seconds; a pause segment has no text

    def public(self) -> dict:
        if self.pause:
            return {"kind": "pause", "seconds": self.pause}
        return {"kind": "speech", "text": self.text, "speed": round(self.speed, 3), "emphasis": self.emphasis}


def has_markup(text: str) -> bool:
    return bool(_ANY_MARKUP.search(text))


def display(text: str) -> str:
    """The script as a listener would read it: tags removed, `{a|b}` shown as `a`."""
    out = _SAY_AS.sub(lambda m: m.group(1), text)
    out = _TOKEN.sub(lambda m: m.group("em") or " ", out)
    out = re.sub(r"[ \t]+([.,!?;:…])", r"\1", out)
    return re.sub(r"[ \t]{2,}", " ", out).strip()


def parse(text: str) -> list[Segment]:
    spoken = _SAY_AS.sub(lambda m: m.group(2), text)
    segments: list[Segment] = []
    speeds: list[tuple[str, float]] = []  # stack of (tag, rate)
    pos = 0

    def rate() -> float:
        r = 1.0
        for _, s in speeds:
            r *= s
        return min(2.0, max(0.5, r))

    def add_text(chunk: str, emphasis: bool = False) -> None:
        if not chunk.strip():
            return
        last = segments[-1] if segments else None
        # Punctuation right after a tag ("*word*." or "[/slow],") finishes the previous phrase.
        lead = re.match(r"\s*([^\w\s\[{*]+)", chunk)
        if lead and last and not last.pause:
            last.text += lead.group(1)
            chunk = chunk[lead.end() :]
            if not chunk.strip():
                return
        elif not re.search(r"\w", chunk):
            return
        if last and not last.pause and last.speed == rate() and last.emphasis == emphasis and not emphasis:
            last.text = f"{last.text} {chunk.strip()}"
        else:
            segments.append(Segment(text=chunk.strip(), speed=rate(), emphasis=emphasis))

    for m in _TOKEN.finditer(spoken):
        add_text(spoken[pos : m.start()])
        pos = m.end()
        if m.group(0).lower().startswith("[pause"):
            value = float(m.group("pause") or 0.5)
            seconds = value / 1000 if (m.group("unit") or "").lower() == "ms" else value
            if segments and segments[-1].pause:
                segments[-1].pause = min(MAX_PAUSE_S, segments[-1].pause + seconds)
            else:
                segments.append(Segment(pause=min(MAX_PAUSE_S, seconds)))
        elif m.group("open"):
            tag = m.group("open").split()[0].lower()
            speeds.append((tag, {"slow": 0.8, "fast": 1.2}.get(tag) or float(m.group("rate"))))
        elif m.group("close"):
            tag = m.group("close").lower()
            if any(t == tag for t, _ in speeds):  # close the innermost matching tag
                idx = max(i for i, (t, _) in enumerate(speeds) if t == tag)
                speeds.pop(idx)
            else:
                add_text(m.group(0))  # stray closing tag: read literally
        elif m.group("em"):
            add_text(m.group("em"), emphasis=True)
    add_text(spoken[pos:])
    return segments


def estimate_seconds(segments: list[Segment], base_speed: float = 1.0) -> float:
    total = 0.0
    for s in segments:
        if s.pause:
            total += s.pause
        else:
            total += len(s.text) / CHARS_PER_SECOND / (base_speed * s.speed * (EMPHASIS["speed"] if s.emphasis else 1))
            total += 2 * EMPHASIS["gap_s"] if s.emphasis else 0
    return total


def render(
    engine: Engine,
    segments: list[Segment],
    voice: str,
    base_speed: float,
    emotion: float | None,
    out: Path,
    scratch: Path,
    split: Callable[[str], list[str]],
    on_part: Callable[[int, int], None] | None = None,
) -> None:
    """Synthesize each segment (long ones in chunks), then join with the requested silences."""
    work: list[tuple[Segment, str]] = []
    for s in segments:
        if s.pause:
            work.append((s, ""))
        else:
            work.extend((s, chunk) for chunk in split(s.text))
    pieces: list[np.ndarray] = []
    rate = 0
    speech_total = sum(1 for s, _ in work if not s.pause)
    done = 0
    pending_silence = 0.0
    for seg, chunk in work:
        if seg.pause:
            pending_silence += seg.pause
            continue
        if on_part:
            on_part(done, speech_total)
        speed = min(2.0, max(0.5, base_speed * seg.speed * (EMPHASIS["speed"] if seg.emphasis else 1.0)))
        mood = min(1.0, (emotion if emotion is not None else 0.5) + EMPHASIS["emotion"]) if seg.emphasis else emotion
        part = scratch / f"{uuid.uuid4().hex}.wav"
        engine.synthesize(pronouncer.apply(chunk), voice, speed, part, mood)
        samples, sr = read_wav(part)
        part.unlink(missing_ok=True)
        rate = rate or sr
        if seg.emphasis:
            samples = samples * float(10 ** (EMPHASIS["gain_db"] / 20))
            pending_silence = max(pending_silence, EMPHASIS["gap_s"])
        if pending_silence:  # also honours a [pause] before the first words
            pieces.append(np.zeros(int(pending_silence * rate), dtype=np.float32))
        pending_silence = EMPHASIS["gap_s"] if seg.emphasis else 0.0
        pieces.append(samples)
        done += 1
    if pending_silence and pieces and any(s.pause for s in segments[-1:]):
        pieces.append(np.zeros(int(pending_silence * rate), dtype=np.float32))  # a trailing [pause] is kept
    if not pieces:
        raise EngineError("There's nothing to say")
    write_wav(out, np.concatenate(pieces), rate)
