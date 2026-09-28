from __future__ import annotations

import asyncio
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
from ..keys import authenticate, create_key
from ..pronounce import pronouncer
from .. import tools
from ..transcripts import EXPORTS, LiveSession, save_live, to_text, uploads_dir
from ..store import Transcript
from .. import batch as batching, books, dubbing
from ..store import Book
from ..store import Dub
from ..history import RETENTION_CHOICES, RETENTION_KEY, delete_takes, sweep, usage_bytes
from ..store import DesignedVoice
from ..speech import resolve_engine, save_take
from ..store import Job, Take
from .schemas import (
    ConnectionOut,
    ApiKeyCreated,
    ApiKeyIn,
    ApiKeyOut,
    PronunciationIn,
    PronunciationOut,
    PronunciationPatch,
    PronunciationPreviewIn,
    PronunciationPreviewOut,
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
    ExportRecordOut,
    ProjectIn,
    ProjectItemIn,
    ProjectItemOut,
    ProjectOut,
    ProjectPatch,
    ProjectSummaryOut,
    BatchIn,
    BatchItemOut,
    BatchOut,
    WatchFolderIn,
    WatchFolderOut,
    WatchFolderPatch,
    BookExportIn,
    BookOut,
    BookPatch,
    BookRenderIn,
    BookSummaryOut,
    ChapterOut,
    TimingsOut,
    DubLanguageOut,
    DubOut,
    DubPatch,
    DubSaveIn,
    DubSummaryOut,
    DubTranslateIn,
    PreviewOut,
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
    return [_model_out(services, spec, info) for spec in services.models.catalog if not spec.hidden]


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
        await asyncio.to_thread(engine.synthesize, pronouncer.apply(body.text), body.voice, body.speed, out, body.emotion)
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
    take = services.store.get_take(take_id)
    services.store.record_export("take", take_id, take.text[:80] if take else "Take", "wav", str(dest), dest.stat().st_size)
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
    _services(request).store.record_export("transcript", transcript_id, t.title, format, str(dest), dest.stat().st_size)
    return Response(status_code=204)


@router.websocket("/transcribe/live")
async def live_transcription(websocket: WebSocket, token: str = "", language: str = "", model: str = "", save: bool = True, title: str = ""):
    """Stream 16 kHz mono PCM16 (little-endian) as binary frames; receive JSON:
    `{"type":"partial","text"}` while speaking, `{"type":"final","segment"}` after each pause.
    Send `{"type":"stop"}` to finish; the reply is `{"type":"done","text","transcript_id"}`."""
    services = websocket.app.state.services
    if authenticate(services, token) is None:
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


# --- Dubbing -------------------------------------------------------------------

DUB_JOBS = ("dub.prepare", "dub.translate", "dub.render")


def _dub_job(services, dub_id: str):
    for kind in DUB_JOBS:
        if job := services.jobs.active(kind, lambda i: i.get("dub_id") == dub_id):
            return job
    return None


def _dub_summary(d: Dub) -> DubSummaryOut:
    return DubSummaryOut(
        id=d.id, title=d.title, status=d.status, has_video=d.has_video, duration_s=d.duration_s, source_lang=d.source_lang,
        target_lang=d.target_lang, created_at=d.created_at, updated_at=d.updated_at,
    )


def _dub_out(services, d: Dub) -> DubOut:
    job = _dub_job(services, d.id)
    base = f"/v1/dubs/{d.id}/media"
    return DubOut(
        **_dub_summary(d).model_dump(), mix=d.mix, segments=d.segments, cast=d.cast,
        audio_url=f"{base}/audio" if d.output.get("audio") else None,
        video_url=f"{base}/video" if d.output.get("video") else None,
        source_url=f"{base}/source", stale=bool(d.output.get("stale")), error=d.error, job_id=job.id if job else None,
    )


def _get_dub(services, dub_id: str) -> Dub:
    d = services.store.get_dub(dub_id)
    if d is None:
        raise HTTPException(404, detail=("not_found", "No such dub"))
    return d


def _require_idle(services, d: Dub) -> None:
    if _dub_job(services, d.id):
        raise HTTPException(409, detail=("busy", "Wait for the current step to finish, or cancel it"))


@router.get("/dubs/languages", response_model=list[DubLanguageOut], tags=["Dubbing"], summary="Languages you can dub into")
def dub_languages(request: Request) -> list[DubLanguageOut]:
    services = _services(request)
    return [DubLanguageOut(code=c, name=n, has_voice=dubbing.default_voice(services, c) is not None) for c, n in dubbing.LANGUAGES.items()]


@router.post("/dubs", response_model=DubOut, status_code=201, responses=ERRORS, tags=["Dubbing"], summary="Start a dub from a video or audio file")
async def create_dub(
    request: Request,
    file: UploadFile = File(description="Video or audio (mp4, mov, mkv, webm, mp3, m4a, wav…), up to 2 GB"),
    target_language: str = Form(description="Dub into: en, es, fr, de, it, pt, hi, ja or zh"),
    source_language: str | None = Form(None, description="Spoken language; omit to detect"),
    title: str | None = Form(None, max_length=120),
) -> DubOut:
    """Uploads the file and starts preparing it (transcribe + translate). Watch `job_id`, then review and render."""
    services = _services(request)
    if target_language not in dubbing.LANGUAGES:
        raise HTTPException(400, detail=("unsupported_language", f"Can't dub into {target_language!r} yet"))
    if not services.media.available():
        raise HTTPException(400, detail=("engine_unavailable", "Dubbing needs Whisper — download a Whisper model from Models"))
    try:
        services.registry.get("whisper")
    except EngineError as exc:
        raise HTTPException(400, detail=("engine_unavailable", str(exc))) from exc
    dub_id = uuid.uuid4().hex
    folder = dubbing.dub_dir(services, dub_id)
    suffix = Path(file.filename or "media").suffix.lower()[:8] or ".bin"
    dest = folder / f"source{suffix}"
    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD:
                out.close()
                shutil.rmtree(folder, ignore_errors=True)
                raise HTTPException(400, detail=("file_too_large", "Files up to 2 GB are supported"))
            out.write(chunk)
    now = time.time()
    d = Dub(
        id=dub_id, title=title or Path(file.filename or "Dub").stem[:120] or "Dub", status="preparing", source_file=dest.name,
        has_video=False, duration_s=0.0, source_lang=source_language or "", target_lang=target_language, mix="duck",
        segments=[], cast={}, output={}, error=None, created_at=now, updated_at=now,
    )
    services.store.add_dub(d)
    services.jobs.submit("dub.prepare", f"Preparing {d.title}", {"dub_id": dub_id, "source_lang": source_language})
    return _dub_out(services, d)


@router.get("/dubs", response_model=list[DubSummaryOut], tags=["Dubbing"], summary="List dubs")
def list_dubs(request: Request) -> list[DubSummaryOut]:
    return [_dub_summary(d) for d in _services(request).store.list_dubs()]


@router.get("/dubs/{dub_id}", response_model=DubOut, responses=ERRORS, tags=["Dubbing"], summary="Get a dub")
def get_dub(request: Request, dub_id: str) -> DubOut:
    services = _services(request)
    return _dub_out(services, _get_dub(services, dub_id))


@router.patch("/dubs/{dub_id}", response_model=DubOut, responses=ERRORS, tags=["Dubbing"], summary="Edit a dub")
def patch_dub(request: Request, dub_id: str, body: DubPatch) -> DubOut:
    """Edit lines (translation, speaker), the voice cast, the mix or the title. Any change after a render marks it `stale`."""
    services = _services(request)
    d = _get_dub(services, dub_id)
    _require_idle(services, d)
    fields: dict = {}
    if body.title is not None:
        fields["title"] = body.title.strip()
    if body.mix is not None:
        fields["mix"] = body.mix
    if body.cast is not None:
        cast = {**d.cast, **{k: v.model_dump() for k, v in body.cast.items()}}
        for speaker, v in body.cast.items():
            try:
                engine = services.registry.get(v.engine)
            except EngineError as exc:
                raise HTTPException(400, detail=("engine_unavailable", str(exc))) from exc
            if not any(x.id == v.voice for x in engine.voices()):
                raise HTTPException(400, detail=("unknown_voice", f"{v.voice} isn't a {v.engine} voice"))
        fields["cast"] = cast
    if body.segments is not None:
        by_id = {s.id: s for s in body.segments}
        segments = []
        for seg in d.segments:
            patch = by_id.get(seg["id"])
            if patch:
                seg = {**seg, **{k: v for k, v in patch.model_dump().items() if v is not None and k != "id"}}
                seg.pop("fit", None)
            segments.append(seg)
        fields["segments"] = segments
        # New speakers get a voice straight away.
        cast = fields.get("cast", d.cast)
        for seg in segments:
            if seg["speaker"] not in cast:
                cast = {**cast, seg["speaker"]: dubbing.default_voice(services, d.target_lang)}
        fields["cast"] = cast
    if fields and d.output.get("audio") and set(fields) != {"title"}:
        fields["output"] = {**d.output, "stale": True}
    updated = services.store.update_dub(dub_id, **fields) if fields else d
    services.bus.publish("dubs.changed", {"id": dub_id})
    return _dub_out(services, updated)


@router.post("/dubs/{dub_id}/translate", response_model=JobOut, status_code=202, responses=ERRORS, tags=["Dubbing"], summary="Translate again")
def retranslate_dub(request: Request, dub_id: str, body: DubTranslateIn) -> JobOut:
    """Re-translates every line (optionally into a new target language). Your edits to translations are replaced."""
    services = _services(request)
    d = _get_dub(services, dub_id)
    _require_idle(services, d)
    target = body.target_language or d.target_lang
    if target not in dubbing.LANGUAGES:
        raise HTTPException(400, detail=("unsupported_language", f"Can't dub into {target!r} yet"))
    if not d.segments:
        raise HTTPException(409, detail=("not_ready", "This dub hasn't been transcribed yet"))
    return _job_out(services.jobs.submit("dub.translate", f"Translating {d.title}", {"dub_id": dub_id, "target": target}))


@router.post("/dubs/{dub_id}/render", response_model=JobOut, status_code=202, responses=ERRORS, tags=["Dubbing"], summary="Render the dub")
def render_dub(request: Request, dub_id: str) -> JobOut:
    services = _services(request)
    d = _get_dub(services, dub_id)
    _require_idle(services, d)
    if d.status not in ("ready", "done", "failed") or not d.segments:
        raise HTTPException(409, detail=("not_ready", "This dub isn't ready to render"))
    missing = sorted({s["speaker"] for s in d.segments} - {k for k, v in d.cast.items() if v and v.get("voice")})
    if missing:
        raise HTTPException(400, detail=("missing_voice", f"Choose a voice for {', '.join(missing)}"))
    services.store.update_dub(dub_id, status="rendering", error=None)
    services.bus.publish("dubs.changed", {"id": dub_id})
    return _job_out(services.jobs.submit("dub.render", f"Rendering {d.title}", {"dub_id": dub_id}))


@router.post("/dubs/{dub_id}/segments/{segment_id}/preview", response_model=PreviewOut, responses=ERRORS, tags=["Dubbing"], summary="Hear one line")
async def preview_segment(request: Request, dub_id: str, segment_id: str) -> PreviewOut:
    services = _services(request)
    d = _get_dub(services, dub_id)
    seg = next((s for s in d.segments if s["id"] == segment_id), None)
    if seg is None:
        raise HTTPException(404, detail=("not_found", "No such line"))
    previews = dubbing.dub_dir(services, dub_id) / "previews"
    previews.mkdir(exist_ok=True)
    out = previews / f"{segment_id}.wav"
    try:
        audio, rate = await asyncio.to_thread(dubbing.speak, services, d.cast, seg, 1.0, out)
    except EngineError as exc:
        raise HTTPException(400, detail=("synthesis_failed", str(exc))) from exc
    return PreviewOut(audio_url=f"/v1/dubs/{dub_id}/media/preview-{segment_id}", duration_s=round(len(audio) / rate, 2))


@router.get("/dubs/{dub_id}/media/{name}", response_class=FileResponse, responses=ERRORS, tags=["Dubbing"], summary="Source, dubbed audio/video, or a line preview")
def dub_media(request: Request, dub_id: str, name: str) -> FileResponse:
    services = _services(request)
    d = _get_dub(services, dub_id)
    folder = dubbing.dub_dir(services, dub_id)
    if name == "source":
        path = folder / d.source_file
    elif name == "audio" and d.output.get("audio"):
        path = folder / d.output["audio"]
    elif name == "video" and d.output.get("video"):
        path = folder / d.output["video"]
    elif name.startswith("preview-") and name[8:].isalnum():
        path = folder / "previews" / f"{name[8:]}.wav"
    else:
        raise HTTPException(404, detail=("not_found", "Not available"))
    if not path.exists():
        raise HTTPException(404, detail=("not_found", "Not available"))
    return FileResponse(path)


@router.get("/dubs/{dub_id}/subtitles", responses={200: {"content": {"text/plain": {}}}, **ERRORS}, tags=["Dubbing"], summary="Subtitles")
def dub_subtitles(
    request: Request, dub_id: str, format: str = Query("srt", pattern="^(srt|vtt)$"), which: str = Query("translation", pattern="^(translation|text)$")
) -> Response:
    """`which=translation` for the dubbed language, `which=text` for the original."""
    d = _get_dub(_services(request), dub_id)
    safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in d.title).strip() or "dub"
    lang = d.target_lang if which == "translation" else d.source_lang
    return Response(
        dubbing.subtitles(d, format, which), media_type=f"{'text/vtt' if format == 'vtt' else 'application/x-subrip'}; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe}.{lang}.{format}"'},
    )


@router.post("/dubs/{dub_id}/save", status_code=204, responses=ERRORS, tags=["Dubbing"], summary="Save an output to a file")
def save_dub(request: Request, dub_id: str, body: DubSaveIn) -> Response:
    services = _services(request)
    d = _get_dub(services, dub_id)
    folder = dubbing.dub_dir(services, dub_id)
    suffix = {"video": ".mp4", "audio": ".wav", "srt": ".srt", "vtt": ".vtt"}[body.what]
    dest = _destination(body.path, suffix, body.overwrite)
    if body.what in ("srt", "vtt"):
        dest.write_text(dubbing.subtitles(d, body.what), encoding="utf-8")
    else:
        src = d.output.get(body.what)
        if not src:
            raise HTTPException(409, detail=("not_rendered", "Render the dub first"))
        shutil.copyfile(folder / src, dest)
    services.store.record_export("dub", dub_id, d.title, {"video": "mp4", "audio": "wav"}.get(body.what, body.what), str(dest), dest.stat().st_size)
    return Response(status_code=204)


@router.delete("/dubs/{dub_id}", status_code=204, responses=ERRORS, tags=["Dubbing"], summary="Delete a dub")
def delete_dub(request: Request, dub_id: str) -> Response:
    services = _services(request)
    d = _get_dub(services, dub_id)
    if job := _dub_job(services, d.id):
        services.jobs.cancel(job.id)
    services.store.delete_dub(dub_id)
    shutil.rmtree(dubbing.dub_dir(services, dub_id), ignore_errors=True)
    services.bus.publish("dubs.changed", {"id": dub_id})
    return Response(status_code=204)


# --- Stories & audiobooks ---------------------------------------------------------

BOOK_JOBS = ("book.render", "book.export")


def _book_job(services, book_id: str):
    for kind in BOOK_JOBS:
        if job := services.jobs.active(kind, lambda i: i.get("book_id") == book_id):
            return job
    return None


def _words(text: str) -> int:
    return len(text.split())


def _chapter_out(b: Book, c: dict) -> ChapterOut:
    render = c.get("render")
    fresh = render and render.get("fingerprint") == books.chapter_fingerprint(c, b.kind, b.cast, b.speed)
    return ChapterOut(
        id=c["id"], title=c["title"], text=c["text"], words=_words(c["text"]),
        status="rendered" if fresh else "stale" if render else "not_rendered",
        duration_s=render["duration_s"] if render else None,
        audio_url=f"/v1/books/{b.id}/chapters/{c['id']}/audio" if render else None,
    )


def _book_out(services, b: Book) -> BookOut:
    job = _book_job(services, b.id)
    return BookOut(
        id=b.id, title=b.title, author=b.author, kind=b.kind, language=b.language, speed=b.speed,
        chapters=[_chapter_out(b, c) for c in b.chapters], cast=b.cast, characters=b.characters,
        exports={fmt: f"/v1/books/{b.id}/export/{fmt}" for fmt in b.exports}, job_id=job.id if job else None,
        created_at=b.created_at, updated_at=b.updated_at,
    )


def _get_book(services, book_id: str) -> Book:
    b = services.store.get_book(book_id)
    if b is None:
        raise HTTPException(404, detail=("not_found", "No such book"))
    return b


@router.post("/books", response_model=BookOut, status_code=201, responses=ERRORS, tags=["Books"], summary="Import a book or story")
async def create_book(
    request: Request,
    file: UploadFile | None = File(None, description=".txt, .md, .docx or .epub (max 50 MB)"),
    text: str | None = Form(None, max_length=2_000_000, description="Or paste text directly"),
    title: str | None = Form(None, max_length=200),
    kind: str = Form("audiobook", pattern="^(audiobook|story)$"),
    language: str = Form("en", max_length=8),
) -> BookOut:
    """Splits the document into chapters (headings / “Chapter …” lines / EPUB spine) and finds speaking
    characters. A default narrator voice for `language` is chosen."""
    services = _services(request)
    try:
        if file is not None:
            imported = books.import_document(file.filename or "book.txt", await file.read())
        elif text and text.strip():
            imported = books.import_document("pasted.txt", text.encode())
        else:
            raise EngineError("Upload a file or paste some text")
    except EngineError as exc:
        raise HTTPException(400, detail=("invalid_document", str(exc))) from exc
    chapters = [{"id": uuid.uuid4().hex[:8], **c} for c in imported.chapters]
    characters = books.find_characters(chapters)
    narrator = dubbing.default_voice(services, language)
    now = time.time()
    b = Book(
        id=uuid.uuid4().hex, title=title or imported.title, author=imported.author, kind=kind, language=language, speed=1.0,
        chapters=chapters, cast={"narrator": narrator, "characters": {c["name"]: None for c in characters}},
        characters=characters, exports={}, created_at=now, updated_at=now,
    )
    services.store.add_book(b)
    services.bus.publish("books.changed", {"id": b.id})
    return _book_out(services, b)


@router.get("/books", response_model=list[BookSummaryOut], tags=["Books"], summary="List books and stories")
def list_books(request: Request, kind: str | None = Query(None, pattern="^(audiobook|story)$")) -> list[BookSummaryOut]:
    out = []
    for b in _services(request).store.list_books(kind):
        out.append(BookSummaryOut(
            id=b.id, title=b.title, author=b.author, kind=b.kind, chapters=len(b.chapters),
            rendered=sum(1 for c in b.chapters if c.get("render")), words=sum(_words(c["text"]) for c in b.chapters), updated_at=b.updated_at,
        ))
    return out


@router.get("/books/{book_id}", response_model=BookOut, responses=ERRORS, tags=["Books"], summary="Get a book")
def get_book(request: Request, book_id: str) -> BookOut:
    services = _services(request)
    return _book_out(services, _get_book(services, book_id))


@router.patch("/books/{book_id}", response_model=BookOut, responses=ERRORS, tags=["Books"], summary="Edit a book")
def patch_book(request: Request, book_id: str, body: BookPatch) -> BookOut:
    """Chapters whose text, voices or pace change show as `stale` until rendered again."""
    services = _services(request)
    b = _get_book(services, book_id)
    fields: dict = {k: v for k, v in body.model_dump(exclude={"cast", "chapters"}).items() if v is not None}
    if body.cast is not None:
        cast = {**b.cast}
        if "narrator" in body.cast:
            cast["narrator"] = body.cast["narrator"]
        if "characters" in body.cast:
            cast["characters"] = {**(b.cast.get("characters") or {}), **body.cast["characters"]}
        fields["cast"] = cast
    if body.chapters is not None:
        edits = {c.id: c for c in body.chapters}
        chapters = []
        for c in b.chapters:
            e = edits.get(c["id"])
            if e:
                c = {**c, **{k: v for k, v in e.model_dump().items() if v is not None and k != "id"}}
            chapters.append(c)
        fields["chapters"] = chapters
        fields["characters"] = books.find_characters(chapters)
        known = (fields.get("cast") or b.cast).get("characters") or {}
        new_cast = {**(fields.get("cast") or b.cast)}
        new_cast["characters"] = {**{c["name"]: None for c in fields["characters"]}, **known}
        fields["cast"] = new_cast
    updated = services.store.update_book(book_id, **fields) if fields else b
    services.bus.publish("books.changed", {"id": book_id})
    return _book_out(services, updated)


@router.delete("/books/{book_id}", status_code=204, responses=ERRORS, tags=["Books"], summary="Delete a book")
def delete_book(request: Request, book_id: str) -> Response:
    services = _services(request)
    _get_book(services, book_id)
    if job := _book_job(services, book_id):
        services.jobs.cancel(job.id)
    services.store.delete_book(book_id)
    shutil.rmtree(books.book_dir(services, book_id), ignore_errors=True)
    services.bus.publish("books.changed", {"id": book_id})
    return Response(status_code=204)


@router.post("/books/{book_id}/render", response_model=JobOut, status_code=202, responses=ERRORS, tags=["Books"], summary="Render chapters")
def render_book(request: Request, book_id: str, body: BookRenderIn) -> JobOut:
    """Renders the chapters (default: all) that aren't already rendered and unchanged. Safe to run again after an interruption — it resumes."""
    services = _services(request)
    b = _get_book(services, book_id)
    if _book_job(services, book_id):
        raise HTTPException(409, detail=("busy", "This book is already rendering"))
    if not (b.cast.get("narrator") or {}).get("voice"):
        raise HTTPException(400, detail=("missing_voice", "Choose a narrator voice first"))
    return _job_out(services.jobs.submit("book.render", f"Narrating {b.title}", {"book_id": book_id, "chapters": body.chapters}))


@router.get("/books/{book_id}/chapters/{chapter_id}/audio", response_class=FileResponse, responses=ERRORS, tags=["Books"], summary="Chapter audio")
def chapter_audio(request: Request, book_id: str, chapter_id: str) -> FileResponse:
    services = _services(request)
    c = next((c for c in _get_book(services, book_id).chapters if c["id"] == chapter_id), None)
    if not c or not c.get("render"):
        raise HTTPException(404, detail=("not_found", "This chapter hasn't been rendered"))
    return FileResponse(books.book_dir(services, book_id) / c["render"]["file"], media_type="audio/wav")


@router.get("/books/{book_id}/chapters/{chapter_id}/timings", response_model=TimingsOut, responses=ERRORS, tags=["Books"], summary="Sentence timings for highlighting")
def chapter_timings(request: Request, book_id: str, chapter_id: str) -> TimingsOut:
    c = next((c for c in _get_book(_services(request), book_id).chapters if c["id"] == chapter_id), None)
    if not c or not c.get("render"):
        raise HTTPException(404, detail=("not_found", "This chapter hasn't been rendered"))
    return TimingsOut(duration_s=c["render"]["duration_s"], timings=c["render"]["timings"])


@router.post("/books/{book_id}/export", response_model=JobOut, status_code=202, responses=ERRORS, tags=["Books"], summary="Export the whole book")
def export_book(request: Request, book_id: str, body: BookExportIn) -> JobOut:
    """M4B includes chapter markers (Apple Books, most audiobook players). Every chapter must be rendered."""
    services = _services(request)
    b = _get_book(services, book_id)
    if any(not c.get("render") for c in b.chapters):
        raise HTTPException(409, detail=("not_rendered", "Render every chapter first"))
    if _book_job(services, book_id):
        raise HTTPException(409, detail=("busy", "Wait for the current step to finish"))
    return _job_out(services.jobs.submit("book.export", f"Exporting {b.title} ({body.format.upper()})", {"book_id": book_id, "format": body.format}))


@router.get("/books/{book_id}/export/{fmt}", response_class=FileResponse, responses=ERRORS, tags=["Books"], summary="Download an export")
def download_book(request: Request, book_id: str, fmt: str) -> FileResponse:
    services = _services(request)
    b = _get_book(services, book_id)
    if fmt not in b.exports:
        raise HTTPException(404, detail=("not_found", "Not exported yet"))
    safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in b.title).strip() or "book"
    return FileResponse(books.book_dir(services, book_id) / b.exports[fmt], filename=f"{safe}.{fmt}")


@router.post("/books/{book_id}/save", status_code=204, responses=ERRORS, tags=["Books"], summary="Save an export to a file")
def save_book(request: Request, book_id: str, body: ExportPathIn, format: str = Query(pattern="^(m4b|mp3)$")) -> Response:
    services = _services(request)
    b = _get_book(services, book_id)
    if format not in b.exports:
        raise HTTPException(409, detail=("not_exported", "Export the book first"))
    dest = _destination(body.path, f".{format}", body.overwrite)
    shutil.copyfile(books.book_dir(services, book_id) / b.exports[format], dest)
    services.store.record_export("book", book_id, b.title, format, str(dest), dest.stat().st_size)
    return Response(status_code=204)


# --- Batches & watch folders -------------------------------------------------------

TRANSCRIPT_FORMATS = {"txt", "srt", "vtt", "json"}


def _check_voice(services, engine_id: str | None, voice: str | None) -> None:
    if not engine_id or not voice:
        raise HTTPException(400, detail=("missing_voice", "Choose an engine and a voice"))
    try:
        engine = services.registry.get(engine_id)
    except EngineError as exc:
        raise HTTPException(400, detail=("engine_unavailable", str(exc))) from exc
    if not any(v.id == voice for v in engine.voices()):
        raise HTTPException(400, detail=("unknown_voice", f"{voice} isn't a {engine_id} voice"))


def _check_dir(path: str | None, create: bool = False) -> str | None:
    if not path:
        return None
    p = Path(path).expanduser()
    if not p.is_absolute():
        raise HTTPException(400, detail=("invalid_path", "Use an absolute folder path"))
    if create:
        p.mkdir(parents=True, exist_ok=True)
    if not p.is_dir():
        raise HTTPException(400, detail=("invalid_path", f"{path} isn't a folder"))
    return str(p)


def _batch_out(services, b: dict) -> BatchOut:
    items = []
    for job_id in b["job_ids"]:
        job = services.store.get_job(job_id)
        if job is None:
            continue
        result = job.result or {}
        output = result.get("output") or ";".join(result.get("outputs", [])) or None
        name = job.input.get("name") or Path(job.input.get("path", "item")).name
        items.append(BatchItemOut(job_id=job.id, name=name, status=job.status, progress=job.progress, message=job.message, error=job.error, output=output))
    return BatchOut(
        id=b["id"], kind=b["kind"], title=b["title"], output_dir=b["output_dir"], created_at=b["created_at"], total=len(items),
        done=sum(i.status == "succeeded" for i in items), failed=sum(i.status == "failed" for i in items), items=items,
    )


@router.post("/batches", response_model=BatchOut, status_code=201, responses=ERRORS, tags=["Batch"], summary="Queue many items")
def create_batch(request: Request, body: BatchIn) -> BatchOut:
    """`speech`: render each `items[]` text with one voice. `transcribe`: transcribe each file in `paths[]`.
    Every item becomes its own job; with `output_dir`, results are also written there."""
    services = _services(request)
    output_dir = _check_dir(body.output_dir, create=True)
    if body.kind == "speech":
        if not body.items:
            raise HTTPException(400, detail=("empty_batch", "Add at least one text"))
        _check_voice(services, body.engine, body.voice)
        items = [i.model_dump() for i in body.items]
        options = {"engine": body.engine, "voice": body.voice, "speed": body.speed}
    else:
        if not body.paths:
            raise HTTPException(400, detail=("empty_batch", "Add at least one file"))
        missing = [p for p in body.paths if not Path(p).is_file()]
        if missing:
            raise HTTPException(400, detail=("invalid_path", f"Not found: {missing[0]}"))
        if bad := set(body.formats) - TRANSCRIPT_FORMATS:
            raise HTTPException(400, detail=("invalid_request", f"Unknown format: {sorted(bad)[0]}"))
        try:
            services.registry.get("whisper").pick(body.model)  # type: ignore[attr-defined]
        except EngineError as exc:
            raise HTTPException(400, detail=("engine_unavailable", str(exc))) from exc
        items = [{"path": p} for p in body.paths]
        options = {"language": body.language, "model": body.model, "formats": body.formats}
    title = body.title or f"{len(items)} {'texts' if body.kind == 'speech' else 'files'}"
    return _batch_out(services, batching.submit_batch(services, body.kind, title, items, options, output_dir))


@router.get("/batches", response_model=list[BatchOut], tags=["Batch"], summary="List batches")
def list_batches(request: Request) -> list[BatchOut]:
    services = _services(request)
    return [_batch_out(services, b) for b in services.store.list_batches()]


@router.get("/batches/{batch_id}", response_model=BatchOut, responses=ERRORS, tags=["Batch"], summary="Get a batch")
def get_batch(request: Request, batch_id: str) -> BatchOut:
    services = _services(request)
    b = services.store.get_batch(batch_id)
    if b is None:
        raise HTTPException(404, detail=("not_found", "No such batch"))
    return _batch_out(services, b)


@router.post("/batches/{batch_id}/cancel", response_model=BatchOut, responses=ERRORS, tags=["Batch"], summary="Cancel remaining items")
def cancel_batch(request: Request, batch_id: str) -> BatchOut:
    services = _services(request)
    b = services.store.get_batch(batch_id)
    if b is None:
        raise HTTPException(404, detail=("not_found", "No such batch"))
    for job_id in b["job_ids"]:
        services.jobs.cancel(job_id)
    return _batch_out(services, b)


@router.delete("/batches/{batch_id}", status_code=204, responses=ERRORS, tags=["Batch"], summary="Remove a batch from the list")
def delete_batch(request: Request, batch_id: str) -> Response:
    """Cancels anything still running. Takes, transcripts and files already written are kept."""
    services = _services(request)
    b = services.store.get_batch(batch_id)
    if b is None:
        raise HTTPException(404, detail=("not_found", "No such batch"))
    for job_id in b["job_ids"]:
        services.jobs.cancel(job_id)
    services.store.delete_batch(batch_id)
    services.bus.publish("batches.changed", {"id": batch_id})
    return Response(status_code=204)


def _watch_out(services, w: dict) -> WatchFolderOut:
    recent = services.store.watch_files(w["id"])
    return WatchFolderOut(
        **w, exists=Path(w["path"]).is_dir(), output_dir=str(Path(w["path"]) / batching.OUTPUT_DIR),
        processed=len(services.store.watch_seen(w["id"])), recent=recent,
    )


@router.get("/watch-folders", response_model=list[WatchFolderOut], tags=["Batch"], summary="List watch folders")
def list_watch_folders(request: Request) -> list[WatchFolderOut]:
    services = _services(request)
    return [_watch_out(services, w) for w in services.store.list_watch_folders()]


@router.post("/watch-folders", response_model=WatchFolderOut, status_code=201, responses=ERRORS, tags=["Batch"], summary="Watch a folder")
def add_watch_folder(request: Request, body: WatchFolderIn) -> WatchFolderOut:
    """Files already in the folder are processed too. Results go to a `VoxStudio output` subfolder."""
    services = _services(request)
    path = _check_dir(body.path)
    if any(w["path"] == path for w in services.store.list_watch_folders()):
        raise HTTPException(409, detail=("already_watched", "That folder is already being watched"))
    if body.action == "speak":
        _check_voice(services, body.engine, body.voice)
        options = {"engine": body.engine, "voice": body.voice, "speed": body.speed}
    else:
        try:
            services.registry.get("whisper").pick(body.model)  # type: ignore[attr-defined]
        except EngineError as exc:
            raise HTTPException(400, detail=("engine_unavailable", str(exc))) from exc
        options = {"language": body.language, "model": body.model, "formats": [f for f in body.formats if f in TRANSCRIPT_FORMATS] or ["txt"]}
    w = {"id": uuid.uuid4().hex, "path": path, "action": body.action, "options": options, "enabled": body.enabled, "created_at": time.time()}
    services.store.add_watch_folder(w)
    services.bus.publish("watch.changed", {"id": w["id"]})
    return _watch_out(services, w)


@router.patch("/watch-folders/{watch_id}", response_model=WatchFolderOut, responses=ERRORS, tags=["Batch"], summary="Pause or resume a watch folder")
def patch_watch_folder(request: Request, watch_id: str, body: WatchFolderPatch) -> WatchFolderOut:
    services = _services(request)
    if services.store.get_watch_folder(watch_id) is None:
        raise HTTPException(404, detail=("not_found", "No such watch folder"))
    w = services.store.update_watch_folder(watch_id, **body.model_dump(exclude_none=True)) if body.enabled is not None else services.store.get_watch_folder(watch_id)
    services.bus.publish("watch.changed", {"id": watch_id})
    return _watch_out(services, w)


@router.delete("/watch-folders/{watch_id}", status_code=204, responses=ERRORS, tags=["Batch"], summary="Stop watching a folder")
def delete_watch_folder(request: Request, watch_id: str) -> Response:
    services = _services(request)
    if not services.store.delete_watch_folder(watch_id):
        raise HTTPException(404, detail=("not_found", "No such watch folder"))
    services.bus.publish("watch.changed", {"id": watch_id})
    return Response(status_code=204)


# --- Projects & export history ------------------------------------------------------

PROJECT_KINDS = ("take", "transcript", "dub", "book")


def _resolve_item(services, kind: str, item_id: str) -> dict:
    """Title and a short description for anything that can live in a project."""
    s = services.store
    if kind == "take" and (t := s.get_take(item_id)):
        return {"title": t.text[:90], "subtitle": f"{t.engine} · {t.duration_s:.1f}s", "created_at": t.created_at}
    if kind == "transcript" and (t := s.get_transcript(item_id)):
        return {"title": t.title, "subtitle": f"Transcript · {t.language.upper()} · {t.duration_s:.0f}s", "created_at": t.created_at}
    if kind == "dub" and (d := s.get_dub(item_id)):
        return {"title": d.title, "subtitle": f"Dub · {d.source_lang.upper() or '…'} → {d.target_lang.upper()} · {d.status}", "created_at": d.created_at}
    if kind == "book" and (b := s.get_book(item_id)):
        return {"title": b.title, "subtitle": f"{'Story' if b.kind == 'story' else 'Audiobook'} · {len(b.chapters)} chapters", "created_at": b.created_at}
    return {"title": "Deleted item", "subtitle": kind, "created_at": None, "missing": True}


def _get_project(services, project_id: str) -> dict:
    p = services.store.get_project(project_id)
    if p is None:
        raise HTTPException(404, detail=("not_found", "No such project"))
    return p


@router.get("/projects", response_model=list[ProjectSummaryOut], tags=["Projects"], summary="List projects")
def list_projects(request: Request) -> list[ProjectSummaryOut]:
    return [ProjectSummaryOut(**p) for p in _services(request).store.list_projects()]


@router.post("/projects", response_model=ProjectSummaryOut, status_code=201, tags=["Projects"], summary="Create a project")
def create_project(request: Request, body: ProjectIn) -> ProjectSummaryOut:
    services = _services(request)
    now = time.time()
    p = {"id": uuid.uuid4().hex, "name": body.name.strip(), "color": body.color, "description": body.description.strip(), "created_at": now, "updated_at": now}
    services.store.add_project(p)
    services.bus.publish("projects.changed", {"id": p["id"]})
    return ProjectSummaryOut(**p, item_count=0)


@router.get("/projects/membership", response_model=list[str], tags=["Projects"], summary="Which projects contain an item")
def project_membership(request: Request, kind: str = Query(pattern="^(take|transcript|dub|book)$"), item_id: str = Query(alias="id")) -> list[str]:
    return _services(request).store.projects_for(kind, item_id)


@router.get("/projects/{project_id}", response_model=ProjectOut, responses=ERRORS, tags=["Projects"], summary="Get a project")
def get_project(request: Request, project_id: str) -> ProjectOut:
    """Items with titles, plus the export history of everything in the project."""
    services = _services(request)
    p = _get_project(services, project_id)
    raw = services.store.project_items(project_id)
    items = [ProjectItemOut(kind=i["kind"], id=i["item_id"], added_at=i["added_at"], **_resolve_item(services, i["kind"], i["item_id"])) for i in raw]
    exports = services.store.list_exports([(i["kind"], i["item_id"]) for i in raw])
    return ProjectOut(**p, item_count=len(items), items=items, exports=[ExportRecordOut(**e, exists=Path(e["path"]).exists()) for e in exports])


@router.patch("/projects/{project_id}", response_model=ProjectSummaryOut, responses=ERRORS, tags=["Projects"], summary="Rename or recolor a project")
def patch_project(request: Request, project_id: str, body: ProjectPatch) -> ProjectSummaryOut:
    services = _services(request)
    _get_project(services, project_id)
    fields = {k: v.strip() if isinstance(v, str) and k != "color" else v for k, v in body.model_dump(exclude_none=True).items()}
    p = services.store.update_project(project_id, **fields) if fields else _get_project(services, project_id)
    services.bus.publish("projects.changed", {"id": project_id})
    return ProjectSummaryOut(**p, item_count=len(services.store.project_items(project_id)))


@router.delete("/projects/{project_id}", status_code=204, responses=ERRORS, tags=["Projects"], summary="Delete a project")
def delete_project(request: Request, project_id: str) -> Response:
    """Removes the project only; its takes, transcripts, dubs and books are kept."""
    services = _services(request)
    if not services.store.delete_project(project_id):
        raise HTTPException(404, detail=("not_found", "No such project"))
    services.bus.publish("projects.changed", {"id": project_id})
    return Response(status_code=204)


@router.post("/projects/{project_id}/items", status_code=204, responses=ERRORS, tags=["Projects"], summary="Add an item")
def add_project_item(request: Request, project_id: str, body: ProjectItemIn) -> Response:
    services = _services(request)
    _get_project(services, project_id)
    if _resolve_item(services, body.kind, body.id).get("missing"):
        raise HTTPException(404, detail=("not_found", f"No such {body.kind}"))
    services.store.add_project_item(project_id, body.kind, body.id)
    services.bus.publish("projects.changed", {"id": project_id})
    return Response(status_code=204)


@router.delete("/projects/{project_id}/items/{kind}/{item_id}", status_code=204, responses=ERRORS, tags=["Projects"], summary="Remove an item")
def remove_project_item(request: Request, project_id: str, kind: str, item_id: str) -> Response:
    services = _services(request)
    if not services.store.remove_project_item(project_id, kind, item_id):
        raise HTTPException(404, detail=("not_found", "That item isn't in this project"))
    services.bus.publish("projects.changed", {"id": project_id})
    return Response(status_code=204)


@router.get("/exports", response_model=list[ExportRecordOut], tags=["Projects"], summary="Export history")
def export_history(request: Request, limit: int = Query(100, ge=1, le=500)) -> list[ExportRecordOut]:
    """Every file VoxStudio has saved (takes, transcripts, dubs, books, batch outputs), newest first."""
    return [ExportRecordOut(**e, exists=Path(e["path"]).exists()) for e in _services(request).store.list_exports(None, limit)]


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


# --- Tools --------------------------------------------------------------------


async def _tool_source(services, file: UploadFile | None, take_id: str | None) -> tuple[str, str]:
    """Stage the input of a tool job: an uploaded file or a copy of a take. Returns (upload name, title)."""
    if (file is None) == (take_id is None):
        raise HTTPException(400, detail=("invalid_request", "Send either `file` or `take_id`"))
    if take_id:
        try:
            return tools.stage_take(services, take_id)
        except EngineError as exc:
            raise HTTPException(404, detail=("not_found", str(exc))) from exc
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
                raise HTTPException(400, detail=("file_too_large", "Files up to 2 GB are supported"))
            out.write(chunk)
    return name, Path(file.filename or "Recording").stem[:120] or "Recording"


@router.post("/tools/clean", response_model=JobOut, status_code=202, responses=ERRORS, tags=["Tools"], summary="Clean up a recording")
async def clean_audio(
    request: Request,
    file: UploadFile | None = File(None, description="Audio or video to clean (send this or `take_id`)"),
    take_id: str | None = Form(None, description="Clean an existing take instead of a file"),
    denoise: bool = Form(True, description="Remove steady background noise (hiss, hum, fans) and low rumble"),
    trim: bool = Form(False, description="Shorten silences longer than 0.6 s and cut dead air at both ends"),
    normalize: bool = Form(True, description="Even out loudness to `loudness`"),
    loudness: float = Form(-16.0, ge=-30, le=-10, description="Target in LUFS: −16 podcasts and voice-over, −14 streaming, −23 broadcast"),
) -> JobOut:
    """Runs in the background; on success `result.take_id` is the cleaned take, plus before/after levels."""
    services = _services(request)
    if not services.media.available():
        raise HTTPException(400, detail=("engine_unavailable", "Audio tools need the Whisper engine — download a Whisper model from Models"))
    if not (denoise or trim or normalize):
        raise HTTPException(400, detail=("invalid_request", "Choose at least one of denoise, trim or normalize"))
    audio, title = await _tool_source(services, file, take_id)
    spec = {"audio": audio, "title": f"Cleaned · {title}", "denoise": denoise, "trim": trim, "normalize": loudness if normalize else None}
    return _job_out(services.jobs.submit("tools.clean", f"Cleaning {title}", spec))


@router.post("/tools/convert", response_model=JobOut, status_code=202, responses=ERRORS, tags=["Tools"], summary="Convert a recording to another voice")
async def convert_voice(
    request: Request,
    voice: str = Form(description="Target voice: one of your voices (`cv_…`) or `default`"),
    file: UploadFile | None = File(None, description="A recording of speech, up to 15 minutes (send this or `take_id`)"),
    take_id: str | None = Form(None, description="Convert an existing take instead of a file"),
) -> JobOut:
    """Keeps the words, timing and delivery of the recording and swaps the voice (speech-to-speech).
    Needs the Chatterbox engine. The result carries the same inaudible AI watermark as other Chatterbox audio."""
    services = _services(request)
    try:
        reason = services.registry.get("chatterbox").probe()
    except EngineError:
        reason = "Voice conversion needs the Chatterbox engine"
    if reason:
        raise HTTPException(400, detail=("engine_unavailable", reason))
    if not services.media.available():
        raise HTTPException(400, detail=("engine_unavailable", "Voice conversion also needs the Whisper engine to read media — download a Whisper model"))
    if voice != "default" and services.store.get_custom_voice(voice) is None:
        raise HTTPException(404, detail=("not_found", f"Unknown voice: {voice}"))
    audio, title = await _tool_source(services, file, take_id)
    return _job_out(services.jobs.submit("tools.convert", f"Converting {title}", {"audio": audio, "voice": voice, "title": f"Converted · {title}"}))


# --- Pronunciations -----------------------------------------------------------


def _pron_out(services, pid: str) -> PronunciationOut:
    for p in services.store.list_pronunciations():
        if p["id"] == pid:
            return PronunciationOut(**p)
    raise HTTPException(404, detail=("not_found", "No such pronunciation"))


@router.get("/pronunciations", response_model=list[PronunciationOut], tags=["Pronunciations"], summary="List pronunciations")
def list_pronunciations(request: Request) -> list[PronunciationOut]:
    return [PronunciationOut(**p) for p in _services(request).store.list_pronunciations()]


@router.post("/pronunciations", response_model=PronunciationOut, status_code=201, responses=ERRORS, tags=["Pronunciations"], summary="Add a pronunciation")
def add_pronunciation(request: Request, body: PronunciationIn) -> PronunciationOut:
    """From now on every engine says `say` wherever `term` appears as a whole word."""
    services = _services(request)
    if any(p["term"].lower() == body.term.strip().lower() for p in services.store.list_pronunciations()):
        raise HTTPException(409, detail=("conflict", f"“{body.term.strip()}” already has a pronunciation"))
    pid = f"pr_{uuid.uuid4().hex[:12]}"
    services.store.add_pronunciation({"id": pid, "term": body.term.strip(), "say": body.say.strip(), "case_sensitive": body.case_sensitive, "created_at": time.time()})
    pronouncer.invalidate()
    services.bus.publish("pronunciations.changed", {})
    return _pron_out(services, pid)


@router.patch("/pronunciations/{pid}", response_model=PronunciationOut, responses=ERRORS, tags=["Pronunciations"], summary="Edit a pronunciation")
def patch_pronunciation(request: Request, pid: str, body: PronunciationPatch) -> PronunciationOut:
    services = _services(request)
    _pron_out(services, pid)
    fields = {k: (v.strip() if isinstance(v, str) else v) for k, v in body.model_dump(exclude_none=True).items()}
    if fields:
        services.store.update_pronunciation(pid, **fields)
        pronouncer.invalidate()
        services.bus.publish("pronunciations.changed", {})
    return _pron_out(services, pid)


@router.delete("/pronunciations/{pid}", status_code=204, responses=ERRORS, tags=["Pronunciations"], summary="Remove a pronunciation")
def delete_pronunciation(request: Request, pid: str) -> None:
    services = _services(request)
    if not services.store.delete_pronunciation(pid):
        raise HTTPException(404, detail=("not_found", "No such pronunciation"))
    pronouncer.invalidate()
    services.bus.publish("pronunciations.changed", {})


@router.post("/pronunciations/preview", response_model=PronunciationPreviewOut, tags=["Pronunciations"], summary="See what an engine will be asked to say")
def preview_pronunciations(body: PronunciationPreviewIn) -> PronunciationPreviewOut:
    return PronunciationPreviewOut(text=pronouncer.apply(body.text))


@router.get("/connection", response_model=ConnectionOut, tags=["API keys"], summary="How to connect to this voxd")
def connection(request: Request) -> ConnectionOut:
    services = _services(request)
    url = f"http://127.0.0.1:{services.settings.port}"
    return ConnectionOut(
        url=url, api_base=f"{url}/v1", mcp_url=f"{url}/mcp", openapi_url=f"{url}/openapi.json", docs_url=f"{url}/docs",
        bridge_path=str(Path(__file__).resolve().parent.parent / "mcp_bridge.py"), auth_required=bool(services.settings.token),
    )


# --- API keys -----------------------------------------------------------------


def _require_app(request: Request) -> None:
    if getattr(request.state, "auth", "app") != "app":
        raise HTTPException(403, detail=("forbidden", "API keys can't manage API keys — use the VoxStudio app"))


@router.get("/keys", response_model=list[ApiKeyOut], responses=ERRORS, tags=["API keys"], summary="List API keys")
def list_keys(request: Request) -> list[ApiKeyOut]:
    _require_app(request)
    return [ApiKeyOut(**k) for k in _services(request).store.list_api_keys()]


@router.post("/keys", response_model=ApiKeyCreated, status_code=201, responses=ERRORS, tags=["API keys"], summary="Create an API key")
def create_api_key(request: Request, body: ApiKeyIn) -> ApiKeyCreated:
    """The full `key` is returned only here — store it safely. Only the app itself can create keys."""
    _require_app(request)
    services = _services(request)
    key, row = create_key(services, body.name.strip())
    services.bus.publish("keys.changed", {})
    return ApiKeyCreated(**row, key=key)


@router.delete("/keys/{key_id}", status_code=204, responses=ERRORS, tags=["API keys"], summary="Revoke an API key")
def revoke_key(request: Request, key_id: str) -> None:
    _require_app(request)
    services = _services(request)
    if not services.store.delete_api_key(key_id):
        raise HTTPException(404, detail=("not_found", "No such key"))
    services.bus.publish("keys.changed", {})


# --- Live events --------------------------------------------------------------


@router.websocket("/events")
async def events(websocket: WebSocket, token: str = ""):
    """App-wide live events as JSON messages `{"type": ..., "data": ...}`. Authenticate with `?token=`."""
    services = websocket.app.state.services
    if authenticate(services, token) is None:
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
