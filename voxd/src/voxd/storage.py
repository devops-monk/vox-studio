"""Where disk space goes, and safe clean-up of files nothing refers to any more.

Clean-up only removes leftovers: scratch folders from interrupted renders, uploads whose
transcript or job is gone, and dub/book folders whose record was deleted. It never touches
anything still listed in the app.
"""

from __future__ import annotations

import shutil
import time
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .app import Services

GRACE_S = 3600  # never touch anything modified in the last hour (it may belong to a running job)

PARTS = (
    ("takes", "Takes & history", "takes"),
    ("voices", "Your voices", "voices"),
    ("dubs", "Dubs", "dubs"),
    ("books", "Stories & audiobooks", "books"),
    ("uploads", "Transcripts & uploads", "uploads"),
    ("models", "Voice models", "models"),
    ("runtimes", "Engine runtimes", "runtimes"),
    ("app", "App runtime", "runtime"),
)


def _size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    total = 0
    for p in path.rglob("*"):
        try:
            if p.is_file() and not p.is_symlink():
                total += p.stat().st_size
        except OSError:
            pass
    return total


def usage(services: Services) -> dict:
    root = services.settings.data_dir
    parts = [{"id": pid, "label": label, "path": str(root / sub), "bytes": _size(root / sub)} for pid, label, sub in PARTS if (root / sub).exists()]
    db = sum(p.stat().st_size for p in root.glob("voxd.db*"))
    parts.append({"id": "database", "label": "Library database", "path": str(root / "voxd.db"), "bytes": db})
    return {"data_dir": str(root), "total": sum(p["bytes"] for p in parts), "parts": parts}


def _old(path: Path, now: float) -> bool:
    try:
        return now - path.stat().st_mtime > GRACE_S
    except OSError:
        return False


def _remove(path: Path) -> int:
    size = _size(path)
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
    else:
        path.unlink(missing_ok=True)
    return size


def cleanup(services: Services, now: float | None = None) -> dict:
    now = now or time.time()
    root, store = services.settings.data_dir, services.store
    freed = removed = 0

    def drop(path: Path) -> None:
        nonlocal freed, removed
        if _old(path, now):
            freed += _remove(path)
            removed += 1

    busy_uploads = {str(j.input.get("audio")) for j in store.list_jobs(500) if not j.finished and j.input.get("audio")}
    if (uploads := root / "uploads").is_dir():
        keep = store.column_values("transcripts", "audio") | busy_uploads
        for f in uploads.iterdir():
            if f.name not in keep:
                drop(f)
    if (takes := root / "takes").is_dir():
        keep = store.column_values("takes", "id")
        for f in takes.iterdir():
            if f.name.startswith(".") or (f.suffix == ".wav" and f.stem not in keep):
                drop(f)
    for kind in ("dubs", "books"):
        if (folder := root / kind).is_dir():
            keep = store.column_values(kind, "id")
            for d in folder.iterdir():
                if d.is_dir() and d.name not in keep:
                    drop(d)
    if (voices := root / "voices").is_dir():
        keep = store.column_values("custom_voices", "id")
        for f in voices.glob("cv_*.wav"):
            if f.stem not in keep:
                drop(f)
    return {"freed_bytes": freed, "removed": removed}
