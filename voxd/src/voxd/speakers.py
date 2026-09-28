"""Speaker detection for dubbing: who says each line.

Each transcribed line gets a speaker embedding (CAM++, in the media worker). Lines long enough
to be reliable are grouped by average-linkage clustering on cosine similarity; short lines then
join the closest speaker (or their neighbour's, if they're too short to embed at all).
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from .models import SPEAKER_MODEL

if TYPE_CHECKING:
    from .app import Services
    from .jobs import JobContext

MIN_RELIABLE_S = 1.0
SAME_SPEAKER = 0.5  # merge clusters while their average similarity is above this
MAX_SPEAKERS = 8


def cluster(vectors: np.ndarray, n_speakers: int | None = None, threshold: float = SAME_SPEAKER) -> list[int]:
    """Average-linkage agglomerative clustering; returns a cluster index per row."""
    n = len(vectors)
    if n == 0:
        return []
    sim = vectors @ vectors.T
    np.fill_diagonal(sim, -np.inf)
    sizes = np.ones(n)
    alive = np.ones(n, dtype=bool)
    members = [[i] for i in range(n)]
    target = max(1, min(n_speakers or 1, n)) if n_speakers else 1
    while alive.sum() > target:
        masked = np.where(alive[:, None] & alive[None, :], sim, -np.inf)
        a, b = np.unravel_index(np.argmax(masked), masked.shape)
        if not n_speakers and masked[a, b] < threshold:
            break
        # Lance–Williams update for average linkage: merge b into a.
        merged = (sizes[a] * sim[a] + sizes[b] * sim[b]) / (sizes[a] + sizes[b])
        sim[a], sim[:, a] = merged, merged
        sim[a, a] = -np.inf
        sizes[a] += sizes[b]
        alive[b] = False
        members[a] += members[b]
    labels = [0] * n
    for k, i in enumerate(i for i in range(n) if alive[i]):
        for j in members[i]:
            labels[j] = k
    return labels


def assign(segments: list[dict], embeddings: list[list[float] | None], n_speakers: int | None = None) -> int:
    """Set ``speaker`` ("S1", "S2", … in order of appearance) on each segment; returns the count."""
    reliable = [i for i, (s, e) in enumerate(zip(segments, embeddings)) if e is not None and s["end"] - s["start"] >= MIN_RELIABLE_S]
    if not reliable:
        for s in segments:
            s["speaker"] = "S1"
        return 1
    vectors = np.array([embeddings[i] for i in reliable], dtype=np.float32)
    labels = cluster(vectors, min(n_speakers, MAX_SPEAKERS) if n_speakers else None)
    # Too many clusters in auto mode: keep merging the closest until MAX_SPEAKERS.
    if not n_speakers and max(labels) + 1 > MAX_SPEAKERS:
        labels = cluster(vectors, MAX_SPEAKERS)
    centroids = np.stack([vectors[[j for j, l in enumerate(labels) if l == k]].mean(axis=0) for k in range(max(labels) + 1)])
    raw: list[int | None] = [None] * len(segments)
    for i, label in zip(reliable, labels):
        raw[i] = label
    for i, e in enumerate(embeddings):
        if raw[i] is None and e is not None:
            raw[i] = int(np.argmax(centroids @ np.asarray(e, dtype=np.float32)))
    for i in range(len(segments)):  # too short to embed: same speaker as the line before (or after)
        if raw[i] is None:
            raw[i] = next((raw[j] for j in range(i - 1, -1, -1) if raw[j] is not None), None)
            if raw[i] is None:
                raw[i] = next(raw[j] for j in range(i + 1, len(segments)) if raw[j] is not None)
    order: dict[int, str] = {}
    for i, seg in enumerate(segments):
        order.setdefault(raw[i], f"S{len(order) + 1}")  # type: ignore[arg-type]
        seg["speaker"] = order[raw[i]]  # type: ignore[index]
    return len(order)


def detect(services: Services, ctx: JobContext, speech_wav: Path, segments: list[dict], n_speakers: int | None, span: tuple[float, float]) -> int:
    lo, hi = span
    if not services.models.installed(SPEAKER_MODEL):
        ctx.progress(lo, "Downloading speaker detection")
        services.models.download(ctx, SPEAKER_MODEL, span=(lo, lo + (hi - lo) * 0.5))
    ctx.progress(lo + (hi - lo) * 0.5, "Telling the speakers apart")
    model = services.models.dir(SPEAKER_MODEL) / "campplus.onnx"
    result: dict[str, Any] = services.media.call("embed", path=str(speech_wav), spans=[[s["start"], s["end"]] for s in segments], model=str(model))
    return assign(segments, result["embeddings"], n_speakers)
