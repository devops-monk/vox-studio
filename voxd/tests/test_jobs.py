import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from voxd.app import create_app
from voxd.config import Settings
from voxd.engines.registry import Registry
from voxd.speech import split_text
from voxd.store import Store

from test_api import TOKEN, FakeEngine

LONG = " ".join(f"This is sentence number {i}, and it is here to make the text long." for i in range(40))


def make_client(tmp_path, delay=0.0):
    engine = FakeEngine()
    engine.delay = delay
    app = create_app(Settings(data_dir=tmp_path, token=TOKEN), Registry([engine]))
    client = TestClient(app)
    client.headers["Authorization"] = f"Bearer {TOKEN}"
    return client


def wait_for(client, job_id, statuses=("succeeded", "failed", "cancelled"), timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/v1/jobs/{job_id}").json()
        if job["status"] in statuses:
            return job
        time.sleep(0.05)
    raise AssertionError(f"job stuck in {job['status']}")


def test_split_text_respects_limit_and_keeps_all_words():
    chunks = split_text(LONG, limit=200)
    assert len(chunks) > 1
    assert all(len(c) <= 200 for c in chunks)
    assert " ".join(chunks).split() == LONG.split()


def test_split_text_breaks_run_on_sentences():
    chunks = split_text("word " * 300, limit=100)
    assert all(len(c) <= 100 for c in chunks)


def test_speech_job_runs_to_completion(tmp_path):
    with make_client(tmp_path) as client:
        res = client.post("/v1/jobs/speech", json={"text": LONG, "voice": "v1"})
        assert res.status_code == 202
        job = wait_for(client, res.json()["id"])
        assert job["status"] == "succeeded", job
        assert job["progress"] == 1.0
        take_id = job["result"]["take_id"]
        # 40 sentences, chunked → several 0.5 s chunks joined into one take
        assert job["result"]["duration_s"] > 1.0
        assert client.get(f"/v1/takes/{take_id}/audio").status_code == 200
        assert not list((tmp_path / "takes").glob(".*")), "scratch dir must be cleaned up"


def test_events_replay_after_seq(tmp_path):
    with make_client(tmp_path) as client:
        job_id = client.post("/v1/jobs/speech", json={"text": LONG, "voice": "v1"}).json()["id"]
        wait_for(client, job_id)

        body = client.get(f"/v1/jobs/{job_id}/events").text
        seqs = [int(line[4:]) for line in body.splitlines() if line.startswith("id: ")]
        assert seqs == sorted(seqs) and seqs[0] == 1
        assert "event: progress" in body and body.rstrip().endswith("data: {}")

        resumed = client.get(f"/v1/jobs/{job_id}/events", params={"after": seqs[-2]}).text
        assert [int(l[4:]) for l in resumed.splitlines() if l.startswith("id: ")] == [seqs[-1]]


def test_cancel_running_job(tmp_path):
    with make_client(tmp_path, delay=0.2) as client:
        job_id = client.post("/v1/jobs/speech", json={"text": LONG, "voice": "v1"}).json()["id"]
        wait_for(client, job_id, statuses=("running",))
        client.post(f"/v1/jobs/{job_id}/cancel")
        assert wait_for(client, job_id)["status"] == "cancelled"
        assert client.get("/v1/takes").json() == []


def test_cancel_queued_job_is_immediate(tmp_path):
    with make_client(tmp_path, delay=0.2) as client:
        first = client.post("/v1/jobs/speech", json={"text": LONG, "voice": "v1"}).json()["id"]
        second = client.post("/v1/jobs/speech", json={"text": "Queued.", "voice": "v1"}).json()["id"]
        assert client.post(f"/v1/jobs/{second}/cancel").json()["status"] == "cancelled"
        client.post(f"/v1/jobs/{first}/cancel")
        wait_for(client, first)


def test_failed_job_reports_error(tmp_path):
    with make_client(tmp_path) as client:
        job_id = client.post("/v1/jobs/speech", json={"text": "Hi.", "voice": "nope"}).json()["id"]
        job = wait_for(client, job_id)
        assert job["status"] == "failed"
        assert job["error"] == "Unknown voice: nope"


def test_clear_finished_keeps_takes(tmp_path):
    with make_client(tmp_path) as client:
        wait_for(client, client.post("/v1/jobs/speech", json={"text": "Hi.", "voice": "v1"}).json()["id"])
        assert client.delete("/v1/jobs").json() == {"deleted": 1}
        assert client.get("/v1/jobs").json() == []
        assert len(client.get("/v1/takes").json()) == 1


def test_interrupted_jobs_fail_on_restart(tmp_path):
    with make_client(tmp_path, delay=0.3) as client:
        job_id = client.post("/v1/jobs/speech", json={"text": LONG, "voice": "v1"}).json()["id"]
        wait_for(client, job_id, statuses=("running",))
    # Simulate voxd dying mid-job: the row is still "running" on disk.
    store = Store(tmp_path / "voxd.db")
    store.update_job(job_id, status="running")
    store.close()
    with make_client(tmp_path) as client:
        job = client.get(f"/v1/jobs/{job_id}").json()
        assert job["status"] == "failed" and "Interrupted" in job["error"]


def test_websocket_requires_token_and_streams_events(tmp_path):
    with make_client(tmp_path) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/v1/events?token=wrong") as ws:
                ws.receive_json()

        with client.websocket_connect(f"/v1/events?token={TOKEN}") as ws:
            assert ws.receive_json()["type"] == "hello"
            client.post("/v1/speech", json={"text": "Hi", "voice": "v1"})
            message = ws.receive_json()
            assert message["type"] == "take.created"
            assert message["data"]["text"] == "Hi"
