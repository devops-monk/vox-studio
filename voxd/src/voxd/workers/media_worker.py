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


def encode_book(wavs, titles, out, fmt, title="", author=""):
    """Concatenate chapter WAVs into one M4B (AAC with chapter markers) or MP3."""
    import av
    import numpy as np
    from fractions import Fraction

    container = av.open(out, "w", format="ipod" if fmt == "m4b" else "mp3")
    if title:
        container.metadata["title"] = title
        container.metadata["album"] = title
    if author:
        container.metadata["artist"] = author
    rate = None
    stream = None
    chapters, pts = [], 0
    for i, (path, chapter_title) in enumerate(zip(wavs, titles)):
        with wave.open(path, "rb") as w:
            if rate is None:
                rate = w.getframerate()
                stream = container.add_stream("aac" if fmt == "m4b" else "libmp3lame", rate=rate)
                stream.layout = "mono"
                stream.bit_rate = 96_000 if fmt == "m4b" else 128_000
            samples = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32)[None, :] / 32768.0
        start = pts
        step = 1152 if fmt == "mp3" else 1024
        for j in range(0, samples.shape[1], step):
            frame = av.AudioFrame.from_ndarray(np.ascontiguousarray(samples[:, j : j + step]), format="fltp", layout="mono")
            frame.sample_rate = rate
            frame.pts = pts
            pts += frame.samples
            for packet in stream.encode(frame):
                container.mux(packet)
        chapters.append({"id": i + 1, "start": start, "end": pts, "time_base": Fraction(1, rate), "metadata": {"title": chapter_title}})
    for packet in stream.encode(None):
        container.mux(packet)
    if fmt == "m4b":
        container.set_chapters(chapters)
    container.close()


# format -> (container, codec, sample format, frame size, forced rate, bit rate)
ENCODINGS = {
    "mp3": ("mp3", "libmp3lame", "fltp", 1152, None, 128_000),
    "aac": ("adts", "aac", "fltp", 1024, None, 96_000),
    "opus": ("ogg", "libopus", "flt", 960, 48_000, 64_000),
    "flac": ("flac", "flac", "s16", 4096, None, None),
}


def encode(path, out, fmt):
    """Encode a WAV (mono or stereo, 16-bit) as mono mp3, aac (ADTS), opus (Ogg) or flac."""
    import av
    import numpy as np

    container_fmt, codec, sample_fmt, frame_size, forced_rate, bit_rate = ENCODINGS[fmt]
    with wave.open(path, "rb") as w:
        rate, channels = w.getframerate(), w.getnchannels()
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    if channels > 1:
        pcm = pcm.reshape(-1, channels).mean(axis=1).astype("<i2")
    target = forced_rate or rate
    src = av.AudioFrame.from_ndarray(pcm.reshape(1, -1), format="s16", layout="mono")
    src.sample_rate = rate
    resampler = av.AudioResampler(format=sample_fmt, layout="mono", rate=target)
    chunks = [f.to_ndarray() for f in resampler.resample(src)] + [f.to_ndarray() for f in resampler.resample(None)]
    data = np.concatenate(chunks, axis=1) if chunks else np.zeros((1, 0), dtype=np.float32)

    with av.open(out, "w", format=container_fmt) as c:
        stream = c.add_stream(codec, rate=target)
        stream.layout = "mono"
        if bit_rate:
            stream.bit_rate = bit_rate
        pts = 0
        for j in range(0, data.shape[1], frame_size):
            frame = av.AudioFrame.from_ndarray(np.ascontiguousarray(data[:, j : j + frame_size]), format=sample_fmt, layout="mono")
            frame.sample_rate = target
            frame.pts = pts
            pts += frame.samples
            for packet in stream.encode(frame):
                c.mux(packet)
        for packet in stream.encode(None):
            c.mux(packet)
    return {"bytes": os.path.getsize(out)}


def _levels(samples):
    """(peak dBFS, RMS dBFS) of float samples."""
    import numpy as np

    if samples.size == 0:
        return -120.0, -120.0
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(samples.astype(np.float64) ** 2)))
    to_db = lambda x: round(20 * np.log10(max(x, 1e-6)), 1)  # noqa: E731
    return to_db(peak), to_db(rms)


def clean(path, out, denoise=True, normalize=None, trim=False, highpass=True):
    """Filter any audio/video file's sound to a WAV: speech high-pass, FFT noise reduction,
    silence trimming and EBU R128 loudness normalisation (``normalize`` = target LUFS)."""
    import av
    import numpy as np

    chain = []
    if highpass:
        chain.append(("highpass", "f=70"))
    if denoise:
        chain.append(("afftdn", "nr=14:nf=-35:tn=1"))
    if trim:
        chain.append(("silenceremove", "start_periods=1:start_threshold=-38dB:start_silence=0.15:stop_periods=-1:stop_threshold=-38dB:stop_silence=0.6"))
    if normalize is not None:
        chain.append(("loudnorm", f"I={float(normalize)}:TP=-1.5:LRA=11"))

    with av.open(path) as src:
        stream = next(s for s in src.streams if s.type == "audio")
        rate = stream.codec_context.sample_rate or 48000
        channels = min(2, stream.codec_context.channels or 1)
        layout = "mono" if channels == 1 else "stereo"
        # Normalise everything to float planar first so the filter chain sees one format.
        chain = [("aresample", str(rate)), ("aformat", f"sample_fmts=fltp:channel_layouts={layout}")] + chain
        chain += [("aresample", str(rate)), ("aformat", f"sample_fmts=s16:channel_layouts={layout}:sample_rates={rate}")]
        graph = av.filter.Graph()
        node = graph.add_abuffer(template=stream)
        head = node
        for name, args in chain:
            f = graph.add(name, args)
            node.link_to(f)
            node = f
        sink = graph.add("abuffersink")
        node.link_to(sink)
        graph.configure()

        before, after = [], []

        def drain():
            while True:
                try:
                    frame = sink.pull()
                except (av.error.BlockingIOError, av.error.EOFError, BlockingIOError, EOFError):
                    return
                after.append(frame.to_ndarray().reshape(-1, channels) if frame.format.is_packed else frame.to_ndarray().T)

        for frame in src.decode(stream):
            arr = frame.to_ndarray()
            before.append(arr.astype(np.float32).ravel() / (32768.0 if arr.dtype == np.int16 else 1.0))
            head.push(frame)
            drain()
        head.push(None)
        drain()

    pcm = np.concatenate(after) if after else np.zeros((0, channels), dtype=np.int16)
    with wave.open(out, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.astype("<i2").tobytes())
    src_levels = _levels(np.concatenate(before) if before else np.zeros(0))
    out_levels = _levels(pcm.astype(np.float32).ravel() / 32768.0)
    return {
        "duration_in": round(sum(len(b) for b in before) / channels / rate, 2),
        "duration_out": round(len(pcm) / rate, 2),
        "peak_in": src_levels[0], "rms_in": src_levels[1], "peak_out": out_levels[0], "rms_out": out_levels[1],
    }


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
            elif op == "encode":
                result = encode(req["path"], req["out"], req["format"])
            elif op == "clean":
                result = clean(req["path"], req["out"], req.get("denoise", True), req.get("normalize"), req.get("trim", False), req.get("highpass", True))
            elif op == "encode_book":
                encode_book(req["wavs"], req["titles"], req["out"], req["format"], req.get("title", ""), req.get("author", ""))
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
