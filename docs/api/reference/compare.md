# Compare (blind ratings)

## `POST /v1/ratings`
Record which of two voices read a sentence better.
```json
{ "language": "en", "text": "The quick brown fox…",
  "a": {"engine": "kokoro", "voice": "af_nova"}, "b": {"engine": "chatterbox", "voice": "cv_ab12cd34"},
  "winner": "a" }
```
`winner` is `a`, `b` or `tie`. The language is stored in lower case. Returns `201` with the rating, plus `id` and `at`. Comparing a voice with itself returns `400 invalid_request`.

## `GET /v1/ratings/leaderboard?language=en`
Voices ranked by Elo: every voice starts at 1000, with K = 32, replayed over all ratings in order. Leave out `language` to rank across all languages.
```json
{ "language": "en", "ratings": 6,
  "voices": [{"engine": "kokoro", "voice": "bm_fable", "score": 1030.0, "games": 4, "wins": 2, "losses": 0, "ties": 2}, …] }
```

## `DELETE /v1/ratings?language=en`
Forget ratings, for one language or all of them. Returns `{"deleted": 6}`.

**Event:** `ratings.changed` (`{"language"}`).
