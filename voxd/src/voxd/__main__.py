"""Entry point: ``python -m voxd --port 4870 [--data-dir DIR] [--lifeline]``.

The token is read from the VOXD_TOKEN environment variable so it never shows up in `ps`.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
from pathlib import Path

import uvicorn

from .app import create_app
from .config import Settings, default_data_dir
from .lifecycle import watch_lifeline


class RedactTokens(logging.Filter):
    """Access logs include query strings; never let `?token=` reach a log line."""

    _pattern = re.compile(r"(token=)[^&\s\"']+")

    def filter(self, record: logging.LogRecord) -> bool:
        if record.args:
            record.args = tuple(self._pattern.sub(r"\1***", a) if isinstance(a, str) else a for a in record.args)
        record.msg = self._pattern.sub(r"\1***", str(record.msg))
        return True


def main() -> None:
    parser = argparse.ArgumentParser(prog="voxd")
    parser.add_argument("--port", type=int, default=4870)
    parser.add_argument("--data-dir", type=Path, default=default_data_dir())
    parser.add_argument("--lifeline", action="store_true", help="exit when stdin closes (used by the app)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if args.lifeline:
        watch_lifeline()

    redact = RedactTokens()
    for name in ("uvicorn.access", "uvicorn.error", "voxd"):
        logging.getLogger(name).addFilter(redact)

    settings = Settings(
        data_dir=args.data_dir,
        port=args.port,
        token=os.environ.get("VOXD_TOKEN", ""),
        model_mirror=os.environ.get("VOXD_MODEL_MIRROR", ""),
    )
    uvicorn.run(create_app(settings), host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
