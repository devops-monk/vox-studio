import wave
from io import BytesIO

import numpy as np

from test_api import client  # noqa: F401  (fixture)
from voxd.editor import write_wav


def make_take(client, freq, seconds=1.0, rate=24000):
    take = client.post("/v1/speech", json={"text": f"tone {freq}", "voice": "v1"}).json()
    t = np.arange(int(seconds * rate)) / rate
    write_wav(client.app.state.services.settings.takes_dir / f"{take['id']}.wav", 0.5 * np.sin(2 * np.pi * freq * t).astype(np.float32), rate)
    return take["id"]


def audio(client, take_id):
    data = client.get(f"/v1/takes/{take_id}/audio").content
    with wave.open(BytesIO(data)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768, w.getframerate()


def test_trim_splice_cut_and_fades(client):
    a, b = make_take(client, 220), make_take(client, 440, rate=16000)  # different rates are resampled
    res = client.post("/v1/takes/edit", json={
        "clips": [{"take_id": a, "start": 0.0, "end": 0.3}, {"take_id": a, "start": 0.6}, {"take_id": b, "end": 0.5, "gain_db": -6}],
        "crossfade_ms": 0, "fade_in_s": 0.05, "fade_out_s": 0.05,
    })
    assert res.status_code == 201, res.text
    take = res.json()
    assert take["engine"] == "editor" and take["text"].startswith("Edited · tone 220")
    assert abs(take["duration_s"] - (0.3 + 0.4 + 0.5)) < 0.01  # the middle 0.3 s of `a` was cut out
    samples, rate = audio(client, take["id"])
    assert rate == 24000
    assert abs(samples[0]) < 0.01 and abs(samples[-1]) < 0.02  # faded
    assert np.max(np.abs(samples[int(0.8 * rate):int(1.1 * rate)])) < 0.3  # −6 dB on the last clip

    # A gap inserts silence; normalize brings the peak to −1 dBFS.
    gapped = client.post("/v1/takes/edit", json={"clips": [{"take_id": a}, {"take_id": a}], "gap_s": 0.5, "normalize": True}).json()
    assert abs(gapped["duration_s"] - 2.5) < 0.01
    samples, _ = audio(client, gapped["id"])
    assert abs(np.max(np.abs(samples)) - 10 ** (-1 / 20)) < 0.01
    # The sources are untouched.
    assert abs(audio(client, a)[0].shape[0] / 24000 - 1.0) < 0.001


def test_edit_errors(client):
    a = make_take(client, 220)
    assert client.post("/v1/takes/edit", json={"clips": [{"take_id": "nope"}]}).json()["error"] == "not_found"
    assert client.post("/v1/takes/edit", json={"clips": [{"take_id": a, "start": 0.9, "end": 0.2}]}).json()["error"] == "invalid_request"
    assert client.post("/v1/takes/edit", json={"clips": []}).status_code == 422
