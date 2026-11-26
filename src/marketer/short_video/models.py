"""Short video: settings, batches, items, clips (docs/short-video.md).

The settings are what a person chooses in the create flow. Every field has a
default so the one-button path ("Make it") is a valid request; the Fine-tune
sheet edits the rest. Bounds live here so the API, the agent tool and the
pipeline agree on them.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

Aspect = Literal["9:16", "16:9", "1:1"]
FootageSource = Literal["pexels", "pixabay", "uploads"]
Transition = Literal["none", "fade", "fade_in", "fade_out", "shuffle"]
Fit = Literal["crop", "letterbox"]
Order = Literal["random", "sequential"]
CaptionMode = Literal["sentence", "word", "highlight"]
SubtitleDelivery = Literal["burned", "sidecar", "both"]
MusicMode = Literal["none", "library", "generated"]
VoiceProvider = Literal["openai", "elevenlabs"]

OPENAI_VOICES: tuple[str, ...] = ("alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer")

STAGES: tuple[str, ...] = ("script", "voice", "timing", "footage", "edit", "subtitles", "music", "render")

MAX_VARIANTS = 10
# Batches above either line wait for a person (rails: content.short_video.batch.approve).
APPROVAL_VARIANTS = 3
APPROVAL_ESTIMATE_MICROS = 5_000_000

_HEX = r"^[0-9a-fA-F]{6}$"


class LookSettings(BaseModel):
    model_config = {"extra": "forbid"}

    aspect: Aspect = "9:16"
    duration_sec: int = Field(default=30, ge=10, le=90)
    voice_provider: VoiceProvider = "openai"
    voice: str = Field(default="onyx", pattern=r"^[A-Za-z0-9_\-]{1,64}$")
    language: str = Field(default="en", pattern=r"^[a-z]{2}(-[A-Z]{2})?$")
    tone: str = Field(default="", max_length=200)


class FootageSettings(BaseModel):
    model_config = {"extra": "forbid"}

    sources: list[FootageSource] = Field(default_factory=lambda: ["pexels", "pixabay"], min_length=1, max_length=3)
    upload_ids: list[UUID] = Field(default_factory=list, max_length=40)
    clip_duration_sec: float = Field(default=4.0, ge=2.0, le=10.0)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    transition: Transition = "fade"
    fit: Fit = "crop"
    order: Order = "random"

    @model_validator(mode="after")
    def _uploads_need_ids(self) -> FootageSettings:
        if self.sources == ["uploads"] and not self.upload_ids:
            raise ValueError("choose at least one upload, or add a stock source")
        return self


class SubtitleSettings(BaseModel):
    model_config = {"extra": "forbid"}

    enabled: bool = True
    mode: CaptionMode = "highlight"
    delivery: SubtitleDelivery = "burned"
    # Letters/digits/space/hyphen only: the font lands inside an ASS Style line.
    font: str = Field(default="Arial Black", pattern=r"^[A-Za-z0-9 \-]{1,60}$")
    font_size: int = Field(default=84, ge=40, le=160)
    position: Literal["bottom", "center", "top"] = "bottom"
    text_hex: str = Field(default="FFFFFF", pattern=_HEX)
    highlight_hex: str = Field(default="FFD400", pattern=_HEX)
    outline_hex: str = Field(default="000000", pattern=_HEX)
    outline_px: int = Field(default=5, ge=0, le=12)
    uppercase: bool = False
    max_chars: int = Field(default=22, ge=8, le=48)


class MusicSettings(BaseModel):
    model_config = {"extra": "forbid"}

    mode: MusicMode = "library"
    mood: str = Field(default="", max_length=120)
    volume_db: float = Field(default=-18.0, ge=-36.0, le=-6.0)
    duck: bool = True


class ShortVideoSettings(BaseModel):
    model_config = {"extra": "forbid"}

    look: LookSettings = Field(default_factory=LookSettings)
    footage: FootageSettings = Field(default_factory=FootageSettings)
    subtitles: SubtitleSettings = Field(default_factory=SubtitleSettings)
    music: MusicSettings = Field(default_factory=MusicSettings)


class ShortVideoRequest(BaseModel):
    """What POST /short-videos and the estimate route take."""

    model_config = {"extra": "forbid"}

    source: Literal["topic", "script"] = "topic"
    topic: str = Field(default="", max_length=500)
    script: str = Field(default="", max_length=6000)
    title: str = Field(default="", max_length=200)
    niche_id: UUID | None = None
    variants: int = Field(default=1, ge=1, le=MAX_VARIANTS)
    cap_usd: Decimal | None = Field(default=None, gt=0, le=Decimal("500"))
    settings: ShortVideoSettings = Field(default_factory=ShortVideoSettings)

    @field_validator("topic", "script", "title")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @model_validator(mode="after")
    def _needs_input(self) -> ShortVideoRequest:
        if self.source == "topic" and len(self.topic) < 3:
            raise ValueError("write a topic (at least 3 characters)")
        if self.source == "script" and len(self.script.split()) < 5:
            raise ValueError("paste a script (at least 5 words)")
        return self


class StockClip(BaseModel):
    """One piece of footage with its provenance. Stored on the item so the
    finished video's credits are known per clip."""

    provider: Literal["pexels", "pixabay", "upload"]
    provider_id: str
    kind: Literal["video", "image"] = "video"
    download_url: str = ""
    page_url: str = ""
    width: int = 0
    height: int = 0
    duration_sec: float = 0.0
    creator: str = ""
    creator_url: str = ""
    licence: str = ""
    licence_url: str = ""
    query: str = ""
    segment: int = 0
    local_path: str = ""

    def attribution(self) -> str:
        if self.provider == "upload":
            return "Your upload"
        who = self.creator or "unknown creator"
        name = "Pexels" if self.provider == "pexels" else "Pixabay"
        return f"Video by {who} on {name} ({self.licence})"


class StageState(BaseModel):
    state: Literal["pending", "running", "done", "failed", "skipped"] = "pending"
    started_at: datetime | None = None
    ended_at: datetime | None = None
    detail: str = ""


class ShortVideoItem(BaseModel):
    id: UUID
    batch_id: UUID
    user_id: str
    variant: int
    attempt: int = 1
    status: Literal["queued", "running", "done", "failed", "cancelled"] = "queued"
    stage: str = "queued"
    progress: int = 0
    stages: dict[str, StageState] = Field(default_factory=dict)
    hook: str = ""
    script: str = ""
    search_terms: list[str] = Field(default_factory=list)
    clips: list[StockClip] = Field(default_factory=list)
    output_asset_id: UUID | None = None
    video_path: str | None = None
    srt_path: str | None = None
    vtt_path: str | None = None
    duration_sec: Decimal | None = None
    spent_micros: int = 0
    error: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ShortVideoBatch(BaseModel):
    id: UUID
    user_id: str
    niche_id: UUID | None = None
    created_by: str = ""
    principal: str = "user"
    title: str = ""
    source: Literal["topic", "script"]
    topic: str = ""
    script: str = ""
    settings: ShortVideoSettings
    variants: int
    status: Literal["awaiting_approval", "queued", "running", "done", "partial", "failed", "cancelled"]
    estimate_micros: int = 0
    cap_micros: int
    spent_micros: int = 0
    args_hash: str = ""
    approved_by: str | None = None
    approved_at: datetime | None = None
    error: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    items: list[ShortVideoItem] = Field(default_factory=list)


class Upload(BaseModel):
    id: UUID
    user_id: str
    kind: Literal["video", "image"]
    filename: str = ""
    content_type: str
    size_bytes: int
    status: Literal["pending", "ready", "rejected"] = "pending"
    storage: str = "wasabi"
    object_key: str
    width: int | None = None
    height: int | None = None
    duration_sec: Decimal | None = None
    error: str | None = None
    created_at: datetime | None = None
