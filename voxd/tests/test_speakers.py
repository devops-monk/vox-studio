import numpy as np

from voxd.speakers import assign, cluster


def unit(v):
    v = np.asarray(v, dtype=np.float32)
    return v / np.linalg.norm(v)


def voice(base, jitter, seed):
    rng = np.random.default_rng(seed)
    return unit(base + jitter * rng.standard_normal(len(base))).tolist()


A, B, C = (np.eye(16)[i] * 3 + 0.2 for i in range(3))


def segs(spec):
    t, out = 0.0, []
    for dur in spec:
        out.append({"start": t, "end": t + dur, "speaker": "S1"})
        t += dur + 0.2
    return out


def test_cluster_threshold_and_forced_count():
    vecs = np.array([voice(A, 0.3, i) for i in range(4)] + [voice(B, 0.3, 10 + i) for i in range(4)], dtype=np.float32)
    labels = cluster(vecs)
    assert len(set(labels[:4])) == 1 and len(set(labels[4:])) == 1 and labels[0] != labels[4]
    assert len(set(cluster(vecs, n_speakers=1))) == 1
    assert len(set(cluster(vecs, n_speakers=3))) == 3


def test_assign_orders_speakers_and_fills_short_lines():
    s = segs([2.0, 2.0, 0.5, 2.0, 0.2, 2.0])
    emb = [voice(A, 0.2, 1), voice(B, 0.2, 2), voice(B, 0.2, 3), voice(A, 0.2, 4), None, voice(C, 0.2, 5)]
    assert assign(s, emb) == 3
    assert [x["speaker"] for x in s] == ["S1", "S2", "S2", "S1", "S1", "S3"]  # short line → nearest; unembeddable → previous
    assert assign(s, emb, n_speakers=2) == 2


def test_no_reliable_lines_means_one_speaker():
    s = segs([0.5, 0.5])
    assert assign(s, [None, None]) == 1 and {x["speaker"] for x in s} == {"S1"}
