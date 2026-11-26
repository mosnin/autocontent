"""WordPress connections (0035), one per workspace.

``password_sealed`` is read only by ``connection_secret``, which the publish
path calls right before it talks to WordPress. ``WordPressConnection`` (what
routes return) has no password field at all, only ``has_password``.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from ..db import get_pool

_PUBLIC = "id, user_id, site_url, username, seo_plugin, status, last_error, verified_at, created_at, updated_at"


class WordPressConnection(BaseModel):
    id: UUID
    user_id: str
    site_url: str
    username: str
    seo_plugin: str
    status: str
    last_error: str = ""
    verified_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    has_password: bool = True


async def get(user_id: str) -> WordPressConnection | None:
    pool = await get_pool()
    row = await pool.fetchrow(f"select {_PUBLIC} from wordpress_connections where user_id = $1", user_id)
    return WordPressConnection(**dict(row)) if row else None


async def connection_secret(user_id: str) -> tuple[WordPressConnection, str] | None:
    """The connection and its sealed password. Server-side use only."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_PUBLIC}, password_sealed from wordpress_connections where user_id = $1", user_id,
    )
    if not row:
        return None
    d = dict(row)
    sealed = d.pop("password_sealed")
    return WordPressConnection(**d), sealed


async def upsert(
    *, user_id: str, site_url: str, username: str, password_sealed: str, seo_plugin: str, created_by: str,
) -> WordPressConnection:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into wordpress_connections
            (user_id, site_url, username, password_sealed, seo_plugin, status, last_error, verified_at, created_by)
        values ($1, $2, $3, $4, $5, 'active', '', now(), $6)
        on conflict (user_id) do update
           set site_url = excluded.site_url, username = excluded.username,
               password_sealed = excluded.password_sealed, seo_plugin = excluded.seo_plugin,
               status = 'active', last_error = '', verified_at = now(), created_by = excluded.created_by
        returning {_PUBLIC}
        """,
        user_id, site_url, username, password_sealed, seo_plugin, created_by,
    )
    return WordPressConnection(**dict(row))


async def mark_error(user_id: str, error: str) -> None:
    pool = await get_pool()
    await pool.execute(
        "update wordpress_connections set status = 'error', last_error = $2 where user_id = $1",
        user_id, error[:500],
    )


async def delete(user_id: str) -> bool:
    pool = await get_pool()
    result = await pool.execute("delete from wordpress_connections where user_id = $1", user_id)
    return result.endswith(" 1")
