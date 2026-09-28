from test_api import client  # noqa: F401  (fixture)


def test_tags_and_collections(client):
    a = client.post("/v1/speech", json={"text": "Episode one intro", "voice": "v1"}).json()
    b = client.post("/v1/speech", json={"text": "Episode two intro", "voice": "v1"}).json()
    p = client.post("/v1/projects", json={"name": "Podcast", "color": "#ff375f"}).json()

    assert client.put(f"/v1/takes/{a['id']}/tags", json={"tags": [" Podcast ", "Intro", "podcast"]}).json()["tags"] == ["intro", "podcast"]
    client.put(f"/v1/takes/{b['id']}/tags", json={"tags": ["podcast"]})
    assert client.put(f"/v1/projects/{p['id']}/tags", json={"tags": ["podcast", "2026"]}).json()["tags"] == ["2026", "podcast"]
    client.put("/v1/voices/meta", json={"engine": "fake", "voice": "v1", "tags": ["podcast"]})

    assert [t["id"] for t in client.get("/v1/takes", params={"tag": "Podcast"}).json()] == [b["id"], a["id"]]
    assert client.get("/v1/takes").json()[0]["tags"] == ["podcast"]
    assert client.get("/v1/projects").json()[0]["tags"] == ["2026", "podcast"]

    tags = {t["tag"]: t for t in client.get("/v1/tags").json()}
    assert tags["podcast"] == {"tag": "podcast", "voices": 1, "takes": 2, "projects": 1, "total": 4}
    assert client.get("/v1/tags").json()[0]["tag"] == "podcast"  # most used first

    coll = client.get("/v1/tags/podcast").json()
    assert coll["voices"] == [{"engine": "fake", "voice": "v1"}] and len(coll["takes"]) == 2 and coll["projects"][0]["id"] == p["id"]

    # Rename merges into an existing tag, everywhere (voices too).
    assert client.post("/v1/tags/intro/rename", json={"to": "Podcast"}).status_code == 204
    assert client.get(f"/v1/takes?tag=intro").json() == []
    assert client.get("/v1/tags/podcast").json()["takes"][1]["tags"] == ["podcast"]
    client.post("/v1/tags/podcast/rename", json={"to": "show"})
    assert client.get("/v1/tags/show").json()["voices"] == [{"engine": "fake", "voice": "v1"}]

    assert client.delete("/v1/tags/show").status_code == 204
    assert {t["tag"] for t in client.get("/v1/tags").json()} == {"2026"}
    assert len(client.get("/v1/takes").json()) == 2  # items survive

    client.post("/v1/takes/delete", json={"ids": [a["id"], b["id"]]})
    client.delete(f"/v1/projects/{p['id']}")
    assert client.get("/v1/tags").json() == []  # tags of deleted items go with them
    assert client.put("/v1/takes/nope/tags", json={"tags": ["x"]}).status_code == 404
