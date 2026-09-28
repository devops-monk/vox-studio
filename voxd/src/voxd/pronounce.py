"""Pronunciation dictionary: rewrite words before any engine speaks them.

Rules are whole-word matches ("SQL" → "sequel", "Nguyen" → "Win"), longest terms first so
"New York" wins over "York". Only the text sent to the engine changes — takes, transcripts and
read-along text keep what you wrote.
"""

from __future__ import annotations

import re
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .store import Store


class Pronouncer:
    def __init__(self) -> None:
        self._store: Store | None = None
        self._rules: list[tuple[re.Pattern[str], str]] | None = None
        self._lock = threading.Lock()

    def bind(self, store: Store) -> None:
        self._store = store
        self.invalidate()

    def invalidate(self) -> None:
        with self._lock:
            self._rules = None

    def _compiled(self) -> list[tuple[re.Pattern[str], str]]:
        with self._lock:
            if self._rules is None:
                rules = sorted(self._store.list_pronunciations() if self._store else [], key=lambda r: -len(r["term"]))
                self._rules = [
                    (re.compile(rf"(?<!\w){re.escape(r['term'])}(?!\w)", 0 if r["case_sensitive"] else re.IGNORECASE), r["say"])
                    for r in rules
                    if r["term"].strip()
                ]
            return self._rules

    def apply(self, text: str) -> str:
        for pattern, say in self._compiled():
            text = pattern.sub(lambda _m, s=say: s, text)
        return text


pronouncer = Pronouncer()
