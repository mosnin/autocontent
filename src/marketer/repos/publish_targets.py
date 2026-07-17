"""Publish target registry — WordPress sites / generic webhooks a finished
article can be pushed to.

`secret` (WordPress application password, or the webhook HMAC signing
secret) is write-only from the API's perspective: POST accepts it, but
`PublishTarget` (the shape every route returns) never carries it. Only
`get_with_secret` / `sole_enabled` expose it, and those are for internal
use by services/publishing.py and the autopilot scheduler only — routes
must never serialize their return values directly.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from ..db import get_pool


class PublishTarget(BaseModel):
    """Public shape — no secret."""

    id: UUID
    user_id: str
    kind: str  # 'wordpress' | 'webhook'
    name: str
    base_url: str
    username: str
    disabled: bool
    created_at: datetime


class PublishTargetSecret(PublishTarget):
    """Internal shape carrying the secret — for the publishing service only."""

    secret: str


_PUBLIC_COLS = "id, user_id, kind, name, base_url, username, disabled, created_at"
_SECRET_COLS = _PUBLIC_COLS + ", secret"


async def create(
    *,
    user_id: str,
    kind: str,
    name: str,
    base_url: str,
    username: str = "",
    secret: str = "",
) -> PublishTarget:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into publish_targets (user_id, kind, name, base_url, username, secret)
        values ($1, $2, $3, $4, $5, $6)
        returning {_PUBLIC_COLS}
        """,
        user_id, kind, name, base_url, username, secret,
    )
    return PublishTarget(**dict(row))


async def list_for_user(user_id: str) -> list[PublishTarget]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"select {_PUBLIC_COLS} from publish_targets where user_id = $1 order by created_at desc",
        user_id,
    )
    return [PublishTarget(**dict(r)) for r in rows]


async def get(target_id: UUID, *, user_id: str) -> PublishTarget | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_PUBLIC_COLS} from publish_targets where id = $1 and user_id = $2",
        target_id, user_id,
    )
    return PublishTarget(**dict(row)) if row else None


async def get_with_secret(target_id: UUID, *, user_id: str) -> PublishTargetSecret | None:
    """Internal — used only by the publish route/service right before an
    outbound call. Never return this over the API."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_SECRET_COLS} from publish_targets where id = $1 and user_id = $2",
        target_id, user_id,
    )
    return PublishTargetSecret(**dict(row)) if row else None


async def delete(target_id: UUID, *, user_id: str) -> bool:
    pool = await get_pool()
    result = await pool.execute(
        "delete from publish_targets where id = $1 and user_id = $2",
        target_id, user_id,
    )
    return result.split()[-1] != "0"


async def sole_enabled(user_id: str) -> PublishTargetSecret | None:
    """The user's one enabled target, or None if there isn't exactly one.

    Backs the autopilot's narrow auto-publish rule: an autopilot-generated
    article auto-publishes only when the account has exactly one enabled
    target — any more and the choice is ambiguous, so we stay explicit and
    require a manual POST /articles/{id}/publish instead."""
    pool = await get_pool()
    rows = await pool.fetch(
        f"select {_SECRET_COLS} from publish_targets where user_id = $1 and disabled = false limit 2",
        user_id,
    )
    if len(rows) != 1:
        return None
    return PublishTargetSecret(**dict(rows[0]))
