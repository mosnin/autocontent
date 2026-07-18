"""Competitor tracking + performance alerts data layer (Team Competitors).

Two families of rows, both owned by this module:

  * competitors / competitor_articles — the domains a user watches and the
    diffed feed of pages `services.competitor_watch.run()` has already seen
    for each one.
  * performance_alerts — the flat alert inbox both `competitor_watch`
    (kind=competitor_activity) and `alert_scan` (kind in ranking_drop /
    cadence_slip / quality_drop) write into. Read via GET /alerts,
    dismissed via POST /alerts/{id}/ack.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from ..db import get_pool


class Competitor(BaseModel):
    id: UUID
    user_id: str
    niche_id: UUID | None
    domain: str
    label: str
    created_at: datetime


class CompetitorArticle(BaseModel):
    id: UUID
    competitor_id: UUID
    url: str
    title: str
    published_hint: str
    first_seen: datetime


class PerformanceAlert(BaseModel):
    id: UUID
    user_id: str
    kind: str
    severity: str
    message: str
    context: dict
    created_at: datetime
    acknowledged_at: datetime | None


_COMPETITOR_COLS = "id, user_id, niche_id, domain, label, created_at"
_ARTICLE_COLS = "id, competitor_id, url, title, published_hint, first_seen"
_ALERT_COLS = "id, user_id, kind, severity, message, context, created_at, acknowledged_at"


def _alert_row(row) -> PerformanceAlert:
    d = dict(row)
    ctx = d.get("context")
    if isinstance(ctx, str):
        import json

        d["context"] = json.loads(ctx) if ctx else {}
    return PerformanceAlert(**d)


# ---------------------------------------------------------------------------
# competitors
# ---------------------------------------------------------------------------


async def create(
    *, user_id: str, domain: str, label: str = "", niche_id: UUID | None = None
) -> Competitor:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into competitors (user_id, domain, label, niche_id)
        values ($1, $2, $3, $4)
        returning {_COMPETITOR_COLS}
        """,
        user_id, domain, label, niche_id,
    )
    return Competitor(**dict(row))


async def list_for_user(user_id: str) -> list[Competitor]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"select {_COMPETITOR_COLS} from competitors where user_id = $1 order by created_at desc",
        user_id,
    )
    return [Competitor(**dict(r)) for r in rows]


async def get(competitor_id: UUID, *, user_id: str) -> Competitor | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_COMPETITOR_COLS} from competitors where id = $1 and user_id = $2",
        competitor_id, user_id,
    )
    return Competitor(**dict(row)) if row else None


async def delete(competitor_id: UUID, *, user_id: str) -> bool:
    pool = await get_pool()
    result = await pool.execute(
        "delete from competitors where id = $1 and user_id = $2",
        competitor_id, user_id,
    )
    return result.split()[-1] != "0"


async def list_active() -> list[Competitor]:
    """Every tracked competitor across every user — the scan surface for
    `services.competitor_watch.run()`. Small/cheap: one row per tracked
    domain, no per-user pagination needed at this scale."""
    pool = await get_pool()
    rows = await pool.fetch(f"select {_COMPETITOR_COLS} from competitors order by user_id")
    return [Competitor(**dict(r)) for r in rows]


# ---------------------------------------------------------------------------
# competitor_articles
# ---------------------------------------------------------------------------


async def list_articles(competitor_id: UUID, *, user_id: str, limit: int = 100) -> list[CompetitorArticle]:
    """Ownership-scoped: joins back to competitors so a foreign user's
    competitor_id can't be probed for another account's finds."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select ca.id, ca.competitor_id, ca.url, ca.title, ca.published_hint, ca.first_seen
          from competitor_articles ca
          join competitors c on c.id = ca.competitor_id
         where ca.competitor_id = $1 and c.user_id = $2
         order by ca.first_seen desc
         limit $3
        """,
        competitor_id, user_id, limit,
    )
    return [CompetitorArticle(**dict(r)) for r in rows]


async def seen_urls(competitor_id: UUID, urls: list[str]) -> set[str]:
    """Which of `urls` are already recorded for this competitor — the diff
    step competitor_watch uses to figure out what's new."""
    if not urls:
        return set()
    pool = await get_pool()
    rows = await pool.fetch(
        "select url from competitor_articles where competitor_id = $1 and url = any($2::text[])",
        competitor_id, urls,
    )
    return {r["url"] for r in rows}


async def insert_articles(
    competitor_id: UUID, articles: list[dict]
) -> list[CompetitorArticle]:
    """Bulk-insert new finds for a competitor. Each dict needs url, and may
    carry title/published_hint. Idempotent: a (competitor_id, url) already
    on file is skipped rather than erroring, since a scan can legitimately
    re-see a URL it raced with another scan to insert."""
    if not articles:
        return []
    pool = await get_pool()
    out: list[CompetitorArticle] = []
    async with pool.acquire() as conn, conn.transaction():
        for a in articles:
            row = await conn.fetchrow(
                f"""
                insert into competitor_articles (competitor_id, url, title, published_hint)
                values ($1, $2, $3, $4)
                on conflict (competitor_id, url) do nothing
                returning {_ARTICLE_COLS}
                """,
                competitor_id, a["url"], a.get("title", ""), a.get("published_hint", ""),
            )
            if row is not None:
                out.append(CompetitorArticle(**dict(row)))
    return out


# ---------------------------------------------------------------------------
# performance_alerts
# ---------------------------------------------------------------------------


async def create_alert(
    *, user_id: str, kind: str, severity: str, message: str, context: dict | None = None
) -> PerformanceAlert:
    import json

    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into performance_alerts (user_id, kind, severity, message, context)
        values ($1, $2, $3, $4, $5::jsonb)
        returning {_ALERT_COLS}
        """,
        user_id, kind, severity, message, json.dumps(context or {}),
    )
    return _alert_row(row)


async def has_unacknowledged(user_id: str, *, kind: str, message: str) -> bool:
    """Dedupe check: is there already an unacknowledged alert of this kind
    with this exact message for this user? Used by both alert_scan and
    competitor_watch so a recurring condition doesn't spam a fresh row
    every scan — it re-raises only once acknowledged (or the message text
    changes, e.g. a fresh competitor URL)."""
    pool = await get_pool()
    val = await pool.fetchval(
        """
        select exists(
            select 1 from performance_alerts
             where user_id = $1 and kind = $2 and message = $3
               and acknowledged_at is null
        )
        """,
        user_id, kind, message,
    )
    return bool(val)


async def list_alerts_for_user(
    user_id: str, *, acknowledged: bool | None = None, limit: int = 200
) -> list[PerformanceAlert]:
    pool = await get_pool()
    if acknowledged is None:
        rows = await pool.fetch(
            f"""
            select {_ALERT_COLS} from performance_alerts
             where user_id = $1
             order by created_at desc
             limit $2
            """,
            user_id, limit,
        )
    elif acknowledged:
        rows = await pool.fetch(
            f"""
            select {_ALERT_COLS} from performance_alerts
             where user_id = $1 and acknowledged_at is not null
             order by created_at desc
             limit $2
            """,
            user_id, limit,
        )
    else:
        rows = await pool.fetch(
            f"""
            select {_ALERT_COLS} from performance_alerts
             where user_id = $1 and acknowledged_at is null
             order by created_at desc
             limit $2
            """,
            user_id, limit,
        )
    return [_alert_row(r) for r in rows]


async def acknowledge(alert_id: UUID, *, user_id: str) -> PerformanceAlert | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update performance_alerts
           set acknowledged_at = now()
         where id = $1 and user_id = $2 and acknowledged_at is null
        returning {_ALERT_COLS}
        """,
        alert_id, user_id,
    )
    return _alert_row(row) if row else None


# ---------------------------------------------------------------------------
# read-only helpers for alert_scan (niches/articles are owned by other
# modules; these are narrow, direct queries rather than importing those
# repos' write surfaces)
# ---------------------------------------------------------------------------


async def niches_with_cadence() -> list[dict]:
    """Niches with a nonzero weekly article cadence — the cadence_slip scan
    surface. Mirrors services.scheduler._due_niches' direct-query shape
    (owned by another team's file, so re-implemented here rather than
    imported)."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select id, user_id, title, articles_per_week
          from niches
         where articles_per_week > 0 and archived_at is null
        """
    )
    return [dict(r) for r in rows]


async def all_niches_for_focus_match() -> list[dict]:
    """Every active niche's title/description/hashtags — the read-only
    corpus competitor_watch compares a newly-found competitor article's
    title against to decide whether it touches one of the user's focus
    areas."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select id, user_id, title, description, hashtags
          from niches
         where archived_at is null
        """
    )
    return [dict(r) for r in rows]


async def latest_article_days_since(niche_id: UUID) -> float | None:
    """Days since the niche's most recently created (non-failed) article,
    or None if it has never produced one."""
    pool = await get_pool()
    val = await pool.fetchval(
        """
        select extract(epoch from (now() - max(created_at))) / 86400.0
          from articles
         where niche_id = $1 and status != 'failed'
        """,
        niche_id,
    )
    return float(val) if val is not None else None


async def quality_scores_for_user(user_id: str, *, limit: int = 30) -> list[dict]:
    """The user's most recent scored articles (newest first): id, niche_id,
    created_at, and the QualityScore's `overall` field. Rows without a
    quality snapshot yet are excluded. Backs alert_scan's quality_drop
    rule (latest vs. trailing average)."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select id, niche_id, created_at, (quality->>'overall')::float as overall
          from articles
         where user_id = $1 and quality is not null
         order by created_at desc
         limit $2
        """,
        user_id, limit,
    )
    return [dict(r) for r in rows]


async def distinct_users_with_scored_articles() -> list[str]:
    """Every user_id with at least one quality-scored article — the scan
    surface for alert_scan's quality_drop pass."""
    pool = await get_pool()
    rows = await pool.fetch(
        "select distinct user_id from articles where quality is not null"
    )
    return [r["user_id"] for r in rows]


async def gsc_daily_exists() -> bool:
    """True once Team GSC's gsc_daily table exists. Guards ranking_drop:
    that table belongs to another team shipping concurrently, so we probe
    for it via to_regclass rather than importing their code (which may not
    exist yet, or may still be mid-migration)."""
    pool = await get_pool()
    val = await pool.fetchval("select to_regclass('public.gsc_daily')")
    return val is not None


async def distinct_gsc_users() -> list[str]:
    """Every user_id with rows in gsc_daily. Callers must confirm
    `gsc_daily_exists()` first — this queries the table directly and would
    error if it's absent."""
    pool = await get_pool()
    rows = await pool.fetch("select distinct user_id from gsc_daily")
    return [r["user_id"] for r in rows]


async def ranking_drops_for_user(user_id: str) -> list[dict]:
    """Top queries whose average position worsened by >5 week-over-week,
    comparing the last 7 days of gsc_daily against the prior 7. Only
    called after `gsc_daily_exists()` confirms the table is present.
    Aggregated in SQL (avg position per query per window) rather than
    pulled row-by-row, since gsc_daily can be large."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        with recent as (
            select query, avg(position) as pos, sum(clicks) as clicks
              from gsc_daily
             where user_id = $1 and date >= current_date - interval '7 days'
             group by query
        ),
        prior as (
            select query, avg(position) as pos
              from gsc_daily
             where user_id = $1
               and date >= current_date - interval '14 days'
               and date <  current_date - interval '7 days'
             group by query
        )
        select r.query, p.pos as prior_position, r.pos as current_position, r.clicks
          from recent r
          join prior p on p.query = r.query
         where r.pos - p.pos > 5
         order by (r.pos - p.pos) desc
        """,
        user_id,
    )
    return [dict(r) for r in rows]
