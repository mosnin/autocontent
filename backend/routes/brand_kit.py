"""Brand kit — a reusable brand identity that seeds niche drafts."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from marketer import rails
from marketer.rails.http import rails_request_context, to_http
from marketer.repos import brand_kit as repo
from marketer.repos.brand_kit import BrandKit

from ..auth import AuthCtx, CurrentUser

# put_brand_kit dispatches through marketer.rails; the dependency hands it the
# request's idempotency-key (docs/rails/enforcement-point.md).
router = APIRouter(dependencies=[Depends(rails_request_context)])

_MAX_WORD = 60
_MAX_HASHTAG = 100

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


class BrandKitBody(BaseModel):
    brand_name: str = Field(default="", max_length=120)
    tagline: str = Field(default="", max_length=200)
    tone_of_voice: str = Field(default="", max_length=300)
    target_audience: str = Field(default="", max_length=300)
    banned_words: list[str] = Field(default_factory=list, max_length=100)
    preferred_hashtags: list[str] = Field(default_factory=list, max_length=50)
    color_hex: str = Field(default="", max_length=7)

    @field_validator("color_hex")
    @classmethod
    def _hex(cls, v: str) -> str:
        if v and not _HEX.match(v):
            raise ValueError("color_hex must be #rrggbb")
        return v

    @field_validator("banned_words")
    @classmethod
    def _words(cls, v: list[str]) -> list[str]:
        if any(len(w) > _MAX_WORD for w in v):
            raise ValueError(f"a banned word is at most {_MAX_WORD} characters")
        return v

    @field_validator("preferred_hashtags")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        if any(len(t) > _MAX_HASHTAG for t in v):
            raise ValueError(f"a hashtag is at most {_MAX_HASHTAG} characters")
        return v


@router.get("", response_model=BrandKit)
async def get_brand_kit(ctx: AuthCtx = CurrentUser) -> BrandKit:
    """Return the user's brand kit, or an empty kit if none is set yet."""
    kit = await repo.get(ctx.user_id)
    return kit or BrandKit()


@router.put("", response_model=BrandKit)
async def put_brand_kit(body: BrandKitBody, ctx: AuthCtx = CurrentUser) -> BrandKit:
    """Replace the brand kit. Every later draft, post and article is written
    from it (tone, banned words, hashtags), so it is a HIGH action: checked
    and recorded at the enforcement point, deduped on the agent's
    idempotency key."""
    # Normalize hashtags to a leading '#', drop blanks.
    tags = [
        ("#" + t.lstrip("#")).strip()
        for t in body.preferred_hashtags
        if t.strip()
    ]
    banned = [w.strip() for w in body.banned_words if w.strip()]
    kit = BrandKit(
        brand_name=body.brand_name.strip(),
        tagline=body.tagline.strip(),
        tone_of_voice=body.tone_of_voice.strip(),
        target_audience=body.target_audience.strip(),
        banned_words=banned,
        preferred_hashtags=tags,
        color_hex=body.color_hex,
    )
    try:
        dispatch = await rails.enforce_dispatch(
            "brand_kit.update", user_id=ctx.user_id,
            principal=rails.principal_of(ctx), actor_email=ctx.email,
            args=kit.model_dump(mode="json"),
            target_type="brand_kit", target_id=ctx.user_id,
        )
    except rails.RailsDenied as e:
        raise to_http(e) from e
    try:
        saved = await repo.upsert(ctx.user_id, kit)
    except Exception as e:
        await dispatch.failed(f"{type(e).__name__}: {e}")
        raise
    await dispatch.succeeded()
    return saved
