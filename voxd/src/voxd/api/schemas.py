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
    history_retention_days: int = Field(0, description="Delete unstarred takes older than this many days; 0 keeps everything")
    asr_model: str | None = Field(None, description="Preferred Whisper model for file transcription (default: most accurate installed)")
    compute_device_in_use: str | None = Field(None, description="What the running engine actually uses, if one is loaded")
    model_mirror: str = Field("", description="Base URL that serves `<model id>/<file>`; empty downloads from the original hosts")


class SettingsPatch(BaseModel):
    compute_device: str | None = Field(None, pattern="^(auto|cpu|mps|cuda)$")
    history_retention_days: int | None = Field(None, description="One of 0, 7, 30, 90")
    asr_model: str | None = Field(None, description="A Whisper model id, or \"\" to clear")
    model_mirror: str | None = Field(None, max_length=500, description="An http(s) base URL, or \"\" to download from the original hosts")


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


class TakeStatsOut(BaseModel):
    count: int
    starred: int
    bytes: int = Field(description="Disk space used by take audio")


class DeleteTakesIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=1000)


class DeletedOut(BaseModel):
    deleted: list[str]


class SegmentOut(BaseModel):
    start: float = Field(description="Seconds")
    end: float
    text: str


class TranscriptSummaryOut(BaseModel):
    id: str
    title: str
    source: str = Field(description="`file` or `live`")
    language: str
    duration_s: float
    model: str
    preview: str = Field(description="The first ~160 characters")
    has_audio: bool
    created_at: float


class TranscriptOut(TranscriptSummaryOut):
    text: str
    segments: list[SegmentOut]


class TranscriptPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=120)
    segments: list[SegmentOut] | None = Field(None, description="Corrected segments (text edits)")


class DubVoice(BaseModel):
    engine: str
    voice: str


class DubSegmentOut(BaseModel):
    id: str
    start: float
    end: float
    text: str = Field(description="What was said (source language)")
    translation: str = Field(description="What will be spoken")
    speaker: str
    fit: dict | None = Field(None, description="After rendering: `speed` applied, `overflow_s` past the slot, `duration_s`")


class DubSummaryOut(BaseModel):
    id: str
    title: str
    status: str = Field(description="preparing | ready | rendering | done | failed")
    has_video: bool
    duration_s: float
    source_lang: str
    target_lang: str
    created_at: float
    updated_at: float


class DubOut(DubSummaryOut):
    mix: str = Field(description="`replace` (dub only) or `duck` (original quietly underneath)")
    segments: list[DubSegmentOut]
    cast: dict[str, DubVoice | None] = Field(description="Voice for each speaker (null until one is chosen)")
    audio_url: str | None = None
    video_url: str | None = None
    source_url: str
    stale: bool = Field(False, description="Edited since the last render")
    error: str | None = None
    job_id: str | None = Field(None, description="The prepare/translate/render job in progress, if any")


class DubSegmentPatch(BaseModel):
    id: str
    translation: str | None = Field(None, max_length=2000)
    speaker: str | None = Field(None, pattern="^S[0-9]{1,2}$")


class DubPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=120)
    mix: str | None = Field(None, pattern="^(replace|duck)$")
    cast: dict[str, DubVoice] | None = None
    segments: list[DubSegmentPatch] | None = None


class DubTranslateIn(BaseModel):
    target_language: str | None = Field(None, description="Change the target language and translate again")


class DubLanguageOut(BaseModel):
    code: str
    name: str
    has_voice: bool = Field(description="A voice is installed that can speak this language")


class DubSaveIn(BaseModel):
    path: str
    what: str = Field(pattern="^(video|audio|srt|vtt)$")
    overwrite: bool = False


class PreviewOut(BaseModel):
    audio_url: str
    duration_s: float


class ChapterOut(BaseModel):
    id: str
    title: str
    text: str
    words: int
    status: str = Field(description="`not_rendered`, `rendered` or `stale` (edited since rendering)")
    duration_s: float | None = None
    audio_url: str | None = None


class BookSummaryOut(BaseModel):
    id: str
    title: str
    author: str
    kind: str = Field(description="`audiobook` (one narrator) or `story` (narrator plus character voices)")
    chapters: int
    rendered: int
    words: int
    updated_at: float


class BookOut(BaseModel):
    id: str
    title: str
    author: str
    kind: str
    language: str
    speed: float
    chapters: list[ChapterOut]
    cast: dict = Field(description="`{narrator: {engine, voice}, characters: {Name: {engine, voice} | null}}`")
    characters: list[dict] = Field(description="Speaking characters found in the text: `{name, lines}`")
    exports: dict[str, str] = Field(description="Finished exports: format → download URL")
    job_id: str | None = None
    created_at: float
    updated_at: float


class ChapterPatch(BaseModel):
    id: str
    title: str | None = Field(None, max_length=120)
    text: str | None = Field(None, max_length=500_000)


class BookPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    author: str | None = Field(None, max_length=200)
    kind: str | None = Field(None, pattern="^(audiobook|story)$")
    speed: float | None = Field(None, ge=0.7, le=1.4)
    cast: dict | None = Field(None, description="Partial cast update: narrator and/or characters")
    chapters: list[ChapterPatch] | None = None


class BookRenderIn(BaseModel):
    chapters: list[str] | None = Field(None, description="Chapter ids; default all")


class BookExportIn(BaseModel):
    format: str = Field(pattern="^(m4b|mp3)$")


class TimingsOut(BaseModel):
    duration_s: float
    timings: list[dict] = Field(description="`{start, end, from, to, speaker}`: seconds, character offsets into the chapter text, and the character speaking (null for narration)")


class BatchSpeechItem(BaseModel):
    name: str = Field(min_length=1, max_length=120, description="Used for the output file name")
    text: str = Field(min_length=1, max_length=200_000)


class BatchIn(BaseModel):
    kind: str = Field(pattern="^(speech|transcribe)$")
    title: str | None = Field(None, max_length=120)
    items: list[BatchSpeechItem] | None = Field(None, max_length=500, description="For `speech`")
    paths: list[str] | None = Field(None, max_length=500, description="For `transcribe`: absolute paths of audio/video files on this computer")
    engine: str | None = None
    voice: str | None = None
    speed: float = Field(1.0, ge=0.5, le=2.0)
    language: str | None = None
    model: str | None = None
    formats: list[str] = Field(default_factory=lambda: ["txt"], description="Transcript files to write: txt, srt, vtt, json")
    output_dir: str | None = Field(None, description="Absolute folder to write results into (optional)")


class BatchItemOut(BaseModel):
    job_id: str
    name: str
    status: str
    progress: float
    message: str | None = None
    error: str | None = None
    output: str | None = Field(None, description="Where the result was written, if an output folder was set")


class BatchOut(BaseModel):
    id: str
    kind: str
    title: str
    output_dir: str | None
    created_at: float
    total: int
    done: int
    failed: int
    items: list[BatchItemOut]


class WatchFolderIn(BaseModel):
    path: str = Field(description="Absolute path of an existing folder")
    action: str = Field(pattern="^(speak|transcribe)$", description="`speak` new .txt/.md files, or `transcribe` new audio/video files")
    engine: str | None = None
    voice: str | None = None
    speed: float = Field(1.0, ge=0.5, le=2.0)
    language: str | None = None
    model: str | None = None
    formats: list[str] = Field(default_factory=lambda: ["txt", "srt"])
    enabled: bool = True


class WatchFolderPatch(BaseModel):
    enabled: bool | None = None


class WatchFolderOut(BaseModel):
    id: str
    path: str
    action: str
    options: dict
    enabled: bool
    exists: bool
    output_dir: str
    processed: int
    recent: list[dict] = Field(description="Latest files: `{path, state (queued|done|error), output, error, at}`")
    created_at: float


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color: str = Field("#0a84ff", pattern="^#[0-9a-fA-F]{6}$")
    description: str = Field("", max_length=500)


class ProjectPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    color: str | None = Field(None, pattern="^#[0-9a-fA-F]{6}$")
    description: str | None = Field(None, max_length=500)


class ProjectSummaryOut(BaseModel):
    id: str
    name: str
    color: str
    description: str
    item_count: int
    created_at: float
    updated_at: float


class ProjectItemIn(BaseModel):
    kind: str = Field(pattern="^(take|transcript|dub|book)$")
    id: str


class ProjectItemOut(BaseModel):
    kind: str
    id: str
    title: str
    subtitle: str
    created_at: float | None
    added_at: float
    missing: bool = False


class ExportRecordOut(BaseModel):
    id: str
    kind: str
    item_id: str
    title: str
    format: str
    path: str
    bytes: int
    at: float
    exists: bool = Field(description="Whether the file is still at that path")


class ProjectOut(ProjectSummaryOut):
    items: list[ProjectItemOut]
    exports: list[ExportRecordOut]


class PronunciationIn(BaseModel):
    term: str = Field(min_length=1, max_length=100, description="Word or phrase as written, e.g. `SQL` or `Nguyen`")
    say: str = Field(min_length=1, max_length=200, description="How to say it, spelled the way it sounds, e.g. `sequel` or `Win`")
    case_sensitive: bool = Field(False, description="Match `term` only with this exact capitalization")


class PronunciationPatch(BaseModel):
    term: str | None = Field(None, min_length=1, max_length=100)
    say: str | None = Field(None, min_length=1, max_length=200)
    case_sensitive: bool | None = None


class PronunciationOut(BaseModel):
    id: str
    term: str
    say: str
    case_sensitive: bool
    created_at: float


class PronunciationPreviewIn(BaseModel):
    text: str = Field(max_length=10_000)


class PronunciationPreviewOut(BaseModel):
    text: str = Field(description="The text with every pronunciation applied")


class ApiKeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=60, description="What the key is for, e.g. “n8n” or “my script”")


class ApiKeyOut(BaseModel):
    id: str
    name: str
    hint: str = Field(description="Start and end of the key, to tell keys apart")
    created_at: float
    last_used_at: float | None


class ApiKeyCreated(ApiKeyOut):
    key: str = Field(description="The secret key. Shown once.")


class ConnectionOut(BaseModel):
    url: str
    api_base: str = Field(description="Base URL for OpenAI SDKs")
    mcp_url: str
    openapi_url: str
    docs_url: str
    bridge_path: str = Field(description="stdio MCP bridge script, for clients that launch a command")
    auth_required: bool


class StoragePartOut(BaseModel):
    id: str
    label: str
    path: str
    bytes: int


class StorageOut(BaseModel):
    data_dir: str
    total: int
    parts: list[StoragePartOut]


class CleanupOut(BaseModel):
    freed_bytes: int
    removed: int = Field(description="Files and folders removed")


class UnloadOut(BaseModel):
    unloaded: list[str] = Field(description="Engines that had a model in memory")
