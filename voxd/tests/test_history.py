import time

from voxd.history import sweep

from test_voices_settings import client  # noqa: F401  (fixture)


def speak(client, text, **extra):
    return client.post("/v1/speech", json={"text": text, "voice": "v1", **extra}).json()


def test_search_filter_and_paging(client):
    a = speak(client, "The quick brown fox")
    b = speak(client, "100% sure_about it")
    c = speak(client, "Another quick one")
    client.put(f"/v1/takes/{c['id']}/star", json={"starred": True})

    ids = lambda **q: [t["id"] for t in client.get("/v1/takes", params=q).json()]  # noqa: E731
    assert ids(q="quick") == [c["id"], a["id"]]
    assert ids(q="QUICK BROWN") == [a["id"]]
    assert ids(q="100%") == [b["id"]]  # wildcards are literal
    assert ids(q="k_b") == []  # `_` is not a wildcard (would match "quick brown")
    assert ids(q="e_a") == [b["id"]]  # but a literal underscore matches
    assert ids(starred=True) == [c["id"]]
    assert ids(engine="fake", limit=2) == [c["id"], b["id"]]
    assert ids(before=b["created_at"]) == [a["id"]]


def test_delete_one_and_many(client, tmp_path):
    a, b, c = (speak(client, f"take {i}") for i in range(3))
    assert client.delete(f"/v1/takes/{a['id']}").status_code == 204
    assert not (tmp_path / "takes" / f"{a['id']}.wav").exists()
    assert client.delete(f"/v1/takes/{a['id']}").json()["error"] == "not_found"
    res = client.post("/v1/takes/delete", json={"ids": [b["id"], "nope"]}).json()
    assert res == {"deleted": [b["id"]]}
    stats = client.get("/v1/takes/stats").json()
    assert stats["count"] == 1 and stats["bytes"] > 0


def test_retention_keeps_starred_and_recent(client):
    old = speak(client, "old")
    old_starred = speak(client, "old but starred")
    recent = speak(client, "recent")
    client.put(f"/v1/takes/{old_starred['id']}/star", json={"starred": True})
    services = client.app.state.services

    assert client.patch("/v1/settings", json={"history_retention_days": 5}).json()["error"] == "invalid_setting"
    assert client.patch("/v1/settings", json={"history_retention_days": 7}).json()["history_retention_days"] == 7
    # Nothing is old enough yet.
    assert {t["id"] for t in client.get("/v1/takes").json()} == {old["id"], old_starred["id"], recent["id"]}

    ten_days_later = time.time() + 10 * 86400
    services.store._db.execute("UPDATE takes SET created_at = ? WHERE id = ?", (time.time(), recent["id"]))
    services.store._db.execute("UPDATE takes SET created_at = created_at - 1 WHERE id != ?", (recent["id"],))
    services.store._db.execute("UPDATE takes SET created_at = ? WHERE id = ?", (ten_days_later, recent["id"]))
    assert sweep(services, now=ten_days_later) == 1
    assert {t["id"] for t in client.get("/v1/takes").json()} == {old_starred["id"], recent["id"]}


def test_retention_off_keeps_everything(client):
    speak(client, "forever")
    assert sweep(client.app.state.services, now=time.time() + 10_000 * 86400) == 0
