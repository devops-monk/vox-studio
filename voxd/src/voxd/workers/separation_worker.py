"""Demucs worker: split audio into voice and everything else. Runs in the `separation` runtime
pack (never imports voxd).

    python separation_worker.py --model FILE
"""

import argparse
import json
import os
import sys
import wave

_proto = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr

CHUNK_S = 60.0
OVERLAP_S = 2.0


def send(msg):
    _proto.write(json.dumps(msg) + "\n")
    _proto.flush()


def pick_device():
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def separate(model, device, path, out, progress):
    """Write everything except the voice (drums + bass + other) of a 16-bit stereo WAV to `out`."""
    import numpy as np
    import torch
    from demucs.apply import apply_model

    with wave.open(path, "rb") as w:
        rate, channels = w.getframerate(), w.getnchannels()
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    audio = pcm.reshape(-1, channels).T  # (channels, samples)
    if channels == 1:
        audio = np.repeat(audio, 2, axis=0)
    if rate != model.samplerate:
        raise ValueError(f"expected {model.samplerate} Hz audio, got {rate}")
    ref = audio.mean(axis=0)
    mean, std = float(ref.mean()), float(ref.std()) or 1.0
    audio = (audio - mean) / std

    keep = [i for i, name in enumerate(model.sources) if name != "vocals"]
    n = audio.shape[1]
    chunk, overlap = int(CHUNK_S * rate), int(OVERLAP_S * rate)
    result = np.zeros((2, n), dtype=np.float32)
    weight = np.zeros(n, dtype=np.float32)
    starts = list(range(0, max(1, n - overlap), chunk - overlap))
    for k, start in enumerate(starts):
        end = min(n, start + chunk)
        piece = torch.from_numpy(np.ascontiguousarray(audio[:, start:end]))[None]
        with torch.no_grad():
            sources = apply_model(model, piece, device=device, split=True, overlap=0.25, progress=False)[0]
        background = sources[keep].sum(dim=0).cpu().numpy()
        # Linear crossfade over the overlaps so chunk joins are seamless.
        w = np.ones(end - start, dtype=np.float32)
        if start > 0:
            w[:overlap] = np.linspace(0, 1, overlap, dtype=np.float32)
        if end < n:
            w[-overlap:] = np.minimum(w[-overlap:], np.linspace(1, 0, overlap, dtype=np.float32))
        result[:, start:end] += background * w
        weight[start:end] += w
        progress((k + 1) / len(starts))
        if end >= n:
            break
    result = result / np.maximum(weight, 1e-6) * std + mean
    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(result.T, -1, 1) * 32767).astype("<i2").tobytes())
    return {"sample_rate": rate, "seconds": n / rate}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    try:
        import torch
        from demucs.states import load_model

        # Demucs checkpoints store the model's class and arguments, which PyTorch ≥ 2.6 refuses to
        # unpickle by default. voxd only loads the checkpoint it downloaded itself, after checking it
        # against a pinned SHA-256, so a full load is safe here.
        package = torch.load(args.model, map_location="cpu", weights_only=False)
        model = load_model(package)
        model.eval()
        device = pick_device()
    except Exception as exc:
        send({"ready": False, "error": f"Couldn't load Demucs: {exc}"})
        return
    send({"ready": True, "device": device, "torch": torch.__version__, "sample_rate": model.samplerate})

    for line in sys.stdin:
        req = json.loads(line)
        try:
            if req["op"] == "ping":
                send({"id": req["id"], "ok": True})
                continue
            if req["op"] != "separate":
                raise ValueError(f"unknown op {req['op']}")
            try:
                result = separate(model, device, req["path"], req["out"], lambda x: send({"id": req["id"], "progress": x}))
            except RuntimeError as exc:  # an op missing on this GPU backend: fall back to the CPU
                if device == "cpu":
                    raise
                print(f"separation on {device} failed ({exc}); using cpu", file=sys.stderr)
                device = "cpu"
                result = separate(model, device, req["path"], req["out"], lambda x: send({"id": req["id"], "progress": x}))
            send({"id": req["id"], "ok": True, "device": device, **result})
        except Exception as exc:
            send({"id": req["id"], "ok": False, "error": str(exc)})


if __name__ == "__main__":
    main()
