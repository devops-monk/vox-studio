"""Blind A/B comparisons: record which of two voices sounded better, and rank voices per language.

Ranking uses Elo (start 1000, K = 32), replayed over all ratings in time order, so it's stable,
explainable and needs no stored state beyond the ratings themselves.
"""

from __future__ import annotations

from collections import defaultdict

START = 1000.0
K = 32.0


def leaderboard(ratings: list[dict]) -> list[dict]:
    elo: dict[tuple[str, str], float] = defaultdict(lambda: START)
    stats: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: {"wins": 0, "losses": 0, "ties": 0})
    for r in ratings:
        a, b = (r["a_engine"], r["a_voice"]), (r["b_engine"], r["b_voice"])
        expected_a = 1 / (1 + 10 ** ((elo[b] - elo[a]) / 400))
        score_a = {"a": 1.0, "b": 0.0, "tie": 0.5}[r["winner"]]
        elo[a] += K * (score_a - expected_a)
        elo[b] += K * ((1 - score_a) - (1 - expected_a))
        if r["winner"] == "tie":
            stats[a]["ties"] += 1
            stats[b]["ties"] += 1
        else:
            win, lose = (a, b) if r["winner"] == "a" else (b, a)
            stats[win]["wins"] += 1
            stats[lose]["losses"] += 1
    rows = [
        {"engine": e, "voice": v, "score": round(elo[(e, v)], 1), "games": sum(st.values()), **st}
        for (e, v), st in stats.items()
    ]
    return sorted(rows, key=lambda r: (-r["score"], -r["wins"]))
