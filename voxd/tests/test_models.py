import hashlib
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from voxd.app import create_app
from voxd.config import Settings
from voxd.engines.kokoro import KokoroEngine
from voxd.engines.registry import Registry
from voxd.models import CATALOG, ModelFile, ModelSpec, ModelStore

from test_api import TOKEN, FakeEngine
from test_jobs import wait_for

BLOB_A = os.urandom(3 * 1024 * 1024 + 123)
BLOB_B = os.urandom(512 * 1024)


class Server:
    """Static files with HTTP Range support; records the Range headers it sees."""

    def __init__(self, files: dict[str, bytes], delay: float = 0.0):
        self.files, self.delay, self.ranges = files, delay, []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                body = outer.files.get(self.path.lstrip("/"))
                if body is None:
                    self.send_error(404)
                    return
                start = 0
                rng = self.headers.get("Range")
                outer.ranges.append(rng)
                if rng:
                    start = int(rng.split("=")[1].split("-")[0])
                    self.send_response(206)
                    self.send_header("Content-Range", f"bytes {start}-{len(body) - 1}/{len(body)}")
                else:
                    self.send_response(200)
                self.send_header("Content-Length", str(len(body) - start))
                self.end_headers()
                for i in range(start, len(body), 256 * 1024):
                    time.sleep(outer.delay)
                    try:
                        self.wfile.write(body[i : i + 256 * 1024])
                    except (BrokenPipeError, ConnectionResetError):
                        return

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"

    def close(self):
        self.httpd.shutdown()


def spec_for(server: Server, sha_a: str | None = None) -> ModelSpec:
    return ModelSpec(
        id="test-model", engine="fake", name="Test Model", tagline="t", description="d", license="MIT",
        license_url="", homepage="", languages=("en-US",), min_ram_gb=0.1, voice_count=1,
        files=(
            ModelFile("a.bin", f"{server.url}/a.bin", len(BLOB_A), sha_a or hashlib.sha256(BLOB_A).hexdigest()),
            ModelFile("b.bin", f"{server.url}/b.bin", len(BLOB_B), hashlib.sha256(BLOB_B).hexdigest()),
        ),
    )


@pytest.fixture
def server():
    s = Server({"a.bin": BLOB_A, "b.bin": BLOB_B})
    yield s
    s.close()


def client_for(tmp_path, spec):
    app = create_app(Settings(data_dir=tmp_path, token=TOKEN), Registry([FakeEngine()]), catalog=(spec,))
    c = TestClient(app)
    c.headers["Authorization"] = f"Bearer {TOKEN}"
    return c


def test_catalog_lists_fit_and_status(tmp_path, server):
    with client_for(tmp_path, spec_for(server)) as c:
        [m] = c.get("/v1/models").json()
        assert m["status"] == "not_installed"
        assert m["size_bytes"] == len(BLOB_A) + len(BLOB_B)
        assert m["fit"]["level"] in ("great", "ok")
        assert c.get("/v1/system").json()["ram_bytes"] > 0


def test_download_verifies_and_installs(tmp_path, server):
    with client_for(tmp_path, spec_for(server)) as c:
        job = c.post("/v1/models/test-model/download").json()
        done = wait_for(c, job["id"])
        assert done["status"] == "succeeded", done
        assert c.get("/v1/models").json()[0]["status"] == "installed"
        assert (tmp_path / "models/test-model/a.bin").read_bytes() == BLOB_A
        assert c.post("/v1/models/test-model/download").json()["error"] == "already_installed"


def test_corrupt_download_fails_cleanly(tmp_path, server):
    with client_for(tmp_path, spec_for(server, sha_a="0" * 64)) as c:
        done = wait_for(c, c.post("/v1/models/test-model/download").json()["id"])
        assert done["status"] == "failed"
        assert "verification" in done["error"]
        assert not list((tmp_path / "models/test-model").glob("a.bin*"))
        assert c.get("/v1/models").json()[0]["status"] == "not_installed"


def test_resumes_partial_download(tmp_path, server):
    target = tmp_path / "models/test-model"
    target.mkdir(parents=True)
    (target / "a.bin.part").write_bytes(BLOB_A[:1_000_000])
    with client_for(tmp_path, spec_for(server)) as c:
        assert wait_for(c, c.post("/v1/models/test-model/download").json()["id"])["status"] == "succeeded"
    assert "bytes=1000000-" in server.ranges
    assert (target / "a.bin").read_bytes() == BLOB_A


def test_cancel_keeps_partial_for_resume(tmp_path):
    slow = Server({"a.bin": BLOB_A, "b.bin": BLOB_B}, delay=0.05)
    try:
        with client_for(tmp_path, spec_for(slow)) as c:
            job_id = c.post("/v1/models/test-model/download").json()["id"]
            deadline = time.monotonic() + 5
            while c.get(f"/v1/jobs/{job_id}").json()["progress"] < 0.1 and time.monotonic() < deadline:
                time.sleep(0.02)
            c.post(f"/v1/jobs/{job_id}/cancel")
            assert wait_for(c, job_id)["status"] == "cancelled"
            assert (tmp_path / "models/test-model/a.bin.part").stat().st_size > 0
            assert c.get("/v1/models").json()[0]["status"] == "not_installed"
    finally:
        slow.close()


def test_delete_model(tmp_path, server):
    with client_for(tmp_path, spec_for(server)) as c:
        wait_for(c, c.post("/v1/models/test-model/download").json()["id"])
        assert c.delete("/v1/models/test-model").status_code == 204
        assert c.get("/v1/models").json()[0]["status"] == "not_installed"
        assert not (tmp_path / "models/test-model").exists()
        assert c.delete("/v1/models/nope").json()["error"] == "not_found"


KOKORO_DIR = os.environ.get("VOXD_TEST_KOKORO_DIR")


@pytest.mark.skipif(not KOKORO_DIR, reason="set VOXD_TEST_KOKORO_DIR to a folder with the real Kokoro files")
def test_real_kokoro_speaks(tmp_path):
    store = ModelStore(tmp_path / "models")
    spec = store.get("kokoro-v1")
    target = store.dir(spec)
    target.mkdir(parents=True)
    for f in spec.files:
        (target / f.name).symlink_to(Path(KOKORO_DIR) / f.name)
    (target / "installed.json").write_text("{}")

    engine = KokoroEngine(store)
    assert engine.probe() is None
    voices = engine.voices()
    heart = next(v for v in voices if v.id == "af_heart")
    assert (heart.name, heart.language, heart.gender) == ("Heart", "en-US", "female")
    out = tmp_path / "k.wav"
    engine.synthesize("Kokoro is working.", "af_heart", 1.0, out)
    assert out.stat().st_size > 20_000


def test_catalog_hashes_are_well_formed():
    for spec in CATALOG:
        for f in spec.files:
            assert len(f.sha256) == 64 and f.size > 0 and f.url.startswith("https://")


def test_mirror_overrides_download_url(tmp_path, server):
    mirrored = Server({"test-model/a.bin": BLOB_A, "test-model/b.bin": BLOB_B})
    try:
        spec = spec_for(server)  # original URLs point at `server`
        app = create_app(Settings(data_dir=tmp_path, token=TOKEN, model_mirror=mirrored.url), Registry([FakeEngine()]), catalog=(spec,))
        with TestClient(app) as c:
            c.headers["Authorization"] = f"Bearer {TOKEN}"
            assert wait_for(c, c.post("/v1/models/test-model/download").json()["id"])["status"] == "succeeded"
        assert server.ranges == [] and len(mirrored.ranges) == 2
    finally:
        mirrored.close()
