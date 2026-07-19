"""Image posts (stills + carousels). Payload jsonb carries the plan,
slide paths, and caption; rows are returned as plain dicts."""
from __future__ import annotations

import json
from uuid import UUID

from ..db import get_pool


def _row(row) -> dict:
    d = dict(row)
    if isinstance(d.get("payload"), str):
        d["payload"] = json.loads(d["payload"])
    return d


async def create(
    *,
    user_id: str,
    niche_id: UUID,
    kind: str = "carousel",
    topic: str = "",
    slide_count: int = 5,
    campaign_id: UUID | None = None,
) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into image_posts (user_id, niche_id, campaign_id, kind, topic, payload)
        values ($1, $2, $3, $4, $5, $6::jsonb)
        returning *
        """,
        user_id, niche_id, campaign_id, kind, topic,
        json.dumps({"slide_count": slide_count}),
    )
    return _row(row)


async def get(image_post_id: UUID, *, user_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from image_posts where id = $1 and user_id = $2",
        image_post_id, user_id,
    )
    return _row(row) if row else None


async def list_for_user(
    user_id: str, *, status: str | None = None, limit: int = 50
) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from image_posts
        where user_id = $1 and ($2::text is null or status = $2)
        order by created_at desc limit $3
        """,
        user_id, status, limit,
    )
    return [_row(r) for r in rows]


async def set_status(image_post_id: UUID, *, user_id: str, status: str) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update image_posts set status = $3, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        image_post_id, user_id, status,
    )
    return _row(row)


async def save_payload(image_post_id: UUID, *, user_id: str, payload: dict) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update image_posts set payload = $3::jsonb, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        image_post_id, user_id, json.dumps(payload),
    )
    return _row(row)


async def complete(
    image_post_id: UUID, *, user_id: str, provider_post_id: str
) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update image_posts
        set status = 'done', provider_post_id = $3, error = null, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        image_post_id, user_id, provider_post_id,
    )
    return _row(row)


async def fail(image_post_id: UUID, *, user_id: str, error: str) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update image_posts set status = 'failed', error = $3, updated_at = now()
        where id = $1 and user_id = $2 returning *
        """,
        image_post_id, user_id, error,
    )
    return _row(row)


async def claim_for_scheduling(image_post_id: UUID, *, user_id: str) -> bool:
    """Atomic awaiting_approval -> scheduling claim (double-click safety)."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update image_posts set status = 'scheduling', updated_at = now()
        where id = $1 and user_id = $2 and status = 'awaiting_approval'
        returning id
        """,
        image_post_id, user_id,
    )
    return row is not None


_REAPABLE_STATUSES = ("queued", "planning", "generating", "scheduling")
_REAP_ERROR = "reaped: no progress (container died or timed out mid-run)"


async def reap_stale(*, older_than_minutes: int = 120) -> int:
    """Fail image posts stuck in a non-terminal status with no progress —
    crashed/timed-out containers strand them there, invisible to the user
    and silently consuming campaign cadence. awaiting_approval is parking,
    not staleness, so it is exempt."""
    pool = await get_pool()
    result = await pool.execute(
        """
        update image_posts
           set status = 'failed', error = $2, updated_at = now()
         where status = any($1::text[])
           and updated_at < now() - make_interval(mins => $3)
        """,
        list(_REAPABLE_STATUSES), _REAP_ERROR, older_than_minutes,
    )
    return int(result.split()[-1])
