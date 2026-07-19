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


# Column-name fragments whose values must never leave the system, even in a
# data-portability export (hashes/secrets are not the user's data to receive
# and are security-sensitive). Matched as substrings, case-insensitive.
_SENSITIVE_COL_FRAGMENTS = ("token_hash", "secret", "password", "_hash", "signing")


def _is_sensitive(col: str) -> bool:
    c = col.lower()
    return any(frag in c for frag in _SENSITIVE_COL_FRAGMENTS)


def _scrub(d: dict) -> dict:
    return {k: _json_safe(v) for k, v in d.items() if not _is_sensitive(k)}


async def export_user(user_id: str) -> dict[str, Any]:
    """Full data-portability export: the user row plus every row in every
    per-user table. Tables are discovered dynamically (any public table with
    a ``user_id`` column), so new per-user tables are covered automatically
    instead of relying on a hand-maintained list that silently rots. Sensitive
    columns (token hashes, signing secrets) are scrubbed."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow("select * from users where id = $1", user_id)
        if user is None:
            return {}
        tables = await conn.fetch(
            """
            select table_name from information_schema.columns
             where table_schema = 'public' and column_name = 'user_id'
             order by table_name
            """
        )
        per_table: dict[str, Any] = {}
        for t in tables:
            name = t["table_name"]
            # Table name comes from the catalog (not user input); quote defensively.
            rs = await conn.fetch(
                f'select * from "{name}" where user_id = $1', user_id
            )
            per_table[name] = [_scrub(dict(r)) for r in rs]

    return {
        "exported_at": None,  # stamped by the route (Date unavailable in some contexts)
        "user": _scrub(dict(user)),
        **per_table,
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
