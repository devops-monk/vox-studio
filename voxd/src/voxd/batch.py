"""Batches (many items, one set of options) and watch folders (process new files automatically).

Each batch item runs as its own job (``batch.speech`` in the compute lane, ``batch.transcribe`` in
the asr lane), so items show up in Activity, can be cancelled, and fail independently. Watch
folders are polled; a file is picked up once its size has stopped changing (so half-copied files
are never processed) and is recorded so it's handled only once.
"""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .engines.base import EngineError
from .speech import render_long
from .transcripts import EXPORTS, transcribe_file, uploads_dir

if TYPE_CHECKING:
    from .app import Services
    from .jobs import JobContext

log = logging.getLogger("voxd.batch")

TEXT_EXTS = {".txt", ".md", ".markdown"}
MEDIA_EXTS = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".mp4", ".mov", ".mkv", ".webm", ".m4v"}
POLL_S = 4.0
OUTPUT_DIR = "VoxStudio output"


def safe_name(name: str, fallback: str = "item") -> str:
    name = re.sub(r"[^\w\-. ]+", "_", name).strip(" ._")
    return (name or fallback)[:80]


def _unique(path: Path) -> Path:
    if not path.exists():
        return path
    for i in range(2, 1000):
        candidate = path.with_name(f"{path.stem} ({i}){path.suffix}")
        if not candidate.exists():
            return candidate
    return path


# ------------------------------------------------------------------ item handlers


def speech_item(services: Services, ctx: JobContext, spec: dict[str, Any]) -> dict[str, Any]:
    result = render_long(services, ctx, spec)
    if out_dir := spec.get("output_dir"):
        dest = _unique(Path(out_dir) / f"{safe_name(spec['name'])}.wav")
        shutil.copyfile(services.settings.takes_dir / f"{result['take_id']}.wav", dest)
        result["output"] = str(dest)
        services.store.record_export("take", result["take_id"], spec["name"], "wav", str(dest), dest.stat().st_size)
    if src := spec.get("source_path"):
        services.store.mark_watch_done(spec["watch_id"], src, result.get("output"))
    return result


def transcribe_item(services: Services, ctx: JobContext, spec: dict[str, Any]) -> dict[str, Any]:
    source = Path(spec["path"])
    if not source.exists():
        raise EngineError(f"{source.name} no longer exists")
    audio_name = f"{uuid.uuid4().hex}{source.suffix.lower()}"
    shutil.copyfile(source, uploads_dir(services) / audio_name)
    job_spec = {"audio": audio_name, "language": spec.get("language"), "model": spec.get("model"),
                "title": source.stem[:120], "transcript_id": uuid.uuid4().hex}
    result = transcribe_file(services, ctx, job_spec)
    if out_dir := spec.get("output_dir"):
        t = services.store.get_transcript(result["transcript_id"])
        outputs = []
        for fmt in spec.get("formats") or ["txt"]:
            dest = _unique(Path(out_dir) / f"{safe_name(source.stem)}.{fmt}")
            dest.write_text(EXPORTS[fmt][1](t), encoding="utf-8")
            outputs.append(str(dest))
            services.store.record_export("transcript", t.id, t.title, fmt, str(dest), dest.stat().st_size)
        result["outputs"] = outputs
    if spec.get("watch_id"):
        services.store.mark_watch_done(spec["watch_id"], str(source), ";".join(result.get("outputs", [])))
    return result


# ------------------------------------------------------------------ batches


def submit_batch(services: Services, kind: str, title: str, items: list[dict], options: dict, output_dir: str | None) -> dict:
    batch_id = uuid.uuid4().hex
    job_ids = []
    for item in items:
        if kind == "speech":
            spec = {"text": item["text"], "voice": options["voice"], "engine": options["engine"], "speed": options.get("speed", 1.0),
                    "emotion": options.get("emotion"), "name": item["name"], "output_dir": output_dir, "batch_id": batch_id}
            job = services.jobs.submit("batch.speech", item["name"], spec)
        else:
            spec = {"path": item["path"], "language": options.get("language"), "model": options.get("model"),
                    "formats": options.get("formats") or ["txt"], "output_dir": output_dir, "batch_id": batch_id}
            job = services.jobs.submit("batch.transcribe", f"Transcribe {Path(item['path']).name}", spec)
        job_ids.append(job.id)
    batch = {"id": batch_id, "kind": kind, "title": title, "options": options, "output_dir": output_dir,
             "job_ids": job_ids, "created_at": time.time()}
    services.store.add_batch(batch)
    services.bus.publish("batches.changed", {"id": batch_id})
    return batch


# ------------------------------------------------------------------ watch folders


class Watcher:
    def __init__(self, services: Services):
        self.services = services
        self._sizes: dict[str, int] = {}

    def scan_once(self) -> int:
        """Queue every new, finished file in enabled watch folders. Returns how many were queued."""
        queued = 0
        for folder in self.services.store.list_watch_folders():
            if not folder["enabled"]:
                continue
            root = Path(folder["path"])
            if not root.is_dir():
                continue
            exts = TEXT_EXTS if folder["action"] == "speak" else MEDIA_EXTS
            out_dir = root / OUTPUT_DIR
            seen = self.services.store.watch_seen(folder["id"])
            for path in sorted(root.iterdir()):
                if not path.is_file() or path.name.startswith(".") or path.suffix.lower() not in exts:
                    continue
                key = str(path)
                if key in seen:
                    continue
                size = path.stat().st_size
                if self._sizes.get(key) != size:  # still being written, or first sighting
                    self._sizes[key] = size
                    continue
                out_dir.mkdir(exist_ok=True)
                try:
                    self._queue(folder, path, out_dir)
                    queued += 1
                except Exception as exc:  # a bad file must not stop the folder
                    log.warning("watch %s: %s: %s", folder["path"], path.name, exc)
                    self.services.store.mark_watch_seen(folder["id"], key, error=str(exc))
                self._sizes.pop(key, None)
        return queued

    def _queue(self, folder: dict, path: Path, out_dir: Path) -> None:
        opts = folder["options"]
        self.services.store.mark_watch_seen(folder["id"], str(path))
        if folder["action"] == "speak":
            text = path.read_text(encoding="utf-8", errors="replace").strip()
            if not text:
                raise EngineError("The file is empty")
            spec = {"text": text[:200_000], "voice": opts["voice"], "engine": opts["engine"], "speed": opts.get("speed", 1.0),
                    "name": path.stem, "output_dir": str(out_dir), "watch_id": folder["id"], "source_path": str(path)}
            self.services.jobs.submit("batch.speech", f"{path.name} (watch folder)", spec)
        else:
            spec = {"path": str(path), "language": opts.get("language"), "model": opts.get("model"),
                    "formats": opts.get("formats") or ["txt", "srt"], "output_dir": str(out_dir), "watch_id": folder["id"]}
            self.services.jobs.submit("batch.transcribe", f"{path.name} (watch folder)", spec)
        self.services.bus.publish("watch.changed", {"id": folder["id"]})

    async def run(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self.scan_once)
            except Exception:
                log.exception("watch folder scan failed")
            await asyncio.sleep(POLL_S)
