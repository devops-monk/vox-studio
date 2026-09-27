import io
import struct
import sys
import textwrap
import wave

import pytest
from fastapi.testclient import TestClient

from voxd.app import create_app
from voxd.config import Settings
from voxd.engines.base import EngineError
from voxd.engines.chatterbox import emotion_to_params
from voxd.engines.registry import Registry
from voxd.runtimes.worker import Worker

from test_api import TOKEN, FakeEngine


def wav_bytes(seconds: float, rate: int = 24000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<h", 0) * int(rate * seconds))
    return buf.getvalue()


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, token=TOKEN), Registry([FakeEngine()]))
    with TestClient(app) as c:
        c.headers["Authorization"] = f"Bearer {TOKEN}"
        yield c


CONSENT = "I am the speaker and I agree to this voice being cloned."


def upload(client, seconds=5.0, name="Me", data=None):
    return client.post(
        "/v1/voices/custom",
        data={"name": name, "consent": CONSENT},
        files={"audio": ("me.wav", data if data is not None else wav_bytes(seconds), "audio/wav")},
    )


def test_create_list_rename_delete_custom_voice(client):
    res = upload(client)
    assert res.status_code == 201, res.text
    voice = res.json()
    assert voice["id"].startswith("cv_") and voice["duration_s"] == 5.0 and voice["consent"] == CONSENT
    assert client.get(voice["audio_url"]).headers["content-type"] == "audio/wav"
    assert [v["id"] for v in client.get("/v1/voices/custom").json()] == [voice["id"]]

    assert client.patch(f"/v1/voices/custom/{voice['id']}", json={"name": "Narrator"}).json()["name"] == "Narrator"
    assert client.delete(f"/v1/voices/custom/{voice['id']}").status_code == 204
    assert client.get("/v1/voices/custom").json() == []
    assert client.get(voice["audio_url"]).status_code == 404


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"seconds": 1.0}, "at least 3 seconds"),
        ({"seconds": 70.0}, "under 60 seconds"),
        ({"data": b"not a wav file at all"}, "isn't a valid WAV"),
    ],
)
def test_custom_voice_rejects_bad_audio(client, kwargs, message):
    res = upload(client, **kwargs)
    assert res.status_code == 400
    assert res.json()["error"] == "invalid_audio" and message in res.json()["message"]


def test_custom_voice_requires_consent(client):
    res = client.post("/v1/voices/custom", data={"name": "X", "consent": "ok"}, files={"audio": ("a.wav", wav_bytes(5), "audio/wav")})
    assert res.status_code == 422


def test_path_traversal_ids_are_rejected(client):
    assert client.get("/v1/voices/custom/cv_..%2F..%2Fetc/audio").status_code == 404
    assert client.delete("/v1/voices/custom/../../x").status_code in (404, 405)


def test_settings_roundtrip(client):
    assert client.get("/v1/settings").json()["compute_device"] == "auto"
    assert client.patch("/v1/settings", json={"compute_device": "cpu"}).json()["compute_device"] == "cpu"
    assert client.patch("/v1/settings", json={"compute_device": "tpu"}).status_code == 422
    if "cuda" not in client.get("/v1/system").json()["accelerators"]:
        assert client.patch("/v1/settings", json={"compute_device": "cuda"}).json()["error"] == "unsupported_device"


def test_star_and_export_take(client, tmp_path):
    take = client.post("/v1/speech", json={"text": "Hi", "voice": "v1"}).json()
    assert client.put(f"/v1/takes/{take['id']}/star", json={"starred": True}).json()["starred"] is True

    dest = tmp_path / "out" / "hello.wav"
    dest.parent.mkdir()
    assert client.post(f"/v1/takes/{take['id']}/export", json={"path": str(dest)}).status_code == 204
    assert dest.stat().st_size > 0
    assert client.post(f"/v1/takes/{take['id']}/export", json={"path": str(dest)}).json()["error"] == "file_exists"
    assert client.post(f"/v1/takes/{take['id']}/export", json={"path": str(dest), "overwrite": True}).status_code == 204
    assert client.post(f"/v1/takes/{take['id']}/export", json={"path": "relative.wav"}).json()["error"] == "invalid_path"
    assert client.post(f"/v1/takes/{take['id']}/export", json={"path": str(tmp_path / "x.exe")}).json()["error"] == "invalid_path"


def test_emotion_mapping():
    assert emotion_to_params(None) == (0.5, 0.5)
    assert emotion_to_params(0.5) == (0.5, 0.5)
    assert emotion_to_params(0.0) == (0.25, 0.5)
    exaggeration, cfg = emotion_to_params(1.0)
    assert exaggeration == 1.5 and cfg == pytest.approx(0.3)


FAKE_WORKER = textwrap.dedent(
    """
    import json, os, sys
    proto = os.fdopen(os.dup(1), "w", buffering=1); os.dup2(2, 1)
    print("noise that must not break the protocol")
    proto.write(json.dumps({"ready": True, "device": "cpu"}) + "\\n")
    for line in sys.stdin:
        req = json.loads(line)
        if req["op"] == "crash":
            os._exit(3)
        ok = req["op"] == "echo"
        proto.write(json.dumps({"id": req["id"], "ok": ok, "value": req.get("value"), "error": None if ok else "nope"}) + "\\n")
    """
)


def test_worker_protocol_errors_and_restart(tmp_path):
    script = tmp_path / "w.py"
    script.write_text(FAKE_WORKER)
    worker = Worker("fake", [sys.executable, str(script)])
    try:
        assert worker.call("echo", value=42)["value"] == 42
        assert worker.info == {"device": "cpu"}
        with pytest.raises(EngineError, match="nope"):
            worker.call("other")
        with pytest.raises(EngineError, match="stopped unexpectedly"):
            worker.call("crash")
        assert worker.call("echo", value=7)["value"] == 7  # restarted on demand
    finally:
        worker.stop()
    assert not worker.running
