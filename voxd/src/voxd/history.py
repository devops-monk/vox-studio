"""Take history housekeeping: deleting takes (rows + audio) and retention cleanup."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .app import Services

log = logging.getLogger("voxd.history")

RETENTION_KEY = "history_retention_days"
RETENTION_CHOICES = (0, 7, 30, 90)  # 0 = keep forever
SWEEP_INTERVAL_S = 6 * 3600


def delete_takes(services: Services, ids: list[str]) -> list[str]:
    deleted = services.store.delete_takes(ids)
    for take_id in deleted:
        (services.settings.takes_dir / f"{take_id}.wav").unlink(missing_ok=True)
    if deleted:
        services.bus.publish("takes.deleted", {"ids": deleted})
    return deleted


def sweep(services: Services, now: float | None = None) -> int:
    """Delete unstarred takes older than the retention period. Returns how many were removed."""
    days = int(services.store.get_setting(RETENTION_KEY, 0) or 0)
    if days <= 0:
        return 0
    cutoff = (now or time.time()) - days * 86400
    removed = delete_takes(services, services.store.expired_takes(cutoff))
    if removed:
        log.info("retention: removed %d take(s) older than %d days", len(removed), days)
    return len(removed)


async def sweeper(services: Services) -> None:
    while True:
        try:
            await asyncio.to_thread(sweep, services)
        except Exception:
            log.exception("retention sweep failed")
        await asyncio.sleep(SWEEP_INTERVAL_S)


def usage_bytes(services: Services) -> int:
    return sum(f.stat().st_size for f in services.settings.takes_dir.glob("*.wav"))
