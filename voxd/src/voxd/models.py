"""Downloadable models: the catalog, what's installed, and a resumable, verified downloader."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import platform
import shutil
import sys
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .engines.base import EngineError

if TYPE_CHECKING:
    from .jobs import JobContext

log = logging.getLogger("voxd.models")

CHUNK = 1 << 20
INSTALLED_MARKER = "installed.json"


@dataclass(frozen=True)
class ModelFile:
    name: str
    url: str
    size: int
    sha256: str


@dataclass(frozen=True)
class ModelSpec:
    id: str
    engine: str
    name: str
    tagline: str
    description: str
    license: str
    license_url: str
    homepage: str
    files: tuple[ModelFile, ...]
    languages: tuple[str, ...]
    min_ram_gb: float
    voice_count: int
    featured: bool = False
    runtime: str | None = None  # runtime pack id this model's engine needs
    kind: str = "tts"  # tts | clone

    @property
    def size(self) -> int:
        return sum(f.size for f in self.files)


_KOKORO_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
# Pinned to a commit so the files (and their checksums) can never change underneath us.
_CHATTERBOX = "https://huggingface.co/ResembleAI/chatterbox/resolve/5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18"

CATALOG: tuple[ModelSpec, ...] = (
    ModelSpec(
        id="kokoro-v1",
        engine="kokoro",
        name="Kokoro",
        tagline="Natural, expressive voices that run fast on any computer",
        description=(
            "An 82-million-parameter text-to-speech model with 54 studio-quality voices across "
            "American and British English, Spanish, French, Hindi, Italian, Japanese, Portuguese and Mandarin. "
            "Runs on the CPU — no graphics card needed."
        ),
        license="Apache-2.0",
        license_url="https://huggingface.co/hexgrad/Kokoro-82M",
        homepage="https://huggingface.co/hexgrad/Kokoro-82M",
        files=(
            ModelFile(
                "kokoro-v1.0.onnx",
                f"{_KOKORO_RELEASE}/kokoro-v1.0.onnx",
                325_532_387,
                "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
            ),
            ModelFile(
                "voices-v1.0.bin",
                f"{_KOKORO_RELEASE}/voices-v1.0.bin",
                28_214_398,
                "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
            ),
        ),
        languages=("en-US", "en-GB", "es", "fr-FR", "hi", "it", "ja", "pt-BR", "zh"),
        min_ram_gb=2,
        voice_count=54,
        featured=True,
    ),
    ModelSpec(
        id="chatterbox-v1",
        engine="chatterbox",
        name="Chatterbox",
        tagline="Clone any voice from a few seconds of audio",
        description=(
            "Resemble AI's open voice-cloning model. Record or upload a short clip and it speaks in that voice, "
            "with a dial for emotional intensity. English. Every clip it makes carries an inaudible watermark "
            "identifying it as AI-generated. Runs on Apple GPUs, NVIDIA GPUs or the CPU."
        ),
        license="MIT",
        license_url="https://huggingface.co/ResembleAI/chatterbox",
        homepage="https://huggingface.co/ResembleAI/chatterbox",
        files=tuple(
            ModelFile(name, f"{_CHATTERBOX}/{name}", size, sha)
            for name, size, sha in (
                ("ve.safetensors", 5_695_784, "f0921cab452fa278bc25cd23ffd59d36f816d7dc5181dd1bef9751a7fb61f63c"),
                ("t3_cfg.safetensors", 2_129_653_744, "914cb1696f47527fe8852ca8f1fe1fa63cb34f76f9c715e84e067b744dd0da81"),
                ("s3gen.safetensors", 1_056_484_620, "2b78103c654207393955e4900aac14a12de8ef25f4b09424f1ef91941f161d4e"),
                ("tokenizer.json", 25_470, "d71e3a44eabb1784df9a68e9f95b251ecbf1a7af6a9f50835856b2ca9d8c14a5"),
                ("conds.pt", 107_374, "6552d70568833628ba019c6b03459e77fe71ca197d5c560cef9411bee9d87f4e"),
            )
        ),
        languages=("en-US",),
        min_ram_gb=8,
        voice_count=1,
        runtime="chatterbox",
        kind="clone",
    ),
)


@dataclass
class ModelStore:
    root: Path
    catalog: tuple[ModelSpec, ...] = CATALOG
    mirror: str = ""
    _by_id: dict[str, ModelSpec] = field(init=False)

    def __post_init__(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self._by_id = {m.id: m for m in self.catalog}

    def get(self, model_id: str) -> ModelSpec:
        try:
            return self._by_id[model_id]
        except KeyError:
            raise EngineError(f"Unknown model: {model_id}") from None

    def for_engine(self, engine: str) -> ModelSpec | None:
        return next((m for m in self.catalog if m.engine == engine), None)

    def dir(self, spec: ModelSpec) -> Path:
        return self.root / spec.id

    def path(self, spec: ModelSpec, filename: str) -> Path:
        return self.dir(spec) / filename

    def installed(self, spec: ModelSpec) -> bool:
        return (self.dir(spec) / INSTALLED_MARKER).exists()

    def delete(self, spec: ModelSpec) -> None:
        shutil.rmtree(self.dir(spec), ignore_errors=True)

    def download(self, ctx: JobContext, spec: ModelSpec, span: tuple[float, float] = (0.0, 1.0)) -> None:
        """Fetch every file, resuming partial downloads, and verify each checksum."""
        target = self.dir(spec)
        target.mkdir(parents=True, exist_ok=True)
        (target / INSTALLED_MARKER).unlink(missing_ok=True)
        total = spec.size
        done_before = 0
        for f in spec.files:
            final = target / f.name
            if final.exists() and final.stat().st_size == f.size:
                done_before += f.size
                continue
            url = f"{self.mirror.rstrip('/')}/{spec.id}/{f.name}" if self.mirror else f.url
            self._fetch(ctx, f, url, target / f"{f.name}.part", final, done_before, total, span)
            done_before += f.size
        (target / INSTALLED_MARKER).write_text(json.dumps({"id": spec.id, "files": [f.name for f in spec.files]}))

    def _fetch(
        self, ctx: JobContext, f: ModelFile, url: str, part: Path, final: Path, offset: int, total: int, span: tuple[float, float]
    ) -> None:
        digest = hashlib.sha256()
        have = part.stat().st_size if part.exists() else 0
        if have > f.size:
            part.unlink()
            have = 0
        if have:  # resume: hash what we already have
            with part.open("rb") as existing:
                while block := existing.read(CHUNK):
                    digest.update(block)

        request = urllib.request.Request(url, headers={"User-Agent": "voxd", **({"Range": f"bytes={have}-"} if have else {})})
        with urllib.request.urlopen(request, timeout=30) as resp:
            if have and resp.status != 206:  # server ignored the range; start over
                have = 0
                digest = hashlib.sha256()
            with part.open("ab" if have else "wb") as out:
                while block := resp.read(CHUNK):
                    ctx.check()
                    out.write(block)
                    digest.update(block)
                    have += len(block)
                    lo, hi = span
                    ctx.progress(lo + (hi - lo) * (offset + have) / total, f"Downloading {_mb(offset + have)} of {_mb(total)}")

        if have != f.size or digest.hexdigest() != f.sha256:
            part.unlink(missing_ok=True)
            raise EngineError(f"{f.name} failed verification — the download was corrupted. Please try again.")
        part.rename(final)


def _mb(n: int) -> str:
    return f"{n / 1e9:.1f} GB" if n >= 1e9 else f"{n / 1_000_000:.0f} MB"


# --- System facts used to judge whether a model fits ---------------------------------


def system_info(data_dir: Path) -> dict[str, Any]:
    try:
        ram = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (ValueError, OSError, AttributeError):
        ram = 0
    machine = platform.machine()
    chip = _mac_chip() if sys.platform == "darwin" else platform.processor() or machine
    accelerators = ["cpu"]
    if sys.platform == "darwin" and machine == "arm64":
        accelerators.append("mps")
    if shutil.which("nvidia-smi"):
        accelerators.append("cuda")
    return {
        "accelerators": accelerators,
        "os": {"darwin": "macOS", "win32": "Windows"}.get(sys.platform, "Linux"),
        "os_version": platform.mac_ver()[0] if sys.platform == "darwin" else platform.release(),
        "arch": machine,
        "chip": chip,
        "cpu_count": os.cpu_count() or 1,
        "ram_bytes": ram,
        "disk_free_bytes": shutil.disk_usage(data_dir).free,
    }


def _mac_chip() -> str:
    try:
        import subprocess

        return subprocess.run(
            ["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True, timeout=2
        ).stdout.strip()
    except Exception:
        return platform.machine()


def fit(spec: ModelSpec, info: dict[str, Any], extra_bytes: int = 0) -> tuple[str, str]:
    """(level, reason) where level is `great`, `ok` or `no`."""
    ram_gb = info["ram_bytes"] / 1024**3
    need = int((spec.size + extra_bytes) * 1.2)
    if info["disk_free_bytes"] < need:
        return "no", f"Needs {_mb(need)} of free disk space"
    if ram_gb and ram_gb < spec.min_ram_gb:
        return "no", f"Needs at least {spec.min_ram_gb:g} GB of memory"
    if ram_gb and ram_gb < spec.min_ram_gb * 2:
        return "ok", "Will run, but may be slow alongside other apps"
    if spec.runtime and "mps" not in info.get("accelerators", []) and "cuda" not in info.get("accelerators", []):
        return "ok", "Runs on the CPU here — expect a few seconds per sentence"
    return "great", "Runs well on this computer"
