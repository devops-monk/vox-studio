"""Chatterbox worker. Runs inside its own runtime pack (never imports voxd).

    python chatterbox_worker.py --model-dir DIR --device auto|cpu|mps|cuda
"""

import argparse
import json
import os
import sys
import wave

# Keep the protocol channel clean: libraries that print() go to stderr instead.
_proto = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr


def send(msg):
    _proto.write(json.dumps(msg) + "\n")
    _proto.flush()


def pick_device(requested):
    import torch

    if requested != "auto":
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load(model_dir, device):
    from chatterbox.tts import ChatterboxTTS

    try:
        return ChatterboxTTS.from_local(model_dir, device), device
    except Exception as exc:  # e.g. an op unsupported on this GPU backend
        if device == "cpu":
            raise
        print(f"loading on {device} failed ({exc}); falling back to cpu", file=sys.stderr)
        return ChatterboxTTS.from_local(model_dir, "cpu"), "cpu"


def write_wav(path, samples, rate):
    import numpy as np

    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--device", default="auto")
    args = parser.parse_args()

    try:
        import torch

        device = pick_device(args.device)
        model, device = load(args.model_dir, device)
    except Exception as exc:
        send({"ready": False, "error": f"Couldn't load Chatterbox: {exc}"})
        return
    default_conds = model.conds
    voices = {}  # reference path -> prepared conditionals
    send({"ready": True, "device": device, "torch": torch.__version__, "sample_rate": model.sr})

    for line in sys.stdin:
        req = json.loads(line)
        try:
            if req["op"] == "ping":
                send({"id": req["id"], "ok": True})
                continue
            if req["op"] != "synthesize":
                raise ValueError(f"unknown op {req['op']}")
            ref = req.get("ref")
            exaggeration = float(req.get("exaggeration", 0.5))
            if ref:
                if ref not in voices:
                    model.prepare_conditionals(ref, exaggeration=exaggeration)
                    voices[ref] = model.conds
                model.conds = voices[ref]
            else:
                model.conds = default_conds
            wav = model.generate(
                req["text"],
                exaggeration=exaggeration,
                cfg_weight=float(req.get("cfg_weight", 0.5)),
                temperature=float(req.get("temperature", 0.8)),
            )
            samples = wav.squeeze(0).detach().cpu().numpy()
            speed = float(req.get("speed", 1.0))
            if abs(speed - 1.0) > 0.01:
                import librosa

                samples = librosa.effects.time_stretch(samples, rate=speed)
            write_wav(req["out"], samples, model.sr)
            send({"id": req["id"], "ok": True, "sample_rate": model.sr})
        except Exception as exc:
            send({"id": req["id"], "ok": False, "error": str(exc)})


if __name__ == "__main__":
    main()
