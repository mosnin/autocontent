"""Unified content calendar: scheduled video posts + article activity in one
feed, so a creator or agency sees everything shipping in a date window.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from ..db import get_pool


class CalendarItem(BaseModel):
    kind: str  # 'video' | 'article' | 'ad' | 'scheduled_post'
    id: str
    niche_id: str
    title: str
    status: str
    platform: str | None = None
    at: datetime  # scheduled_for for video, created_at for article/ad


async def items_for_user(
    user_id: str, *, start: datetime, end: datetime
) -> list[CalendarItem]:
    """Scheduled video jobs and articles for the user between [start, end).

    Videos anchor on scheduled_for (when the post goes live); articles on
    created_at (no scheduled publish yet). Newest last so the UI can lay
    them left-to-right by time."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select 'video' as kind, id::text as id, niche_id::text as niche_id,
               coalesce(payload->'script'->'idea'->>'hook', platform) as title,
               status::text as status, platform, scheduled_for as at
          from jobs
         where user_id = $1 and scheduled_for is not null
           and scheduled_for >= $2 and scheduled_for < $3
        union all
        select 'article' as kind, id::text, niche_id::text,
               coalesce(title, topic) as title, status::text as status,
               null as platform, created_at as at
          from articles
         where user_id = $1 and created_at >= $2 and created_at < $3
        union all
        select 'ad' as kind, c.id::text,
               coalesce(c.niche_id::text, '') as niche_id,
               coalesce(nullif(c.name, ''), 'Campaign') as title,
               c.status::text as status, a.platform, c.created_at as at
          from ad_campaigns c join ad_accounts a on a.id = c.ad_account_id
         where c.user_id = $1 and c.created_at >= $2 and c.created_at < $3
        union all
        -- Hand-authored scheduled posts. One row per post (not per
        -- variant) so the item stays clickable as one thing; the
        -- destinations are aggregated into `platform` as chips.
        -- niche_id is '' because a scheduled post is account-level, not
        -- channel-level (same as a niche-less ad campaign above).
        select 'scheduled_post' as kind, p.id::text, '' as niche_id,
               coalesce(nullif(left(p.content, 80), ''), 'Scheduled post') as title,
               p.status::text as status,
               (select string_agg(v.platform, ',' order by v.platform)
                  from scheduled_post_variants v
                 where v.scheduled_post_id = p.id) as platform,
               p.scheduled_at as at
          from scheduled_posts p
         where p.user_id = $1 and p.scheduled_at >= $2 and p.scheduled_at < $3
         order by at
        """,
        user_id, start, end,
    )
    return [CalendarItem(**dict(r)) for r in rows]
