from test_voices_settings import client  # noqa: F401  (fixture)
from test_jobs import wait_for


def test_project_lifecycle_and_exports(client, tmp_path):
    p = client.post("/v1/projects", json={"name": "  Launch video  ", "color": "#ff375f"}).json()
    assert p["name"] == "Launch video" and p["item_count"] == 0

    take = client.post("/v1/speech", json={"text": "Voice-over for the intro.", "voice": "v1"}).json()
    book = client.post("/v1/books", data={"text": "Chapter 1\n\nOnce upon a time."}).json()
    assert client.post(f"/v1/projects/{p['id']}/items", json={"kind": "take", "id": take["id"]}).status_code == 204
    assert client.post(f"/v1/projects/{p['id']}/items", json={"kind": "take", "id": take["id"]}).status_code == 204  # idempotent
    client.post(f"/v1/projects/{p['id']}/items", json={"kind": "book", "id": book["id"]})
    assert client.post(f"/v1/projects/{p['id']}/items", json={"kind": "dub", "id": "nope"}).json()["error"] == "not_found"

    assert client.get("/v1/projects/membership", params={"kind": "take", "id": take["id"]}).json() == [p["id"]]

    # Exporting a take is recorded in the history (globally and for the project).
    dest = tmp_path / "intro.wav"
    client.post(f"/v1/takes/{take['id']}/export", json={"path": str(dest)})
    full = client.get(f"/v1/projects/{p['id']}").json()
    assert {i["kind"] for i in full["items"]} == {"take", "book"}
    assert full["items"][0]["title"] and full["exports"][0]["path"] == str(dest) and full["exports"][0]["exists"] is True
    assert client.get("/v1/exports").json()[0]["format"] == "wav"
    dest.unlink()
    assert client.get("/v1/exports").json()[0]["exists"] is False

    # Deleted items show as missing rather than breaking the project.
    client.delete(f"/v1/books/{book['id']}")
    items = {i["kind"]: i for i in client.get(f"/v1/projects/{p['id']}").json()["items"]}
    assert items["book"]["missing"] is True

    assert client.patch(f"/v1/projects/{p['id']}", json={"name": "Launch", "color": "#30d158"}).json()["color"] == "#30d158"
    assert client.patch(f"/v1/projects/{p['id']}", json={"color": "red"}).status_code == 422
    assert client.delete(f"/v1/projects/{p['id']}/items/take/{take['id']}").status_code == 204
    assert client.get("/v1/projects").json()[0]["item_count"] == 1
    assert client.delete(f"/v1/projects/{p['id']}").status_code == 204
    assert client.get(f"/v1/takes").json()[0]["id"] == take["id"]  # items survive project deletion
