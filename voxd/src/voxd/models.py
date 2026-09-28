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
    kind: str = "tts"  # tts | clone | asr | translate
    rank: int = 0  # among models for the same engine, higher = more capable
    hidden: bool = False  # installed on demand by features (e.g. translation packs), not listed in Models
    unpack: bool = False  # extract downloaded zip archives in place

    @property
    def size(self) -> int:
        return sum(f.size for f in self.files)


_KOKORO_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
_WHISPER_LANGS = ("multilingual",)


def _hf(repo: str, commit: str, files: tuple[tuple[str, int, str], ...]) -> tuple[ModelFile, ...]:
    return tuple(ModelFile(n, f"https://huggingface.co/{repo}/resolve/{commit}/{n}", size, sha) for n, size, sha in files)


_WHISPER_TOKENIZER = ("tokenizer.json", 2_203_239, "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab")
_WHISPER_VOCAB = ("vocabulary.txt", 459_861, "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913")

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
    ModelSpec(
        id="whisper-base",
        engine="whisper",
        name="Whisper Base",
        tagline="Quick transcription and dictation",
        description="OpenAI's Whisper speech recognition (CTranslate2 build). Fast enough for live dictation on any computer; ~99 languages.",
        license="MIT",
        license_url="https://huggingface.co/Systran/faster-whisper-base",
        homepage="https://github.com/SYSTRAN/faster-whisper",
        files=_hf(
            "Systran/faster-whisper-base",
            "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66",
            (
                ("config.json", 2_309, "56a6d8110d311f19c8f0471e562832c7527f146b567275bfca59fcf7c184da9a"),
                ("model.bin", 145_217_532, "d01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9"),
                _WHISPER_TOKENIZER,
                _WHISPER_VOCAB,
            ),
        ),
        languages=_WHISPER_LANGS,
        min_ram_gb=2,
        voice_count=0,
        runtime="whisper",
        kind="asr",
        rank=1,
        featured=True,
    ),
    ModelSpec(
        id="whisper-small",
        engine="whisper",
        name="Whisper Small",
        tagline="More accurate transcription, still quick",
        description="A larger Whisper model: noticeably better with accents, names and noisy audio. Good default for transcribing files.",
        license="MIT",
        license_url="https://huggingface.co/Systran/faster-whisper-small",
        homepage="https://github.com/SYSTRAN/faster-whisper",
        files=_hf(
            "Systran/faster-whisper-small",
            "536b0662742c02347bc0e980a01041f333bce120",
            (
                ("config.json", 2_370, "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828"),
                ("model.bin", 483_546_902, "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671"),
                _WHISPER_TOKENIZER,
                _WHISPER_VOCAB,
            ),
        ),
        languages=_WHISPER_LANGS,
        min_ram_gb=4,
        voice_count=0,
        runtime="whisper",
        kind="asr",
        rank=2,
    ),
    ModelSpec(
        id="whisper-large-v3-turbo",
        engine="whisper",
        name="Whisper Large v3 Turbo",
        tagline="Best accuracy for important recordings",
        description="Whisper's most accurate model in a speed-optimized form. Best for interviews, lectures and hard audio; slower on CPU-only machines.",
        license="MIT",
        license_url="https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo",
        homepage="https://github.com/SYSTRAN/faster-whisper",
        files=_hf(
            "dropbox-dash/faster-whisper-large-v3-turbo",
            "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf",
            (
                ("config.json", 2_263, "b0253ea6c0d3bea6b1e19e91a02acfd3b53f4467362efcb5a3e6b16c9b3a9b7e"),
                ("model.bin", 1_617_884_929, "e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da"),
                ("preprocessor_config.json", 340, "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"),
                ("tokenizer.json", 2_710_337, "297b13372ac43916285644fb9687add3cc62ee2a1adb60da3dc25cc94c1871fd"),
                ("vocabulary.json", 1_068_114, "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1"),
            ),
        ),
        languages=_WHISPER_LANGS,
        min_ram_gb=6,
        voice_count=0,
        runtime="whisper",
        kind="asr",
        rank=3,
    ),
)


# Argos Translate packages (MIT/CC0; trained on OPUS data). Installed on demand by dubbing.
_ARGOS: tuple[tuple[str, str, str, int, str], ...] = (
    ("zh", "en", "https://argos-net.com/v1/translate-zh_en-1_9.argosmodel", 74481402, "62e7af5a3a48b530e47b7b3e5c78c2de79073ecd815750d2bf3ab35b4a67da2d"),
    ("en", "zh", "https://argos-net.com/v1/translate-en_zh-1_9.argosmodel", 70743021, "433e7c4f034d87fbe2353161e05f18646d7999452f801a4e1f0378522b9850ab"),
    ("en", "fr", "https://argos-net.com/v1/translate-en_fr-1_9.argosmodel", 65472327, "3a65ed83364f4e7b06e30f9dd823db1934899ed3ce839e63f46dc7b09dc797b4"),
    ("en", "de", "https://argos-net.com/v1/translate-en_de-1_3.argosmodel", 150508297, "6cd847f0c06c9c66013e6b0932e07fd54a6d90894659c02bf6c5247b72fb25b1"),
    ("en", "hi", "https://argos-net.com/v1/translate-en_hi-1_1.argosmodel", 106752178, "60470a003a9c7339db8c060ed8eafc7cf999ba90dfa5dceebd8d0a4f75f1d3f0"),
    ("en", "it", "https://argos-net.com/v1/translate-en_it-1_0.argosmodel", 87660780, "dde2180001a47904ecbbd688a41e35db8a040e4fd5b52e4f29b4bb499516ab32"),
    ("en", "ja", "https://argos-net.com/v1/translate-en_ja-1_1.argosmodel", 120470284, "16300cc4eaa85320520cabcf433b63d01be40ef6966251de72043a083408f716"),
    ("en", "pt", "https://argos-net.com/v1/translate-en_pt-1_9.argosmodel", 66179184, "0c5350a2fa5b923de1346edc0d42e08e38bab2e33cede3a0b9a48eb4281ad8a9"),
    ("en", "es", "https://argos-net.com/v1/translate-en_es-1_0.argosmodel", 87503191, "d698d0ef87ad70d5d184b7fa6965905bf4368f09a2bb9ffb165a79bac96af0c4"),
    ("fr", "en", "https://argos-net.com/v1/translate-fr_en-1_9.argosmodel", 66585033, "3b3052fee6bb1e8e8e632a26a723eb2a2c7710dfe73ba61ffd9b83e85d4f14c1"),
    ("de", "en", "https://argos-net.com/v1/translate-de_en-1_3.argosmodel", 150512831, "becc2b0011f8249fcb89be9ecb75ba0d876b1fab93c28ee6ff0420936897d637"),
    ("hi", "en", "https://argos-net.com/v1/translate-hi_en-1_1.argosmodel", 102381771, "f99eadf297073c0f5a320df5d634ebb73e9ab0b819404edf7bd0a0daf6b1ce43"),
    ("it", "en", "https://argos-net.com/v1/translate-it_en-1_0.argosmodel", 87190224, "d2dd23b8b702f612b8127f07c7a0391f5f2a8b93344e6ddc9dd93c81824e85cb"),
    ("ja", "en", "https://argos-net.com/v1/translate-ja_en-1_1.argosmodel", 117155716, "623e3477959a815eb0a5ef53e09079ae8f1f9d3bbcd230473baf28c03fb83335"),
    ("pt", "en", "https://argos-net.com/v1/translate-pt_en-1_9.argosmodel", 69447231, "ae76df6f650895c16f2b582065014fab496755ca846ecb19fae81d51f332a38e"),
    # 1.0 rather than 1.9: the 1.9 package switched to subword-nmt BPE, which we don't ship.
    ("es", "en", "https://argos-net.com/v1/translate-es_en-1_0.argosmodel", 87381097, "1b963aa0e0cb6e5ce874f0aa1a1949a19bc4d762e833532239a8834340f6b378"),
)
TRANSLATION_LANGUAGES = {"en": "English", "es": "Spanish", "fr": "French", "de": "German", "it": "Italian", "pt": "Portuguese", "hi": "Hindi", "ja": "Japanese", "zh": "Chinese"}


def translation_model_id(src: str, dst: str) -> str:
    return f"translate-{src}-{dst}"


TRANSLATION_MODELS: tuple[ModelSpec, ...] = tuple(
    ModelSpec(
        id=translation_model_id(src, dst),
        engine="translate",
        name=f"{TRANSLATION_LANGUAGES[src]} → {TRANSLATION_LANGUAGES[dst]}",
        tagline="Offline translation",
        description="Argos Translate model, run with CTranslate2.",
        license="MIT / CC0",
        license_url="https://github.com/argosopentech/argos-translate",
        homepage="https://github.com/argosopentech/argos-translate",
        files=(ModelFile(url.rsplit("/", 1)[1], url, size, sha),),
        languages=(src, dst),
        min_ram_gb=1,
        voice_count=0,
        runtime="whisper",
        kind="translate",
        hidden=True,
        unpack=True,
    )
    for src, dst, url, size, sha in _ARGOS
)


@dataclass
class ModelStore:
    root: Path
    catalog: tuple[ModelSpec, ...] = CATALOG + TRANSLATION_MODELS
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

    def all_for_engine(self, engine: str) -> list[ModelSpec]:
        return sorted((m for m in self.catalog if m.engine == engine), key=lambda m: m.rank)

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
        if spec.unpack:
            import zipfile

            for f in spec.files:
                with zipfile.ZipFile(target / f.name) as z:
                    root = target.resolve()
                    for member in z.namelist():  # refuse paths that escape the model folder
                        if not (target / member).resolve().is_relative_to(root):
                            raise EngineError(f"{f.name} contains an unsafe path")
                    z.extractall(target)
                (target / f.name).unlink()
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
