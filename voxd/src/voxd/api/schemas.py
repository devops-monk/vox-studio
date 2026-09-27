from __future__ import annotations

from pydantic import BaseModel, Field


class StatusOut(BaseModel):
    name: str = "voxd"
    version: str
    phase: str = Field(description="booting | loading_engines | ready | error")
    detail: str | None = None
    uptime_s: float


class EngineOut(BaseModel):
    id: str
    name: str
    capabilities: list[str]
    license: str
    available: bool
    unavailable_reason: str | None = None


class VoiceOut(BaseModel):
    id: str
    name: str
    language: str = Field(description="BCP-47 tag, e.g. en-US")
    sample: str | None = Field(None, description="A sample sentence in the voice's language")
    gender: str | None = Field(None, description="`female`, `male`, or null when unknown")


class SpeechIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000, examples=["Hello from VoxStudio."])
    voice: str = Field(description="Voice id from GET /v1/voices", examples=["Samantha"])
    engine: str | None = Field(None, description="Engine id; defaults to the first available TTS engine")
    speed: float = Field(1.0, ge=0.5, le=2.0, description="Playback rate multiplier")
    emotion: float | None = Field(
        None, ge=0.0, le=1.0, description="Emotional intensity, 0 (flat) – 1 (dramatic); 0.5 is natural. Used by engines with the `emotion` capability."
    )


class TakeOut(BaseModel):
    id: str
    engine: str
    voice: str
    text: str
    duration_s: float
    starred: bool
    created_at: float = Field(description="Unix timestamp (seconds)")
    audio_url: str = Field(description="Relative URL of the WAV file")


class ErrorOut(BaseModel):
    error: str = Field(description="Stable machine-readable code")
    message: str


class SpeechJobIn(SpeechIn):
    text: str = Field(min_length=1, max_length=200_000, description="Any length; rendered in chunks")
    title: str | None = Field(None, max_length=120, description="Shown in the Activity list; defaults to the text's start")


class JobOut(BaseModel):
    id: str
    kind: str = Field(description="Job type, e.g. `speech`")
    title: str
    status: str = Field(description="queued | running | succeeded | failed | cancelled")
    progress: float = Field(description="0.0 – 1.0")
    message: str | None = Field(None, description="Human-readable current step")
    result: dict | None = Field(None, description="Set when status is `succeeded`; shape depends on `kind`")
    error: str | None = Field(None, description="Set when status is `failed`")
    created_at: float
    updated_at: float


class ClearedOut(BaseModel):
    deleted: int


class FitOut(BaseModel):
    level: str = Field(description="great | ok | no")
    reason: str


class ModelOut(BaseModel):
    id: str
    engine: str = Field(description="Engine this model powers")
    name: str
    tagline: str
    description: str
    license: str
    license_url: str
    homepage: str
    size_bytes: int
    languages: list[str]
    voice_count: int
    featured: bool
    kind: str = Field(description="`tts` (ready-made voices) or `clone` (speaks in voices you provide)")
    runtime_bytes: int = Field(0, description="Approximate size of the engine runtime installed alongside the files")
    status: str = Field(description="not_installed | downloading | installed")
    job_id: str | None = Field(None, description="The active download job, while `downloading`")
    fit: FitOut


class SystemOut(BaseModel):
    accelerators: list[str] = Field(description="Compute devices available: `cpu`, `mps` (Apple GPU), `cuda` (NVIDIA)")
    os: str
    os_version: str
    arch: str
    chip: str
    cpu_count: int
    ram_bytes: int
    disk_free_bytes: int


class SettingsOut(BaseModel):
    compute_device: str = Field(description="auto | cpu | mps | cuda — where PyTorch engines run")
    compute_device_in_use: str | None = Field(None, description="What the running engine actually uses, if one is loaded")


class SettingsPatch(BaseModel):
    compute_device: str | None = Field(None, pattern="^(auto|cpu|mps|cuda)$")


class CustomVoiceOut(BaseModel):
    id: str
    name: str
    language: str
    duration_s: float = Field(description="Length of the reference recording")
    consent: str = Field(description="The consent statement recorded when the voice was created")
    consent_by: str = Field("", description="Who gave consent (the speaker, or who granted permission)")
    created_at: float
    audio_url: str


class CustomVoicePatch(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class StarIn(BaseModel):
    starred: bool


class ExportIn(BaseModel):
    path: str = Field(description="Absolute destination path ending in .wav")
    overwrite: bool = False


class LibraryVoiceOut(BaseModel):
    engine: str = Field(description="Engine that speaks this voice; custom voices use the cloning engine")
    id: str
    name: str
    language: str
    gender: str | None = None
    custom: bool = Field(description="A voice you created from a recording")
    designed: bool = Field(False, description="A voice you designed (a saved blend)")
    available: bool = Field(description="Whether its engine is installed and usable now")
    favorite: bool
    tags: list[str]
    duration_s: float | None = Field(None, description="Custom voices: length of the reference recording")
    created_at: float | None = None


class VoiceMetaIn(BaseModel):
    engine: str
    voice: str
    favorite: bool | None = None
    tags: list[str] | None = Field(None, max_length=12)


class ExportPathIn(BaseModel):
    path: str = Field(description="Absolute destination path")
    overwrite: bool = False


class DesignStatusOut(BaseModel):
    ready: bool = Field(description="Voices have been analyzed and design is available")
    analyzed_voices: int
    job_id: str | None = Field(None, description="The running analysis job, if any")


class DesignIn(BaseModel):
    description: str = Field(max_length=500, examples=["A warm, deep British narrator, calm and measured"])
    depth: float | None = Field(None, ge=0, le=1, description="Override: 0 light/high – 1 deep/low")
    warmth: float | None = Field(None, ge=0, le=1, description="Override: 0 crisp/bright – 1 warm/soft")
    energy: float | None = Field(None, ge=0, le=1, description="Override: 0 calm/steady – 1 lively/expressive")
    gender: str | None = Field(None, pattern="^(female|male)$", description="Override the gender read from the description")


class DesignTargetOut(BaseModel):
    gender: str | None
    language: str | None
    depth: float | None
    warmth: float | None
    energy: float | None
    speed: float
    matched: list[str] = Field(description="Words in the description that were understood")


class CandidateOut(BaseModel):
    recipe: str = Field(description="Blend voice id, usable as `voice` with engine `kokoro`")
    voices: list[str] = Field(description="The Kokoro voices being blended")
    score: float = Field(description="0–1, how closely the blend matches the target")
    traits: list[float] = Field(description="[depth, warmth, energy] of the blend, 0–1")


class DesignOut(BaseModel):
    target: DesignTargetOut
    candidates: list[CandidateOut]


class DesignedVoiceIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    recipe: str = Field(description="A candidate's `recipe`")
    description: str = Field("", max_length=500)
    speed: float = Field(1.0, ge=0.7, le=1.4, description="Built-in pace for this voice")


class DesignedVoiceOut(BaseModel):
    id: str
    name: str
    recipe: str
    description: str
    language: str
    gender: str | None
    speed: float
    created_at: float
