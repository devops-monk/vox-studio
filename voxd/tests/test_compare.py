from test_api import client  # noqa: F401  (fixture)
from voxd.compare import leaderboard


def rate(client, a, b, winner, language="en"):
    return client.post("/v1/ratings", json={"language": language, "text": "Hello there.", "a": {"engine": "kokoro", "voice": a},
                                            "b": {"engine": "kokoro", "voice": b}, "winner": winner})


def test_ratings_and_leaderboard(client):
    assert rate(client, "af_nova", "am_onyx", "a").status_code == 201
    rate(client, "af_nova", "af_sky", "a")
    rate(client, "am_onyx", "af_sky", "tie")
    rate(client, "af_sky", "am_onyx", "b", language="EN")  # language is case-insensitive
    rate(client, "ef_dora", "em_alex", "a", language="es")
    board = client.get("/v1/ratings/leaderboard", params={"language": "en"}).json()
    assert board["ratings"] == 4
    top = board["voices"][0]
    assert top["voice"] == "af_nova" and top["wins"] == 2 and top["score"] > 1000
    onyx = next(v for v in board["voices"] if v["voice"] == "am_onyx")
    assert (onyx["wins"], onyx["losses"], onyx["ties"], onyx["games"]) == (1, 1, 1, 3)
    assert client.get("/v1/ratings/leaderboard").json()["ratings"] == 5
    assert rate(client, "af_nova", "af_nova", "a").json()["error"] == "invalid_request"
    assert rate(client, "a", "b", "maybe").status_code == 422
    assert client.delete("/v1/ratings", params={"language": "es"}).json() == {"deleted": 1}
    assert client.get("/v1/ratings/leaderboard").json()["ratings"] == 4


def test_elo_is_zero_sum():
    rows = leaderboard([{"a_engine": "k", "a_voice": "x", "b_engine": "k", "b_voice": "y", "winner": w} for w in ("a", "a", "b", "tie")])
    assert abs(sum(r["score"] for r in rows) - 2000) < 1e-6
