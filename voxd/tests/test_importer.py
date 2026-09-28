import http.server
import threading

import pytest

from test_api import client  # noqa: F401  (fixture)
from test_jobs import wait_for
from voxd import importer
from voxd.engines.base import EngineError


class FakeMedia:
    def available(self):
        return True

    def stop(self):
        pass


@pytest.fixture
def server():
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body, ctype = (b"RIFF....WAVEfmt ", "audio/wav") if self.path.endswith(".wav") else (b"<html>hi</html>", "text/html")
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def test_check_url_refuses_local_and_odd_links():
    for url in ("ftp://example.com/a.mp3", "http://127.0.0.1/a.mp3", "http://localhost/a.wav", "http://10.0.0.5/x.mp4", "http://[::1]/a.mp3", "not a url"):
        with pytest.raises(EngineError):
            importer.check_url(url)


def test_import_then_transcribe_and_dub(client, server, monkeypatch):
    services = client.app.state.services
    services.media = FakeMedia()
    assert client.post("/v1/imports/url", json={"url": f"{server}/talk.wav", "then": "transcribe"}).json()["error"] == "invalid_url"  # local server refused
    monkeypatch.setattr(importer, "check_url", lambda url: url)

    job = client.post("/v1/imports/url", json={"url": f"{server}/talk.wav", "then": "transcribe"}).json()
    done = wait_for(client, job["id"])
    assert done["status"] == "succeeded", done
    assert done["result"]["title"] == "talk" and done["result"]["transcript_id"]
    staged = [p.name for p in (services.settings.data_dir / "uploads").iterdir()]
    assert any(n.endswith(".wav") for n in staged)

    page = wait_for(client, client.post("/v1/imports/url", json={"url": f"{server}/watch?v=1", "then": "transcribe"}).json()["id"])
    assert page["status"] == "failed" and "isn't an audio or video file" in page["error"]

    dub = wait_for(client, client.post("/v1/imports/url", json={"url": f"{server}/clip.wav", "then": "dub", "target_language": "es", "title": "Promo"}).json()["id"])
    assert dub["status"] == "succeeded", dub
    d = client.get(f"/v1/dubs/{dub['result']['dub_id']}").json()
    assert d["title"] == "Promo" and d["target_lang"] == "es"
    assert client.post("/v1/imports/url", json={"url": f"{server}/a.wav", "then": "dub", "target_language": "xx"}).json()["error"] == "unsupported_language"
