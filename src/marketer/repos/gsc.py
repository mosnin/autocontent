"""GSC data layer: the OAuth connection (one per user) and the gsc_daily
Search Analytics rows synced hourly by ``services/gsc_sync``. Every function
is user_id-scoped — no cross-tenant reads. See db/migrations/0019_gsc.sql.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel

from ..db import get_pool


class GscConnection(BaseModel):
    id: UUID
    user_id: str
    site_url: str = ""
    refresh_token: str = ""
    access_token: str = ""
    token_expires_at: datetime | None = None
    connected_at: datetime


_CONN_COLS = (
    "id, user_id, site_url, refresh_token, access_token, token_expires_at, "
    "connected_at"
)


# --------------------------------------------------------------------------- connections

async def upsert_connection(
    *,
    user_id: str,
    refresh_token: str,
    access_token: str,
    token_expires_at: datetime | None,
) -> GscConnection:
    """Create the user's connection, or replace its tokens if one already
    exists (one connection per user; re-connecting refreshes credentials
    without disturbing the previously-chosen site_url)."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into gsc_connections (user_id, refresh_token, access_token, token_expires_at)
        values ($1, $2, $3, $4)
        on conflict (user_id) do update set
            refresh_token = excluded.refresh_token,
            access_token = excluded.access_token,
            token_expires_at = excluded.token_expires_at
        returning {_CONN_COLS}
        """,
        user_id, refresh_token, access_token, token_expires_at,
    )
    return GscConnection(**dict(row))


async def get_connection(user_id: str) -> GscConnection | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_CONN_COLS} from gsc_connections where user_id = $1", user_id
    )
    return GscConnection(**dict(row)) if row else None


async def set_site(user_id: str, *, site_url: str) -> GscConnection | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"update gsc_connections set site_url = $2 where user_id = $1 "
        f"returning {_CONN_COLS}",
        user_id, site_url,
    )
    return GscConnection(**dict(row)) if row else None


async def set_tokens(
    user_id: str,
    *,
    access_token: str,
    token_expires_at: datetime | None,
    refresh_token: str = "",
) -> None:
    """Update the cached access token (post-refresh). *refresh_token* is
    only written when Google actually issued a new one — the common case is
    an empty string, meaning "leave the existing refresh_token alone"."""
    pool = await get_pool()
    if refresh_token:
        await pool.execute(
            "update gsc_connections set access_token = $2, token_expires_at = $3, "
            "refresh_token = $4 where user_id = $1",
            user_id, access_token, token_expires_at, refresh_token,
        )
    else:
        await pool.execute(
            "update gsc_connections set access_token = $2, token_expires_at = $3 "
            "where user_id = $1",
            user_id, access_token, token_expires_at,
        )


async def delete_connection(user_id: str) -> bool:
    pool = await get_pool()
    result = await pool.execute("delete from gsc_connections where user_id = $1", user_id)
    return result.endswith(" 1")


async def list_all_connections() -> list[GscConnection]:
    """Every connection — the fan-out set for the hourly sync cron."""
    pool = await get_pool()
    rows = await pool.fetch(f"select {_CONN_COLS} from gsc_connections")
    return [GscConnection(**dict(r)) for r in rows]


# --------------------------------------------------------------------------- gsc_daily

async def upsert_daily(user_id: str, rows: list[dict]) -> int:
    """Upsert a batch of Search Analytics rows (each a dict with date,
    query, page, clicks, impressions, ctr, position) for a user. Returns the
    count written; a no-op (no round trip) on an empty batch."""
    if not rows:
        return 0
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        for r in rows:
            await conn.execute(
                """
                insert into gsc_daily (user_id, date, query, page, clicks, impressions, ctr, position)
                values ($1, $2, $3, $4, $5, $6, $7, $8)
                on conflict (user_id, date, query, page) do update set
                    clicks = excluded.clicks,
                    impressions = excluded.impressions,
                    ctr = excluded.ctr,
                    position = excluded.position
                """,
                user_id, r["date"], r.get("query", ""), r.get("page", ""),
                int(r.get("clicks") or 0), int(r.get("impressions") or 0),
                r.get("ctr") or 0, r.get("position") or 0,
            )
    return len(rows)


_POS_AVG = (
    "case when sum(impressions) > 0 "
    "then sum(position * impressions) / sum(impressions) else 0 end"
)
_CTR_AVG = (
    "case when sum(impressions) > 0 "
    "then sum(clicks)::numeric / sum(impressions) else 0 end"
)


async def top_queries(
    user_id: str, *, start: date, end: date, limit: int = 50
) -> list[dict]:
    """Per-query totals over ``[start, end]`` (inclusive), ordered by clicks
    desc — the current-period side of GET /rankings."""
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select query,
               sum(clicks) as clicks,
               sum(impressions) as impressions,
               {_CTR_AVG} as ctr,
               {_POS_AVG} as position
          from gsc_daily
         where user_id = $1 and date >= $2 and date <= $3
         group by query
         order by clicks desc
         limit $4
        """,
        user_id, start, end, limit,
    )
    return [dict(r) for r in rows]


async def positions_for_queries(
    user_id: str, queries: list[str], *, start: date, end: date
) -> dict[str, Decimal]:
    """Impression-weighted average position per query over a window — used
    to compute the prior-period comparison in GET /rankings. Missing
    queries (no data in the window) are simply absent from the result."""
    if not queries:
        return {}
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select query, {_POS_AVG} as position
          from gsc_daily
         where user_id = $1 and date >= $2 and date <= $3 and query = any($4::text[])
         group by query
        """,
        user_id, start, end, queries,
    )
    return {r["query"]: r["position"] for r in rows}


async def queries_for_page(
    user_id: str, *, page: str, start: date, end: date, limit: int = 100
) -> list[dict]:
    """Per-query totals for a single page over ``[start, end]`` — GET
    /queries?page=."""
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select query,
               sum(clicks) as clicks,
               sum(impressions) as impressions,
               {_CTR_AVG} as ctr,
               {_POS_AVG} as position
          from gsc_daily
         where user_id = $1 and page = $2 and date >= $3 and date <= $4
         group by query
         order by clicks desc
         limit $5
        """,
        user_id, page, start, end, limit,
    )
    return [dict(r) for r in rows]


async def gap_candidates(
    user_id: str,
    *,
    start: date,
    end: date,
    min_impressions: int = 20,
    min_position: float = 20.0,
    limit: int = 200,
) -> list[dict]:
    """(query, page) pairs with meaningful impressions but a poor average
    position over ``[start, end]`` — the raw candidate set for GET /gaps
    before the read-only articles join (also done here) filters out queries
    an existing article already targets."""
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select query, page,
               sum(clicks) as clicks,
               sum(impressions) as impressions,
               {_POS_AVG} as position
          from gsc_daily
         where user_id = $1 and date >= $2 and date <= $3
         group by query, page
        having sum(impressions) >= $4 and ({_POS_AVG}) > $5
         order by impressions desc
         limit $6
        """,
        user_id, start, end, min_impressions, min_position, limit,
    )
    return [dict(r) for r in rows]


async def article_terms(user_id: str) -> list[tuple[str, str]]:
    """Read-only pull of every article's (title, focus_keyword) for a user —
    the join target GET /gaps uses to tell "no article covers this query"
    apart from "an article already covers it but under-performs". Lives here
    (not repos/articles.py) since gsc.py owns this join."""
    pool = await get_pool()
    rows = await pool.fetch(
        "select coalesce(title, '') as title, coalesce(focus_keyword, '') as focus_keyword "
        "from articles where user_id = $1",
        user_id,
    )
    return [(r["title"], r["focus_keyword"]) for r in rows]
