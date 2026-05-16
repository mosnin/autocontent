from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal

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


class Job(BaseModel):
    id: str
    niche: str
    platform: Literal["tiktok", "reels", "shorts"] = "tiktok"
    status: JobStatus = JobStatus.queued
    created_at: datetime = Field(default_factory=datetime.utcnow)
    script: Script | None = None
    clips: list[Clip] = Field(default_factory=list)
    audio: AudioTrack | None = None
    rendered: RenderedVideo | None = None
    scheduled_for: datetime | None = None
    error: str | None = None
