import shutil

from test_api import FakeEngine
from test_jobs import wait_for
from test_voices_settings import client, wav_bytes  # noqa: F401  (fixture)


def test_pronunciations_crud_and_applied_to_speech(client, monkeypatch):
    p = client.post("/v1/pronunciations", json={"term": " SQL ", "say": "sequel"}).json()
    assert p["term"] == "SQL" and p["id"].startswith("pr_")
    assert client.post("/v1/pronunciations", json={"term": "sql", "say": "S Q L"}).json()["error"] == "conflict"
    client.post("/v1/pronunciations", json={"term": "New York", "say": "Noo Yawk"})
    client.post("/v1/pronunciations", json={"term": "York", "say": "Yorrk"})
    client.post("/v1/pronunciations", json={"term": "IT", "say": "eye tee", "case_sensitive": True})

    said = client.post("/v1/pronunciations/preview", json={"text": "Learn sql in New York and York; ask IT about it. mySQL"}).json()["text"]
    assert said == "Learn sequel in Noo Yawk and Yorrk; ask eye tee about it. mySQL"

    heard = []
    real = FakeEngine.synthesize
    monkeypatch.setattr(FakeEngine, "synthesize", lambda self, text, *a, **k: (heard.append(text), real(self, text, *a, **k)))
    take = client.post("/v1/speech", json={"text": "SQL rocks", "voice": "v1"}).json()
    assert heard == ["sequel rocks"] and take["text"] == "SQL rocks"  # the take keeps what you wrote

    assert client.patch(f"/v1/pronunciations/{p['id']}", json={"say": "ess cue ell"}).json()["say"] == "ess cue ell"
    assert client.post("/v1/pronunciations/preview", json={"text": "SQL"}).json()["text"] == "ess cue ell"
    assert client.delete(f"/v1/pronunciations/{p['id']}").status_code == 204
    assert client.post("/v1/pronunciations/preview", json={"text": "SQL"}).json()["text"] == "SQL"
    assert [x["term"] for x in client.get("/v1/pronunciations").json()] == ["IT", "New York", "York"]
    assert client.delete("/v1/pronunciations/nope").status_code == 404


def test_clean_needs_media_and_one_source(client):
    assert client.post("/v1/tools/clean", data={"take_id": "x"}).json()["error"] == "engine_unavailable"
    services = client.app.state.services

    class FakeMedia:
        def stop(self):
            pass

        def available(self):
            return True

        def call(self, op, **p):
            assert op == "clean" and p["normalize"] == -14.0 and p["trim"] is True
            shutil.copyfile(p["path"], p["out"])
            return {"duration_in": 1.0, "duration_out": 1.0, "peak_in": -3, "rms_in": -30, "peak_out": -1.5, "rms_out": -14}

    services.media = FakeMedia()
    assert client.post("/v1/tools/clean").json()["error"] == "invalid_request"
    assert client.post("/v1/tools/clean", data={"take_id": "nope"}).json()["error"] == "not_found"
    assert client.post("/v1/tools/clean", data={"denoise": "false", "normalize": "false"}, files={"file": ("a.wav", wav_bytes(1.0))}).json()["error"] == "invalid_request"

    job = client.post("/v1/tools/clean", data={"trim": "true", "loudness": "-14"}, files={"file": ("interview.wav", wav_bytes(1.0), "audio/wav")}).json()
    done = wait_for(client, job["id"])
    assert done["status"] == "succeeded", done
    take = client.get("/v1/takes").json()[0]
    assert take["id"] == done["result"]["take_id"] and take["engine"] == "tools" and take["text"] == "Cleaned · interview"
    assert done["result"]["rms_out"] == -14
    assert client.get(f"/v1/takes/{take['id']}/audio").status_code == 200

    # A take can be the source too.
    job = client.post("/v1/tools/clean", data={"take_id": take["id"], "loudness": "-14", "trim": "true"}).json()
    assert wait_for(client, job["id"])["status"] == "succeeded"
    assert not [p for p in (services.settings.data_dir / "uploads").iterdir()]  # staging cleaned up


def test_convert_needs_chatterbox(client):
    assert client.post("/v1/tools/convert", data={"voice": "default"}, files={"file": ("a.wav", wav_bytes(1.0))}).json()["error"] == "engine_unavailable"
