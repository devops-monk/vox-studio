"""OpenAI-compatible speech and transcription, so existing OpenAI SDK code can point at voxd.

Errors use OpenAI's shape (``{"error": {"message", "type", "param", "code"}}``) because that's what
the SDKs parse. Everything else in voxd uses the regular voxd error format.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field

from .. import automation
from ..engines.base import EngineError
from ..transcripts import to_srt, to_vtt, uploads_dir

router = APIRouter(prefix="/v1/audio", tags=["OpenAI compatible"])

MAX_UPLOAD = 2 * 1024**3
LANGUAGE_NAMES = {
    "en": "english", "es": "spanish", "fr": "french", "de": "german", "it": "italian", "pt": "portuguese",
    "hi": "hindi", "ja": "japanese", "zh": "chinese", "ko": "korean", "ar": "arabic", "ru": "russian",
    "nl": "dutch", "pl": "polish", "tr": "turkish", "sv": "swedish", "uk": "ukrainian",
}


class OpenAIError(Exception):
    def __init__(self, status: int, message: str, code: str, param: str | None = None, type_: str = "invalid_request_error"):
        self.status, self.message, self.code, self.param, self.type = status, message, code, param, type_

    def response(self) -> JSONResponse:
        return JSONResponse({"error": {"message": self.message, "type": self.type, "param": self.param, "code": self.code}}, status_code=self.status)


class SpeechRequest(BaseModel):
    model: str = Field("tts-1", description="`tts-1`, `tts-1-hd` or `gpt-4o-mini-tts` pick the best installed engine; or name one: `kokoro`, `chatterbox`, `system`")
    input: str = Field(min_length=1, max_length=100_000, description="Text to speak. Long text is rendered in chunks.")
    voice: str = Field("alloy", description="An OpenAI voice name (alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse) or any voxd voice id")
    response_format: Literal["mp3", "opus", "aac", "flac", "wav", "pcm"] = "mp3"
    speed: float = Field(1.0, ge=0.25, le=4.0, description="Clamped to 0.5–2.0")
    instructions: str | None = Field(None, description="Accepted for compatibility; ignored")


ENGINE_MODELS = {"kokoro", "chatterbox", "system"}


@router.post(
    "/speech",
    summary="Create speech (OpenAI compatible)",
    response_class=Response,
    responses={200: {"content": {t: {} for t in automation.AUDIO_TYPES.values()}, "description": "The audio file"}},
)
async def create_speech(request: Request, body: SpeechRequest) -> Response:
    """Same request as OpenAI's `POST /v1/audio/speech`; returns audio bytes. The result is also saved as a take in History."""
    services = request.app.state.services
    engine_id = body.model if body.model in ENGINE_MODELS else None
    try:
        take = await automation.speak(services, body.input, body.voice, engine_id, min(2.0, max(0.5, body.speed)))
    except EngineError as exc:
        param = "voice" if "voice" in str(exc).lower() else None
        raise OpenAIError(400, str(exc), "voice_not_found" if param else "engine_unavailable", param) from exc
    wav = services.settings.takes_dir / f"{take.id}.wav"
    out = uploads_dir(services) / f".{uuid.uuid4().hex}.{body.response_format}"
    try:
        await asyncio.to_thread(automation.encode, services, wav, body.response_format, out)
        data = out.read_bytes()
    except EngineError as exc:
        raise OpenAIError(400, str(exc), "unsupported_format", "response_format") from exc
    finally:
        out.unlink(missing_ok=True)
    return Response(data, media_type=automation.AUDIO_TYPES[body.response_format], headers={"X-Voxd-Take-Id": take.id})


@router.post("/transcriptions", summary="Create transcription (OpenAI compatible)")
async def create_transcription(
    request: Request,
    file: UploadFile = File(description="Audio or video: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm and more"),
    model: str = Form("whisper-1", description="`whisper-1`, `gpt-4o-transcribe` etc. use your preferred Whisper model; or a voxd Whisper model id"),
    language: str | None = Form(None, description="ISO-639-1 code; omit to detect"),
    prompt: str | None = Form(None, description="Accepted for compatibility; ignored"),
    response_format: Literal["json", "text", "srt", "verbose_json", "vtt"] = Form("json"),
    temperature: float = Form(0.0, description="Accepted for compatibility; ignored"),
) -> Response:
    """Same request as OpenAI's `POST /v1/audio/transcriptions`. The transcript is also saved in Transcribe."""
    services = request.app.state.services
    suffix = Path(file.filename or "audio").suffix.lower()[:8] or ".bin"
    name = f"{uuid.uuid4().hex}{suffix}"
    dest = uploads_dir(services) / name
    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD:
                out.close()
                dest.unlink(missing_ok=True)
                raise OpenAIError(413, "Files up to 2 GB are supported", "file_too_large", "file")
            out.write(chunk)
    whisper_model = model if model.startswith("whisper-") and model != "whisper-1" else None
    try:
        t = await automation.transcribe(services, name, Path(file.filename or "Recording").stem, language, whisper_model)
    except EngineError as exc:
        dest.unlink(missing_ok=True)
        raise OpenAIError(400, str(exc), "engine_unavailable") from exc

    if response_format == "text":
        return PlainTextResponse(t.text + "\n")
    if response_format == "srt":
        return PlainTextResponse(to_srt(t.segments))
    if response_format == "vtt":
        return PlainTextResponse(to_vtt(t.segments), media_type="text/vtt")
    if response_format == "json":
        return JSONResponse({"text": t.text})
    segments = [
        {"id": i, "seek": 0, "start": s["start"], "end": s["end"], "text": " " + s["text"].strip(), "tokens": [],
         "temperature": 0.0, "avg_logprob": 0.0, "compression_ratio": 0.0, "no_speech_prob": 0.0}
        for i, s in enumerate(t.segments)
    ]
    body = {"task": "transcribe", "language": LANGUAGE_NAMES.get(t.language, t.language), "duration": t.duration_s,
            "text": t.text, "segments": segments}
    return Response(json.dumps(body), media_type="application/json")
