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


def split_quiet(audio, rate, target_s=20.0, window_s=5.0):
    """Cut long audio into ~20 s spans at the quietest 50 ms nearby, so no word is split."""
    import numpy as np

    spans, start, hop = [], 0, int(rate * 0.05)
    while len(audio) - start > rate * (target_s + window_s):
        lo, hi = start + int(rate * (target_s - window_s)), start + int(rate * (target_s + window_s))
        frames = audio[lo:hi][: (hi - lo) // hop * hop].reshape(-1, hop)
        cut = lo + int(np.argmin((frames**2).mean(axis=1))) * hop + hop // 2
        spans.append((start, cut))
        start = cut
    spans.append((start, len(audio)))
    return spans


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
            if req["op"] == "convert":
                # Speech-to-speech: keep the words and timing of `src`, speak them in the target voice.
                import librosa
                import torch
                from chatterbox.models.s3gen import S3GEN_SR
                from chatterbox.models.s3tokenizer import S3_SR

                s3 = model.s3gen
                if req.get("ref"):
                    ref_wav, _ = librosa.load(req["ref"], sr=S3GEN_SR)
                    ref_dict = s3.embed_ref(ref_wav[: getattr(model, "DEC_COND_LEN", 10 * S3GEN_SR)], S3GEN_SR, device=model.device)
                else:
                    ref_dict = default_conds.gen
                import numpy as np

                audio_16, _ = librosa.load(req["src"], sr=S3_SR)
                pieces = []
                spans = split_quiet(audio_16, S3_SR)
                with torch.inference_mode():
                    for n, (a, b) in enumerate(spans):
                        tokens, _ = s3.tokenizer(torch.from_numpy(audio_16[a:b]).float().to(model.device)[None,])
                        wav, _ = s3.inference(speech_tokens=tokens, ref_dict=ref_dict)
                        pieces.append(wav.squeeze(0).detach().cpu().numpy())
                        send({"id": req["id"], "progress": (n + 1) / len(spans)})
                samples = model.watermarker.apply_watermark(np.concatenate(pieces), sample_rate=model.sr)
                write_wav(req["out"], samples, model.sr)
                send({"id": req["id"], "ok": True, "sample_rate": model.sr})
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
