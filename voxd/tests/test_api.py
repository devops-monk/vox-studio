import struct
import sys
import time
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from voxd.app import create_app
from voxd.config import Settings
from voxd.engines.base import Engine, EngineError, Voice
from voxd.engines.registry import Registry
from voxd.engines.system import SystemEngine

TOKEN = "t0k3n"


class FakeEngine(Engine):
    id = "fake"
    name = "Fake"
    license = "test"
    delay = 0.0

    def probe(self):
        return None

    def voices(self):
        return [Voice(id="v1", name="Voice One", language="en-US")]

    def synthesize(self, text, voice_id, speed, out: Path, emotion=None):
        if voice_id != "v1":
            raise EngineError(f"Unknown voice: {voice_id}")
        time.sleep(self.delay)
        with wave.open(str(out), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(24000)
            w.writeframes(struct.pack("<h", 0) * 12000)  # 0.5 s of silence


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, token=TOKEN), Registry([FakeEngine()]))
    with TestClient(app) as c:
        c.headers["Authorization"] = f"Bearer {TOKEN}"
        yield c


def test_status_is_public_and_ready(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, token=TOKEN), Registry([FakeEngine()]))
    with TestClient(app) as c:
        body = c.get("/v1/status").json()
    assert body["phase"] == "ready"
    assert body["name"] == "voxd"


def test_token_required(client):
    assert client.get("/v1/engines", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/v1/engines").status_code == 200


def test_speech_creates_take_and_audio(client):
    res = client.post("/v1/speech", json={"text": "Hello", "voice": "v1"})
    assert res.status_code == 201, res.text
    take = res.json()
    assert take["engine"] == "fake"
    assert take["duration_s"] == pytest.approx(0.5)

    audio = client.get(take["audio_url"])
    assert audio.headers["content-type"] == "audio/wav"
    assert client.get("/v1/takes").json()[0]["id"] == take["id"]


def test_audio_accepts_query_token(client):
    take = client.post("/v1/speech", json={"text": "Hi", "voice": "v1"}).json()
    res = client.get(f"{take['audio_url']}?token={TOKEN}", headers={"Authorization": ""})
    assert res.status_code == 200


def test_errors_have_stable_shape(client):
    bad_voice = client.post("/v1/speech", json={"text": "Hi", "voice": "nope"})
    assert bad_voice.status_code == 400
    assert bad_voice.json() == {"error": "synthesis_failed", "message": "Unknown voice: nope"}

    empty = client.post("/v1/speech", json={"text": "", "voice": "v1"})
    assert empty.status_code == 422
    assert empty.json()["error"] == "invalid_request"

    assert client.get("/v1/takes/deadbeef/audio").json()["error"] == "not_found"


@pytest.mark.skipif(sys.platform != "darwin", reason="macOS `say` only")
def test_system_engine_speaks(tmp_path):
    engine = SystemEngine()
    assert engine.probe() is None
    voice = next(v for v in engine.voices() if v.language.startswith("en"))
    out = tmp_path / "x.wav"
    engine.synthesize("Testing one two.", voice.id, 1.0, out)
    assert out.stat().st_size > 1000


def test_log_filter_redacts_tokens():
    import logging

    from voxd.__main__ import RedactTokens

    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s"', ("127.0.0.1", "GET", "/v1/events?token=abc123&x=1"), None)
    RedactTokens().filter(record)
    assert "abc123" not in record.getMessage()
    assert "token=***&x=1" in record.getMessage()
