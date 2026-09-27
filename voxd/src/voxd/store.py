"""SQLite persistence. Schema changes are appended to MIGRATIONS, never edited."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Any
from pathlib import Path

MIGRATIONS: list[str] = [
    """
    CREATE TABLE takes (
        id          TEXT PRIMARY KEY,
        engine      TEXT NOT NULL,
        voice       TEXT NOT NULL,
        text        TEXT NOT NULL,
        duration_s  REAL NOT NULL,
        starred     INTEGER NOT NULL DEFAULT 0,
        created_at  REAL NOT NULL
    );
    CREATE INDEX takes_created ON takes(created_at DESC);
    """,
    """
    CREATE TABLE jobs (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        title       TEXT NOT NULL,
        status      TEXT NOT NULL,
        progress    REAL NOT NULL DEFAULT 0,
        message     TEXT,
        input       TEXT NOT NULL,
        result      TEXT,
        error       TEXT,
        created_at  REAL NOT NULL,
        updated_at  REAL NOT NULL
    );
    CREATE INDEX jobs_created ON jobs(created_at DESC);
    CREATE TABLE job_events (
        job_id  TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        seq     INTEGER NOT NULL,
        type    TEXT NOT NULL,
        data    TEXT NOT NULL,
        at      REAL NOT NULL,
        PRIMARY KEY (job_id, seq)
    );
    """,
    """
    CREATE TABLE settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
    );
    CREATE TABLE custom_voices (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        language     TEXT NOT NULL,
        duration_s   REAL NOT NULL,
        consent      TEXT NOT NULL,
        created_at   REAL NOT NULL
    );
    """,
    """
    ALTER TABLE custom_voices ADD COLUMN consent_by TEXT NOT NULL DEFAULT '';
    CREATE TABLE voice_meta (
        engine    TEXT NOT NULL,
        voice_id  TEXT NOT NULL,
        favorite  INTEGER NOT NULL DEFAULT 0,
        tags      TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (engine, voice_id)
    );
    """,
    """
    CREATE TABLE designed_voices (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        recipe       TEXT NOT NULL,
        description  TEXT NOT NULL,
        language     TEXT NOT NULL,
        gender       TEXT,
        speed        REAL NOT NULL DEFAULT 1.0,
        created_at   REAL NOT NULL
    );
    """,
]

ACTIVE = ("queued", "running")


@dataclass
class Take:
    id: str
    engine: str
    voice: str
    text: str
    duration_s: float
    starred: bool
    created_at: float

    def public(self) -> dict:
        return asdict(self)


@dataclass
class Job:
    id: str
    kind: str
    title: str
    status: str  # queued | running | succeeded | failed | cancelled
    progress: float
    message: str | None
    input: dict[str, Any]
    result: dict[str, Any] | None
    error: str | None
    created_at: float
    updated_at: float

    @property
    def finished(self) -> bool:
        return self.status not in ACTIVE

    def public(self) -> dict:
        return asdict(self)


@dataclass
class JobEvent:
    seq: int
    type: str
    data: dict[str, Any]
    at: float


@dataclass
class CustomVoice:
    id: str
    name: str
    language: str
    duration_s: float
    consent: str
    created_at: float
    consent_by: str = ""

    def public(self) -> dict:
        return asdict(self)


@dataclass
class DesignedVoice:
    id: str
    name: str
    recipe: str
    description: str
    language: str
    gender: str | None
    speed: float
    created_at: float

    def public(self) -> dict:
        return asdict(self)


@dataclass
class VoiceMeta:
    favorite: bool = False
    tags: list[str] = field(default_factory=list)


class Store:
    def __init__(self, path: Path):
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA foreign_keys=ON")
        self._lock = threading.Lock()
        self._migrate()

    def _migrate(self) -> None:
        version = self._db.execute("PRAGMA user_version").fetchone()[0]
        for i, script in enumerate(MIGRATIONS[version:], start=version + 1):
            self._db.executescript(f"BEGIN; {script}; PRAGMA user_version = {i}; COMMIT;")

    def add_take(self, *, take_id: str, engine: str, voice: str, text: str, duration_s: float) -> Take:
        take = Take(take_id, engine, voice, text, duration_s, False, time.time())
        with self._lock:
            self._db.execute(
                "INSERT INTO takes VALUES (?,?,?,?,?,?,?)",
                (take.id, engine, voice, text, duration_s, 0, take.created_at),
            )
        return take

    def get_take(self, take_id: str) -> Take | None:
        row = self._db.execute("SELECT * FROM takes WHERE id = ?", (take_id,)).fetchone()
        return _take(row) if row else None

    def list_takes(self, limit: int = 50) -> list[Take]:
        rows = self._db.execute("SELECT * FROM takes ORDER BY created_at DESC LIMIT ?", (limit,))
        return [_take(r) for r in rows]

    # --- jobs -------------------------------------------------------------

    def add_job(self, job: Job) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (job.id, job.kind, job.title, job.status, job.progress, job.message,
                 json.dumps(job.input), None, None, job.created_at, job.updated_at),
            )

    def update_job(self, job_id: str, **fields: Any) -> Job | None:
        fields["updated_at"] = time.time()
        for key in ("input", "result"):
            if key in fields and fields[key] is not None:
                fields[key] = json.dumps(fields[key])
        cols = ", ".join(f"{k} = ?" for k in fields)
        with self._lock:
            self._db.execute(f"UPDATE jobs SET {cols} WHERE id = ?", (*fields.values(), job_id))
        return self.get_job(job_id)

    def get_job(self, job_id: str) -> Job | None:
        row = self._db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return _job(row) if row else None

    def list_jobs(self, limit: int = 50) -> list[Job]:
        rows = self._db.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,))
        return [_job(r) for r in rows]

    def delete_finished_jobs(self) -> int:
        with self._lock:
            cur = self._db.execute(f"DELETE FROM jobs WHERE status NOT IN {ACTIVE}")
        return cur.rowcount

    def fail_interrupted_jobs(self) -> int:
        """Jobs that were active when voxd last stopped can't resume; mark them failed."""
        with self._lock:
            cur = self._db.execute(
                f"UPDATE jobs SET status = 'failed', error = 'Interrupted: VoxStudio was closed while this was running', "
                f"updated_at = ? WHERE status IN {ACTIVE}",
                (time.time(),),
            )
        return cur.rowcount

    def add_job_event(self, job_id: str, type_: str, data: dict[str, Any]) -> JobEvent:
        with self._lock:
            seq = self._db.execute(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM job_events WHERE job_id = ?", (job_id,)
            ).fetchone()[0]
            event = JobEvent(seq, type_, data, time.time())
            self._db.execute(
                "INSERT INTO job_events VALUES (?,?,?,?,?)", (job_id, seq, type_, json.dumps(data), event.at)
            )
        return event

    def job_events(self, job_id: str, after: int = 0) -> list[JobEvent]:
        rows = self._db.execute(
            "SELECT seq, type, data, at FROM job_events WHERE job_id = ? AND seq > ? ORDER BY seq", (job_id, after)
        )
        return [JobEvent(r["seq"], r["type"], json.loads(r["data"]), r["at"]) for r in rows]

    # --- settings -----------------------------------------------------------

    def get_setting(self, key: str, default: Any = None) -> Any:
        row = self._db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set_setting(self, key: str, value: Any) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value)),
            )

    # --- custom voices --------------------------------------------------------

    def add_custom_voice(self, voice: CustomVoice) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO custom_voices VALUES (?,?,?,?,?,?,?)",
                (voice.id, voice.name, voice.language, voice.duration_s, voice.consent, voice.created_at, voice.consent_by),
            )

    def list_custom_voices(self) -> list[CustomVoice]:
        rows = self._db.execute("SELECT * FROM custom_voices ORDER BY created_at DESC")
        return [CustomVoice(**dict(r)) for r in rows]

    def get_custom_voice(self, voice_id: str) -> CustomVoice | None:
        row = self._db.execute("SELECT * FROM custom_voices WHERE id = ?", (voice_id,)).fetchone()
        return CustomVoice(**dict(row)) if row else None

    def rename_custom_voice(self, voice_id: str, name: str) -> CustomVoice | None:
        with self._lock:
            self._db.execute("UPDATE custom_voices SET name = ? WHERE id = ?", (name, voice_id))
        return self.get_custom_voice(voice_id)

    def delete_custom_voice(self, voice_id: str) -> bool:
        with self._lock:
            return self._db.execute("DELETE FROM custom_voices WHERE id = ?", (voice_id,)).rowcount > 0

    # --- designed voices ----------------------------------------------------

    def add_designed_voice(self, v: DesignedVoice) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO designed_voices VALUES (?,?,?,?,?,?,?,?)",
                (v.id, v.name, v.recipe, v.description, v.language, v.gender, v.speed, v.created_at),
            )

    def list_designed_voices(self) -> list[DesignedVoice]:
        return [DesignedVoice(**dict(r)) for r in self._db.execute("SELECT * FROM designed_voices ORDER BY created_at DESC")]

    def get_designed_voice(self, voice_id: str) -> DesignedVoice | None:
        row = self._db.execute("SELECT * FROM designed_voices WHERE id = ?", (voice_id,)).fetchone()
        return DesignedVoice(**dict(row)) if row else None

    def rename_designed_voice(self, voice_id: str, name: str) -> DesignedVoice | None:
        with self._lock:
            self._db.execute("UPDATE designed_voices SET name = ? WHERE id = ?", (name, voice_id))
        return self.get_designed_voice(voice_id)

    def delete_designed_voice(self, voice_id: str) -> bool:
        with self._lock:
            return self._db.execute("DELETE FROM designed_voices WHERE id = ?", (voice_id,)).rowcount > 0

    # --- favorites & tags (any voice) ----------------------------------------

    def voice_meta(self) -> dict[tuple[str, str], VoiceMeta]:
        rows = self._db.execute("SELECT engine, voice_id, favorite, tags FROM voice_meta")
        return {(r["engine"], r["voice_id"]): VoiceMeta(bool(r["favorite"]), json.loads(r["tags"])) for r in rows}

    def set_voice_meta(self, engine: str, voice_id: str, favorite: bool | None, tags: list[str] | None) -> VoiceMeta:
        current = self.voice_meta().get((engine, voice_id), VoiceMeta())
        meta = VoiceMeta(current.favorite if favorite is None else favorite, current.tags if tags is None else tags)
        with self._lock:
            self._db.execute(
                "INSERT INTO voice_meta VALUES (?,?,?,?) ON CONFLICT(engine, voice_id) "
                "DO UPDATE SET favorite = excluded.favorite, tags = excluded.tags",
                (engine, voice_id, int(meta.favorite), json.dumps(meta.tags)),
            )
        return meta

    def delete_voice_meta(self, engine: str, voice_id: str) -> None:
        with self._lock:
            self._db.execute("DELETE FROM voice_meta WHERE engine = ? AND voice_id = ?", (engine, voice_id))

    def set_take_starred(self, take_id: str, starred: bool) -> Take | None:
        with self._lock:
            self._db.execute("UPDATE takes SET starred = ? WHERE id = ?", (int(starred), take_id))
        return self.get_take(take_id)

    def close(self) -> None:
        self._db.close()


def _take(row: sqlite3.Row) -> Take:
    return Take(**{**dict(row), "starred": bool(row["starred"])})


def _job(row: sqlite3.Row) -> Job:
    d = dict(row)
    d["input"] = json.loads(d["input"])
    d["result"] = json.loads(d["result"]) if d["result"] else None
    return Job(**d)
