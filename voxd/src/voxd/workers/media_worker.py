"""Media + translation worker. Runs in the Whisper runtime pack (PyAV, CTranslate2, SentencePiece);
never imports voxd.

Ops: probe, extract (any media → WAV), mux (video + new audio → MP4), translate (Argos packages).
"""

import glob
import json
import os
import sys
import wave

_proto = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr


def send(msg):
    _proto.write(json.dumps(msg) + "\n")
    _proto.flush()


def probe(path):
    import av

    with av.open(path) as c:
        video = next((s for s in c.streams if s.type == "video"), None)
        audio = next((s for s in c.streams if s.type == "audio"), None)
        duration = float(c.duration / 1_000_000) if c.duration else 0.0
        return {
            "duration": round(duration, 3),
            "has_video": video is not None,
            "has_audio": audio is not None,
            "width": video.codec_context.width if video else None,
            "height": video.codec_context.height if video else None,
        }


def extract(path, out, rate, channels, progress=None):
    """Decode the first audio stream to 16-bit PCM WAV at ``rate`` with ``channels``."""
    import av

    layout = "mono" if channels == 1 else "stereo"
    with av.open(path) as c, wave.open(out, "wb") as w:
        stream = next(s for s in c.streams if s.type == "audio")
        total = float(c.duration / 1_000_000) if c.duration else 0.0
        resampler = av.AudioResampler(format="s16", layout=layout, rate=rate)
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        last = 0.0
        for frame in c.decode(stream):
            for out_frame in resampler.resample(frame):
                w.writeframes(out_frame.to_ndarray().tobytes())
            if progress and total and frame.time is not None and frame.time - last > 5:
                last = frame.time
                progress(min(0.99, frame.time / total))
        for out_frame in resampler.resample(None):
            w.writeframes(out_frame.to_ndarray().tobytes())


def mux(video_path, audio_wav, out, progress=None):
    """Copy the video stream from ``video_path`` and pair it with ``audio_wav`` (encoded as AAC)."""
    import av
    import numpy as np

    with av.open(video_path) as src, av.open(out, "w", format="mp4") as dst:
        v_in = next(s for s in src.streams if s.type == "video")
        v_out = dst.add_stream_from_template(v_in)
        with wave.open(audio_wav, "rb") as w:
            rate, channels = w.getframerate(), w.getnchannels()
            pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, channels)
        a_out = dst.add_stream("aac", rate=rate)
        a_out.layout = "stereo" if channels == 2 else "mono"
        a_out.bit_rate = 192_000

        for packet in src.demux(v_in):
            if packet.dts is None:
                continue
            packet.stream = v_out
            dst.mux(packet)

        planar = (pcm.T.astype(np.float32) / 32768.0).copy()  # (channels, samples) for 'fltp'
        step = 1024
        for i in range(0, planar.shape[1], step):
            frame = av.AudioFrame.from_ndarray(np.ascontiguousarray(planar[:, i : i + step]), format="fltp", layout=a_out.layout.name)
            frame.sample_rate = rate
            frame.pts = i
            for packet in a_out.encode(frame):
                dst.mux(packet)
            if progress and i % (step * 400) == 0:
                progress(i / planar.shape[1])
        for packet in a_out.encode(None):
            dst.mux(packet)


_translators = {}


def translate(pkg_dir, texts, beam=4):
    import ctranslate2
    import sentencepiece as spm

    if pkg_dir not in _translators:
        sp_paths = glob.glob(os.path.join(pkg_dir, "**", "sentencepiece.model"), recursive=True)
        bins = glob.glob(os.path.join(pkg_dir, "**", "model.bin"), recursive=True)
        if not sp_paths or not bins:
            raise ValueError(f"Unsupported translation package format in {os.path.basename(pkg_dir)}")
        sp_path, model_dir = sp_paths[0], os.path.dirname(bins[0])
        _translators[pkg_dir] = (
            spm.SentencePieceProcessor(model_file=sp_path),
            ctranslate2.Translator(model_dir, device="cpu", compute_type="int8"),
        )
    sp, tr = _translators[pkg_dir]
    batch = [sp.encode(t, out_type=str) if t.strip() else [] for t in texts]
    results = tr.translate_batch([b or ["."] for b in batch], beam_size=beam, max_batch_size=16)
    out = []
    for src, res in zip(batch, results):
        # Rebuild text from pieces ourselves: works for packages whose target side
        # isn't covered by the source SentencePiece model.
        out.append("".join(res.hypotheses[0]).replace("▁", " ").strip() if src else "")
    return out


def main():
    send({"ready": True})
    for line in sys.stdin:
        req = json.loads(line)
        rid = req["id"]

        def progress(x, rid=rid):
            send({"id": rid, "progress": round(float(x), 3)})

        try:
            op = req["op"]
            if op == "ping":
                result = {}
            elif op == "probe":
                result = probe(req["path"])
            elif op == "extract":
                extract(req["path"], req["out"], int(req["rate"]), int(req["channels"]), progress if req.get("progress") else None)
                result = {}
            elif op == "mux":
                mux(req["video"], req["audio"], req["out"], progress if req.get("progress") else None)
                result = {}
            elif op == "translate":
                result = {"texts": translate(req["package"], req["texts"])}
            else:
                raise ValueError(f"unknown op {op}")
            send({"id": rid, "ok": True, **result})
        except Exception as exc:
            send({"id": rid, "ok": False, "error": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    main()
