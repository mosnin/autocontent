"""GDPR / data-portability + erasure (SOC2 privacy controls).

`export_user` returns everything we hold about a user in one JSON-able
dict (data portability). `erase_user` deletes the user row; every
per-user table FK-cascades from users(id) on delete, so this is a full
right-to-erasure. Both are self-service (the account owner) and, for
admins acting on another user, audited by the caller.
"""
from __future__ import annotations

from typing import Any

from ..db import get_pool


async def export_user(user_id: str) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow("select * from users where id = $1", user_id)
        if user is None:
            return {}
        niches = await conn.fetch("select * from niches where user_id = $1", user_id)
        jobs = await conn.fetch(
            "select id, niche_id, status, platform, scheduled_for, provider_post_id, "
            "created_at from jobs where user_id = $1 order by created_at", user_id,
        )
        articles = await conn.fetch(
            "select id, niche_id, status, topic, title, slug, word_count, "
            "created_at from articles where user_id = $1 order by created_at", user_id,
        )
        spend = await conn.fetch(
            "select provider, sku, units, cost_usd, created_at from spend_ledger "
            "where user_id = $1 order by created_at", user_id,
        )
        tokens = await conn.fetch(
            "select prefix, name, created_at, expires_at, revoked_at "
            "from personal_access_tokens where user_id = $1", user_id,
        )

    def rows(rs):
        return [{k: _json_safe(v) for k, v in dict(r).items()} for r in rs]

    return {
        "exported_at": None,  # stamped by the route (Date unavailable in some contexts)
        "user": {k: _json_safe(v) for k, v in dict(user).items()},
        "niches": rows(niches),
        "jobs": rows(jobs),
        "articles": rows(articles),
        "spend_ledger": rows(spend),
        "personal_access_tokens": rows(tokens),  # prefixes only, never the secret
    }


async def erase_user(user_id: str) -> bool:
    """Delete the user and (via FK cascade) all their data. Returns True if a
    row was deleted."""
    pool = await get_pool()
    result = await pool.execute("delete from users where id = $1", user_id)
    return result.split()[-1] == "1"


def _json_safe(v: Any) -> Any:
    from datetime import date, datetime
    from decimal import Decimal
    from uuid import UUID

    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, UUID):
        return str(v)
    return v
