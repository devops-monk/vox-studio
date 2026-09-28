from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from functools import partial

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .api.routes import router
from .config import Settings
from .engines.chatterbox import ChatterboxEngine
from .engines.kokoro import KokoroEngine
from .engines.registry import Registry
from .engines.system import SystemEngine
from .engines.whisper import WhisperEngine
from .events import EventBus
from .jobs import JobContext, JobManager
from .lifecycle import Lifecycle, Phase
from .models import CATALOG, TRANSLATION_MODELS, ModelSpec, ModelStore
from .runtimes import PACKS, RuntimeManager
from .design import TraitStore
from .history import sweeper
from .media import Media
from .batch import Watcher, speech_item, transcribe_item
from .books import export_book as book_export, render_book as book_render
from .dubbing import prepare as dub_prepare, render as dub_render, retranslate as dub_retranslate
from .api.mcp import router as mcp_router
from .api.openai import OpenAIError, router as openai_router
from .keys import authenticate
from .pronounce import pronouncer
from . import tools
from .speech import render_long
from .transcripts import transcribe_file
from .voices import CustomVoices
from .store import Store

log = logging.getLogger("voxd")

# Reachable without the token: the shell polls status before it can hand the token to anyone,
# and the schema/docs contain nothing sensitive.
PUBLIC_PATHS = {"/v1/status", "/openapi.json", "/docs"}

DESCRIPTION = """
The local API behind VoxStudio. Everything the app does, your scripts can do too.

**Authentication:** send `Authorization: Bearer <token>` on every request except
`GET /v1/status`. Audio URLs used directly in `<audio>` tags may pass `?token=<token>` instead.

**Errors** always look like `{"error": "<code>", "message": "<human text>"}`.

**Long work** runs as a job: queue it, then follow `GET /v1/jobs/{id}/events` (server-sent events)
or the app-wide `WS /v1/events` stream.
"""


@dataclass
class Services:
    """Everything a request handler or job needs, in one place."""

    settings: Settings
    lifecycle: Lifecycle
    registry: Registry
    bus: EventBus
    models: ModelStore
    runtimes: RuntimeManager
    custom: CustomVoices
    traits: TraitStore
    media: Media = None  # type: ignore[assignment]
    watcher: Watcher = None  # type: ignore[assignment]
    store: Store = None  # type: ignore[assignment]  # opened in lifespan
    jobs: JobManager = None  # type: ignore[assignment]


def download_model(services: Services, ctx: JobContext, spec: dict) -> dict:
    model = services.models.get(spec["model_id"])
    files_from = 0.0
    if model.runtime and not services.runtimes.installed(pack := PACKS[model.runtime]):
        files_from = 0.3
        services.runtimes.install(ctx, pack, span=(0.0, files_from))
    services.models.download(ctx, model, span=(files_from, 1.0))
    services.registry.refresh(model.engine)
    services.bus.publish("models.changed", {"id": model.id, "installed": True})
    return {"model_id": model.id}


def analyze_voices(services: Services, ctx: JobContext, _spec: dict) -> dict:
    engine = services.registry.get("kokoro")
    result = services.traits.analyze(ctx, engine)  # type: ignore[arg-type]
    services.bus.publish("design.ready", result)
    return result


def create_app(
    settings: Settings, registry: Registry | None = None, catalog: tuple[ModelSpec, ...] = CATALOG + TRANSLATION_MODELS
) -> FastAPI:
    settings.ensure_dirs()
    models = ModelStore(settings.models_dir, catalog, settings.model_mirror)
    runtimes = RuntimeManager(settings.data_dir / "runtimes")
    custom = CustomVoices(None, settings.data_dir / "voices")  # type: ignore[arg-type]  # store opens in lifespan
    services: Services  # referenced lazily by the device callback below
    registry = registry or Registry(
        [
            SystemEngine(),
            KokoroEngine(models, designed=lambda: services.store.list_designed_voices()),
            ChatterboxEngine(models, runtimes, custom, device=lambda: services.store.get_setting("compute_device", "auto")),
            WhisperEngine(models, runtimes, preferred=lambda: services.store.get_setting("asr_model")),
        ]
    )
    services = Services(
        settings, Lifecycle(), registry, EventBus(), models, runtimes, custom, TraitStore(settings.data_dir / "voice-traits.json"), Media(runtimes)
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        services.bus.bind(asyncio.get_running_loop())
        services.store = Store(settings.db_path)
        discovery = settings.data_dir / "voxd.json"
        discovery.write_text(json.dumps({"url": f"http://127.0.0.1:{settings.port}", "port": settings.port, "pid": os.getpid(), "version": __version__}))
        pronouncer.bind(services.store)
        if not models.mirror:  # the environment variable wins over the saved setting
            models.mirror = services.store.get_setting("model_mirror", "") or ""
        custom.store = services.store
        services.jobs = JobManager(services.store, services.bus)
        services.jobs.register("speech", partial(render_long, services))
        services.jobs.register("model.download", partial(download_model, services), lane="network")
        services.jobs.register("design.analyze", partial(analyze_voices, services))
        services.jobs.register("transcribe", partial(transcribe_file, services), lane="asr")
        services.jobs.register("dub.prepare", partial(dub_prepare, services), lane="asr")
        services.jobs.register("dub.render", partial(dub_render, services))
        services.jobs.register("dub.translate", partial(dub_retranslate, services), lane="asr")
        services.jobs.register("book.render", partial(book_render, services))
        services.jobs.register("book.export", partial(book_export, services), lane="media")
        services.jobs.register("batch.speech", partial(speech_item, services))
        services.jobs.register("batch.transcribe", partial(transcribe_item, services), lane="asr")
        services.jobs.register("tools.clean", partial(tools.clean_job, services), lane="media")
        services.jobs.register("tools.convert", partial(tools.convert_job, services))
        services.jobs.start()
        cleanup = asyncio.create_task(sweeper(services), name="retention")
        services.watcher = Watcher(services)
        watching = asyncio.create_task(services.watcher.run(), name="watch-folders")
        services.lifecycle.set(Phase.LOADING_ENGINES, "Checking engines")
        try:
            await asyncio.to_thread(services.registry.probe_all)
            services.lifecycle.set(Phase.READY)
        except Exception as exc:
            log.exception("engine probe failed")
            services.lifecycle.set(Phase.ERROR, str(exc))
        yield
        cleanup.cancel()
        watching.cancel()
        services.media.stop()
        for engine_id in ("chatterbox", "kokoro", "whisper"):
            if engine := services.registry.raw(engine_id):
                engine.unload()
        await services.jobs.stop()
        services.store.close()
        discovery.unlink(missing_ok=True)

    app = FastAPI(title="voxd", version=__version__, description=DESCRIPTION, lifespan=lifespan, redoc_url=None)
    app.state.services = services

    @app.middleware("http")
    async def require_token(request: Request, call_next):
        if request.method == "OPTIONS" or request.url.path in PUBLIC_PATHS:
            return await call_next(request)
        header = request.headers.get("authorization", "")
        supplied = header.removeprefix("Bearer ").strip() or request.query_params.get("token", "")
        auth = authenticate(services, supplied)
        if auth is None:
            return JSONResponse({"error": "unauthorized", "message": "Missing or invalid token or API key"}, status_code=401)
        request.state.auth = auth
        return await call_next(request)

    # Added last so it wraps the token check and answers preflights first.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException):
        code, message = exc.detail if isinstance(exc.detail, tuple) else ("http_error", str(exc.detail))
        return JSONResponse({"error": code, "message": message}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first["loc"][1:])
        if request.url.path.startswith("/v1/audio/"):
            return OpenAIError(400, f"{where}: {first['msg']}", "invalid_value", where or None).response()
        return JSONResponse({"error": "invalid_request", "message": f"{where}: {first['msg']}"}, status_code=422)

    @app.exception_handler(OpenAIError)
    async def openai_error(_: Request, exc: OpenAIError):
        return exc.response()

    app.include_router(router)
    app.include_router(openai_router)
    app.include_router(mcp_router)
    return app
