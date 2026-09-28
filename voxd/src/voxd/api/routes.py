from __future__ import annotations

import asyncio
import hmac
import json
import time
import uuid

import shutil
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response, StreamingResponse

from .. import __version__
from ..engines.base import EngineError
from ..models import ModelSpec, fit, system_info
from ..runtimes import PACKS
from ..store import CustomVoice
from ..voices import export_bundle, read_bundle
from ..design import apply_sliders, design, parse_description, parse_recipe
from ..transcripts import EXPORTS, LiveSession, save_live, to_text, uploads_dir
from ..store import Transcript
from ..history import RETENTION_CHOICES, RETENTION_KEY, delete_takes, sweep, usage_bytes
from ..store import DesignedVoice
from ..speech import resolve_engine, save_take
from ..store import Job, Take
from .schemas import (
    ClearedOut,
    CustomVoiceOut,
    CustomVoicePatch,
    DesignedVoiceIn,
    DesignedVoiceOut,
    DesignIn,
    DesignOut,
    DesignStatusOut,
    DesignTargetOut,
    DeletedOut,
    TranscriptOut,
    TranscriptPatch,
    TranscriptSummaryOut,
    DeleteTakesIn,
    TakeStatsOut,
    EngineOut,
    ExportIn,
    ExportPathIn,
    LibraryVoiceOut,
    ErrorOut,
    FitOut,
    JobOut,
    ModelOut,
    SpeechIn,
    SettingsOut,
    SettingsPatch,
    SpeechJobIn,
    StarIn,
    StatusOut,
    SystemOut,
    TakeOut,
    VoiceMetaIn,
    VoiceOut,
)

router = APIRouter(prefix="/v1")
ERRORS = {400: {"model": ErrorOut}, 404: {"model": ErrorOut}, 409: {"model": ErrorOut}}
SSE_KEEPALIVE_S = 15


def _take_out(take: Take) -> TakeOut:
    return TakeOut(**take.public(), audio_url=f"/v1/takes/{take.id}/audio")


def _job_out(job: Job) -> JobOut:
    d = job.public()
    d.pop("input")
    return JobOut(**d)


def _services(request: Request):
    return request.app.state.services


# --- System -----------------------------------------------------------------


@router.get("/status", response_model=StatusOut, tags=["System"], summary="Daemon status")
def status(request: Request) -> StatusOut:
    """Always answers, even while booting. Poll until `phase` is `ready`."""
    return StatusOut(version=__version__, **_services(request).lifecycle.snapshot())


@router.get("/system", response_model=SystemOut, tags=["System"], summary="This computer")
def system(request: Request) -> SystemOut:
    """Hardware facts used to recommend models: chip, memory and free disk space."""
    return SystemOut(**system_info(_services(request).settings.data_dir))


# --- Models -----------------------------------------------------------------


def _model_out(services, spec: ModelSpec, info: dict) -> ModelOut:
    job = services.jobs.active("model.download", lambda i: i.get("model_id") == spec.id)
    pack = PACKS.get(spec.runtime) if spec.runtime else None
    runtime_ready = pack is None or services.runtimes.installed(pack)
    installed = services.models.installed(spec) and runtime_ready
    status = "downloading" if job else "installed" if installed else "not_installed"
    runtime_bytes = pack.approx_bytes if pack and not runtime_ready else 0
    level, reason = fit(spec, info, runtime_bytes)
    return ModelOut(
        id=spec.id, engine=spec.engine, name=spec.name, tagline=spec.tagline, description=spec.description,
        license=spec.license, license_url=spec.license_url, homepage=spec.homepage, size_bytes=spec.size,
        languages=list(spec.languages), voice_count=spec.voice_count, featured=spec.featured,
        kind=spec.kind, runtime_bytes=pack.approx_bytes if pack else 0, status=status, job_id=job.id if job else None, fit=FitOut(level=level, reason=reason),
    )


def _model_spec(services, model_id: str) -> ModelSpec:
    try:
        return services.models.get(model_id)
    except EngineError as exc:
        raise HTTPException(404, detail=("not_found", str(exc))) from exc


@router.get("/models", response_model=list[ModelOut], tags=["Models"], summary="Model catalog")
def list_models(request: Request) -> list[ModelOut]:
    """Every downloadable model, whether it's installed, and how well it fits this computer."""
    services = _services(request)
    info = system_info(services.settings.data_dir)
    return [_model_out(services, spec, info) for spec in services.models.catalog]


@router.post("/models/{model_id}/download", response_model=JobOut, status_code=202, responses=ERRORS, tags=["Models"], summary="Download a model")
def download_model(request: Request, model_id: str) -> JobOut:
    """Starts (or returns the already-running) download job. Interrupted downloads resume where they stopped."""
    services = _services(request)
    spec = _model_spec(services, model_id)
    pack = PACKS.get(spec.runtime) if spec.runtime else None
    if services.models.installed(spec) and (pack is None or services.runtimes.installed(pack)):
        raise HTTPException(409, detail=("already_installed", f"{spec.name} is already installed"))
    running = services.jobs.active("model.download", lambda i: i.get("model_id") == spec.id)
    if running:
        return _job_out(running)
    return _job_out(services.jobs.submit("model.download", f"Downloading {spec.name}", {"model_id": spec.id}))


@router.delete("/models/{model_id}", status_code=204, responses=ERRORS, tags=["Models"], summary="Remove a model")
def delete_model(request: Request, model_id: str) -> Response:
    """Deletes the model's files and frees the disk space. Takes made with it are kept."""
    services = _services(request)
    spec = _model_spec(services, model_id)
    if services.jobs.active("model.download", lambda i: i.get("model_id") == spec.id):
        raise HTTPException(409, detail=("download_in_progress", "Cancel the download first"))
    engine = services.registry.raw(spec.engine)
    if engine:
        engine.unload()
    services.models.delete(spec)
    if spec.runtime:
        services.runtimes.remove(PACKS[spec.runtime])
    services.registry.refresh(spec.engine)
    services.bus.publish("models.changed", {"id": spec.id, "installed": False})
    return Response(status_code=204)


# --- Engines & voices -------------------------------------------------------


@router.get("/engines", response_model=list[EngineOut], tags=["Engines"], summary="List engines")
def engines(request: Request) -> list[EngineOut]:
    return [EngineOut(**vars(e)) for e in _services(request).registry.info()]


@router.get("/voices", response_model=list[VoiceOut], responses=ERRORS, tags=["Voices"], summary="List voices")
def voices(request: Request, engine: str = Query("system", description="Engine id")) -> list[VoiceOut]:
    try:
        found = _services(request).registry.get(engine).voices()
    except EngineError as exc:
        raise HTTPException(400, detail=("engine_unavailable", str(exc))) from exc
    return [VoiceOut(**vars(v)) for v in found]


# --- Speech -----------------------------------------------------------------


@router.post("/speech", response_model=TakeOut, status_code=201, responses=ERRORS, tags=["Speech"], summary="Generate speech")
async def speech(request: Request, body: SpeechIn) -> TakeOut:
    """Render short text (up to 5,000 characters) and wait for the result. For longer text use `POST /v1/jobs/speech`."""
    services = _services(request)
    try:
        engine = resolve_engine(services, body.engine)
    except EngineError as exc:
        raise HTTPException(400, detail=("engine_unavailable", str(exc))) from exc

    take_id = uuid.uuid4().hex
    out = services.settings.takes_dir / f"{take_id}.wav"
    try:
        await asyncio.to_thread(engine.synthesize, body.text, body.voice, body.speed, out, body.emotion)
    except EngineError as exc:
        out.unlink(missing_ok=True)
        raise HTTPException(400, detail=("synthesis_failed", str(exc))) from exc
    return _take_out(save_take(services, take_id=take_id, engine=engine, voice=body.voice, text=body.text, path=out))


@router.post("/jobs/speech", response_model=JobOut, status_code=202, responses=ERRORS, tags=["Jobs"], summary="Generate long speech in the background")
def speech_job(request: Request, body: SpeechJobIn) -> JobOut:
    """Queue text of any length. Track it with `GET /v1/jobs/{id}/events`; on success `result` holds the `take_id` and `audio_url`."""
    services = _services(request)
    try:
        engine = resolve_engine(services, body.engine)
    except EngineError as exc:
        raise HTTPException(400, detail=("engine_unavailable", str(exc))) from exc
    title = body.title or (body.text[:60].strip() + ("…" if len(body.text) > 60 else ""))
    spec = {"text": body.text, "voice": body.voice, "engine": engine.id, "speed": body.speed, "emotion": body.emotion}
    return _job_out(services.jobs.submit("speech", title, spec))


# --- Takes ------------------------------------------------------------------


@router.get("/takes", response_model=list[TakeOut], tags=["Takes"], summary="List and search takes")
def takes(
    request: Request,
    limit: int = Query(50, ge=1, le=500),
    q: str | None = Query(None, max_length=200, description="Text contains (case-insensitive)"),
    engine: str | None = Query(None),
    voice: str | None = Query(None),
    starred: bool | None = Query(None),
    before: float | None = Query(None, description="Only takes created before this unix time — pass the last `created_at` to get the next page"),
) -> list[TakeOut]:
    """Newest first. Page through history with `before`."""
    found = _services(request).store.list_takes(limit, query=q, engine=engine, voice=voice, starred=starred, before=before)
    return [_take_out(t) for t in found]


@router.get("/takes/stats", response_model=TakeStatsOut, tags=["Takes"], summary="History size")
def take_stats(request: Request) -> TakeStatsOut:
    services = _services(request)
    count, starred = services.store.take_counts()
    return TakeStatsOut(count=count, starred=starred, bytes=usage_bytes(services))


@router.delete("/takes/{take_id}", status_code=204, responses=ERRORS, tags=["Takes"], summary="Delete a take")
def delete_take(request: Request, take_id: str) -> Response:
    if not delete_takes(_services(request), [take_id]):
        raise HTTPException(404, detail=("not_found", "No such take"))
    return Response(status_code=204)


@router.post("/takes/delete", response_model=DeletedOut, tags=["Takes"], summary="Delete several takes")
def delete_many_takes(request: Request, body: DeleteTakesIn) -> DeletedOut:
    """Deletes the takes and their audio. Unknown ids are ignored; `deleted` lists what was removed."""
    return DeletedOut(deleted=delete_takes(_services(request), body.ids))


@router.get("/takes/{take_id}/audio", response_class=FileResponse, responses=ERRORS, tags=["Takes"], summary="Download take audio")
def take_audio(request: Request, take_id: str) -> FileResponse:
    services = _services(request)
    if not take_id.isalnum() or services.store.get_take(take_id) is None:
        raise HTTPException(404, detail=("not_found", "No such take"))
    return FileResponse(services.settings.takes_dir / f"{take_id}.wav", media_type="audio/wav")


@router.put("/takes/{take_id}/star", response_model=TakeOut, responses=ERRORS, tags=["Takes"], summary="Star or unstar a take")
def star_take(request: Request, take_id: str, body: StarIn) -> TakeOut:
    services = _services(request)
    take = services.store.set_take_starred(take_id, body.starred)
    if take is None:
        raise HTTPException(404, detail=("not_found", "No such take"))
    services.bus.publish("take.updated", take.public())
    return _take_out(take)


def _destination(path: str, suffix: str, overwrite: bool) -> Path:
    dest = Path(path).expanduser()
    if not dest.is_absolute() or dest.suffix.lower() != suffix:
        raise HTTPException(400, detail=("invalid_path", f"Choose an absolute path ending in {suffix}"))
    if not dest.parent.is_dir():
        raise HTTPException(400, detail=("invalid_path", "That folder doesn't exist"))
    if dest.exists() and not overwrite:
        raise HTTPException(409, detail=("file_exists", "A file with that name already exists"))
    return dest


@router.post("/takes/{take_id}/export", status_code=204, responses=ERRORS, tags=["Takes"], summary="Save a take to a file")
def export_take(request: Request, take_id: str, body: ExportIn) -> Response:
    """Copies the take's WAV to `path` (for example, a location picked in a save dialog)."""
    services = _services(request)
    if services.store.get_take(take_id) is None:
        raise HTTPException(404, detail=("not_found", "No such take"))
    dest = _destination(body.path, ".wav", body.overwrite)
    shutil.copyfile(services.settings.takes_dir / f"{take_id}.wav", dest)
    return Response(status_code=204)


# --- Settings -----------------------------------------------------------------


def _settings_out(services) -> SettingsOut:
    chatterbox = services.registry.raw("chatterbox")
    return SettingsOut(
        history_retention_days=int(services.store.get_setting(RETENTION_KEY, 0) or 0),
        asr_model=services.store.get_setting("asr_model"),
        compute_device=services.store.get_setting("compute_device", "auto"),
        compute_device_in_use=getattr(chatterbox, "device_in_use", None),
    )


@router.get("/settings", response_model=SettingsOut, tags=["Settings"], summary="Get settings")
def get_settings(request: Request) -> SettingsOut:
    return _settings_out(_services(request))


@router.patch("/settings", response_model=SettingsOut, responses=ERRORS, tags=["Settings"], summary="Update settings")
def patch_settings(request: Request, body: SettingsPatch) -> SettingsOut:
    """Only the fields you send change. A new `compute_device` applies the next time an engine starts."""
    services = _services(request)
    if body.compute_device is not None:
        if body.compute_device not in ("auto", *system_info(services.settings.data_dir)["accelerators"]):
            raise HTTPException(400, detail=("unsupported_device", f"This computer has no {body.compute_device} device"))
        services.store.set_setting("compute_device", body.compute_device)
    if body.history_retention_days is not None:
        if body.history_retention_days not in RETENTION_CHOICES:
            raise HTTPException(400, detail=("invalid_setting", f"history_retention_days must be one of {RETENTION_CHOICES}"))
        services.store.set_setting(RETENTION_KEY, body.history_retention_days)
        sweep(services)  # apply the new policy right away
    if body.asr_model is not None:
        if body.asr_model and body.asr_model not in {m.id for m in services.models.all_for_engine("whisper")}:
            raise HTTPException(400, detail=("invalid_setting", f"Unknown Whisper model: {body.asr_model}"))
        services.store.set_setting("asr_model", body.asr_model or None)
    return _settings_out(services)


# --- Custom voices ------------------------------------------------------------


def _custom_out(v: CustomVoice) -> CustomVoiceOut:
    return CustomVoiceOut(**v.public(), audio_url=f"/v1/voices/custom/{v.id}/audio")


@router.post("/voices/custom", response_model=CustomVoiceOut, status_code=201, responses=ERRORS, tags=["Voices"], summary="Create a voice from a recording")
async def create_custom_voice(
    request: Request,
    audio: UploadFile = File(description="WAV recording, 3–60 seconds, of one person speaking"),
    name: str = Form(min_length=1, max_length=60),
    consent: str = Form(min_length=10, max_length=500, description="Statement confirming you have the speaker's permission"),
    language: str = Form("en-US"),
    consent_by: str = Form("", max_length=120, description="Who gave consent — the speaker, or who granted permission"),
) -> CustomVoiceOut:
    """Stores the recording as a new voice that cloning engines (e.g. `chatterbox`) can speak with."""
    services = _services(request)
    try:
        voice = services.custom.create(
            name=name, language=language, consent=consent, consent_by=consent_by, audio=await audio.read()
        )
    except EngineError as exc:
        raise HTTPException(400, detail=("invalid_audio", str(exc))) from exc
    services.bus.publish("voices.changed", {"id": voice.id})
    return _custom_out(voice)


@router.get("/voices/custom", response_model=list[CustomVoiceOut], tags=["Voices"], summary="List your voices")
def list_custom_voices(request: Request) -> list[CustomVoiceOut]:
    return [_custom_out(v) for v in _services(request).store.list_custom_voices()]


@router.patch("/voices/custom/{voice_id}", response_model=CustomVoiceOut, responses=ERRORS, tags=["Voices"], summary="Rename a voice")
def rename_custom_voice(request: Request, voice_id: str, body: CustomVoicePatch) -> CustomVoiceOut:
    services = _services(request)
    voice = services.store.rename_custom_voice(voice_id, body.name.strip())
    if voice is None:
        raise HTTPException(404, detail=("not_found", "No such voice"))
    services.bus.publish("voices.changed", {"id": voice_id})
    return _custom_out(voice)


@router.delete("/voices/custom/{voice_id}", status_code=204, responses=ERRORS, tags=["Voices"], summary="Delete a voice")
def delete_custom_voice(request: Request, voice_id: str) -> Response:
    """Deletes the voice and its recording. Takes already made with it are kept."""
    services = _services(request)
    try:
        removed = services.custom.delete(voice_id)
    except EngineError:
        removed = False
    if not removed:
        raise HTTPException(404, detail=("not_found", "No such voice"))
    services.store.delete_voice_meta("custom", voice_id)
    services.bus.publish("voices.changed", {"id": voice_id})
    return Response(status_code=204)


@router.get("/voices/custom/{voice_id}/audio", response_class=FileResponse, responses=ERRORS, tags=["Voices"], summary="Download a voice's recording")
def custom_voice_audio(request: Request, voice_id: str) -> FileResponse:
    services = _services(request)
    try:
        path = services.custom.path(voice_id)
    except EngineError as exc:
        raise HTTPException(404, detail=("not_found", "No such voice")) from exc
    if not path.exists():
        raise HTTPException(404, detail=("not_found", "No such voice"))
    return FileResponse(path, media_type="audio/wav")


@router.post("/voices/custom/{voice_id}/export", status_code=204, responses=ERRORS, tags=["Voices"], summary="Export a voice as .voxvoice")
def export_custom_voice(request: Request, voice_id: str, body: ExportPathIn) -> Response:
    """Writes a portable `.voxvoice` file (recording, name, tags and consent record) to `path`."""
    services = _services(request)
    voice = services.store.get_custom_voice(voice_id)
    if voice is None:
        raise HTTPException(404, detail=("not_found", "No such voice"))
    dest = _destination(body.path, ".voxvoice", body.overwrite)
    tags = services.store.voice_meta().get(("custom", voice_id))
    dest.write_bytes(export_bundle(services.custom, voice, tags.tags if tags else []))
    return Response(status_code=204)


@router.post("/voices/custom/import", response_model=CustomVoiceOut, status_code=201, responses=ERRORS, tags=["Voices"], summary="Import a .voxvoice file")
async def import_custom_voice(
    request: Request,
    file: UploadFile = File(description="A .voxvoice file exported from VoxStudio"),
    consent: str = Form(min_length=10, max_length=500, description="Your statement that you may use this voice"),
    consent_by: str = Form("", max_length=120),
) -> CustomVoiceOut:
    """Adds the voice to your library. The original consent record is kept alongside yours."""
    services = _services(request)
    try:
        manifest, audio = read_bundle(await file.read())
        original = str(manifest.get("consent", "")).strip()
        record = consent.strip() + (f" — Imported; original consent: “{original}”" if original else " — Imported")
        voice = services.custom.create(
            name=manifest["name"],
            language=str(manifest.get("language") or "en-US")[:16],
            consent=record[:1000],
            consent_by=consent_by or str(manifest.get("consent_by", ""))[:120],
            audio=audio,
        )
    except EngineError as exc:
        raise HTTPException(400, detail=("invalid_voice_file", str(exc))) from exc
    if manifest["tags"]:
        services.store.set_voice_meta("custom", voice.id, None, manifest["tags"])
    services.bus.publish("voices.changed", {"id": voice.id})
    return _custom_out(voice)


@router.get("/voices/library", response_model=list[LibraryVoiceOut], tags=["Voices"], summary="All voices, with favorites and tags")
def voice_library(request: Request) -> list[LibraryVoiceOut]:
    """Every voice across installed engines plus your custom voices, with your favorites and tags.
    Custom voices are listed even when no cloning engine is installed (`available: false`)."""
    services = _services(request)
    meta = services.store.voice_meta()
    engines = [e for e in services.registry.info() if "tts" in e.capabilities]
    cloner = next((e for e in engines if "clone" in e.capabilities), None)
    out: list[LibraryVoiceOut] = []
    for v in services.store.list_custom_voices():
        m = meta.get(("custom", v.id))
        out.append(LibraryVoiceOut(
            engine=cloner.id if cloner else "chatterbox", id=v.id, name=v.name, language=v.language, custom=True,
            available=bool(cloner and cloner.available), favorite=bool(m and m.favorite), tags=m.tags if m else [],
            duration_s=v.duration_s, created_at=v.created_at,
        ))
    for info in engines:
        if not info.available:
            continue
        try:
            listed = services.registry.get(info.id).voices()
        except EngineError:
            continue
        for v in listed:
            if v.id.startswith("cv_"):
                continue
            m = meta.get((info.id, v.id))
            out.append(LibraryVoiceOut(
                engine=info.id, id=v.id, name=v.name, language=v.language, gender=v.gender, custom=False,
                designed=v.id.startswith("dv_"),
                available=True, favorite=bool(m and m.favorite), tags=m.tags if m else [],
            ))
    return out


@router.put("/voices/meta", status_code=204, responses=ERRORS, tags=["Voices"], summary="Favorite or tag a voice")
def set_voice_meta(request: Request, body: VoiceMetaIn) -> Response:
    """Set `favorite` and/or `tags` for any voice. For custom voices pass their `cv_…` id (any `engine`)."""
    services = _services(request)
    tags = None if body.tags is None else sorted({t.strip()[:24] for t in body.tags if t.strip()})
    key = "custom" if body.voice.startswith("cv_") else body.engine
    services.store.set_voice_meta(key, body.voice, body.favorite, tags)
    services.bus.publish("voices.changed", {"id": body.voice})
    return Response(status_code=204)


# --- Voice design ---------------------------------------------------------------


@router.get("/design/status", response_model=DesignStatusOut, tags=["Design"], summary="Is voice design ready?")
def design_status(request: Request) -> DesignStatusOut:
    """Design needs a one-time analysis of Kokoro's voices (about a minute). Start it with `POST /v1/design/analyze`."""
    services = _services(request)
    traits = services.traits.load()
    job = services.jobs.active("design.analyze", lambda _i: True)
    return DesignStatusOut(ready=bool(traits), analyzed_voices=len(traits or []), job_id=job.id if job else None)


@router.post("/design/analyze", response_model=JobOut, status_code=202, responses=ERRORS, tags=["Design"], summary="Analyze voices for design")
def design_analyze(request: Request) -> JobOut:
    services = _services(request)
    try:
        services.registry.get("kokoro")
    except EngineError as exc:
        raise HTTPException(400, detail=("engine_unavailable", "Voice design needs Kokoro — download it from Models")) from exc
    running = services.jobs.active("design.analyze", lambda _i: True)
    return _job_out(running or services.jobs.submit("design.analyze", "Analyzing voices for design", {}))


@router.post("/design/candidates", response_model=DesignOut, responses=ERRORS, tags=["Design"], summary="Design voices from a description")
def design_candidates(request: Request, body: DesignIn) -> DesignOut:
    """Reads the description (plus any slider overrides) and returns up to four blends that match it.
    Speak a candidate by passing its `recipe` as the `voice` with engine `kokoro`."""
    services = _services(request)
    traits = services.traits.load()
    if not traits:
        raise HTTPException(409, detail=("not_analyzed", "Analyze voices first (POST /v1/design/analyze)"))
    target = apply_sliders(parse_description(body.description), body.model_dump())
    if body.gender:
        target.gender = body.gender
    return DesignOut(
        target=DesignTargetOut(**{k: getattr(target, k) for k in ("gender", "language", "depth", "warmth", "energy", "speed")}, matched=list(target.matched)),
        candidates=design(traits, target),
    )


def _designed_out(v: DesignedVoice) -> DesignedVoiceOut:
    return DesignedVoiceOut(**v.public())


@router.post("/voices/designed", response_model=DesignedVoiceOut, status_code=201, responses=ERRORS, tags=["Design"], summary="Save a designed voice")
def save_designed_voice(request: Request, body: DesignedVoiceIn) -> DesignedVoiceOut:
    services = _services(request)
    try:
        parts = parse_recipe(body.recipe)
    except EngineError as exc:
        raise HTTPException(400, detail=("invalid_recipe", str(exc))) from exc
    traits = {t.voice: t for t in services.traits.load() or []}
    lead = traits.get(parts[0][0])
    lang = {"a": "en-US", "b": "en-GB"}.get(parts[0][0][0], "en-US")
    voice = DesignedVoice(
        id=f"dv_{uuid.uuid4().hex[:12]}", name=body.name.strip(), recipe=body.recipe, description=body.description.strip(),
        language=lead.language if lead else lang, gender=lead.gender if lead else None, speed=body.speed, created_at=time.time(),
    )
    services.store.add_designed_voice(voice)
    services.bus.publish("voices.changed", {"id": voice.id})
    return _designed_out(voice)


@router.get("/voices/designed", response_model=list[DesignedVoiceOut], tags=["Design"], summary="List designed voices")
def list_designed_voices(request: Request) -> list[DesignedVoiceOut]:
    return [_designed_out(v) for v in _services(request).store.list_designed_voices()]


@router.patch("/voices/designed/{voice_id}", response_model=DesignedVoiceOut, responses=ERRORS, tags=["Design"], summary="Rename a designed voice")
def rename_designed_voice(request: Request, voice_id: str, body: CustomVoicePatch) -> DesignedVoiceOut:
    services = _services(request)
    voice = services.store.rename_designed_voice(voice_id, body.name.strip())
    if voice is None:
        raise HTTPException(404, detail=("not_found", "No such voice"))
    services.bus.publish("voices.changed", {"id": voice_id})
    return _designed_out(voice)


@router.delete("/voices/designed/{voice_id}", status_code=204, responses=ERRORS, tags=["Design"], summary="Delete a designed voice")
def delete_designed_voice(request: Request, voice_id: str) -> Response:
    services = _services(request)
    if not services.store.delete_designed_voice(voice_id):
        raise HTTPException(404, detail=("not_found", "No such voice"))
    services.store.delete_voice_meta("kokoro", voice_id)
    services.bus.publish("voices.changed", {"id": voice_id})
    return Response(status_code=204)


# --- Transcription ------------------------------------------------------------

MAX_UPLOAD = 2 * 1024**3


def _summary(t: Transcript) -> TranscriptSummaryOut:
    return TranscriptSummaryOut(
        id=t.id, title=t.title, source=t.source, language=t.language, duration_s=t.duration_s, model=t.model,
        preview=t.text[:160], has_audio=bool(t.audio), created_at=t.created_at,
    )


def _full(t: Transcript) -> TranscriptOut:
    return TranscriptOut(**_summary(t).model_dump(), text=t.text, segments=t.segments)


def _get_transcript(services, transcript_id: str) -> Transcript:
    t = services.store.get_transcript(transcript_id)
    if t is None:
        raise HTTPException(404, detail=("not_found", "No such transcript"))
    return t


@router.post("/transcriptions", response_model=JobOut, status_code=202, responses=ERRORS, tags=["Transcription"], summary="Transcribe an audio or video file")
async def create_transcription(
    request: Request,
    file: UploadFile = File(description="Any common audio or video format (wav, mp3, m4a, mp4, mov, webm…), up to 2 GB"),
    language: str | None = Form(None, description="ISO code such as `en`; omit to detect automatically"),
    model: str | None = Form(None, description="Whisper model id; defaults to your preference or the most accurate installed"),
    title: str | None = Form(None, max_length=120),
) -> JobOut:
    """Starts a transcription job. On success its `result.transcript_id` points to the transcript."""
    services = _services(request)
    try:
        services.registry.get("whisper").pick(model)  # type: ignore[attr-defined]
    except EngineError as exc:
        raise HTTPException(400, detail=("engine_unavailable", str(exc))) from exc
    suffix = Path(file.filename or "audio").suffix.lower()[:8] or ".bin"
    audio_name = f"{uuid.uuid4().hex}{suffix}"
    dest = uploads_dir(services) / audio_name
    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(400, detail=("file_too_large", "Files up to 2 GB are supported"))
            out.write(chunk)
    name = title or Path(file.filename or "Recording").stem[:120] or "Recording"
    spec = {"audio": audio_name, "language": language, "model": model, "title": name, "transcript_id": uuid.uuid4().hex}
    return _job_out(services.jobs.submit("transcribe", f"Transcribing {name}", spec))


@router.get("/transcriptions", response_model=list[TranscriptSummaryOut], tags=["Transcription"], summary="List transcripts")
def list_transcriptions(request: Request, q: str | None = Query(None, max_length=200), limit: int = Query(100, ge=1, le=500)) -> list[TranscriptSummaryOut]:
    return [_summary(t) for t in _services(request).store.list_transcripts(limit, q)]


@router.get("/transcriptions/{transcript_id}", response_model=TranscriptOut, responses=ERRORS, tags=["Transcription"], summary="Get a transcript")
def get_transcription(request: Request, transcript_id: str) -> TranscriptOut:
    return _full(_get_transcript(_services(request), transcript_id))


@router.patch("/transcriptions/{transcript_id}", response_model=TranscriptOut, responses=ERRORS, tags=["Transcription"], summary="Rename or correct a transcript")
def patch_transcription(request: Request, transcript_id: str, body: TranscriptPatch) -> TranscriptOut:
    services = _services(request)
    _get_transcript(services, transcript_id)
    fields: dict = {}
    if body.title is not None:
        fields["title"] = body.title.strip()
    if body.segments is not None:
        segs = [s.model_dump() for s in body.segments]
        fields.update(segments=segs, text=to_text(segs))
    t = services.store.update_transcript(transcript_id, **fields) if fields else _get_transcript(services, transcript_id)
    services.bus.publish("transcripts.changed", {"id": transcript_id})
    return _full(t)


@router.delete("/transcriptions/{transcript_id}", status_code=204, responses=ERRORS, tags=["Transcription"], summary="Delete a transcript")
def delete_transcription(request: Request, transcript_id: str) -> Response:
    services = _services(request)
    t = services.store.delete_transcript(transcript_id)
    if t is None:
        raise HTTPException(404, detail=("not_found", "No such transcript"))
    if t.audio:
        (uploads_dir(services) / t.audio).unlink(missing_ok=True)
    services.bus.publish("transcripts.changed", {"id": transcript_id})
    return Response(status_code=204)


@router.get("/transcriptions/{transcript_id}/audio", response_class=FileResponse, responses=ERRORS, tags=["Transcription"], summary="The transcribed recording")
def transcription_audio(request: Request, transcript_id: str) -> FileResponse:
    services = _services(request)
    t = _get_transcript(services, transcript_id)
    path = uploads_dir(services) / t.audio if t.audio else None
    if path is None or not path.exists():
        raise HTTPException(404, detail=("not_found", "This transcript has no audio"))
    return FileResponse(path)


@router.get("/transcriptions/{transcript_id}/export", responses={200: {"content": {"text/plain": {}}}, **ERRORS}, tags=["Transcription"], summary="Export as txt, srt, vtt or json")
def export_transcription(request: Request, transcript_id: str, format: str = Query("txt", pattern="^(txt|srt|vtt|json)$")) -> Response:
    t = _get_transcript(_services(request), transcript_id)
    media, render = EXPORTS[format]
    safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in t.title).strip() or "transcript"
    return Response(render(t), media_type=f"{media}; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{safe}.{format}"'})


@router.post("/transcriptions/{transcript_id}/save", status_code=204, responses=ERRORS, tags=["Transcription"], summary="Save an export to a file")
def save_transcription(request: Request, transcript_id: str, body: ExportPathIn, format: str = Query("txt", pattern="^(txt|srt|vtt|json)$")) -> Response:
    """Writes the transcript in `format` to `path` (which must end in `.<format>`)."""
    t = _get_transcript(_services(request), transcript_id)
    dest = _destination(body.path, f".{format}", body.overwrite)
    dest.write_text(EXPORTS[format][1](t), encoding="utf-8")
    return Response(status_code=204)


@router.websocket("/transcribe/live")
async def live_transcription(websocket: WebSocket, token: str = "", language: str = "", model: str = "", save: bool = True, title: str = ""):
    """Stream 16 kHz mono PCM16 (little-endian) as binary frames; receive JSON:
    `{"type":"partial","text"}` while speaking, `{"type":"final","segment"}` after each pause.
    Send `{"type":"stop"}` to finish; the reply is `{"type":"done","text","transcript_id"}`."""
    services = websocket.app.state.services
    expected = services.settings.token
    if expected and not hmac.compare_digest(token, expected):
        await websocket.close(code=4401, reason="unauthorized")
        return
    try:
        engine = services.registry.get("whisper")
        engine.pick(model or None, fast=True)  # type: ignore[attr-defined]
    except EngineError as exc:
        await websocket.accept()
        await websocket.send_json({"type": "error", "error": "engine_unavailable", "message": str(exc)})
        await websocket.close()
        return
    await websocket.accept()
    session = LiveSession(engine, language or None, model or None)  # type: ignore[arg-type]
    await websocket.send_json({"type": "ready", "sample_rate": 16000})
    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                return
            if msg.get("bytes"):
                session.add(msg["bytes"])
                if session.should_finalize():
                    if seg := await session.finalize():
                        await websocket.send_json({"type": "final", "segment": seg})
                elif (text := await session.partial()) is not None:
                    await websocket.send_json({"type": "partial", "text": text})
            elif msg.get("text"):
                if json.loads(msg["text"]).get("type") == "stop":
                    if seg := await session.finalize():
                        await websocket.send_json({"type": "final", "segment": seg})
                    saved = save_live(services, session, title or None) if save else None
                    await websocket.send_json({"type": "done", "text": to_text(session.segments), "transcript_id": saved.id if saved else None})
                    await websocket.close()
                    return
    except (WebSocketDisconnect, RuntimeError):
        return


# --- Jobs -------------------------------------------------------------------


@router.get("/jobs", response_model=list[JobOut], tags=["Jobs"], summary="List jobs")
def list_jobs(request: Request, limit: int = Query(50, ge=1, le=500)) -> list[JobOut]:
    return [_job_out(j) for j in _services(request).store.list_jobs(limit)]


@router.delete("/jobs", response_model=ClearedOut, tags=["Jobs"], summary="Clear finished jobs")
def clear_jobs(request: Request) -> ClearedOut:
    """Deletes every job that is no longer queued or running. Takes they produced are kept."""
    return ClearedOut(deleted=_services(request).store.delete_finished_jobs())


@router.get("/jobs/{job_id}", response_model=JobOut, responses=ERRORS, tags=["Jobs"], summary="Get a job")
def get_job(request: Request, job_id: str) -> JobOut:
    job = _services(request).store.get_job(job_id)
    if job is None:
        raise HTTPException(404, detail=("not_found", "No such job"))
    return _job_out(job)


@router.post("/jobs/{job_id}/cancel", response_model=JobOut, responses=ERRORS, tags=["Jobs"], summary="Cancel a job")
def cancel_job(request: Request, job_id: str) -> JobOut:
    """Queued jobs cancel immediately; running jobs stop at their next checkpoint. Cancelling a finished job is a no-op."""
    job = _services(request).jobs.cancel(job_id)
    if job is None:
        raise HTTPException(404, detail=("not_found", "No such job"))
    return _job_out(job)


@router.get(
    "/jobs/{job_id}/events",
    responses={200: {"content": {"text/event-stream": {}}, "description": "Server-sent events"}, **ERRORS},
    tags=["Jobs"],
    summary="Stream job events",
)
async def job_events(request: Request, job_id: str, after: int = Query(0, ge=0, description="Only events with `seq` greater than this")):
    """Server-sent events for one job: every past event after `after`, then live ones.
    The stream closes after the job finishes. Reconnect with `after=<last seq>` to resume without gaps."""
    store = _services(request).store
    if store.get_job(job_id) is None:
        raise HTTPException(404, detail=("not_found", "No such job"))

    async def stream():
        last, idle = after, time.monotonic()
        while not await request.is_disconnected():
            for event in store.job_events(job_id, last):
                last = event.seq
                idle = time.monotonic()
                yield f"id: {event.seq}\nevent: {event.type}\ndata: {json.dumps(event.data)}\n\n"
            job = store.get_job(job_id)
            if job is None or (job.finished and not store.job_events(job_id, last)):
                yield "event: end\ndata: {}\n\n"
                return
            if time.monotonic() - idle > SSE_KEEPALIVE_S:
                idle = time.monotonic()
                yield ": keepalive\n\n"
            await asyncio.sleep(0.2)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


# --- Live events --------------------------------------------------------------


@router.websocket("/events")
async def events(websocket: WebSocket, token: str = ""):
    """App-wide live events as JSON messages `{"type": ..., "data": ...}`. Authenticate with `?token=`."""
    services = websocket.app.state.services
    expected = services.settings.token
    if expected and not hmac.compare_digest(token, expected):
        await websocket.close(code=4401, reason="unauthorized")
        return
    await websocket.accept()
    async with services.bus.subscribe() as queue:
        await websocket.send_json({"type": "hello", "data": {"version": __version__}})
        try:
            while True:
                await websocket.send_json(await queue.get())
        except (WebSocketDisconnect, RuntimeError):
            pass
