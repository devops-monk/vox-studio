# Voice design

Design new voices from a description. voxd blends the voices of the Kokoro engine to match what you describe. A blend is a new voice: a weighted mix of existing voices' style vectors.

**How it works**
1. **Analyze** (once, about a minute): voxd renders a reference sentence with each English Kokoro voice and measures its **pitch**, **brightness** and **expressiveness**. The results are cached.
2. **Describe**: words in your description set targets on three axes (**depth**, **warmth**, **energy**), plus gender, accent and pace.
3. **Blend**: voxd picks the voices closest to the target and mixes them into up to four candidates.

Each candidate has a `recipe` such as `mix:bm_george=0.576,bm_daniel=0.424`, which you can pass directly as the `voice` to [`/v1/speech`](speech.md) or [jobs](jobs.md) with `engine: "kokoro"`.

## `GET /v1/design/status`
```json
{ "ready": true, "analyzed_voices": 28, "job_id": null }
```

## `POST /v1/design/analyze`
Starts the one-time analysis [job](jobs.md) (or returns the one already running). Needs Kokoro installed. When it finishes, a `design.ready` [event](events.md) is sent.
**Response 202**: the job. **Errors:** `400 engine_unavailable`

## `POST /v1/design/candidates`
| Field | Type | Description |
|---|---|---|
| `description` | string | Up to 500 characters |
| `depth` | number | Optional override, `0` light/high to `1` deep/low |
| `warmth` | number | Optional override, `0` crisp/bright to `1` warm/soft |
| `energy` | number | Optional override, `0` calm/steady to `1` lively/expressive |
| `gender` | string | Optional override: `female` or `male` |

```bash
curl -s -X POST "$VOXD/v1/design/candidates" -H "Authorization: Bearer $VOXD_TOKEN" -H "Content-Type: application/json" \
  -d '{"description": "A warm, deep British narrator, calm and measured"}'
```
```json
{
  "target": { "gender": null, "language": "en-GB", "depth": 0.9, "warmth": 0.85, "energy": 0.15, "speed": 1.0,
              "matched": ["british", "deep", "warm", "calm"] },
  "candidates": [
    { "recipe": "mix:bm_george=0.576,bm_daniel=0.424", "voices": ["bm_george", "bm_daniel"], "score": 0.862, "traits": [0.677, 0.856, 0.235] }
  ]
}
```
- `target` shows how the description was read. `null` means no preference.
- Each candidate's `score` (0–1) says how closely the blend's `traits` ([depth, warmth, energy]) match the target.

**Errors:** `409 not_analyzed`

### Words voxd understands
| Axis | Words |
|---|---|
| Gender | female, woman, girl, lady · male, man, guy, gentleman |
| Accent | British, UK, English accent, London · American, USA |
| Depth | deep, low, bass, baritone, gravelly, husky · high, light, airy, young, youthful |
| Warmth | warm, soft, smooth, gentle, rich, mellow, soothing · crisp, clear, bright, sharp, precise |
| Energy | energetic, excited, lively, upbeat, cheerful, expressive · calm, relaxed, measured, steady, serene |
| Pace | fast, quick, brisk · slow, unhurried, deliberate |

Adverb forms count too ("clearly", "warmly"). "High energy" means lively, not high-pitched.

## Designed voices
Save a candidate to use it again. Designed voice ids start with `dv_`, and they appear in [`GET /v1/voices?engine=kokoro`](voices.md) and in the [library](voices.md#get-v1voiceslibrary) with `designed: true`.

### `POST /v1/voices/designed`
| Field | Type | Description |
|---|---|---|
| `name` | string | 1–60 characters |
| `recipe` | string | A candidate's `recipe` (1–4 voices) |
| `description` | string | Optional, kept for reference |
| `speed` | number | `0.7`–`1.4`, the voice's built-in pace. Multiplied with the request's `speed`. |

**Response 201**: `{id, name, recipe, description, language, gender, speed, created_at}`. **Errors:** `400 invalid_recipe`

### `GET /v1/voices/designed` · `PATCH /v1/voices/designed/{id}` (`{"name": …}`) · `DELETE /v1/voices/designed/{id}`

## Limits
- Design blends English Kokoro voices (American and British). Other languages are planned.
- Blends stay within Kokoro's range: good for mixing character, but they can't invent sounds far outside it (whispering, strong regional accents).
