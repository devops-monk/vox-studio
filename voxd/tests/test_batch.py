import time

import pytest
from fastapi.testclient import TestClient

from voxd.app import create_app
from voxd.batch import OUTPUT_DIR
from voxd.config import Settings
from voxd.engines.registry import Registry

from test_api import TOKEN, FakeEngine
from test_jobs import wait_for
from test_transcription import FakeWhisper


@pytest.fixture
def ctx(tmp_path):
    app = create_app(Settings(data_dir=tmp_path / "data", token=TOKEN), Registry([FakeEngine(), FakeWhisper()]))
    with TestClient(app) as c:
        c.headers["Authorization"] = f"Bearer {TOKEN}"
        yield c, tmp_path


def wait_batch(client, batch_id):
    for _ in range(200):
        b = client.get(f"/v1/batches/{batch_id}").json()
        if b["done"] + b["failed"] == b["total"]:
            return b
        time.sleep(0.05)
    raise AssertionError(b)


def test_speech_batch_writes_outputs(ctx):
    client, tmp = ctx
    out = tmp / "out"
    b = client.post(
        "/v1/batches",
        json={"kind": "speech", "engine": "fake", "voice": "v1", "output_dir": str(out),
              "items": [{"name": "intro", "text": "Hello."}, {"name": "intro", "text": "Again."}, {"name": "bad/../name", "text": "Hi."}]},
    ).json()
    assert b["total"] == 3 and b["title"] == "3 texts"
    b = wait_batch(client, b["id"])
    assert b["done"] == 3, b
    names = sorted(p.name for p in out.iterdir())
    assert names == ["bad_.._name.wav", "intro (2).wav", "intro.wav"]  # unique, filesystem-safe names
    assert all(i["output"] for i in b["items"])
    assert len(client.get("/v1/takes").json()) == 3


def test_transcribe_batch(ctx):
    client, tmp = ctx
    files = []
    for n in ("a.mp3", "b.wav"):
        p = tmp / n
        p.write_bytes(b"audio")
        files.append(str(p))
    out = tmp / "notes"
    b = client.post("/v1/batches", json={"kind": "transcribe", "paths": files, "formats": ["txt", "srt"], "output_dir": str(out)}).json()
    b = wait_batch(client, b["id"])
    assert b["done"] == 2, b
    assert sorted(p.name for p in out.iterdir()) == ["a.srt", "a.txt", "b.srt", "b.txt"]
    assert (out / "a.txt").read_text().strip() == "Hello there. General Kenobi!"


def test_batch_validation(ctx):
    client, tmp = ctx
    assert client.post("/v1/batches", json={"kind": "speech", "engine": "fake", "voice": "v1", "items": []}).json()["error"] == "empty_batch"
    assert client.post("/v1/batches", json={"kind": "speech", "engine": "fake", "voice": "nope", "items": [{"name": "a", "text": "b"}]}).json()["error"] == "unknown_voice"
    assert client.post("/v1/batches", json={"kind": "transcribe", "paths": [str(tmp / "missing.wav")]}).json()["error"] == "invalid_path"
    assert client.post("/v1/batches", json={"kind": "speech", "engine": "fake", "voice": "v1", "items": [{"name": "a", "text": "b"}], "output_dir": "relative"}).json()["error"] == "invalid_path"


def test_watch_folder_speaks_new_files_once(ctx):
    client, tmp = ctx
    folder = tmp / "inbox"
    folder.mkdir()
    (folder / "one.txt").write_text("First file.")
    (folder / "ignore.pdf").write_text("x")
    w = client.post("/v1/watch-folders", json={"path": str(folder), "action": "speak", "engine": "fake", "voice": "v1"}).json()
    assert w["exists"] and w["output_dir"].endswith(OUTPUT_DIR)
    watcher = client.app.state.services.watcher

    assert watcher.scan_once() == 0  # first sighting: wait until the size is stable
    assert watcher.scan_once() == 1
    for _ in range(100):
        if (folder / OUTPUT_DIR / "one.wav").exists():
            break
        time.sleep(0.05)
    assert (folder / OUTPUT_DIR / "one.wav").exists()
    assert watcher.scan_once() == 0  # never twice

    w = client.get("/v1/watch-folders").json()[0]
    assert w["processed"] == 1 and w["recent"][0]["state"] in ("queued", "done")

    client.patch(f"/v1/watch-folders/{w['id']}", json={"enabled": False})
    (folder / "two.txt").write_text("Second.")
    watcher.scan_once()
    assert watcher.scan_once() == 0  # paused

    assert client.post("/v1/watch-folders", json={"path": str(folder), "action": "speak", "engine": "fake", "voice": "v1"}).json()["error"] == "already_watched"
    assert client.delete(f"/v1/watch-folders/{w['id']}").status_code == 204
    assert client.get("/v1/watch-folders").json() == []


def test_watch_folder_empty_file_recorded_as_error(ctx):
    client, tmp = ctx
    folder = tmp / "inbox2"
    folder.mkdir()
    (folder / "empty.txt").write_text("   ")
    client.post("/v1/watch-folders", json={"path": str(folder), "action": "speak", "engine": "fake", "voice": "v1"})
    watcher = client.app.state.services.watcher
    watcher.scan_once()
    assert watcher.scan_once() == 0
    recent = client.get("/v1/watch-folders").json()[0]["recent"]
    assert recent[0]["state"] == "error" and "empty" in recent[0]["error"]
