"""Take editor: render a timeline of clips (pieces of takes) into a new take.

Editing is non-destructive: sources are never changed. A timeline is a list of clips, each a
range of one take with its own gain; cutting a region out of the middle is two clips of the
same take. Clips are joined with a short equal-power crossfade (so joins never click), then the
whole thing gets optional fades and overall gain.
"""

from __future__ import annotations

import uuid
import wave
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from .engines.base import EngineError

if TYPE_CHECKING:
    from .app import Services

MAX_CLIPS = 200
MAX_SECONDS = 3 * 60 * 60


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    """Mono float32 samples in [-1, 1] and the sample rate."""
    with wave.open(str(path), "rb") as w:
        rate, channels, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width != 2:
        raise EngineError("Only 16-bit audio can be edited")
    data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    return data, rate


def write_wav(path: Path, samples: np.ndarray, rate: int) -> None:
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


def resample(samples: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst or not len(samples):
        return samples
    n = int(round(len(samples) * dst / src))
    return np.interp(np.linspace(0, len(samples) - 1, n), np.arange(len(samples)), samples).astype(np.float32)


def db(gain_db: float) -> float:
    return float(10 ** (gain_db / 20))


def render(services: Services, spec: dict[str, Any]) -> tuple[np.ndarray, int]:
    clips = spec["clips"]
    if not clips:
        raise EngineError("Add at least one clip")
    if len(clips) > MAX_CLIPS:
        raise EngineError(f"Up to {MAX_CLIPS} clips")
    cache: dict[str, tuple[np.ndarray, int]] = {}
    pieces: list[np.ndarray] = []
    rate = 0
    for clip in clips:
        take_id = clip["take_id"]
        if take_id not in cache:
            path = services.settings.takes_dir / f"{take_id}.wav"
            if services.store.get_take(take_id) is None or not path.exists():
                raise EngineError(f"Take {take_id} no longer exists")
            cache[take_id] = read_wav(path)
        audio, src_rate = cache[take_id]
        rate = rate or src_rate  # the first clip decides the output rate
        a = max(0, int(clip.get("start", 0.0) * src_rate))
        b = len(audio) if clip.get("end") is None else min(len(audio), int(clip["end"] * src_rate))
        if b <= a:
            continue
        pieces.append(resample(audio[a:b], src_rate, rate) * db(clip.get("gain_db", 0.0)))
    if not pieces:
        raise EngineError("The clips are empty")

    gap = np.zeros(int(spec.get("gap_s", 0.0) * rate), dtype=np.float32)
    xfade = int(spec.get("crossfade_ms", 10) / 1000 * rate)
    out = pieces[0]
    for piece in pieces[1:]:
        if len(gap):
            out = np.concatenate([out, gap, piece])
            continue
        n = min(xfade, len(out), len(piece))
        if n > 1:
            t = np.linspace(0, np.pi / 2, n, dtype=np.float32)
            mixed = out[-n:] * np.cos(t) + piece[:n] * np.sin(t)  # equal-power
            out = np.concatenate([out[:-n], mixed, piece[n:]])
        else:
            out = np.concatenate([out, piece])
        if len(out) > MAX_SECONDS * rate:
            raise EngineError("Edits can be up to 3 hours long")

    out = out * db(spec.get("gain_db", 0.0))
    for seconds, head in ((spec.get("fade_in_s", 0.0), True), (spec.get("fade_out_s", 0.0), False)):
        n = min(len(out), int(seconds * rate))
        if n > 1:
            ramp = np.linspace(0.0, 1.0, n, dtype=np.float32) ** 2
            if head:
                out[:n] *= ramp
            else:
                out[-n:] *= ramp[::-1]
    if spec.get("normalize"):
        peak = float(np.max(np.abs(out))) if len(out) else 0.0
        if peak > 1e-4:
            out = out * (db(-1.0) / peak)  # peak at −1 dBFS
    return out, rate


def save_edit(services: Services, spec: dict[str, Any]):
    samples, rate = render(services, spec)
    take_id = uuid.uuid4().hex
    path = services.settings.takes_dir / f"{take_id}.wav"
    write_wav(path, samples, rate)
    first = services.store.get_take(spec["clips"][0]["take_id"])
    title = spec.get("title") or f"Edited · {first.text if first else 'take'}"
    take = services.store.add_take(take_id=take_id, engine="editor", voice=first.voice if first else "", text=title[:5000],
                                   duration_s=len(samples) / rate)
    services.bus.publish("take.created", take.public())
    return take
