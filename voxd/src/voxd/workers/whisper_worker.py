"""Whisper (faster-whisper / CTranslate2) worker. Runs inside its own runtime pack; never imports voxd.

    python whisper_worker.py --model-dir DIR --device auto|cpu|cuda
"""

import argparse
import json
import os
import sys

_proto = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr


def send(msg):
    _proto.write(json.dumps(msg) + "\n")
    _proto.flush()


def load(model_dir, device):
    from faster_whisper import WhisperModel

    if device in ("auto", "cuda"):
        try:
            import ctranslate2

            if ctranslate2.get_cuda_device_count() > 0:
                return WhisperModel(model_dir, device="cuda", compute_type="float16"), "cuda"
        except Exception as exc:
            print(f"cuda unavailable ({exc}); using cpu", file=sys.stderr)
    # CTranslate2 has no Apple GPU backend; int8 on CPU is fast on Apple Silicon.
    return WhisperModel(model_dir, device="cpu", compute_type="int8", cpu_threads=max(1, (os.cpu_count() or 4) - 1)), "cpu"


def audio_input(req):
    """A file path (any format ffmpeg/PyAV reads), or raw float32 mono 16 kHz samples in `pcm_path`."""
    if req.get("pcm_path"):
        import numpy as np

        return np.fromfile(req["pcm_path"], dtype=np.float32)
    return req["path"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--device", default="auto")
    args = parser.parse_args()
    try:
        model, device = load(args.model_dir, args.device)
    except Exception as exc:
        send({"ready": False, "error": f"Couldn't load Whisper: {exc}"})
        return
    send({"ready": True, "device": device})

    for line in sys.stdin:
        req = json.loads(line)
        try:
            if req["op"] == "ping":
                send({"id": req["id"], "ok": True})
                continue
            if req["op"] != "transcribe":
                raise ValueError(f"unknown op {req['op']}")
            segments, info = model.transcribe(
                audio_input(req),
                language=req.get("language") or None,
                beam_size=int(req.get("beam_size", 5)),
                vad_filter=bool(req.get("vad", True)),
                condition_on_previous_text=bool(req.get("context", True)),
                initial_prompt=req.get("prompt") or None,
            )
            out, total = [], max(info.duration, 1e-6)
            progress_every = req.get("progress")
            for seg in segments:
                out.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()})
                if progress_every:
                    send({"id": req["id"], "progress": min(0.99, seg.end / total)})
            send({"id": req["id"], "ok": True, "segments": out, "language": info.language, "duration": round(info.duration, 2)})
        except Exception as exc:
            send({"id": req["id"], "ok": False, "error": str(exc)})


if __name__ == "__main__":
    main()
