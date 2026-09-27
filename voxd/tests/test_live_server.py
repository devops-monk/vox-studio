"""Runs voxd under a real uvicorn server — catches missing server deps (e.g. WebSocket support)
that the in-process TestClient can't see."""

import json
import socket
import threading
import time
import urllib.request

import uvicorn
from websockets.sync.client import connect

from voxd.app import create_app
from voxd.config import Settings
from voxd.engines.registry import Registry

from test_api import TOKEN, FakeEngine


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_real_server_serves_websocket_events(tmp_path):
    port = free_port()
    app = create_app(Settings(data_dir=tmp_path, port=port, token=TOKEN), Registry([FakeEngine()]))
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)

        with connect(f"ws://127.0.0.1:{port}/v1/events?token={TOKEN}", open_timeout=5) as ws:
            assert json.loads(ws.recv(timeout=5))["type"] == "hello"
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/v1/speech",
                data=json.dumps({"text": "Hi", "voice": "v1"}).encode(),
                headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=5).read()
            assert json.loads(ws.recv(timeout=5))["type"] == "take.created"
    finally:
        server.should_exit = True
        thread.join(timeout=5)
