"""Authentication: the per-launch app token, plus long-lived API keys for your own scripts.

Keys look like ``vox_sk_…``. Only a SHA-256 digest is stored, so a key is shown once, when it's
created. Keys can call every endpoint except the ones that manage keys.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
import uuid
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from .app import Services

PREFIX = "vox_sk_"
TOUCH_EVERY_S = 60.0

Auth = Literal["app", "key"]


def digest(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def create_key(services: Services, name: str) -> tuple[str, dict]:
    key = PREFIX + secrets.token_urlsafe(30)
    key_id = f"key_{uuid.uuid4().hex[:12]}"
    services.store.add_api_key(key_id, name, digest(key), f"{key[:11]}…{key[-4:]}", time.time())
    return key, next(k for k in services.store.list_api_keys() if k["id"] == key_id)


def authenticate(services: Services, supplied: str) -> Auth | None:
    """Who is calling: the app itself, an API key, or nobody (``None``)."""
    expected = services.settings.token
    if not expected:  # standalone voxd without a token: open on localhost
        return "app"
    if supplied and hmac.compare_digest(supplied, expected):
        return "app"
    if supplied.startswith(PREFIX) and (row := services.store.api_key_by_hash(digest(supplied))):
        now = time.time()
        if not row["last_used_at"] or now - row["last_used_at"] > TOUCH_EVERY_S:
            services.store.touch_api_key(row["id"], now)
        return "key"
    return None
