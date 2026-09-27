import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from voxd.app import create_app
from voxd.config import Settings
from voxd.design import (
    CACHE_VERSION,
    Target,
    VoiceTraits,
    brightness,
    design,
    median_pitch,
    parse_description,
    parse_recipe,
    recipe,
)
from voxd.engines.base import EngineError
from voxd.engines.registry import Registry

from test_api import TOKEN, FakeEngine

RATE = 24000


def tone(freq, seconds=1.0, rate=RATE):
    t = np.arange(int(rate * seconds)) / rate
    # A buzzy harmonic tone, more speech-like than a pure sine.
    return (0.3 * sum(np.sin(2 * np.pi * freq * k * t) / k for k in range(1, 6))).astype(np.float32)


@pytest.mark.parametrize("freq", [90, 150, 220])
def test_pitch_estimator(freq):
    assert median_pitch(tone(freq), RATE) == pytest.approx(freq, rel=0.05)


def test_brightness_orders_tones():
    assert brightness(tone(120), RATE) < brightness(tone(300), RATE)


@pytest.mark.parametrize(
    ("text", "expect"),
    [
        ("A warm, deep British narrator", {"language": "en-GB", "depth": 0.9, "warmth": 0.85}),
        ("an energetic young woman", {"gender": "female", "depth": 0.15, "energy": 0.9}),
        ("a man with high energy", {"gender": "male", "energy": 0.9, "depth": None}),
        ("low-pitched and slow", {"depth": 0.9, "speed": 0.88}),
        ("speaks to us clearly", {"language": None, "warmth": 0.2}),
    ],
)
def test_parse_description(text, expect):
    t = parse_description(text)
    for key, value in expect.items():
        assert getattr(t, key) == value, (key, t)


def test_recipe_roundtrip_and_validation():
    r = recipe([("af_heart", 3), ("bf_emma", 1)])
    assert r == "mix:af_heart=0.750,bf_emma=0.250"
    assert parse_recipe(r) == [("af_heart", 0.75), ("bf_emma", 0.25)]
    for bad in ["af_heart=1", "mix:", "mix:af_heart=x", "mix:../etc=1", "mix:af_heart=-1", "mix:" + ",".join(f"af_a{i}=1" for i in range(5))]:
        with pytest.raises(EngineError):
            parse_recipe(bad)


TRAITS = [
    VoiceTraits("am_deep", "en-US", "male", 85, 2000, 0.3),
    VoiceTraits("am_mid", "en-US", "male", 120, 2600, 0.5),
    VoiceTraits("bm_warm", "en-GB", "male", 100, 1900, 0.2),
    VoiceTraits("bm_bright", "en-GB", "male", 130, 3800, 0.8),
    VoiceTraits("af_high", "en-US", "female", 230, 4200, 0.9),
    VoiceTraits("bf_soft", "en-GB", "female", 190, 2100, 0.3),
    VoiceTraits("af_mid", "en-US", "female", 205, 3000, 0.6),
]


def test_design_respects_filters_and_target():
    cands = design(TRAITS, Target(gender="male", language="en-GB", depth=0.9, warmth=0.9))
    assert cands
    for c in cands:
        assert all(v.startswith("bm_") for v in c["voices"])
    assert cands[0]["voices"][0] == "bm_warm"
    assert len({c["recipe"] for c in cands}) == len(cands)


def test_design_falls_back_when_filter_empty():
    cands = design(TRAITS, Target(gender="female", language="en-AU"))
    assert cands and all(v[1] == "f" for c in cands for v in c["voices"])


@pytest.fixture
def client(tmp_path):
    (tmp_path / "voice-traits.json").write_text(json.dumps({"version": CACHE_VERSION, "voices": [t.__dict__ for t in TRAITS]}))
    app = create_app(Settings(data_dir=tmp_path, token=TOKEN), Registry([FakeEngine()]))
    with TestClient(app) as c:
        c.headers["Authorization"] = f"Bearer {TOKEN}"
        yield c


def test_design_endpoints(client):
    assert client.get("/v1/design/status").json() == {"ready": True, "analyzed_voices": 7, "job_id": None}
    res = client.post("/v1/design/candidates", json={"description": "a calm British man", "energy": 0.9}).json()
    assert res["target"]["gender"] == "male" and res["target"]["energy"] == 0.9  # slider overrides the word
    assert res["target"]["matched"] == ["man", "british", "calm"]
    recipe_ = res["candidates"][0]["recipe"]

    saved = client.post("/v1/voices/designed", json={"name": "Ship Captain", "recipe": recipe_, "speed": 0.95}).json()
    assert saved["id"].startswith("dv_") and saved["language"] == "en-GB" and saved["gender"] == "male"
    assert [v["name"] for v in client.get("/v1/voices/designed").json()] == ["Ship Captain"]
    assert client.patch(f"/v1/voices/designed/{saved['id']}", json={"name": "Captain"}).json()["name"] == "Captain"
    assert client.post("/v1/voices/designed", json={"name": "x", "recipe": "nope"}).json()["error"] == "invalid_recipe"
    assert client.delete(f"/v1/voices/designed/{saved['id']}").status_code == 204
    assert client.get("/v1/voices/designed").json() == []


def test_design_requires_analysis(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, token=TOKEN), Registry([FakeEngine()]))
    with TestClient(app) as c:
        c.headers["Authorization"] = f"Bearer {TOKEN}"
        assert c.get("/v1/design/status").json()["ready"] is False
        assert c.post("/v1/design/candidates", json={"description": "x"}).json()["error"] == "not_analyzed"
        assert c.post("/v1/design/analyze").json()["error"] == "engine_unavailable"
