"""Repository for post_metrics rows.

Each daily ingestion writes a NEW row — callers can chart "metric over
time" for a single post, while the job-detail page reads the most-recent
sample and the niche performance page aggregates across jobs.
"""
from __future__ import annotations

import json
from decimal import Decimal
from uuid import UUID

from ..db import get_pool
from ..models import PostMetrics


async def record(metrics: PostMetrics) -> PostMetrics:
    """Insert one post_metrics sample. Returns the model as-stored."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into post_metrics
            (id, user_id, job_id, provider_post_id, platform, sampled_at,
             views, likes, comments, shares, saves,
             watch_time_sec, avg_watch_time_sec, completion_rate,
             reach, impressions, raw, created_at)
        values
            ($1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10, $11,
             $12, $13, $14,
             $15, $16, $17::jsonb, $18)
        returning *
        """,
        metrics.id,
        metrics.user_id,
        metrics.job_id,
        metrics.provider_post_id,
        metrics.platform,
        metrics.sampled_at,
        metrics.views,
        metrics.likes,
        metrics.comments,
        metrics.shares,
        metrics.saves,
        metrics.watch_time_sec,
        metrics.avg_watch_time_sec,
        metrics.completion_rate,
        metrics.reach,
        metrics.impressions,
        json.dumps(metrics.raw),
        metrics.created_at,
    )
    return _row_to_model(row)


async def latest_for_job(job_id: UUID, *, user_id: str) -> PostMetrics | None:
    """Return the most-recent sample for a job, or None if none exist."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select *
          from post_metrics
         where job_id = $1 and user_id = $2
         order by sampled_at desc
         limit 1
        """,
        job_id, user_id,
    )
    return _row_to_model(row) if row else None


async def list_for_job(
    job_id: UUID, *, user_id: str, limit: int = 30
) -> list[PostMetrics]:
    """Return the time series of samples for a job (newest first)."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select *
          from post_metrics
         where job_id = $1 and user_id = $2
         order by sampled_at desc
         limit $3
        """,
        job_id, user_id, limit,
    )
    return [_row_to_model(r) for r in rows]


async def list_for_niche(
    niche_id: UUID, *, user_id: str, days: int = 30
) -> list[PostMetrics]:
    """Return the latest sample per job for jobs in *niche_id* within the
    last *days* days.  Uses DISTINCT ON so each job_id appears exactly once.

    This is the cornerstone query for attribution (D2) and ideation
    feedback (D3).
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        with latest as (
            select distinct on (pm.job_id) pm.*
              from post_metrics pm
              join jobs j on j.id = pm.job_id
             where j.niche_id = $1
               and pm.user_id = $2
               and pm.sampled_at >= now() - ($3 || ' days')::interval
             order by pm.job_id, pm.sampled_at desc
        )
        select * from latest order by sampled_at desc
        """,
        niche_id, user_id, str(days),
    )
    return [_row_to_model(r) for r in rows]


# ---------------------------------------------------------------------------
# Performance-attribution queries (D2)
# ---------------------------------------------------------------------------

async def top_performers_for_niche(
    niche_id: UUID,
    *,
    user_id: str,
    limit: int = 5,
    days: int = 30,
) -> list[tuple[UUID, int]]:
    """Return [(job_id, views), ...] for the top N jobs by views in window.

    Joins post_metrics against jobs to scope by niche and user.  Jobs with
    no view data are skipped (NULLS LAST with a NOT NULL filter).
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select pm.job_id, pm.views
          from post_metrics pm
          join jobs j on j.id = pm.job_id
         where j.niche_id = $1
           and j.user_id = $2
           and pm.views is not null
           and pm.sampled_at >= now() - ($3 || ' days')::interval
         order by pm.views desc nulls last
         limit $4
        """,
        niche_id,
        user_id,
        str(days),
        limit,
    )
    return [(r["job_id"], r["views"]) for r in rows]


async def bottom_performers_for_niche(
    niche_id: UUID,
    *,
    user_id: str,
    limit: int = 5,
    days: int = 30,
) -> list[tuple[UUID, int]]:
    """Return [(job_id, views), ...] for the bottom N jobs by views in window.

    Identical to ``top_performers_for_niche`` but ordered ascending.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select pm.job_id, pm.views
          from post_metrics pm
          join jobs j on j.id = pm.job_id
         where j.niche_id = $1
           and j.user_id = $2
           and pm.views is not null
           and pm.sampled_at >= now() - ($3 || ' days')::interval
         order by pm.views asc nulls last
         limit $4
        """,
        niche_id,
        user_id,
        str(days),
        limit,
    )
    return [(r["job_id"], r["views"]) for r in rows]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _row_to_model(row) -> PostMetrics:
    raw_value = row["raw"]
    # asyncpg returns jsonb columns as dicts already; handle both cases
    if isinstance(raw_value, str):
        raw_value = json.loads(raw_value)

    def _dec(v) -> Decimal | None:
        return Decimal(str(v)) if v is not None else None

    return PostMetrics(
        id=row["id"],
        user_id=row["user_id"],
        job_id=row["job_id"],
        provider_post_id=row["provider_post_id"],
        platform=row["platform"],
        sampled_at=row["sampled_at"],
        views=row["views"],
        likes=row["likes"],
        comments=row["comments"],
        shares=row["shares"],
        saves=row["saves"],
        watch_time_sec=_dec(row["watch_time_sec"]),
        avg_watch_time_sec=_dec(row["avg_watch_time_sec"]),
        completion_rate=_dec(row["completion_rate"]),
        reach=row["reach"],
        impressions=row["impressions"],
        raw=raw_value,
        created_at=row["created_at"],
    )


async def account_summary(user_id: str, *, days: int = 30) -> dict:
    """Account-wide payoff numbers: total views across the latest sample of
    every video in the window, the count of sampled videos, and the single
    best (job_id, views). Powers the dashboard 'views earned' banner."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        with latest as (
            select distinct on (pm.job_id) pm.job_id, pm.views
              from post_metrics pm
             where pm.user_id = $1
               and pm.sampled_at >= now() - ($2 || ' days')::interval
             order by pm.job_id, pm.sampled_at desc
        )
        select
            coalesce(sum(views), 0)::bigint as total_views,
            count(*) filter (where views is not null)::int as sampled_videos
          from latest
        """,
        user_id, str(days),
    )
    best = await pool.fetchrow(
        """
        with latest as (
            select distinct on (pm.job_id) pm.job_id, pm.views
              from post_metrics pm
             where pm.user_id = $1
               and pm.sampled_at >= now() - ($2 || ' days')::interval
               and pm.views is not null
             order by pm.job_id, pm.sampled_at desc
        )
        select job_id, views from latest order by views desc limit 1
        """,
        user_id, str(days),
    )
    return {
        "total_views": int(row["total_views"]) if row else 0,
        "sampled_videos": int(row["sampled_videos"]) if row else 0,
        "best_job_id": str(best["job_id"]) if best else None,
        "best_views": int(best["views"]) if best else None,
        "days": days,
    }
