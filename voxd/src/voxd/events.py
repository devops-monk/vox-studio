"""In-process pub/sub that fans voxd events out to WebSocket clients."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def publish(self, type_: str, data: dict[str, Any]) -> None:
        """Safe to call from any thread."""
        if self._loop is None:
            return
        message = {"type": type_, "data": data}
        for queue in list(self._subscribers):
            self._loop.call_soon_threadsafe(_offer, queue, message)

    @asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue[dict[str, Any]]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=256)
        self._subscribers.add(queue)
        try:
            yield queue
        finally:
            self._subscribers.discard(queue)


def _offer(queue: asyncio.Queue, message: dict) -> None:
    # A client that stops reading loses messages rather than growing memory without bound.
    if not queue.full():
        queue.put_nowait(message)
