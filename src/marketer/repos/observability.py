"""The workspace's observability content setting (migration 0033).

``users.observability_content`` is ``redacted`` or ``metadata``. Every function
raises on a database error; callers decide (routes: 503; the span pipeline:
metadata).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from marketer.db import get_pool

CONTENT_VALUES: tuple[str, ...] = ("redacted", "metadata")


@dataclass(frozen=True)
class Setting:
    content: str
    updated_at: datetime | None


async def get_setting(tenant_id: str) -> Setting:
    """``redacted`` (the column default) when the tenant row does not exist yet:
    the backend creates it the first time it sees a workspace."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "select observability_content, observability_updated_at from users where id = $1", tenant_id
    )
    if row is None:
        return Setting("redacted", None)
    return Setting(row["observability_content"], row["observability_updated_at"])


async def set_setting(tenant_id: str, content: str) -> Setting:
    if content not in CONTENT_VALUES:
        raise ValueError(f"observability content must be one of {CONTENT_VALUES}")
    pool = await get_pool()
    row = await pool.fetchrow(
        "update users set observability_content = $2, observability_updated_at = now() where id = $1 "
        "returning observability_content, observability_updated_at",
        tenant_id, content,
    )
    if row is None:
        raise LookupError("workspace not found")
    return Setting(row["observability_content"], row["observability_updated_at"])
