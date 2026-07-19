"""Campaigns: the orchestration layer over Studio, Press, and Ads.

All queries user-scoped. Spend attribution: content jobs/articles the
runner spawns carry campaign_id, so `spent_usd` is a single rollup over
spend_ledger through those foreign keys.
"""
from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from ..db import get_pool
from ..models import Campaign, CampaignItem


def _row_to_campaign(row) -> Campaign:
    return Campaign(**dict(row))


def _row_to_item(row) -> CampaignItem:
    d = dict(row)
    if isinstance(d.get("config"), str):
        d["config"] = json.loads(d["config"])
    return CampaignItem(**d)


async def create(
    *,
    user_id: str,
    name: str,
    objective: str = "",
    budget_usd: Decimal,
    starts_at: datetime | None = None,
    ends_at: datetime | None = None,
) -> Campaign:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into campaigns (user_id, name, objective, budget_usd, starts_at, ends_at)
        values ($1, $2, $3, $4, coalesce($5, now()), $6)
        returning *
        """,
        user_id, name, objective, budget_usd, starts_at, ends_at,
    )
    return _row_to_campaign(row)


async def get(campaign_id: UUID, *, user_id: str) -> Campaign | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from campaigns where id = $1 and user_id = $2",
        campaign_id, user_id,
    )
    return _row_to_campaign(row) if row else None


async def list_for_user(user_id: str) -> list[Campaign]:
    pool = await get_pool()
    rows = await pool.fetch(
        "select * from campaigns where user_id = $1 order by created_at desc",
        user_id,
    )
    return [_row_to_campaign(r) for r in rows]


async def set_status(
    campaign_id: UUID, *, user_id: str, status: str
) -> Campaign | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update campaigns set status = $3, updated_at = now()
        where id = $1 and user_id = $2
        returning *
        """,
        campaign_id, user_id, status,
    )
    return _row_to_campaign(row) if row else None


async def list_running() -> list[Campaign]:
    """Every running campaign across users — the runner cron's worklist."""
    pool = await get_pool()
    rows = await pool.fetch("select * from campaigns where status = 'running'")
    return [_row_to_campaign(r) for r in rows]


# --------------------------------------------------------------------------- items

async def add_item(
    *,
    campaign_id: UUID,
    user_id: str,
    kind: str,
    ref_id: UUID,
    cadence_per_week: int = 3,
    config: dict | None = None,
) -> CampaignItem:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into campaign_items (campaign_id, user_id, kind, ref_id, cadence_per_week, config)
        values ($1, $2, $3, $4, $5, $6::jsonb)
        on conflict (campaign_id, kind, ref_id) do update
            set cadence_per_week = excluded.cadence_per_week,
                enabled = true
        returning *
        """,
        campaign_id, user_id, kind, ref_id, cadence_per_week,
        json.dumps(config or {}),
    )
    return _row_to_item(row)


async def list_items(campaign_id: UUID, *, user_id: str) -> list[CampaignItem]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from campaign_items
        where campaign_id = $1 and user_id = $2
        order by kind, created_at
        """,
        campaign_id, user_id,
    )
    return [_row_to_item(r) for r in rows]


async def set_item_enabled(
    item_id: UUID, *, user_id: str, enabled: bool
) -> CampaignItem | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update campaign_items set enabled = $3
        where id = $1 and user_id = $2
        returning *
        """,
        item_id, user_id, enabled,
    )
    return _row_to_item(row) if row else None


async def remove_item(item_id: UUID, *, user_id: str) -> bool:
    pool = await get_pool()
    result = await pool.execute(
        "delete from campaign_items where id = $1 and user_id = $2",
        item_id, user_id,
    )
    return result.endswith("1")


# --------------------------------------------------------------------------- rollups

async def spent_usd(campaign_id: UUID, *, user_id: str) -> Decimal:
    """Content-credit spend attributed to this campaign (video jobs +
    articles it spawned)."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select coalesce(sum(sl.cost_usd), 0) as total from spend_ledger sl
        where sl.user_id = $2
          and (
            sl.job_id in (select id from jobs where campaign_id = $1)
            or sl.article_id in (select id from articles where campaign_id = $1)
            or sl.image_post_id in (select id from image_posts where campaign_id = $1)
          )
        """,
        campaign_id, user_id,
    )
    return Decimal(row["total"])


async def work_counts(campaign_id: UUID, *, user_id: str) -> dict:
    """Videos/articles produced under this campaign (total + last 7 days
    per niche, for cadence decisions)."""
    pool = await get_pool()
    videos = await pool.fetch(
        """
        select niche_id, count(*) as total,
               count(*) filter (where created_at > now() - interval '7 days') as last7,
               max(created_at) as last_at
        from jobs where campaign_id = $1 and user_id = $2
        group by niche_id
        """,
        campaign_id, user_id,
    )
    articles = await pool.fetch(
        """
        select niche_id, count(*) as total,
               count(*) filter (where created_at > now() - interval '7 days') as last7,
               max(created_at) as last_at
        from articles where campaign_id = $1 and user_id = $2
        group by niche_id
        """,
        campaign_id, user_id,
    )
    images = await pool.fetch(
        """
        select niche_id, count(*) as total,
               count(*) filter (where created_at > now() - interval '7 days') as last7,
               max(created_at) as last_at
        from image_posts where campaign_id = $1 and user_id = $2
        group by niche_id
        """,
        campaign_id, user_id,
    )
    return {
        "image": {
            r["niche_id"]: {"total": r["total"], "last7": r["last7"], "last_at": r["last_at"]}
            for r in images
        },
        "video": {
            r["niche_id"]: {"total": r["total"], "last7": r["last7"], "last_at": r["last_at"]}
            for r in videos
        },
        "article": {
            r["niche_id"]: {"total": r["total"], "last7": r["last7"], "last_at": r["last_at"]}
            for r in articles
        },
    }
