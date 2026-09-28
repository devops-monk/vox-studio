import json
import struct

import numpy as np
import pytest
from fastapi.testclient import TestClient

from voxd.app import create_app
from voxd.config import Settings
from voxd.engines.base import Engine, EngineError
from voxd.engines.registry import Registry
from voxd.transcripts import LiveSession, to_srt, to_vtt

from test_api import TOKEN, FakeEngine
from test_jobs import wait_for
from test_voices_settings import wav_bytes


class FakeWhisper(Engine):
    """Pretends to transcribe: one segment per call, text reveals what it was given."""

    id = "whisper"
    name = "Whisper"
    license = "MIT"
    capabilities = ["asr"]

    def __init__(self):
        self.calls = []

    def probe(self):
        return None

    def voices(self):
        return []

    def synthesize(self, *a, **k):
        raise EngineError("no")

    def pick(self, model_id=None, fast=False):
        if model_id and model_id != "whisper-base":
            raise EngineError(f"{model_id} is not installed")

    def transcribe(self, *, path=None, pcm_path=None, language=None, model_id=None, fast=False, prompt=None, on_progress=None):
        self.calls.append({"path": path, "pcm": pcm_path, "fast": fast})
        if on_progress:
            on_progress(0.5)
        if pcm_path:
            secs = len(np.fromfile(pcm_path, dtype=np.float32)) / 16000
            return {"segments": [{"start": 0, "end": secs, "text": f"heard {secs:.1f} seconds"}], "language": "en", "duration": secs, "model": "whisper-base"}
        return {
            "segments": [{"start": 0.0, "end": 1.5, "text": "Hello there."}, {"start": 1.5, "end": 3.25, "text": "General Kenobi!"}],
            "language": "en",
            "duration": 3.25,
            "model": "whisper-base",
        }


@pytest.fixture
def ctx(tmp_path):
    whisper = FakeWhisper()
    app = create_app(Settings(data_dir=tmp_path, token=TOKEN), Registry([FakeEngine(), whisper]))
    with TestClient(app) as c:
        c.headers["Authorization"] = f"Bearer {TOKEN}"
        yield c, whisper, tmp_path


def test_subtitle_formats():
    segs = [{"start": 0.0, "end": 1.5, "text": "Hello."}, {"start": 3661.25, "end": 3662.0, "text": "Later."}]
    assert to_srt(segs) == "1\n00:00:00,000 --> 00:00:01,500\nHello.\n\n2\n01:01:01,250 --> 01:01:02,000\nLater.\n"
    assert to_vtt(segs).startswith("WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello.\n")


def test_file_transcription_end_to_end(ctx):
    client, whisper, tmp_path = ctx
    job = client.post("/v1/transcriptions", files={"file": ("meeting.m4a", b"fake audio bytes", "audio/mp4")}).json()
    assert job["kind"] == "transcribe" and job["title"] == "Transcribing meeting"
    done = wait_for(client, job["id"])
    assert done["status"] == "succeeded", done
    tid = done["result"]["transcript_id"]

    t = client.get(f"/v1/transcriptions/{tid}").json()
    assert t["title"] == "meeting" and t["text"] == "Hello there. General Kenobi!" and t["has_audio"] is True
    assert whisper.calls[0]["path"].endswith(".m4a") and whisper.calls[0]["fast"] is False
    assert client.get(f"/v1/transcriptions/{tid}/audio").content == b"fake audio bytes"

    srt = client.get(f"/v1/transcriptions/{tid}/export", params={"format": "srt"})
    assert srt.headers["content-disposition"] == 'attachment; filename="meeting.srt"'
    assert "00:00:01,500 --> 00:00:03,250\nGeneral Kenobi!" in srt.text
    assert client.get(f"/v1/transcriptions/{tid}/export", params={"format": "doc"}).status_code == 422

    listed = client.get("/v1/transcriptions", params={"q": "kenobi"}).json()
    assert [x["id"] for x in listed] == [tid] and listed[0]["preview"].startswith("Hello")


def test_correct_rename_delete(ctx):
    client, _, tmp_path = ctx
    tid = wait_for(client, client.post("/v1/transcriptions", files={"file": ("a.wav", b"x", "audio/wav")}).json()["id"])["result"]["transcript_id"]
    fixed = client.patch(
        f"/v1/transcriptions/{tid}",
        json={"title": "Fixed", "segments": [{"start": 0, "end": 1.5, "text": "Hi there."}, {"start": 1.5, "end": 3.25, "text": "General Kenobi!"}]},
    ).json()
    assert fixed["title"] == "Fixed" and fixed["text"] == "Hi there. General Kenobi!"
    assert client.delete(f"/v1/transcriptions/{tid}").status_code == 204
    assert not list((tmp_path / "uploads").iterdir())
    assert client.get(f"/v1/transcriptions/{tid}").json()["error"] == "not_found"


def test_unknown_model_rejected(ctx):
    client, _, _ = ctx
    res = client.post("/v1/transcriptions", data={"model": "whisper-huge"}, files={"file": ("a.wav", b"x", "audio/wav")})
    assert res.json()["error"] == "engine_unavailable"


def until_done(ws):
    msgs = []
    while not msgs or msgs[-1]["type"] != "done":
        msgs.append(ws.receive_json())
    return msgs


def speech(seconds, amp=0.3):
    t = np.arange(int(16000 * seconds)) / 16000
    return (np.sin(2 * np.pi * 180 * t) * amp * 32767).astype("<i2").tobytes()


def silence(seconds):
    return b"\x00\x00" * int(16000 * seconds)


def test_live_session_partials_pause_and_stop(ctx):
    client, whisper, _ = ctx
    with client.websocket_connect(f"/v1/transcribe/live?token={TOKEN}&title=Standup") as ws:
        assert ws.receive_json() == {"type": "ready", "sample_rate": 16000}
        for _ in range(3):  # 1.5 s of speech in 0.5 s frames
            ws.send_bytes(speech(0.5))
        assert ws.receive_json()["type"] == "partial"
        ws.send_bytes(silence(1.0))  # a pause closes the utterance
        final = ws.receive_json()
        assert final["type"] == "final" and final["segment"]["text"].startswith("heard 2.5")
        ws.send_bytes(speech(1.2))
        ws.send_text(json.dumps({"type": "stop"}))
        msgs = until_done(ws)
    assert [m["type"] for m in msgs if m["type"] != "partial"] == ["final", "done"]
    done = msgs[-1]
    assert done["text"].count("heard") == 2 and done["transcript_id"]
    t = client.get(f"/v1/transcriptions/{done['transcript_id']}").json()
    assert t["title"] == "Standup" and t["source"] == "live" and t["has_audio"] is False
    assert all(c["fast"] for c in whisper.calls)


def test_live_without_saving_and_auth(ctx):
    client, _, _ = ctx
    with pytest.raises(Exception):
        with client.websocket_connect("/v1/transcribe/live?token=bad") as ws:
            ws.receive_json()
    with client.websocket_connect(f"/v1/transcribe/live?token={TOKEN}&save=false") as ws:
        ws.receive_json()
        ws.send_bytes(speech(1.0))
        ws.send_text(json.dumps({"type": "stop"}))
        msgs = until_done(ws)
    assert msgs[-1]["type"] == "done" and msgs[-1]["transcript_id"] is None and "heard" in msgs[-1]["text"]
    assert client.get("/v1/transcriptions").json() == []


def test_silence_only_produces_nothing():
    session = LiveSession(FakeWhisper(), None, None)  # type: ignore[arg-type]
    session.add(silence(2.0))
    assert not session.should_finalize() or not session._has_speech()


def test_save_export_to_file(ctx, tmp_path):
    client, _, _ = ctx
    tid = wait_for(client, client.post("/v1/transcriptions", files={"file": ("a.wav", b"x", "audio/wav")}).json()["id"])["result"]["transcript_id"]
    dest = tmp_path / "out.vtt"
    assert client.post(f"/v1/transcriptions/{tid}/save", params={"format": "vtt"}, json={"path": str(dest)}).status_code == 204
    assert dest.read_text().startswith("WEBVTT")
    assert client.post(f"/v1/transcriptions/{tid}/save", params={"format": "srt"}, json={"path": str(dest)}).json()["error"] == "invalid_path"
