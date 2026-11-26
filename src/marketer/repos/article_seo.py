"""SEO-article fields on ``articles`` (0035): research, metadata, cover and
WordPress publishing state. Kept apart from ``repos/articles.save`` so a
pipeline stage saving the article never overwrites a person's edits or a
publish in flight."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from ..articles.models import Article
from ..db import get_pool
from .articles import _COLS, _row_to_model

# A new publish may start from these states. 'publishing' (in flight) and
# 'unknown' (sent, no answer: a person resolves it in the inbox) may not.
PUBLISHABLE_FROM = ("none", "scheduled", "failed", "needs_review", "published")


async def set_research(article_id: UUID, *, user_id: str, research: dict[str, Any] | None) -> None:
    pool = await get_pool()
    await pool.execute(
        "update articles set research = $3::jsonb where id = $1 and user_id = $2",
        article_id, user_id, json.dumps(research, default=str) if research is not None else None,
    )


async def set_seo_meta(
    article_id: UUID, *, user_id: str, meta_title: str, meta_description: str, slug: str,
    focus_keyword: str, secondary_keywords: list[str],
) -> Article | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update articles
           set meta_title = $3, meta_description = $4, slug = $5,
               focus_keyword = $6, keywords = $7
         where id = $1 and user_id = $2
        returning {_COLS}
        """,
        article_id, user_id, meta_title, meta_description, slug, focus_keyword, secondary_keywords,
    )
    return _row_to_model(row) if row else None


async def set_cover(article_id: UUID, *, user_id: str, cover: dict[str, Any] | None) -> Article | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update articles set cover_image = $3::jsonb
         where id = $1 and user_id = $2
        returning {_COLS}
        """,
        article_id, user_id, json.dumps(cover) if cover is not None else None,
    )
    return _row_to_model(row) if row else None


async def schedule(
    article_id: UUID, *, user_id: str, mode: str, publish_at: datetime, args_hash: str,
) -> Article | None:
    """Park a live publish for ``publish_at``, bound to ``args_hash``."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update articles
           set publish_status = 'scheduled', publish_mode = $3, publish_at = $4,
               publish_args_hash = $5, publish_error = null
         where id = $1 and user_id = $2 and publish_status = any($6::text[])
        returning {_COLS}
        """,
        article_id, user_id, mode, publish_at, args_hash, list(PUBLISHABLE_FROM),
    )
    return _row_to_model(row) if row else None


async def reschedule(article_id: UUID, *, user_id: str, publish_at: datetime) -> Article | None:
    """Move a scheduled publish (the calendar's drag). Only while scheduled."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update articles set publish_at = $3
         where id = $1 and user_id = $2 and publish_status = 'scheduled'
        returning {_COLS}
        """,
        article_id, user_id, publish_at,
    )
    return _row_to_model(row) if row else None


async def unschedule(article_id: UUID, *, user_id: str) -> Article | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update articles
           set publish_status = case when wp_post_id is null then 'none' else 'published' end,
               publish_at = null, publish_args_hash = null
         where id = $1 and user_id = $2 and publish_status = 'scheduled'
        returning {_COLS}
        """,
        article_id, user_id,
    )
    return _row_to_model(row) if row else None


async def scheduled_args_hash(article_id: UUID, *, user_id: str) -> str | None:
    pool = await get_pool()
    return await pool.fetchval(
        "select publish_args_hash from articles where id = $1 and user_id = $2", article_id, user_id,
    )


async def claim_publish(article_id: UUID, *, user_id: str, mode: str, from_scheduled_only: bool = False) -> Article | None:
    """Atomic claim: exactly one caller moves the article to 'publishing'."""
    allowed = ["scheduled"] if from_scheduled_only else list(PUBLISHABLE_FROM)
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update articles
           set publish_status = 'publishing', publish_mode = $3, publish_error = null
         where id = $1 and user_id = $2 and publish_status = any($4::text[])
        returning {_COLS}
        """,
        article_id, user_id, mode, allowed,
    )
    return _row_to_model(row) if row else None


async def finish_publish(
    article_id: UUID, *, user_id: str, status: str, wp_post_id: int | None = None,
    wp_post_url: str | None = None, error: str | None = None, published: bool = False,
) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        update articles
           set publish_status = $3,
               wp_post_id = coalesce($4, wp_post_id),
               wp_post_url = coalesce($5, wp_post_url),
               publish_error = $6,
               published_at = case when $7 then now() else published_at end,
               publish_args_hash = case when $3 in ('published', 'none') then null else publish_args_hash end,
               publish_at = case when $3 = 'published' then coalesce(publish_at, now()) else publish_at end
         where id = $1 and user_id = $2
        """,
        article_id, user_id, status, wp_post_id, wp_post_url, (error or None) and error[:1000], published,
    )


async def due_scheduled(now: datetime, *, limit: int = 50) -> list[tuple[UUID, str]]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select id, user_id from articles
         where publish_status = 'scheduled' and publish_at <= $1
         order by publish_at
         limit $2
        """,
        now, limit,
    )
    return [(r["id"], r["user_id"]) for r in rows]
