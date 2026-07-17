"""Unified content calendar: scheduled video posts + article activity in one
feed, so a creator or agency sees everything shipping in a date window.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from ..db import get_pool


class CalendarItem(BaseModel):
    kind: str  # 'video' | 'article' | 'ad'
    id: str
    niche_id: str
    title: str
    status: str
    platform: str | None = None
    at: datetime  # scheduled_for for video, scheduled_at/created_at for article, created_at for ad
    # True when `at` is a future/intended publish date rather than when the
    # item was actually created or already went live — lets the UI show a
    # "scheduled" badge distinct from "published"/in-progress items.
    scheduled: bool = False


async def items_for_user(
    user_id: str, *, start: datetime, end: datetime
) -> list[CalendarItem]:
    """Scheduled video jobs and articles for the user between [start, end).

    Videos anchor on scheduled_for (when the post goes live). Articles
    anchor on scheduled_at when the piece has an intended publish date, else
    fall back to created_at (no schedule set yet) — `scheduled` flags which
    case applies so the UI can distinguish a scheduled-but-not-yet-published
    piece from one that's simply in the pipeline or already done. Newest
    last so the UI can lay them left-to-right by time."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select 'video' as kind, id::text as id, niche_id::text as niche_id,
               coalesce(payload->'script'->'idea'->>'hook', platform) as title,
               status::text as status, platform, scheduled_for as at,
               true as scheduled
          from jobs
         where user_id = $1 and scheduled_for is not null
           and scheduled_for >= $2 and scheduled_for < $3
        union all
        select 'article' as kind, id::text, niche_id::text,
               coalesce(title, topic) as title, status::text as status,
               null as platform, coalesce(scheduled_at, created_at) as at,
               (scheduled_at is not null) as scheduled
          from articles
         where user_id = $1
           and coalesce(scheduled_at, created_at) >= $2
           and coalesce(scheduled_at, created_at) < $3
        union all
        select 'ad' as kind, c.id::text,
               coalesce(c.niche_id::text, '') as niche_id,
               coalesce(nullif(c.name, ''), 'Campaign') as title,
               c.status::text as status, a.platform, c.created_at as at,
               false as scheduled
          from ad_campaigns c join ad_accounts a on a.id = c.ad_account_id
         where c.user_id = $1 and c.created_at >= $2 and c.created_at < $3
         order by at
        """,
        user_id, start, end,
    )
    return [CalendarItem(**dict(r)) for r in rows]
