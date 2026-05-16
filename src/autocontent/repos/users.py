from __future__ import annotations

from ..db import get_pool
from ..models import User


async def upsert(user_id: str, email: str) -> User:
    """Idempotent insert keyed on Clerk user_id. Called from auth middleware
    on first request so the FK from niches/jobs always resolves."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into users (id, email) values ($1, $2)
        on conflict (id) do update set email = excluded.email
        returning id, email, ayrshare_profile_key, created_at
        """,
        user_id,
        email,
    )
    return User(**dict(row))


async def get(user_id: str) -> User | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select id, email, ayrshare_profile_key, created_at from users where id = $1",
        user_id,
    )
    return User(**dict(row)) if row else None


async def set_ayrshare_profile_key(user_id: str, key: str) -> None:
    pool = await get_pool()
    await pool.execute(
        "update users set ayrshare_profile_key = $2 where id = $1", user_id, key
    )
