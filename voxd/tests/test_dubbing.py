import json
import shutil
import struct
import wave

import pytest
from fastapi.testclient import TestClient

from voxd.app import create_app
from voxd.config import Settings
from voxd.dubbing import slot_seconds, translation_route
from voxd.engines.registry import Registry

from test_api import TOKEN, FakeEngine
from test_jobs import wait_for
from test_transcription import FakeWhisper


class DubWhisper(FakeWhisper):
    def transcribe(self, **kw):
        return {
            "segments": [
                {"start": 0.0, "end": 1.0, "text": "Hola a todos."},
                {"start": 1.2, "end": 2.0, "text": "Bienvenidos."},
            ],
            "language": "es",
            "duration": 3.0,
            "model": "whisper-base",
        }


class FakeMedia:
    """Stands in for the PyAV worker: writes silent WAVs, 'translates' by tagging text."""

    def __init__(self):
        self.calls = []

    def available(self):
        return True

    def stop(self):
        pass

    def call(self, op, **p):
        self.calls.append(op)
        if op == "probe":
            return {"duration": 3.0, "has_video": True, "has_audio": True}
        if op == "extract":
            with wave.open(p["out"], "wb") as w:
                w.setnchannels(p["channels"])
                w.setsampwidth(2)
                w.setframerate(p["rate"])
                w.writeframes(struct.pack("<h", 0) * p["rate"] * 3 * p["channels"])
            return {}
        if op == "mux":
            shutil.copyfile(p["audio"], p["out"])
            return {}
        if op == "translate":
            return {"texts": [f"EN({t})" for t in p["texts"]]}
        if op == "embed":  # two clearly different voices
            return {"embeddings": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]][: len(p["spans"])]}
        raise AssertionError(op)


@pytest.fixture
def ctx(tmp_path):
    # Pretend the es→en translation pack is installed.
    pkg = tmp_path / "models" / "translate-es-en"
    pkg.mkdir(parents=True)
    (pkg / "installed.json").write_text("{}")
    app = create_app(Settings(data_dir=tmp_path, token=TOKEN), Registry([FakeEngine(), DubWhisper()]))
    media = FakeMedia()
    with TestClient(app) as c:
        app.state.services.media = media
        c.headers["Authorization"] = f"Bearer {TOKEN}"
        yield c, media, tmp_path


def create(client, target="en", speakers="1"):
    res = client.post("/v1/dubs", data={"target_language": target, "speakers": speakers}, files={"file": ("clip.mp4", b"video bytes", "video/mp4")})
    assert res.status_code == 201, res.text
    return res.json()


def wait_dub(client, dub_id, statuses=("ready", "done", "failed")):
    import time

    for _ in range(200):
        d = client.get(f"/v1/dubs/{dub_id}").json()
        if d["status"] in statuses and not d["job_id"]:
            return d
        time.sleep(0.05)
    raise AssertionError(d)


def test_routes_pivot_through_english():
    assert translation_route("es", "en") == ["translate-es-en"]
    assert translation_route("es", "fr") == ["translate-es-en", "translate-en-fr"]
    assert translation_route("fr", "fr") == []


def test_slot_is_gap_to_next_line():
    segs = [{"start": 0.0, "end": 1.0}, {"start": 1.5, "end": 2.0}]
    assert slot_seconds(segs, 0, 5.0) == 1.5
    assert slot_seconds(segs, 1, 5.0) == 3.5


def test_full_dub_flow(ctx, tmp_path):
    client, media, _ = ctx
    d = create(client)
    assert d["status"] == "preparing" and d["title"] == "clip"
    d = wait_dub(client, d["id"])
    assert d["status"] == "ready", d
    assert d["source_lang"] == "es" and d["has_video"] is True
    assert [s["translation"] for s in d["segments"]] == ["EN(Hola a todos.)", "EN(Bienvenidos.)"]
    assert d["cast"]["S1"] == {"engine": "fake", "voice": "v1"}

    # Edit a line and give it a second speaker; S2 gets a voice automatically.
    seg = d["segments"][1]
    d = client.patch(f"/v1/dubs/{d['id']}", json={"segments": [{"id": seg["id"], "translation": "Welcome!", "speaker": "S2"}]}).json()
    assert d["segments"][1]["translation"] == "Welcome!" and "S2" in d["cast"]

    job = client.post(f"/v1/dubs/{d['id']}/render").json()
    assert wait_for(client, job["id"])["status"] == "succeeded"
    d = client.get(f"/v1/dubs/{d['id']}").json()
    assert d["status"] == "done" and d["audio_url"] and d["video_url"] and not d["stale"]
    fit = d["segments"][0]["fit"]
    # The fake voice renders 0.5 s; the first slot is 1.2 s → no speed-up needed.
    assert fit == {"speed": 1.0, "overflow_s": 0.0, "duration_s": 0.5}
    assert "mux" in media.calls
    audio = client.get(d["audio_url"])
    assert audio.status_code == 200 and len(audio.content) > 44

    srt = client.get(f"/v1/dubs/{d['id']}/subtitles", params={"format": "srt"})
    assert "Welcome!" in srt.text and srt.headers["content-disposition"].endswith('.en.srt"')
    orig = client.get(f"/v1/dubs/{d['id']}/subtitles", params={"format": "vtt", "which": "text"}).text
    assert orig.startswith("WEBVTT") and "Hola a todos." in orig

    dest = tmp_path / "out.mp4"
    assert client.post(f"/v1/dubs/{d['id']}/save", json={"path": str(dest), "what": "video"}).status_code == 204
    assert dest.exists()

    # Editing after a render marks it stale.
    d = client.patch(f"/v1/dubs/{d['id']}", json={"mix": "replace"}).json()
    assert d["stale"] is True and d["mix"] == "replace"

    assert client.delete(f"/v1/dubs/{d['id']}").status_code == 204
    assert client.get(f"/v1/dubs/{d['id']}").json()["error"] == "not_found"


def test_render_requires_voices_and_idle(ctx):
    client, _, _ = ctx
    d = wait_dub(client, create(client)["id"])
    client.app.state.services.store.update_dub(d["id"], cast={})
    assert client.post(f"/v1/dubs/{d['id']}/render").json()["error"] == "missing_voice"


def test_same_language_skips_translation(ctx):
    client, media, _ = ctx
    d = wait_dub(client, create(client, target="es")["id"])
    assert "translate" not in media.calls
    assert d["segments"][0]["translation"] == "Hola a todos."


def test_unsupported_target(ctx):
    client, _, _ = ctx
    res = client.post("/v1/dubs", data={"target_language": "xx"}, files={"file": ("a.mp4", b"x", "video/mp4")})
    assert res.json()["error"] == "unsupported_language"


def test_languages_endpoint(ctx):
    client, _, _ = ctx
    langs = {l["code"]: l for l in client.get("/v1/dubs/languages").json()}
    assert set(langs) == {"en", "es", "fr", "de", "it", "pt", "hi", "ja", "zh"}
    assert langs["en"]["has_voice"] is True and langs["ja"]["has_voice"] is False


def test_speaker_detection_gives_each_speaker_a_voice(ctx, monkeypatch):
    from voxd import speakers

    monkeypatch.setattr(speakers, "MIN_RELIABLE_S", 0.5)  # the fake lines are short
    client, media, tmp = ctx
    model = tmp / "models" / "speakers-campplus"
    model.mkdir(parents=True)
    (model / "installed.json").write_text("{}")
    dub = create(client, speakers="auto")
    assert wait_for(client, dub["job_id"])["status"] == "succeeded"
    d = client.get(f"/v1/dubs/{dub['id']}").json()
    assert [s["speaker"] for s in d["segments"]] == ["S1", "S2"] and "embed" in media.calls
    assert set(d["cast"]) == {"S1", "S2"}


def test_speaker_detection_failure_falls_back_to_one_speaker(ctx):
    client, media, tmp = ctx  # the speaker model isn't installed and can't be fetched here
    client.app.state.services.models.download = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("offline"))
    dub = create(client, speakers="auto")
    assert wait_for(client, dub["job_id"])["status"] == "succeeded"
    assert {s["speaker"] for s in client.get(f"/v1/dubs/{dub['id']}").json()["segments"]} == {"S1"}


class FakeSeparator:
    def __init__(self, ready=True):
        self.ready, self.calls = ready, 0

    def unavailable_reason(self):
        return None if self.ready else "Keeping the background needs Demucs — download it from Models"

    def separate(self, path, out, on_progress=None):
        self.calls += 1
        shutil.copyfile(path, out)
        if on_progress:
            on_progress(1.0)

    def stop(self):
        pass


def test_keep_background_mix(ctx):
    client, media, tmp = ctx
    services = client.app.state.services
    services.separator = FakeSeparator(ready=False)
    dub = create(client)
    wait_for(client, dub["job_id"])
    assert client.patch(f"/v1/dubs/{dub['id']}", json={"mix": "keep"}).json()["error"] == "engine_unavailable"
    services.separator = sep = FakeSeparator()
    assert client.patch(f"/v1/dubs/{dub['id']}", json={"mix": "keep"}).json()["mix"] == "keep"
    for _ in range(2):
        job = client.post(f"/v1/dubs/{dub['id']}/render").json()
        assert wait_for(client, job["id"])["status"] == "succeeded"
    assert sep.calls == 1  # the separated soundtrack is reused
    assert (tmp / "dubs" / dub["id"] / "background-44k.wav").exists()
