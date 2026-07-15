"""Admin-managed feature flags (global on/off + optional description)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from ..db import get_pool


class FeatureFlag(BaseModel):
    key: str
    enabled: bool
    description: str
    updated_by: str | None
    updated_at: datetime
    created_at: datetime


async def list_all() -> list[FeatureFlag]:
    pool = await get_pool()
    rows = await pool.fetch(
        "select key, enabled, description, updated_by, updated_at, created_at "
        "from feature_flags order by key"
    )
    return [FeatureFlag(**dict(r)) for r in rows]


async def is_enabled(key: str) -> bool:
    pool = await get_pool()
    val = await pool.fetchval("select enabled from feature_flags where key = $1", key)
    return bool(val)


async def upsert(key: str, *, enabled: bool, description: str, updated_by: str) -> FeatureFlag:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into feature_flags (key, enabled, description, updated_by)
        values ($1, $2, $3, $4)
        on conflict (key) do update
            set enabled = excluded.enabled,
                description = excluded.description,
                updated_by = excluded.updated_by
        returning key, enabled, description, updated_by, updated_at, created_at
        """,
        key, enabled, description, updated_by,
    )
    return FeatureFlag(**dict(row))
