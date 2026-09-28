import wave
from io import BytesIO

from test_api import FakeEngine, client  # noqa: F401  (fixture)
from test_jobs import wait_for
from voxd.markup import display, has_markup, parse


def test_parse_segments():
    segs = [s.public() for s in parse("Hello. [pause 1.5s] This is [slow]really *important*[/slow]. {SQL|sequel} [pause 300ms][pause]")]
    assert segs[0] == {"kind": "speech", "text": "Hello.", "speed": 1.0, "emphasis": False}
    assert segs[1] == {"kind": "pause", "seconds": 1.5}
    assert segs[2] == {"kind": "speech", "text": "This is", "speed": 1.0, "emphasis": False}
    assert segs[3] == {"kind": "speech", "text": "really", "speed": 0.8, "emphasis": False}
    assert segs[4] == {"kind": "speech", "text": "important.", "speed": 0.8, "emphasis": True}
    assert segs[4]["text"] == "important." and segs[5]["text"] == "sequel"  # lone punctuation joins the phrase before it
    assert segs[6] == {"kind": "pause", "seconds": 0.8}  # adjacent pauses merge


def test_nesting_clamps_and_literals():
    segs = parse("[fast][speed 1.9]quick[/speed][/fast] [/slow] a*b")
    assert segs[0].speed == 2.0  # 1.2 × 1.9 clamped
    assert "[/slow]" in segs[1].text and "a*b" in segs[1].text  # stray tags and lone asterisks stay text
    assert parse("[pause 99s]")[0].pause == 10.0


def test_display_and_detection():
    assert display("Say {SQL|sequel} [pause] *now* [fast]quickly[/fast].") == "Say SQL now quickly."
    assert has_markup("wait [pause] ok") and not has_markup("5 * 3 = 15 [note]")


def test_speech_with_markup(client, monkeypatch):
    calls = []
    real = FakeEngine.synthesize
    monkeypatch.setattr(FakeEngine, "synthesize", lambda self, text, voice, speed, out, emotion=None: (calls.append((text, round(speed, 2))), real(self, text, voice, speed, out, emotion)))
    take = client.post("/v1/speech", json={"text": "Hi. [pause 1s] *Now* {SQL|sequel}.", "voice": "v1", "markup": True}).json()
    assert take["text"] == "Hi. Now SQL."
    assert calls == [("Hi.", 1.0), ("Now", 0.92), ("sequel.", 1.0)]  # "{SQL|sequel}." keeps its full stop
    data = client.get(f"/v1/takes/{take['id']}/audio").content
    with wave.open(BytesIO(data)) as w:
        seconds = w.getnframes() / w.getframerate()
    assert abs(seconds - (3 * 0.5 + 1.0 + 0.08)) < 0.02  # three 0.5 s parts, the pause, one emphasis gap

    # Without markup=true the text is spoken literally.
    calls.clear()
    client.post("/v1/speech", json={"text": "Hi [pause] there", "voice": "v1"})
    assert calls == [("Hi [pause] there", 1.0)]

    job = client.post("/v1/jobs/speech", json={"text": "One. [pause 0.5s] Two.", "voice": "v1", "markup": True}).json()
    assert job["title"] == "One. Two."
    assert wait_for(client, job["id"])["status"] == "succeeded"

    preview = client.post("/v1/markup/preview", json={"text": "Hello [pause 2s] *world*"}).json()
    assert preview["display"] == "Hello world" and preview["has_markup"] and preview["segments"][1] == {"kind": "pause", "text": None, "speed": None, "emphasis": None, "seconds": 2.0}
    assert preview["estimated_s"] > 2
