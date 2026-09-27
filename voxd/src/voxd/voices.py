"""Custom voices: reference recordings that cloning engines can speak with."""

from __future__ import annotations

import io
import json
import time
import uuid
import wave
import zipfile
from pathlib import Path

from .engines.base import EngineError
from .store import CustomVoice, Store

MIN_SECONDS = 3.0
MAX_SECONDS = 60.0
MAX_BYTES = 20 * 1024 * 1024
PREFIX = "cv_"


def validate_wav(data: bytes) -> float:
    """Return the duration of a PCM WAV clip, or raise EngineError explaining what's wrong."""
    if len(data) > MAX_BYTES:
        raise EngineError("The recording is too large (max 20 MB)")
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            if w.getsampwidth() not in (2, 3, 4) or w.getnchannels() not in (1, 2):
                raise EngineError("Unsupported WAV format — use 16-bit PCM, mono or stereo")
            duration = w.getnframes() / float(w.getframerate())
    except (wave.Error, EOFError) as exc:
        raise EngineError("The file isn't a valid WAV recording") from exc
    if duration < MIN_SECONDS:
        raise EngineError(f"The recording is {duration:.1f}s — at least {MIN_SECONDS:.0f} seconds are needed")
    if duration > MAX_SECONDS:
        raise EngineError(f"The recording is {duration:.0f}s — keep it under {MAX_SECONDS:.0f} seconds")
    return duration


class CustomVoices:
    def __init__(self, store: Store, root: Path):
        self.store, self.root = store, root
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, voice_id: str) -> Path:
        if not (voice_id.startswith(PREFIX) and voice_id[len(PREFIX) :].isalnum()):
            raise EngineError(f"Unknown voice: {voice_id}")
        return self.root / f"{voice_id}.wav"

    def create(self, *, name: str, language: str, consent: str, audio: bytes, consent_by: str = "") -> CustomVoice:
        duration = validate_wav(audio)
        voice = CustomVoice(
            f"{PREFIX}{uuid.uuid4().hex[:12]}", name.strip(), language, round(duration, 2), consent.strip(), time.time(), consent_by.strip()
        )
        self.path(voice.id).write_bytes(audio)
        self.store.add_custom_voice(voice)
        return voice

    def delete(self, voice_id: str) -> bool:
        removed = self.store.delete_custom_voice(voice_id)
        self.path(voice_id).unlink(missing_ok=True)
        return removed


# --- .voxvoice bundles ------------------------------------------------------------
# A zip with `manifest.json` and `reference.wav`. Tags travel with the voice; the consent
# record travels too, and the importer adds their own statement on top.

BUNDLE_FORMAT = "voxvoice"
BUNDLE_VERSION = 1
MAX_BUNDLE_BYTES = 25 * 1024 * 1024


def export_bundle(voices: CustomVoices, voice: CustomVoice, tags: list[str]) -> bytes:
    manifest = {
        "format": BUNDLE_FORMAT,
        "version": BUNDLE_VERSION,
        "name": voice.name,
        "language": voice.language,
        "duration_s": voice.duration_s,
        "tags": tags,
        "consent": voice.consent,
        "consent_by": voice.consent_by,
        "created_at": voice.created_at,
        "exported_at": time.time(),
        "exported_by": "VoxStudio",
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=2))
        z.write(voices.path(voice.id), "reference.wav")
    return buf.getvalue()


def read_bundle(data: bytes) -> tuple[dict, bytes]:
    """Return (manifest, reference wav bytes) or raise EngineError."""
    if len(data) > MAX_BUNDLE_BYTES:
        raise EngineError("That file is too large to be a voice (max 25 MB)")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            manifest = json.loads(z.read("manifest.json"))
            audio = z.read("reference.wav")  # only these two named members are ever read
    except (zipfile.BadZipFile, KeyError, ValueError) as exc:
        raise EngineError("That isn't a VoxStudio voice file (.voxvoice)") from exc
    if manifest.get("format") != BUNDLE_FORMAT:
        raise EngineError("That isn't a VoxStudio voice file (.voxvoice)")
    if int(manifest.get("version", 0)) > BUNDLE_VERSION:
        raise EngineError("This voice was made with a newer version of VoxStudio — please update")
    name = str(manifest.get("name", "")).strip()[:60]
    if not name:
        raise EngineError("The voice file has no name")
    validate_wav(audio)
    tags = [str(t)[:24] for t in manifest.get("tags", []) if str(t).strip()][:12]
    return {**manifest, "name": name, "tags": tags}, audio
