import io
import json
import zipfile

from test_voices_settings import CONSENT, client, upload, wav_bytes  # noqa: F401  (fixture)


def test_library_lists_engine_and_custom_voices(client):
    voice = upload(client, name="Narrator").json()
    lib = client.get("/v1/voices/library").json()
    custom = [v for v in lib if v["custom"]]
    assert [v["id"] for v in custom] == [voice["id"]]
    assert custom[0]["available"] is False  # no cloning engine in the test registry
    builtin = [v for v in lib if not v["custom"]]
    assert {"engine": "fake", "id": "v1"}.items() <= builtin[0].items()


def test_favorites_and_tags(client):
    voice = upload(client).json()
    assert client.put("/v1/voices/meta", json={"engine": "fake", "voice": "v1", "favorite": True}).status_code == 204
    client.put("/v1/voices/meta", json={"engine": "any", "voice": voice["id"], "tags": [" warm ", "narration", "warm", ""]})
    lib = {v["id"]: v for v in client.get("/v1/voices/library").json()}
    assert lib["v1"]["favorite"] is True and lib["v1"]["tags"] == []
    assert lib[voice["id"]]["tags"] == ["narration", "warm"]
    # Setting only tags must not clear the favorite, and vice versa.
    client.put("/v1/voices/meta", json={"engine": "fake", "voice": "v1", "tags": ["calm"]})
    lib = {v["id"]: v for v in client.get("/v1/voices/library").json()}
    assert lib["v1"]["favorite"] is True and lib["v1"]["tags"] == ["calm"]


def test_consent_by_is_recorded(client):
    res = client.post(
        "/v1/voices/custom",
        data={"name": "Ana", "consent": CONSENT, "consent_by": "Ana Lopez"},
        files={"audio": ("a.wav", wav_bytes(5), "audio/wav")},
    )
    assert res.json()["consent_by"] == "Ana Lopez"


def test_export_import_roundtrip(client, tmp_path):
    voice = upload(client, name="Travel Voice").json()
    client.put("/v1/voices/meta", json={"engine": "x", "voice": voice["id"], "tags": ["travel"]})
    dest = tmp_path / "travel.voxvoice"
    assert client.post(f"/v1/voices/custom/{voice['id']}/export", json={"path": str(dest)}).status_code == 204

    with zipfile.ZipFile(dest) as z:
        manifest = json.loads(z.read("manifest.json"))
        assert set(z.namelist()) == {"manifest.json", "reference.wav"}
    assert manifest["format"] == "voxvoice" and manifest["tags"] == ["travel"] and manifest["consent"] == CONSENT

    res = client.post(
        "/v1/voices/custom/import",
        data={"consent": "I have permission from the speaker to use this voice."},
        files={"file": ("travel.voxvoice", dest.read_bytes(), "application/zip")},
    )
    assert res.status_code == 201, res.text
    imported = res.json()
    assert imported["name"] == "Travel Voice" and imported["id"] != voice["id"]
    assert "Imported; original consent" in imported["consent"] and CONSENT in imported["consent"]
    lib = {v["id"]: v for v in client.get("/v1/voices/library").json()}
    assert lib[imported["id"]]["tags"] == ["travel"]


def test_import_rejects_bad_files(client):
    def imp(data):
        return client.post("/v1/voices/custom/import", data={"consent": CONSENT}, files={"file": ("x.voxvoice", data, "application/zip")})

    assert imp(b"plainly not a zip").json()["error"] == "invalid_voice_file"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("manifest.json", json.dumps({"format": "voxvoice", "version": 99, "name": "Future"}))
        z.writestr("reference.wav", wav_bytes(5))
    assert "newer version" in imp(buf.getvalue()).json()["message"]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("manifest.json", json.dumps({"format": "voxvoice", "version": 1, "name": "Short"}))
        z.writestr("reference.wav", wav_bytes(1))
    assert "at least 3 seconds" in imp(buf.getvalue()).json()["message"]


def test_export_requires_voxvoice_suffix(client, tmp_path):
    voice = upload(client).json()
    res = client.post(f"/v1/voices/custom/{voice['id']}/export", json={"path": str(tmp_path / "v.zip")})
    assert res.json()["error"] == "invalid_path"


def test_deleting_voice_clears_its_meta(client):
    voice = upload(client).json()
    client.put("/v1/voices/meta", json={"engine": "x", "voice": voice["id"], "favorite": True})
    client.delete(f"/v1/voices/custom/{voice['id']}")
    assert [v for v in client.get("/v1/voices/library").json() if v["custom"]] == []
