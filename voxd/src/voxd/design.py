"""Voice design: describe a voice in words, get new voices blended from Kokoro's voice space.

How it works
1. **Measure** each Kokoro voice once (cached): median pitch, spectral brightness and how much
   its loudness moves (expressiveness), from a short reference sentence.
2. **Read** the description into targets on those axes (plus gender and accent filters).
3. **Blend**: pick the voices closest to the target and mix their style vectors. Each candidate
   is a recipe like ``mix:af_heart=0.6,af_bella=0.4`` that Kokoro can speak directly.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from .engines.base import EngineError

if TYPE_CHECKING:
    from .engines.kokoro import KokoroEngine
    from .jobs import JobContext

REFERENCE = "Hello there. I'm reading this sentence so you can hear how my voice sounds, calm and clear."
TRAITS = ("depth", "warmth", "energy")
MIX_PREFIX = "mix:"
CACHE_VERSION = 1

# ---------------------------------------------------------------- audio measurements


def median_pitch(samples: np.ndarray, rate: int) -> float:
    """Median F0 in Hz over voiced frames (a compact YIN)."""
    frame, hop = int(rate * 0.04), int(rate * 0.01)
    lo, hi = int(rate / 400), int(rate / 60)  # 60–400 Hz
    pitches = []
    for start in range(0, len(samples) - frame - hi, hop):
        x = samples[start : start + frame + hi].astype(np.float64)
        if np.sqrt(np.mean(x[:frame] ** 2)) < 0.02:
            continue  # silence
        diff = np.array([np.sum((x[:frame] - x[tau : tau + frame]) ** 2) for tau in range(hi)])
        cmnd = diff[1:] * np.arange(1, hi) / np.maximum(np.cumsum(diff[1:]), 1e-12)
        tau = lo + int(np.argmin(cmnd[lo - 1 :]))
        if cmnd[tau - 1] < 0.2:
            pitches.append(rate / tau)
    return float(np.median(pitches)) if pitches else 0.0


def brightness(samples: np.ndarray, rate: int) -> float:
    """Spectral centroid in Hz: low = warm/dark, high = bright/crisp."""
    spec = np.abs(np.fft.rfft(samples * np.hanning(len(samples))))
    freqs = np.fft.rfftfreq(len(samples), 1 / rate)
    return float(np.sum(freqs * spec) / max(np.sum(spec), 1e-12))


def expressiveness(samples: np.ndarray, rate: int) -> float:
    """Coefficient of variation of frame loudness over speech: flat vs lively delivery."""
    frame = int(rate * 0.05)
    rms = np.array([np.sqrt(np.mean(samples[i : i + frame] ** 2)) for i in range(0, len(samples) - frame, frame)])
    rms = rms[rms > 0.02]
    return float(np.std(rms) / np.mean(rms)) if len(rms) > 3 else 0.0


# ---------------------------------------------------------------- trait table


@dataclass
class VoiceTraits:
    voice: str
    language: str
    gender: str | None
    pitch_hz: float
    brightness_hz: float
    expressiveness: float


class TraitStore:
    """Measured traits for Kokoro voices, computed once and cached on disk."""

    def __init__(self, path: Path):
        self.path = path

    def load(self) -> list[VoiceTraits] | None:
        try:
            data = json.loads(self.path.read_text())
        except (OSError, ValueError):
            return None
        if data.get("version") != CACHE_VERSION:
            return None
        return [VoiceTraits(**t) for t in data["voices"]]

    def analyze(self, ctx: JobContext, engine: KokoroEngine) -> dict[str, Any]:
        voices = [v for v in engine.voices() if v.language.startswith("en")]  # design targets English for now
        out: list[VoiceTraits] = []
        for i, v in enumerate(voices):
            ctx.check()
            ctx.progress(i / len(voices), f"Listening to {v.name} ({i + 1} of {len(voices)})")
            samples, rate = engine.render(REFERENCE, v.id, 1.0)
            out.append(VoiceTraits(v.id, v.language, v.gender, median_pitch(samples, rate), brightness(samples, rate), expressiveness(samples, rate)))
        self.path.write_text(json.dumps({"version": CACHE_VERSION, "voices": [t.__dict__ for t in out]}))
        return {"voices": len(out)}


def normalized(traits: list[VoiceTraits]) -> dict[str, np.ndarray]:
    """Per-voice trait positions in 0–1 (rank-based, so one outlier can't squash the rest).

    depth  = 1 − pitch rank (deep voices near 1)
    warmth = 1 − brightness rank
    energy = expressiveness rank
    """

    def rank(values: list[float]) -> np.ndarray:
        order = np.argsort(np.argsort(values))
        return order / max(1, len(values) - 1)

    depth = 1 - rank([t.pitch_hz for t in traits])
    warmth = 1 - rank([t.brightness_hz for t in traits])
    energy = rank([t.expressiveness for t in traits])
    return {t.voice: np.array([depth[i], warmth[i], energy[i]]) for i, t in enumerate(traits)}


# ---------------------------------------------------------------- description → target

_WORDS: list[tuple[str, dict[str, Any]]] = [
    (r"\b(female|woman|women|girl|lady|she|her|feminine)\b", {"gender": "female"}),
    (r"\b(male|man|men|guy|boy|gentleman|he|his|masculine)\b", {"gender": "male"}),
    (r"\b(british|uk|england|english accent|london|posh|rp)\b", {"language": "en-GB"}),
    (r"\b(american|usa|new york|californian?)\b", {"language": "en-US"}),
    (r"\b(deep|low|bass|baritone|resonant|booming|gravelly|husky)(ly|ally)?\b", {"depth": 0.9}),
    (r"\b(high|light|airy|youthful|young|childlike|squeaky|chirpy)(ly|ally)?\b", {"depth": 0.15}),
    (r"\b(warm|soft|smooth|gentle|cozy|cosy|rich|velvety|mellow|soothing)(ly|ally)?\b", {"warmth": 0.85}),
    (r"\b(crisp|clear|bright|sharp|clean|precise|articulate)(ly|ally)?\b", {"warmth": 0.2}),
    (r"\b(energetic|excited|lively|upbeat|cheerful|dynamic|enthusiastic|bubbly|animated|expressive)(ly|ally)?\b", {"energy": 0.9}),
    (r"\b(calm|relaxed|measured|steady|serene|sleepy|monotone|flat|composed|meditative)(ly|ally)?\b", {"energy": 0.15}),
    (r"\b(fast|quick|rapid|brisk|snappy)(ly|ally)?\b", {"speed": 1.15}),
    (r"\b(slow|slowly|unhurried|leisurely|deliberate)(ly|ally)?\b", {"speed": 0.88}),
]


@dataclass
class Target:
    gender: str | None = None
    language: str | None = None
    depth: float | None = None
    warmth: float | None = None
    energy: float | None = None
    speed: float = 1.0
    matched: tuple[str, ...] = ()

    def vector(self) -> tuple[np.ndarray, np.ndarray]:
        """(target, weights): unspecified traits get zero weight."""
        vals = [self.depth, self.warmth, self.energy]
        return np.array([0.5 if v is None else v for v in vals]), np.array([0.0 if v is None else 1.0 for v in vals])


def parse_description(text: str) -> Target:
    t = Target()
    # Phrases whose single words would mislead ("high energy" is not a high-pitched voice).
    lowered = re.sub(r"\bhigh[- ]energy\b", "energetic", text.lower())
    lowered = re.sub(r"\blow[- ]energy\b", "calm", lowered)
    lowered = re.sub(r"\b(high|low)[- ]pitch(ed)?\b", lambda m: "light" if m.group(1) == "high" else "deep", lowered)
    matched = []
    for pattern, effect in _WORDS:
        m = re.search(pattern, lowered)
        if m:
            matched.append(m.group(0))
            for key, value in effect.items():
                setattr(t, key, value)
    t.matched = tuple(matched)
    return t


def apply_sliders(target: Target, sliders: dict[str, float] | None) -> Target:
    for key in TRAITS:
        if sliders and sliders.get(key) is not None:
            setattr(target, key, float(np.clip(sliders[key], 0, 1)))
    return target


# ---------------------------------------------------------------- blends


def recipe(parts: list[tuple[str, float]]) -> str:
    total = sum(w for _, w in parts)
    return MIX_PREFIX + ",".join(f"{v}={w / total:.3f}" for v, w in parts)


def parse_recipe(voice_id: str) -> list[tuple[str, float]]:
    """``mix:af_heart=0.6,af_bella=0.4`` → [("af_heart", 0.6), ("af_bella", 0.4)]."""
    if not voice_id.startswith(MIX_PREFIX):
        raise EngineError(f"Not a blend: {voice_id}")
    parts = []
    for item in voice_id[len(MIX_PREFIX) :].split(","):
        name, _, weight = item.partition("=")
        try:
            w = float(weight)
        except ValueError as exc:
            raise EngineError(f"Invalid blend: {voice_id}") from exc
        if w <= 0 or not re.fullmatch(r"[a-z]{2}_[a-z_]+", name):
            raise EngineError(f"Invalid blend: {voice_id}")
        parts.append((name, w))
    if not 1 <= len(parts) <= 4:
        raise EngineError("A blend mixes 1 to 4 voices")
    return parts


def design(traits: list[VoiceTraits], target: Target, count: int = 4) -> list[dict[str, Any]]:
    """Return up to ``count`` distinct candidate blends nearest to the target."""
    positions = normalized(traits)
    pool = [
        t for t in traits if (target.gender is None or t.gender == target.gender) and (target.language is None or t.language == target.language)
    ] or [t for t in traits if target.gender is None or t.gender == target.gender] or traits
    goal, weights = target.vector()

    def distance(t: VoiceTraits) -> float:
        return float(np.sqrt(np.sum(weights * (positions[t.voice] - goal) ** 2)))

    ranked = sorted(pool, key=distance)
    if len(ranked) == 1:
        return [{"recipe": recipe([(ranked[0].voice, 1)]), "voices": [ranked[0].voice], "score": 1.0, "traits": positions[ranked[0].voice].tolist()}]

    # Pairs and triples from the nearest voices, weighted toward the closer one.
    near = ranked[: min(6, len(ranked))]
    combos = [(0, 1), (0, 2), (1, 2), (0, 1, 2), (0, 3), (1, 3), (2, 3), (0, 4)]
    seen: set[tuple[str, ...]] = set()
    out: list[dict[str, Any]] = []
    for combo in combos:
        members = [near[i] for i in combo if i < len(near)]
        key = tuple(sorted(m.voice for m in members))
        if len(members) < 2 or key in seen:
            continue
        seen.add(key)
        inv = [1 / (distance(m) + 0.05) for m in members]
        parts = [(m.voice, w) for m, w in zip(members, inv)]
        total = sum(inv)
        mixed = sum(positions[m.voice] * (w / total) for m, w in zip(members, inv))
        fit = float(np.clip(1 - np.sqrt(np.sum(weights * (mixed - goal) ** 2)) / max(np.sqrt(weights.sum()), 1e-9), 0, 1))
        out.append({"recipe": recipe(parts), "voices": [m.voice for m in members], "score": round(fit, 3), "traits": mixed.round(3).tolist()})
        if len(out) == count:
            break
    return out
