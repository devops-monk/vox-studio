import os
import time

from test_api import client  # noqa: F401  (fixture)


def test_storage_usage_and_cleanup(client):
    services = client.app.state.services
    take = client.post("/v1/speech", json={"text": "Keep me", "voice": "v1"}).json()
    root = services.settings.data_dir
    (root / "uploads").mkdir(exist_ok=True)
    old = time.time() - 7200

    leftovers = [root / "uploads" / "orphan.wav", root / "takes" / "deadbeef.wav", root / "takes" / ".scratch", root / "dubs" / "gone"]
    for p in leftovers:
        if p.suffix:
            p.write_bytes(b"x" * 1000)
        else:
            p.mkdir(parents=True)
            (p / "part.wav").write_bytes(b"x" * 500)
            os.utime(p / "part.wav", (old, old))
        os.utime(p, (old, old))
    fresh = root / "uploads" / "fresh.wav"
    fresh.write_bytes(b"x")

    usage = client.get("/v1/storage").json()
    parts = {p["id"]: p["bytes"] for p in usage["parts"]}
    assert parts["takes"] > 1000 and "database" in parts and usage["total"] == sum(parts.values())

    res = client.post("/v1/storage/cleanup").json()
    assert res["removed"] == 4 and res["freed_bytes"] >= 3000
    assert not any(p.exists() for p in leftovers)
    assert fresh.exists()  # too new to touch
    assert (root / "takes" / f"{take['id']}.wav").exists()


def test_model_mirror_setting(client):
    assert client.get("/v1/settings").json()["model_mirror"] == ""
    assert client.patch("/v1/settings", json={"model_mirror": "ftp://x"}).json()["error"] == "invalid_setting"
    assert client.patch("/v1/settings", json={"model_mirror": "https://models.example.com/voxd/"}).json()["model_mirror"] == "https://models.example.com/voxd"
    assert client.app.state.services.models.mirror == "https://models.example.com/voxd"
    assert client.patch("/v1/settings", json={"model_mirror": ""}).json()["model_mirror"] == ""


def test_unload(client):
    assert client.post("/v1/engines/unload").json() == {"unloaded": []}
