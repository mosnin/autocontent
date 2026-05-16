from __future__ import annotations

import json
from decimal import Decimal
from uuid import UUID

from ..db import get_pool
from ..models import Niche, PostingWindow


def _row_to_niche(row) -> Niche:
    d = dict(row)
    d["posting_windows"] = [PostingWindow(**w) for w in json.loads(d["posting_windows"])]
    return Niche(**d)


async def create(
    user_id: str,
    *,
    title: str,
    description: str,
    target_audience: str,
    hashtags: list[str],
    visual_style: str,
    voice: str,
    target_duration_sec: int,
    scene_count: int,
    posting_windows: list[PostingWindow],
    platforms: list[str],
    daily_spend_cap_usd: Decimal,
) -> Niche:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into niches (
            user_id, title, description, target_audience, hashtags,
            visual_style, voice, target_duration_sec, scene_count,
            posting_windows, platforms, daily_spend_cap_usd
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
        returning *
        """,
        user_id, title, description, target_audience, hashtags,
        visual_style, voice, target_duration_sec, scene_count,
        json.dumps([w.model_dump() for w in posting_windows]),
        platforms, daily_spend_cap_usd,
    )
    return _row_to_niche(row)


async def list_for_user(user_id: str) -> list[Niche]:
    pool = await get_pool()
    rows = await pool.fetch(
        "select * from niches where user_id = $1 and archived_at is null order by created_at",
        user_id,
    )
    return [_row_to_niche(r) for r in rows]


async def get(niche_id: UUID, *, user_id: str) -> Niche | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from niches where id = $1 and user_id = $2",
        niche_id, user_id,
    )
    return _row_to_niche(row) if row else None


async def archive(niche_id: UUID, *, user_id: str) -> None:
    pool = await get_pool()
    await pool.execute(
        "update niches set archived_at = now() where id = $1 and user_id = $2",
        niche_id, user_id,
    )
