"""SQLite persistence. Schema changes are appended to MIGRATIONS, never edited."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
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
    """
    CREATE TABLE transcripts (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        source      TEXT NOT NULL,
        language    TEXT NOT NULL,
        duration_s  REAL NOT NULL,
        model       TEXT NOT NULL,
        text        TEXT NOT NULL,
        segments    TEXT NOT NULL,
        audio       TEXT NOT NULL,
        created_at  REAL NOT NULL
    );
    CREATE INDEX transcripts_created ON transcripts(created_at DESC);
    """,
    """
    CREATE TABLE dubs (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL,
        status       TEXT NOT NULL,
        source_file  TEXT NOT NULL,
        has_video    INTEGER NOT NULL,
        duration_s   REAL NOT NULL,
        source_lang  TEXT NOT NULL,
        target_lang  TEXT NOT NULL,
        mix          TEXT NOT NULL,
        segments     TEXT NOT NULL,
        cast_json    TEXT NOT NULL,
        output       TEXT NOT NULL,
        error        TEXT,
        created_at   REAL NOT NULL,
        updated_at   REAL NOT NULL
    );
    CREATE INDEX dubs_created ON dubs(created_at DESC);
    """,
    """
    CREATE TABLE books (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        author      TEXT NOT NULL,
        kind        TEXT NOT NULL,
        language    TEXT NOT NULL,
        speed       REAL NOT NULL,
        chapters    TEXT NOT NULL,
        cast_json   TEXT NOT NULL,
        characters  TEXT NOT NULL,
        exports     TEXT NOT NULL,
        created_at  REAL NOT NULL,
        updated_at  REAL NOT NULL
    );
    """,
    """
    CREATE TABLE batches (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        title       TEXT NOT NULL,
        options     TEXT NOT NULL,
        output_dir  TEXT,
        job_ids     TEXT NOT NULL,
        created_at  REAL NOT NULL
    );
    CREATE TABLE watch_folders (
        id          TEXT PRIMARY KEY,
        path        TEXT NOT NULL UNIQUE,
        action      TEXT NOT NULL,
        options     TEXT NOT NULL,
        enabled     INTEGER NOT NULL,
        created_at  REAL NOT NULL
    );
    CREATE TABLE watch_files (
        watch_id  TEXT NOT NULL REFERENCES watch_folders(id) ON DELETE CASCADE,
        path      TEXT NOT NULL,
        state     TEXT NOT NULL,
        output    TEXT,
        error     TEXT,
        at        REAL NOT NULL,
        PRIMARY KEY (watch_id, path)
    );
    """,
    """
    CREATE TABLE projects (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        color        TEXT NOT NULL,
        description  TEXT NOT NULL,
        created_at   REAL NOT NULL,
        updated_at   REAL NOT NULL
    );
    CREATE TABLE project_items (
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,
        item_id     TEXT NOT NULL,
        added_at    REAL NOT NULL,
        PRIMARY KEY (project_id, kind, item_id)
    );
    CREATE TABLE exports (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        item_id     TEXT NOT NULL,
        title       TEXT NOT NULL,
        format      TEXT NOT NULL,
        path        TEXT NOT NULL,
        bytes       INTEGER NOT NULL,
        at          REAL NOT NULL
    );
    CREATE INDEX exports_at ON exports(at DESC);
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
class Transcript:
    id: str
    title: str
    source: str  # file | live
    language: str
    duration_s: float
    model: str
    text: str
    segments: list[dict]
    audio: str  # file name under uploads/, or "" when no audio was kept
    created_at: float


@dataclass
class Dub:
    id: str
    title: str
    status: str  # preparing | ready | rendering | done | failed
    source_file: str
    has_video: bool
    duration_s: float
    source_lang: str
    target_lang: str
    mix: str  # replace | duck
    segments: list[dict]  # {id, start, end, text, translation, speaker, fit?}
    cast: dict[str, dict]  # speaker → {engine, voice}
    output: dict  # {audio?, video?, rendered_at?}
    error: str | None
    created_at: float
    updated_at: float


_DUB_JSON = {"segments": "segments", "cast": "cast_json", "output": "output"}


@dataclass
class Book:
    id: str
    title: str
    author: str
    kind: str  # audiobook (one narrator) | story (narrator + character voices)
    language: str
    speed: float
    chapters: list[dict]  # {id, title, text, render?: {file, duration_s, timings, fingerprint}}
    cast: dict  # {narrator: {engine, voice}, characters: {name: {engine, voice} | None}}
    characters: list[dict]  # detected: {name, lines}
    exports: dict  # {m4b?: file, mp3?: file}
    created_at: float
    updated_at: float


_BOOK_JSON = {"chapters": "chapters", "cast": "cast_json", "characters": "characters", "exports": "exports"}


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

    def list_takes(
        self,
        limit: int = 50,
        *,
        query: str | None = None,
        engine: str | None = None,
        voice: str | None = None,
        starred: bool | None = None,
        before: float | None = None,
    ) -> list[Take]:
        where, args = [], []
        if query:
            where.append("text LIKE ? ESCAPE '\\'")
            args.append("%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        if engine:
            where.append("engine = ?")
            args.append(engine)
        if voice:
            where.append("voice = ?")
            args.append(voice)
        if starred is not None:
            where.append("starred = ?")
            args.append(int(starred))
        if before is not None:
            where.append("created_at < ?")
            args.append(before)
        sql = "SELECT * FROM takes" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY created_at DESC LIMIT ?"
        return [_take(r) for r in self._db.execute(sql, (*args, limit))]

    def delete_takes(self, ids: list[str]) -> list[str]:
        """Delete takes by id; returns the ids that existed."""
        if not ids:
            return []
        marks = ",".join("?" * len(ids))
        with self._lock:
            found = [r[0] for r in self._db.execute(f"SELECT id FROM takes WHERE id IN ({marks})", ids)]
            self._db.execute(f"DELETE FROM takes WHERE id IN ({marks})", ids)
        return found

    def expired_takes(self, older_than: float) -> list[str]:
        """Unstarred takes created before ``older_than`` (unix seconds)."""
        rows = self._db.execute("SELECT id FROM takes WHERE starred = 0 AND created_at < ?", (older_than,))
        return [r[0] for r in rows]

    def take_counts(self) -> tuple[int, int]:
        row = self._db.execute("SELECT COUNT(*), COALESCE(SUM(starred), 0) FROM takes").fetchone()
        return row[0], row[1]

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

    # --- transcripts --------------------------------------------------------

    def add_transcript(self, t: Transcript) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO transcripts VALUES (?,?,?,?,?,?,?,?,?,?)",
                (t.id, t.title, t.source, t.language, t.duration_s, t.model, t.text, json.dumps(t.segments), t.audio, t.created_at),
            )

    def list_transcripts(self, limit: int = 100, query: str | None = None) -> list[Transcript]:
        sql, args = "SELECT * FROM transcripts", []
        if query:
            sql += " WHERE title LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\'"
            like = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            args = [like, like]
        rows = self._db.execute(sql + " ORDER BY created_at DESC LIMIT ?", (*args, limit))
        return [_transcript(r) for r in rows]

    def get_transcript(self, transcript_id: str) -> Transcript | None:
        row = self._db.execute("SELECT * FROM transcripts WHERE id = ?", (transcript_id,)).fetchone()
        return _transcript(row) if row else None

    def update_transcript(self, transcript_id: str, **fields: Any) -> Transcript | None:
        if "segments" in fields:
            fields["segments"] = json.dumps(fields["segments"])
        cols = ", ".join(f"{k} = ?" for k in fields)
        with self._lock:
            self._db.execute(f"UPDATE transcripts SET {cols} WHERE id = ?", (*fields.values(), transcript_id))
        return self.get_transcript(transcript_id)

    def delete_transcript(self, transcript_id: str) -> Transcript | None:
        t = self.get_transcript(transcript_id)
        if t:
            with self._lock:
                self._db.execute("DELETE FROM transcripts WHERE id = ?", (transcript_id,))
        return t

    # --- dubs ---------------------------------------------------------------

    def add_dub(self, d: Dub) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO dubs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (d.id, d.title, d.status, d.source_file, int(d.has_video), d.duration_s, d.source_lang, d.target_lang, d.mix,
                 json.dumps(d.segments), json.dumps(d.cast), json.dumps(d.output), d.error, d.created_at, d.updated_at),
            )

    def get_dub(self, dub_id: str) -> Dub | None:
        row = self._db.execute("SELECT * FROM dubs WHERE id = ?", (dub_id,)).fetchone()
        return _dub(row) if row else None

    def list_dubs(self, limit: int = 100) -> list[Dub]:
        return [_dub(r) for r in self._db.execute("SELECT * FROM dubs ORDER BY created_at DESC LIMIT ?", (limit,))]

    def update_dub(self, dub_id: str, **fields: Any) -> Dub | None:
        fields["updated_at"] = time.time()
        cols, vals = [], []
        for key, value in fields.items():
            col = _DUB_JSON.get(key, key)
            cols.append(f"{col} = ?")
            vals.append(json.dumps(value) if key in _DUB_JSON else int(value) if isinstance(value, bool) else value)
        with self._lock:
            self._db.execute(f"UPDATE dubs SET {', '.join(cols)} WHERE id = ?", (*vals, dub_id))
        return self.get_dub(dub_id)

    def delete_dub(self, dub_id: str) -> Dub | None:
        d = self.get_dub(dub_id)
        if d:
            with self._lock:
                self._db.execute("DELETE FROM dubs WHERE id = ?", (dub_id,))
        return d

    # --- books --------------------------------------------------------------

    def add_book(self, b: Book) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO books VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (b.id, b.title, b.author, b.kind, b.language, b.speed, json.dumps(b.chapters), json.dumps(b.cast),
                 json.dumps(b.characters), json.dumps(b.exports), b.created_at, b.updated_at),
            )

    def get_book(self, book_id: str) -> Book | None:
        row = self._db.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
        return _book(row) if row else None

    def list_books(self, kind: str | None = None) -> list[Book]:
        sql, args = "SELECT * FROM books", ()
        if kind:
            sql, args = sql + " WHERE kind = ?", (kind,)
        return [_book(r) for r in self._db.execute(sql + " ORDER BY updated_at DESC", args)]

    def update_book(self, book_id: str, **fields: Any) -> Book | None:
        fields["updated_at"] = time.time()
        cols, vals = [], []
        for key, value in fields.items():
            cols.append(f"{_BOOK_JSON.get(key, key)} = ?")
            vals.append(json.dumps(value) if key in _BOOK_JSON else value)
        with self._lock:
            self._db.execute(f"UPDATE books SET {', '.join(cols)} WHERE id = ?", (*vals, book_id))
        return self.get_book(book_id)

    def delete_book(self, book_id: str) -> bool:
        with self._lock:
            return self._db.execute("DELETE FROM books WHERE id = ?", (book_id,)).rowcount > 0

    # --- batches ----------------------------------------------------------------

    def add_batch(self, b: dict) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO batches VALUES (?,?,?,?,?,?,?)",
                (b["id"], b["kind"], b["title"], json.dumps(b["options"]), b["output_dir"], json.dumps(b["job_ids"]), b["created_at"]),
            )

    def list_batches(self, limit: int = 50) -> list[dict]:
        return [_batch(r) for r in self._db.execute("SELECT * FROM batches ORDER BY created_at DESC LIMIT ?", (limit,))]

    def get_batch(self, batch_id: str) -> dict | None:
        row = self._db.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)).fetchone()
        return _batch(row) if row else None

    def delete_batch(self, batch_id: str) -> bool:
        with self._lock:
            return self._db.execute("DELETE FROM batches WHERE id = ?", (batch_id,)).rowcount > 0

    # --- watch folders ------------------------------------------------------------

    def list_watch_folders(self) -> list[dict]:
        return [_watch(r) for r in self._db.execute("SELECT * FROM watch_folders ORDER BY created_at")]

    def get_watch_folder(self, watch_id: str) -> dict | None:
        row = self._db.execute("SELECT * FROM watch_folders WHERE id = ?", (watch_id,)).fetchone()
        return _watch(row) if row else None

    def add_watch_folder(self, w: dict) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO watch_folders VALUES (?,?,?,?,?,?)",
                (w["id"], w["path"], w["action"], json.dumps(w["options"]), int(w["enabled"]), w["created_at"]),
            )

    def update_watch_folder(self, watch_id: str, **fields: Any) -> dict | None:
        if "options" in fields:
            fields["options"] = json.dumps(fields["options"])
        if "enabled" in fields:
            fields["enabled"] = int(fields["enabled"])
        cols = ", ".join(f"{k} = ?" for k in fields)
        with self._lock:
            self._db.execute(f"UPDATE watch_folders SET {cols} WHERE id = ?", (*fields.values(), watch_id))
        return self.get_watch_folder(watch_id)

    def delete_watch_folder(self, watch_id: str) -> bool:
        with self._lock:
            return self._db.execute("DELETE FROM watch_folders WHERE id = ?", (watch_id,)).rowcount > 0

    def watch_seen(self, watch_id: str) -> set[str]:
        return {r[0] for r in self._db.execute("SELECT path FROM watch_files WHERE watch_id = ?", (watch_id,))}

    def mark_watch_seen(self, watch_id: str, path: str, error: str | None = None) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO watch_files VALUES (?,?,?,?,?,?)",
                (watch_id, path, "error" if error else "queued", None, error, time.time()),
            )

    def mark_watch_done(self, watch_id: str, path: str, output: str | None) -> None:
        with self._lock:
            self._db.execute(
                "UPDATE watch_files SET state = 'done', output = ?, at = ? WHERE watch_id = ? AND path = ?",
                (output, time.time(), watch_id, path),
            )

    def watch_files(self, watch_id: str, limit: int = 20) -> list[dict]:
        rows = self._db.execute(
            "SELECT path, state, output, error, at FROM watch_files WHERE watch_id = ? ORDER BY at DESC LIMIT ?", (watch_id, limit)
        )
        return [dict(r) for r in rows]

    # --- projects -----------------------------------------------------------------

    def add_project(self, p: dict) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO projects VALUES (?,?,?,?,?,?)",
                (p["id"], p["name"], p["color"], p["description"], p["created_at"], p["updated_at"]),
            )

    def list_projects(self) -> list[dict]:
        rows = self._db.execute(
            "SELECT p.*, (SELECT COUNT(*) FROM project_items i WHERE i.project_id = p.id) AS item_count "
            "FROM projects p ORDER BY p.updated_at DESC"
        )
        return [dict(r) for r in rows]

    def get_project(self, project_id: str) -> dict | None:
        row = self._db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return dict(row) if row else None

    def update_project(self, project_id: str, **fields: Any) -> dict | None:
        fields["updated_at"] = time.time()
        cols = ", ".join(f"{k} = ?" for k in fields)
        with self._lock:
            self._db.execute(f"UPDATE projects SET {cols} WHERE id = ?", (*fields.values(), project_id))
        return self.get_project(project_id)

    def delete_project(self, project_id: str) -> bool:
        with self._lock:
            return self._db.execute("DELETE FROM projects WHERE id = ?", (project_id,)).rowcount > 0

    def add_project_item(self, project_id: str, kind: str, item_id: str) -> None:
        with self._lock:
            self._db.execute("INSERT OR IGNORE INTO project_items VALUES (?,?,?,?)", (project_id, kind, item_id, time.time()))
            self._db.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (time.time(), project_id))

    def remove_project_item(self, project_id: str, kind: str, item_id: str) -> bool:
        with self._lock:
            return self._db.execute(
                "DELETE FROM project_items WHERE project_id = ? AND kind = ? AND item_id = ?", (project_id, kind, item_id)
            ).rowcount > 0

    def project_items(self, project_id: str) -> list[dict]:
        rows = self._db.execute("SELECT kind, item_id, added_at FROM project_items WHERE project_id = ? ORDER BY added_at DESC", (project_id,))
        return [dict(r) for r in rows]

    def projects_for(self, kind: str, item_id: str) -> list[str]:
        rows = self._db.execute("SELECT project_id FROM project_items WHERE kind = ? AND item_id = ?", (kind, item_id))
        return [r[0] for r in rows]

    # --- export history ----------------------------------------------------------------

    def record_export(self, kind: str, item_id: str, title: str, fmt: str, path: str, size: int) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO exports VALUES (?,?,?,?,?,?,?,?)",
                (uuid.uuid4().hex, kind, item_id, title, fmt, path, size, time.time()),
            )

    def list_exports(self, items: list[tuple[str, str]] | None = None, limit: int = 100) -> list[dict]:
        if items is None:
            rows = self._db.execute("SELECT * FROM exports ORDER BY at DESC LIMIT ?", (limit,))
            return [dict(r) for r in rows]
        if not items:
            return []
        marks = " OR ".join("(kind = ? AND item_id = ?)" for _ in items)
        rows = self._db.execute(f"SELECT * FROM exports WHERE {marks} ORDER BY at DESC LIMIT ?", (*[x for pair in items for x in pair], limit))
        return [dict(r) for r in rows]

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


def _transcript(row: sqlite3.Row) -> Transcript:
    d = dict(row)
    d["segments"] = json.loads(d["segments"])
    return Transcript(**d)


def _dub(row: sqlite3.Row) -> Dub:
    d = dict(row)
    return Dub(
        id=d["id"], title=d["title"], status=d["status"], source_file=d["source_file"], has_video=bool(d["has_video"]),
        duration_s=d["duration_s"], source_lang=d["source_lang"], target_lang=d["target_lang"], mix=d["mix"],
        segments=json.loads(d["segments"]), cast=json.loads(d["cast_json"]), output=json.loads(d["output"]),
        error=d["error"], created_at=d["created_at"], updated_at=d["updated_at"],
    )


def _book(row: sqlite3.Row) -> Book:
    d = dict(row)
    return Book(
        id=d["id"], title=d["title"], author=d["author"], kind=d["kind"], language=d["language"], speed=d["speed"],
        chapters=json.loads(d["chapters"]), cast=json.loads(d["cast_json"]), characters=json.loads(d["characters"]),
        exports=json.loads(d["exports"]), created_at=d["created_at"], updated_at=d["updated_at"],
    )


def _batch(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["options"] = json.loads(d["options"])
    d["job_ids"] = json.loads(d["job_ids"])
    return d


def _watch(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["options"] = json.loads(d["options"])
    d["enabled"] = bool(d["enabled"])
    return d
