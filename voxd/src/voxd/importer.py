"""Import audio or video from a link, then dub or transcribe it.

Only direct links to media files are supported (a web page is refused with a clear message).
Links to this computer or the local network are refused, so an API key can't be used to make
voxd fetch things from inside your network.
"""

from __future__ import annotations

import ipaddress
import mimetypes
import re
import socket
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .engines.base import EngineError
from .transcripts import uploads_dir

if TYPE_CHECKING:
    from .app import Services
    from .jobs import JobContext

MAX_BYTES = 2 * 1024**3
MEDIA_EXTS = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".mp4", ".mov", ".m4v", ".mkv", ".webm"}
# Media containers some servers label as application/*.
CONTAINERS = {"application/ogg": ".ogg", "application/mp4": ".mp4", "application/x-matroska": ".mkv"}
GENERIC = {"", "application/octet-stream", "binary/octet-stream"}


def check_url(url: str) -> str:
    """The URL if it's an http(s) link to a public host; raises EngineError otherwise."""
    parts = urllib.parse.urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise EngineError("Paste an http:// or https:// link")
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise EngineError(f"Couldn't find {parts.hostname}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            raise EngineError("Links to this computer or your local network can't be imported")
    return urllib.parse.urlunsplit(parts)


def _filename(url: str, headers: Any, content_type: str) -> tuple[str, str]:
    """(title, extension) from Content-Disposition, the URL path or the content type."""
    name = ""
    if cd := headers.get("Content-Disposition"):
        if m := re.search(r"filename\*?=(?:UTF-8'')?\"?([^\";]+)", cd):
            name = urllib.parse.unquote(m.group(1))
    if not name:
        name = urllib.parse.unquote(Path(urllib.parse.urlsplit(url).path).name)
    ext = Path(name).suffix.lower()
    if ext not in MEDIA_EXTS:
        ext = CONTAINERS.get(content_type) or mimetypes.guess_extension(content_type) or ""
        if ext == ".mpga":
            ext = ".mp3"
    return (Path(name).stem or "Imported")[:120], ext


def download(services: Services, ctx: JobContext, url: str) -> tuple[Path, str]:
    url = check_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": "voxd", "Accept": "audio/*, video/*, */*;q=0.5"})
    try:
        resp = urllib.request.urlopen(request, timeout=30)
    except Exception as exc:  # noqa: BLE001 — surface any network failure as a readable message
        raise EngineError(f"Couldn't download that link: {exc}") from exc
    with resp:
        check_url(resp.geturl())  # redirects must also stay public
        ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        title, ext = _filename(resp.geturl(), resp.headers, ctype)
        if not (ctype.startswith(("audio/", "video/")) or ctype in CONTAINERS or (ext in MEDIA_EXTS and ctype in GENERIC)):
            raise EngineError("That link isn't an audio or video file. Paste a direct link to the media file (not a web page).")
        total = int(resp.headers.get("Content-Length") or 0)
        if total > MAX_BYTES:
            raise EngineError("Files up to 2 GB can be imported")
        dest = uploads_dir(services) / f"{uuid.uuid4().hex}{ext or '.bin'}"
        done = 0
        try:
            with dest.open("wb") as out:
                while chunk := resp.read(1 << 20):
                    ctx.check()
                    done += len(chunk)
                    if done > MAX_BYTES:
                        raise EngineError("Files up to 2 GB can be imported")
                    out.write(chunk)
                    if total:
                        ctx.progress(0.9 * done / total, f"Downloading {done / 1e6:.0f} of {total / 1e6:.0f} MB")
                    else:
                        ctx.progress(0.3, f"Downloading {done / 1e6:.0f} MB")
        except BaseException:
            dest.unlink(missing_ok=True)
            raise
    return dest, title


def import_job(services: Services, ctx: JobContext, spec: dict[str, Any]) -> dict[str, Any]:
    """Job handler for ``import.url``: download, then start the requested work."""
    from . import dubbing

    path, title = download(services, ctx, spec["url"])
    title = spec.get("title") or title
    ctx.progress(0.95, "Starting")
    if spec["then"] == "dub":
        dub_id = uuid.uuid4().hex
        folder = dubbing.dub_dir(services, dub_id)
        source = folder / f"source{path.suffix}"
        path.rename(source)
        wanted = spec.get("speakers") or "auto"
        dubbing.start_dub(services, dub_id, source.name, title, spec["target_language"], spec.get("source_language"), wanted if wanted == "auto" else int(wanted))
        return {"dub_id": dub_id, "title": title}
    transcript_id = uuid.uuid4().hex
    job = services.jobs.submit("transcribe", f"Transcribing {title}", {"audio": path.name, "language": spec.get("language"), "model": None, "title": title, "transcript_id": transcript_id})
    return {"transcribe_job_id": job.id, "transcript_id": transcript_id, "title": title}
