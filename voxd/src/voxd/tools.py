"""Tools: clean up a recording, or re-voice it (speech-to-speech). Results are saved as takes.

Sources are either an uploaded file or an existing take. Both jobs work from a private copy, so
deleting the source mid-job is harmless.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .engines.base import EngineError, wav_duration
from .transcripts import uploads_dir

if TYPE_CHECKING:
    from .app import Services
    from .jobs import JobContext

MAX_CONVERT_S = 15 * 60


def stage_take(services: Services, take_id: str) -> tuple[str, str]:
    """Copy a take's audio into uploads; returns (upload name, the take's text)."""
    take = services.store.get_take(take_id)
    path = services.settings.takes_dir / f"{take_id}.wav"
    if take is None or not path.exists():
        raise EngineError("That take no longer exists")
    name = f"{uuid.uuid4().hex}.wav"
    shutil.copyfile(path, uploads_dir(services) / name)
    return name, take.text


def _finish(services: Services, *, engine: str, voice: str, text: str, out: Path) -> dict[str, Any]:
    take_id = uuid.uuid4().hex
    dest = services.settings.takes_dir / f"{take_id}.wav"
    shutil.move(out, dest)
    take = services.store.add_take(take_id=take_id, engine=engine, voice=voice, text=text, duration_s=wav_duration(dest))
    services.bus.publish("take.created", take.public())
    return {"take_id": take_id}


def clean_job(services: Services, ctx: JobContext, spec: dict[str, Any]) -> dict[str, Any]:
    src = uploads_dir(services) / spec["audio"]
    out = uploads_dir(services) / f".{uuid.uuid4().hex}.wav"
    try:
        ctx.progress(0.1, "Cleaning up the audio")
        stats = services.media.call("clean", path=str(src), out=str(out), denoise=spec["denoise"],
                                    normalize=spec.get("normalize"), trim=spec["trim"], highpass=spec["denoise"])
        ctx.check()
        result = _finish(services, engine="tools", voice="clean", text=spec["title"], out=out)
        return {**result, **{k: v for k, v in stats.items() if k != "id" and k != "ok"}}
    finally:
        src.unlink(missing_ok=True)
        out.unlink(missing_ok=True)


def convert_job(services: Services, ctx: JobContext, spec: dict[str, Any]) -> dict[str, Any]:
    src = uploads_dir(services) / spec["audio"]
    wav = uploads_dir(services) / f".{uuid.uuid4().hex}.src.wav"
    out = uploads_dir(services) / f".{uuid.uuid4().hex}.wav"
    try:
        ctx.progress(0.03, "Reading the recording")
        services.media.call("extract", path=str(src), out=str(wav), rate=16000, channels=1)
        if wav_duration(wav) > MAX_CONVERT_S:
            raise EngineError("Recordings up to 15 minutes can be converted")
        ctx.check()
        ctx.progress(0.08, "Converting the voice")
        engine = services.registry.get("chatterbox")
        if reason := engine.probe():
            raise EngineError(reason)

        def on_progress(x: float) -> None:
            ctx.check()
            ctx.progress(0.08 + 0.9 * x, f"Converting the voice… {int(x * 100)}%")

        engine.convert(wav, spec["voice"], out, on_progress=on_progress)  # type: ignore[attr-defined]
        return _finish(services, engine="chatterbox-vc", voice=spec["voice"], text=spec["title"], out=out)
    finally:
        for p in (src, wav, out):
            p.unlink(missing_ok=True)
