"""stdio ↔ HTTP bridge for MCP clients that can only launch a command (such as Claude Desktop).

Standard library only, so any Python 3.9+ can run it:

    VOX_API_KEY=vox_sk_… python3 mcp_bridge.py

It finds the running voxd through ``voxd.json`` in the VoxStudio data folder (or ``VOXD_URL``),
and forwards each JSON-RPC line from stdin to ``POST /mcp``, writing replies to stdout.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def data_dir() -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "com.voxstudio.app"
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", home)) / "VoxStudio"
    return Path(os.environ.get("XDG_DATA_HOME", home / ".local" / "share")) / "voxstudio"


def base_url() -> str:
    if url := os.environ.get("VOXD_URL"):
        return url.rstrip("/")
    try:
        return json.loads((data_dir() / "voxd.json").read_text())["url"]
    except (OSError, ValueError, KeyError):
        return "http://127.0.0.1:4870"


def error(mid, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32000, "message": message}}


def forward(line: str, key: str) -> str | None:
    try:
        mid = json.loads(line).get("id")
    except (ValueError, AttributeError):
        mid = None
    request = urllib.request.Request(
        base_url() + "/mcp", data=line.encode(), method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=3600) as res:
            body = res.read().decode()
            return body if res.status != 202 and body else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        return None if mid is None else json.dumps(error(mid, f"VoxStudio returned {exc.code}: {detail}"))
    except (urllib.error.URLError, OSError):
        return None if mid is None else json.dumps(error(mid, "VoxStudio isn't running — open the VoxStudio app and try again"))


def main() -> None:
    key = os.environ.get("VOX_API_KEY", "")
    for line in sys.stdin:
        if line.strip():
            reply = forward(line.strip(), key)
            if reply:
                sys.stdout.write(reply.replace("\n", " ") + "\n")
                sys.stdout.flush()


if __name__ == "__main__":
    main()
