"""Brand kit — a reusable brand identity that seeds niche drafts."""
from __future__ import annotations

import re

from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator

from marketer.repos import brand_kit as repo
from marketer.repos.brand_kit import BrandKit

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

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


@router.get("", response_model=BrandKit)
async def get_brand_kit(ctx: AuthCtx = CurrentUser) -> BrandKit:
    """Return the user's brand kit, or an empty kit if none is set yet."""
    kit = await repo.get(ctx.user_id)
    return kit or BrandKit()


@router.put("", response_model=BrandKit)
async def put_brand_kit(body: BrandKitBody, ctx: AuthCtx = CurrentUser) -> BrandKit:
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
    return await repo.upsert(ctx.user_id, kit)
