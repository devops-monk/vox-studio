"""MCP server (Streamable HTTP transport, JSON responses) so AI agents can speak, transcribe and
polish audio on this computer.

    POST /mcp   one JSON-RPC message (or a batch) → JSON reply; notifications get 202

Authenticated like the rest of voxd (an API key as a Bearer token). Clients that only speak stdio
can use ``mcp_bridge.py``.
"""

from __future__ import annotations

import asyncio
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from .. import __version__, automation
from ..engines.base import EngineError
from ..pronounce import pronouncer

router = APIRouter()

PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
INSTRUCTIONS = (
    "VoxStudio runs voices and speech recognition locally. Use `speak` to turn text into audio "
    "(optionally saved to a file or played aloud), `list_voices` to choose a voice, `transcribe` for "
    "speech-to-text of a local audio/video file, `clean_audio` to denoise and level a recording, and "
    "`convert_voice` to re-voice a recording. Paths are on the user's computer."
)


def _schema(props: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}


PATH = {"type": "string", "description": "Absolute path to a local audio or video file"}
SAVE_TO = {"type": "string", "description": "Optional absolute path to also save the result to (.wav, .mp3, .m4a/.aac, .opus, .flac)"}

TOOLS: list[dict[str, Any]] = [
    {
        "name": "speak",
        "title": "Speak text",
        "description": "Generate speech from text with a local voice. Returns the take id, duration and file path.",
        "inputSchema": _schema({
            "text": {"type": "string", "description": "What to say (any length)"},
            "voice": {"type": "string", "description": "Voice id from list_voices, or an OpenAI-style name like 'nova'. Default: a natural English voice."},
            "speed": {"type": "number", "minimum": 0.5, "maximum": 2.0, "default": 1.0},
            "save_to": SAVE_TO,
            "play": {"type": "boolean", "default": False, "description": "Also play it through the computer's speakers"},
        }, ["text"]),
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False},
    },
    {
        "name": "list_voices",
        "title": "List voices",
        "description": "List available voices (id, name, language, engine). Filter by language prefix like 'en' or 'es'.",
        "inputSchema": _schema({"language": {"type": "string"}, "engine": {"type": "string", "enum": ["kokoro", "chatterbox", "system"]}}, []),
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "transcribe",
        "title": "Transcribe a file",
        "description": "Speech-to-text for a local audio or video file. Returns the text (with timestamps if asked).",
        "inputSchema": _schema({
            "path": PATH,
            "language": {"type": "string", "description": "ISO code like 'en'; omit to detect"},
            "timestamps": {"type": "boolean", "default": False},
        }, ["path"]),
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False},
    },
    {
        "name": "clean_audio",
        "title": "Clean up a recording",
        "description": "Reduce background noise, optionally tighten pauses, and normalize loudness. The original file is not changed.",
        "inputSchema": _schema({
            "path": PATH,
            "trim_pauses": {"type": "boolean", "default": False},
            "loudness": {"type": "number", "minimum": -30, "maximum": -10, "default": -16, "description": "Target LUFS"},
            "save_to": SAVE_TO,
        }, ["path"]),
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False},
    },
    {
        "name": "convert_voice",
        "title": "Change the voice of a recording",
        "description": "Keep the words and timing of a recording but speak it in another voice (a cloned 'cv_' voice or 'default'). Needs the Chatterbox engine.",
        "inputSchema": _schema({"path": PATH, "voice": {"type": "string"}, "save_to": SAVE_TO}, ["path", "voice"]),
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False},
    },
    {
        "name": "add_pronunciation",
        "title": "Teach a pronunciation",
        "description": "Make every voice say a word a certain way from now on, e.g. term 'Nguyen', say 'Win'.",
        "inputSchema": _schema({"term": {"type": "string"}, "say": {"type": "string"}}, ["term", "say"]),
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
]

EXT_FORMATS = {".wav": "wav", ".mp3": "mp3", ".m4a": "aac", ".aac": "aac", ".opus": "opus", ".ogg": "opus", ".flac": "flac"}


class ToolError(Exception):
    """Reported to the model as a tool result with isError, not as a protocol error."""


def _text(*lines: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": "\n".join(lines)}]}


async def _save_copy(services, take_id: str, save_to: str | None, title: str) -> str | None:
    if not save_to:
        return None
    dest = Path(save_to).expanduser()
    fmt = EXT_FORMATS.get(dest.suffix.lower())
    if fmt is None:
        raise ToolError(f"Unsupported file type {dest.suffix!r}; use one of {', '.join(EXT_FORMATS)}")
    if not dest.parent.is_dir():
        raise ToolError(f"Folder doesn't exist: {dest.parent}")
    await asyncio.to_thread(automation.encode, services, services.settings.takes_dir / f"{take_id}.wav", fmt, dest)
    services.store.record_export("take", take_id, title, dest.suffix.lstrip(".").lower(), str(dest), dest.stat().st_size)
    return str(dest)


def _play(path: Path) -> None:
    player = shutil.which("afplay") if sys.platform == "darwin" else shutil.which("paplay") or shutil.which("aplay")
    if player:
        subprocess.Popen([player, str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def _speak(services, args: dict) -> dict:
    take = await automation.speak(services, args["text"], args.get("voice"), None, float(args.get("speed", 1.0)))
    wav = services.settings.takes_dir / f"{take.id}.wav"
    saved = await _save_copy(services, take.id, args.get("save_to"), take.text[:60])
    if args.get("play"):
        _play(wav)
    return _text(
        f"Spoke {take.duration_s:.1f} s with voice {take.voice} ({take.engine}). Take id: {take.id}",
        f"Audio: {saved or wav}",
    )


async def _list_voices(services, args: dict) -> dict:
    lang = (args.get("language") or "").lower()
    rows = []
    preference = {"kokoro": 0, "chatterbox": 1}  # natural voices first
    for info in sorted(services.registry.info(), key=lambda i: preference.get(i.id, 9)):
        if not info.available or "tts" not in info.capabilities or (args.get("engine") and info.id != args["engine"]):
            continue
        for v in services.registry.get(info.id).voices():
            if not lang or v.language.lower().startswith(lang):
                rows.append(f"{v.id}\t{v.name}\t{v.language}\t{info.id}")
    return _text("id\tname\tlanguage\tengine", *rows) if rows else _text("No matching voices.")


async def _transcribe(services, args: dict) -> dict:
    upload = automation.stage_file(services, args["path"])
    t = await automation.transcribe(services, upload, Path(args["path"]).stem, args.get("language"))
    if args.get("timestamps"):
        lines = [f"[{s['start']:7.2f} → {s['end']:7.2f}] {s['text'].strip()}" for s in t.segments]
        return _text(f"Language: {t.language} · {t.duration_s:.1f} s · transcript id {t.id}", *lines)
    return _text(t.text or "(no speech found)")


async def _clean(services, args: dict) -> dict:
    upload = automation.stage_file(services, args["path"])
    spec = {"audio": upload, "title": f"Cleaned · {Path(args['path']).stem}", "denoise": True,
            "trim": bool(args.get("trim_pauses")), "normalize": float(args.get("loudness", -16))}
    r = await automation.run_job(services, "tools.clean", spec["title"], spec)
    saved = await _save_copy(services, r["take_id"], args.get("save_to"), spec["title"])
    return _text(
        f"Cleaned: {r['duration_in']:.1f} s → {r['duration_out']:.1f} s, average level {r['rms_in']:.1f} → {r['rms_out']:.1f} dBFS.",
        f"Audio: {saved or services.settings.takes_dir / (r['take_id'] + '.wav')}",
    )


async def _convert(services, args: dict) -> dict:
    voice = args["voice"]
    if voice != "default" and services.store.get_custom_voice(voice) is None:
        raise ToolError(f"Unknown voice {voice!r}; use 'default' or a cv_ voice from list_voices (engine chatterbox)")
    services.registry.get("chatterbox")
    upload = automation.stage_file(services, args["path"])
    title = f"Converted · {Path(args['path']).stem}"
    r = await automation.run_job(services, "tools.convert", title, {"audio": upload, "voice": voice, "title": title})
    saved = await _save_copy(services, r["take_id"], args.get("save_to"), title)
    return _text(f"Converted to {voice}.", f"Audio: {saved or services.settings.takes_dir / (r['take_id'] + '.wav')}")


async def _add_pronunciation(services, args: dict) -> dict:
    term, say = args["term"].strip(), args["say"].strip()
    if not term or not say:
        raise ToolError("term and say must not be empty")
    existing = next((p for p in services.store.list_pronunciations() if p["term"].lower() == term.lower()), None)
    if existing:
        services.store.update_pronunciation(existing["id"], say=say)
    else:
        services.store.add_pronunciation({"id": f"pr_{uuid.uuid4().hex[:12]}", "term": term, "say": say, "case_sensitive": False, "created_at": time.time()})
    pronouncer.invalidate()
    services.bus.publish("pronunciations.changed", {})
    return _text(f"From now on voices say “{term}” as “{say}”.")


HANDLERS: dict[str, Callable[[Any, dict], Awaitable[dict]]] = {
    "speak": _speak,
    "list_voices": _list_voices,
    "transcribe": _transcribe,
    "clean_audio": _clean,
    "convert_voice": _convert,
    "add_pronunciation": _add_pronunciation,
}


async def _handle(services, msg: Any) -> dict | None:
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
        return {"jsonrpc": "2.0", "id": msg.get("id") if isinstance(msg, dict) else None, "error": {"code": -32600, "message": "Invalid request"}}
    method, params, mid = msg["method"], msg.get("params") or {}, msg.get("id")
    if "id" not in msg:  # notification (e.g. notifications/initialized)
        return None

    def ok(result: dict) -> dict:
        return {"jsonrpc": "2.0", "id": mid, "result": result}

    if method == "initialize":
        asked = params.get("protocolVersion")
        return ok({
            "protocolVersion": asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0],
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "voxstudio", "title": "VoxStudio", "version": __version__},
            "instructions": INSTRUCTIONS,
        })
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": TOOLS})
    if method == "tools/call":
        name, args = params.get("name"), params.get("arguments") or {}
        handler = HANDLERS.get(name)
        if handler is None:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": f"Unknown tool: {name}"}}
        required = next(t for t in TOOLS if t["name"] == name)["inputSchema"]["required"]
        if missing := [k for k in required if k not in args]:
            return ok({**_text(f"Missing argument(s): {', '.join(missing)}"), "isError": True})
        try:
            return ok(await handler(services, args))
        except (ToolError, EngineError) as exc:
            return ok({**_text(str(exc)), "isError": True})
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"Method not found: {method}"}}


@router.post("/mcp", tags=["MCP"], summary="MCP endpoint (Streamable HTTP)")
async def mcp(request: Request) -> Response:
    """JSON-RPC 2.0 over HTTP for Model Context Protocol clients. See the MCP guide for setup."""
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}, status_code=400)
    services = request.app.state.services
    if isinstance(body, list):
        replies = [r for r in [await _handle(services, m) for m in body] if r is not None]
        return JSONResponse(replies) if replies else Response(status_code=202)
    reply = await _handle(services, body)
    return JSONResponse(reply) if reply is not None else Response(status_code=202)


@router.get("/mcp", include_in_schema=False)
async def mcp_stream() -> Response:
    return Response(status_code=405, headers={"Allow": "POST"})
