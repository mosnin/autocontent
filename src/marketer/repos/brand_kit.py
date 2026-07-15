"""Per-user brand kit: reusable brand identity that seeds niche drafts."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from ..db import get_pool


class BrandKit(BaseModel):
    brand_name: str = ""
    tagline: str = ""
    tone_of_voice: str = ""
    target_audience: str = ""
    banned_words: list[str] = Field(default_factory=list)
    preferred_hashtags: list[str] = Field(default_factory=list)
    color_hex: str = ""
    updated_at: datetime | None = None
    created_at: datetime | None = None


_COLS = (
    "brand_name, tagline, tone_of_voice, target_audience, banned_words, "
    "preferred_hashtags, color_hex, updated_at, created_at"
)


async def get(user_id: str) -> BrandKit | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_COLS} from brand_kits where user_id = $1", user_id
    )
    return BrandKit(**dict(row)) if row else None


async def upsert(user_id: str, kit: BrandKit) -> BrandKit:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into brand_kits
            (user_id, brand_name, tagline, tone_of_voice, target_audience,
             banned_words, preferred_hashtags, color_hex)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (user_id) do update set
            brand_name = excluded.brand_name,
            tagline = excluded.tagline,
            tone_of_voice = excluded.tone_of_voice,
            target_audience = excluded.target_audience,
            banned_words = excluded.banned_words,
            preferred_hashtags = excluded.preferred_hashtags,
            color_hex = excluded.color_hex
        returning {_COLS}
        """,
        user_id, kit.brand_name, kit.tagline, kit.tone_of_voice,
        kit.target_audience, kit.banned_words, kit.preferred_hashtags, kit.color_hex,
    )
    return BrandKit(**dict(row))


def as_prompt_context(kit: BrandKit | None) -> str:
    """Render the kit as a compact markdown block for the niche-draft agent.
    Empty when no kit or an all-blank kit."""
    if kit is None:
        return ""
    lines: list[str] = []
    if kit.brand_name:
        lines.append(f"Brand: {kit.brand_name}")
    if kit.tagline:
        lines.append(f"Tagline: {kit.tagline}")
    if kit.tone_of_voice:
        lines.append(f"Tone of voice: {kit.tone_of_voice}")
    if kit.target_audience:
        lines.append(f"Core audience: {kit.target_audience}")
    if kit.banned_words:
        lines.append(f"Never use these words: {', '.join(kit.banned_words)}")
    if kit.preferred_hashtags:
        lines.append(f"Preferred hashtags: {', '.join(kit.preferred_hashtags)}")
    if not lines:
        return ""
    return "Brand kit (match this identity):\n" + "\n".join(f"- {ln}" for ln in lines)
