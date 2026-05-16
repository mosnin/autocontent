from __future__ import annotations

from datetime import datetime, time
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
    music_path: str
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


class User(BaseModel):
    id: str  # Clerk user_id
    email: str
    ayrshare_profile_key: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


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
    error: str | None = None


class SpendEntry(BaseModel):
    user_id: str
    niche_id: UUID
    job_id: UUID | None
    provider: str  # "openai" | "xai" | "ayrshare"
    sku: str       # "dalle3" | "grok-imagine" | "tts-1-hd" | "whisper-1" | ...
    units: Decimal
    cost_usd: Decimal
