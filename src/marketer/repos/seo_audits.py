"""SEO audit rows. `result` jsonb carries the whole AuditResult blob;
rows are returned as plain dicts with `result` already decoded."""
from __future__ import annotations

import json
from decimal import Decimal
from uuid import UUID

from ..db import get_pool

_SUMMARY_COLS = "id, user_id, url, host, score, band, schema_version, created_at"


def _row(row) -> dict:
    d = dict(row)
    if isinstance(d.get("result"), str):
        d["result"] = json.loads(d["result"])
    if isinstance(d.get("score"), Decimal):
        d["score"] = float(d["score"])
    return d


async def create(
    *,
    user_id: str,
    url: str,
    host: str,
    cache_key: str,
    schema_version: str,
    score: float,
    band: str,
    result: dict,
) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into seo_audits
            (user_id, url, host, cache_key, schema_version, score, band, result)
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        returning {_SUMMARY_COLS}, result
        """,
        user_id, url, host, cache_key, schema_version, Decimal(str(score)), band,
        json.dumps(result),
    )
    return _row(row)


async def find_fresh(
    *, user_id: str, cache_key: str, max_age_sec: int
) -> dict | None:
    """Newest stored audit for this (user, cache key) younger than the TTL.

    Scoped to the user on purpose: an audit row is a tenant artifact, so a
    shared cache would hand out another tenant's row id and audit history.
    """
    if max_age_sec <= 0:
        return None
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        select {_SUMMARY_COLS}, result
          from seo_audits
         where user_id = $1
           and cache_key = $2
           and created_at > now() - ($3::double precision * interval '1 second')
         order by created_at desc
         limit 1
        """,
        user_id, cache_key, float(max_age_sec),
    )
    return _row(row) if row else None


async def get(audit_id: UUID, *, user_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_SUMMARY_COLS}, result from seo_audits where id = $1 and user_id = $2",
        audit_id, user_id,
    )
    return _row(row) if row else None


async def list_for_user(user_id: str, *, limit: int = 50) -> list[dict]:
    """Recent audits, summary columns only — the list view never needs the
    multi-hundred-KB result blob."""
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_SUMMARY_COLS} from seo_audits
        where user_id = $1
        order by created_at desc limit $2
        """,
        user_id, limit,
    )
    return [_row(r) for r in rows]


async def delete(audit_id: UUID, *, user_id: str) -> bool:
    pool = await get_pool()
    row = await pool.fetchrow(
        "delete from seo_audits where id = $1 and user_id = $2 returning id",
        audit_id, user_id,
    )
    return row is not None
