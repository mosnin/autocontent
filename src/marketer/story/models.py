"""Story video data: the editable plan, the row, and the API view."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

MICROS_PER_USD = 1_000_000


def usd_to_micros(usd: Decimal | float | int | str) -> int:
    """Integer micro-dollars, rounded half up. Never a float near money."""
    d = Decimal(str(usd))
    if d < 0:
        raise ValueError("negative amount")
    return int((d * MICROS_PER_USD).quantize(Decimal(1), rounding="ROUND_HALF_UP"))


def micros_to_usd(micros: int) -> Decimal:
    return (Decimal(micros) / MICROS_PER_USD).quantize(Decimal("0.000001"))


class StoryStatus(str, Enum):
    draft = "draft"
    writing = "writing"
    script_ready = "script_ready"
    boarding = "boarding"
    storyboard_ready = "storyboard_ready"
    awaiting_approval = "awaiting_approval"
    rendering = "rendering"
    done = "done"
    failed = "failed"


# Statuses a background stage is working in: a second start is refused (409).
BUSY = {StoryStatus.writing, StoryStatus.boarding, StoryStatus.rendering}


class Scene(BaseModel):
    heading: str = Field(default="", max_length=200)
    script: str = Field(default="", max_length=6000)


class Character(BaseModel):
    name: str = Field(max_length=80)
    visible: bool = True
    static_features: str = Field(default="", max_length=1000)
    dynamic_features: str = Field(default="", max_length=1000)


class Shot(BaseModel):
    idx: int
    scene_idx: int
    visual: str = ""
    first_frame: str = ""
    motion: str = ""
    narration: str = ""
    characters: list[str] = Field(default_factory=list)
    duration_sec: int = 5
    # Bumped by a per-shot regenerate: a new frame (and so a new clip) gets a
    # new checkpoint key, while every other shot keeps its own.
    frame_rev: int = 0


class StoryPlan(BaseModel):
    logline: str = ""
    story: str = ""
    scenes: list[Scene] = Field(default_factory=list)
    characters: list[Character] = Field(default_factory=list)
    shots: list[Shot] = Field(default_factory=list)


Mode = Literal["idea", "script"]
Aspect = Literal["9:16", "16:9", "1:1"]


class StoryVideo(BaseModel):
    id: UUID
    user_id: str
    niche_id: UUID | None = None
    created_by: str = ""
    title: str = ""
    mode: Mode
    source: str
    requirement: str = ""
    style: str = ""
    aspect: Aspect = "9:16"
    status: StoryStatus = StoryStatus.draft
    stage: str = ""
    revision: int = 0
    plan: StoryPlan = Field(default_factory=StoryPlan)
    estimate_micros: int = 0
    spent_micros: int = 0
    approval_status: Literal["pending", "approved", "expired"] | None = None
    approval_args_hash: str | None = None
    approved_by: str | None = None
    approved_at: datetime | None = None
    video_path: str | None = None
    error: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class Charge(BaseModel):
    story_id: UUID
    user_id: str
    idempotency_key: str
    stage: str
    provider: str
    sku: str
    units: Decimal = Decimal(0)
    cost_micros: int


# ── checkpoint keys ──────────────────────────────────────────────────────────
# One key per unit of work. A key embeds every revision that shaped the unit,
# so an edit invalidates exactly what it changed and nothing else.

def key_story(rev: int) -> str:
    return f"story:r{rev}"


def key_scenes(rev: int) -> str:
    return f"scenes:r{rev}"


def key_characters(rev: int) -> str:
    return f"characters:r{rev}"


def key_shots(rev: int, scene_idx: int) -> str:
    return f"shots:r{rev}:s{scene_idx}"


def key_portrait(rev: int, name: str) -> str:
    slug = "".join(ch if ch.isalnum() else "-" for ch in name.lower()).strip("-")[:40] or "x"
    return f"portrait:r{rev}:{slug}"


def key_frame(rev: int, shot: Shot) -> str:
    return f"frame:r{rev}:{shot.idx}.{shot.frame_rev}"


def key_clip(rev: int, shot: Shot) -> str:
    return f"clip:r{rev}:{shot.idx}.{shot.frame_rev}"


def key_final(rev: int, shots: list[Shot]) -> str:
    sig = "-".join(f"{s.idx}.{s.frame_rev}" for s in shots)
    return f"final:r{rev}:{sig}"


# ── API view ────────────────────────────────────────────────────────────────

class ShotView(Shot):
    frame_ready: bool = False
    clip_ready: bool = False


class StoryView(BaseModel):
    """What the API returns. Never a filesystem path."""

    id: UUID
    niche_id: UUID | None
    title: str
    mode: Mode
    source: str
    requirement: str
    style: str
    aspect: Aspect
    status: StoryStatus
    stage: str
    revision: int
    logline: str
    scenes: list[Scene]
    characters: list[Character]
    shots: list[ShotView]
    portraits: list[str]
    estimate_usd: Decimal
    spent_usd: Decimal
    approval_status: str | None
    needs_approval: bool
    has_video: bool
    error: str | None
    progress: dict[str, Any]
    created_at: datetime | None
    updated_at: datetime | None


class StorySummary(BaseModel):
    id: UUID
    title: str
    status: StoryStatus
    stage: str
    shots: int
    spent_usd: Decimal
    has_video: bool
    created_at: datetime | None
