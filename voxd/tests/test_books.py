import io
import shutil
import zipfile

import pytest
from fastapi.testclient import TestClient

from voxd.app import create_app
from voxd.books import find_characters, import_document, segment_paragraph
from voxd.config import Settings
from voxd.engines.registry import Registry

from test_api import TOKEN, FakeEngine
from test_jobs import wait_for

STORY = """Chapter One

Ann opened the door. "Who is there?" asked Ann.

"It's me," said Tom. "Let me in."

Chapter Two

The rain stopped. Tom smiled and said nothing.
"""


def make_docx(paragraphs):
    body = "".join(
        f'<w:p>{"<w:pPr><w:pStyle w:val=%sHeading1%s/></w:pPr>" % (chr(34), chr(34)) if h else ""}<w:r><w:t>{t}</w:t></w:r></w:p>'
        for h, t in paragraphs
    )
    doc = f'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", doc)
    return buf.getvalue()


def make_epub(chapters):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
        items = "".join(f'<item id="c{i}" href="c{i}.xhtml"/>' for i in range(len(chapters)))
        spine = "".join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
        z.writestr(
            "OEBPS/content.opf",
            '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>The Lighthouse</dc:title><dc:creator>A. Writer</dc:creator></metadata>'
            f"<manifest>{items}</manifest><spine>{spine}</spine></package>",
        )
        for i, (title, text) in enumerate(chapters):
            z.writestr(f"OEBPS/c{i}.xhtml", f"<html><head><title>x</title><style>p{{}}</style></head><body><h1>{title}</h1><p>{text}</p></body></html>")
    return buf.getvalue()


def test_plain_text_chapters():
    book = import_document("tale.txt", STORY.encode())
    assert book.title == "tale"
    assert [c["title"] for c in book.chapters] == ["Chapter One", "Chapter Two"]
    assert book.chapters[0]["text"].startswith("Ann opened the door.")


def test_markdown_headings():
    book = import_document("notes.md", b"# Intro\n\nHello there.\n\n## Part 2\n\nMore text.\n")
    assert [(c["title"], c["text"]) for c in book.chapters] == [("Intro", "Hello there."), ("Part 2", "More text.")]


def test_docx_headings():
    data = make_docx([(True, "Beginning"), (False, "First paragraph."), (False, "Second."), (True, "End"), (False, "Last.")])
    book = import_document("book.docx", data)
    assert [c["title"] for c in book.chapters] == ["Beginning", "End"]
    assert book.chapters[0]["text"] == "First paragraph.\n\nSecond."


def test_epub_spine_and_metadata():
    long = "Waves crashed against the rocks all night long. " * 8
    data = make_epub([("Cover", "tiny"), ("The Storm", long), ("Morning", long)])
    book = import_document("lighthouse.epub", data)
    assert (book.title, book.author) == ("The Lighthouse", "A. Writer")
    assert [c["title"] for c in book.chapters] == ["The Storm", "Morning"]  # tiny cover page skipped
    assert "Waves crashed" in book.chapters[0]["text"] and "p{}" not in book.chapters[0]["text"]


def test_bad_files():
    with pytest.raises(Exception, match="damaged"):
        import_document("x.epub", b"not a zip")
    with pytest.raises(Exception, match="Import a"):
        import_document("x.pdf", b"%PDF")


def test_dialogue_attribution():
    parts = segment_paragraph('"It\'s me," said Tom. "Let me in."')
    dialogue = [p for p in parts if p["kind"] == "dialogue"]
    assert [p["speaker"] for p in dialogue] == ["Tom", "Tom"]  # one attribution covers the paragraph
    parts = segment_paragraph('Ann whispered, "Quiet!"')
    assert [p["speaker"] for p in parts if p["kind"] == "dialogue"] == ["Ann"]
    parts = segment_paragraph('"Hello," he said.')
    assert [p["speaker"] for p in parts if p["kind"] == "dialogue"] == [None]  # pronouns aren't names


def test_find_characters():
    chapters = import_document("tale.txt", STORY.encode()).chapters
    assert find_characters(chapters) == [{"name": "Tom", "lines": 2}, {"name": "Ann", "lines": 1}]


class FakeMediaBook:
    def available(self):
        return True

    def stop(self):
        pass

    def call(self, op, **p):
        assert op == "encode_book"
        with open(p["out"], "wb") as f:
            f.write(b"M4B" + ",".join(p["titles"]).encode())
        return {}


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, token=TOKEN), Registry([FakeEngine()]))
    with TestClient(app) as c:
        app.state.services.media = FakeMediaBook()
        c.headers["Authorization"] = f"Bearer {TOKEN}"
        yield c


def test_book_flow(client, tmp_path):
    b = client.post("/v1/books", data={"kind": "story", "title": "The Visit"}, files={"file": ("visit.txt", STORY.encode(), "text/plain")}).json()
    assert b["title"] == "The Visit" and len(b["chapters"]) == 2
    assert b["cast"]["narrator"] == {"engine": "fake", "voice": "v1"}
    assert set(b["cast"]["characters"]) == {"Tom", "Ann"}
    assert all(c["status"] == "not_rendered" for c in b["chapters"])

    job = client.post(f"/v1/books/{b['id']}/render", json={}).json()
    done = wait_for(client, job["id"])
    assert done["result"] == {"book_id": b["id"], "rendered": 2, "skipped": 0}
    b = client.get(f"/v1/books/{b['id']}").json()
    assert [c["status"] for c in b["chapters"]] == ["rendered", "rendered"]

    ch = b["chapters"][0]
    t = client.get(f"/v1/books/{b['id']}/chapters/{ch['id']}/timings").json()
    first = t["timings"][0]
    assert ch["text"][first["from"] : first["to"]] == "Ann opened the door."
    assert all(a["end"] <= b2["start"] for a, b2 in zip(t["timings"], t["timings"][1:]))  # sequential
    spoken_by = {ch["text"][x["from"] : x["to"]]: x["speaker"] for x in t["timings"]}
    assert spoken_by["Who is there?"] == "Ann" and spoken_by["Let me in."] == "Tom" and spoken_by["Ann opened the door."] is None
    assert client.get(ch["audio_url"]).headers["content-type"] == "audio/wav"

    # Rendering again resumes: nothing to do.
    assert wait_for(client, client.post(f"/v1/books/{b['id']}/render", json={}).json()["id"])["result"]["rendered"] == 0

    # Editing one chapter makes only it stale.
    b = client.patch(f"/v1/books/{b['id']}", json={"chapters": [{"id": ch["id"], "text": ch["text"] + " The end."}]}).json()
    assert [c["status"] for c in b["chapters"]] == ["stale", "rendered"]
    assert wait_for(client, client.post(f"/v1/books/{b['id']}/render", json={}).json()["id"])["result"]["rendered"] == 1

    exp = wait_for(client, client.post(f"/v1/books/{b['id']}/export", json={"format": "m4b"}).json()["id"])
    assert exp["status"] == "succeeded", exp
    b = client.get(f"/v1/books/{b['id']}").json()
    got = client.get(b["exports"]["m4b"])
    assert got.content == b"M4BChapter One,Chapter Two" and "The%20Visit.m4b" in got.headers["content-disposition"]
    dest = tmp_path / "The Visit.m4b"
    assert client.post(f"/v1/books/{b['id']}/save", params={"format": "m4b"}, json={"path": str(dest)}).status_code == 204

    assert client.delete(f"/v1/books/{b['id']}").status_code == 204
    assert client.get("/v1/books").json() == []


def test_paste_text_and_validation(client):
    b = client.post("/v1/books", data={"text": "Just one paragraph of text."}).json()
    assert b["title"] == "pasted" and b["chapters"][0]["title"] == "Chapter 1"
    assert client.post("/v1/books", data={}).json()["error"] == "invalid_document"
    assert client.post(f"/v1/books/{b['id']}/export", json={"format": "mp3"}).json()["error"] == "not_rendered"
