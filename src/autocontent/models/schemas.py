from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class Idea(BaseModel):
    topic: str
    angle: str
    hook: str
    target_audience: str
    why_it_works: str


class Scene(BaseModel):
    index: int
    narration: str = Field(description="What the VO says during this scene")
    visual_prompt: str = Field(description="DALL-E 3 prompt for the keyframe")
    motion_prompt: str = Field(description="Grok Imagine prompt describing the animation")
    duration_sec: float


class Script(BaseModel):
    idea: Idea
    scenes: list[Scene]
    total_duration_sec: float
    cta: str | None = None


class Clip(BaseModel):
    scene_index: int
    keyframe_path: str
    video_path: str
    duration_sec: float


class AudioTrack(BaseModel):
    voiceover_path: str
    music_path: str | None = None
    music_gain_db: float = -18.0


class RenderedVideo(BaseModel):
    path: str
    duration_sec: float
    captions_path: str | None = None
    thumbnail_path: str | None = None


class JobStatus(str, Enum):
    queued = "queued"
    ideating = "ideating"
    scripting = "scripting"
    generating_images = "generating_images"
    animating = "animating"
    voicing = "voicing"
    editing = "editing"
    captioning = "captioning"
    qa = "qa"
    scheduling = "scheduling"
    done = "done"
    failed = "failed"
    skipped = "skipped"


class User(BaseModel):
    id: str  # Clerk user_id
    email: str
    ayrshare_profile_key: str | None = None
    global_daily_cap_usd: Decimal | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class UserSettingsUpdate(BaseModel):
    """Body for PATCH /api/v1/users/me — all fields optional."""

    global_daily_cap_usd: Decimal | None = None

    model_config = {"extra": "forbid"}


class PostingWindow(BaseModel):
    hour: int = Field(ge=0, le=23)
    minute: int = Field(ge=0, le=59)
    tz: str  # IANA, e.g. "America/Los_Angeles"

    def at(self, day: datetime) -> datetime:
        from zoneinfo import ZoneInfo

        return datetime.combine(day.date(), time(self.hour, self.minute), ZoneInfo(self.tz))


class Niche(BaseModel):
    id: UUID
    user_id: str
    title: str
    description: str
    target_audience: str
    hashtags: list[str] = Field(default_factory=list)

    visual_style: str
    voice: str
    target_duration_sec: int
    scene_count: int

    # Per-niche overrides for provider behavior.
    image_quality: Literal["low", "medium", "high"] = "medium"
    video_resolution: Literal["480p", "720p"] = "480p"
    scene_max_duration_sec: int = Field(default=5, ge=1, le=15)
    tts_style_directions: str | None = None

    posting_windows: list[PostingWindow]
    platforms: list[Literal["tiktok", "reels", "shorts"]]
    daily_spend_cap_usd: Decimal

    created_at: datetime = Field(default_factory=datetime.utcnow)
    archived_at: datetime | None = None


class Job(BaseModel):
    id: UUID
    user_id: str
    niche_id: UUID
    platform: Literal["tiktok", "reels", "shorts"]
    status: JobStatus = JobStatus.queued
    created_at: datetime = Field(default_factory=datetime.utcnow)
    script: Script | None = None
    clips: list[Clip] = Field(default_factory=list)
    audio: AudioTrack | None = None
    rendered: RenderedVideo | None = None
    scheduled_for: datetime | None = None
    provider_post_id: str | None = None
    error: str | None = None


class SpendEntry(BaseModel):
    user_id: str
    niche_id: UUID
    job_id: UUID | None
    provider: str  # "openai" | "xai" | "ayrshare"
    sku: str       # "dalle3" | "grok-imagine" | "tts-1-hd" | "whisper-1" | ...
    units: Decimal
    cost_usd: Decimal


class PersonalAccessToken(BaseModel):
    """Public-safe view of a PAT row. Never contains the hash."""

    id: UUID
    user_id: str
    name: str
    prefix: str
    last_used_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime | None = None


class NicheCreatePayload(BaseModel):
    """Body shape for POST /api/v1/niches. Used by the SDK / CLI / MCP server."""

    title: str
    description: str
    target_audience: str
    hashtags: list[str] = Field(default_factory=list)
    visual_style: str
    voice: str
    target_duration_sec: int
    scene_count: int
    posting_windows: list[PostingWindow]
    platforms: list[Literal["tiktok", "reels", "shorts"]]
    daily_spend_cap_usd: Decimal
    image_quality: Literal["low", "medium", "high"] = "medium"
    video_resolution: Literal["480p", "720p"] = "480p"
    scene_max_duration_sec: int = 5
    tts_style_directions: str | None = None


class TodaySpend(BaseModel):
    """Mirrors backend.routes.spend.TodaySpend so SDK callers have one shape."""

    by_niche: dict[str, Decimal]
    total_usd: Decimal


class SpendHistoryRow(BaseModel):
    day: date
    niche_id: UUID
    cost_usd: Decimal


class SpendHistory(BaseModel):
    rows: list[SpendHistoryRow]
    days: int
    total_usd: Decimal


class AyrshareConnectResponse(BaseModel):
    profile_key: str
    login_url: str


class AyrshareConnectStatus(BaseModel):
    connected: bool
    profile_key: str | None = None
