import json
import wave
from io import BytesIO

from test_api import TOKEN, client  # noqa: F401  (fixture)


def test_api_keys(client):
    created = client.post("/v1/keys", json={"name": "n8n"})
    assert created.status_code == 201
    key = created.json()["key"]
    assert key.startswith("vox_sk_") and created.json()["hint"].startswith("vox_sk_")
    listed = client.get("/v1/keys").json()
    assert listed[0]["name"] == "n8n" and "key" not in listed[0] and listed[0]["last_used_at"] is None

    as_key = {"Authorization": f"Bearer {key}"}
    assert client.get("/v1/engines", headers=as_key).status_code == 200
    assert client.get("/v1/keys").json()[0]["last_used_at"] is not None
    # A key can't mint or list keys.
    assert client.get("/v1/keys", headers=as_key).json()["error"] == "forbidden"
    assert client.post("/v1/keys", json={"name": "x"}, headers=as_key).status_code == 403
    assert client.get("/v1/engines", headers={"Authorization": "Bearer vox_sk_nope"}).status_code == 401

    assert client.delete(f"/v1/keys/{listed[0]['id']}").status_code == 204
    assert client.get("/v1/engines", headers=as_key).status_code == 401


def test_openai_speech(client):
    res = client.post("/v1/audio/speech", json={"model": "tts-1", "input": "Hello there", "voice": "v1", "response_format": "wav"})
    assert res.status_code == 200 and res.headers["content-type"] == "audio/wav"
    with wave.open(BytesIO(res.content)) as w:
        assert w.getframerate() == 24000
    assert client.get("/v1/takes").json()[0]["id"] == res.headers["x-voxd-take-id"]

    pcm = client.post("/v1/audio/speech", json={"input": "Hi", "voice": "v1", "response_format": "pcm"})
    assert pcm.headers["content-type"] == "audio/L16" and len(pcm.content) == 24000  # 0.5 s × 24 kHz × 2 bytes

    # OpenAI names fall back to the default engine when Kokoro isn't installed.
    assert client.post("/v1/audio/speech", json={"input": "Hi", "voice": "nova", "response_format": "wav"}).status_code == 200

    err = client.post("/v1/audio/speech", json={"input": "Hi", "voice": "v1"}).json()  # mp3 needs the media runtime
    assert err["error"]["code"] == "unsupported_format" and err["error"]["param"] == "response_format"
    err = client.post("/v1/audio/speech", json={"input": "Hi", "voice": "nobody", "response_format": "wav"}).json()
    assert err["error"]["param"] == "voice"
    err = client.post("/v1/audio/speech", json={"input": "", "voice": "v1"}).json()
    assert err["error"]["type"] == "invalid_request_error" and err["error"]["param"] == "input"


def test_openai_transcription_needs_whisper(client):
    res = client.post("/v1/audio/transcriptions", data={"model": "whisper-1"}, files={"file": ("a.wav", b"RIFF")})
    assert res.status_code == 400 and res.json()["error"]["code"] == "engine_unavailable"


def rpc(client, method, params=None, id_=1):
    msg = {"jsonrpc": "2.0", "method": method, **({"params": params} if params is not None else {})}
    if id_ is not None:
        msg["id"] = id_
    return client.post("/mcp", json=msg)


def test_mcp(client, tmp_path):
    init = rpc(client, "initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}).json()
    assert init["result"]["protocolVersion"] == "2025-03-26" and init["result"]["serverInfo"]["name"] == "voxstudio"
    assert rpc(client, "notifications/initialized", id_=None).status_code == 202
    tools = {t["name"] for t in rpc(client, "tools/list").json()["result"]["tools"]}
    assert {"speak", "list_voices", "transcribe", "clean_audio", "convert_voice", "add_pronunciation"} <= tools

    voices = rpc(client, "tools/call", {"name": "list_voices", "arguments": {"language": "en"}}).json()["result"]
    assert "v1\tVoice One" in voices["content"][0]["text"]

    out = tmp_path / "hello.wav"
    spoke = rpc(client, "tools/call", {"name": "speak", "arguments": {"text": "Hello", "voice": "v1", "save_to": str(out)}}).json()["result"]
    assert not spoke.get("isError") and str(out) in spoke["content"][0]["text"] and out.exists()
    assert client.get("/v1/exports").json()[0]["path"] == str(out)

    bad = rpc(client, "tools/call", {"name": "speak", "arguments": {"text": "x", "voice": "v1", "save_to": str(tmp_path / "a.xyz")}}).json()["result"]
    assert bad["isError"] and "Unsupported file type" in bad["content"][0]["text"]
    assert rpc(client, "tools/call", {"name": "speak", "arguments": {}}).json()["result"]["isError"]
    assert rpc(client, "tools/call", {"name": "transcribe", "arguments": {"path": "/nope.wav"}}).json()["result"]["isError"]

    said = rpc(client, "tools/call", {"name": "add_pronunciation", "arguments": {"term": "SQL", "say": "sequel"}}).json()["result"]
    assert "sequel" in said["content"][0]["text"]
    assert client.post("/v1/pronunciations/preview", json={"text": "SQL"}).json()["text"] == "sequel"

    assert rpc(client, "nope").json()["error"]["code"] == -32601
    assert client.post("/mcp", content=b"{", headers={"content-type": "application/json"}).json()["error"]["code"] == -32700
    batch = client.post("/mcp", json=[{"jsonrpc": "2.0", "id": 7, "method": "ping"}, {"jsonrpc": "2.0", "method": "notifications/initialized"}]).json()
    assert batch == [{"jsonrpc": "2.0", "id": 7, "result": {}}]


def test_discovery_file(client):
    info = json.loads((client.app.state.services.settings.data_dir / "voxd.json").read_text())
    assert info["url"].startswith("http://127.0.0.1:") and info["pid"]


def test_connection(client):
    c = client.get("/v1/connection").json()
    assert c["mcp_url"].endswith("/mcp") and c["bridge_path"].endswith("mcp_bridge.py") and c["auth_required"] is True


def test_read_local_file_is_app_only(client, tmp_path):
    f = tmp_path / "clip.wav"
    f.write_bytes(b"RIFFdata")
    assert client.get("/v1/files/read", params={"path": str(f)}).content == b"RIFFdata"
    assert client.get("/v1/files/read", params={"path": str(tmp_path / "secret.key")}).json()["error"] == "unsupported_file"
    assert client.get("/v1/files/read", params={"path": "clip.wav"}).json()["error"] == "unsupported_file"  # must be absolute
    assert client.get("/v1/files/read", params={"path": str(tmp_path / "gone.mp3")}).status_code == 404
    key = client.post("/v1/keys", json={"name": "script"}).json()["key"]
    assert client.get("/v1/files/read", params={"path": str(f)}, headers={"Authorization": f"Bearer {key}"}).status_code == 403
