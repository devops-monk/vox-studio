"""Video/audio dubbing: transcribe → translate → re-voice each line in its time slot → mix → mux.

Pipeline (two jobs):
* ``dub.prepare`` — extract audio, transcribe with Whisper, fetch any translation packs, translate,
  and pick a default voice for the target language. The project is then ready for review.
* ``dub.render`` — speak every line with its speaker's voice, fit it to its slot (speeding up to
  ``MAX_SPEEDUP`` when needed), mix over silence or the ducked original, and write WAV (+ MP4).
"""

from __future__ import annotations

import time
import uuid
import wave
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from .engines.base import EngineError
from .models import TRANSLATION_LANGUAGES, translation_model_id
from .store import Dub
from .transcripts import to_srt, to_vtt

if TYPE_CHECKING:
    from .app import Services
    from .jobs import JobContext

MIX_RATE = 44100
MAX_SPEEDUP = 1.3
DUCK_GAIN = 0.18  # ≈ −15 dB under the dub
LANGUAGES = TRANSLATION_LANGUAGES  # dubbing targets = languages we can translate

# First choice of voice per target language: (engine, voice). System voices cover German.
DEFAULT_VOICES: dict[str, list[tuple[str, str]]] = {
    "en": [("kokoro", "af_heart"), ("system", "Samantha")],
    "es": [("kokoro", "ef_dora"), ("system", "Mónica"), ("system", "Monica")],
    "fr": [("kokoro", "ff_siwis"), ("system", "Thomas")],
    "de": [("system", "Anna")],
    "it": [("kokoro", "if_sara"), ("system", "Alice")],
    "pt": [("kokoro", "pf_dora"), ("system", "Luciana")],
    "hi": [("kokoro", "hf_alpha"), ("system", "Lekha")],
    "ja": [("kokoro", "jf_alpha"), ("system", "Kyoko")],
    "zh": [("kokoro", "zf_xiaobei"), ("system", "Tingting")],
}


def dub_dir(services: Services, dub_id: str) -> Path:
    d = services.settings.data_dir / "dubs" / dub_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def default_voice(services: Services, lang: str) -> dict[str, str] | None:
    for engine_id, voice in DEFAULT_VOICES.get(lang, []):
        try:
            engine = services.registry.get(engine_id)
        except EngineError:
            continue
        if any(v.id == voice for v in engine.voices()):
            return {"engine": engine_id, "voice": voice}
    # Any available voice in the language.
    for info in services.registry.info():
        if not info.available or "tts" not in info.capabilities:
            continue
        for v in services.registry.get(info.id).voices():
            if v.language.split("-")[0] == lang:
                return {"engine": info.id, "voice": v.id}
    return None


# ------------------------------------------------------------------ translation


def translation_route(src: str, dst: str) -> list[str]:
    """Model ids needed to go from src to dst (pivoting through English)."""
    if src == dst:
        return []
    if "en" in (src, dst):
        return [translation_model_id(src, dst)]
    return [translation_model_id(src, "en"), translation_model_id("en", dst)]


def ensure_translation(services: Services, ctx: JobContext, src: str, dst: str, span: tuple[float, float]) -> list[Path]:
    route = translation_route(src, dst)
    lo, hi = span
    dirs = []
    for i, model_id in enumerate(route):
        spec = services.models.get(model_id)  # raises for unsupported pairs
        if not services.models.installed(spec):
            a = lo + (hi - lo) * i / len(route)
            b = lo + (hi - lo) * (i + 1) / len(route)
            ctx.progress(a, f"Downloading {spec.name} translation")
            services.models.download(ctx, spec, span=(a, b))
        dirs.append(services.models.dir(spec))
    return dirs


def translate(services: Services, texts: list[str], packages: list[Path]) -> list[str]:
    for pkg in packages:
        texts = services.media.call("translate", package=str(pkg), texts=texts)["texts"]
    return texts


# ------------------------------------------------------------------ prepare


def prepare(services: Services, ctx: JobContext, spec: dict[str, Any]) -> dict[str, Any]:
    dub = services.store.get_dub(spec["dub_id"])
    if dub is None:
        raise EngineError("This dub was deleted")
    folder = dub_dir(services, dub.id)
    try:
        source = folder / dub.source_file
        ctx.progress(0.02, "Reading the media")
        info = services.media.call("probe", path=str(source))
        if not info["has_audio"]:
            raise EngineError("This file has no audio track to dub")
        speech = folder / "speech-16k.wav"
        services.media.call("extract", path=str(source), out=str(speech), rate=16000, channels=1)
        ctx.check()

        ctx.progress(0.1, "Transcribing")
        whisper = services.registry.get("whisper")

        def asr_progress(x: float) -> None:
            ctx.check()
            ctx.progress(0.1 + 0.5 * x, f"Transcribing… {int(x * 100)}%")

        result = whisper.transcribe(path=str(speech), language=spec.get("source_lang") or None, on_progress=asr_progress)  # type: ignore[attr-defined]
        src = result["language"]
        if src not in LANGUAGES:
            raise EngineError(f"Dubbing from {src!r} isn't supported yet. Supported: {', '.join(LANGUAGES.values())}")
        segments = [
            {"id": uuid.uuid4().hex[:8], "start": s["start"], "end": s["end"], "text": s["text"], "translation": "", "speaker": "S1"}
            for s in result["segments"]
            if s["text"].strip()
        ]
        if not segments:
            raise EngineError("No speech was found in this file")

        packages = ensure_translation(services, ctx, src, dub.target_lang, (0.6, 0.85))
        ctx.progress(0.88, f"Translating into {LANGUAGES[dub.target_lang]}")
        texts = translate(services, [s["text"] for s in segments], packages) if packages else [s["text"] for s in segments]
        for seg, text in zip(segments, texts):
            seg["translation"] = text

        cast = {"S1": default_voice(services, dub.target_lang)}  # None when no voice speaks the language yet
        services.store.update_dub(
            dub.id, status="ready", source_lang=src, has_video=info["has_video"], duration_s=info["duration"] or result["duration"],
            segments=segments, cast=cast, error=None,
        )
        services.bus.publish("dubs.changed", {"id": dub.id})
        return {"dub_id": dub.id, "segments": len(segments), "source_lang": src}
    except Exception as exc:
        services.store.update_dub(dub.id, status="failed", error=str(exc))
        services.bus.publish("dubs.changed", {"id": dub.id})
        raise


# ------------------------------------------------------------------ render


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    """Mono float32 samples and rate."""
    with wave.open(str(path), "rb") as w:
        rate, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width != 2:
        raise EngineError("Expected 16-bit audio")
    x = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    return (x.reshape(-1, ch).mean(axis=1) if ch > 1 else x), rate


def resample(x: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst or len(x) == 0:
        return x
    n = int(round(len(x) * dst / src))
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def slot_seconds(segments: list[dict], i: int, total: float) -> float:
    """Room for line i: until the next line starts (or the end of the media)."""
    end = segments[i + 1]["start"] if i + 1 < len(segments) else max(total, segments[i]["end"])
    return max(0.3, end - segments[i]["start"])


def speak(services: Services, cast: dict, seg: dict, speed: float, out: Path) -> tuple[np.ndarray, int]:
    voice = cast.get(seg["speaker"]) or {}
    if not voice.get("engine") or not voice.get("voice"):
        raise EngineError(f"Choose a voice for {seg['speaker']}")
    engine = services.registry.get(voice["engine"])
    engine.synthesize(seg["translation"], voice["voice"], speed, out)
    return read_wav(out)


def render(services: Services, ctx: JobContext, spec: dict[str, Any]) -> dict[str, Any]:
    dub = services.store.get_dub(spec["dub_id"])
    if dub is None:
        raise EngineError("This dub was deleted")
    folder = dub_dir(services, dub.id)
    try:
        segments = dub.segments
        total = dub.duration_s or max(s["end"] for s in segments)
        track = np.zeros(int((total + 1.0) * MIX_RATE), dtype=np.float32)
        scratch = folder / "lines"
        scratch.mkdir(exist_ok=True)

        for i, seg in enumerate(segments):
            ctx.check()
            ctx.progress(0.05 + 0.75 * i / len(segments), f"Voicing line {i + 1} of {len(segments)}")
            if not seg["translation"].strip():
                seg["fit"] = {"speed": 1.0, "overflow_s": 0.0, "duration_s": 0.0}
                continue
            slot = slot_seconds(segments, i, total)
            path = scratch / f"{seg['id']}.wav"
            audio, rate = speak(services, dub.cast, seg, 1.0, path)
            natural = len(audio) / rate
            speed = 1.0
            if natural > slot:
                speed = min(MAX_SPEEDUP, natural / slot)
                audio, rate = speak(services, dub.cast, seg, speed, path)
            placed = resample(audio, rate, MIX_RATE)
            start = int(seg["start"] * MIX_RATE)
            end = min(len(track), start + len(placed))
            track[start:end] += placed[: end - start]
            seg["fit"] = {"speed": round(speed, 2), "overflow_s": round(max(0.0, len(placed) / MIX_RATE - slot), 2), "duration_s": round(len(placed) / MIX_RATE, 2)}

        ctx.progress(0.82, "Mixing")
        stereo = np.stack([track, track], axis=1)
        if dub.mix == "duck":
            original = folder / "original-44k.wav"
            services.media.call("extract", path=str(folder / dub.source_file), out=str(original), rate=MIX_RATE, channels=2)
            with wave.open(str(original), "rb") as w:
                bg = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32).reshape(-1, 2) / 32768.0
            n = min(len(bg), len(stereo))
            stereo[:n] += bg[:n] * DUCK_GAIN
        stereo = stereo[: int(total * MIX_RATE)]
        peak = float(np.max(np.abs(stereo))) if len(stereo) else 0.0
        if peak > 0.98:  # never clip
            stereo *= 0.98 / peak
        out_wav = folder / "dub.wav"
        with wave.open(str(out_wav), "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(MIX_RATE)
            w.writeframes((stereo * 32767).astype("<i2").tobytes())

        output: dict[str, Any] = {"audio": "dub.wav", "rendered_at": time.time()}
        if dub.has_video:
            ctx.progress(0.9, "Writing the video")
            services.media.call("mux", video=str(folder / dub.source_file), audio=str(out_wav), out=str(folder / "dub.mp4"))
            output["video"] = "dub.mp4"
        for f in scratch.glob("*.wav"):
            f.unlink()
        services.store.update_dub(dub.id, status="done", segments=segments, output=output, error=None)
        services.bus.publish("dubs.changed", {"id": dub.id})
        return {"dub_id": dub.id, **output}
    except Exception as exc:
        from .jobs import JobCancelled

        cancelled = isinstance(exc, JobCancelled)
        # A cancelled render leaves the project editable; a failed one shows why.
        services.store.update_dub(dub.id, status="ready" if cancelled else "failed", error=None if cancelled else str(exc))
        services.bus.publish("dubs.changed", {"id": dub.id})
        raise


def subtitles(dub: Dub, fmt: str, which: str = "translation") -> str:
    segs = [{"start": s["start"], "end": s["end"], "text": s[which]} for s in dub.segments]
    return to_srt(segs) if fmt == "srt" else to_vtt(segs)


def retranslate(services: Services, ctx: JobContext, spec: dict[str, Any]) -> dict[str, Any]:
    dub = services.store.get_dub(spec["dub_id"])
    if dub is None:
        raise EngineError("This dub was deleted")
    target = spec["target"]
    packages = ensure_translation(services, ctx, dub.source_lang, target, (0.0, 0.8))
    ctx.progress(0.85, f"Translating into {LANGUAGES[target]}")
    texts = translate(services, [s["text"] for s in dub.segments], packages) if packages else [s["text"] for s in dub.segments]
    segments = [{**{k: v for k, v in s.items() if k != "fit"}, "translation": t} for s, t in zip(dub.segments, texts)]
    fields: dict[str, Any] = {"segments": segments, "target_lang": target}
    if target != dub.target_lang:
        voice = default_voice(services, target)
        fields["cast"] = {speaker: voice for speaker in {s["speaker"] for s in segments}}
    if dub.output.get("audio"):
        fields["output"] = {**dub.output, "stale": True}
    services.store.update_dub(dub.id, **fields)
    services.bus.publish("dubs.changed", {"id": dub.id})
    return {"dub_id": dub.id, "target": target}
