"""Background jobs: a persistent queue with progress, cancellation and replayable events.

Jobs run in *lanes*, one job at a time per lane: ``compute`` for model work (speech
models are memory-hungry; two at once is slower than back to back) and ``network``
for downloads, so a big download never blocks speech. Handlers are plain functions run in a
worker thread; they report through a ``JobContext`` and check ``ctx.cancelled``
between steps.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import Callable
from typing import Any

from .engines.base import EngineError
from .events import EventBus
from .store import Job, Store

log = logging.getLogger("voxd.jobs")


class JobCancelled(Exception):
    pass


class JobContext:
    def __init__(self, manager: JobManager, job: Job):
        self._manager = manager
        self.job = job

    @property
    def cancelled(self) -> bool:
        return self.job.id in self._manager._cancel_requested

    def check(self) -> None:
        if self.cancelled:
            raise JobCancelled

    def progress(self, fraction: float, message: str | None = None) -> None:
        self._manager._update(self.job.id, "progress", progress=max(0.0, min(1.0, fraction)), message=message)

    def emit(self, type_: str, data: dict[str, Any]) -> None:
        self._manager._record(self.job.id, type_, data)


Handler = Callable[[JobContext, dict[str, Any]], dict[str, Any]]


class JobManager:
    def __init__(self, store: Store, bus: EventBus):
        self._store = store
        self._bus = bus
        self._handlers: dict[str, tuple[Handler, str]] = {}
        self._queues: dict[str, asyncio.Queue[str]] = {}
        self._cancel_requested: set[str] = set()
        self._workers: list[asyncio.Task] = []

    def register(self, kind: str, handler: Handler, lane: str = "compute") -> None:
        self._handlers[kind] = (handler, lane)
        self._queues.setdefault(lane, asyncio.Queue())

    def start(self) -> None:
        interrupted = self._store.fail_interrupted_jobs()
        if interrupted:
            log.info("marked %d interrupted job(s) as failed", interrupted)
        self._workers = [asyncio.create_task(self._run(q), name=f"jobs-{lane}") for lane, q in self._queues.items()]

    async def stop(self) -> None:
        for worker in self._workers:
            worker.cancel()

    def active(self, kind: str, predicate: Callable[[dict[str, Any]], bool]) -> Job | None:
        """The queued/running job of ``kind`` whose input matches, if any."""
        return next(
            (j for j in self._store.list_jobs(200) if j.kind == kind and not j.finished and predicate(j.input)), None
        )

    def submit(self, kind: str, title: str, input_: dict[str, Any]) -> Job:
        if kind not in self._handlers:
            raise EngineError(f"Unknown job kind: {kind}")
        now = time.time()
        job = Job(uuid.uuid4().hex, kind, title, "queued", 0.0, "Waiting to start", input_, None, None, now, now)
        self._store.add_job(job)
        self._record(job.id, "status", {"status": "queued"})
        self._publish(job)
        self._queues[self._handlers[kind][1]].put_nowait(job.id)
        return job

    def cancel(self, job_id: str) -> Job | None:
        job = self._store.get_job(job_id)
        if job is None or job.finished:
            return job
        if job.status == "queued":
            return self._finish(job_id, "cancelled", message="Cancelled")
        self._cancel_requested.add(job_id)  # the handler stops at its next checkpoint
        return self._update(job_id, "status", message="Cancelling…")

    async def _run(self, queue: asyncio.Queue[str]) -> None:
        while True:
            job_id = await queue.get()
            job = self._store.get_job(job_id)
            if job is None or job.status != "queued":
                continue  # cancelled or cleared while waiting
            job = self._update(job_id, "status", status="running", message="Starting")
            assert job is not None
            ctx = JobContext(self, job)
            try:
                result = await asyncio.to_thread(self._handlers[job.kind][0], ctx, job.input)
                self._finish(job_id, "succeeded", progress=1.0, message="Done", result=result)
            except JobCancelled:
                self._finish(job_id, "cancelled", message="Cancelled")
            except EngineError as exc:
                self._finish(job_id, "failed", message="Failed", error=str(exc))
            except Exception as exc:
                log.exception("job %s crashed", job_id)
                self._finish(job_id, "failed", message="Failed", error=f"Unexpected error: {exc}")
            finally:
                self._cancel_requested.discard(job_id)

    def _finish(self, job_id: str, status: str, **fields: Any) -> Job | None:
        return self._update(job_id, "status", status=status, **fields)

    def _update(self, job_id: str, event_type: str, **fields: Any) -> Job | None:
        job = self._store.update_job(job_id, **fields)
        if job is None:
            return None
        payload = {k: v for k, v in fields.items() if k in ("status", "progress", "message", "error", "result")}
        self._record(job_id, event_type, payload)
        self._publish(job)
        return job

    def _record(self, job_id: str, type_: str, data: dict[str, Any]) -> None:
        self._store.add_job_event(job_id, type_, data)

    def _publish(self, job: Job) -> None:
        self._bus.publish("job", job.public())
