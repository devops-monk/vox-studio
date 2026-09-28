"""Stories and audiobooks: import documents, find chapters and speaking characters, render chapter
by chapter (resumable), and export M4B (with chapter markers) or MP3.

Everything here is standard-library parsing; audio encoding runs in the media worker.
"""

from __future__ import annotations

import hashlib
import html
import io
import json
import re
import uuid
import wave
import zipfile
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any
from xml.etree import ElementTree as ET

import numpy as np

from .engines.base import EngineError
from .speech import split_text

if TYPE_CHECKING:
    from .app import Services
    from .jobs import JobContext

BOOK_RATE = 24000
PARAGRAPH_PAUSE_S = 0.45
CHAPTER_LEAD_S = 0.6
MAX_IMPORT_BYTES = 50 * 1024 * 1024

# ------------------------------------------------------------------ import


@dataclass
class Imported:
    title: str
    author: str
    chapters: list[dict[str, str]]  # {title, text}


_CHAPTER_LINE = re.compile(
    r"^\s*(?:(?:chapter|chap\.|chapitre|cap[ií]tulo|kapitel|part|book)\s+(?:[0-9]+|[ivxlcdm]+|[a-z]+(?:[- ][a-z]+)?)\b.*|prologue|epilogue)\s*$",
    re.IGNORECASE,
)


def _clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = [re.sub(r"[ \t]+", " ", p).strip() for p in re.split(r"\n\s*\n", text)]
    return "\n\n".join(p.replace("\n", " ") for p in paragraphs if p)


def _split_plain(text: str, markdown: bool) -> list[dict[str, str]]:
    chapters: list[dict[str, str]] = []
    title, buf = None, []

    def flush() -> None:
        body = _clean("\n".join(buf))
        if body:
            chapters.append({"title": title or f"Chapter {len(chapters) + 1}", "text": body})

    for line in text.replace("\r\n", "\n").split("\n"):
        heading = re.match(r"^(#{1,2})\s+(.+?)\s*#*\s*$", line) if markdown else None
        if heading or (_CHAPTER_LINE.match(line) and len(line) < 80):
            flush()
            title = (heading.group(2) if heading else line).strip()
            buf = []
        else:
            buf.append(line)
    flush()
    return chapters


def _docx(data: bytes) -> Imported:
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        root = ET.fromstring(z.read("word/document.xml"))
        try:
            core = ET.fromstring(z.read("docProps/core.xml"))
            title = next((e.text for e in core.iter() if e.tag.endswith("}title") and e.text), "")
            author = next((e.text for e in core.iter() if e.tag.endswith("}creator") and e.text), "")
        except KeyError:
            title = author = ""
    chapters: list[dict[str, str]] = []
    heading, paras = None, []
    for p in root.iter(f"{{{ns['w']}}}p"):
        style = p.find("w:pPr/w:pStyle", ns)
        text = "".join(t.text or "" for t in p.iter(f"{{{ns['w']}}}t")).strip()
        if not text:
            continue
        is_heading = style is not None and re.match(r"(Heading1|Heading2|Title|heading 1)", style.get(f"{{{ns['w']}}}val", ""), re.I)
        if is_heading:
            if paras:
                chapters.append({"title": heading or f"Chapter {len(chapters) + 1}", "text": "\n\n".join(paras)})
            heading, paras = text, []
        else:
            paras.append(re.sub(r"\s+", " ", text))
    if paras:
        chapters.append({"title": heading or f"Chapter {len(chapters) + 1}", "text": "\n\n".join(paras)})
    return Imported(title, author, chapters)


class _Html(HTMLParser):
    BLOCKS = {"p", "div", "br", "h1", "h2", "h3", "h4", "li", "blockquote", "section", "tr"}

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.heading: str | None = None
        self._in: str | None = None
        self._skip = 0

    def handle_starttag(self, tag, attrs):  # noqa: ANN001
        if tag in ("script", "style", "head"):
            self._skip += 1
        if tag in self.BLOCKS:
            self.parts.append("\n\n")
        if tag in ("h1", "h2") and self.heading is None:
            self._in = tag
            self.heading = ""

    def handle_endtag(self, tag):  # noqa: ANN001
        if tag in ("script", "style", "head"):
            self._skip = max(0, self._skip - 1)
        if tag == self._in:
            self._in = None
        if tag in self.BLOCKS:
            self.parts.append("\n\n")

    def handle_data(self, data):  # noqa: ANN001
        if self._skip:
            return
        self.parts.append(data)
        if self._in is not None and self.heading is not None:
            self.heading += data


def _epub(data: bytes) -> Imported:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        container = ET.fromstring(z.read("META-INF/container.xml"))
        opf_path = next(e.get("full-path") for e in container.iter() if e.tag.split("}")[-1] == "rootfile")
        opf = ET.fromstring(z.read(opf_path))
        base = PurePosixPath(opf_path).parent
        meta = {e.tag.split("}")[-1]: (e.text or "").strip() for e in opf.iter() if "purl.org/dc" in e.tag}
        local = lambda e: e.tag.split("}")[-1]  # noqa: E731  (namespaced or not)
        manifest = {e.get("id"): e.get("href") for e in opf.iter() if local(e) == "item"}
        spine = [e.get("idref") for e in opf.iter() if local(e) == "itemref"]
        chapters = []
        for idref in spine:
            href = manifest.get(idref)
            if not href:
                continue
            path = str(base / href) if str(base) != "." else href
            try:
                doc = z.read(path.split("#")[0]).decode("utf-8", "replace")
            except KeyError:
                continue
            parser = _Html()
            parser.feed(doc)
            text = _clean(html.unescape("".join(parser.parts)))
            if len(text) < 200:  # cover pages, tables of contents, copyright notices
                continue
            title = (parser.heading or "").strip() or f"Chapter {len(chapters) + 1}"
            if parser.heading and text.startswith(parser.heading.strip()):
                text = text[len(parser.heading.strip()) :].lstrip()
            chapters.append({"title": re.sub(r"\s+", " ", title)[:120], "text": text})
    return Imported(meta.get("title", ""), meta.get("creator", ""), chapters)


def import_document(filename: str, data: bytes) -> Imported:
    if len(data) > MAX_IMPORT_BYTES:
        raise EngineError("That file is too large (max 50 MB)")
    ext = Path(filename).suffix.lower()
    try:
        if ext == ".epub":
            result = _epub(data)
        elif ext == ".docx":
            result = _docx(data)
        elif ext in (".txt", ".md", ".markdown", ".text", ""):
            text = data.decode("utf-8-sig", errors="replace")
            result = Imported("", "", _split_plain(text, markdown=ext in (".md", ".markdown")))
        else:
            raise EngineError("Import a .txt, .md, .docx or .epub file")
    except (zipfile.BadZipFile, KeyError, ET.ParseError, StopIteration) as exc:
        raise EngineError(f"Couldn't read that {ext or 'file'} — is it damaged?") from exc
    if not result.chapters:
        raise EngineError("No text was found in that file")
    result.title = result.title or Path(filename).stem.replace("_", " ").strip() or "Untitled"
    return result


# ------------------------------------------------------------------ dialogue & characters

_QUOTE = re.compile(r"[\"“]([^\"”]{2,600})[\"”]")
_VERBS = r"(?:said|asked|replied|shouted|whispered|cried|answered|called|added|muttered|exclaimed|yelled|laughed|sighed|continued|began|told)"
_NAME = r"([A-Z][a-z]+(?: [A-Z][a-z]+)?)"
_AFTER = re.compile(rf"^\s*,?\s*(?:{_NAME}\s+{_VERBS}|{_VERBS}\s+{_NAME})\b")
_BEFORE = re.compile(rf"{_NAME}\s+{_VERBS}\s*[,:]?\s*$")
_NOT_NAMES = {"He", "She", "They", "I", "We", "You", "It", "His", "Her", "Their", "The", "A", "An", "Then", "But", "And", "Mr", "Mrs", "Ms", "Dr"}


def _speaker_near(before: str, after: str) -> str | None:
    if m := _AFTER.match(after):
        name = m.group(1) or m.group(2)
    elif m := _BEFORE.search(before[-80:]):
        name = m.group(1)
    else:
        return None
    return None if name.split()[0] in _NOT_NAMES else name


def segment_paragraph(paragraph: str) -> list[dict[str, Any]]:
    """Split a paragraph into narration and dialogue parts; dialogue gets a speaker when the text says who."""
    parts, pos = [], 0
    quotes = list(_QUOTE.finditer(paragraph))
    speakers = [_speaker_near(paragraph[: q.start()], paragraph[q.end() :]) for q in quotes]
    # One attribution usually covers every quote in the paragraph ("Hi," said Ann. "Come in.").
    fallback = next((s for s in speakers if s), None)
    for q, who in zip(quotes, speakers):
        if q.start() > pos:
            parts.append({"kind": "narration", "text": paragraph[pos : q.start()]})
        parts.append({"kind": "dialogue", "text": q.group(1), "speaker": who or fallback, "start": q.start(1)})
        pos = q.end()
    if pos < len(paragraph):
        parts.append({"kind": "narration", "text": paragraph[pos:]})
    return [p for p in parts if p["text"].strip(" ,.;:—-")]


def find_characters(chapters: list[dict]) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for ch in chapters:
        for para in ch["text"].split("\n\n"):
            for part in segment_paragraph(para):
                if part.get("speaker"):
                    counts[part["speaker"]] = counts.get(part["speaker"], 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])[:12]
    return [{"name": n, "lines": c} for n, c in ranked]


# ------------------------------------------------------------------ rendering


def book_dir(services: Services, book_id: str) -> Path:
    d = services.settings.data_dir / "books" / book_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def chapter_fingerprint(chapter: dict, kind: str, cast: dict, speed: float) -> str:
    blob = json.dumps([chapter["title"], chapter["text"], kind, cast, speed], sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _voice_for(part: dict, kind: str, cast: dict) -> dict:
    narrator = cast.get("narrator") or {}
    if kind == "story" and part["kind"] == "dialogue" and part.get("speaker"):
        return (cast.get("characters") or {}).get(part["speaker"]) or narrator
    return narrator


def _to_rate(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        rate, ch = w.getframerate(), w.getnchannels()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    if rate != BOOK_RATE and len(x):
        x = np.interp(np.linspace(0, len(x) - 1, int(len(x) * BOOK_RATE / rate)), np.arange(len(x)), x).astype(np.float32)
    return x


def render_chapter(services: Services, ctx: JobContext, book: Any, chapter: dict, progress: tuple[float, float]) -> dict:
    """Speak one chapter; returns {file, duration_s, timings: [{start, end, from, to}]} (char offsets in chapter text)."""
    folder = book_dir(services, book.id)
    scratch = folder / "tmp"
    scratch.mkdir(exist_ok=True)
    text = chapter["text"]
    units: list[tuple[str, dict, int, str | None]] = []  # (sentence, voice, char offset, speaker)
    offset = 0
    for para in text.split("\n\n"):
        para_at = text.find(para, offset)
        for part in segment_paragraph(para) or [{"kind": "narration", "text": para}]:
            voice = _voice_for(part, book.kind, book.cast)
            search_from = para_at
            who = part.get("speaker") if part["kind"] == "dialogue" else None
            for sentence in split_text(part["text"], limit=280):
                at = text.find(sentence, search_from)
                at = at if at >= 0 else para_at
                units.append((sentence, voice, at, who))
                search_from = at + len(sentence)
        units.append(("\n\n", {}, para_at + len(para), None))  # paragraph break marker
        offset = para_at + len(para)

    pieces: list[np.ndarray] = [np.zeros(int(CHAPTER_LEAD_S * BOOK_RATE), dtype=np.float32)]
    timings, clock = [], CHAPTER_LEAD_S
    spoken = [u for u in units if u[0] != "\n\n"]
    done = 0
    lo, hi = progress
    for sentence, voice, at, who in units:
        if sentence == "\n\n":
            pieces.append(np.zeros(int(PARAGRAPH_PAUSE_S * BOOK_RATE), dtype=np.float32))
            clock += PARAGRAPH_PAUSE_S
            continue
        ctx.check()
        if not voice.get("engine") or not voice.get("voice"):
            raise EngineError("Choose a narrator voice first")
        out = scratch / f"{uuid.uuid4().hex}.wav"
        services.registry.get(voice["engine"]).synthesize(sentence, voice["voice"], book.speed, out)
        audio = _to_rate(out)
        out.unlink(missing_ok=True)
        timings.append(
            {"start": round(clock, 3), "end": round(clock + len(audio) / BOOK_RATE, 3), "from": at, "to": at + len(sentence), "speaker": who}
        )
        pieces.append(audio)
        clock += len(audio) / BOOK_RATE
        done += 1
        ctx.progress(lo + (hi - lo) * done / max(1, len(spoken)), f"{chapter['title']}: sentence {done} of {len(spoken)}")

    track = np.concatenate(pieces)
    name = f"chapter-{chapter['id']}.wav"
    with wave.open(str(folder / name), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(BOOK_RATE)
        w.writeframes((np.clip(track, -1, 1) * 32767).astype("<i2").tobytes())
    return {"file": name, "duration_s": round(len(track) / BOOK_RATE, 2), "timings": timings}


def render_book(services: Services, ctx: JobContext, spec: dict[str, Any]) -> dict[str, Any]:
    """Render the requested chapters (default: all), skipping ones already rendered and unchanged — so an
    interrupted render resumes where it stopped."""
    book = services.store.get_book(spec["book_id"])
    if book is None:
        raise EngineError("This book was deleted")
    wanted = spec.get("chapters") or [c["id"] for c in book.chapters]
    todo = [
        c for c in book.chapters
        if c["id"] in wanted and (c.get("render") or {}).get("fingerprint") != chapter_fingerprint(c, book.kind, book.cast, book.speed)
    ]
    rendered = 0
    for i, chapter in enumerate(todo):
        ctx.check()
        span = (i / max(1, len(todo)), (i + 1) / max(1, len(todo)))
        result = render_chapter(services, ctx, book, chapter, span)
        result["fingerprint"] = chapter_fingerprint(chapter, book.kind, book.cast, book.speed)
        # Re-read so edits made while rendering other chapters aren't lost.
        fresh = services.store.get_book(book.id)
        if fresh is None:
            raise EngineError("This book was deleted")
        chapters = [{**c, "render": result} if c["id"] == chapter["id"] else c for c in fresh.chapters]
        services.store.update_book(book.id, chapters=chapters)
        services.bus.publish("books.changed", {"id": book.id})
        rendered += 1
    return {"book_id": book.id, "rendered": rendered, "skipped": len(wanted) - len(todo)}


def export_book(services: Services, ctx: JobContext, spec: dict[str, Any]) -> dict[str, Any]:
    book = services.store.get_book(spec["book_id"])
    if book is None:
        raise EngineError("This book was deleted")
    folder = book_dir(services, book.id)
    parts = [c for c in book.chapters if c.get("render")]
    if len(parts) != len(book.chapters):
        raise EngineError("Render every chapter before exporting the whole book")
    fmt = spec["format"]
    ctx.progress(0.05, f"Encoding {fmt.upper()}")
    name = f"book.{fmt}"
    services.media.call(
        "encode_book",
        wavs=[str(folder / c["render"]["file"]) for c in parts],
        titles=[c["title"] for c in parts],
        out=str(folder / name),
        format=fmt,
        title=book.title,
        author=book.author,
    )
    services.store.update_book(book.id, exports={**book.exports, fmt: name})
    services.bus.publish("books.changed", {"id": book.id})
    return {"book_id": book.id, "format": fmt, "file": name}
