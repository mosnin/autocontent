from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from .creative_brief import CreativeBrief


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
    awaiting_approval = "awaiting_approval"
    done = "done"
    failed = "failed"
    skipped = "skipped"


class User(BaseModel):
    id: str  # Clerk user_id
    email: str
    ayrshare_profile_key: str | None = None
    global_daily_cap_usd: Decimal | None = None
    # Prepaid pipeline credit (hosted product). Ignored when billing is
    # disabled.
    credit_balance_usd: Decimal = Decimal("0")
    role: str = "user"  # 'user' | 'admin'
    suspended_at: datetime | None = None
    suspended_reason: str | None = None
    # Opt-out of terminal-state email notifications. Defaults on.
    email_notifications: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class UserSettingsUpdate(BaseModel):
    """Body for PATCH /api/v1/users/me — all fields optional (only the keys
    present are changed)."""

    global_daily_cap_usd: Decimal | None = None
    email_notifications: bool | None = None

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

    # Optional recurring-cast description ("a grumpy clay llama named Sol
    # wearing a tiny lab coat"). Steers the character reference sheet, and
    # through it every scene keyframe. None = model invents the cast.
    character_description: str | None = None

    # Creative DNA: structured brief steering every agent prompt, music
    # pick, and caption style. Defaults = stock platform behavior.
    creative_brief: CreativeBrief = Field(default_factory=CreativeBrief)

    # Per-niche overrides for provider behavior.
    image_quality: Literal["low", "medium", "high"] = "medium"
    video_resolution: Literal["480p", "720p"] = "480p"
    scene_max_duration_sec: int = Field(default=5, ge=1, le=15)
    tts_style_directions: str | None = None

    # Animation backend: 'grok' (default) or 'fal' + a model id from the
    # curated fal registry. Scriptwriter LLM: OpenRouter model id, empty
    # = stock agent_model.
    video_provider: Literal["grok", "fal"] = "grok"
    fal_model: str = ""
    script_model: str = ""

    # Kits: reusable user-level skills injected at runtime. None = the
    # user's default kit of that kind (or nothing).
    design_kit_id: UUID | None = None
    writing_kit_id: UUID | None = None

    posting_windows: list[PostingWindow]
    platforms: list[Literal["tiktok", "reels", "shorts"]]
    daily_spend_cap_usd: Decimal

    # Trust ramp: when true, a rendered video parks in awaiting_approval
    # after QA instead of scheduling autonomously.
    approve_before_post: bool = False

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
    niche_id: UUID | None
    job_id: UUID | None
    article_id: UUID | None = None  # set for article-pipeline spend (job_id null)
    image_post_id: UUID | None = None  # set for image-post spend
    provider: str  # "openai" | "xai" | "ayrshare"
    sku: str       # "dalle3" | "grok-imagine" | "tts-1-hd" | "whisper-1" | ...
    units: Decimal
    cost_usd: Decimal


class CreditTransaction(BaseModel):
    """One movement of prepaid credit — purchase, grant, or pipeline debit."""

    id: UUID
    user_id: str
    amount_usd: Decimal
    kind: str  # 'purchase' | 'debit' | 'grant'
    reference: str | None = None
    description: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


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
    character_description: str | None = None
    creative_brief: CreativeBrief | None = None
    video_provider: Literal["grok", "fal"] = "grok"
    fal_model: str = ""
    script_model: str = ""
    design_kit_id: UUID | None = None
    writing_kit_id: UUID | None = None


class TodaySpend(BaseModel):
    """Mirrors backend.routes.spend.TodaySpend so SDK callers have one shape."""

    by_niche: dict[str, Decimal]
    total_usd: Decimal


class SpendHistoryRow(BaseModel):
    day: date
    # None = niche-less spend (e.g. template remixes).
    niche_id: UUID | None
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


class Template(BaseModel):
    """Admin-curated remixable reference: an asset + the exact prompt that
    produced its look. Users remix with their own product image and the
    generation inherits the aesthetic."""

    id: UUID
    kind: Literal["video", "image", "carousel"]
    name: str
    description: str = ""
    prompt: str
    reference_key: str = ""
    config: dict = Field(default_factory=dict)
    is_published: bool = False
    created_by: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Campaign(BaseModel):
    """An orchestrated marketing push: content + SEO + ads lanes running
    together against a time window and a content-credit budget."""

    id: UUID
    user_id: str
    name: str
    objective: str = ""
    status: Literal["draft", "running", "paused", "completed"] = "draft"
    starts_at: datetime = Field(default_factory=datetime.utcnow)
    ends_at: datetime | None = None
    # Cap on content-generation credit spend attributed to this campaign.
    # Ad platform spend is governed separately (fail-closed AdSpendGuard).
    budget_usd: Decimal
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CampaignItem(BaseModel):
    """One lane in a campaign.

    kind='video'   ref_id -> niche  (auto-generate + post to socials)
    kind='article' ref_id -> niche  (SEO article cadence)
    kind='ad'      ref_id -> ad campaign (linked; governed lifecycle)
    """

    id: UUID
    campaign_id: UUID
    user_id: str
    kind: Literal["video", "article", "ad", "image"]
    ref_id: UUID
    enabled: bool = True
    cadence_per_week: int = Field(default=3, ge=1, le=56)
    config: dict = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Kit(BaseModel):
    """A user-level reusable skill injected into agent runtimes.

    kind='design'  -> video direction (scriptwriter + visual director)
    kind='writing' -> article pipeline voice/style
    kind='ad'      -> ads optimization proposer (propose-only; the
                      fail-closed spend guard is never relaxed by a kit)
    """

    id: UUID
    user_id: str
    kind: Literal["design", "ad", "writing"]
    name: str
    description: str = ""
    # The skill itself: instructions the agent receives verbatim.
    content: str = ""
    # Structured knobs (ad kits: e.g. {"target_roas": 2.5, "max_cpa_usd": 30}).
    rules: dict = Field(default_factory=dict)
    is_default: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class MediaAsset(BaseModel):
    """One indexed media artifact: a scene clip, keyframe, voiceover,
    final video, or a remixed composition output."""

    id: UUID
    user_id: str
    niche_id: UUID | None = None
    job_id: UUID | None = None
    kind: Literal["clip", "keyframe", "voiceover", "final", "composition"]
    scene_index: int | None = None
    storage: Literal["wasabi", "volume"]
    object_key: str
    content_type: str = "video/mp4"
    size_bytes: int = 0
    duration_sec: Decimal | None = None
    title: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Composition(BaseModel):
    """A remix: a new video assembled from existing library clips."""

    id: UUID
    user_id: str
    title: str = ""
    clip_asset_ids: list[UUID]
    audio_mode: Literal["keep", "mute"] = "keep"
    status: Literal["queued", "rendering", "done", "failed"] = "queued"
    output_asset_id: UUID | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PostMetrics(BaseModel):
    id: UUID
    user_id: str
    job_id: UUID
    provider_post_id: str
    platform: str
    sampled_at: datetime
    views: int | None = None
    likes: int | None = None
    comments: int | None = None
    shares: int | None = None
    saves: int | None = None
    watch_time_sec: Decimal | None = None
    avg_watch_time_sec: Decimal | None = None
    completion_rate: Decimal | None = None
    reach: int | None = None
    impressions: int | None = None
    raw: dict
    created_at: datetime


class JobPerformance(BaseModel):
    job_id: UUID
    created_at: datetime
    platform: str
    status: str
    hook: str | None = None             # from job.script.idea.hook if scripted
    topic: str | None = None            # from job.script.idea.topic
    visual_style: str | None = None     # from niche snapshot at script time
    scene_count: int | None = None      # len(job.script.scenes)
    target_duration_sec: int | None = None
    cost_usd: Decimal                   # sum of spend_ledger rows for this job
    # newest metric sample (None if not yet sampled or post failed)
    views: int | None = None
    likes: int | None = None
    watch_time_sec: Decimal | None = None
    avg_watch_time_sec: Decimal | None = None
    completion_rate: Decimal | None = None


class PerformanceSummary(BaseModel):
    total_videos: int            # done jobs in window
    total_spend_usd: Decimal
    total_views: int             # sum across sampled jobs
    avg_views_per_video: float   # 0 if no sampled jobs
    best_job_id: UUID | None     # highest views in window
    worst_job_id: UUID | None    # lowest non-null views


class NichePerformance(BaseModel):
    niche_id: UUID
    days: int
    jobs: list[JobPerformance]
    summary: PerformanceSummary
