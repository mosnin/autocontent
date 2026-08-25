"""Models for the scheduled-post queue.

Three shapes:

``ScheduledPost``
    One user-authored item on the calendar. Holds the *default* copy and
    media plus the instant it should go out. `scheduled_at` is ALWAYS
    stored and carried in UTC; `timezone` records the IANA zone the user
    authored it in so the UI can render "09:00 your time" and so a
    recurring template can be re-expanded correctly across DST.

``PlatformVariant``
    The fan-out. One scheduled post targets N platforms and each platform
    gets its own row: optional copy/media overrides (LinkedIn wants a
    paragraph, TikTok wants a hook) and — crucially — its OWN status.
    Instagram failing must not re-post TikTok on retry, which is only
    expressible if delivery state lives per platform, not per post.

``RecurringSlot``
    A weekday+time template ("Mon/Wed/Fri 09:00 America/New_York") that
    `slots.expand` turns into concrete UTC instants.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator

# --- platforms -------------------------------------------------------------
#
# Ayrshare's own platform vocabulary. Kept here rather than imported from
# services/scheduler.py because that module's PLATFORM_MAP only covers the
# three video surfaces the render pipeline targets (tiktok/reels/shorts);
# a hand-written post can go anywhere the user's profile is connected.
# The aliases below are a strict superset of scheduler.PLATFORM_MAP, so a
# value that works there works here and resolves identically.
SUPPORTED_PLATFORMS: frozenset[str] = frozenset(
    {
        "bluesky",
        "facebook",
        "instagram",
        "linkedin",
        "pinterest",
        "reddit",
        "telegram",
        "threads",
        "tiktok",
        "twitter",
        "youtube",
    }
)

PLATFORM_ALIASES: dict[str, str] = {
    "reels": "instagram",   # matches services/scheduler.PLATFORM_MAP
    "shorts": "youtube",    # matches services/scheduler.PLATFORM_MAP
    "x": "twitter",         # the rename Ayrshare never made
    "ig": "instagram",
    "yt": "youtube",
    "fb": "facebook",
}

MAX_CONTENT_CHARS = 5_000
MAX_MEDIA_PER_POST = 10
MAX_PLATFORMS_PER_POST = len(SUPPORTED_PLATFORMS)

# Parent lifecycle. `due` is deliberately NOT a stored status: a post is due
# when `scheduled_at <= now()`, which the claim query evaluates atomically.
# Materialising `due` would need its own sweeper and would introduce a second
# race (mark-due vs. claim) that buys nothing.
PostStatus = Literal["scheduled", "dispatching", "posted", "partial", "failed"]
VariantStatus = Literal["pending", "dispatching", "posted", "failed"]

TERMINAL_POST_STATUSES: frozenset[str] = frozenset({"posted", "partial", "failed"})
# Statuses from which a user may still edit or delete the post. Once it is
# `dispatching` we may already be mid-flight to a real social account.
MUTABLE_POST_STATUSES: frozenset[str] = frozenset({"scheduled", "failed", "partial"})


class PlatformError(ValueError):
    pass


def normalize_platform(raw: str) -> str:
    """Fold a caller-supplied platform name to its Ayrshare name.

    Raises PlatformError for anything unknown — silently dropping an
    unrecognised platform would mean a user schedules to four platforms and
    only three ever post, with nothing to point at.
    """
    key = (raw or "").strip().lower()
    key = PLATFORM_ALIASES.get(key, key)
    if key not in SUPPORTED_PLATFORMS:
        raise PlatformError(f"unsupported platform {raw!r}")
    return key


def normalize_platforms(raw: list[str]) -> list[str]:
    """Normalise + de-duplicate, preserving the caller's ordering.

    De-duplication matters: `["x", "twitter"]` is one destination, and two
    variant rows for one destination would post twice.
    """
    out: list[str] = []
    for item in raw:
        p = normalize_platform(item)
        if p not in out:
            out.append(p)
    return out


def validate_timezone(name: str) -> str:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, KeyError) as e:
        raise ValueError(f"unknown IANA timezone {name!r}") from e
    return name


def to_utc(dt: datetime) -> datetime:
    """Normalise any datetime to an aware UTC instant.

    A naive datetime from the wire is interpreted as UTC rather than as
    server-local time: the server's clock zone is an accident of deployment
    and must never change when a user's post goes out.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _check_media(urls: list[str]) -> list[str]:
    if len(urls) > MAX_MEDIA_PER_POST:
        raise ValueError(f"at most {MAX_MEDIA_PER_POST} media urls per post")
    for u in urls:
        if not u.startswith(("http://", "https://")):
            raise ValueError(f"media url must be http(s): {u!r}")
        if len(u) > 2_000:
            raise ValueError("media url too long")
    return urls


class VariantOverride(BaseModel):
    """Per-platform override supplied on create/update. `None` means
    "inherit the parent" — distinct from `""`, which means "this platform
    gets empty copy" (legal for a media-only post)."""

    content: str | None = Field(default=None, max_length=MAX_CONTENT_CHARS)
    media_urls: list[str] | None = None

    @field_validator("media_urls")
    @classmethod
    def _media(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else _check_media(v)


class PlatformVariant(BaseModel):
    """A stored fan-out row: one platform's copy of one scheduled post."""

    id: UUID | None = None
    platform: str
    content: str | None = None
    media_urls: list[str] | None = None
    status: VariantStatus = "pending"
    provider_post_id: str | None = None
    error: str | None = None
    dispatched_at: datetime | None = None

    def resolved_content(self, parent_content: str) -> str:
        return parent_content if self.content is None else self.content

    def resolved_media(self, parent_media: list[str]) -> list[str]:
        return parent_media if self.media_urls is None else self.media_urls


class ScheduledPostCreate(BaseModel):
    content: str = Field(default="", max_length=MAX_CONTENT_CHARS)
    media_urls: list[str] = Field(default_factory=list)
    platforms: list[str] = Field(min_length=1, max_length=MAX_PLATFORMS_PER_POST)
    scheduled_at: datetime
    timezone: str = "UTC"
    variants: dict[str, VariantOverride] = Field(default_factory=dict)

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str) -> str:
        return validate_timezone(v)

    @field_validator("media_urls")
    @classmethod
    def _media(cls, v: list[str]) -> list[str]:
        return _check_media(v)

    @field_validator("scheduled_at")
    @classmethod
    def _utc(cls, v: datetime) -> datetime:
        return to_utc(v)

    @model_validator(mode="after")
    def _coherent(self) -> ScheduledPostCreate:
        try:
            platforms = normalize_platforms(self.platforms)
        except PlatformError as e:
            raise ValueError(str(e)) from e
        object.__setattr__(self, "platforms", platforms)

        # Variant keys are normalised too, and must name a targeted platform:
        # a variant for a platform we aren't posting to is silently dead copy,
        # which is exactly the kind of thing a user only discovers after the
        # post goes out wrong.
        folded: dict[str, VariantOverride] = {}
        for key, override in self.variants.items():
            try:
                p = normalize_platform(key)
            except PlatformError as e:
                raise ValueError(str(e)) from e
            if p not in platforms:
                raise ValueError(f"variant for {key!r} is not in platforms")
            folded[p] = override
        object.__setattr__(self, "variants", folded)

        if not self.content.strip() and not self.media_urls:
            # Every platform must end up with *something* to post; a post with
            # neither parent copy nor parent media is only valid if every
            # targeted platform overrides one of them.
            for p in platforms:
                ov = folded.get(p)
                if ov is None or (not (ov.content or "").strip() and not (ov.media_urls or [])):
                    raise ValueError("post needs content or media (globally or per platform)")
        return self


class ScheduledPostUpdate(BaseModel):
    """PATCH body. Every field optional; `scheduled_at` alone is the
    drag-to-reschedule path."""

    content: str | None = Field(default=None, max_length=MAX_CONTENT_CHARS)
    media_urls: list[str] | None = None
    scheduled_at: datetime | None = None
    timezone: str | None = None
    platforms: list[str] | None = None
    variants: dict[str, VariantOverride] | None = None

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str | None) -> str | None:
        return None if v is None else validate_timezone(v)

    @field_validator("media_urls")
    @classmethod
    def _media(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else _check_media(v)

    @field_validator("scheduled_at")
    @classmethod
    def _utc(cls, v: datetime | None) -> datetime | None:
        return None if v is None else to_utc(v)

    @model_validator(mode="after")
    def _fold(self) -> ScheduledPostUpdate:
        if self.platforms is not None:
            try:
                object.__setattr__(self, "platforms", normalize_platforms(self.platforms))
            except PlatformError as e:
                raise ValueError(str(e)) from e
        if self.variants is not None:
            folded: dict[str, VariantOverride] = {}
            for key, override in self.variants.items():
                try:
                    folded[normalize_platform(key)] = override
                except PlatformError as e:
                    raise ValueError(str(e)) from e
            object.__setattr__(self, "variants", folded)
        return self

    def is_empty(self) -> bool:
        return not self.model_dump(exclude_unset=True)


class ScheduledPost(BaseModel):
    id: UUID
    user_id: str
    content: str = ""
    media_urls: list[str] = Field(default_factory=list)
    scheduled_at: datetime
    timezone: str = "UTC"
    status: PostStatus = "scheduled"
    source: str = "manual"  # manual | import | recurring
    recurring_slot_id: UUID | None = None
    error: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    variants: list[PlatformVariant] = Field(default_factory=list)

    @property
    def platforms(self) -> list[str]:
        return [v.platform for v in self.variants]


class RecurringSlotCreate(BaseModel):
    """A weekly template. `weekday` is 0=Monday .. 6=Sunday, matching
    `datetime.weekday()` so expansion needs no translation table."""

    label: str = Field(default="", max_length=120)
    weekday: int = Field(ge=0, le=6)
    hour: int = Field(ge=0, le=23)
    minute: int = Field(default=0, ge=0, le=59)
    timezone: str = "UTC"
    platforms: list[str] = Field(default_factory=list, max_length=MAX_PLATFORMS_PER_POST)
    active: bool = True

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str) -> str:
        return validate_timezone(v)

    @model_validator(mode="after")
    def _fold(self) -> RecurringSlotCreate:
        try:
            object.__setattr__(self, "platforms", normalize_platforms(self.platforms))
        except PlatformError as e:
            raise ValueError(str(e)) from e
        return self


class RecurringSlot(RecurringSlotCreate):
    id: UUID
    user_id: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
